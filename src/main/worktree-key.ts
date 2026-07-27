/**
 * 工作目錄識別碼的格式判定 —— core 算的路徑 sha1 前 8 碼。
 *
 * **獨立成一個模組，是為了讓「寫入端」與「讀取端」共用同一份判定。** 它有兩組消費者：
 * `session-store`（session 開在哪個工作目錄）與 `panel-store`（側欄讀哪一份原始碼）——
 * 兩者是各自獨立的事實，但格式相同。平行實作兩份的話，日後 core 換了演算法，其中一份會
 * 靜默地與產品分歧，而落盤與讀取各用各的判定不會有任何一條斷言變紅。
 *
 * 這是白名單式的**格式**判定，不是「有沒有 `..`」那種黑名單 —— 後者總有漏網的編碼形式
 * （與 `session-store` 的 `isUuid` 同源）。
 */
export function isWorktreeKey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}$/.test(value)
}
