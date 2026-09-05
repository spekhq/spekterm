import { ipcMain, utilityProcess } from 'electron'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { WorkerHandle } from '../insights-service'
import type { InsightsService } from '../insights'
import type { ReportService } from '../report'
import { delegateArgs, type DelegateHandle } from '../report-runner'
import { getUserEnv } from '../user-env'

export const INSIGHTS_CHANNELS = {
  get: 'workspace:insights:get',
  refresh: 'workspace:insights:refresh',
  reportPreview: 'workspace:insights:reportPreview',
  reportList: 'workspace:insights:reportList',
  reportRead: 'workspace:insights:reportRead',
  reportGenerate: 'workspace:insights:reportGenerate',
} as const

/**
 * 對話計量的 IPC。
 *
 * **開一個自己的 namespace，不掛在 `fs` 之下。** `filesystem-access` 有一條 scenario **逐一列舉**
 * 了 `window.workspace.fs` 上允許存在的成員，多一個就違反它、且有探針斷言。而「掃描器讀檔案」
 * 很直覺地會讓人往 `fs` 裡放 —— 那是這個 change 唯一會弄紅 `filesystem-access` 的方式。
 *
 * 這支檔案只做兩件需要 Electron 的事：起掃描行程、註冊 handler。其餘在 `../insights.ts`。
 */

/** 產品用的掃描行程：`utilityProcess.fork` 一支與 `index.js` 並列的產物。 */
export function spawnScanWorker(): WorkerHandle {
  const here = dirname(fileURLToPath(import.meta.url))
  const child = utilityProcess.fork(join(here, 'insights-worker.js'), [], { stdio: 'ignore' })
  return {
    postMessage: (message) => child.postMessage(message),
    on: ((event: string, listener: (...args: unknown[]) => void) => {
      if (event === 'message') child.on('message', (data) => listener(data))
      else child.on('exit', (code) => listener(code))
    }) as WorkerHandle['on'],
    kill: () => {
      child.kill()
    },
  }
}

export function registerInsightsHandlers(service: InsightsService, reports: ReportService): void {
  ipcMain.handle(INSIGHTS_CHANNELS.get, (_event, range?: { from?: number; to?: number }) => service.snapshot(range))
  ipcMain.handle(INSIGHTS_CHANNELS.refresh, (_event, range?: { from?: number; to?: number }) => service.refresh(range))

  ipcMain.handle(INSIGHTS_CHANNELS.reportPreview, (_event, range?: { from?: number; to?: number }) => reports.preview(range))
  ipcMain.handle(INSIGHTS_CHANNELS.reportList, () => reports.list())
  ipcMain.handle(INSIGHTS_CHANNELS.reportRead, (_event, name: string) => reports.read(String(name)))
  // 授權旗標由 renderer 帶上來 —— 它代表「使用者剛剛按下了那一次的同意」，而不是一個記住的設定。
  ipcMain.handle(INSIGHTS_CHANNELS.reportGenerate, (_event, request: { from?: number; to?: number; authorized?: boolean }) =>
    reports.generate({ from: request?.from, to: request?.to, authorized: request?.authorized === true }),
  )
}

/**
 * 委派給使用者自己的 `claude` CLI。
 *
 * 四件承重的事，每一件都對應一條規格：
 *
 * 1. **cwd 是專屬的空目錄** —— 不載入任何 repo 的 `CLAUDE.md`、skill 或設定，
 *    否則被分析的對象（使用者的 repo）能夠影響分析它的那份提示。它同時讓委派留下的紀錄
 *    落在一個**可預測**的專案目錄裡，因而排除得掉。
 * 2. **關閉所有工具** —— 這趟不需要工具，而開著它就可能去讀 repo。
 * 3. **`--output-format json`** —— 成敗由欄位判定，不解析散文。
 * 4. **`PATH` 取自 `getUserEnv()`** —— 與 pty 同一個來源。使用者的 `claude` 常裝在
 *    `~/.local/bin`，那不在主行程繼承到的 `PATH` 裡（見 `user-env.ts` 的分界）。
 */
export function spawnReportDelegate(options: { cwd: string; model: string }): DelegateHandle {
  mkdirSync(options.cwd, { recursive: true, mode: 0o700 })
  const userEnv = getUserEnv()
  const child = spawn(
    'claude',
    // 參數的組裝在 `report-runner.ts`（純函式，驗得到）。工具一律關閉 ——
    // `permission_denials` 非空即代表那一條沒有生效。
    delegateArgs(options.model),
    {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, ...userEnv, PATH: userEnv.PATH ?? process.env.PATH ?? '' },
    },
  )
  return {
    send: (input) => {
      child.stdin?.end(input)
    },
    onStdout: (listener) => {
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => listener(chunk))
    },
    onExit: (listener) => child.on('exit', (code) => listener(code)),
    onError: (listener) => child.on('error', () => listener()),
    kill: () => {
      child.kill()
    },
  }
}
