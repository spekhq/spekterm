#!/usr/bin/env node
/**
 * 產物清理 —— 只保留**版本序**上最新的兩份 AppImage。`dist:linux` 的最後一步。
 *
 * ## 為什麼需要它
 *
 * 版本逐次遞增之後，每次打包都會留下一份**新檔名**的產物 —— 在此之前檔名恆定、後一次覆蓋前一次，
 * 目錄大小是常數。單一產物逾 120 MB，累積是使用者不會主動去看、直到磁碟告急才發現的成本。
 *
 * **保留前一份是刻意的**：換版後行為出問題時，退回上一份可執行的產物是第一個處置。
 *
 * ## 排序必須是版本序，不能是字典序 —— 這是本檔存在的最大陷阱
 *
 * `'Spekterm-0.1.10' < 'Spekterm-0.1.9'` 在字典序下**為真**，於是依檔名排序的清理會把
 * **剛建好的那一份**當成最舊的刪掉。以逐次遞增計，第十次打包就會發生，而症狀是一份剛產出的
 * 產物憑空消失。因此與 `findAppImage()` **共用** `lib/build-info.mjs` 的 `compareVersions`。
 *
 * **對照組必須跨十位數**：`0.1.1`–`0.1.4` 這種 fixture 下字典序與版本序結果完全相同，
 * 一個字典序的實作照樣全綠（見 `prune-release.test.mjs`）。
 *
 * ## 比對用確定的形態，不用萬用的 `*.AppImage`
 *
 * 刪除只涵蓋本專案自己產出的產物檔。`Spekterm-0.1.0.AppImage.prev` 之類的手工備份不以
 * `.AppImage` 結尾，不會被誤傷。
 */

import { readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareVersions } from './lib/build-info.mjs'

/** 本專案產物的檔名形態 —— `productName` 已凍結（`app-identity`），這個前綴不會漂移。 */
const ARTIFACT = /^Spekterm-(\d+\.\d+\.\d+)\.AppImage$/

/** 保留幾份。2 ＝ 當次 ＋ 前一次（退回上一版是換版出問題時的第一個處置）。 */
const KEEP = 2

/**
 * @param {string} releaseDir
 * @returns {string[]} 被刪掉的檔名
 */
export function pruneRelease(releaseDir) {
  let entries
  try {
    entries = readdirSync(releaseDir)
  } catch {
    return [] // 還沒打包過，沒有東西要清
  }

  const artifacts = entries
    .map((name) => ({ name, version: name.match(ARTIFACT)?.[1] }))
    .filter((a) => a.version !== undefined)
    .sort((a, b) => compareVersions(b.version, a.version)) // 新 → 舊

  const doomed = artifacts.slice(KEEP)
  for (const { name } of doomed) rmSync(join(releaseDir, name))
  return doomed.map((a) => a.name)
}

// CLI：預設清本 repo 的 `release/`，測試以第一個引數指向暫存目錄。
if (import.meta.url === `file://${process.argv[1]}`) {
  const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  const dir = process.argv[2] ?? join(repoRoot, 'release')
  const removed = pruneRelease(dir)
  if (removed.length > 0) console.log(`[release] 清掉 ${removed.length} 份舊產物：${removed.join(', ')}`)
}
