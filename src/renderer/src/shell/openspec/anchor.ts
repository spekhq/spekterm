/**
 * 解析所需的最小形狀 —— **只有 slug**。
 *
 * 刻意不收 `ChangesData` 本身：這條規則用不到 change 的其餘欄位，而收得越少，能錯的方式越少
 * （`ChangesData` 是可指派給它的）。比照 `continuationBlockOf` 的作法。
 */
export interface AnchorCandidates {
  active: readonly { slug: string }[]
  archived: readonly { slug: string }[]
}

/**
 * 側欄座標所錨定的 change，解析成「一個確實存在的 slug」或「沒有」。
 *
 * **這條規則有兩個消費者**（側欄的「本 change」視圖與狀態列的 change 欄位），而它們此前各自
 * 實作過一次 —— `StatusBar` 的註解甚至明寫「解析方式與側欄一致」，靠的是兩邊碰巧一樣。一條規則
 * 兩份實作，下一次只會有一份被改到，而分歧的徵狀是**畫面上兩個地方對同一個問題給出兩個答案**，
 * 型別檢查與探針都不會有一句話。
 *
 * 三層，順序即優先序：
 *
 * 1. **明確的錨定，且它存在於掃描結果中**（`active` ∪ `archived`）—— 主行程的白名單查表用的
 *    就是同一份掃描結果，於是「renderer 認為有效、主行程說沒有」表達不出來。
 * 2. **來源 repo 恰有一個 active change** —— 衍生的預設值，動態解析（`openspec-panel`）。
 * 3. 否則沒有。
 *
 * **查表這一步是本函式存在的理由。** 錨定跨重啟存活，而 slug 不是穩定識別碼：`openspec archive`
 * 會把 `add-list-unsubscribe-header` 改名為 `2026-08-03-add-list-unsubscribe-header`，worktree
 * 一移除更是讓一整批 change 自掃描結果中消失。少了查表，那個 slug 會被送去主行程，換回一個
 * `unknown change slug: …` 被原樣畫到側欄上 —— 而使用者只是把一個 change 封存了。
 *
 * **清單尚未載入（`null`）時回傳「沒有」，不是「沿用未驗證的錨定」。** 沿用的話，啟動當下就會
 * 先閃一次那行錯誤。代價是入口晚一步出現，而那個窗口本來就是側欄在載入的窗口。
 *
 * **本函式是唯讀的。** 解析失敗**不清除**落盤的錨定：清除是一次由掃描結果驅動的寫入，而掃描
 * 可能因暫時性的原因看不到該 change（worktree 尚未掛回、目錄暫時無法讀取），那會把一個仍然正確
 * 的錨定永久抹掉，且是靜默的。留著它沒有代價 —— 它隨時可能再度可解析。
 */
export function resolveAnchoredChange(
  explicit: string | null | undefined,
  changes: AnchorCandidates | null | undefined,
): string | null {
  if (!changes) return null

  if (explicit) {
    const known =
      changes.active.some((entry) => entry.slug === explicit) ||
      changes.archived.some((entry) => entry.slug === explicit)
    if (known) return explicit
  }

  return changes.active.length === 1 ? changes.active[0].slug : null
}
