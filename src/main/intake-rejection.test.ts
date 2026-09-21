import assert from 'node:assert/strict'
import test from 'node:test'

import { isPermanentRejection } from './intake-rejection'
import type { IntakeRejection } from './intake-schema'

/**
 * **十一個值逐一釘住。**
 *
 * 這份清單本身就是那條 requirement 的載體：少一個值，`switch` 編不過；
 * 判錯一個，這裡紅。
 */
const PERMANENT: IntakeRejection[] = [
  'TOO_LONG',
  'TOO_LARGE',
  'INVALID_ID',
  'MISSING_ID',
  'FIELD_TYPE',
  'TARGET_NOT_FOUND',
  'TARGET_AMBIGUOUS',
]

const TRANSIENT: IntakeRejection[] = ['MALFORMED', 'CAPACITY', 'PREFILL_UNAVAILABLE']

for (const code of PERMANENT) {
  test(`${code} 為永久性 —— 重送必然同樣失敗`, () => {
    assert.equal(isPermanentRejection({ code, notify: true }), true)
  })
}

for (const code of TRANSIENT) {
  test(`${code} 為暫時性 —— 狀態或設定改變後可能成功`, () => {
    assert.equal(isPermanentRejection({ code, notify: true }), false)
  })
}

test('PREFILL_UNAVAILABLE 為暫時性，因為它取決於一個使用者可以打開的偏好', () => {
  // 它與 CAPACITY 同類，即使兩者的 `consume` 在程式碼裡是相反的 ——
  // 判準是「使用者不改變設定的情況下重送會不會不同」，不是 `consume`。
  assert.equal(isPermanentRejection({ code: 'PREFILL_UNAVAILABLE', notify: true }), false)
  assert.equal(isPermanentRejection({ code: 'CAPACITY', notify: true }), false)
})

test('DUPLICATE 依 outcome 而非依代碼 —— 一個代碼承載兩種行為', () => {
  // 內容相同的重送：靜默，根本不是一次失敗。
  assert.equal(isPermanentRejection({ code: 'DUPLICATE', notify: false }), false)
  // 內容不同＝識別碼搶佔：同一個識別碼再送一次仍然撞上同一筆。
  assert.equal(isPermanentRejection({ code: 'DUPLICATE', notify: true }), true)
})

test('十一個值全部被分類 —— 沒有一個落在未列舉的縫裡', () => {
  const all = new Set<IntakeRejection>([...PERMANENT, ...TRANSIENT, 'DUPLICATE'])
  assert.equal(all.size, 11, '`IntakeRejection` 有十一個值；這裡少一個就表示有一個沒被釘住')
})
