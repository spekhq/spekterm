#!/usr/bin/env node
/**
 * 移除桌面整合 —— 一個裝得上卻卸不掉的東西，使用者不會願意裝第一次。
 *
 * 路徑與 `install-desktop.mjs` **共用** `lib/desktop-entry.mjs` 的定義：兩邊各自算一次路徑的話，
 * 移除會在某一次改動之後靜默地漏掉一個檔案。
 */

import { rmSync } from 'node:fs'
import { desktopPaths } from './lib/desktop-entry.mjs'

/** @param {NodeJS.ProcessEnv} env @returns {string[]} 被移除的路徑 */
export function uninstallDesktop(env) {
  const paths = desktopPaths(env)
  const removed = Object.values(paths)
  for (const target of removed) rmSync(target, { force: true })
  return removed
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const removed = uninstallDesktop(process.env)
  console.log(`[desktop] 已移除：\n  ${removed.join('\n  ')}`)
}
