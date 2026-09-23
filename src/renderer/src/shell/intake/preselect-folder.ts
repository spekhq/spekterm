/**
 * 一張待處理卡片上**被選定的 folder** —— 按下接受時送出去的就是它（intake-inbox-usability）。
 *
 * 依序取第一個**仍在 workspace 中**的：
 *
 * 1. 使用者在這次打開收件匣之後的改選；
 * 2. **這一則已經建過、而且仍存在的 session 所在的 folder**；
 * 3. routing 的解析結果。
 *
 * 都沒有 ⇒ `''`（卡片渲染佔位項、接受鈕停用）。**系統不替使用者補任何預設值。**
 *
 * ## 第 2 條為什麼存在
 *
 * 使用者第一次接受時把 A 改成 B，session 開在 B；預填逾時，這一則退回待處理。接受成功時
 * 收件匣已經關閉，改選隨之消失 —— 少了第 2 條，重新打開時預選回 A，他沒注意就按下接受，
 * 本文便送進他先前明確改掉的 repo。
 *
 * ## 「仍在 workspace 中」為什麼每一層都要問
 *
 * 一個不在選項中的值會讓 `<select>` 顯示第一個選項、送出的卻是那個不存在的值
 * （`RulesEditor` 的規則選單就是這個形狀）。改選指向的 folder 被移除時要另外說明
 * （`overrideGone`）—— 只把選單清空，使用者看到的是「我剛剛選的東西不見了」而沒有原因。
 */
export interface Preselection {
  folderId: string
  /** 使用者改選的那個 folder 已不在 workspace。 */
  overrideGone: boolean
}

export function preselectFolder(input: {
  override: string | undefined
  existingSessionFolderId: string | null | undefined
  resolvedFolderId: string | undefined
  knownFolderIds: ReadonlySet<string>
}): Preselection {
  const { override, existingSessionFolderId, resolvedFolderId, knownFolderIds } = input
  const known = (candidate: string | null | undefined): candidate is string =>
    typeof candidate === 'string' && knownFolderIds.has(candidate)

  if (override !== undefined) {
    // 使用者的改選優先 —— 但它指向的 folder 不在了，就**不**往下退回第 2、3 層：
    // 那等於系統替他換了一個地方，而他以為選的是另一個。
    return known(override) ? { folderId: override, overrideGone: false } : { folderId: '', overrideGone: true }
  }
  if (known(existingSessionFolderId)) return { folderId: existingSessionFolderId, overrideGone: false }
  if (known(resolvedFolderId)) return { folderId: resolvedFolderId, overrideGone: false }
  return { folderId: '', overrideGone: false }
}
