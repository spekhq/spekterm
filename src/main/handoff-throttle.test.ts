import assert from 'node:assert/strict'
import test from 'node:test'

import { HandoffThrottle } from './handoff-throttle'

test('窗內超過上限之後不再放行', () => {
  const throttle = new HandoffThrottle({ max: 2, windowMs: 1000, now: () => 0 })
  assert.equal(throttle.take(), true)
  assert.equal(throttle.take(), true)
  assert.equal(throttle.take(), false)
})

test('上限是全域的 —— 它不認得來源，換一個來源也拿不到名額', () => {
  // 介面上根本沒有「來源」這個參數：per-source 的計數**表達不出來**。
  // 那不是簡化，是這道上限唯一要擋的情境（agent 輪流寫進別人的落點）的直接後果。
  const throttle = new HandoffThrottle({ max: 1, windowMs: 1000, now: () => 0 })
  assert.equal(throttle.take(), true)
  assert.equal(throttle.take(), false)
})

test('窗滑過去之後名額釋放', () => {
  let clock = 0
  const throttle = new HandoffThrottle({ max: 1, windowMs: 1000, now: () => clock })
  assert.equal(throttle.take(), true)
  clock = 999
  assert.equal(throttle.take(), false)
  clock = 1000
  assert.equal(throttle.take(), true)
})
