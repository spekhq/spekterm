import assert from 'node:assert/strict'
import test from 'node:test'

import type { RowState } from './attention'
import { BUCKET_OF, BUCKET_ORDER, summarize } from './summary'

const ALL: RowState[] = ['choice', 'waiting', 'error', 'working', 'idleBackground', 'running', 'unknown', 'idle', 'dormant', 'ended']

test('every row state has a bucket, and the buckets are listed in order of urgency, ended last', () => {
  for (const state of ALL) assert.ok(BUCKET_OF[state], state)
  assert.deepEqual(BUCKET_ORDER, ['needsYou', 'error', 'working', 'idleBackground', 'running', 'idle', 'hibernated', 'ended'])
})

test('choice and waiting count together; running and unknown count together', () => {
  const summary = summarize(ALL.map((state) => ({ state, item: state })))
  assert.deepEqual(
    summary.map(({ bucket, items }) => [bucket, items]),
    [
      ['needsYou', ['choice', 'waiting']],
      ['error', ['error']],
      ['working', ['working']],
      ['idleBackground', ['idleBackground']],
      ['running', ['running', 'unknown']],
      ['idle', ['idle']],
      ['hibernated', ['dormant']],
      ['ended', ['ended']],
    ],
  )
})

test('only states with a session are listed, the most urgent first, items in the given order', () => {
  const summary = summarize<string>([
    { state: 'dormant', item: 'a' },
    { state: 'working', item: 'b' },
    { state: 'dormant', item: 'c' },
  ])
  assert.deepEqual(
    summary.map(({ bucket, items }) => [bucket, items]),
    [
      ['working', ['b']],
      ['hibernated', ['a', 'c']],
    ],
  )
  assert.deepEqual(summarize([]), [])
})

test('idle with background work and idle are two entries', () => {
  const summary = summarize<string>([
    { state: 'idle', item: 'a' },
    { state: 'idleBackground', item: 'b' },
  ])
  assert.deepEqual(
    summary.map(({ bucket, items }) => [bucket, items]),
    [
      ['idleBackground', ['b']],
      ['idle', ['a']],
    ],
  )
})
