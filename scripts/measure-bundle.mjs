/**
 * renderer bundle 體積報告。
 *
 * `workspace-app-shell` 要求「編輯器對 renderer bundle 的體積貢獻可量測且可歸因」。
 * Phase 0 的作法是與一個寫死的「不含 Monaco」基準相比 —— 那個基準在編輯器成為產品的
 * 一部分之後就不再是這個應用程式，比較也就失去意義。
 *
 * 改為**分類歸因**：編輯器核心（獨立 chunk）、它的 worker、各語言的延遲載入資產、
 * 它的圖示字型，其餘歸「應用程式與其他相依」。四者之和即總體積，不需要任何基準。
 *
 * 同時守住一條界線：建置產物中**不得出現任何語言服務 worker**。唯讀檢視只需要語法標記，
 * 而 `ts.worker` 單獨就佔 12.65 MB —— 比其餘所有產物加起來還大。
 *
 * 用法：npm run measure:bundle
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ASSETS_DIR = join(process.cwd(), 'out', 'renderer', 'assets')
// Since monaco-editor 0.56 the per-language definitions live here (they were `basic-languages`).
// If this directory disappears in a later version, `languageNames` is empty, every language chunk
// falls into "other", and the "at least two language chunks" check below fails — loudly.
const LANGUAGE_DEFINITIONS_DIR = join(
  process.cwd(),
  'node_modules',
  'monaco-editor',
  'esm',
  'vs',
  'languages',
  'definitions',
)

/** 唯讀檢視不需要語意分析。這些 worker 若出現在產物裡，就是有人加回了 `languages/features/*`。 */
const LANGUAGE_SERVICE_WORKERS = ['ts.worker', 'json.worker', 'css.worker', 'html.worker']

const mb = (bytes) => `${(bytes / 1_048_576).toFixed(2)} MB`
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`
const pct = (part, total) => `${((part / total) * 100).toFixed(1)}%`

console.log('  · 重新建置以確保報告反映當前原始碼')
execFileSync('electron-vite', ['build'], { stdio: 'ignore', env: process.env })

/** monaco 的語言 chunk 以語言目錄名為前綴（例如 `freemarker2-BJvIwTvt.js`）。 */
const languageNames = new Set(
  readdirSync(LANGUAGE_DEFINITIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
)

function classify(name) {
  if (/worker.*\.js$/.test(name)) return 'editor-worker'
  // 編輯器的樣式與程式碼一起被切進 `monaco` chunk，兩者都是它的體積貢獻
  if (/^monaco-.*\.(js|css)$/.test(name)) return 'editor-core'
  if (/^codicon-.*\.ttf$/.test(name)) return 'editor-font'

  const stem = name.replace(/-[A-Za-z0-9_-]{8,}\.js$/, '')
  if (stem !== name && languageNames.has(stem)) return 'editor-language'

  return 'other'
}

const LABELS = {
  'editor-core': '編輯器核心',
  'editor-worker': '編輯器 worker',
  'editor-language': '編輯器語言（延遲載入）',
  'editor-font': '編輯器圖示字型',
  other: '應用程式與其他相依',
}

const files = readdirSync(ASSETS_DIR)
  .map((name) => ({ name, size: statSync(join(ASSETS_DIR, name)).size, group: classify(name) }))
  .sort((a, b) => b.size - a.size)

const total = files.reduce((sum, file) => sum + file.size, 0)

const groups = new Map()
for (const file of files) {
  const current = groups.get(file.group) ?? { size: 0, count: 0 }
  groups.set(file.group, { size: current.size + file.size, count: current.count + 1 })
}

console.log('\nrenderer bundle 體積報告\n')
console.log('  資產明細（前 10 大）：')
for (const file of files.slice(0, 10)) {
  console.log(`    ${kb(file.size).padStart(11)}  ${file.name}`)
}

console.log('\n  歸因：')
for (const key of Object.keys(LABELS)) {
  const group = groups.get(key)
  if (!group) continue
  // 中日文字寬度使 padEnd 對不齊，改以固定順序輸出欄位
  console.log(
    `    ${mb(group.size).padStart(9)}  ${pct(group.size, total).padStart(6)}  ` +
      `${String(group.count).padStart(2)} 個  ${LABELS[key]}`,
  )
}

const editorSize = [...groups.entries()]
  .filter(([key]) => key.startsWith('editor-'))
  .reduce((sum, [, group]) => sum + group.size, 0)

console.log(`\n    ${mb(editorSize).padStart(9)}  ${pct(editorSize, total).padStart(6)}  編輯器合計`)
console.log(`    ${mb(total).padStart(9)}  ${'100.0%'.padStart(6)}  renderer 資產總計（${files.length} 個）`)

const failures = []

// 歸因必須是完備的分割：漏掉一類資產，「編輯器貢獻了多少」就會被低估。
const classified = [...groups.values()].reduce((sum, group) => sum + group.size, 0)
if (classified !== total) {
  failures.push(`各分類之和 ${classified} B 不等於資產總計 ${total} B`)
}

const offenders = files.filter((file) =>
  LANGUAGE_SERVICE_WORKERS.some((worker) => file.name.startsWith(worker)),
)
if (offenders.length > 0) {
  failures.push(
    `建置產物中出現語言服務 worker（唯讀檢視不該引入它們）：${offenders.map((f) => f.name).join(', ')}\n` +
      '    檢查 src/renderer/src/editor/ 是否 import 了 monaco-editor/languages/features/*',
  )
}

// 語言資產必須是各自獨立的延遲載入 chunk，而非被併進主要的載入路徑。
const languageAssets = groups.get('editor-language')
if (!languageAssets || languageAssets.count < 2) {
  failures.push(
    `編輯器的語言資產應為多個獨立的延遲載入 chunk，實際 ${languageAssets?.count ?? 0} 個`,
  )
}

if (failures.length > 0) {
  console.error('')
  for (const failure of failures) console.error(`✗ ${failure}`)
  process.exit(1)
}

console.log('\n✓ 分類之和等於資產總計；語言資產為延遲載入；沒有任何語言服務 worker')
