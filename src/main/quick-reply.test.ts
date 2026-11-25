import assert from 'node:assert/strict'
import test from 'node:test'

import type { WaitState } from './agent-events'
import { SUBMIT_KEY_DELAY_MS } from './intake-prefill'
import { forgetInput, keystrokeSeq, noteWrite } from './pty-input'
import { type QuickReplyDeps, sendQuickReply } from './quick-reply'
import { deliverReply, sendReply } from './remote-conversation'

let clock = 1000

/** A hand-driven rig whose pty writes go through the real keystroke record, as `TerminalService.write` does. */
function rig(id: string, initial: WaitState = 'ready') {
  forgetInput(id)
  const timers: { resolve: () => void }[] = []
  const writes: string[] = []
  let state: WaitState = initial
  let prefill = false
  let refreshes = 0
  const deps: QuickReplyDeps = {
    isRunningAgent: (sid) => sid === id,
    write: (sid, data) => {
      writes.push(data)
      noteWrite(sid, data, undefined, (clock += 10))
      return true
    },
    waitStateOf: () => state,
    refresh: () => {
      refreshes += 1
    },
    prefillPending: () => prefill,
    keystrokeSeq,
    delay: () => new Promise<void>((resolve) => timers.push({ resolve })),
    submitDelayMs: SUBMIT_KEY_DELAY_MS,
  }
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
  return {
    deps,
    writes,
    setState: (next: WaitState) => {
      state = next
    },
    setPrefill: (next: boolean) => {
      prefill = next
    },
    refreshes: () => refreshes,
    /** The user types into the terminal. */
    type: (data: string) => noteWrite(id, data, undefined, (clock += 10)),
    /** Lets the half-second delay pass. */
    elapse: async () => {
      await flush()
      for (const timer of timers.splice(0)) timer.resolve()
      await flush()
    },
  }
}

async function send(r: ReturnType<typeof rig>, id: string, text: string) {
  const pending = sendQuickReply(r.deps, id, text)
  await r.elapse()
  return pending
}

test('a quick reply is the text, then the submit key after the delay', async () => {
  const r = rig('q1')
  const result = await send(r, 'q1', 'Can this session be closed now?')
  assert.deepEqual(result, { ok: true, outcome: 'submitted' })
  assert.deepEqual(r.writes, ['Can this session be closed now?', '\r'])
  assert.ok(r.refreshes() >= 2, 'the state is read fresh before the text and before the key')
})

test('typed earlier and not sent: not refused — the sentence joins whatever the box holds', async () => {
  const r = rig('q2')
  r.type('f')
  r.type('ix the')
  const result = await send(r, 'q2', 'Any risk?')
  assert.deepEqual(result, { ok: true, outcome: 'submitted' })
  assert.deepEqual(r.writes, ['Any risk?', '\r'])
})

test('two quick replies in a row, no submission drained in between: both sent', async () => {
  const r = rig('q5')
  assert.equal((await send(r, 'q5', 'first')).ok, true)
  r.setState('busy')
  const second = await send(r, 'q5', 'second')
  assert.deepEqual(second, { ok: true, outcome: 'submitted' })
  assert.deepEqual(r.writes, ['first', '\r', 'second', '\r'])
})

test('a key typed between the text and the submit key withholds the key; the next click is sent', async () => {
  const r = rig('q6')
  const pending = sendQuickReply(r.deps, 'q6', 'first')
  await new Promise<void>((resolve) => setImmediate(resolve))
  r.type('x') // a key during the half second
  await r.elapse()
  assert.deepEqual(await pending, { ok: true, outcome: 'filled-not-submitted' })
  assert.deepEqual(r.writes, ['first'], 'no submit key')
  assert.deepEqual(await send(r, 'q6', 'second'), { ok: true, outcome: 'submitted' })
  assert.deepEqual(r.writes, ['first', 'second', '\r'])
})

test('the wait state and a pending fill refuse, writing nothing', async () => {
  const r = rig('q10')
  r.setState('awaiting-choice')
  assert.deepEqual(await send(r, 'q10', 'Any risk?'), { ok: false, code: 'WAIT_STATE', state: 'awaiting-choice' })
  r.setState('unknown')
  assert.deepEqual(await send(r, 'q10', 'Any risk?'), { ok: false, code: 'WAIT_STATE', state: 'unknown' })
  r.setState('ready')
  r.setPrefill(true)
  assert.deepEqual(await send(r, 'q10', 'Any risk?'), { ok: false, code: 'PREFILL_PENDING' })
  assert.deepEqual(r.writes, [])
})

test('the state is read after a refresh: a request drained only then refuses before any write', async () => {
  const r = rig('q11')
  r.deps.refresh = () => r.setState('awaiting-choice')
  assert.deepEqual(await send(r, 'q11', 'Any risk?'), { ok: false, code: 'WAIT_STATE', state: 'awaiting-choice' })
  assert.deepEqual(r.writes, [])
})

test('bad parameters and a session that is not a running agent write nothing', async () => {
  const r = rig('q12')
  for (const [id, text] of [
    [1, 'x'],
    ['q12', 2],
    ['q12', ''],
    ['q12', 'a'.repeat(201)],
    ['q12', 'two\nlines'],
  ] as const) {
    assert.deepEqual(await send(r, id as string, text as string), { ok: false, code: 'BAD_PARAMS' }, JSON.stringify([id, text]))
  }
  assert.deepEqual(await send(r, 'other', 'x'), { ok: false, code: 'NOT_FOUND' })
  assert.equal((await send(r, 'q12', 'a'.repeat(200))).ok, true)
})

test('deliverReply arms no phone origin', async () => {
  const r = rig('q13')
  let armed = 0
  const pending = deliverReply({ ...r.deps, prefillPending: () => null }, 'q13', 'hi')
  await r.elapse()
  await pending
  assert.equal(armed, 0)
  const phone = sendReply({ ...r.deps, prefillPending: () => null, armOrigin: () => (armed += 1) }, 'q13', 'q13', 'hi')
  await r.elapse()
  await phone
  assert.equal(armed, 1, 'a device\'s reply still arms it')
})

test('a quick reply\'s writes are keystrokes for everyone else who watches typing (agent-session-control)', async () => {
  const { onKeystroke } = await import('./pty-input')
  const r = rig('q14')
  const heard: string[] = []
  const stop = onKeystroke((sid) => heard.push(sid))
  try {
    await send(r, 'q14', 'Any risk?')
  } finally {
    stop()
  }
  assert.deepEqual(heard, ['q14', 'q14'], 'the text and the submit key each reach the listeners (a waiting close is dropped)')
})

test('a state that just became sendable is read fresh before the first check, not refused for the stale one', async () => {
  const r = rig('q15', 'awaiting-choice')
  r.deps.refresh = () => r.setState('ready')
  assert.deepEqual(await send(r, 'q15', 'Any risk?'), { ok: true, outcome: 'submitted' })
})
