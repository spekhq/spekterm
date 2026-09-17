/**
 * 一則 intake 再次被處理時：沿用它已經建立的 session，還是建一個新的。
 *
 * **抽成純函式是為了讓它有載體。** 判斷本身只有兩行，但它防的是一個沒有上界的缺陷：
 * 預填逾時會把 intake 退回待處理，而**那個 session 仍然存在** —— 再次接受時若又建一個，
 * 每處理一次就多一個空的 session，而每一個看起來都正常。
 *
 * **判斷必須在 renderer**：session 清單的權威在這裡，主行程那一份是去抖動地落盤的副本，
 * 以它為準會在「剛建好、還沒落盤」的窗口裡誤判。
 */
export function sessionToReuse(
  existingSessionId: string | undefined,
  liveSessionIds: readonly string[],
): string | null {
  if (!existingSessionId) return null
  return liveSessionIds.includes(existingSessionId) ? existingSessionId : null
}
