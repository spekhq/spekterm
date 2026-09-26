/**
 * 交接關係的型別 —— 主行程與 renderer 共用（renderer 不能 import 主行程的模組）。
 */

/**
 * 來源的歸屬。**三態，而且必須是三態** —— 以 `null`／`undefined` 表達「全域」與「未知」的話，
 * 一個以 `=== null` 或 falsy 判斷的消費端會把「攝入時來源已結束」呈現成「來自全域」，
 * 而型別檢查對此無感（`CLAUDE.md`「加列舉值時 grep 所有 `===`」）。消費端一律窮舉 `kind`。
 */
export type HandoffSourceOrigin =
  | { kind: 'folder'; folderId: string; folderName: string }
  | { kind: 'global' }
  | { kind: 'unknown' }

/** session 的來源：母 session 的識別碼，與交接被攝入當下的快照。 */
export interface SessionLineage {
  /** 母 session 的 spekterm 識別碼（UUID）。**不是**對話識別碼 —— 後者在自癒時會換號。 */
  parentId: string
  origin: HandoffSourceOrigin
  parentTitle?: string
}
