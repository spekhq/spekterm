import assert from 'node:assert/strict'
import test from 'node:test'

import { preselectFolder } from './preselect-folder'

const KNOWN = new Set(['A', 'B', 'C'])

test('只有解析結果 ⇒ 預選它', () => {
  assert.deepEqual(
    preselectFolder({ override: undefined, existingSessionFolderId: undefined, resolvedFolderId: 'A', knownFolderIds: KNOWN }),
    { folderId: 'A', overrideGone: false },
  )
})

test('使用者的改選勝過既有 session 與解析結果', () => {
  assert.deepEqual(
    preselectFolder({ override: 'C', existingSessionFolderId: 'B', resolvedFolderId: 'A', knownFolderIds: KNOWN }),
    { folderId: 'C', overrideGone: false },
  )
})

test('預填逾時退回者預選既有 session 所在的 folder', () => {
  // 第一次接受時改選 B、session 開在 B；解析結果仍是 A。
  assert.deepEqual(
    preselectFolder({ override: undefined, existingSessionFolderId: 'B', resolvedFolderId: 'A', knownFolderIds: KNOWN }),
    { folderId: 'B', overrideGone: false },
  )
})

test('解析不出、也沒有改選或 session ⇒ 空（不替使用者補預設值）', () => {
  assert.deepEqual(
    preselectFolder({ override: undefined, existingSessionFolderId: undefined, resolvedFolderId: undefined, knownFolderIds: KNOWN }),
    { folderId: '', overrideGone: false },
  )
})

test('不在 workspace 的層級被跳過：既有 session 的 folder 已移除 ⇒ 退回解析結果', () => {
  assert.deepEqual(
    preselectFolder({ override: undefined, existingSessionFolderId: 'GONE', resolvedFolderId: 'A', knownFolderIds: KNOWN }),
    { folderId: 'A', overrideGone: false },
  )
})

test('改選指向已移除的 folder ⇒ 空並說明，**不**退回其他層', () => {
  // 退回解析結果等於系統替使用者換了一個地方，而他以為選的是另一個。
  assert.deepEqual(
    preselectFolder({ override: 'GONE', existingSessionFolderId: 'B', resolvedFolderId: 'A', knownFolderIds: KNOWN }),
    { folderId: '', overrideGone: true },
  )
})
