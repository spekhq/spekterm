#!/usr/bin/env node
/**
 * 依序跑完全部探針（`npm run test:e2e` 的實作）。
 *
 * 為什麼要有這支：`package.json` 裡每個 `probe:*` 都是 `npm run build && node …`，
 * 全跑一輪等於 build 九次。這支由 `test:e2e` 先 build 一次，之後直接執行探針本體。
 *
 * 兩件事刻意這樣做：
 *
 * - **不 fail fast。** 探針一輪就要十幾分鐘、期間使用者無法操作電腦（真滑鼠事件、真視窗），
 *   付了這個代價就該拿到完整的一張圖，而不是第一支紅了就停。exit code 仍反映整體結果。
 * - **清掉 `electron-vite dev` 洩漏到 shell 的環境變數。** CSP 的 dev／production 切換依
 *   `ELECTRON_RENDERER_URL` 是否存在（見 CLAUDE.md），跑過 `npm run dev` 的 shell 會把它繼承下去，
 *   於是 build 模式的探針拿到 dev 政策而紅 —— 那是環境串擾，不是產品 bug。
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electron = join(root, 'node_modules', '.bin', 'electron')

/** 依成本遞增排列 —— 便宜的先跑完，才輪到會霸佔螢幕好幾分鐘的那幾支。 */
const PROBES = [
  { name: 'native', cmd: electron, args: ['scripts/probe-native.mjs'] },
  { name: 'core', args: ['scripts/probe-core.mjs'] },
  { name: 'identity', args: ['scripts/probe-identity.mjs'] },
  { name: 'shell', args: ['scripts/probe-shell.mjs'] },
  { name: 'workspace', args: ['scripts/probe-workspace.mjs'] },
  { name: 'files', args: ['scripts/probe-files.mjs'] },
  { name: 'keyboard', args: ['scripts/probe-keyboard.mjs'] },
  { name: 'openspec', args: ['scripts/probe-openspec.mjs'] },
  { name: 'terminal', args: ['scripts/probe-terminal.mjs'] },
]

const LEAKED_DEV_ENV = [
  'ELECTRON_RENDERER_URL',
  'NODE_ENV_ELECTRON_VITE',
  'ELECTRON_MAJOR_VER',
  'ELECTRON_CLI_ARGS',
  'ELECTRON_EXEC_PATH',
]

const env = { ...process.env }
const cleaned = LEAKED_DEV_ENV.filter((k) => k in env)
cleaned.forEach((k) => delete env[k])

// 探針以裸名 `electron` spawn（靠 npm script 把 `node_modules/.bin` 塞進 PATH）。這支 runner
// 可能不是經 npm 起的 —— 自己補上，否則會是一句沒頭沒腦的 `spawn electron ENOENT`。
env.PATH = `${join(root, 'node_modules', '.bin')}:${env.PATH ?? ''}`

function run({ cmd, args }) {
  return new Promise((resolve) => {
    const child = spawn(cmd ?? process.execPath, args, { cwd: root, stdio: 'inherit', env })
    child.on('close', (code) => resolve(code === 0))
    child.on('error', (err) => {
      console.error(`\n無法啟動探針：${err.message}`)
      resolve(false)
    })
  })
}

if (cleaned.length > 0) {
  console.log(`[test:e2e] 已清除自 dev 洩漏的環境變數：${cleaned.join(', ')}`)
}

const results = []
for (const probe of PROBES) {
  console.log(`\n${'='.repeat(72)}\n[test:e2e] probe:${probe.name}\n${'='.repeat(72)}`)
  const started = Date.now()
  const passed = await run(probe)
  results.push({ name: probe.name, passed, seconds: Math.round((Date.now() - started) / 1000) })
}

console.log(`\n${'='.repeat(72)}\n[test:e2e] 總結\n${'='.repeat(72)}`)
for (const r of results) {
  console.log(`  ${r.passed ? '通過' : '未通過'}  probe:${r.name.padEnd(10)} ${r.seconds}s`)
}

const failed = results.filter((r) => !r.passed)
console.log(
  failed.length === 0
    ? `\n全部通過（${results.length}/${results.length}）`
    : `\n有探針未通過（${results.length - failed.length}/${results.length}）：${failed.map((r) => r.name).join(', ')}`,
)
process.exit(failed.length === 0 ? 0 : 1)
