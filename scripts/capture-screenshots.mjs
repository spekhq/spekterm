/**
 * The website's screenshots (`project-website`: "Screenshots come only from the capture script").
 *
 * Starts the **built** app (`npm run build` first; `npm run capture:screenshots` does both) under a
 * virtual display with nothing of the person running it: a fresh user-data directory, an invented home
 * (`me@spekterm` prompt, generic git identity), fixture repositories at a fixed generic path (the status
 * bar shows the working directory), an environment built from an allow-list, and the stub agent replaying
 * a prepared transcript. Writes `site/src/assets/screenshots/<en|zh-TW>/<name>.png` and a manifest of
 * their hashes, which `scripts/screenshot-manifest.test.mjs` checks.
 *
 * Before every capture it reads what the app shows — page text, text-field values, terminal buffers —
 * through the content-hygiene matcher and aborts on a hit; and aborts when the fixture repository's name
 * is **not** in that text (an empty or wrong page would otherwise pass). The images are still reviewed by
 * the maintainer before they are committed: nothing here checks pixels.
 *
 * The shots: `hero` (conversation view beside the change's tasks), `terminal` (a shell beside its
 * proposal), `graph` (the maximized side panel's Graph), `inbox` (Slack mentions, cropped to the list),
 * and `handoff` (a session that handed work to two others, one finished, with its brief open). The
 * fixture repository has a history — archived changes and a second active change — so the Graph has
 * something to relate; with two active changes the side panel does not pick one, so each shot that
 * shows the change chooses it in the Browse tree first.
 *
 * Usage: npm run capture:screenshots
 *        node scripts/capture-screenshots.mjs --only hero   (one shot, for iterating)
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { connectToApp, pollFor, pressKey } from './lib/cdp.mjs'
import { copyIn, labelIn } from './lib/copy.mjs'
import { electronExtraArgs, useVirtualDisplay, withDisplay } from './lib/display.mjs'
import { awaitMounted, mountedExpression } from './lib/mounted.mjs'
import { PROBE_PORTS } from './lib/ports.mjs'
import { seedLanguage } from './lib/probe-language.mjs'
import { quitAndWait } from './lib/quit.mjs'
import { screenVerdict } from './lib/screen-check.mjs'
import { makeStubAgent } from './lib/stub-agent.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = PROBE_PORTS.screenshots.main

/** Fixed, generic locations — they can appear on screen (status bar, prompt). */
const SHOTS_ROOT = '/tmp/spekterm-shots'
const HOME = join(SHOTS_ROOT, 'home')
const CONFIG_DIR = join(HOME, '.claude')
const REPOS = { api: join(SHOTS_ROOT, 'api-server'), web: join(SHOTS_ROOT, 'web-app') }
/** The positive control of every text read: a capture that cannot see this name is looking at nothing. */
const FIXTURE_NAME = 'api-server'

const OUT_DIR = join(root, 'site', 'src', 'assets', 'screenshots')
const MANIFEST = join(OUT_DIR, 'manifest.json')
const LANGUAGES = ['en', 'zh-TW']
const VIEWPORT = { width: 1440, height: 900 }

// ── Re-run under the virtual display ───────────────────────────────────────────────────────────────

if (useVirtualDisplay() && !process.env.SPEKTERM_SHOTS_UNDER_DISPLAY) {
  const [command, args] = withDisplay(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)])
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, SPEKTERM_SHOTS_UNDER_DISPLAY: '1' },
  })
  process.exit(result.status ?? 1)
}

if (!existsSync(join(root, 'out', 'main', 'index.js'))) {
  console.error('No build in out/ — run `npm run build` first (or `npm run capture:screenshots`).')
  process.exit(1)
}

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────────────

function write(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

function git(cwd, ...args) {
  return gitAt(cwd, null, ...args)
}

/** git with the author and committer date set to `date` (a `YYYY-MM-DD`), or the fixture default. */
function gitAt(cwd, date, ...args) {
  const env = fixtureEnv()
  if (date) env.GIT_AUTHOR_DATE = env.GIT_COMMITTER_DATE = `${date}T09:00:00Z`
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr}`)
}

const API_CHANGE = 'add-rate-limiting'

function seedApiServer(dir) {
  write(join(dir, 'README.md'), '# api-server\n\nThe public HTTP API.\n')
  write(
    join(dir, 'src', 'server.ts'),
    "import { createServer } from 'node:http'\nimport { route } from './routes'\n\ncreateServer(route).listen(8080)\n",
  )
  write(join(dir, 'src', 'routes.ts'), "export function route(req, res) {\n  res.end('ok')\n}\n")
  write(
    join(dir, 'openspec', 'specs', 'auth', 'spec.md'),
    [
      '# auth Specification',
      '',
      '## Purpose',
      'How API clients authenticate with an API key.',
      '',
      '## Requirements',
      '### Requirement: Requests carry an API key',
      'Every request SHALL carry an API key in the `Authorization` header.',
      '',
      '#### Scenario: A request without a key is rejected',
      '- **WHEN** a request has no `Authorization` header',
      '- **THEN** the server answers 401',
      '',
    ].join('\n'),
  )
  const change = join(dir, 'openspec', 'changes', API_CHANGE)
  write(join(change, '.openspec.yaml'), 'schema: spec-driven\ncreated: 2026-09-29\n')
  API_HISTORY.push({ slug: API_CHANGE, created: '2026-09-29', path: change })
  write(
    join(change, 'proposal.md'),
    [
      '## Why',
      '',
      'One client can exhaust the API for everyone: there is no limit on how many requests a key can make.',
      '',
      '## What Changes',
      '',
      '- Each API key gets a request budget per minute.',
      '- Requests over the budget are answered with 429 and a `Retry-After` header.',
      '- The budget is configurable per plan.',
      '',
      '## Capabilities',
      '',
      '### New Capabilities',
      '',
      '- `rate-limiting`: per-key request budgets and how the API answers when one is spent.',
      '',
      '## Impact',
      '',
      '- `src/server.ts` gains a middleware; a Redis counter per key.',
      '',
    ].join('\n'),
  )
  write(
    join(change, 'design.md'),
    [
      '## Context',
      '',
      'Requests are served by a single Node process behind a load balancer.',
      '',
      '## Decisions',
      '',
      '### D1. A sliding window counter in Redis',
      '',
      'A fixed window lets a client send twice the budget across a window boundary. A sliding window',
      'counter keeps the budget honest with two keys per client.',
      '',
      '### D2. The limit is read from the plan, not hard-coded',
      '',
    ].join('\n'),
  )
  write(
    join(change, 'tasks.md'),
    [
      '## 1. Counter',
      '',
      '- [x] 1.1 Sliding window counter with Redis and unit tests',
      '- [x] 1.2 Read the budget from the plan',
      '',
      '## 2. Middleware',
      '',
      '- [x] 2.1 Answer 429 with `Retry-After` when the budget is spent',
      '- [x] 2.2 Add `X-RateLimit-Remaining` to every response',
      '- [ ] 2.3 Integration test against a real Redis',
      '',
      '## 3. Docs',
      '',
      '- [ ] 3.1 Document the limits per plan',
      '',
    ].join('\n'),
  )
  write(
    join(change, 'specs', 'rate-limiting', 'spec.md'),
    [
      '## ADDED Requirements',
      '',
      '### Requirement: Each key has a request budget',
      'The API SHALL count requests per API key over a sliding one-minute window.',
      '',
      '#### Scenario: A key over its budget is told when to retry',
      '- **WHEN** a key exceeds its budget',
      '- **THEN** the API answers 429 with a `Retry-After` header',
      '',
    ].join('\n'),
  )
}

/** A main spec with one requirement — enough for the side panel to list and relate it. */
function seedSpec(dir, capability, purpose, requirement) {
  write(
    join(dir, 'openspec', 'specs', capability, 'spec.md'),
    [`# ${capability} Specification`, '', '## Purpose', purpose, '', '## Requirements', `### Requirement: ${requirement}`, `The API SHALL ${requirement.toLowerCase()}.`, ''].join('\n'),
  )
}

/**
 * The api-server repository's change history, replayed as commits (`commitApiHistory`) so that git dates —
 * which spek reads for each change's lifecycle and timeline — differ from change to change.
 */
const API_HISTORY = []

function daysBefore(date, days) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/** An archived change that touched the given capabilities — the Graph's edges and the Timeline's rows. */
function seedArchived(dir, date, slug, why, capabilities) {
  const change = join(dir, 'openspec', 'changes', 'archive', `${date}-${slug}`)
  const created = daysBefore(date, 4 + (slug.length % 9))
  API_HISTORY.push({ slug, created, archived: date, path: change })
  write(join(change, '.openspec.yaml'), `schema: spec-driven\ncreated: ${created}\n`)
  write(join(change, 'proposal.md'), `## Why\n\n${why}\n\n## What Changes\n\n- See the specs.\n`)
  write(join(change, 'tasks.md'), '## 1. Work\n\n- [x] 1.1 Implement\n- [x] 1.2 Test\n')
  for (const [capability, requirement] of Object.entries(capabilities)) {
    write(
      join(change, 'specs', capability, 'spec.md'),
      ['## ADDED Requirements', '', `### Requirement: ${requirement}`, `The API SHALL ${requirement.toLowerCase()}.`, ''].join('\n'),
    )
  }
}

/** What the api-server repository went through before the change the screenshots are about. */
function seedApiHistory(dir) {
  seedSpec(dir, 'api-keys', 'How API keys are issued, rotated, and revoked.', 'Keys can be rotated without downtime')
  seedSpec(dir, 'billing-plans', 'The plans a customer can be on and what each includes.', 'Each plan names its request budget')
  seedSpec(dir, 'webhooks', 'How the API notifies customers of events.', 'Webhook payloads are signed')
  seedSpec(dir, 'audit-log', 'What the API records about who did what.', 'Key changes are recorded')
  seedSpec(dir, 'error-format', 'The shape of every error response.', 'Errors carry a stable code')
  seedSpec(dir, 'pagination', 'How list endpoints page through results.', 'Lists page by cursor')
  seedSpec(dir, 'request-logging', 'What is logged for each request.', 'Each request is logged once')
  seedSpec(dir, 'sdk-clients', 'The client libraries published for the API.', 'Clients retry on 429')
  seedArchived(dir, '2026-07-14', 'add-api-keys', 'Clients shared one token; there was no way to revoke a single client.', {
    auth: 'Requests carry an API key',
    'api-keys': 'Keys can be rotated without downtime',
  })
  seedArchived(dir, '2026-08-05', 'record-key-changes', 'Nobody could tell who revoked a key.', {
    'audit-log': 'Key changes are recorded',
    'api-keys': 'Revoked keys stop working within a minute',
  })
  seedArchived(dir, '2026-08-27', 'introduce-plans', 'Every customer got the same limits whatever they paid.', {
    'billing-plans': 'Each plan names its request budget',
  })
  seedArchived(dir, '2026-06-30', 'standardize-errors', 'Each endpoint invented its own error shape.', {
    'error-format': 'Errors carry a stable code',
    'request-logging': 'Error responses are logged with their code',
  })
  seedArchived(dir, '2026-07-28', 'cursor-pagination', 'Offset pages skipped rows when data changed underneath.', {
    pagination: 'Lists page by cursor',
    'error-format': 'An expired cursor is a 410',
  })
  seedArchived(dir, '2026-08-19', 'log-requests', 'Support could not trace a customer complaint to a request.', {
    'request-logging': 'Each request is logged once',
    'audit-log': 'Key changes link to the request that made them',
  })
  seedArchived(dir, '2026-09-08', 'publish-sdks', 'Every customer wrote their own client.', {
    'sdk-clients': 'Clients retry on 429',
    'api-keys': 'Clients read the key from the environment',
    pagination: 'Clients iterate pages for you',
  })
  seedArchived(dir, '2026-09-18', 'sign-webhooks', 'Customers could not tell our webhooks from forged ones.', {
    webhooks: 'Webhook payloads are signed',
    auth: 'Webhook secrets are per key',
  })
  const usage = join(dir, 'openspec', 'changes', 'usage-alerts')
  write(join(usage, '.openspec.yaml'), 'schema: spec-driven\ncreated: 2026-10-03\n')
  API_HISTORY.push({ slug: 'usage-alerts', created: '2026-10-03', path: usage })
  write(join(usage, 'proposal.md'), '## Why\n\nCustomers find out they hit their budget from a 429.\n\n## What Changes\n\n- Warn by webhook at 80% of the budget.\n')
  write(
    join(usage, 'specs', 'webhooks', 'spec.md'),
    '## ADDED Requirements\n\n### Requirement: A budget warning is sent at 80%\nThe API SHALL send a webhook when a key reaches 80% of its budget.\n',
  )
  write(
    join(usage, 'specs', 'sdk-clients', 'spec.md'),
    '## ADDED Requirements\n\n### Requirement: Clients surface the budget warning\nClients SHALL expose the budget warning as an event.\n',
  )
  write(
    join(dir, 'openspec', 'changes', API_CHANGE, 'specs', 'error-format', 'spec.md'),
    '## ADDED Requirements\n\n### Requirement: A spent budget is a 429 with a stable code\nThe API SHALL answer a spent budget with 429 and the code `rate_limited`.\n',
  )
  write(
    join(dir, 'openspec', 'changes', API_CHANGE, 'specs', 'billing-plans', 'spec.md'),
    '## MODIFIED Requirements\n\n### Requirement: Each plan names its request budget\nEach plan SHALL name its request budget per minute.\n',
  )
}

function seedWebApp(dir) {
  write(join(dir, 'README.md'), '# web-app\n\nThe customer dashboard.\n')
  write(join(dir, 'src', 'main.tsx'), "import { App } from './App'\n\nrender(<App />)\n")
  write(
    join(dir, 'openspec', 'specs', 'dashboard', 'spec.md'),
    '# dashboard Specification\n\n## Purpose\nThe home screen of a signed-in customer.\n\n## Requirements\n',
  )
}

/** What the people in the prepared exchange say, per screenshot language. */
const TRANSCRIPT_TEXT = {
  en: {
    ask: `Continue the ${API_CHANGE} change: do task 2.2.`,
    plan: 'Task 2.2 adds `X-RateLimit-Remaining` to every response. The counter already knows the remaining budget, so the middleware only has to pass it on.',
    done: 'Done: every response now carries `X-RateLimit-Remaining`, and the 12 rate-limit tests pass. I checked off 2.2 in `tasks.md`. Next is 2.3, the integration test against a real Redis — shall I start it?',
  },
  'zh-TW': {
    ask: `繼續 ${API_CHANGE} 這個 change：做 task 2.2。`,
    plan: 'Task 2.2 要在每個回應加上 `X-RateLimit-Remaining`。計數器本來就知道剩餘額度，middleware 只要把它帶出去。',
    done: '完成：每個回應都帶有 `X-RateLimit-Remaining`，12 個 rate-limit 測試全過，`tasks.md` 的 2.2 已打勾。下一項是 2.3，對真的 Redis 跑整合測試 —— 要開始嗎？',
  },
}

/** The prepared exchange the conversation view shows. Illustrative — the website's captions say so. */
function transcript(language) {
  const say = TRANSCRIPT_TEXT[language]
  const at = (minute) => `2026-10-01T09:${String(minute).padStart(2, '0')}:00.000Z`
  const records = [
    { type: 'user', uuid: 'u1', timestamp: at(0), message: { role: 'user', content: say.ask } },
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: at(1),
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: say.plan },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/middleware/rate-limit.ts' } },
        ],
      },
    },
    { type: 'user', uuid: 'r1', timestamp: at(1), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'export function rateLimit(counter) { … }' }] } },
    {
      type: 'assistant',
      uuid: 'a2',
      timestamp: at(2),
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: 'src/middleware/rate-limit.ts' } },
        ],
      },
    },
    { type: 'user', uuid: 'r2', timestamp: at(2), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'Updated 1 file' }] } },
    {
      type: 'assistant',
      uuid: 'a3',
      timestamp: at(3),
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'npm test -- rate-limit' } },
        ],
      },
    },
    { type: 'user', uuid: 'r3', timestamp: at(3), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't3', content: '12 passing' }] } },
    {
      type: 'assistant',
      uuid: 'a4',
      timestamp: at(4),
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: say.done },
        ],
      },
    },
  ]
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
}

/** The process environment the app gets: an allow-list, never the parent's environment. */
function fixtureEnv(stubBin = '') {
  const nodeBin = dirname(process.execPath) // node and the `openspec` CLI the side panel runs
  return {
    HOME,
    SHELL: '/bin/zsh',
    PATH: [stubBin, join(root, 'node_modules', '.bin'), nodeBin, '/usr/local/bin', '/usr/bin', '/bin']
      .filter(Boolean)
      .join(':'),
    CLAUDE_CONFIG_DIR: CONFIG_DIR,
    LANG: 'C.UTF-8',
    TERM: 'xterm-256color',
    // The screenshots' own `openspec` runs send no usage statistics.
    OPENSPEC_TELEMETRY: '0',
    DO_NOT_TRACK: '1',
    GIT_AUTHOR_DATE: '2026-10-01T09:00:00Z',
    GIT_COMMITTER_DATE: '2026-10-01T09:00:00Z',
    // Display variables only — set by xvfb-run for this process.
    ...(process.env.DISPLAY ? { DISPLAY: process.env.DISPLAY } : {}),
    ...(process.env.XAUTHORITY ? { XAUTHORITY: process.env.XAUTHORITY } : {}),
  }
}

/**
 * Every change is held out of the tree, the rest committed first; then each change is proposed (committed
 * at its active path on its creation date) and, if archived, moved into the archive on its archive date —
 * in date order, as a real repository would have it.
 */
function commitApiHistory(dir) {
  const hold = join(SHOTS_ROOT, 'hold')
  for (const change of API_HISTORY) {
    mkdirSync(hold, { recursive: true })
    renameSync(change.path, join(hold, change.slug))
  }
  gitAt(dir, '2026-06-02', 'init', '-q')
  gitAt(dir, '2026-06-02', 'add', '.')
  gitAt(dir, '2026-06-02', 'commit', '-q', '-m', 'Initial commit')
  const events = API_HISTORY.flatMap((change) => [
    { date: change.created, kind: 'propose', change },
    ...(change.archived ? [{ date: change.archived, kind: 'archive', change }] : []),
  ]).sort((a, b) => (a.date === b.date ? (a.kind === 'propose' ? -1 : 1) : a.date < b.date ? -1 : 1))
  for (const { date, kind, change } of events) {
    const active = join(dir, 'openspec', 'changes', change.slug)
    if (kind === 'propose') {
      mkdirSync(dirname(active), { recursive: true })
      renameSync(join(hold, change.slug), active)
      gitAt(dir, date, 'add', '.')
      gitAt(dir, date, 'commit', '-q', '-m', `Propose ${change.slug}`)
    } else {
      mkdirSync(dirname(change.path), { recursive: true })
      gitAt(dir, date, 'mv', active, change.path)
      gitAt(dir, date, 'commit', '-q', '-m', `Archive ${change.slug}`)
    }
  }
}

function prepareFixtures() {
  rmSync(SHOTS_ROOT, { recursive: true, force: true })
  write(join(HOME, '.zshrc'), "PROMPT='%F{green}me@spekterm%f %F{blue}%1~%f %# '\nunsetopt BEEP\n")
  write(join(HOME, '.gitconfig'), '[user]\n\tname = Alex Example\n\temail = alex@example.com\n[init]\n\tdefaultBranch = main\n')
  mkdirSync(CONFIG_DIR, { recursive: true })
  seedApiServer(REPOS.api)
  seedApiHistory(REPOS.api)
  seedWebApp(REPOS.web)
  git(REPOS.web, 'init', '-q')
  git(REPOS.web, 'add', '.')
  git(REPOS.web, 'commit', '-q', '-m', 'Initial commit')
  commitApiHistory(REPOS.api)
  git(REPOS.api, 'checkout', '-q', '-b', API_CHANGE)
  for (const language of LANGUAGES) write(join(SHOTS_ROOT, `transcript.${language}.jsonl`), transcript(language))
}

function seedProfile(profile, language) {
  mkdirSync(profile, { recursive: true })
  writeFileSync(
    join(profile, 'workspace.json'),
    JSON.stringify({
      version: 1,
      folders: [
        { id: 'f1', path: REPOS.api, addedAt: '2026-10-01T09:00:00.000Z' },
        { id: 'f2', path: REPOS.web, addedAt: '2026-10-01T09:00:00.000Z' },
      ],
    }),
  )
  seedLanguage(profile, { language })
  // GPU terminal renderer off: the virtual display's software GL proves resource lifecycles, not pixels.
  const prefs = JSON.parse(readFileSync(join(profile, 'preferences.json'), 'utf8'))
  prefs.terminal = { ...prefs.terminal, gpuAcceleration: false }
  writeFileSync(join(profile, 'preferences.json'), JSON.stringify(prefs, null, 2))
}

/** Slack mentions waiting in the inbox; the ids have the shape the Slack producer gives them. */
const INBOX_ITEMS = {
  en: [
    {
      channel: ['C0API', '#api'],
      actor: '@alex',
      title: '429s on the staging dashboard',
      body: 'Since this morning the dashboard on staging gets 429 Too Many Requests on every refresh. Can you check whether the new rate limit counts the health checks?',
    },
    {
      channel: ['C0FRONT', '#frontend'],
      actor: '@sam',
      title: 'Show the remaining budget on the usage page',
      body: 'Now that responses carry X-RateLimit-Remaining, could the usage page show it? Customers keep asking how close they are.',
    },
    {
      channel: ['C0API', '#api'],
      actor: '@jordan',
      title: 'Webhook retries after a key is revoked',
      body: 'We still retry webhooks for a key that was revoked an hour ago. Should the retry queue drop them?',
    },
  ],
  'zh-TW': [
    {
      channel: ['C0API', '#api'],
      actor: '@alex',
      title: 'staging 的 dashboard 一直 429',
      body: '今天早上開始，staging 的 dashboard 每次重新整理都回 429 Too Many Requests。可以幫忙看一下新的 rate limit 是不是把 health check 也算進去了？',
    },
    {
      channel: ['C0FRONT', '#frontend'],
      actor: '@sam',
      title: '在用量頁顯示剩餘額度',
      body: '既然回應都帶了 X-RateLimit-Remaining，用量頁可以把它顯示出來嗎？客戶一直問自己還剩多少。',
    },
    {
      channel: ['C0API', '#api'],
      actor: '@jordan',
      title: 'key 撤銷之後 webhook 還在重送',
      body: '一個一小時前就撤銷的 key，它的 webhook 我們還在重送。重送佇列是不是該把它們丟掉？',
    },
  ],
}

function dropInboxItems(profile, language) {
  // #frontend goes to web-app by a rule; everything else falls back to api-server.
  writeFileSync(
    join(profile, 'intake-routing.json'),
    JSON.stringify({ version: 1, rules: [{ id: 'r1', criterion: 'originLabel', contains: '#frontend', folderId: 'f2' }], fallbackFolderId: 'f1' }),
  )
  const inbox = join(profile, 'intake-inbox')
  mkdirSync(inbox, { recursive: true })
  INBOX_ITEMS[language].forEach(({ channel: [channelId, label], actor, title, body }, i) => {
    const id = `slack:T0EXAMPLE:${channelId}:17598${i}2720.00010${i}`
    const target = join(inbox, `mention-${i + 1}.json`)
    writeFileSync(`${target}.tmp`, JSON.stringify({ id, origin: { kind: 'slack', id: channelId, label }, title, body, actor }))
    renameSync(`${target}.tmp`, target)
  })
}

/** The handoffs the `handoff` shot makes the first session write, per screenshot language. */
const HANDOFFS = {
  en: {
    cross: {
      title: 'Show the remaining budget on the usage page',
      body: 'api-server now sends X-RateLimit-Remaining on every response (change add-rate-limiting). Show it on the usage page next to the plan budget.',
      report: 'The usage page shows the remaining budget, refreshed with every API call it makes.',
    },
    same: {
      title: 'Integration test against a real Redis',
      body: 'Task 2.3 of add-rate-limiting: run the rate-limit tests against a real Redis in CI.',
    },
  },
  'zh-TW': {
    cross: {
      title: '在用量頁顯示剩餘額度',
      body: 'api-server 現在每個回應都帶 X-RateLimit-Remaining（change add-rate-limiting）。把它顯示在用量頁、方案額度的旁邊。',
      report: '用量頁已顯示剩餘額度，每次呼叫 API 時跟著更新。',
    },
    same: {
      title: '對真的 Redis 跑整合測試',
      body: 'add-rate-limiting 的 task 2.3：在 CI 裡對真的 Redis 跑 rate-limit 測試。',
    },
  },
}

/** Write a file the way the handoff instructions tell an agent to: a temporary name, then a rename. */
function deliver(outbox, name, payload) {
  const target = join(outbox, `${name}.json`)
  writeFileSync(`${target}.partial`, JSON.stringify(payload))
  renameSync(`${target}.partial`, target)
}

const outboxRoot = (profile) => join(profile, 'handoff', 'outbox')

/** The outbox of the one session that is not in `known` — a session's id is its outbox's name. */
async function awaitNewOutbox(profile, known, label) {
  let found = null
  await pollFor({
    read: () => {
      const names = existsSync(outboxRoot(profile)) ? readdirSync(outboxRoot(profile)) : []
      found = names.find((name) => !known.includes(name)) ?? null
      return found
    },
    settled: Boolean,
    timeoutMs: 30_000,
    label,
  })
  if (!found) throw new Error(`gave up waiting: ${label}`)
  return found
}

// ── The app ────────────────────────────────────────────────────────────────────────────────────────

async function launch(profile, stub, language) {
  const child = spawn(
    join(root, 'node_modules', '.bin', 'electron'),
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      ...electronExtraArgs(),
      '.',
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: fixtureEnv(stub.bin) },
  )
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  const client = await connectToApp(PORT, { targetTimeoutMs: 30_000 })
  // A fixed viewport at 2x, independent of the virtual screen's size (an 800x600 logical window at
  // `--force-device-scale-factor=2` was the first attempt — too cramped to show anything).
  await client.send('Emulation.setDeviceMetricsOverride', { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 2, mobile: false })
  // The mount check names the rail by its label, which is in the app's language.
  const rail = `document.querySelector('aside[aria-label="${copyIn(language, 'rail.label')}"]')`
  await awaitMounted(client, { expression: mountedExpression({ extra: { rail } }), timeoutMs: 30_000 })
  return { child, client, output: () => output }
}

/** Evaluate until it returns `true`. */
async function until(client, expression, label, timeoutMs = 20_000) {
  const value = await pollFor({ read: () => client.evaluate(expression), settled: (v) => v === true, timeoutMs, label })
  if (value !== true) throw new Error(`gave up waiting: ${label}`)
}

const clickByLabel = (selector) => `(() => {
  const el = document.querySelector('${selector}')
  if (!el) return false
  el.click()
  return true
})()`

/** Every piece of text on screen, including text-field values and terminal buffers. */
const SCREEN_TEXT = `(() => {
  const fields = [...document.querySelectorAll('input, textarea')].map((el) => el.value).join('\\n')
  return document.body.innerText + '\\n' + fields
})()`

async function checkScreen(client, name) {
  const problem = screenVerdict(await client.evaluate(SCREEN_TEXT), { fixtureName: FIXTURE_NAME })
  if (problem) throw new Error(`${name}: ${problem}`)
}

/**
 * @param {{ height?: number }} [options] `height`: keep only the top of the window, in CSS pixels —
 *   for a view whose content ends well above the window's bottom edge.
 */
async function capture(client, language, name, manifest, { height } = {}) {
  await checkScreen(client, name)
  await sleep(400) // let the last paint land
  const clip = height ? { x: 0, y: 0, width: VIEWPORT.width, height: Math.min(height, VIEWPORT.height), scale: 1 } : undefined
  const { data } = await client.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) })
  const bytes = Buffer.from(data, 'base64')
  const file = join(OUT_DIR, language, `${name}.png`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, bytes)
  manifest[relative(OUT_DIR, file)] = createHash('sha256').update(bytes).digest('hex')
  console.log(`  ✓ ${relative(root, file)}`)
}

// ── Shots ──────────────────────────────────────────────────────────────────────────────────────────

async function selectRepo(client, name) {
  await until(client, clickByLabel(`[aria-label="${name}"]`), `select ${name} on the rail`)
}

async function newSession(client, language, kind) {
  await until(client, clickByLabel(labelIn(language, 'sessions.new')), 'open the spawn menu')
  const wanted = copyIn(language, kind === 'claude' ? 'sessions.spawnClaude' : 'sessions.spawnShell')
  await until(
    client,
    `(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.includes(${JSON.stringify(wanted)}))
      if (!item) return false
      item.click()
      return true
    })()`,
    `choose ${wanted}`,
  )
}

/**
 * Anchor the side panel on the change the screenshots are about and open one of its artifacts. With
 * two active changes the panel does not pick one on its own; choosing it in the Browse tree is what a
 * person does.
 */
async function openChange(client, artifact) {
  await until(
    client,
    `(() => {
      const buttons = document.querySelectorAll('[role="treeitem"][title="${API_CHANGE}"] button')
      if (buttons.length === 0) return false
      buttons[buttons.length - 1].click()
      return true
    })()`,
    `choose ${API_CHANGE} in the Browse tree`,
    25_000,
  )
  await until(
    client,
    `(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent.trim() === ${JSON.stringify(artifact)})
      if (!tab) return false
      tab.click()
      return tab.getAttribute('aria-selected') === 'true'
    })()`,
    `open the ${artifact}`,
  )
}

/** Type a command into the focused terminal and run it. */
async function runInTerminal(client, command) {
  await client.send('Input.insertText', { text: command })
  await pressKey(client, 'Enter')
}

const SHOTS = {
  async hero(client, language, manifest) {
    await selectRepo(client, 'api-server')
    await newSession(client, language, 'claude')
    await until(client, clickByLabel(labelIn(language, 'conversation.showConversation')), 'switch to the conversation view', 25_000)
    await until(client, `document.body.innerText.includes('X-RateLimit-Remaining')`, 'the transcript reaches the view', 25_000)
    await openChange(client, 'Tasks')
    await capture(client, language, 'hero', manifest)
  },

  /** A shell session beside the change's proposal, with the rail showing both kinds of session. */
  async terminal(client, language, manifest) {
    await selectRepo(client, 'api-server')
    await newSession(client, language, 'claude')
    await until(client, `document.querySelectorAll('[role="tab"]').length > 0`, 'the claude tab exists', 25_000)
    await newSession(client, language, 'shell')
    await until(client, `[...document.querySelectorAll('.xterm-rows')].some((rows) => rows.innerText.includes('me@spekterm'))`, 'the shell prompt', 25_000)
    await until(client, `(() => {
      const rows = [...document.querySelectorAll('.xterm-rows')].find((r) => r.innerText.includes('me@spekterm'))
      const t = rows?.closest('.xterm')?.querySelector('.xterm-helper-textarea')
      if (!t) return false
      t.focus()
      return document.activeElement === t
    })()`, 'focus the terminal')
    await runInTerminal(client, 'git log --oneline --decorate')
    await until(client, `[...document.querySelectorAll('.xterm-rows')].some((rows) => rows.innerText.includes('Initial commit'))`, 'the git log output')
    await runInTerminal(client, 'ls openspec/changes/add-rate-limiting')
    await until(client, `[...document.querySelectorAll('.xterm-rows')].some((rows) => rows.innerText.includes('tasks.md'))`, 'the command output', 15_000)
    await openChange(client, 'Proposal')
    await capture(client, language, 'terminal', manifest)
  },

  /** The inbox with Slack mentions waiting, each set to open in the repository routing picked. */
  async inbox(client, language, manifest) {
    await selectRepo(client, 'api-server')
    await until(
      client,
      `(() => {
        if (document.querySelector('[role="dialog"]${labelIn(language, 'intake.label')}')) return true
        document.querySelector('${labelIn(language, 'activityBar.handoffs')}')?.click()
        return false
      })()`,
      'open the inbox',
    )
    const titles = INBOX_ITEMS[language].map((item) => item.title)
    await until(client, `${JSON.stringify(titles)}.every((t) => document.body.innerText.includes(t))`, 'every item is listed', 15_000)
    // The list ends far above the window's bottom edge: keep the window down to the lowest card.
    const bottom = await client.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]${labelIn(language, 'intake.label')}')
      const titles = ${JSON.stringify(titles)}
      const holds = (el, t) => el.textContent.includes(t)
      // Each item's card: the largest ancestor of its title that holds no other item's title.
      const cardOf = (title) => {
        let card = [...dialog.querySelectorAll('*')].find((el) => el.children.length === 0 && holds(el, title))
        const others = titles.filter((t) => t !== title)
        while (card.parentElement && !others.some((t) => holds(card.parentElement, t))) card = card.parentElement
        return card
      }
      return Math.max(...titles.map((title) => cardOf(title).getBoundingClientRect().bottom))
    })()`)
    await capture(client, language, 'inbox', manifest, { height: Math.ceil(bottom) + 24 })
  },

  /** The side panel maximized over the stage, showing how the repository's specs and changes relate. */
  async graph(client, language, manifest) {
    await selectRepo(client, 'api-server')
    await newSession(client, language, 'claude')
    await until(client, clickByLabel(`[aria-label="${copyIn(language, 'stage.maximizeSidePanel')}"]`), 'maximize the side panel', 25_000)
    const graph = copyIn(language, 'viz.graph')
    await until(
      client,
      `(() => {
        const tab = [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent.trim().endsWith(${JSON.stringify(graph)}))
        if (!tab) return false
        tab.click()
        return tab.getAttribute('aria-selected') === 'true'
      })()`,
      'open the graph',
    )
    await until(client, `document.querySelectorAll('svg.spekui-graph text').length > 0 && document.body.innerText.includes('auth')`, 'the graph is drawn', 25_000)
    // The graph zooms to fit once its layout settles (a transition to a scale other than 1).
    await until(
      client,
      `[...document.querySelectorAll('svg.spekui-graph g[transform]')].some((g) => /scale\\((?!1\\))/.test(g.getAttribute('transform')))`,
      'the graph zooms to fit',
      30_000,
    )
    await sleep(1000) // the zoom's transition
    await capture(client, language, 'graph', manifest)
  },

  /**
   * A session that handed work to two others — one in another repository, done and reported, one in
   * its own — with the handoff brief of the finished one open.
   */
  async handoff(client, language, manifest, profile) {
    const say = HANDOFFS[language]
    await selectRepo(client, 'api-server')
    await newSession(client, language, 'claude')
    const parent = await awaitNewOutbox(profile, [], 'the first session gets an outbox')
    deliver(join(outboxRoot(profile), parent), 'usage-page', { target: 'web-app', title: say.cross.title, body: say.cross.body })
    const cross = await awaitNewOutbox(profile, [parent], 'the web-app session is opened')
    deliver(join(outboxRoot(profile), parent), 'redis-test', { target: 'api-server', title: say.same.title, body: say.same.body })
    await awaitNewOutbox(profile, [parent, cross], 'the second api-server session is opened')
    deliver(join(outboxRoot(profile), cross), 'report', { kind: 'report', summary: say.cross.report })
    const done = copyIn(language, 'handoffLifecycle.done')
    await until(client, `!!document.querySelector('[role="img"][aria-label="${done}"]')`, 'the web-app session shows done', 25_000)
    // Back to the first session, read as a conversation, with its handoff marks on the rail.
    await until(
      client,
      `(() => {
        const tab = [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent.includes('claude 1'))
        if (!tab) return false
        tab.click()
        return tab.getAttribute('aria-selected') === 'true'
      })()`,
      'focus the first session',
    )
    await until(client, clickByLabel(labelIn(language, 'conversation.showConversation')), 'switch to the conversation view', 25_000)
    await until(client, `document.body.innerText.includes('X-RateLimit-Remaining')`, 'the transcript reaches the view', 25_000)
    await openChange(client, 'Tasks')
    // The brief of the web-app session — the last one on the rail, below api-server's.
    const rail = `aside[aria-label="${copyIn(language, 'rail.label')}"]`
    await until(
      client,
      `(() => {
        const buttons = document.querySelectorAll('${rail} ${labelIn(language, 'handoffBrief.open')}')
        if (buttons.length < 2) return false
        buttons[buttons.length - 1].click()
        return true
      })()`,
      'open the web-app handoff brief',
      15_000,
    )
    await until(client, `document.body.innerText.includes(${JSON.stringify(say.cross.report)})`, 'the brief shows the report', 15_000)
    await capture(client, language, 'handoff', manifest)
  },
}

// ── spek ───────────────────────────────────────────────────────────────────────────────────────────
//
// spek's screenshots (design D7 of `spek-on-the-website`): spek's own static-page builder — the one its
// GitHub Action runs — against the api-server fixture, from a spek checkout that is clean and at a release
// tag, shown in a bare Electron window. spek's interface has one language, so these are written once, to
// `neutral/`. The static page's header reads "demo", not the repository name, so each shot names the
// fixture text it must show.

const SPEK_DIR = process.env.SPEK_DIR ?? join(root, '..', 'spek')
const NEUTRAL = 'neutral'
const SPEK_FONT = 'Plus Jakarta Sans'

function spekGit(...args) {
  return spawnSync('git', ['-C', SPEK_DIR, ...args], { encoding: 'utf8' })
}

/** The checkout's release tag, or why it is not usable. */
function spekRelease() {
  if (!existsSync(join(SPEK_DIR, 'scripts', 'build-demo.ts'))) return { problem: `no spek checkout at ${SPEK_DIR} (set SPEK_DIR)` }
  const dirty = spekGit('status', '--porcelain', '--untracked-files=normal').stdout.trim()
  if (dirty) return { problem: `the spek checkout at ${SPEK_DIR} has uncommitted changes` }
  // HEAD also carries core-v…, ui-v… and the moving v1; `git describe --exact-match` returns one of those.
  const release = spekGit('tag', '--points-at', 'HEAD', '--list', 'v*')
    .stdout.split('\n')
    .map((tag) => tag.trim())
    .find((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
  if (!release) return { problem: `the spek checkout at ${SPEK_DIR} is not at a release tag (v<major>.<minor>.<patch>)` }
  return { release }
}

function run(command, args, options, label) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.status !== 0) throw new Error(`${label} failed:\n${result.stdout}\n${result.stderr}`)
}

/** Build spek's core and ui in the checkout (their dist/ are git-ignored), then the static page. */
function buildSpekPage(out) {
  const env = fixtureEnv()
  env.PATH = [join(SPEK_DIR, 'node_modules', '.bin'), env.PATH].join(':')
  run('npm', ['run', 'build:core'], { cwd: SPEK_DIR, env }, 'spek build:core')
  run('npm', ['run', 'build:ui'], { cwd: SPEK_DIR, env }, 'spek build:ui')
  // The checkout's own tsx, not `npx` — npx's update notifier contacts the npm registry.
  run(
    join(SPEK_DIR, 'node_modules', '.bin', 'tsx'),
    ['scripts/build-demo.ts', '--repo-dir', REPOS.api, '--output', out, '--title', 'spek'],
    { cwd: SPEK_DIR, env: { ...env, NODE_ENV: 'production' } },
    'spek build-demo',
  )
}

const SPEK_SHOTS = {
  'spek-dashboard': { route: '#/', shows: 'add rate limiting' },
  // The change's artifact tabs are ordered by file time unless chosen; the shot chooses Specs.
  'spek-change': { route: '#/changes/add-rate-limiting', tab: 'Specs', shows: 'Each key has a request budget' },
  'spek-timeline': { route: '#/timeline', shows: 'sign-webhooks', crop: true },
}

async function captureSpek(client, name, { route, tab, shows, crop }, manifest) {
  // The router reads the hash once it has mounted; a hash set before that is overwritten.
  await until(client, `document.body?.innerText.includes('Overview') === true`, `${name}: the spek page has mounted`, 20_000)
  await client.evaluate(`location.hash = ${JSON.stringify(route)}`)
  if (tab) {
    await until(
      client,
      `(() => {
        const button = [...document.querySelectorAll('main button, main [role="tab"]')].find((el) => el.textContent.trim() === ${JSON.stringify(tab)})
        if (!button) return false
        button.click()
        return true
      })()`,
      `${name}: choose the ${tab} tab`,
    )
  }
  try {
    await until(client, `document.body.innerText.includes(${JSON.stringify(shows)})`, `${name}: the page shows ${shows}`, 20_000)
  } catch (error) {
    const seen = await client.evaluate(`location.href + ' :: ' + document.body.innerText.slice(0, 300)`)
    throw new Error(`${error.message} (the window shows: ${seen})`, { cause: error })
  }
  // Offline the page silently falls back to another font; a screenshot of that is not spek.
  await until(
    client,
    `(async () => { await document.fonts.ready; return [...document.fonts].some((f) => f.family.includes(${JSON.stringify(SPEK_FONT)}) && f.status === 'loaded') })()`,
    `${name}: ${SPEK_FONT} loaded`,
    20_000,
  )
  const problem = screenVerdict(await client.evaluate(SCREEN_TEXT), { fixtureName: shows })
  if (problem) throw new Error(`${name}: ${problem}`)
  await sleep(400)
  // A view whose content ends well above the window's bottom edge keeps the window down to it.
  const bottom = crop
    ? await client.evaluate(`Math.max(...[...document.querySelectorAll('main *')].map((el) => el.getBoundingClientRect().bottom))`)
    : VIEWPORT.height
  const height = Math.min(Math.ceil(bottom) + 32, VIEWPORT.height)
  const { data } = await client.send('Page.captureScreenshot', {
    format: 'png',
    ...(height < VIEWPORT.height ? { clip: { x: 0, y: 0, width: VIEWPORT.width, height, scale: 1 } } : {}),
  })
  const bytes = Buffer.from(data, 'base64')
  const file = join(OUT_DIR, NEUTRAL, `${name}.png`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, bytes)
  manifest[relative(OUT_DIR, file)] = createHash('sha256').update(bytes).digest('hex')
  console.log(`  ✓ ${relative(root, file)}`)
}

async function shootSpek(manifest, only) {
  const wanted = Object.entries(SPEK_SHOTS).filter(([name]) => !only || only === name)
  if (wanted.length === 0) return true
  const { release, problem } = spekRelease()
  if (problem) {
    console.error(`  ✗ spek shots: ${problem}`)
    return false
  }
  const page = join(SHOTS_ROOT, 'spek', 'spek.html')
  mkdirSync(dirname(page), { recursive: true })
  buildSpekPage(page)
  const child = spawn(
    join(root, 'node_modules', '.bin', 'electron'),
    [`--remote-debugging-port=${PORT}`, `--user-data-dir=${join(SHOTS_ROOT, 'profiles', 'spek')}`, ...electronExtraArgs(), join(root, 'scripts', 'lib', 'static-page-window.mjs'), page],
    { cwd: root, stdio: 'ignore', env: fixtureEnv() },
  )
  let ok = true
  const client = await connectToApp(PORT, { targetTimeoutMs: 30_000 })
  try {
    await client.send('Emulation.setDeviceMetricsOverride', { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 2, mobile: false })
    // spek's default theme is dark (its README); it follows the system preference when nothing is stored.
    await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
    await client.evaluate('location.reload()') // the theme is chosen once, at load
    for (const [name, shot] of wanted) {
      try {
        await captureSpek(client, name, shot, manifest)
      } catch (error) {
        ok = false
        console.error(`  ✗ ${name}: ${error.message}`)
      }
    }
  } finally {
    client.close()
    await quitAndWait(child)
  }
  // Which spek release the screenshots show — beside them, not in the manifest (its keys are images).
  if (ok) writeFileSync(join(OUT_DIR, NEUTRAL, 'SOURCE'), `${release}\n`)
  return ok
}

// ── Main ───────────────────────────────────────────────────────────────────────────────────────────

const onlyIndex = process.argv.indexOf('--only')
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : null

prepareFixtures()
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {}
let failed = false

for (const language of LANGUAGES) {
  for (const [name, shoot] of Object.entries(SHOTS)) {
    if (only && only !== name) continue
    const profile = join(SHOTS_ROOT, 'profiles', `${language}-${name}`)
    seedProfile(profile, language)
    if (name === 'inbox') dropInboxItems(profile, language)
    const stub = makeStubAgent(() => HOME, CONFIG_DIR, { transcriptFixture: join(SHOTS_ROOT, `transcript.${language}.jsonl`) })
    const app = await launch(profile, stub, language)
    try {
      await shoot(app.client, language, manifest, profile)
    } catch (error) {
      failed = true
      console.error(`  ✗ ${language}/${name}: ${error.message}`)
    } finally {
      app.client.close()
      await quitAndWait(app.child)
    }
  }
}

if (!only || only.startsWith('spek-')) {
  if (!(await shootSpek(manifest, only))) failed = true
}

const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => (a < b ? -1 : 1)))
writeFileSync(MANIFEST, `${JSON.stringify(sorted, null, 2)}\n`)
process.exit(failed ? 1 : 0)
