#!/usr/bin/env node
/**
 * 把打包產物安裝為桌面環境的應用程式項目。
 *
 * ## 為什麼這不只是便利
 *
 * `desktop-packaging` 有兩條 requirement 明訂其驗收「**SHALL 以自桌面環境啟動的執行驗收，
 * SHALL NOT 以自終端機啟動的執行替代**」（agent CLI 的解析、主行程的 PATH）——
 * **沒有一個桌面項目可以點，那兩條就沒有可執行的前提。**
 *
 * ## 安裝到固定位置，不指向 `release/`
 *
 * `release/` 不進版控、會被清除重建，而其中的檔名**隨版本改變**。桌面項目指向它會靜默失效：
 * 項目仍在選單裡，點下去卻沒有反應，或執行到一份早就不是最新的產物。
 *
 * ## 不得就地覆寫產物
 *
 * 作業系統拒絕覆寫一個**執行中**的可執行檔（實測回 `ETXTBSY`），而「一邊用著手上這份、一邊
 * 重新打包再裝上去」正是換版流程本身 —— **這是常態不是邊緣情況**。因此寫到同目錄的暫存名再
 * `rename()` 覆蓋：Linux 允許 rename 覆蓋執行中的檔案，既有行程續用舊 inode 跑完。
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { desktopEntry, desktopPaths } from './lib/desktop-entry.mjs'
import { writeFileSync } from 'node:fs'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * @param {{ repoRoot: string, env: NodeJS.ProcessEnv, source?: string }} options
 * @returns {{ binary: string, entry: string, icon: string }}
 */
export function installDesktop({ repoRoot, env, source }) {
  const { version } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  const artifact = source ?? join(repoRoot, 'release', `Spekterm-${version}.AppImage`)

  // **產物不存在就什麼都不寫。** 一個指向不存在檔案的桌面項目會製造「裝好了但點了沒反應」，
  // 比失敗更難診斷。
  if (!existsSync(artifact)) {
    const error = new Error(
      `找不到打包產物：${artifact}\n  處置：先跑 \`npm run dist:linux\`（或以第一個引數指定產物路徑）`,
    )
    error.code = 'ARTIFACT_MISSING'
    throw error
  }

  const paths = desktopPaths(env)
  for (const target of Object.values(paths)) mkdirSync(dirname(target), { recursive: true })

  installBinary(artifact, paths.binary)
  copyFileSync(join(repoRoot, 'build', 'icon.png'), paths.icon)
  writeFileSync(paths.entry, desktopEntry(paths), { mode: 0o644 })

  return paths
}

/** 暫存名 ＋ `rename()` —— 見檔頭「不得就地覆寫產物」。 */
function installBinary(source, target) {
  const staging = `${target}.installing`
  try {
    copyFileSync(source, staging)
    renameSync(staging, target)
  } catch (error) {
    rmSync(staging, { force: true })
    // **判定看 `errno`，不比對訊息** —— 本機的錯誤訊息是在地化的（實測回「文字檔忙錄中」）。
    // 與 repo 既有的 `LC_ALL=C` 那條同族。
    if (error.code === 'ETXTBSY' || error.code === 'EBUSY') {
      throw new Error(
        `無法寫入 ${target}：目標被佔用（${error.code}）—— 這一版的安裝應該走 rename，請回報`,
        { cause: error },
      )
    }
    throw error
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const paths = installDesktop({ repoRoot, env: process.env, source: process.argv[2] })
    console.log(`[desktop] 已安裝：\n  ${paths.binary}\n  ${paths.entry}\n  ${paths.icon}`)
  } catch (error) {
    console.error(`[desktop] ${error.message}`)
    process.exit(1)
  }
}
