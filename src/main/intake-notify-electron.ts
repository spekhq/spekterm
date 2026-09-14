import { Notification } from 'electron'

import type { NotifyBackend } from './intake-notify'
import { createHoldingBackend } from './intake-notify-backend'

/**
 * **全 repo 唯一取用作業系統通知 API 的地方**（由 `scripts/notification-source.test.mjs` 守著）。
 *
 * 這個檔案裡不得有任何判斷 —— 判斷全在 `intake-notify-backend.ts`（可測）與
 * `intake-notify.ts`（決策層）。理由是 `import { Notification } from 'electron'` 會讓
 * node:test 載入失敗，所以這個檔案結構上驗不到；一行判斷躲進來，就是一行沒有載體的程式碼。
 *
 * **`isSupported()` 守不到真正的失效。** 實測：它在完全沒有通知服務、甚至連匯流排都連不上的
 * 情況下依然回 `true` —— 它只反映底層函式庫裝了沒有。桌面沒有通知服務時本能力靜默無效，
 * 而應用程式偵測不到（已裁決不做主動偵測，見 `docs/lessons/intake.md` 第七節）。
 */
export function electronNotifyBackend(): NotifyBackend {
  return createHoldingBackend({
    supported: () => Notification.isSupported(),
    create: (options) => new Notification(options),
  })
}
