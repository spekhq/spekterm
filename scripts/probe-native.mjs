/**
 * native-module-toolchain 的驗收程序。
 *
 * 本檔案「就是」一個 Electron 主行程（以 `electron scripts/probe-native.mjs` 執行），
 * 而非 ELECTRON_RUN_AS_NODE 下的 Node script —— spec 要求驗證的是主行程能載入
 * native 模組，兩者的 runtime 雖同源，但只有前者是真正被出貨的執行環境。
 *
 * Electron 或 node-pty 升版後必須重跑此程序：Electron 升版會改變 ABI 編號
 * (process.versions.modules)，而 Node-API 的相容性保證繫於 N-API 版本而非 ABI 編號。
 *
 * 注意：ESM 主行程不可在 top-level `await app.whenReady()`。Electron 的 ready
 * 事件要等主 script 評估完成才觸發，top-level await 會讓 module 永遠評估不完 →
 * whenReady() 永不 resolve → 死鎖且無任何輸出。一律把邏輯放進 .then() 回呼。
 *
 * 用法：npm run probe:native
 * 結束碼 0 表示全部 scenario 通過。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { check } from './lib/instrument.mjs'

const require = createRequire(import.meta.url)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED_PLATFORMS = [
  'darwin-arm64', 'darwin-x64',
  'linux-arm64', 'linux-x64',
  'win32-arm64', 'win32-x64',
]

const results = []
function info(name, detail) {
  console.log(`  · ${name}：${detail}`)
}

/** 讀 pty.node 的動態符號表，判定它是 Node-API 還是直接觸碰 V8 內部 API */
function inspectSymbols(nodeFile) {
  try {
    const out = execFileSync('nm', ['-D', nodeFile], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const lines = out.split('\n')
    return {
      supported: true,
      napi: lines.filter((l) => / U napi_/.test(l)).length,
      v8: lines.filter((l) => l.includes('v8::')).length,
    }
  } catch {
    return { supported: false, napi: 0, v8: 0 }
  }
}

function spawnPty(pty) {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32'
    const shell = isWindows ? 'powershell.exe' : 'bash'
    const args = isWindows ? ['-Command', 'echo PTY_OK'] : ['-lc', 'echo PTY_OK; tty']
    const child = pty.spawn(shell, args, { name: 'xterm-color', cols: 80, rows: 24 })

    let output = ''
    const timer = setTimeout(() => resolve({ timedOut: true, output, exitCode: null }), 8000)
    child.onData((d) => (output += d))
    child.onExit(({ exitCode }) => {
      clearTimeout(timer)
      resolve({ timedOut: false, output, exitCode })
    })
  })
}

async function runProbe() {
  console.log('native-module-toolchain 驗收：\n')

  // runtime 環境（3.7 要求輸出，供升版時比對）
  info('Electron', process.versions.electron)
  info('Node.js', process.versions.node)
  info('ABI (process.versions.modules)', process.versions.modules)
  info('N-API', process.versions.napi)
  console.log('')

  // 依賴宣告
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
  const ptyRange = pkg.dependencies?.['node-pty'] ?? ''

  check(results, 'node-pty 版本釘死（無範圍運算子）',
    /^\d+\.\d+\.\d+/.test(ptyRange) && !/[\^~><|*x]/.test(ptyRange), ptyRange)
  check(results, '不依賴 @electron/rebuild',
    !('@electron/rebuild' in allDeps) && !('electron-rebuild' in allDeps),
    `@electron/rebuild=${'@electron/rebuild' in allDeps} electron-rebuild=${'electron-rebuild' in allDeps}`)
  check(results, '無重建 native 模組的 postinstall 步驟',
    !/rebuild/i.test(pkg.scripts?.postinstall ?? '') && !/rebuild/i.test(pkg.scripts?.install ?? ''),
    `postinstall=${JSON.stringify(pkg.scripts?.postinstall ?? null)} install=${JSON.stringify(pkg.scripts?.install ?? null)}`)

  // 安裝結果
  const ptyRoot = join(repoRoot, 'node_modules', 'node-pty')
  check(results, '安裝未觸發本地編譯（無 build/ 目錄）', !existsSync(join(ptyRoot, 'build')))

  const prebuildsDir = join(ptyRoot, 'prebuilds')
  const present = existsSync(prebuildsDir) ? readdirSync(prebuildsDir) : []
  const missing = REQUIRED_PLATFORMS.filter((p) => !present.includes(p))
  check(results, 'prebuilds 涵蓋全部目標平台', missing.length === 0,
    missing.length ? `缺少 ${missing.join(', ')}` : `${present.length} 個平台`)

  // Node-API 判定
  const nativeFile = join(prebuildsDir, `${process.platform}-${process.arch}`, 'pty.node')
  const sym = inspectSymbols(nativeFile)
  if (sym.supported) {
    check(results, 'pty.node 為 Node-API 實作（引用 napi_*、不引用 v8::）',
      sym.napi > 0 && sym.v8 === 0, `napi=${sym.napi} v8=${sym.v8}`)
  } else {
    info('符號表檢查', '此平台無 nm，略過（不影響其餘判定）')
  }

  // 主行程載入並 spawn
  let pty = null
  try {
    pty = require('node-pty')
    check(results, 'Electron 主行程載入 node-pty', true, '未針對 Electron ABI 重建')
  } catch (err) {
    check(results, 'Electron 主行程載入 node-pty', false, err.message.slice(0, 120))
  }

  if (pty) {
    const r = await spawnPty(pty)
    check(results, 'spawn shell 並取得輸出',
      !r.timedOut && r.exitCode === 0 && /PTY_OK/.test(r.output), `exitCode=${r.exitCode}`)

    if (process.platform !== 'win32') {
      check(results, '取得的是偽終端而非管線', /\/dev\/(pts|ttys)/.test(r.output),
        (r.output.match(/\/dev\/\S+/) ?? ['未取得 tty'])[0])
    } else {
      info('偽終端檢查', 'Windows 走 ConPTY，無 tty(1) 可驗，略過')
    }
  }

  const passed = results.every(Boolean)
  console.log(`\n${passed ? '全部通過' : '有項目未通過'}（${results.filter(Boolean).length}/${results.length}）`)
  return passed
}

app
  .whenReady()
  .then(runProbe)
  .then((passed) => app.exit(passed ? 0 : 1))
  .catch((err) => {
    console.error(`probe 失敗：${err.stack ?? err.message}`)
    app.exit(1)
  })
