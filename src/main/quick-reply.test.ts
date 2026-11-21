import assert from 'node:assert/strict'
import test from 'node:test'

import type { WaitState } from './agent-events'
import { SUBMIT_KEY_DELAY_MS } from './intake-prefill'
import { confirmSubmit, forgetInput, keystrokeSeq, noteSubmitted, noteWrite, setOwnRequestSource, submittedSeqOf } from './pty-input'
import { type QuickReplyDeps, sendQuickReply } from './quick-reply'
import { deliverReply, QuickReplyRefusal, sendReply } from './remote-conversation'
import { RemoteError } from './remote-frames'

let clock = 1000

/** A hand-driven rig whose pty writes go through the real keystroke record, as `TerminalService.write` does. */
function rig(id: string, initial: WaitState = 'ready') {
  forgetInput(id)
  setOwnRequestSource(() => false)
  noteSubmitted(id) // the process started
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
    submittedSeqOf,
    noteSubmitted,
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
    /** The agent reports an own submission now. */
    submit: () => confirmSubmit(id, (clock += 60)),
    /** Lets the half-second delay pass. */
    elapse: async () => {
      await flush()
      for (const timer of timers.splice(0)) timer.resolve()
      await flush()
    },
  }
}

async function send(r: ReturnType<typeof rig>, id: string, text: string, typedSeq?: number) {
  const pending = sendQuickReply(r.deps, id, text, typedSeq)
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

test('typed after the baseline: refused TYPED with the count, nothing written', async () => {
  const r = rig('q2')
  r.type('f')
  r.type('ix the')
  const result = await send(r, 'q2', 'Any risk?')
  assert.deepEqual(result, { ok: false, code: 'TYPED', seq: keystrokeSeq('q2') })
  assert.deepEqual(r.writes, [])
})

test('typed then submitted with Enter, the submission confirmed: sent (the user\'s own prompt is running)', async () => {
  const r = rig('q3', 'busy')
  r.type('fix the bug')
  r.type('\r')
  r.submit()
  const result = await send(r, 'q3', 'Any risk?')
  assert.equal(result.ok, true)
})

test('typed during the turn, then a background task\'s notice (no Enter): refused', async () => {
  const r = rig('q4')
  r.type('\r')
  r.submit()
  r.type('and also')
  r.submit() // a notice reaching pty-input would find no Enter after the baseline; the drain does not even list it
  const result = await send(r, 'q4', 'Any risk?')
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.code, 'TYPED')
})

test('two quick replies in a row, no submission drained in between: both sent', async () => {
  const r = rig('q5')
  assert.equal((await send(r, 'q5', 'first')).ok, true)
  r.setState('busy')
  const second = await send(r, 'q5', 'second')
  assert.deepEqual(second, { ok: true, outcome: 'submitted' })
  assert.deepEqual(r.writes, ['first', '\r', 'second', '\r'])
})

test('a reply whose submit key was withheld leaves its text in the box: the next click is refused', async () => {
  const r = rig('q6')
  const pending = sendQuickReply(r.deps, 'q6', 'first', undefined)
  await new Promise<void>((resolve) => setImmediate(resolve))
  r.type('x') // a key during the half second
  await r.elapse()
  assert.deepEqual(await pending, { ok: true, outcome: 'filled-not-submitted' })
  assert.deepEqual(r.writes, ['first'], 'no submit key')
  const next = await send(r, 'q6', 'second')
  assert.equal(next.ok === false && next.code, 'TYPED')
})

test('a phone reply submitted, then a quick reply: sent', async () => {
  const r = rig('q7')
  r.type('half')
  const phone = sendReply({ ...r.deps, prefillPending: () => null, noteSubmitted }, 'q7', 'q7', 'from the phone')
  await r.elapse()
  assert.equal((await phone).outcome, 'submitted')
  assert.equal((await send(r, 'q7', 'Any risk?')).ok, true)
})

test('a previous process\'s keystrokes are ignored after a spawn', async () => {
  const r = rig('q8')
  r.type('old typing')
  noteSubmitted('q8') // the next spawn
  assert.equal((await send(r, 'q8', 'Any risk?')).ok, true)
})

test('send anyway: accepted while the count is unchanged, refused with the new count otherwise', async () => {
  const r = rig('q9')
  r.type('x')
  const refused = await send(r, 'q9', 'Any risk?')
  assert.ok(refused.ok === false && refused.code === 'TYPED')
  const seq = refused.ok === false ? refused.seq! : -1
  r.type('y')
  const again = await send(r, 'q9', 'Any risk?', seq)
  assert.deepEqual(again, { ok: false, code: 'TYPED', seq: seq + 1 })
  const anyway = await send(r, 'q9', 'Any risk?', seq + 1)
  assert.deepEqual(anyway, { ok: true, outcome: 'submitted' })
})

test('send anyway does not lift the other gates', async () => {
  const r = rig('q10')
  r.type('x')
  const seq = keystrokeSeq('q10')
  r.setState('awaiting-choice')
  assert.deepEqual(await send(r, 'q10', 'Any risk?', seq), { ok: false, code: 'WAIT_STATE', state: 'awaiting-choice' })
  r.setState('ready')
  r.setPrefill(true)
  assert.deepEqual(await send(r, 'q10', 'Any risk?', seq), { ok: false, code: 'PREFILL_PENDING' })
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
  for (const [id, text, seq] of [
    [1, 'x', undefined],
    ['q12', 2, undefined],
    ['q12', '', undefined],
    ['q12', 'a'.repeat(201), undefined],
    ['q12', 'two\nlines', undefined],
    ['q12', 'x', -1],
    ['q12', 'x', 1.5],
  ] as const) {
    assert.deepEqual(await send(r, id as string, text as string, seq as number | undefined), { ok: false, code: 'BAD_PARAMS' }, JSON.stringify([id, text, seq]))
  }
  assert.deepEqual(await send(r, 'other', 'x'), { ok: false, code: 'NOT_FOUND' })
  assert.equal((await send(r, 'q12', 'a'.repeat(200))).ok, true)
})

test('a refusal of the desktop\'s own is not a RemoteError, and deliverReply arms no phone origin', async () => {
  assert.equal(new QuickReplyRefusal('TYPED', 3) instanceof RemoteError, false)
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
