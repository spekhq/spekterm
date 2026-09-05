import { ipcMain, utilityProcess } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { WorkerHandle } from '../insights-service'
import type { InsightsService } from '../insights'

export const INSIGHTS_CHANNELS = {
  get: 'workspace:insights:get',
  refresh: 'workspace:insights:refresh',
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

export function registerInsightsHandlers(service: InsightsService): void {
  ipcMain.handle(INSIGHTS_CHANNELS.get, (_event, range?: { from?: number; to?: number }) => service.snapshot(range))
  ipcMain.handle(INSIGHTS_CHANNELS.refresh, (_event, range?: { from?: number; to?: number }) => service.refresh(range))
}
