/**
 * 分頁順序是不是來自退路（而非該 change 的 schema 所宣告的順序），以及該說哪一句。
 *
 * **抽成純函式是為了讓它驗得到。** 這條判斷在探針裡不可靠：`schemaOrder` 由 core 以 spawn
 * `openspec` 取得，而 core 對結果（**包含 `null`**）有 30 秒 TTL 的快取 —— 一次暫時性的失敗會讓
 * 同一個 repo 在半分鐘內持續拿到 `null`。實測 `probe:openspec` 的兩個模式因此一紅一綠：程式碼相同，
 * 只是各自的 app 啟動時序落在快取窗口的兩邊。**一條會間歇通過的斷言比沒有斷言更糟**，所以
 * 「權威順序可用時不呈現」這條 scenario 的載體在這裡，不在探針。
 */
export type FallbackReason = 'archived' | 'unavailable' | null

export function fallbackReason(
  status: 'active' | 'archived',
  schemaOrder: string[] | undefined,
): FallbackReason {
  // 有權威順序就沒有話要說。**一句恆常顯示的說明等於沒有說明。**
  if (schemaOrder && schemaOrder.length > 0) return null

  // 已封存的 change 永遠取不到權威順序（core 只對進行中的 change 查詢），所以這不是偶發狀態
  // 而是常態 —— 它值得一句與其他成因不同的話。
  if (status === 'archived') return 'archived'

  // 進行中的 change 取不到的成因有好幾種（外部程式不可解析、逾時、非零結束、輸出對不上），
  // 而這裡沒有足以分辨的資訊。**指定一個成因會是編造。**
  return 'unavailable'
}
