/**
 * project-license：第三方授權彙總的純邏輯。
 *
 * 「彙總涵蓋每一個被打包的套件」的**完整性**不在這裡驗 —— 這裡只驗「給定模組清單，對應得對」。
 * 完整性要一個獨立於收集端的來源才驗得出來（sourcemap 的交叉檢查，見 change
 * `open-source-mit` 的 tasks 4.3），否則收集端漏收什麼，驗證就跟著漏什麼。
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  dedupeEntries,
  dedupeNotices,
  legalCommentsOf,
  licenseEntryOf,
  packageRootOf,
  packageRootsOf,
  productionPackagesOf,
  renderSummary,
} from './lib/third-party-licenses.mjs'

test('模組 id 對應到它所屬套件的根目錄', () => {
  assert.equal(packageRootOf('/r/node_modules/react/cjs/react.production.js'), '/r/node_modules/react')
})

test('scoped 套件多取一段', () => {
  assert.equal(packageRootOf('/r/node_modules/@xterm/xterm/lib/xterm.mjs'), '/r/node_modules/@xterm/xterm')
})

test('巢狀依賴屬於最內層的那個套件，不屬於外層', () => {
  assert.equal(
    packageRootOf('/r/node_modules/@spekjs/ui/node_modules/d3-force/src/index.js'),
    '/r/node_modules/@spekjs/ui/node_modules/d3-force',
  )
})

test('查詢字串先去掉', () => {
  assert.equal(packageRootOf('/r/node_modules/react/index.js?commonjs-proxy'), '/r/node_modules/react')
})

test('虛擬模組與 repo 自己的原始碼不是第三方套件', () => {
  assert.equal(packageRootOf('\0vite/preload-helper.js'), null)
  assert.equal(packageRootOf('/r/src/renderer/src/main.tsx'), null)
  assert.equal(packageRootOf('/r/node_modules/'), null)
  assert.equal(packageRootOf('/r/node_modules/@scope/'), null)
})

test('Windows 的反斜線路徑也對應得到', () => {
  assert.equal(packageRootOf('C:\\r\\node_modules\\react\\index.js'), 'C:/r/node_modules/react')
})

test('同一個套件的多個模組只列一次，且排序', () => {
  assert.deepEqual(
    packageRootsOf([
      '/r/node_modules/react/index.js',
      '/r/src/a.ts',
      '/r/node_modules/react/cjs/react.production.js',
      '/r/node_modules/@a/b/x.js',
    ]),
    ['/r/node_modules/@a/b', '/r/node_modules/react'],
  )
})

test('原樣出貨的依賴：dev 與 link 不算，devOptional 保留', () => {
  const lock = {
    packages: {
      '': { name: 'spekterm' },
      'node_modules/i18next': {},
      'node_modules/typescript': { dev: true },
      'node_modules/fsevents': { devOptional: true },
      'node_modules/linked': { link: true },
      'node_modules/a/node_modules/b': {},
    },
  }
  assert.deepEqual(productionPackagesOf(lock), [
    'node_modules/a/node_modules/b',
    'node_modules/fsevents',
    'node_modules/i18next',
  ])
})

function fixturePackage(pkg, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'third-party-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  return dir
}

test('條目帶著授權檔與套件自附的第三方聲明，其他檔案不算', (t) => {
  const dir = fixturePackage(
    { name: 'm', version: '1.0.0', license: 'MIT' },
    { 'LICENSE.md': 'MIT text\n', 'ThirdPartyNotices.txt': 'vendored notices', 'README.md': 'readme' },
  )
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const entry = licenseEntryOf(dir)
  assert.equal(entry.license, 'MIT')
  assert.deepEqual(
    entry.texts.map(({ file, text }) => [file, text]),
    [
      ['LICENSE.md', 'MIT text'],
      ['ThirdPartyNotices.txt', 'vendored notices'],
    ],
  )
})

test('沒有授權檔的套件：條目仍在，只是沒有本文', (t) => {
  const dir = fixturePackage({ name: 'bare', version: '2.0.0', license: 'ISC' })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const entry = licenseEntryOf(dir)
  assert.equal(entry.texts.length, 0)
  assert.match(renderSummary([entry]), /does not include a license file; its package\.json declares: ISC/)
})

test('舊式的 licenses 陣列與物件形式的 license 都讀得到', (t) => {
  const a = fixturePackage({ name: 'a', version: '1', licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })
  const b = fixturePackage({ name: 'b', version: '1', license: { type: 'BSD-3-Clause' } })
  const c = fixturePackage({ name: 'c', version: '1' })
  t.after(() => [a, b, c].forEach((dir) => rmSync(dir, { recursive: true, force: true })))
  assert.equal(licenseEntryOf(a).license, 'MIT OR Apache-2.0')
  assert.equal(licenseEntryOf(b).license, 'BSD-3-Clause')
  assert.equal(licenseEntryOf(c).license, 'UNKNOWN')
})

test('同名同版只留一份，依名稱排序', () => {
  const entry = (name, version) => ({ name, version, license: 'MIT', texts: [] })
  assert.deepEqual(
    dedupeEntries([entry('z', '1'), entry('a', '2'), entry('a', '1'), entry('z', '1')]).map(
      ({ name, version }) => `${name}@${version}`,
    ),
    ['a@1', 'a@2', 'z@1'],
  )
})

test('保留註解：/*! 與 @license／@preserve 留下，一般註解不留', () => {
  const source = [
    '/*! @license Vendored 1.0 | MIT */',
    '/** ordinary doc comment */',
    '/**\n * @license React\n * MIT\n */',
    '/* @preserve keep me */',
    'const x = 1 /* inline */',
  ].join('\n')
  assert.deepEqual(legalCommentsOf(source), [
    '/*! @license Vendored 1.0 | MIT */',
    '/**\n * @license React\n * MIT\n */',
    '/* @preserve keep me */',
  ])
})

test('相同的聲明依內容合併，列出所有來源', () => {
  const merged = dedupeNotices([
    { source: 'b/x.js', comment: '/*! same */' },
    { source: 'a/y.js', comment: '/*! same */' },
    { source: 'c/z.js', comment: '/*! other */' },
  ])
  assert.deepEqual(merged, [
    { comment: '/*! same */', sources: ['a/y.js', 'b/x.js'] },
    { comment: '/*! other */', sources: ['c/z.js'] },
  ])
})

test('彙總寫出每一個條目與內嵌聲明', () => {
  const text = renderSummary(
    [{ name: 'react', version: '19.0.0', license: 'MIT', texts: [{ file: 'LICENSE', text: 'MIT License' }] }],
    [{ comment: '/*! @license Vendored */', sources: ['monaco-editor/esm/vendored.js'] }],
  )
  assert.match(text, /^react@19\.0\.0\nLicense: MIT\n-+\nMIT License$/m)
  assert.match(text, /From: monaco-editor\/esm\/vendored\.js\n\/\*! @license Vendored \*\//)
})
