import fs from 'node:fs/promises'
import path from 'node:path'
import { intakeFileStem } from './intake-id'
import type { IntakeDelivery } from './slack-mention'

/**
 * 把一則投遞寫進**既有的投遞落點**。
 *
 * ## 為什麼寫檔給自己讀
 *
 * adapter 住在主行程，於是「直接呼叫 `deliver()`」看起來更直接。走檔案是刻意的（design D5）：
 *
 * - 多拿到的是**投遞檔的大小上限**與**拒絕的消費語意**（暫時性拒絕原封留著等重試）。
 *   其餘守衛（正規化、識別碼驗證、重複、總量上限）都在 `deliver()` 之內，行程內捷徑一樣拿得到。
 * - **真正承重的理由**：adapter 日後要被搬到另一個行程（產品化的必經之路 —— Socket Mode 的 app
 *   上不了 Marketplace），而那時收件匣一個字都不必改。
 *
 * ## 先寫暫存檔再更名
 *
 * 落點只採納 `.json`，而那是**縮小窗口而非防護**：它擋得住「依慣例先寫暫存檔」，擋不住
 * 「非原子地直接寫入最終檔名」。我們是那個 producer，所以要把該做的做到 —— 一份寫到一半的
 * `.json` 會被解析失敗、留在落點等補寫，雖然收件匣撐得住，但那是白繞一圈。
 *
 * ## 檔名用可逆的 hex，與收件匣同一套
 *
 * 直接用識別碼當檔名會踩到「檔案系統對大小寫的處理因平台而異」（macOS APFS 不敏感）：
 * 兩個相異的識別碼會落到同一個檔案。沿用 `intakeFileStem()` 而不自己想一套 —— 它的輸出字母表
 * 只有 `0-9a-f`，零碰撞且可逆回識別碼（診斷時看得懂）。
 */
export async function writeDelivery(inboxRoot: string, delivery: IntakeDelivery): Promise<void> {
  await fs.mkdir(inboxRoot, { recursive: true })
  const stem = intakeFileStem(delivery.id)
  const target = path.join(inboxRoot, `${stem}.json`)
  const tmp = path.join(inboxRoot, `${stem}.json.partial`)
  await fs.writeFile(tmp, `${JSON.stringify(delivery, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, target)
}
