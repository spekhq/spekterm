/**
 * renderer bundle 體積報告 —— 支撐 PRD §8.3「視打包大小再定」的判定依據。
 *
 * 基準值（不含 Monaco 的 React 19 + Tailwind v4 骨架）為 0.55 MB，實測於本 change
 * 引入 monaco-editor 之前。要重現該基準：移除 src/renderer/src/editor 的匯入後
 * 重新 build，或 checkout 引入 Monaco 之前的 commit。
 *
 * 用法：npm run measure:bundle
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 不含 Monaco 的骨架（React 19 + Tailwind v4），單位 bytes */
const BASELINE_BYTES = 565_280 // 557.58 kB (js) + 7.70 kB (css)

const ASSETS_DIR = join(process.cwd(), 'out', 'renderer', 'assets')

const mb = (bytes) => `${(bytes / 1_048_576).toFixed(2)} MB`
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`

/** Monaco 專屬的 chunk：worker、語言服務、語言 tokenizer、圖示字型 */
function isMonacoChunk(name) {
  return /\.worker-|^tsMode-|^markdown-|^codicon-/.test(name)
}

console.log('  · 重新建置以確保報告反映當前原始碼')
execFileSync('electron-vite', ['build'], { stdio: 'ignore', env: process.env })

const files = readdirSync(ASSETS_DIR)
  .map((name) => ({ name, size: statSync(join(ASSETS_DIR, name)).size }))
  .sort((a, b) => b.size - a.size)

const total = files.reduce((sum, f) => sum + f.size, 0)
const monacoChunks = files.filter((f) => isMonacoChunk(f.name))
const monacoChunkBytes = monacoChunks.reduce((sum, f) => sum + f.size, 0)

console.log('\nrenderer bundle 體積報告\n')
console.log('  資產明細（前 8 大）：')
for (const f of files.slice(0, 8)) {
  const tag = isMonacoChunk(f.name) ? 'monaco' : '  ——  '
  console.log(`    ${kb(f.size).padStart(11)}  [${tag}]  ${f.name}`)
}

const attributable = total - BASELINE_BYTES

console.log('\n  彙總：')
console.log(`    不含 Monaco 的基準（React 19 + Tailwind v4）  ${mb(BASELINE_BYTES).padStart(9)}`)
console.log(`    Monaco 專屬 chunk（worker / 語言 / 字型）      ${mb(monacoChunkBytes).padStart(9)}`)
console.log(`    renderer 資產總計                             ${mb(total).padStart(9)}`)
console.log(`    ── Monaco 帶來的增量                          ${mb(attributable).padStart(9)}  (×${(total / BASELINE_BYTES).toFixed(1)})`)

const tsWorker = files.find((f) => f.name.startsWith('ts.worker-'))
if (tsWorker) {
  console.log(`\n  註：其中 ts.worker 佔 ${mb(tsWorker.size)}——那是 TypeScript 編譯器本身，`)
  console.log('      只為語意分析（診斷 / IntelliSense）而存在。PRD §6.2 已將編輯器降級為')
  console.log('      side panel 的檔案檢視，若僅需語法高亮與存檔，移除 language/typescript')
  console.log(`      contribution 即可省下這 ${mb(tsWorker.size)}，不影響 F3 的需求。`)
}
