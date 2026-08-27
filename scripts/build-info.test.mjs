/**
 * build-identity：建置身分的產生端。
 *
 * **這支的價值全在對照組。** 〈工作副本不乾淨時標示〉單獨驗不出任何東西 —— 一個恆常回報
 * `dirty: true` 的實作照樣通過。有鑑別力的是它和〈乾淨時不標示〉**成對**出現，而那需要測試
 * 自己造得出兩種 git 工作副本。這正是 `lib/build-info.mjs` 把 repo 根做成參數的理由
 * （design D3：那是承重的，不是彈性）。
 *
 * semver 比較的那一組同理：**fixture 必須跨十位數**。`0.1.1`–`0.1.4` 之下字典序與版本序結果
 * 完全相同，一個字串排序的實作會全綠。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildIdentity, compareVersions, devIdentity } from './lib/build-info.mjs'

const BUILT_AT = '2026-08-27T00:00:00.000Z'

/** 造一個有一個 commit 的乾淨 git 工作副本。 */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'spekterm-buildinfo-'))
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, stdio: 'ignore', env: { ...process.env, LC_ALL: 'C' } })
  git('init', '-q', '.')
  git('config', 'user.email', 'probe@example.com')
  git('config', 'user.name', 'probe')
  writeFileSync(join(root, 'seed.txt'), 'seed\n')
  git('add', '-A')
  git('commit', '-qm', 'seed')
  return { root, git, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('工作副本乾淨時不標示', () => {
  const { root, cleanup } = makeRepo()
  try {
    const info = buildIdentity(root, '1.2.3', BUILT_AT)
    // 對照組的那一半 —— 少了它，一個恆常標示 dirty 的實作會全綠。
    assert.equal(info.dirty, false)
    assert.equal(info.version, '1.2.3')
    assert.equal(info.builtAt, BUILT_AT)
    assert.match(info.commit, /^[0-9a-f]{7,}$/, 'commit 應為短 sha')
  } finally {
    cleanup()
  }
})

test('帶著未提交的變更建置時被標示', () => {
  const { root, cleanup } = makeRepo()
  try {
    writeFileSync(join(root, 'seed.txt'), 'edited\n')
    assert.equal(buildIdentity(root, '1.2.3', BUILT_AT).dirty, true)
  } finally {
    cleanup()
  }
})

test('untracked 檔案同樣算不乾淨', () => {
  const { root, cleanup } = makeRepo()
  try {
    // 產物的原始碼狀態若含一個未被追蹤的檔案，它同樣不對應任何 commit。
    writeFileSync(join(root, 'stray.txt'), 'stray\n')
    assert.equal(buildIdentity(root, '1.2.3', BUILT_AT).dirty, true)
  } finally {
    cleanup()
  }
})

test('取不到 git 狀態時保守地標為 dirty', () => {
  const root = mkdtempSync(join(tmpdir(), 'spekterm-nogit-'))
  try {
    const info = buildIdentity(root, '1.2.3', BUILT_AT)
    // 「不知道」比較接近「不乾淨」—— 一個錯誤地宣稱乾淨的身分，正是這條能力要消滅的那種
    // 看起來很正常的錯誤答案。
    assert.equal(info.dirty, true)
    assert.equal(info.commit, 'unknown')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('兩種身分不必讀值就分得出來，且開發身分不含建置時刻', () => {
  const dev = devIdentity('1.2.3')
  assert.equal(dev.mode, 'development')
  // 開發模式沒有「打包時刻」可言 —— 放進行程啟動時刻就是冒充。
  assert.equal('builtAt' in dev, false)
})

test('semver 比較在跨十位數時仍正確 —— 字典序在此相反', () => {
  assert.ok(compareVersions('0.1.10', '0.1.9') > 0)
  assert.ok(compareVersions('0.1.9', '0.1.10') < 0)
  assert.equal(compareVersions('0.1.9', '0.1.9'), 0)
  assert.ok(compareVersions('0.2.0', '0.1.99') > 0)
  assert.ok(compareVersions('1.0.0', '0.99.99') > 0)
  // 對照組：確認這組 fixture 真的能分辨兩種實作。
  assert.ok('0.1.10' < '0.1.9', '字典序必須給出相反的答案，否則這組 fixture 沒有鑑別力')
})
