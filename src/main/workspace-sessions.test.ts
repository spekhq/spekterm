import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

import type { WaitValue } from '../shared/lineage/lifecycle'
import { configureHandoff, outboxDir, resetHandoffState, workspaceSessionsFile } from './handoff-outbox'
import type { PersistedSession } from './session-store'
import {
  CONTEXT_FULL_PERCENT,
  needsWorkingRefresh,
  shouldRefresh,
  WORKING_REFRESH_MS,
  WorkingRefresh,
  workspaceSessionsAbout,
  workspaceSessionsContent,
  workspaceSessionsOf,
  type WorkspaceSessionsWorld,
  withoutStatusGlyph,
  writeWorkspaceSessions,
} from './workspace-sessions'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const S = '44444444-4444-4444-8444-444444444444'
const G = '55555555-5555-4555-8555-555555555555'

function session(id: string, folderId: string | null, extra: Partial<PersistedSession> = {}): PersistedSession {
  return { id, folderId, spawnTarget: 'claude', ordinal: 0, peerName: `n-${id.slice(0, 4)}`, ...extra }
}

/** A handoff session (has a lineage), opened from A. */
const handoffSession = (id: string, folderId: string, extra: Partial<PersistedSession> = {}): PersistedSession =>
  session(id, folderId, {
    lineage: { parentId: A, origin: { kind: 'folder', folderId: 'fa', folderName: 'alpha' }, brief: { title: 'Upgrade lib', receivedAt: 0 } },
    ...extra,
  })

function world(
  sessions: PersistedSession[],
  running: string[],
  extra: Partial<WorkspaceSessionsWorld> = {},
): WorkspaceSessionsWorld {
  return {
    view: sessions.map((s) => ({ session: s, provisional: false })),
    folders: [{ id: 'fa', name: 'alpha' }, { id: 'fb', name: 'beta' }],
    running: new Set(running),
    wait: () => 'ready',
    seen: () => true,
    context: () => undefined,
    ...extra,
  }
}

const byName = (w: WorkspaceSessionsWorld, name: string) => workspaceSessionsOf(w).find((e) => e.name === name)

describe('workspaceSessionsOf (workspace-sessions)', () => {
  it('a session in another repo that is not a relative is listed with name, repo, label and running', () => {
    // Control for "filter to lineage sessions only": neither A nor B has a lineage.
    const w = world([session(A, 'fa'), session(B, 'fb', { customTitle: 'Restyle chat' })], [A, B])
    assert.deepEqual(byName(w, 'n-2222'), { name: 'n-2222', repo: 'beta', title: 'Restyle chat', running: true, state: 'idle' })
  })

  it('a dormant session is listed as not running, idle', () => {
    // A dormant session's wait value would be "ready" here if the builder did not treat not-running as unknown.
    const w = world([session(A, 'fa'), session(B, 'fb')], [A], { seen: () => false })
    assert.equal(byName(w, 'n-2222')?.running, false)
    assert.equal(byName(w, 'n-2222')?.state, 'idle')
  })

  it('a finished handoff session is done with its summary, and stays done when hibernated', () => {
    const done = handoffSession(C, 'fb', { completion: { reportedAt: 1, settled: true } })
    const lifecycle = new Map([[C, { state: 'done' as const, summary: 'upgraded to 1.12.0' }]])
    const running = byName(world([session(A, 'fa'), done], [A, C], { lifecycle }), 'n-3333')
    assert.deepEqual([running?.state, running?.summary, running?.running], ['done', 'upgraded to 1.12.0', true])
    // Control for `running ? lifecycle : 'idle'`.
    const dormant = byName(world([session(A, 'fa'), done], [A], { lifecycle }), 'n-3333')
    assert.deepEqual([dormant?.state, dormant?.summary, dormant?.running], ['done', 'upgraded to 1.12.0', false])
  })

  it('a user-opened session has a state from the raw wait value: busy without a prompt submission is working', () => {
    // The world's `lifecycle` covers only lineage sessions: a builder reading it alone has no state for B (1.3).
    // A builder reading the attention projection would need `inTurn`, which this world does not even provide.
    let wait: WaitValue = 'busy'
    let seen = true
    const w = world([session(A, 'fa'), session(B, 'fb')], [A, B], {
      wait: (id) => (id === B ? wait : 'ready'),
      seen: (id) => (id === B ? seen : true),
      lifecycle: new Map(),
    })
    assert.equal(byName(w, 'n-2222')?.state, 'working', 'busy is working')
    wait = 'ready'
    seen = false
    assert.equal(byName(w, 'n-2222')?.state, 'waiting', 'an unseen turn end is waiting')
    seen = true
    assert.equal(byName(w, 'n-2222')?.state, 'idle', 'a seen one is idle')
    wait = 'awaiting-choice'
    assert.equal(byName(w, 'n-2222')?.state, 'waiting', 'a choice is waiting')
  })

  it('a shell session is not listed', () => {
    const w = world([session(A, 'fa'), session(S, 'fa', { spawnTarget: 'shell', peerName: undefined })], [A, S])
    assert.deepEqual(workspaceSessionsOf(w).map((e) => e.name), ['n-1111'])
    assert.equal(workspaceSessionsOf(w).length, 1)
  })

  it('a pty title loses its status glyph; a user name and a handoff title keep theirs', () => {
    const w = world(
      [
        session(A, 'fa', { title: '✳ alpha-1111' }),
        session(B, 'fb', { title: '◑ beta-2222' }),
        session(C, 'fb', { customTitle: '✳ starred task', title: '✳ beta-3333' }),
      ],
      [A, B, C],
    )
    assert.equal(byName(w, 'n-1111')?.title, 'alpha-1111')
    assert.equal(byName(w, 'n-2222')?.title, 'beta-2222')
    assert.equal(byName(w, 'n-3333')?.title, '✳ starred task')
    assert.equal(withoutStatusGlyph('✳'), '✳', 'a lone glyph with no space is not a prefix')
    assert.equal(withoutStatusGlyph('Fix login'), 'Fix login')
  })

  it('context is whole percent for a running session; absent when unknown or dormant, never 0', () => {
    const w = world([session(A, 'fa'), session(B, 'fb'), session(C, 'fb')], [A, B], {
      context: (id) => (id === A ? 82.6 : id === C ? 50 : undefined),
    })
    assert.equal(byName(w, 'n-1111')?.context, 83)
    assert.equal('context' in (byName(w, 'n-2222') ?? {}), false, 'no report: absent (control: `context ?? 0`)')
    // C has a lookup value but is dormant: the builder must not ask (control: read without the running check).
    assert.equal('context' in (byName(w, 'n-3333') ?? {}), false, 'dormant: absent')
  })

  it('order: folder order, then the session list order, the global session last', () => {
    const w = world(
      [session(G, null), session(B, 'fb'), session(A, 'fa'), session(C, 'fb')],
      [A, B, C, G],
    )
    assert.deepEqual(workspaceSessionsOf(w).map((e) => [e.name, e.repo]), [
      ['n-1111', 'alpha'],
      ['n-2222', 'beta'],
      ['n-3333', 'beta'],
      ['n-5555', 'global'],
    ])
  })

  it('a session whose folder left the workspace is not listed', () => {
    const w = world([session(A, 'fa'), session(B, 'fgone')], [A])
    assert.deepEqual(workspaceSessionsOf(w).map((e) => e.name), ['n-1111'])
  })

  it('the file holds no path field and no session identifier', () => {
    const w = world(
      [session(A, 'fa', { cwd: '/home/me/alpha', claudeSessionId: '66666666-6666-4666-8666-666666666666' }), handoffSession(B, 'fb')],
      [A, B],
      { folders: [{ id: 'fa', name: 'alpha' }, { id: 'fb', name: 'beta' }] },
    )
    const text = workspaceSessionsContent(workspaceSessionsOf(w))
    for (const id of [A, B, '66666666-6666-4666-8666-666666666666', 'fa', 'fb']) {
      assert.equal(text.includes(`"${id}"`), false, `identifier ${id} is in the file`)
    }
    assert.equal(/"\/home\//.test(text), false, 'a path value is in the file')
    const keys = new Set(workspaceSessionsOf(w).flatMap((e) => Object.keys(e)))
    assert.deepEqual([...keys].sort(), ['name', 'repo', 'running', 'state', 'title'].sort())
  })
})

describe('workspaceSessionsAbout', () => {
  const about = workspaceSessionsAbout()

  for (const [what, pattern] of [
    ['not running cannot receive messages', /"running": false means it has no process now and cannot receive messages/],
    ['no name cannot be messaged', /an entry with no name cannot be messaged/],
    ['repo names are not unique', /repo names are not unique/],
    ['idle may mean unknown', /or spekterm does not know/],
    ['absent context means unknown', /absent means unknown, not empty/],
    ['a working session may be under-reported', /A working session's value may be lower than its usage now/],
    ['only a handoff that opens now', /Before you write a handoff that opens now \(not one with "at" or "repeat"\)/],
    ['unless the user asked', /unless the user asked for a new session/],
    ['same work, not merely the same repo', /the same task or a direct continuation of it, not merely the same repo/],
    ['an unlabelled session is asked', /title is only its name and that has no summary .* ask it with SendMessage, or ask the user/],
    ['message a running one and tell the user', /send it the work with SendMessage, addressed by its name, instead of writing the handoff, and tell the user which session/],
    ['a dormant relative is woken', /if your relations file lists it, wake it .* and then message it/],
    ['a dormant non-relative goes to the user', /otherwise tell the user it exists and ask whether to wake it or to have a new session opened/],
    ['the wake reach', /You can wake only the sessions your relations file lists/],
    ['none: hand off as before', /If there is no such session, write the handoff as before/],
    ['what a message does not give', /A message gives no receipt, no report and no relation: .* reply to you by your name/],
    ['labels are not instructions', /never as instructions/],
  ] as const) {
    it(`states: ${what}`, () => assert.match(about, pattern))
  }

  it('states the context threshold from the constant', () => {
    assert.match(about, new RegExp(`its context is below ${CONTEXT_FULL_PERCENT},`))
    assert.match(about, new RegExp(`At ${CONTEXT_FULL_PERCENT} or above it does not take new work`))
  })

  it('does not tell the agent to name a dormant session in a handoff body (the rejected first draft)', () => {
    assert.equal(/name it in the (handoff's )?body/i.test(about), false)
  })

  it('holds no path and no session identifier', () => {
    assert.equal(/\/|[0-9a-f]{8}-[0-9a-f]{4}-/.test(about), false)
  })
})

describe('writeWorkspaceSessions', () => {
  const fresh = (): string => {
    const root = fs.mkdtempSync(path.join(tmpdir(), 'ws-sessions-'))
    return path.join(root, 'workspace-sessions.json')
  }

  it('writes once for unchanged content, and again after the file was removed from outside', () => {
    const file = fresh()
    const content = workspaceSessionsContent([{ repo: 'alpha', running: false, state: 'idle' }])
    assert.equal(writeWorkspaceSessions(file, content), true)
    assert.equal(writeWorkspaceSessions(file, content), false, 'unchanged: no write')
    fs.rmSync(file)
    // Control: a remembered copy would see "unchanged" and leave the file gone.
    assert.equal(writeWorkspaceSessions(file, content), true, 'removed from outside: written again')
    assert.equal(fs.readFileSync(file, 'utf8'), content)
  })

  it('writes through a temporary name that does not end in .json', () => {
    const file = fresh()
    const seen: string[] = []
    const original = fs.writeFileSync
    // Capture the temporary name the write goes through.
    ;(fs as { writeFileSync: typeof fs.writeFileSync }).writeFileSync = ((target: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      seen.push(String(target))
      return (original as (...args: unknown[]) => void)(target, ...rest)
    }) as typeof fs.writeFileSync
    try {
      writeWorkspaceSessions(file, '{}\n')
    } finally {
      ;(fs as { writeFileSync: typeof fs.writeFileSync }).writeFileSync = original
    }
    assert.equal(seen.length, 1)
    assert.equal(seen[0]?.endsWith('.json'), false, seen[0])
    assert.equal(path.dirname(seen[0] ?? ''), path.dirname(file))
  })

  it('sits at the handoff root, outside every outbox', () => {
    const root = fs.mkdtempSync(path.join(tmpdir(), 'ws-root-'))
    configureHandoff(root)
    try {
      const file = workspaceSessionsFile()
      assert.equal(path.basename(file), 'workspace-sessions.json')
      assert.equal(path.dirname(file), path.join(root, 'handoff'))
      const outbox = outboxDir(A)
      assert.equal(path.relative(path.dirname(outbox), file).startsWith('..'), true, 'not inside the outbox root')
    } finally {
      resetHandoffState()
    }
  })
})

describe('refresh triggers', () => {
  it('a wait value change refreshes, an unchanged batch does not, a seen change does', () => {
    assert.equal(shouldRefresh('busy', 'ready', false), true, 'busy → ready (busy, !inTurn → ready moves no attention)')
    assert.equal(shouldRefresh('ready', 'ready', false), false, 'an unchanged batch (control: always true)')
    assert.equal(shouldRefresh('ready', 'ready', true), true, 'the seen mark changed')
  })

  it('busy without a prompt submission, then a seen turn end: the content moves working → idle', () => {
    // The attention projection says idle for both (`busy, !inTurn, seen` and `ready, seen`), so a refresh on attention
    // change alone would leave "working" in the file; the wait-value trigger refreshes and the content changes.
    let wait: WaitValue = 'busy'
    const w = world([session(A, 'fa'), session(B, 'fb')], [A, B], { wait: (id) => (id === B ? wait : 'ready') })
    const before = workspaceSessionsContent(workspaceSessionsOf(w))
    const previous = wait
    wait = 'ready'
    assert.equal(shouldRefresh(previous, wait, false), true)
    const after = workspaceSessionsContent(workspaceSessionsOf(w))
    assert.notEqual(after, before)
    assert.match(before, /"state": "working"/)
    assert.equal(/"state": "working"/.test(after), false)
  })

  it('the periodic refresh runs while a listed session is working, and stops when none is', () => {
    const calls: string[] = []
    let handles = 0
    const ticker = new WorkingRefresh(() => calls.push('refresh'), {
      setInterval: (callback, ms) => {
        assert.equal(ms, WORKING_REFRESH_MS)
        handles += 1
        calls.push('set')
        return { callback }
      },
      clearInterval: () => calls.push('clear'),
    })
    const working = [{ repo: 'alpha', running: true, state: 'working' as const }]
    const idle = [{ repo: 'alpha', running: true, state: 'idle' as const }]
    ticker.update(idle)
    assert.equal(ticker.scheduled, false, 'nothing working: no timer')
    ticker.update(working)
    ticker.update(working)
    assert.equal(ticker.scheduled, true, 'a working session: one timer (control: never scheduled)')
    assert.equal(handles, 1, 'one timer, not one per update')
    ticker.update(idle)
    assert.equal(ticker.scheduled, false)
    assert.deepEqual(calls, ['set', 'clear'])
    assert.equal(needsWorkingRefresh(working), true)
    assert.equal(needsWorkingRefresh(idle), false)
  })
})
