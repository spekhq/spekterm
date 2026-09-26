import assert from 'node:assert/strict'
import test from 'node:test'

import { sessionExists, type ExistenceInput } from './existence'

const base: ExistenceInput = {
  inList: true,
  exited: false,
  folderInWorkspace: true,
  provisional: false,
  ptyAlive: false,
}

/**
 * **這張表是兩端共用的規格。** 主行程與 renderer 的轉接各自有測試，但規則本身只在這裡被釘住。
 */
const CASES: [string, Partial<ExistenceInput>, boolean][] = [
  ['正常、休眠（沒有 pty）', {}, true],
  ['正常、執行中', { ptyAlive: true }, true],
  ['不在清單中（已關閉）', { inList: false }, false],
  ['行程已結束而分頁仍在', { exited: true }, false],
  ['所屬 folder 被移出 workspace', { folderInWorkspace: false }, false],
  ['暫定且 pty 活著', { provisional: true, ptyAlive: true }, true],
  ['暫定且 pty 已死（renderer 在持久化之前重新載入）', { provisional: true, ptyAlive: false }, false],
]

for (const [label, patch, expected] of CASES) {
  test(`存在的判定：${label}`, () => {
    assert.equal(sessionExists({ ...base, ...patch }), expected)
  })
}
