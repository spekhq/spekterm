#!/usr/bin/env node
/**
 * 單支探針的啟動器 —— 決定它畫到哪個螢幕，然後把它跑起來。
 *
 * 為什麼要有這一層：螢幕的選擇（虛擬／實體）與 `xvfb-run` 的存在檢查，對 9 支探針是同一件事。
 * 收在這裡，`package.json` 的每一條 `probe:*` 與 `scripts/run-probes.mjs` 就共用同一份決策 ——
 * 而不是在十個地方各寫一次（其中一個遲早會不一樣）。
 *
 * 探針本身**不需要知道**自己畫在哪個螢幕上：`DISPLAY` 由 `xvfb-run` 設定並被子行程繼承。
 * 它們唯一要問的是 `electronExtraArgs()`（軟體 GL 的旗標），因為那必須進 electron 的 argv。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { withDisplay, useVirtualDisplay } from './lib/display.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const name = process.argv[2]

if (!name) {
  console.error('用法：node scripts/run-probe.mjs <探針名稱>')
  process.exit(2)
}

const script = join('scripts', `probe-${name}.mjs`)
if (!existsSync(join(root, script))) {
  console.error(`找不到探針：${script}`)
  process.exit(2)
}

// `probe:native` 自己就是一個 Electron 主行程（它 require node-pty，必須在 Electron 裡跑），
// 不像其餘八支那樣「以 node 執行、再由它 spawn electron」。
const runsAsElectron = name === 'native'
let command
let args
try {
  ;[command, args] = withDisplay(
    runsAsElectron ? join(root, 'node_modules', '.bin', 'electron') : process.execPath,
    [script],
  )
} catch (error) {
  // 缺少 xvfb 是**環境**問題，不是程式的內部錯誤 —— 印可執行的指示，不要丟一坨 stack trace。
  console.error(error.message)
  process.exit(1)
}

if (!useVirtualDisplay()) {
  console.log(`[probe:${name}] PROBE_DISPLAY=physical —— 這一輪會佔用你的螢幕`)
}

// PATH 要含 `node_modules/.bin`：探針以裸名 `electron` spawn（此前靠 npm script 提供），
// 而這支 runner 不保證是經 npm 起的。
const env = {
  ...process.env,
  PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
}

const child = spawn(command, args, { cwd: root, stdio: 'inherit', env })
child.on('error', (err) => {
  console.error(`無法啟動探針：${err.message}`)
  process.exit(1)
})
child.on('close', (code) => process.exit(code ?? 1))
