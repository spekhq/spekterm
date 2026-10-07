import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initialMaximizeState, type MaximizeState, maximizeReducer } from './maximize-state'

const graphShown: MaximizeState = { maximized: true, viz: 'graph', seenAttention: 3 }

test('the application starts restored, with no visualization', () => {
  assert.deepEqual(initialMaximizeState(7), { maximized: false, viz: null, seenAttention: 7 })
})

test('choosing Graph maximizes and shows it; switching to Timeline keeps it maximized', () => {
  const graph = maximizeReducer(initialMaximizeState(0), { type: 'chooseViz', kind: 'graph' })
  assert.deepEqual(graph, { maximized: true, viz: 'graph', seenAttention: 0 })
  assert.deepEqual(maximizeReducer(graph, { type: 'chooseViz', kind: 'timeline' }), {
    maximized: true,
    viz: 'timeline',
    seenAttention: 0,
  })
})

test('every way out of the maximized state leaves Graph too', () => {
  for (const action of [
    { type: 'restore' } as const,
    { type: 'toggle' } as const,
    { type: 'attention', value: 4 } as const,
  ]) {
    const next = maximizeReducer(graphShown, action)
    assert.equal(next.maximized, false, action.type)
    assert.equal(next.viz, null, `${action.type} must leave Graph`)
    // ...so the next maximize shows the panel's own view, not Graph.
    assert.equal(maximizeReducer(next, { type: 'maximize' }).viz, null, action.type)
  }
})

test('leaving Graph keeps the side panel maximized', () => {
  assert.deepEqual(maximizeReducer(graphShown, { type: 'leaveViz' }), {
    maximized: true,
    viz: null,
    seenAttention: 3,
  })
})

test('attention restores only when the value moved', () => {
  assert.equal(maximizeReducer(graphShown, { type: 'attention', value: 3 }), graphShown)
  const moved = maximizeReducer(graphShown, { type: 'attention', value: 4 })
  assert.equal(moved.maximized, false)
  assert.equal(moved.seenAttention, 4)
})

test('attention while restored only records the value', () => {
  const state = initialMaximizeState(1)
  assert.deepEqual(maximizeReducer(state, { type: 'attention', value: 2 }), {
    maximized: false,
    viz: null,
    seenAttention: 2,
  })
})

test('toggle maximizes a restored panel without a visualization', () => {
  assert.deepEqual(maximizeReducer(initialMaximizeState(0), { type: 'toggle' }), {
    maximized: true,
    viz: null,
    seenAttention: 0,
  })
})
