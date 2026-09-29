/**
 * project-license：把建置期收集到的套件清單，與原樣出貨的依賴合併成 `out/THIRD_PARTY_LICENSES.txt`。
 *
 * 由 `npm run build` 在 `electron-vite build` 之後呼叫。收集端（`electron.vite.config.ts` 的
 * `collectBundledPackages`）每個 build 目標寫一份 `out/licenses/<target>.json`；這裡讀全部，
 * 再加上 lock 裡非 dev 的套件。
 *
 * **少了任何一份收集結果就失敗**，不是靜默輸出一份比較短的彙總 —— 彙總短了，產物照樣打包得出來，
 * 而那正是違反授權卻沒有人會發現的形狀。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  dedupeEntries,
  dedupeNotices,
  licenseEntryOf,
  productionPackagesOf,
  renderSummary,
} from './lib/third-party-licenses.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = ['main', 'preload', 'renderer']

function collected(name) {
  const file = join(repoRoot, 'out', 'licenses', name)
  if (!existsSync(file)) {
    console.error(`[third-party-licenses] missing ${file} — did electron-vite build run with the collector plugin?`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(file, 'utf8'))
}

const bundled = TARGETS.flatMap((target) => collected(`${target}.json`))
const notices = dedupeNotices(TARGETS.flatMap((target) => collected(`${target}.notices.json`)))

const lock = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8'))
const shipped = productionPackagesOf(lock).map((relative) => join(repoRoot, relative))

const entries = dedupeEntries([...bundled, ...shipped].map((dir) => licenseEntryOf(dir)))
const out = join(repoRoot, 'out', 'THIRD_PARTY_LICENSES.txt')
writeFileSync(out, `${renderSummary(entries, notices)}\n`)
console.log(`[third-party-licenses] ${entries.length} packages, ${notices.length} embedded notices → ${out}`)
