/**
 * 編輯器（Monaco）的驗收程序 —— PRD §13 列名的風險項。
 *
 * dev 與 build 兩種模式必須分別驗證：Vite 的 `?worker` 在 dev 下從 http:// 的
 * dev server 載入 module worker，build 後則從 file:// 載入打包好的 chunk。
 * 只驗其中一種，證明不了選型可行。
 *
 * 判定「worker 正常」的依據不是看到語法高亮 —— tokenization 在主執行緒完成。
 * renderer 端建立一個帶型別錯誤的 model，唯有 ts.worker 完成語意分析才會回填
 * diagnostic marker，收到 marker 才算 worker 真的活著（見 src/renderer/src/editor）。
 *
 * 用法：npm run probe:editor
 */
import { execFileSync, spawn } from 'node:child_process'
import { check, connect, pollUntil, waitForPageTarget } from './lib/cdp.mjs'

const PROBE = `(() => {
  const root = document.querySelector('[data-testid="app-root"]')
  const host = document.querySelector('[data-testid="code-editor"]')
  const tokenClasses = new Set()
  document.querySelectorAll('.view-line span[class*="mtk"]').forEach((s) => tokenClasses.add(s.className))
  return {
    workerStatus: root?.dataset.monacoWorker ?? 'absent',
    workersCreated: root?.dataset.monacoWorkersCreated ?? '',
    editorMounted: Boolean(document.querySelector('.monaco-editor')),
    lineCount: document.querySelectorAll('.view-line').length,
    tokenClassCount: tokenClasses.size,
    languageCount: host?.dataset.monacoLanguages ?? '?',
    modelLanguage: host?.dataset.modelLanguage ?? '?',
  }
})()`

const MODES = [
  {
    name: 'build（file:// 載入打包後的 worker chunk）',
    command: 'electron',
    args: (port) => [`--remote-debugging-port=${port}`, '.'],
    port: 9222,
    startupTimeoutMs: 30_000,
    // build 模式跑的是 out/ 裡的產物。若不在此重新建置，改完 src 後直接跑 probe
    // 會靜默地測到舊 bundle——那會被誤讀成「build 模式壞掉」。
    needsBuild: true,
  },
  {
    name: 'dev（http:// 載入 vite dev server 的 module worker）',
    command: 'electron-vite',
    args: (port) => ['dev', `--remoteDebuggingPort=${port}`],
    port: 9223,
    startupTimeoutMs: 60_000,
  },
]

async function runMode(mode) {
  console.log(`\n── ${mode.name}`)
  if (mode.needsBuild) {
    console.log('  · 先執行 electron-vite build，確保測到的是當前原始碼')
    execFileSync('electron-vite', ['build'], { stdio: 'ignore', env: process.env })
  }
  const child = spawn(mode.command, mode.args(mode.port), {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: process.env,
    detached: true, // electron-vite 會再 spawn electron，須整個 process group 一起收掉
  })
  let stderr = ''
  child.stderr.on('data', (c) => (stderr += c))

  const results = []
  try {
    const target = await waitForPageTarget(mode.port, mode.startupTimeoutMs)
    const client = await connect(target)

    // ts.worker 有 13 MB，dev 模式下首次載入偏慢。
    // 'absent' 代表 React 尚未掛載（root 不存在），不是落定狀態——早期只等 'pending'
    // 會讓 probe 在頁面還空白時就收工，把「太早問」誤判成「編輯器壞了」。
    const r = await pollUntil(
      client,
      PROBE,
      (v) => v?.editorMounted === true && v.workerStatus !== 'pending' && v.workerStatus !== 'absent',
      40_000,
    )
    client.close()

    check(results, '編輯器完成掛載', r?.editorMounted === true, `${r?.lineCount ?? 0} 行`)
    console.log(`    · 已註冊語言數=${r?.languageCount}, model 語言=${r?.modelLanguage}`)
    check(results, '內容呈現語法高亮', (r?.tokenClassCount ?? 0) > 1,
      `${r?.tokenClassCount ?? 0} 種 token class`)
    check(results, 'TypeScript worker 完成語意分析', r?.workerStatus === 'ok',
      `status=${r?.workerStatus}, 已建立 worker=[${r?.workersCreated || '無'}]`)
  } catch (err) {
    check(results, `${mode.name} 啟動並連上 CDP`, false, err.message)
    if (stderr.trim()) console.error(`  stderr: ${stderr.trim().slice(0, 400)}`)
  } finally {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  }
  return results.every(Boolean) && results.length > 0
}

console.log('編輯器（Monaco）驗收：')
let allPassed = true
for (const mode of MODES) {
  const passed = await runMode(mode)
  allPassed = allPassed && passed
}

console.log(`\n${allPassed ? '兩種模式皆通過' : '有模式未通過'}`)
process.exit(allPassed ? 0 : 1)
