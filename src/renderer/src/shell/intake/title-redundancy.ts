/**
 * 標題要不要另外呈現一列 —— **本文已經包含它時不要**（intake-inbox-usability，dogfood 回報）。
 *
 * Slack 的標題是被提及那一則訊息的第一行，而本文是那個討論串（含那一則）—— 同一段話在卡片上
 * 出現兩次。交接的標題則是一句摘要，不在本文裡，照常呈現。判準對任何 producer 都一樣，
 * 不以來源種類分支。
 *
 * 標題以「…」結尾時視為被截短過，比對去掉它的部分（長訊息的第一行常被截到欄位上限）。
 * **只影響呈現**：標題仍在那一列的無障礙標籤裡，交給 agent 的內容（本文）一個字元都沒變。
 */
export function showTitleSeparately(title: string, body: string): boolean {
  const core = title.endsWith('…') ? title.slice(0, -1) : title
  if (core.trim() === '') return false
  return !body.includes(core)
}
