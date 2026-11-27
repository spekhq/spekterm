import assert from 'node:assert/strict'
import test from 'node:test'

import { attentionOf, mostUrgent, type AttentionInput } from './attention'

const base: AttentionInput = { wait: 'ready', inTurn: false, seen: true, choiceTypedOver: false, background: false }

test('a ready agent is idle when seen and waiting when not', () => {
  assert.equal(attentionOf({ ...base, seen: true }), 'idle')
  assert.equal(attentionOf({ ...base, seen: false }), 'waiting')
})

test('an open choice is a choice whatever the seen mark says', () => {
  assert.equal(attentionOf({ ...base, wait: 'awaiting-choice', seen: true }), 'choice')
  assert.equal(attentionOf({ ...base, wait: 'awaiting-choice', seen: false }), 'choice')
})

test('a choice typed over reads as the turn-ended row', () => {
  assert.equal(attentionOf({ ...base, wait: 'awaiting-choice', choiceTypedOver: true, seen: true }), 'idle')
  assert.equal(attentionOf({ ...base, wait: 'awaiting-choice', choiceTypedOver: true, seen: false }), 'waiting')
})

test('busy is working only within a turn; a late subagent tool start reads as the turn-ended row', () => {
  // Control: ignore `inTurn` for busy → the second and third assertions go red.
  assert.equal(attentionOf({ ...base, wait: 'busy', inTurn: true }), 'working')
  assert.equal(attentionOf({ ...base, wait: 'busy', inTurn: false, seen: false }), 'waiting')
  assert.equal(attentionOf({ ...base, wait: 'busy', inTurn: false, seen: true }), 'idle')
})

test('background work changes only the idle row', () => {
  // Control: drop the `background` branch → the first assertion goes red.
  assert.equal(attentionOf({ ...base, background: true }), 'idleBackground')
  assert.equal(attentionOf({ ...base, seen: false, background: true }), 'waiting', 'waiting wins and is not annotated')
  assert.equal(attentionOf({ ...base, wait: 'busy', inTurn: true, background: true }), 'working')
  assert.equal(attentionOf({ ...base, wait: 'awaiting-choice', background: true }), 'choice')
  assert.equal(attentionOf({ ...base, wait: 'unknown', background: true }), 'unknown')
})

test('the paths into the idle row reach idle with background work too', () => {
  assert.equal(attentionOf({ ...base, wait: 'busy', inTurn: false, background: true }), 'idleBackground', 'a late subagent tool start')
  assert.equal(attentionOf({ ...base, wait: 'awaiting-choice', choiceTypedOver: true, background: true }), 'idleBackground')
  // A Stop listing a running subagent holds the turn open: ready, in a turn, and seen (`wait-seen.ts`).
  assert.equal(attentionOf({ ...base, inTurn: true, background: true }), 'idleBackground', 'a turn held open')
})

test('an unknown wait state is unknown', () => {
  assert.equal(attentionOf({ ...base, wait: 'unknown', seen: false }), 'unknown')
  assert.equal(attentionOf({ ...base, wait: 'unknown', inTurn: true }), 'unknown')
})

test('ranking: choice/waiting > error > working > idle with background > running > idle > dormant/ended', () => {
  assert.equal(mostUrgent(['idle', 'idleBackground']), 'idleBackground')
  assert.equal(mostUrgent(['running', 'idleBackground']), 'idleBackground', 'a running shell does not hide it')
  assert.equal(mostUrgent(['idleBackground', 'working']), 'working')
  assert.equal(mostUrgent(['idle', 'working', 'waiting']), 'waiting')
  assert.equal(mostUrgent(['working', 'choice']), 'choice')
  assert.equal(mostUrgent(['working', 'error']), 'error')
  assert.equal(mostUrgent(['running', 'working', 'idle']), 'working')
  assert.equal(mostUrgent(['idle', 'running']), 'running')
  assert.equal(mostUrgent(['dormant', 'idle']), 'idle')
  assert.equal(mostUrgent(['ended', 'dormant']), 'ended')
})

test('an item with no session has no state', () => {
  assert.equal(mostUrgent([]), null)
})
