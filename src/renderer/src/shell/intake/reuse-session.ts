/**
 * 一則 intake 再次被處理時：沿用它已經建立的 session，還是建一個新的。
 *
 * **抽成純函式是為了讓它有載體。** 判斷本身只有幾行，但它防的是一個沒有上界的缺陷：
 * 預填逾時會把 intake 退回待處理，而**那個 session 仍然存在** —— 再次接受時若又建一個，
 * 每處理一次就多一個空的 session，而每一個看起來都正常。
 *
 * **判斷必須在 renderer**：session 清單的權威在這裡，主行程那一份是去抖動地落盤的副本，
 * 以它為準會在「剛建好、還沒落盤」的窗口裡誤判。
 *
 * ## 還要問它在不在使用者這次確認的 folder（intake-inbox-usability）
 *
 * 使用者接受之前可以改選 folder。舊的 session 在**原本的** folder —— 沿用它等於把本文送進
 * 使用者剛剛明確改掉的 repo。那時建一個新的；**舊的不關**（使用者可能已經在裡面打過字，
 * 而關閉 pty 無法還原）。
 */
export function sessionToReuse(
  existingSessionId: string | undefined,
  liveSessions: readonly { id: string; folderId: string | null }[],
  chosenFolderId: string,
): string | null {
  if (!existingSessionId) return null
  const session = liveSessions.find((candidate) => candidate.id === existingSessionId)
  return session && session.folderId === chosenFolderId ? existingSessionId : null
}
