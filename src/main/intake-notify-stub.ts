import fs from 'node:fs'
import path from 'node:path'

import type { NotifyBackend, NotifyPayload } from './intake-notify'
import { notificationOptions } from './intake-notify-backend'
import { createWatcher } from './watcher'

/**
 * 驗收用的通知後端 —— 把每一則寫成一行 JSON，並以一個觸發檔模擬「使用者點了通知」。
 *
 * ## 為什麼需要它
 *
 * 「點通知 ⇒ 收件匣打開」跨行程（主行程的回呼 → renderer 的 overlay），主行程的單元測試
 * 看不見後半；而作業系統通知在虛擬螢幕上既不會出現、也點不下去。
 *
 * ## 為什麼不用環境變數當閘
 *
 * `ptyEnv()` 是 `{ ...process.env, ... }` —— **一個環境變數會進到每一個 pty**，而 pty 裡跑的
 * 正是被不受信任內容驅動的 agent：它寫一個檔案就能讓視窗搶到前景並打開收件匣。
 * 改以 `app.isPackaged` 為閘、路徑自 userData 推導：探針本來就傳 `--user-data-dir`，
 * 驗收一個字都不必多寫，而**出貨的產物裡這條路徑根本組不出來**。
 *
 * ## 監看的四個坑（每一個都在 `docs/lessons/intake.md` 有前例）
 *
 * 1. **監看目錄，不監看觸發檔本身** —— chokidar 對一個尚不存在的路徑 attach 不上。
 * 2. **`add` 與 `change` 都要訂** —— 同一個路徑寫第二次只 emit `change`。而驗收要觸發兩次。
 * 3. **等 `ready` 之後補一次存在性檢查** —— `ignoreInitial: true` 寫死於建立入口。
 * 4. **以 basename 過濾** —— 紀錄檔與觸發檔在同一個目錄，watcher 會看到自己每一次追加。
 */

const LOG = 'notifications.jsonl'
const TRIGGER = 'trigger'
const RECEIPTS = 'receipts.jsonl'

export interface StubBackendOptions {
  /** 落點目錄。由 `index.ts` 自 userData 推導。 */
  root: string
}

export function stubNotifyRoot(userData: string): string {
  return path.join(userData, 'notify-stub')
}

export function createStubBackend({ root }: StubBackendOptions): NotifyBackend {
  fs.mkdirSync(root, { recursive: true })
  const logPath = path.join(root, LOG)
  const triggerPath = path.join(root, TRIGGER)
  const receiptsPath = path.join(root, RECEIPTS)
  let activated: (() => void) | null = null
  let fired = 0

  const fire = (): void => {
    fired += 1
    // **收據** —— 少了它，「規格要求的無操作」與「訊息根本沒送到」在畫面上長得一模一樣。
    fs.appendFileSync(receiptsPath, `${JSON.stringify({ at: Date.now(), n: fired })}\n`, 'utf8')
    activated?.()
  }

  const watcher = createWatcher({ target: root, depth: 0, label: 'notify-stub' })
  const onEvent = (full: string): void => {
    if (path.basename(full) !== TRIGGER) return
    fire()
  }
  watcher.on('add', onEvent)
  watcher.on('change', onEvent)
  watcher.on('ready', () => {
    // 建立監看與 `ready` 之間抵達的檔案被 `ignoreInitial` 吞掉 —— 補掃一次。
    if (fs.existsSync(triggerPath)) fire()
  })

  return {
    usable: () => true,
    present(payload: NotifyPayload): void {
      fs.appendFileSync(logPath, `${JSON.stringify(notificationOptions(payload))}\n`, 'utf8')
    },
    onActivate(handler: () => void): void {
      activated = handler
    },
  }
}
