/**
 * desktop-packaging：打包輸出目錄不無限累積產物。
 *
 * ## fixture 必須跨十位數
 *
 * **這一整支的鑑別力都繫在這件事上。** `0.1.1`–`0.1.4` 之下字典序與版本序**結果完全相同**，
 * 於是一個 `.sort()` 的實作會全綠 —— 而它會在第十次打包時把**剛建好的那一份**刪掉。
 * 因此 fixture 一律用 `0.1.8` / `0.1.9` / `0.1.10` / `0.1.11`，並在其中一條裡把「字典序會給出
 * 相反答案」明確斷言出來（一個對照組本身也可能失去鑑別力）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pruneRelease } from './prune-release.mjs'

function makeRelease(names) {
  const dir = mkdtempSync(join(tmpdir(), 'spekterm-release-'))
  for (const name of names) writeFileSync(join(dir, name), 'x')
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('第三次打包後只留下最近兩份產物', () => {
  const { dir, cleanup } = makeRelease([
    'Spekterm-0.1.1.AppImage',
    'Spekterm-0.1.2.AppImage',
    'Spekterm-0.1.3.AppImage',
  ])
  try {
    pruneRelease(dir)
    assert.deepEqual(readdirSync(dir).sort(), ['Spekterm-0.1.2.AppImage', 'Spekterm-0.1.3.AppImage'])
  } finally {
    cleanup()
  }
})

test('版本號跨越十位數時保留的仍是版本序上最新的兩份', () => {
  const names = [
    'Spekterm-0.1.8.AppImage',
    'Spekterm-0.1.9.AppImage',
    'Spekterm-0.1.10.AppImage',
    'Spekterm-0.1.11.AppImage',
  ]
  // 對照組的自檢：這組 fixture 必須真的能分辨兩種實作，否則下面那條斷言測不到任何東西。
  const lexicographic = [...names].sort().slice(-2)
  assert.notDeepEqual(
    lexicographic.sort(),
    ['Spekterm-0.1.10.AppImage', 'Spekterm-0.1.11.AppImage'],
    '字典序必須給出相反的答案 —— 否則這組 fixture 沒有鑑別力',
  )

  const { dir, cleanup } = makeRelease(names)
  try {
    pruneRelease(dir)
    assert.deepEqual(readdirSync(dir).sort(), ['Spekterm-0.1.10.AppImage', 'Spekterm-0.1.11.AppImage'])
  } finally {
    cleanup()
  }
})

test('不刪除輸出目錄中的其他內容', () => {
  const { dir, cleanup } = makeRelease([
    'Spekterm-0.1.1.AppImage',
    'Spekterm-0.1.2.AppImage',
    'Spekterm-0.1.3.AppImage',
    // 手工備份（`.prev` 是本 change 之前的權宜作法）、builder 的中繼檔、以及一個不相干的產物。
    'Spekterm-0.1.0.AppImage.prev',
    'latest-linux.yml',
    'builder-debug.yml',
    'someone-elses.AppImage',
  ])
  try {
    pruneRelease(dir)
    const left = readdirSync(dir).sort()
    for (const keep of ['Spekterm-0.1.0.AppImage.prev', 'latest-linux.yml', 'builder-debug.yml', 'someone-elses.AppImage']) {
      assert.ok(left.includes(keep), `${keep} 不得被刪 —— 比對的是本專案產物的確定形態，不是萬用的 *.AppImage`)
    }
  } finally {
    cleanup()
  }
})

test('尚未打包過時不拋錯', () => {
  assert.deepEqual(pruneRelease(join(tmpdir(), 'spekterm-does-not-exist-' + process.pid)), [])
})

test('each kind of artifact keeps its own two, and a dmg takes its blockmap with it', () => {
  const dmgs = ['0.1.8', '0.1.9', '0.1.10'].flatMap((v) => [
    `Spekterm-${v}-arm64.dmg`,
    `Spekterm-${v}-arm64.dmg.blockmap`,
  ])
  const appImages = ['0.1.8', '0.1.9', '0.1.10'].map((v) => `Spekterm-${v}.AppImage`)
  const { dir, cleanup } = makeRelease([...dmgs, ...appImages, 'notes.txt'])
  try {
    pruneRelease(dir)
    assert.deepEqual(readdirSync(dir).sort(), [
      'Spekterm-0.1.10-arm64.dmg',
      'Spekterm-0.1.10-arm64.dmg.blockmap',
      'Spekterm-0.1.10.AppImage',
      'Spekterm-0.1.9-arm64.dmg',
      'Spekterm-0.1.9-arm64.dmg.blockmap',
      'Spekterm-0.1.9.AppImage',
      'notes.txt',
    ])
  } finally {
    cleanup()
  }
})
