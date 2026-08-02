import { type WebContents, ipcMain } from 'electron'
import type { PanelSnapshot, PanelStore } from '../panel-store'

export const PANEL_CHANNELS = {
  get: 'workspace:panel:get',
  persist: 'workspace:panel:persist',
} as const

/**
 * 落盤的 debounce。**錨定一個 change 是「在樹上點一下」就發生的動作** —— 每次都同步寫一次檔
 * 是浪費（比照 `ipc/terminal.ts` 的 `PERSIST_DEBOUNCE_MS`，兩者同一個理由與同一個值）。
 */
const PERSIST_DEBOUNCE_MS = 500

interface Pending {
  timer: NodeJS.Timeout
  incoming: unknown
}

/** 每個 renderer 一筆待寫入。key 為 `webContents.id`。 */
const pending = new Map<number, Pending>()

/**
 * 把待落盤的東西立刻寫下去。
 *
 * **關視窗與 reload 都必須先走這裡** —— 否則使用者最後一次的選擇（他剛切了側欄來源就關掉 app）
 * 就飛了，而那個失敗與「持久化整個沒做」在畫面上長得一模一樣。
 *
 * 兩條路徑都由 `hookLifecycle` 掛在 `webContents` 上（`destroyed` 與 `did-navigate`），
 * 因此這個函式維持 module-private —— 比照 `ipc/terminal.ts` 的同名者。
 */
function flush(store: PanelStore): void {
  for (const [contentsId, entry] of pending) {
    clearTimeout(entry.timer)
    store.replace(entry.incoming)
    pending.delete(contentsId)
  }
}

/** 已掛上收尾 listener 的 renderer —— 同一個 webContents 不重複掛。 */
const hooked = new Set<number>()

function hookLifecycle(store: PanelStore, sender: WebContents): void {
  if (hooked.has(sender.id)) return
  hooked.add(sender.id)

  const release = (): void => {
    flush(store)
  }

  // 重新載入不會銷毀 webContents，因此只掛 'destroyed' 是不夠的（fs watcher 與 pty 都在這條
  // 路上踩過）—— 兩個事件都要，且 'did-navigate' 之後 renderer 會重新送一份完整的座標過來。
  sender.on('did-navigate', release)
  sender.once('destroyed', () => {
    hooked.delete(sender.id)
    release()
  })
}

export function registerPanelHandlers(store: PanelStore): void {
  ipcMain.handle(PANEL_CHANNELS.get, (event): PanelSnapshot => {
    hookLifecycle(store, event.sender)
    return store.list()
  })

  // fire-and-forget（比照 `terminal.persist`）：renderer 不需要等一次 round-trip 才繼續。
  ipcMain.on(PANEL_CHANNELS.persist, (event, incoming: unknown) => {
    hookLifecycle(store, event.sender)

    const contentsId = event.sender.id
    const existing = pending.get(contentsId)
    if (existing) clearTimeout(existing.timer)

    const timer = setTimeout(() => {
      pending.delete(contentsId)
      store.replace(incoming)
    }, PERSIST_DEBOUNCE_MS)
    pending.set(contentsId, { timer, incoming })
  })
}
