import type { IntakeKeyRef, NotifyBackend, NotifyPayload } from './intake-notify'

/**
 * 通知後端的**可測那一半** —— 持有、上界、以及交給作業系統的選項。
 *
 * ## 為什麼與 Electron 的綁定分家
 *
 * `import { Notification } from 'electron'` 會讓 node:test 載入失敗（`worktree-pick.ts` 的檔頭
 * 記過同一條）。而這裡要驗的三件事全都與作業系統無關：**有沒有持有**、**上界成不成立**、
 * **交出去的選項有哪些鍵**。真正碰 Electron 的那一層在 `intake-notify-electron.ts`，
 * 它只提供一個工廠，一行判斷都沒有。
 *
 * ## 持有是承重的
 *
 * **實測**：丟掉通知物件的參考並觸發回收之後，服務端發出的觸發**不會**進到回呼；而且物件被
 * 回收時**不送關閉請求** —— 通知**還亮在使用者的桌面上**，他點下去什麼都不會發生。
 * 沒有錯誤、沒有紀錄、沒有紅燈。
 *
 * 而最自然的寫法正是會踩到它的那一種：建立之後直接 `.show()`，參考當場就掉了。
 * 因此這裡持有到它自己回報結束為止 —— **一個可達的物件不會被回收，那就是機制本身**。
 *
 * 集合仍要有上界：某些通知服務可能不回報結束，而一個無界的集合就是一次洩漏。
 */

/**
 * 交給作業系統的選項 —— **白名單，就這兩個鍵**。
 *
 * 寫成白名單而不是「不含 actions／不含 urgency」那種黑名單：後者只擋得住列舉得出來的東西，
 * 而這裡要擋的正是**下一個人會想到、而我們現在列舉不出來**的那些（通知上的 Accept 按鈕、
 * 發話者頭像、不會自己消失的緊急程度）。任何一個新鍵都會讓那條斷言變紅。
 */
export interface NotificationOptions {
  title: string
  body: string
}

export function notificationOptions(payload: NotifyPayload): NotificationOptions {
  return { title: payload.title, body: payload.body }
}

/** 作業系統那一層長什麼樣 —— 只取用得到的部分。 */
export interface NotificationHandle {
  show(): void
  on(event: 'click' | 'close' | 'failed', handler: () => void): void
}

export interface HoldingBackendDeps {
  create(options: NotificationOptions): NotificationHandle
  supported(): boolean
  /** 同時持有的上限。 */
  maxLive?: number
}

export const MAX_LIVE_NOTIFICATIONS = 20

export function createHoldingBackend(deps: HoldingBackendDeps): NotifyBackend & {
  /** 測試用：目前持有幾則。 */
  liveCount(): number
} {
  const live = new Set<NotificationHandle>()
  const maxLive = deps.maxLive ?? MAX_LIVE_NOTIFICATIONS
  let activated: ((keys: readonly IntakeKeyRef[]) => void) | null = null

  return {
    usable: () => deps.supported(),

    present(payload: NotifyPayload, keys: readonly IntakeKeyRef[]): void {
      const handle = deps.create(notificationOptions(payload))
      // **先持有，再顯示。** 反過來的話，`show()` 與加入集合之間就有一個窗口。
      if (live.size >= maxLive) {
        // 上界已滿 —— 不持有它（寧可失去這一則的觸發，也不要無界地累積）。
        handle.show()
        return
      }
      live.add(handle)
      const release = (): void => { live.delete(handle) }
      handle.on('close', release)
      handle.on('failed', release)
      handle.on('click', () => {
        release()
        // **keys 綁在這一則通知上** —— 同時亮著數則時，觸發的是哪一則決定去哪裡。
        activated?.(keys)
      })
      handle.show()
    },

    /**
     * 註冊「使用者觸發了通知」的回呼。
     *
     * **這個方法不得改用那個 HTTP 伺服器慣用的動詞命名** —— `probe-core.mjs` 的守衛是純文字
     * 比對，而且連註解一起吃。
     */
    onActivate(handler: (keys: readonly IntakeKeyRef[]) => void): void {
      activated = handler
    },

    liveCount: () => live.size,
  }
}
