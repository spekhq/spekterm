import assert from 'node:assert/strict'
import test from 'node:test'

import {
  confirmSubmit,
  forgetInput,
  isMovingKey,
  isSubmittingEnter,
  isTerminalReport,
  keystrokeSeq,
  lastDecisiveAt,
  lastKeystrokeAt,
  noteSubmitted,
  noteWrite,
  onKeystroke,
  setOwnRequestSource,
  submittedSeqOf,
} from './pty-input'

test('keys, pastes and replies are keystrokes', () => {
  forgetInput('s')
  noteWrite('s', '1', undefined, 10)
  assert.equal(lastKeystrokeAt('s'), 10)
  noteWrite('s', 'hello\r', undefined, 20)
  assert.equal(lastKeystrokeAt('s'), 20)
  noteWrite('s', '\x1b', undefined, 30)
  assert.equal(lastKeystrokeAt('s'), 30, 'Esc is a key')
})

test('an answer\'s own keys and the terminal\'s focus and mouse reports are not', () => {
  forgetInput('t')
  for (const report of ['\x1b[I', '\x1b[O', '\x1b[I\x1b[O', '\x1b[M !!', '\x1b[<0;12;5M', '\x1b[<0;12;5m']) {
    assert.equal(isTerminalReport(report), true, JSON.stringify(report))
    noteWrite('t', report, undefined, 5)
  }
  noteWrite('t', '1', 'answer', 5)
  assert.equal(lastKeystrokeAt('t'), null)
  // A report glued to a real key is a keystroke.
  assert.equal(isTerminalReport('\x1b[Ix'), false)
})

test("xterm's answers to the agent's startup queries are the terminal's, and keys are not", () => {
  // DECRPM: xterm.js's answers to the DECRQM queries CLI 2.1.303 sends at startup (2026 and 1016, measured).
  for (const answer of ['\x1b[?1;2c', '\x1b[>0;276;0c', '\x1bP>|xterm.js(6.1.0-beta.302)\x1b\\', '\x1b[?0u', '\x1b[?1;2c\x1b[?0u', '\x1b[?2026;2$y', '\x1b[?1016;2$y', '\x1b[?2026;2$y\x1b[?1016;2$y']) {
    assert.equal(isTerminalReport(answer), true, JSON.stringify(answer))
  }
  // Keys, including kitty-encoded ones and modified arrows, stay keystrokes.
  for (const key of ['\x1b[97u', '\x1b[1;5A', '\x1b[A', 'c', '\x1b[?1;2cx', '\x1b[13;2u', '\x1b[?2026;2$yx', '$y']) {
    assert.equal(isTerminalReport(key), false, JSON.stringify(key))
  }
})

test('listeners hear each keystroke', () => {
  const heard: string[] = []
  const off = onKeystroke((id) => heard.push(id))
  noteWrite('u', 'k', undefined, 1)
  noteWrite('u', '\x1b[O', undefined, 2)
  off()
  noteWrite('u', 'k', undefined, 3)
  assert.deepEqual(heard, ['u'])
})

test('keystrokes are counted, also two in the same millisecond, and reports and answers are not', () => {
  forgetInput('c')
  assert.equal(keystrokeSeq('c'), 0)
  noteWrite('c', 'a', undefined, 7)
  noteWrite('c', 'b', undefined, 7)
  assert.equal(keystrokeSeq('c'), 2)
  noteWrite('c', '\x1b[I', undefined, 8)
  noteWrite('c', '1', 'answer', 8)
  noteWrite('c', '', undefined, 8)
  assert.equal(keystrokeSeq('c'), 2)
})

test('moving keys are only the measured ones; every other keystroke is deciding (remote-answer-despite-typed D4)', () => {
  const moving = ['\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D', '\x1bOA', '\x1bOB', '\x1bOC', '\x1bOD', '\t', 'a', 'Z', ' ']
  for (const key of moving) {
    forgetInput('m')
    noteWrite('m', key, undefined, 10)
    assert.equal(lastKeystrokeAt('m'), 10, JSON.stringify(key))
    assert.equal(lastDecisiveAt('m'), null, JSON.stringify(key))
  }
  const deciding = [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '\r', '\x1b', '\x1b[Z', '\x03', '\x7f', '\x1b[1;3A', '\x1ba',
    '\x1bOP', '\x1b[15~', '?', '中文', '\uff11', '\x1b[200~abc\x1b[201~', 'ab1',
  ]
  for (const key of deciding) {
    forgetInput('d')
    noteWrite('d', key, undefined, 20)
    assert.equal(lastDecisiveAt('d'), 20, JSON.stringify(key))
    assert.equal(isMovingKey(key), false, JSON.stringify(key))
  }
  forgetInput('e')
  noteWrite('e', '1', 'answer', 30)
  noteWrite('e', '\x1b[I', undefined, 30)
  assert.equal(lastDecisiveAt('e'), null, "an answer's own key and a terminal report are neither")
  noteWrite('e', '\r', undefined, 40)
  forgetInput('e')
  assert.equal(lastDecisiveAt('e'), null, 'forgotten')
})

test('a deciding keystroke is recorded before the listeners hear it', () => {
  forgetInput('l')
  const seen: (number | null)[] = []
  const off = onKeystroke((id) => seen.push(lastDecisiveAt(id)))
  noteWrite('l', '1', undefined, 50)
  off()
  assert.deepEqual(seen, [50])
})

// `quick-replies` D2: what may still be in the agent's input box.

test('a submitting Enter ends with CR, not after ESC, not inside a paste', () => {
  for (const data of ['\r', 'hello\r', 'two\nlines\r', '\x1b[200~pasted\x1b[201~\r']) {
    assert.equal(isSubmittingEnter(data), true, JSON.stringify(data))
  }
  // Alt+Enter (a line break), a bracketed paste holding a line break, a paste cut mid-way, no CR.
  for (const data of ['\x1b\r', 'text\x1b\r', '\x1b[200~line1\rline2\x1b[201~', '\x1b[200~line1\r', 'hello', '\r\n']) {
    assert.equal(isSubmittingEnter(data), false, JSON.stringify(data))
  }
})

test('an own submission confirms the last submitting Enter at or before it', () => {
  forgetInput('b1')
  setOwnRequestSource(() => false)
  noteSubmitted('b1')
  noteWrite('b1', 'fix the', undefined, 100)
  assert.equal(submittedSeqOf('b1'), 0)
  noteWrite('b1', '\r', undefined, 200)
  noteWrite('b1', 'x', undefined, 300)
  confirmSubmit('b1', 257)
  assert.equal(submittedSeqOf('b1'), 2, 'the Enter is submitted; the key after it is not')
  assert.ok(keystrokeSeq('b1') > submittedSeqOf('b1'))
})

test('a submission with no submitting Enter since the baseline moves nothing (a notice)', () => {
  forgetInput('b2')
  setOwnRequestSource(() => false)
  noteWrite('b2', '\r', undefined, 50)
  confirmSubmit('b2', 60)
  noteWrite('b2', 'fix the', undefined, 100)
  const before = submittedSeqOf('b2')
  confirmSubmit('b2', 5000)
  assert.equal(submittedSeqOf('b2'), before)
  assert.ok(keystrokeSeq('b2') > submittedSeqOf('b2'))
})

test('a submission earlier than the only Enter moves nothing', () => {
  forgetInput('b3')
  setOwnRequestSource(() => false)
  noteWrite('b3', 'a\r', undefined, 500)
  confirmSubmit('b3', 400)
  assert.equal(submittedSeqOf('b3'), 0)
})

test('a later Enter does not hide the one a submission confirms', () => {
  forgetInput('b4')
  setOwnRequestSource(() => false)
  noteWrite('b4', 'one\r', undefined, 100)
  noteWrite('b4', '\r', undefined, 300)
  confirmSubmit('b4', 157)
  assert.equal(submittedSeqOf('b4'), 1)
})

test('Alt+Enter, a paste with a line break and an Enter answering an open request are not submitting Enters', () => {
  forgetInput('b5')
  setOwnRequestSource(() => false)
  noteWrite('b5', 'draft', undefined, 10)
  noteWrite('b5', '\x1b\r', undefined, 20)
  confirmSubmit('b5', 30)
  noteWrite('b5', '\x1b[200~a\rb\x1b[201~', undefined, 40)
  confirmSubmit('b5', 50)
  assert.equal(submittedSeqOf('b5'), 0, 'neither a line break nor a paste submits')
  setOwnRequestSource((id) => id === 'b5')
  noteWrite('b5', '\r', undefined, 60)
  setOwnRequestSource(() => false)
  confirmSubmit('b5', 70)
  assert.equal(submittedSeqOf('b5'), 0, 'the Enter answered the prompt')
})

test('noteSubmitted takes the current count; an answer\'s keys are not typing', () => {
  forgetInput('b6')
  noteWrite('b6', 'abc', undefined, 10)
  noteWrite('b6', '\r', undefined, 20)
  noteSubmitted('b6')
  assert.equal(submittedSeqOf('b6'), keystrokeSeq('b6'))
  noteWrite('b6', '1', 'answer', 30)
  assert.equal(submittedSeqOf('b6'), keystrokeSeq('b6'))
})
