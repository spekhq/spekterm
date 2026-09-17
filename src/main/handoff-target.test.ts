import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveTarget } from './handoff-target'

const candidates = [
  { id: 'f1', name: 'billservice', path: '/home/u/git/billservice' },
  { id: 'f2', name: 'spekterm', path: '/home/u/git/spekterm' },
]

const twins = [
  { id: 'f1', name: 'common', path: '/home/u/a/common' },
  { id: 'f2', name: 'common', path: '/home/u/b/common' },
]

test('名稱完整相等即命中，且不分大小寫', () => {
  assert.deepEqual(resolveTarget('BillService', candidates), { ok: true, folderId: 'f1' })
})

test('前綴不算命中 —— 這條路徑沒有人在看，猜錯的代價是開在別的 repo', () => {
  assert.deepEqual(resolveTarget('bill', candidates), { ok: false, reason: 'NOT_FOUND' })
})

test('子字串不算命中', () => {
  assert.deepEqual(resolveTarget('service', candidates), { ok: false, reason: 'NOT_FOUND' })
})

test('絕對路徑命中', () => {
  assert.deepEqual(resolveTarget('/home/u/git/spekterm', candidates), { ok: true, folderId: 'f2' })
})

test('同名者使解析拒絕，並列出候選', () => {
  const result = resolveTarget('common', twins)
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.reason, 'AMBIGUOUS')
  assert.deepEqual(result.ok === false && result.reason === 'AMBIGUOUS' ? result.candidates : [], [
    '/home/u/a/common',
    '/home/u/b/common',
  ])
})

test('以絕對路徑化解同名歧義', () => {
  assert.deepEqual(resolveTarget('/home/u/b/common', twins), { ok: true, folderId: 'f2' })
})

test('尾端的分隔符不影響路徑比對', () => {
  assert.deepEqual(resolveTarget('/home/u/git/billservice/', candidates), { ok: true, folderId: 'f1' })
})

test('空字串不命中任何東西', () => {
  assert.deepEqual(resolveTarget('   ', candidates), { ok: false, reason: 'NOT_FOUND' })
})

test('清單縮小之後零命中是正常結果，不是異常', () => {
  assert.deepEqual(resolveTarget('billservice', []), { ok: false, reason: 'NOT_FOUND' })
})

test('目標等於來源是合法的 —— 在同一個 repo 開一個乾淨的 session 接手', () => {
  assert.deepEqual(resolveTarget('billservice', candidates), { ok: true, folderId: 'f1' })
})
