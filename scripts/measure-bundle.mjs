/**
 * renderer bundle 體積報告。
 *
 * Phase 0 時它同時扮演「Monaco 對體積的貢獻是否可接受」的判定依據，因此寫死了一個
 * 不含 Monaco 的基準值。`multi-folder-workspace-shell` 移除診斷頁後，renderer 已不再
 * 引用 Monaco，那個比較退化成同義反覆（且基準會隨骨架自身成長而失真），故一併移除。
 *
 * Monaco 於 Phase 2／3 的 Files 檢視回歸時，體積判定要連同 requirement 一起重新確立。
 *
 * 用法：npm run measure:bundle
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ASSETS_DIR = join(process.cwd(), 'out', 'renderer', 'assets')

const mb = (bytes) => `${(bytes / 1_048_576).toFixed(2)} MB`
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`

console.log('  · 重新建置以確保報告反映當前原始碼')
execFileSync('electron-vite', ['build'], { stdio: 'ignore', env: process.env })

const files = readdirSync(ASSETS_DIR)
  .map((name) => ({ name, size: statSync(join(ASSETS_DIR, name)).size }))
  .sort((a, b) => b.size - a.size)

const total = files.reduce((sum, file) => sum + file.size, 0)

console.log('\nrenderer bundle 體積報告\n')
console.log('  資產明細（前 10 大）：')
for (const file of files.slice(0, 10)) {
  console.log(`    ${kb(file.size).padStart(11)}  ${file.name}`)
}

console.log(`\n  資產數量        ${String(files.length).padStart(9)}`)
console.log(`  renderer 資產總計 ${mb(total).padStart(9)}`)
