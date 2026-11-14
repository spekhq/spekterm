import assert from 'node:assert/strict'
import test from 'node:test'

import type { FinishedCall, OpenRequest, Question } from './agent-events'
import { type AnswerDeps, blockOf, KEY_GAP_MS, planKeys, promptView, writeAnswer } from './remote-answer'
import { RemoteError } from './remote-frames'

const request = (extra: Partial<OpenRequest> = {}): OpenRequest => ({
  id: 'r1',
  toolUseId: 't1',
  agentId: null,
  tool: 'Bash',
  arg: 'ls',
  questions: null,
  plan: null,
  at: 1000,
  answeredAt: null,
  stirred: false,
  ...extra,
})

const q = (question: string, labels: string[], multiSelect = false): Question => ({
  question,
  header: question,
  multiSelect,
  options: labels.map((label) => ({ label, description: '' })),
})

const code = (fn: () => unknown): string => {
  try {
    fn()
  } catch (error) {
    return error instanceof RemoteError ? error.code : String(error)
  }
  return 'no error'
}

test('key plans match the measured screens, and none contains Enter', () => {
  const plans = [
    planKeys(request(), 'allow'),
    planKeys(request(), 'deny'),
    planKeys(request({ tool: 'AskUserQuestion', questions: [q('Color?', ['Red', 'Green', 'Blue'])] }), 'answer', [[1]]),
    planKeys(
      request({ tool: 'AskUserQuestion', questions: [q('Fruit?', ['Apple', 'Banana']), q('Toppings?', ['Salt', 'Sugar', 'Honey'], true)] }),
      'answer',
      [[1], [2, 0]],
    ),
    planKeys(request({ tool: 'AskUserQuestion', questions: [q('Toppings?', ['Salt', 'Sugar', 'Honey'], true)] }), 'answer', [[1]]),
    planKeys(request({ tool: 'ExitPlanMode', plan: 'do it' }), 'approve'),
    planKeys(request({ tool: 'ExitPlanMode', plan: 'do it' }), 'approve-auto'),
    planKeys(request({ tool: 'ExitPlanMode', plan: null }), 'approve'),
  ]
  assert.deepEqual(
    plans.map((plan) => plan.keys),
    [['1'], ['\x1b'], ['2'], ['2', '1', '3', '\t', '1'], ['2', '\t', '1'], ['2'], ['1'], ['1']],
  )
  for (const plan of plans) assert.ok(!plan.keys.some((key) => key.includes('\r')), JSON.stringify(plan.keys))
  assert.deepEqual(plans[3].expect, { answers: { 'Fruit?': 'Banana', 'Toppings?': 'Salt, Honey' } })
  assert.deepEqual(plans[5].expect, { mode: 'default' })
  assert.deepEqual(plans[6].expect, { mode: 'auto' })
})

test('refusals: a decision that does not fit, an unmeasured tool, the plan without a plan, bad selections', () => {
  assert.equal(code(() => planKeys(request({ tool: 'NotebookEdit' }), 'allow')), 'NOT_ANSWERABLE')
  assert.equal(code(() => planKeys(request({ tool: 'mcp__' }), 'allow')), 'NOT_ANSWERABLE')
  assert.equal(code(() => planKeys(request({ tool: 'xmcp__x__y' }), 'allow')), 'NOT_ANSWERABLE')
  assert.equal(code(() => planKeys(request({ tool: 'ExitPlanMode', plan: 'p' }), 'allow')), 'NOT_ANSWERABLE')
  assert.equal(code(() => planKeys(request({ tool: 'ExitPlanMode', plan: null }), 'approve-auto')), 'NOT_ANSWERABLE')
  assert.equal(code(() => planKeys(request(), 'answer', [[0]])), 'NOT_ANSWERABLE')
  assert.equal(code(() => planKeys(request(), 'approve')), 'NOT_ANSWERABLE')
  const asked = request({ tool: 'AskUserQuestion', questions: [q('A?', ['x', 'y']), q('B?', ['u', 'v'], true)] })
  for (const bad of [undefined, [[0]], [[0, 1], [0]], [[2], [0]], [[0], []], [[0], [1, 1]], [['0'], [0]]]) {
    assert.equal(code(() => planKeys(asked, 'answer', bad)), 'BAD_PARAMS', JSON.stringify(bad))
  }
  const tooMany = request({ tool: 'AskUserQuestion', questions: [q('A?', ['1', '2', '3', '4', '5', '6', '7', '8', '9'])] })
  assert.equal(code(() => planKeys(tooMany, 'answer', [[0]])), 'NOT_ANSWERABLE')
  // Denying is always possible.
  assert.deepEqual(planKeys(tooMany, 'deny').keys, ['\x1b'])
})

test('a one-time allow for every tool measured to put it first, and only for those', () => {
  for (const tool of ['Bash', 'Edit', 'Write', 'Read', 'WebFetch', 'WebSearch', 'EnterWorktree', 'mcp__probe__ping', 'mcp__claude_ai_Docs__read']) {
    assert.deepEqual(planKeys(request({ tool }), 'allow').keys, ['1'], tool)
    assert.equal((promptView([request({ tool })], null, null) as { canAllow: boolean }).canAllow, true, tool)
  }
  for (const tool of ['NotebookEdit', 'ExitWorktree', 'Skill', 'mcp__', 'mcp___x', 'Mcp__x__y']) {
    assert.equal((promptView([request({ tool })], null, null) as { canAllow: boolean }).canAllow, false, tool)
  }
})

test('the prompt a device is shown, and when it may answer', () => {
  assert.equal(promptView([], null, null), null)
  assert.deepEqual(promptView([request()], null, null), {
    id: 'r1', kind: 'permission', tool: 'Bash', arg: 'ls', canAllow: true, answerable: true, open: 1,
  })
  assert.equal((promptView([request({ tool: 'ExitPlanMode', plan: 'p' })], null, null) as { canAllow?: boolean }).canAllow, undefined)
  assert.deepEqual(promptView([request({ tool: 'ExitPlanMode', plan: 'p' })], null, null), {
    id: 'r1', kind: 'plan', plan: 'p', choices: ['approve', 'approve-auto', 'deny'], answerable: true, open: 1,
  })
  assert.deepEqual((promptView([request({ tool: 'ExitPlanMode' })], null, null) as { choices: string[] }).choices, ['approve', 'deny'])
  const view = (requests: OpenRequest[], key: number | null) => promptView(requests, key, null)?.answerable
  assert.equal(view([request(), request({ id: 'r2' })], null), false, 'two open')
  assert.equal(view([request()], 1001), false, 'typed after it appeared')
  assert.equal(view([request()], 999), true, 'typed before it appeared')
  assert.equal(view([request({ stirred: true })], null), false)
  assert.equal(view([request({ answeredAt: 5 })], null), false)
  assert.equal(view([request({ tool: 'AskUserQuestion', questions: null })], null), false)
})

function rig(initial: OpenRequest[], finished: FinishedCall | null = null) {
  let requests = initial
  let keystroke: number | null = null
  let decisive: number | null = null
  let seq = 0
  const written: string[] = []
  const dismissed: string[] = []
  const between: (() => void)[] = []
  const deps: AnswerDeps = {
    refresh: () => requests,
    lastKeystrokeAt: () => keystroke,
    lastDecisiveAt: () => decisive,
    keystrokeSeq: () => seq,
    write: (_id, key) => {
      written.push(key)
      return true
    },
    markAnswered: (_id, requestId, at) => {
      requests = requests.map((r) => (r.id === requestId ? { ...r, answeredAt: at } : r))
    },
    dismiss: (_id, requestId) => dismissed.push(requestId),
    awaitFinished: async () => finished,
    delay: async (ms) => {
      assert.equal(ms, KEY_GAP_MS)
      between.shift()?.()
    },
    now: () => 2000,
  }
  return {
    deps,
    written,
    dismissed,
    setRequests: (next: OpenRequest[]) => (requests = next),
    /** A moving keystroke at `at`. */
    type: (at: number) => {
      keystroke = at
      seq += 1
    },
    /** A deciding keystroke at `at`: both times, as `noteWrite` sets them. */
    decide: (at: number) => {
      keystroke = at
      decisive = at
      seq += 1
    },
    seq: () => seq,
    between,
  }
}

test('an allow writes one key, marks the request answered, and a second answer is refused', async () => {
  const r = rig([request()])
  assert.equal(await writeAnswer(r.deps, 's', 'r1', 'allow'), 'sent')
  assert.deepEqual(r.written, ['1'])
  await assert.rejects(writeAnswer(r.deps, 's', 'r1', 'allow'), { code: 'PROMPT_GONE' })
  assert.deepEqual(r.written, ['1'], 'nothing more written')
})

test('each check withholds the first key with PROMPT_GONE', async () => {
  const cases: [string, (r: ReturnType<typeof rig>) => void][] = [
    ['two open', (r) => r.setRequests([request(), request({ id: 'r2' })])],
    ['another id', (r) => r.setRequests([request({ id: 'r9' })])],
    ['desktop typed', (r) => r.type(1500)],
    ['stirred', (r) => r.setRequests([request({ stirred: true })])],
    ['answered before', (r) => r.setRequests([request({ answeredAt: 1 })])],
  ]
  for (const [label, arrange] of cases) {
    const r = rig([request()])
    arrange(r)
    await assert.rejects(writeAnswer(r.deps, 's', 'r1', 'deny'), { code: 'PROMPT_GONE' }, label)
    assert.deepEqual(r.written, [], label)
    assert.deepEqual(r.dismissed, [], label)
  }
})

test('each check withholds a later key and the answer is partial', async () => {
  const asked = request({ tool: 'AskUserQuestion', questions: [q('A?', ['x', 'y']), q('B?', ['u', 'v'])] })
  const cases: [string, (r: ReturnType<typeof rig>) => void][] = [
    ['another request queued', (r) => r.setRequests([{ ...asked, answeredAt: 2000 }, request({ id: 'r2' })])],
    ['the request ended', (r) => r.setRequests([])],
    ['desktop typed', (r) => r.type(1500)],
    ['stirred', (r) => r.setRequests([{ ...asked, answeredAt: 2000, stirred: true }])],
  ]
  for (const [label, arrange] of cases) {
    const r = rig([asked])
    r.between.push(() => arrange(r))
    assert.equal(await writeAnswer(r.deps, 's', 'r1', 'answer', [[0], [1]]), 'partial', label)
    assert.deepEqual(r.written, ['1'], label)
  }
})

test('a question\'s answer is confirmed, or reported as differing, from the agent\'s record', async () => {
  const asked = request({ tool: 'AskUserQuestion', questions: [q('A?', ['x', 'y'])] })
  const ok = rig([asked], { toolUseId: 't1', answers: { 'A?': 'y' }, permissionMode: 'default' })
  assert.equal(await writeAnswer(ok.deps, 's', 'r1', 'answer', [[1]]), 'confirmed')
  const off = rig([asked], { toolUseId: 't1', answers: { 'A?': 'x' }, permissionMode: 'default' })
  assert.equal(await writeAnswer(off.deps, 's', 'r1', 'answer', [[1]]), 'mismatch')
  const none = rig([asked])
  assert.equal(await writeAnswer(none.deps, 's', 'r1', 'answer', [[1]]), 'sent')
})

test('a plan approval is confirmed by the mode the agent reports next', async () => {
  const plan = request({ tool: 'ExitPlanMode', plan: 'p' })
  const auto = rig([plan], { toolUseId: 't1', answers: null, permissionMode: 'auto' })
  assert.equal(await writeAnswer(auto.deps, 's', 'r1', 'approve-auto'), 'confirmed')
  assert.deepEqual(auto.written, ['1'])
  const wrong = rig([plan], { toolUseId: 't1', answers: null, permissionMode: 'default' })
  assert.equal(await writeAnswer(wrong.deps, 's', 'r1', 'approve-auto'), 'mismatch')
})

test('a deny writes Esc and closes the request', async () => {
  const r = rig([request()])
  assert.equal(await writeAnswer(r.deps, 's', 'r1', 'deny'), 'sent')
  assert.deepEqual(r.written, ['\x1b'])
  assert.deepEqual(r.dismissed, ['r1'])
})

// ── remote-answer-despite-typed ──

test('why a device may not answer: the first block that holds, typing last', () => {
  const asked = (extra: Partial<OpenRequest> = {}) => request({ tool: 'AskUserQuestion', questions: [q('A?', ['x'])], ...extra })
  const big = request({ tool: 'AskUserQuestion', questions: [q('A?', ['1', '2', '3', '4', '5', '6', '7', '8', '9'])] })
  const block = (requests: OpenRequest[], key: number | null = null, decisive: number | null = null) => blockOf(requests, key, decisive)
  // Each alone.
  assert.equal(block([request(), request({ id: 'r2' })]), 'open')
  assert.equal(block([big]), 'size')
  assert.equal(block([request({ tool: 'AskUserQuestion', questions: null })]), 'size')
  assert.equal(block([request({ answeredAt: 5 })]), 'answered')
  assert.equal(block([request({ stirred: true })]), 'stirred')
  assert.equal(block([request()], 1500, 1500), 'decisive', 'a deciding key sets both times')
  assert.equal(block([request()], 1500, null), 'typed')
  assert.equal(block([request()], 999, 999), null, 'typed before the tool started')
  assert.equal(block([asked()]), null)
  // Typing together with each other block gives the other one.
  assert.equal(block([request(), request({ id: 'r2' })], 1500), 'open')
  assert.equal(block([big], 1500), 'size')
  assert.equal(block([request({ answeredAt: 5 })], 1500), 'answered')
  assert.equal(block([request({ stirred: true })], 1500), 'stirred')
  assert.equal(block([request({ stirred: true })], 1500, 1500), 'stirred')
  // A moving key, then a deciding one: deciding.
  assert.equal(block([request()], 1600, 1600), 'decisive')
  // Plan and permission prompts are never too large.
  assert.equal(block([request({ tool: 'ExitPlanMode', plan: null })]), null)
})

test('the view carries the reason only when a device may not answer', () => {
  const answerable = promptView([request()], null, null)
  assert.equal(answerable?.answerable, true)
  assert.equal(answerable !== null && 'blockedBy' in answerable, false, 'no blockedBy key at all')
  assert.deepEqual(promptView([request()], 1500, null), {
    id: 'r1', kind: 'permission', tool: 'Bash', arg: 'ls', canAllow: true, answerable: false, blockedBy: 'typed', open: 1,
  })
  assert.equal(promptView([request()], 1500, 1500)?.blockedBy, 'decisive')
  const tooBig = request({ tool: 'AskUserQuestion', questions: [q('A?', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])] })
  assert.deepEqual([promptView([tooBig], null, null)?.answerable, promptView([tooBig], null, null)?.blockedBy], [false, 'size'])
})

test('despite earlier typing, every decision is written and still confirmed or reported as differing', async () => {
  const plan = request({ tool: 'ExitPlanMode', plan: 'p' })
  const asked = request({ tool: 'AskUserQuestion', questions: [q('A?', ['x', 'y'])] })
  const cases: [string, OpenRequest, Parameters<typeof writeAnswer>[3], unknown, string[]][] = [
    ['allow', request(), 'allow', undefined, ['1']],
    ['deny', request(), 'deny', undefined, ['\x1b']],
    ['answer', asked, 'answer', [[1]], ['2']],
    ['approve', plan, 'approve', undefined, ['2']],
    ['approve-auto', plan, 'approve-auto', undefined, ['1']],
  ]
  for (const [label, prompt, decision, selections, keys] of cases) {
    const refused = rig([prompt])
    refused.type(1500)
    await assert.rejects(writeAnswer(refused.deps, 's', 'r1', decision, selections), { code: 'PROMPT_GONE' }, `${label} without the flag`)
    const r = rig([prompt])
    r.type(1500)
    await writeAnswer(r.deps, 's', 'r1', decision, selections, r.seq())
    assert.deepEqual(r.written, keys, label)
  }
  const confirmed = rig([asked], { toolUseId: 't1', answers: { 'A?': 'y' }, permissionMode: 'default' })
  confirmed.type(1500)
  assert.equal(await writeAnswer(confirmed.deps, 's', 'r1', 'answer', [[1]], confirmed.seq()), 'confirmed')
  const differing = rig([plan], { toolUseId: 't1', answers: null, permissionMode: 'default' })
  differing.type(1500)
  assert.equal(await writeAnswer(differing.deps, 's', 'r1', 'approve-auto', undefined, differing.seq()), 'mismatch')
})

test('despite earlier typing, a keystroke after the answer arrived withholds the next key', async () => {
  const first = rig([request()])
  first.type(1500)
  const arrived = first.seq()
  first.type(1600)
  await assert.rejects(writeAnswer(first.deps, 's', 'r1', 'allow', undefined, arrived), { code: 'PROMPT_GONE' })
  assert.deepEqual(first.written, [])

  const asked = request({ tool: 'AskUserQuestion', questions: [q('A?', ['x', 'y']), q('B?', ['u', 'v'])] })
  const later = rig([asked])
  later.type(1500)
  later.between.push(() => later.type(2100))
  assert.equal(await writeAnswer(later.deps, 's', 'r1', 'answer', [[0], [1]], later.seq()), 'partial')
  assert.deepEqual(later.written, ['1'])
})

test('despite earlier typing does not lift a deciding key or any other block', async () => {
  const cases: [string, (r: ReturnType<typeof rig>) => void][] = [
    ['a deciding key before the call', (r) => r.decide(1500)],
    ['two open', (r) => r.setRequests([request(), request({ id: 'r2' })])],
    ['another id', (r) => r.setRequests([request({ id: 'r9' })])],
    ['stirred', (r) => r.setRequests([request({ stirred: true })])],
    ['answered before', (r) => r.setRequests([request({ answeredAt: 1 })])],
  ]
  for (const [label, arrange] of cases) {
    const r = rig([request()])
    r.type(1400)
    arrange(r)
    await assert.rejects(writeAnswer(r.deps, 's', 'r1', 'deny', undefined, r.seq()), { code: 'PROMPT_GONE' }, label)
    assert.deepEqual(r.written, [], label)
    assert.deepEqual(r.dismissed, [], label)
  }
  const big = request({ tool: 'AskUserQuestion', questions: [q('A?', ['1', '2', '3', '4', '5', '6', '7', '8', '9'])] })
  const sized = rig([big])
  sized.type(1500)
  await assert.rejects(writeAnswer(sized.deps, 's', 'r1', 'answer', [[0]], sized.seq()), { code: 'NOT_ANSWERABLE' })
  assert.deepEqual(sized.written, [])
})
