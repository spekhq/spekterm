/**
 * agent-intake / intake-routing 的驗收。
 *
 * ## 這支探針存在的理由，是一條跨行程的斷言
 *
 * 「交給 agent 的內容**逐字元等於**呈現給使用者的內容」是這條管線人類閘門的另一半，而它
 * **在主行程裡驗不到** —— 一個比對兩個純函式的單元測試看不見呈現那一端（它根本不在場），
 * 也看不見「正規化被搬到呈現層」這個最自然的實作錯誤。
 *
 * 唯一看得見它的載體是：從**畫面上**取那一列的 `textContent`（不是 `innerText` —— 它會套用
 * `text-transform` 並壓縮空白，本 repo 踩過），從**磁碟上**讀 context 檔，兩者比對相等。
 *
 * ## 第二條只有這裡驗得到的事
 *
 * 「預填不早於就緒」的兩端都由**檔案**界定：替身在 fire `SessionStart` 之前先等一段，並在
 * fire 的當下寫下 receipt。於是「就緒之前」是一個真實存在、可以持續輪詢的區間 ——
 * **而不是一次取樣**（那量到的是「錯誤的寫入有沒有搶在我這次取樣之前」，是時序不是行為）。
 *
 * 而「寫入」只有位元組收據看得見：預填**刻意不附送出字元**，canonical 模式下那些位元組不會
 * 被交出來，`agent-input.log` 恆為空 —— 對正確實作與錯誤實作**一樣**。
 */
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { check, connectToApp, pollFor } from './lib/cdp.mjs'
import { copy, label } from './lib/copy.mjs'
import { retryAction } from './lib/instrument.mjs'
import { awaitMounted } from './lib/mounted.mjs'
import { electronExtraArgs } from './lib/display.mjs'
import { runSections } from './lib/sections.mjs'
import { PROBE_PORTS } from './lib/ports.mjs'
import { ptyPids, ptySessionPids } from './lib/pty-pids.mjs'
import { makeStubAgent } from './lib/stub-agent.mjs'

const PORT = PROBE_PORTS.intake.main
const RESTART_PORT = PROBE_PORTS.intake.restart

const results = []
const temps = []

function mkTemp(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  temps.push(dir)
  return dir
}

/** 三個 folder —— rail 選第三個、規則指第二個、fallback 指第一個。見 `runRouting`。 */
function seedProfile() {
  const profile = mkTemp('spekterm-intake-profile-')
  const folders = ['one', 'two', 'three'].map((name, index) => {
    const repo = mkTemp(`spekterm-intake-repo-${name}-`)
    mkdirSync(join(repo, 'openspec'), { recursive: true })
    // `name` ＝ rail 上呈現的名字（主行程取 basename），而卡片上呈現的正是它 ——
    // mkTemp 的隨機尾綴讓三個名字互不為子字串，斷言因此有鑑別力。
    return { id: `f${index + 1}`, path: repo, name: basename(repo), addedAt: '2026-09-11T00:00:00.000Z' }
  })
  writeFileSync(join(profile, 'workspace.json'), JSON.stringify({ version: 1, folders }))
  return { profile, folders }
}

/** routing 規則 —— 直接寫進本能力自己的檔案（它不住在 `preferences.json`）。 */
function seedRouting(profile, { rules = [], fallbackFolderId = null } = {}) {
  writeFileSync(
    join(profile, 'intake-routing.json'),
    JSON.stringify({ version: 1, rules, fallbackFolderId }),
  )
}

function inboxOf(profile) {
  return join(profile, 'intake-inbox')
}

/** 投遞 —— **先寫暫存再更名**，與 producer 的契約相同。 */
function drop(profile, name, payload) {
  const inbox = inboxOf(profile)
  mkdirSync(inbox, { recursive: true })
  const target = join(inbox, `${name}.json`)
  writeFileSync(`${target}.tmp`, JSON.stringify(payload))
  renameSync(`${target}.tmp`, target)
  return target
}

function intake({ id = 'a1', title = 'a title', body = 'a body', originId = 'C1', actor = 'someone' } = {}) {
  return { id, origin: { kind: 'slack', id: originId, label: '#dev' }, title, body, actor }
}

async function launch({ profile, configDir, stub, port = PORT, marker }) {
  const child = spawn(
    'electron',
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...electronExtraArgs(), '.'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SHELL: '/bin/sh',
        CLAUDE_CONFIG_DIR: configDir,
        // **`HOME` 也要換掉。** agent 目標走 `$SHELL -l -c claude`，而 login shell 會 source
        // `~/.profile`，把**真** claude 搶回 PATH 前面。漏掉它的徵狀是「替身完全沒被執行」，
        // 而畫面上一切正常 —— 紅的是產品那側的斷言。這是第三支踩過這個坑的探針。
        HOME: stub.home,
        PATH: `${stub.bin}:${process.env.PATH}`,
        SPEK_PROBE_MARKER: marker,
      },
    },
  )
  let output = ''
  child.stderr?.on('data', (chunk) => (output += chunk))
  child.stdout?.on('data', (chunk) => (output += chunk))
  const client = await connectToApp(port, { targetTimeoutMs: 30_000 })
  await awaitMounted(client)
  return {
    client,
    output: () => output,
    async close() {
      try {
        await client.close()
      } catch {
        // 已經斷了就算了 —— 收屍才是重點。
      }
      child.kill()
      await new Promise((resolve) => setTimeout(resolve, 900))
    },
  }
}

/**
 * 起一個乾淨的 app —— **先把上一段的收掉**。
 *
 * `afterMode` 是**每個模式**跑一次，不是每個段落。少了這一步，第二段之後每次 `launch` 都會
 * 連到**還活著的前一個 app**（`connectToApp` 連的是先起來的那一個），於是「找不到那一列」
 * 的等待全部在一個不相干的 profile 上空轉 —— 而症狀看起來像產品沒有把 intake 讀進來。
 * 這是 `insights` 與 `agentView` 兩個 port 學到的同一件事，換一個形狀出現。
 */
async function freshApp(context, options) {
  if (context.app) {
    await context.app.close()
    context.app = null
  }
  const app = await launch(options)
  context.app = app
  return app
}

// ── 讀畫面的表達式 ──────────────────────────────────────────────────────────

// **選擇器一律自字典取字** —— `label()` 會把文案組成完整的屬性選擇器。
// 文案與選擇器若分離為兩份字面值，某一次改文案就會失去同步，而徵狀是「選不到元素」，
// 不是「斷言失敗」。（那道守衛走行掃描，所以這段註解裡也不能寫出該屬性的字面形式。）

/**
 * 點開收件匣，並回報**它是不是真的開了**。
 *
 * 第一版寫成 `querySelector(…)?.click(), true` —— **那是一個恆真的閘**：選不到按鈕時它照樣
 * 回 `true`，於是其後每一條「找不到那一列」的等待都在一個根本沒開的 overlay 上空轉。
 * 判準必須是**結果**（dialog 在不在），不是「我試著點了」。
 */
const OPEN_INBOX = `(() => {
  const dialog = document.querySelector('[role="dialog"]${label('intake.label')}')
  if (dialog) return true
  document.querySelector('${label('activityBar.handoffs')}')?.click()
  return !!document.querySelector('[role="dialog"]${label('intake.label')}')
})()`

async function openInbox(app) {
  return pollFor({
    read: () => app.client.evaluate(OPEN_INBOX),
    settled: (open) => open === true,
    timeoutMs: 15_000,
    label: '收件匣已開啟',
  })
}

function itemSelector(title) {
  return label('intake.itemLabel', { title })
}

/** 那一列的 `textContent` —— **不是 `innerText`**（見檔頭）。 */
function itemTextExpression(title) {
  return `document.querySelector(${JSON.stringify(itemSelector(title))})?.textContent ?? ''`
}

/** 那一列**子樹之內**的圖片與連結數 —— 作用域不可是整份文件。 */
function itemMediaExpression(title) {
  return `(() => {
    const row = document.querySelector(${JSON.stringify(itemSelector(title))})
    if (!row) return null
    return { images: row.querySelectorAll('img').length, links: row.querySelectorAll('a').length }
  })()`
}

function acceptExpression(title) {
  return `(() => {
    const row = document.querySelector(${JSON.stringify(itemSelector(title))})
    const button = row?.querySelector('${label('intake.accept')}')
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`
}

function dismissExpression(title) {
  return `(() => {
    const row = document.querySelector(${JSON.stringify(itemSelector(title))})
    const button = row?.querySelector('${label('intake.dismiss')}')
    if (!button) return false
    button.click()
    return true
  })()`
}

/**
 * 直接 seed 落盤的收件匣狀態。
 *
 * **「帶著待處理項目啟動」這個前提只能這樣造。** 在落點放檔案造出來的是**到達**，
 * 而到達是會通知的 —— 那正好是相反的前提（見 `runNotifyBackfill`）。
 *
 * 另注意：`CAPACITY` 與 `MALFORMED` 的投遞檔刻意不被消費，它們在下次啟動會重新 deliver
 * ⇒ 那是一次合法的新到達。seed 時不要在落點留下任何東西。
 */
function seedStore(profile, items) {
  const entries = items.map((item) => ({
    adapter: 'file',
    id: item.id,
    state: 'pending',
    digest: `seed-${item.id}`,
    content: {
      verified: { adapter: 'file', originKind: 'slack', originId: 'C1' },
      authored: {
        title: item.title,
        body: item.body ?? 'seeded body',
        actor: item.actor ?? 'someone',
        originLabel: '#dev',
      },
      receivedAt: 1_700_000_000_000,
    },
  }))
  writeFileSync(join(profile, 'intake.json'), JSON.stringify({ version: 1, entries }))
}

/** 替身通知後端的落點 —— 與主行程的 `stubNotifyRoot()` 同一個推導。 */
function notifyRoot(profile) {
  return join(profile, 'notify-stub')
}

function notifications(profile) {
  const file = join(notifyRoot(profile), 'notifications.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

function receipts(profile) {
  const file = join(notifyRoot(profile), 'receipts.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean)
}

/** 模擬一次「使用者觸發了通知」。 */
function fireNotification(profile, nth) {
  const root = notifyRoot(profile)
  mkdirSync(root, { recursive: true })
  // 同一個路徑寫第二次只會 emit `change`，替身兩種事件都訂了。
  writeFileSync(join(root, 'trigger'), String(nth))
}

/** 合併窗 + 一點餘裕。產品的窗是秒級的，探針**真的等** —— 少一個注入點就少一條會分岔的路。 */
const WINDOW_WAIT_MS = 6000

/** 入口上的計數標示 —— **由入口的標籤定位到按鈕，再讀它子樹內的標示**。 */
const BADGE_TEXT = `(() => {
  const button = document.querySelector('${label('activityBar.handoffs')}')
  if (!button) return null
  const badge = button.querySelector('[role="status"]')
  return badge ? badge.textContent : ''
})()`

/** 入口按鈕自己的尺寸 —— **不是 nav 的寬度**（那是寫死的，量它恆真）。 */
const HANDOFFS_RECT = `(() => {
  const button = document.querySelector('${label('activityBar.handoffs')}')
  if (!button) return null
  const rect = button.getBoundingClientRect()
  const badge = button.querySelector('[role="status"]')
  return { w: Math.round(rect.width), h: Math.round(rect.height), badge: badge ? badge.textContent : null }
})()`

/** 活動列的入口列舉 —— 與 `probe:workspace` 的同一個形狀。 */
const ACTIVITY_ENTRIES = `document.querySelectorAll('nav${label('activityBar.label')} button').length`

const ACTIVE_LABEL = `document.activeElement ? (document.activeElement.getAttribute('aria-label') ?? document.activeElement.tagName) : null`

/**
 * 收件匣 overlay 的分頁**沒有無障礙標籤**（它們的名字來自文字節點），所以要以文字定位。
 * 照既有紀律，那段文字仍然自字典取得。
 */
function tabClick(keyPath) {
  return `(() => {
    const list = document.querySelector('[role="tablist"]${label('intake.label')}')
    const tab = [...(list?.querySelectorAll('[role="tab"]') ?? [])]
      .find((candidate) => candidate.textContent === ${JSON.stringify(copy(keyPath))})
    if (!tab) return false
    tab.click()
    return true
  })()`
}

function tabFocus(keyPath) {
  return `(() => {
    const list = document.querySelector('[role="tablist"]${label('intake.label')}')
    const tab = [...(list?.querySelectorAll('[role="tab"]') ?? [])]
      .find((candidate) => candidate.textContent === ${JSON.stringify(copy(keyPath))})
    if (!tab) return false
    tab.focus()
    return document.activeElement === tab
  })()`
}

/** 斷言失敗時，光看數字看不出是誰 —— 把候選行程的樣子印出來。 */
function diagnoseProcesses(marker) {
  const rows = []
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const cmdline = readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0').filter(Boolean)
      if (!cmdline.join(' ').includes('claude')) continue
      const environ = readFileSync(`/proc/${entry}/environ`, 'utf8')
      rows.push(`${cmdline.slice(0, 3).join(' ')}｜marker=${environ.includes(marker)}`)
    } catch {
      // 行程結束了
    }
  }
  return rows.slice(0, 4).join(' ；') || '(沒有 claude 行程)'
}

// ── 段落 ────────────────────────────────────────────────────────────────────

/**
 * 兩條入口 —— 啟動掃描與監看。
 *
 * 第一段先以**已知的數值**釘住「讀到的是 fixture 而非開發者本機的真實收件匣」：
 * 少了它，`--user-data-dir` 沒傳進去時每一條存在性斷言照樣全綠。
 */
async function runIngest(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  // 啟動**之前**投遞 —— 只有掃描看得到它（`ignoreInitial: true` 寫死於 `watcher.ts`）。
  drop(profile, 'before', intake({ id: 'before-1', title: 'BEFORE-TITLE' }))

  const app = await freshApp(context, { profile, configDir, stub, marker })

  await openInbox(app)

  /**
   * 活動列 —— `workspace-layout` 的 delta。
   *
   * Handoffs 從停用轉為已實作；Search 仍是停用的 placeholder。**兩者一起驗**：
   * 只驗「Handoffs 是亮的」的話，一個把整排都打開的實作照樣通過。
   */
  const entries = await pollFor({
    read: () =>
      app.client.evaluate(`(() => {
        const pick = (sel) => {
          const el = document.querySelector(sel)
          return el ? { disabled: !!el.disabled } : null
        }
        return {
          handoffs: pick('${label('activityBar.handoffs')}'),
          search: pick('${label('activityBar.search')}'),
          sessions: pick('${label('activityBar.sessions')}'),
        }
      })()`),
    settled: (value) => value?.handoffs != null,
    timeoutMs: 15_000,
    label: '活動列已呈現',
  })
  check(results, 'Handoffs 入口為可用狀態', entries.handoffs?.disabled === false, JSON.stringify(entries.handoffs))
  check(results, '尚未實作的入口（Search）仍為停用', entries.search?.disabled === true, JSON.stringify(entries.search))
  check(results, 'Sessions 入口仍為可用', entries.sessions?.disabled === false, JSON.stringify(entries.sessions))

  const sidePanelExpression = `document.querySelector('[role="tablist"]${label('panelSwitch.label')}')?.textContent ?? ''`
  const sidePanelBefore = await app.client.evaluate(sidePanelExpression)

  const before = await pollFor({
    read: () => app.client.evaluate(itemTextExpression('BEFORE-TITLE')),
    settled: (text) => text.includes('BEFORE-TITLE'),
    timeoutMs: 15_000,
    label: '啟動前投遞的 intake 出現',
  })
  check(results, '前置：讀到的是 fixture 的收件匣（已知的標題）', before.includes('BEFORE-TITLE'), before.slice(0, 60))
  check(results, '應用程式未執行時投遞的 intake 於啟動後進入收件匣', true, 'BEFORE-TITLE')

  // 啟動**之後**投遞 —— 由監看接手。
  drop(profile, 'after', intake({ id: 'after-1', title: 'AFTER-TITLE' }))
  const after = await pollFor({
    read: () => app.client.evaluate(itemTextExpression('AFTER-TITLE')),
    settled: (text) => text.includes('AFTER-TITLE'),
    timeoutMs: 15_000,
    label: '啟動後投遞的 intake 出現',
  })
  check(results, '啟動後才投遞的 intake 由監看接手', after.includes('AFTER-TITLE'))

  // **落點被消費掉** —— 兩條入口都走同一條處理路徑。
  const leftovers = readdirSync(inboxOf(profile))
  check(results, '採納之後投遞檔被消費', leftovers.length === 0, `落點剩下：${JSON.stringify(leftovers)}`)

  // 收件匣是 overlay，**不是側欄的第三個身分** —— 側欄的身分不因它而改變。
  const sidePanelAfter = await app.client.evaluate(sidePanelExpression)
  check(results, '開啟收件匣不改變側欄的身分', sidePanelAfter === sidePanelBefore, `前=${sidePanelBefore} 後=${sidePanelAfter}`)
}

/**
 * 本文以純文字呈現。
 *
 * **正面的錨在前**：那一列的文字裡要**含有語法的字面形式** —— 否則「沒有 img／a」對一個
 * 根本沒渲染出那一列的實作也成立。而作用域是**該列的子樹**，不是整份文件：後者會在 app
 * 別處出現任何一個 `<a>` 時為了無關的理由變紅，然後被放寬。
 */
async function runPlainText(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  const SYNTAX = '![pixel](https://attacker.example/x.png) and [a link](https://evil.example)'
  drop(profile, 'markdownish', intake({ id: 'md-1', title: 'MARKDOWN-TITLE', body: SYNTAX }))

  const app = await freshApp(context, { profile, configDir, stub, marker })
  await openInbox(app)

  const text = await pollFor({
    read: () => app.client.evaluate(itemTextExpression('MARKDOWN-TITLE')),
    settled: (value) => value.includes('MARKDOWN-TITLE'),
    timeoutMs: 15_000,
    label: '該列已呈現',
  })
  check(results, '本文中的標記語法以字面文字呈現（正面的錨）', text.includes(SYNTAX), text.slice(0, 90))

  const media = await pollFor({
    read: () => app.client.evaluate(itemMediaExpression('MARKDOWN-TITLE')),
    settled: (value) => value !== null,
    timeoutMs: 15_000,
    label: '該列的子樹可檢視',
  })
  check(
    results,
    '該列之內不存在圖片與可點的連結',
    media !== null && media.images === 0 && media.links === 0,
    media === null ? '選不到那一列' : `img=${media.images} a=${media.links}`,
  )
}

/**
 * 於 routing 解析出的 folder 建立，而不是選中的或第一個。
 *
 * **鑑別力全部來自 fixture 的形狀**：三個 folder、rail 選第三個、規則指第二個、
 * fallback 指第一個 —— 於是「用選中的」「用第一個」「用 fallback」三種錯誤實作各自都會紅。
 */
async function runRouting(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, {
    rules: [{ id: 'r1', criterion: 'originId', contains: 'CROUTE', folderId: folders[1].id }],
    fallbackFolderId: folders[0].id,
  })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  drop(profile, 'routed', intake({ id: 'routed-1', title: 'ROUTED-TITLE', originId: 'CROUTE' }))

  const app = await freshApp(context, { profile, configDir, stub, marker })
  await openInbox(app)

  const text = await pollFor({
    read: () => app.client.evaluate(itemTextExpression('ROUTED-TITLE')),
    settled: (value) => value.includes('ROUTED-TITLE'),
    timeoutMs: 15_000,
    label: '該列已呈現',
  })
  // 卡片上呈現的是**解析到的 folder，而且是它在 rail 上的名字**。斷言絕對值 —— 不是「有變」。
  //
  // **釘名字而不是識別碼**：識別碼對使用者不構成資訊，而「顯示識別碼」這個缺陷正是
  // 以釘識別碼的斷言放過去的 —— 改成顯示名字之後，原本那條否定斷言會變成恆真。
  check(
    results,
    '接受之前看得到將開在哪個 folder（第二個，不是選中的或第一個）',
    text.includes(`Opens in ${folders[1].name}`),
    text.slice(0, 120),
  )
  check(
    results,
    '不是 fallback 指向的那一個',
    !text.includes(`Opens in ${folders[0].name}`),
    text.slice(0, 120),
  )
  // 識別碼不得外洩到那一列上 —— 它既不是資訊，也是路徑以外的第二種位置指認。
  check(results, '呈現的不是 folder 識別碼', !text.includes(`Opens in ${folders[1].id}`), text.slice(0, 120))
}

/**
 * 接受 → 預填 —— 本 change 最會靜默失效的一段。
 *
 * 三條斷言，判準的兩端都由**檔案**界定：
 *
 * 1. **就緒之前的整段期間**收據為空（持續輪詢，不是一次取樣）；同段落先確認 pty 已存在，
 *    否則「沒寫入」只是因為根本沒有東西。
 * 2. 就緒之後收據含 prompt，**且其後不含送出字元或換行**。
 * 3. **呈現與交付是同一份文字** —— 畫面上那一列的文字 vs 磁碟上 context 檔界線之內的內容。
 */
async function runAcceptPrefill(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  // **可控的就緒延遲** —— 少了它，ready 在 pty 誕生後數毫秒就到，
  // 而「不等待就緒即寫入」的錯誤實作與正確實作落在同一個不可分辨的瞬間。
  const stub = makeStubAgent(mkTemp, configDir, { readyDelaySeconds: 4, announceTitle: 'STUB-DECLARED-TITLE' })

  const BODY = 'first line\nsecond line with  spaces'
  drop(profile, 'prefill', intake({ id: 'prefill-1', title: 'PREFILL-TITLE', body: BODY }))

  const app = await freshApp(context, { profile, configDir, stub, marker })
  await openInbox(app)
  const shown = await pollFor({
    read: () => app.client.evaluate(itemTextExpression('PREFILL-TITLE')),
    settled: (value) => value.includes('PREFILL-TITLE'),
    timeoutMs: 15_000,
    label: '該列已呈現',
  })

  await pollFor({
    read: () => app.client.evaluate(acceptExpression('PREFILL-TITLE')),
    settled: Boolean,
    timeoutMs: 15_000,
    label: '按下接受',
  })

  // pty 必須真的存在 —— 否則「收據為空」只是因為什麼都還沒發生。
  await pollFor({
    read: () => ptySessionPids(marker).length,
    settled: (count) => count >= 1,
    timeoutMs: 20_000,
    label: 'pty 已建立',
  })

  // **整段期間**為空，而不是某一次取樣為空。
  /**
   * 等到替身宣告就緒 —— **或**在那之前就看到位元組（那就是提早寫入）。
   *
   * **上界不可省**：替身若從未啟動，`ready()` 永遠是 false，而沒有上界的迴圈會把整個段落
   * 拖到逾時，**真正的失敗（session 沒建起來）被那個逾時蓋掉**（實測踩過）。
   */
  const beforeReady = await pollFor({
    read: () => ({ ready: stub.ready(), bytes: stub.bytes() }),
    settled: (state) => state.ready || state.bytes.length > 0,
    timeoutMs: 20_000,
    interval: 50,
    label: '替身宣告就緒（或在那之前收到位元組）',
  })
  const dirtyBeforeReady = beforeReady.ready ? '' : beforeReady.bytes
  check(results, '前置：替身確實宣告了就緒（否則下一條什麼都沒測到）', beforeReady.ready === true)
  /**
   * **這條由對照組釘住**（`scripts/intake-control-groups.mjs` 的 `prefill-no-wait`）：
   * 把觸發改成「pty 建立完成之後、不等待就緒即寫入」時它會紅，收據裡提前出現那行 prompt。
   *
   * > 它一度紅不起來，而原因**不在這條斷言**：替身當時把讀取迴圈放在背景、且一次空讀就退出，
   * > 於是提早寫入的位元組根本沒有人讀。**差點據此把一條有效的斷言降級成「留著當回歸」** ——
   * > 對照組沒有變紅時，第一個要問的是「觀測管道還活著嗎」，不是「這條斷言沒有鑑別力」。
   */
  check(
    results,
    '就緒之前的整段期間未向該 session 寫入任何內容',
    dirtyBeforeReady === '',
    dirtyBeforeReady === '' ? '收據全程為空' : `提前收到：${JSON.stringify(dirtyBeforeReady.slice(0, 60))}`,
  )

  const received = await pollFor({
    read: () => stub.bytes(),
    settled: () => stub.bytes().includes('.md'),
    timeoutMs: 25_000,
    label: '就緒之後 prompt 抵達 pty',
  }).catch(() => stub.bytes())

  const bytes = stub.bytes()
  check(results, '就緒之後 prompt 填入 agent 的輸入處', bytes.length > 0 && bytes.includes('.md'), bytes.slice(0, 80))
  check(
    results,
    '填入的內容之後不含送出字元或換行（它尚未被送出）',
    !/[\r\n]/.test(bytes),
    JSON.stringify(bytes.slice(-30)),
  )
  check(results, '該 prompt 未進入 agent 的紀錄（沒有被送出）', stub.input() === '', JSON.stringify(stub.input()))
  void received

  // **跨行程的那一條** —— 畫面上的文字 vs 磁碟上的檔案。
  const contextDir = join(profile, 'intake')
  const contextFile = readdirSync(contextDir).find((name) => name.endsWith('.md'))
  const contents = contextFile ? readFileSync(join(contextDir, contextFile), 'utf8') : ''
  const fenced = contents.match(/<<<untrusted-[0-9a-f]+>>>\n([\s\S]*)\n<<<\/untrusted-[0-9a-f]+>>>/)?.[1] ?? null
  check(results, '交給 agent 的檔案確實產生且帶界線', fenced !== null, contextFile ?? '(無)')
  /**
   * **系統不代為指定 session 名稱。**
   *
   * 指定名稱在既有能力中＝「使用者永久接管命名權」，此後 agent 依任務產生的標題會被靜默地
   * 不予呈現。斷言維持**正面形式**（標籤最終等於替身宣告的那個），不可改寫成「標籤不是
   * intake 的標題」那種恆真式。OSC 標題比 session 晚到，因此是輪詢而非一次取樣。
   */
  const labelText = await pollFor({
    read: () => app.client.evaluate('document.body.textContent ?? \'\''),
    settled: (text) => text.includes('STUB-DECLARED-TITLE'),
    timeoutMs: 20_000,
    label: 'agent 宣告的標題出現在分頁上',
  }).catch(() => '')
  check(
    results,
    'session 的名稱未被系統指定（agent 宣告的標題呈現得出來）',
    labelText.includes('STUB-DECLARED-TITLE'),
    labelText.includes('PREFILL-TITLE') ? '標籤被 intake 的標題佔住了' : labelText.slice(0, 60),
  )

  check(
    results,
    '交給 agent 的內容逐字元等於呈現給使用者的本文',
    fenced !== null && shown.includes(fenced),
    fenced === null ? '(無界線)' : `檔案內＝${JSON.stringify(fenced.slice(0, 60))}`,
  )
}

/**
 * 忽略不建立 session。
 *
 * **絕對的 session 計數，而且是 session 不是行程**（一個 claude session 是兩個帶 marker 的
 * 行程）。且**同段落先驗一次接受確實建得出 session** —— 否則「沒有新增」對一個接受鈕根本
 * 沒接上的實作同樣成立。
 */
async function runDismiss(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  drop(profile, 'keep', intake({ id: 'keep-1', title: 'ACCEPT-ME' }))
  drop(profile, 'drop', intake({ id: 'drop-1', title: 'DISMISS-ME' }))

  const app = await freshApp(context, { profile, configDir, stub, marker })
  await openInbox(app)
  await pollFor({
    read: () => app.client.evaluate(itemTextExpression('ACCEPT-ME')),
    settled: (value) => value.includes('ACCEPT-ME'),
    timeoutMs: 15_000,
    label: '兩則都已呈現',
  })

  const baseline = ptySessionPids(marker).length
  await pollFor({
    read: () => app.client.evaluate(acceptExpression('ACCEPT-ME')),
    settled: Boolean,
    timeoutMs: 15_000,
    label: '接受',
  })
  await pollFor({
    read: () => ptySessionPids(marker).length,
    settled: (count) => count === baseline + 1,
    timeoutMs: 20_000,
    label: '接受確實建立了一個 session',
  })
  const diagnosis = await app.client.evaluate('document.body.textContent ?? \'\'')
  check(
    results,
    '前置：接受確實建得出 session（否定斷言的對照）',
    ptySessionPids(marker).length === baseline + 1,
    ptySessionPids(marker).length === baseline + 1
      ? ''
      : `pty=${ptyPids(marker).length} session=${ptySessionPids(marker).length} | ${diagnoseProcesses(marker)}`,
  )

  const afterAccept = ptySessionPids(marker).length
  await openInbox(app)
  await pollFor({
    read: () => app.client.evaluate(dismissExpression('DISMISS-ME')),
    settled: Boolean,
    timeoutMs: 15_000,
    label: '忽略',
  })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  check(
    results,
    '忽略不建立任何 session（session 總數不變）',
    ptySessionPids(marker).length === afterAccept,
    `忽略前 ${afterAccept}，忽略後 ${ptySessionPids(marker).length}`,
  )
}

/**
 * 活動列上的計數 —— **本段從頭到尾不打開收件匣，直到最後一條**。
 *
 * 第一條是這一段存在的主要理由：主行程的收件者集合是在 renderer 第一次呼叫 `list()` 時
 * 才註冊的，而在常駐的 provider 出現之前那只發生在 overlay 掛載時 —— 也就是**一個從來
 * 沒有被打開過的收件匣，其變化不會推給任何人**。順序不能動：一旦打開過，這條就失去前提。
 */
async function runBadge(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  // **刻意不設 fallback**：本段要有一則 routing 解析不出來的項目，而設了 fallback 之後
  // 每一則都解析得出來 —— 那條「仍計入」的斷言就沒有被驗到的機會。
  seedRouting(profile, {
    rules: [{ id: 'r1', criterion: 'originId', contains: 'C1', folderId: folders[0].id }],
  })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  const app = await freshApp(context, { profile, configDir, stub, marker })

  const emptyRect = await app.client.evaluate(HANDOFFS_RECT)
  check(results, '前置：沒有待處理項目時不存在計數標示', emptyRect?.badge === null, JSON.stringify(emptyRect))

  drop(profile, 'b1', intake({ id: 'badge-1', title: 'BADGE-ONE' }))
  const one = await pollFor({
    read: () => app.client.evaluate(BADGE_TEXT),
    settled: (text) => text === '1',
    timeoutMs: 15_000,
    label: '計數變成 1',
  })
  check(results, '從未打開過收件匣時仍呈現計數', one === '1', `得到 ${JSON.stringify(one)}`)

  drop(profile, 'b2', intake({ id: 'badge-2', title: 'BADGE-TWO' }))
  drop(profile, 'b3', intake({ id: 'badge-3', title: 'BADGE-THREE', originId: 'CNOPE' }))
  const three = await pollFor({
    read: () => app.client.evaluate(BADGE_TEXT),
    settled: (text) => text === '3',
    timeoutMs: 15_000,
    label: '計數變成 3',
  })
  check(results, '計數等於待處理的則數', three === '3', `得到 ${JSON.stringify(three)}`)

  // **尺寸不變。** 量的是入口按鈕，不是活動列 —— 後者是寫死的寬度，量它恆真。
  const withBadge = await app.client.evaluate(HANDOFFS_RECT)
  check(
    results,
    '帶計數時入口本身的尺寸不變（且量測時標示確實存在）',
    withBadge?.badge === '3' && withBadge.w === emptyRect?.w && withBadge.h === emptyRect?.h,
    `空 ${JSON.stringify(emptyRect)}｜帶計數 ${JSON.stringify(withBadge)}`,
  )
  check(
    results,
    '入口的無障礙標籤不因計數而改變',
    (await app.client.evaluate(
      `document.querySelector('${label('activityBar.handoffs')}')?.getAttribute('aria-label') ?? null`,
    )) === copy('activityBar.handoffs'),
    '以入口的標籤定位得到它，且標籤與不帶計數時逐字元相同（本段每一次定位都倚賴這件事）',
  )
  check(
    results,
    '計數標示不使入口的列舉多出一項',
    (await app.client.evaluate(ACTIVITY_ENTRIES)) === 5,
    `得到 ${await app.client.evaluate(ACTIVITY_ENTRIES)}`,
  )

  // routing 解析不出來的那一則也計入 —— 打開收件匣確認它確實是「解析不出來」的那種。
  await openInbox(app)
  const rows = await pollFor({
    read: () =>
      app.client.evaluate(
        `document.querySelectorAll('[role="dialog"]${label('intake.label')} li').length`,
      ),
    settled: (count) => count === 3,
    timeoutMs: 15_000,
    label: '收件匣裡有三列',
  })
  check(results, '打開之後列出的待處理項目數與計數相同', rows === 3, `得到 ${rows}`)
  const unresolved = await app.client.evaluate(itemTextExpression('BADGE-THREE'))
  check(
    results,
    '前置：其中一則的 routing 確實解析不出來（否則「仍計入」沒有被驗到）',
    unresolved.includes(copy('intake.unresolved')),
    unresolved.slice(0, 120),
  )

  // 處理掉一則 ⇒ 計數減少；全部處理完 ⇒ 標示消失。
  await retryAction({
    act: () => app.client.evaluate(dismissExpression('BADGE-ONE')),
    read: () => app.client.evaluate(BADGE_TEXT),
    settled: (text) => text === '2',
    attemptWindowMs: 3000,
    timeoutMs: 15_000,
    label: '忽略一則',
  })
  check(results, '處理掉一則之後計數隨即減少', true, '2')

  for (const title of ['BADGE-TWO', 'BADGE-THREE']) {
    await retryAction({
      act: () => app.client.evaluate(dismissExpression(title)),
      read: () => app.client.evaluate(`!document.querySelector(${JSON.stringify(itemSelector(title))})`),
      settled: (gone) => gone === true,
      attemptWindowMs: 3000,
      timeoutMs: 15_000,
      label: `忽略 ${title}`,
    })
  }
  const gone = await pollFor({
    read: () => app.client.evaluate(BADGE_TEXT),
    settled: (text) => text === '',
    timeoutMs: 15_000,
    label: '標示消失',
  })
  check(results, '沒有待處理項目時不呈現計數標示（不是 0）', gone === '', `得到 ${JSON.stringify(gone)}`)
}

/** 計數跨重啟保留 —— **本探針的第一個重啟段落**（`RESTART_PORT` 保留已久但一直沒有被用到）。 */
async function runBadgeRestart(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  const first = await freshApp(context, { profile, configDir, stub, marker })
  drop(profile, 'r1', intake({ id: 'restart-1', title: 'RESTART-ONE' }))
  drop(profile, 'r2', intake({ id: 'restart-2', title: 'RESTART-TWO' }))
  await pollFor({
    read: () => first.client.evaluate(BADGE_TEXT),
    settled: (text) => text === '2',
    timeoutMs: 15_000,
    label: '前置：重啟之前計數是 2',
  })

  // 同一個 profile 重開。**計數來自非同步的 IPC，必須輪詢而不是量一次。**
  const second = await freshApp(context, { profile, configDir, stub, marker, port: RESTART_PORT })
  const after = await pollFor({
    read: () => second.client.evaluate(BADGE_TEXT),
    settled: (text) => text === '2',
    timeoutMs: 20_000,
    label: '重啟後計數仍是 2',
  })
  check(results, '計數跨重啟保留', after === '2', `得到 ${JSON.stringify(after)}`)
}

/**
 * 通知 —— **回補要通知，落盤中既有的不重新通知**。
 *
 * 這兩半在同一段裡，因為它們互為對方的錨：只驗後半的話，一個「啟動後一律靜默」的實作全綠，
 * 而那正好掏空這個能力最主要的使用情境（app 關著的期間被提及）。
 *
 * 兩半的**前提造法不同**：回補用落點放檔案（那是到達），既有的用直接 seed 落盤狀態
 * （在落點放檔案造出來的是到達，會通知）。
 */
async function runNotifyBackfill(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  // 落盤中已有三則待處理項目 —— 它們**不是**到達。
  seedStore(profile, [
    { id: 'seeded-1', title: 'SEEDED-ONE' },
    { id: 'seeded-2', title: 'SEEDED-TWO' },
    { id: 'seeded-3', title: 'SEEDED-THREE' },
  ])
  // 而落點裡有一份 app 沒執行時投遞的 —— 它**是**到達。
  drop(profile, 'backfill', intake({ id: 'backfill-1', title: 'BACKFILL-TITLE' }))

  const app = await freshApp(context, { profile, configDir, stub, marker })
  await pollFor({
    read: () => app.client.evaluate(BADGE_TEXT),
    settled: (text) => text === '4',
    timeoutMs: 20_000,
    label: '前置：三則既有 + 一則回補都進來了',
  })

  await new Promise((resolve) => setTimeout(resolve, WINDOW_WAIT_MS))
  const sent = notifications(profile)
  check(
    results,
    '關閉期間投遞的項目於啟動時進來仍然通知，而落盤中既有的不重新通知（恰一則）',
    sent.length === 1,
    `發出 ${sent.length} 則：${JSON.stringify(sent).slice(0, 200)}`,
  )
  check(
    results,
    '通知的標題不含投遞提供的任何值',
    sent.length === 1 && !sent[0].title.includes('BACKFILL-TITLE'),
    JSON.stringify(sent[0] ?? null),
  )
  check(
    results,
    '通知的內文帶得出那一則（反向的錨）',
    sent.length === 1 && sent[0].body.includes('BACKFILL-TITLE'),
    JSON.stringify(sent[0] ?? null),
  )
}

/** 合併、拒絕不通知，以及縮減。 */
async function runNotifyContent(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  const app = await freshApp(context, { profile, configDir, stub, marker })

  // 一次投十則 —— 全部落在同一個窗裡。
  for (let i = 0; i < 10; i += 1) {
    drop(profile, `m${i}`, intake({ id: `merge-${i}`, title: `MERGE-${i}` }))
  }
  // 外加兩則會被拒絕的：識別碼不合法，以及識別碼搶佔。
  drop(profile, 'bad', { id: '..', origin: { kind: 'slack', id: 'C1' }, title: 'x', body: 'y' })
  drop(profile, 'seize', intake({ id: 'merge-0', title: 'SEIZED-TITLE' }))

  await pollFor({
    read: () => app.client.evaluate(BADGE_TEXT),
    settled: (text) => text === '10',
    timeoutMs: 25_000,
    label: '前置：十則都進來了',
  })
  await new Promise((resolve) => setTimeout(resolve, WINDOW_WAIT_MS))

  const sent = notifications(profile)
  check(
    results,
    '窗內的多則合併為一則，且被拒絕的投遞不發出通知',
    sent.length === 1,
    `發出 ${sent.length} 則：${JSON.stringify(sent).slice(0, 200)}`,
  )
  const whole = sent.map((one) => `${one.title}\n${one.body}`).join('\n')
  check(
    results,
    '合併的那一則不含任何第三方文字',
    !/MERGE-|SEIZED-TITLE/.test(whole),
    whole.slice(0, 160),
  )

  // 縮減：標記字元與 URL 都不得抵達作業系統那一層。
  drop(
    profile,
    'reduce',
    intake({ id: 'reduce-1', title: 'BEFORE <b>BOLD</b> https://evil.example/beacon AFTER' }),
  )
  await new Promise((resolve) => setTimeout(resolve, WINDOW_WAIT_MS))
  const reduced = notifications(profile).at(-1)
  check(
    results,
    '交給作業系統的字串不含標記字元，也不含 URL',
    Boolean(reduced) &&
      !/[<>&]/.test(reduced.body) &&
      !reduced.body.includes('evil.example') &&
      reduced.body.includes('BEFORE') &&
      reduced.body.includes('AFTER'),
    JSON.stringify(reduced ?? null),
  )
}

/**
 * 觸發通知 ⇒ 視窗到前景 ＋ 打開收件匣。
 *
 * 「已開啟時是無操作」這條**需要收據**：第二次觸發若根本沒抵達 renderer，分頁當然還在
 * routing —— 綠的。收據把「規格要求的無操作」與「訊息根本沒送到」分開。
 */
async function runNotifyActivate(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  const app = await freshApp(context, { profile, configDir, stub, marker })
  drop(profile, 'a1', intake({ id: 'activate-1', title: 'ACTIVATE-TITLE' }))
  await pollFor({
    read: () => app.client.evaluate(BADGE_TEXT),
    settled: (text) => text === '1',
    timeoutMs: 15_000,
    label: '前置：那一則進來了',
  })
  check(
    results,
    '前置：收件匣此刻未開啟',
    (await app.client.evaluate(`!document.querySelector('[role="dialog"]${label('intake.label')}')`)) === true,
    '未開啟',
  )

  fireNotification(profile, 1)
  const opened = await pollFor({
    read: () =>
      app.client.evaluate(`!!document.querySelector('[role="dialog"]${label('intake.label')}')`),
    settled: (open) => open === true,
    timeoutMs: 15_000,
    label: '觸發之後收件匣打開',
  })
  check(results, '觸發通知後收件匣呈現', opened === true, String(opened))

  // 切到 routing 規則分頁，並在某個欄位輸入一半。
  await retryAction({
    act: () => app.client.evaluate(tabClick('intake.rules.label')),
    read: () => app.client.evaluate(`!!document.querySelector('${label('intake.rules.add')}')`),
    settled: (present) => present === true,
    attemptWindowMs: 3000,
    timeoutMs: 15_000,
    label: '切到 routing 規則分頁',
  })
  await retryAction({
    act: () => app.client.evaluate(`(() => {
      const add = document.querySelector('${label('intake.rules.add')}')
      if (!add) return false
      add.click()
      return true
    })()`),
    read: () => app.client.evaluate(`!!document.querySelector('${label('intake.rules.contains')}')`),
    settled: (present) => present === true,
    attemptWindowMs: 3000,
    timeoutMs: 15_000,
    label: '新增一條規則',
  })
  const typed = await app.client.evaluate(`(() => {
    const input = document.querySelector('${label('intake.rules.contains')}')
    if (!input) return 'no-input'
    // React 的受控輸入不吃直接指派 —— 要走原型上的 setter 再送一次 input 事件。
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'HALF-TYPED')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.focus()
    return input.value
  })()`)
  check(results, '前置：規則的欄位裡確實輸入了一半', typed === 'HALF-TYPED', String(typed))

  const before = receipts(profile).length
  fireNotification(profile, 2)
  await pollFor({
    read: () => receipts(profile).length,
    settled: (count) => count > before,
    timeoutMs: 15_000,
    label: '第二次觸發確實抵達了主行程',
  })
  await new Promise((resolve) => setTimeout(resolve, 800))

  const state = await app.client.evaluate(`(() => {
    const input = document.querySelector('${label('intake.rules.contains')}')
    return {
      onRules: !!document.querySelector('${label('intake.rules.add')}'),
      value: input ? input.value : null,
      active: ${ACTIVE_LABEL},
    }
  })()`)
  check(
    results,
    '收件匣已開啟時觸發通知不重設分頁、不清掉輸入中的內容、不改變焦點',
    state?.onRules === true && state.value === 'HALF-TYPED' && state.active === copy('intake.rules.contains'),
    `${JSON.stringify(state)}｜收據 ${receipts(profile).length} 筆`,
  )

  // 關閉之後焦點回到入口。
  await retryAction({
    act: () =>
      app.client.evaluate(`(() => {
        const close = document.querySelector('[role="dialog"]${label('intake.label')} ${label('intake.close')}')
        if (!close) return false
        close.click()
        return true
      })()`),
    read: () =>
      app.client.evaluate(`!document.querySelector('[role="dialog"]${label('intake.label')}')`),
    settled: (closed) => closed === true,
    attemptWindowMs: 3000,
    timeoutMs: 15_000,
    label: '關閉收件匣',
  })
  check(
    results,
    '由通知開啟並關閉之後焦點回到活動列的入口',
    (await app.client.evaluate(ACTIVE_LABEL)) === copy('activityBar.handoffs'),
    String(await app.client.evaluate(ACTIVE_LABEL)),
  )
}

/**
 * **收件匣開著時，一次收件匣變動不得把焦點搶走。**
 *
 * 這一條擋的是一個既有的、被這個 change 引爆的缺陷：overlay 的「聚焦關閉鈕」effect 若跟著
 * 父層每次渲染重建的回呼走，活動列一旦訂閱收件匣狀態（計數），每一次變動都會把焦點搶回去
 * —— 而使用者可能正在編輯 routing 規則。
 */
async function runFocusStability(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  const app = await freshApp(context, { profile, configDir, stub, marker })
  await openInbox(app)

  // 把焦點放到一個**不是關閉鈕**的地方。
  const moved = await app.client.evaluate(tabFocus('intake.rules.label'))
  const anchored = await app.client.evaluate(
    `document.activeElement ? (document.activeElement.getAttribute('aria-label') ?? document.activeElement.textContent) : null`,
  )
  check(
    results,
    '前置：焦點確實被移到別的地方',
    moved === true && anchored !== copy('intake.close'),
    `moved=${moved} active=${anchored}`,
  )

  // 投一則 —— 這會讓計數改變，於是活動列重繪。
  drop(profile, 'f1', intake({ id: 'focus-1', title: 'FOCUS-TITLE' }))
  await pollFor({
    read: () => app.client.evaluate(itemTextExpression('FOCUS-TITLE')),
    settled: (text) => text.includes('FOCUS-TITLE'),
    timeoutMs: 15_000,
    label: '那一則已呈現（前置：變動確實抵達了畫面）',
  })
  await new Promise((resolve) => setTimeout(resolve, 500))

  const after = await app.client.evaluate(
    `document.activeElement ? (document.activeElement.getAttribute('aria-label') ?? document.activeElement.textContent) : null`,
  )
  check(
    results,
    '收件匣變動不把焦點搶回關閉鈕',
    after === anchored,
    `變動前 ${anchored}｜變動後 ${after}`,
  )
}

/**
 * 位數超出可容納範圍 —— 三位數以 `99+` 呈現，且入口的尺寸不變。
 *
 * **以 seed 落盤狀態造出前提**：待處理總量上限是 200，靠真的投遞一百多份檔案既慢又沒有
 * 多驗到任何東西。
 */
async function runBadgeOverflow(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  const many = []
  for (let i = 0; i < 123; i += 1) many.push({ id: `many-${i}`, title: `MANY-${i}` })
  seedStore(profile, many)

  const app = await freshApp(context, { profile, configDir, stub, marker })
  const rect = await pollFor({
    read: () => app.client.evaluate(HANDOFFS_RECT),
    settled: (value) => value?.badge != null && value.badge !== '',
    timeoutMs: 20_000,
    label: '計數標示出現',
  })
  check(results, '三位數以不改變尺寸的形式呈現', rect?.badge === '99+', JSON.stringify(rect))
  check(
    results,
    '三位數時入口的尺寸與個位數時相同',
    rect?.w === 36 && rect.h === 36,
    JSON.stringify(rect),
  )
}

const SECTIONS = [
  { name: 'runIngest', run: runIngest },
  { name: 'runPlainText', run: runPlainText },
  { name: 'runRouting', run: runRouting },
  { name: 'runAcceptPrefill', run: runAcceptPrefill },
  { name: 'runDismiss', run: runDismiss },
  { name: 'runBadge', run: runBadge },
  { name: 'runBadgeOverflow', run: runBadgeOverflow },
  { name: 'runBadgeRestart', run: runBadgeRestart },
  { name: 'runNotifyBackfill', run: runNotifyBackfill },
  { name: 'runNotifyContent', run: runNotifyContent },
  { name: 'runNotifyActivate', run: runNotifyActivate },
  { name: 'runFocusStability', run: runFocusStability },
]

const outcome = await runSections({
  sections: SECTIONS,
  build: { port: PORT, rendererUrl: null },
  dev: null,
  results,
  afterMode: async (_mode, context) => {
    if (context.app) await context.app.close()
  },
  cleanup: () => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true })
  },
})

process.exit(outcome ? 0 : 1)
