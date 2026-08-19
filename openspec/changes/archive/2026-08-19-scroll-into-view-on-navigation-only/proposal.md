## Why

rail 的捲動位置**一直被搶回 focused session 那一列**：使用者往下捲去看別的 repo，只要有任何一個
session 還在運作，畫面就跳回去。repo 一多（超出 rail 可視範圍）就完全無法瀏覽清單。

根因是「捲入可視範圍」的**觸發條件寫錯了**。`keyboard-navigation` 的 requirement 說的是「**選取或
焦點改變時**捲動」，但 `RailRow` 的 effect 依賴裡放了整個 session 陣列
（`WorkspaceRail.tsx:170`），而該陣列來自 `forFolder()` 的 `filter()`（`sessions.tsx:538`）——
**每次渲染都是新的身分**。於是實際的觸發條件變成「這個元件重繪了」。

而**運作中的 session 正是重繪的來源**：`claude` 隨任務進展持續以 OSC 宣告新標題 → `setTitle` →
`setSessions` → 整棵 `useSessions` 消費樹重繪 → 每個 `RailRow` 的 effect 重跑一次。session 跑得
越勤，rail 跳得越兇 —— **這正是這個 app 的常態工作情境**。

`SessionTabs.tsx:67` 是同一個錯誤的另一份（`[focusedId, sessions, tabScroll]`），分頁列橫向同樣
會被搶，只是分頁少時看不出來（分頁列的重繪來源還不只 session 標題 —— `MainStage` 自己的 state
與側欄座標 context 也會讓它重繪，成因比 rail 更廣，而修法一體適用）。

## What Changes

- **捲動的觸發條件由「陣列身分改變」收窄為「目標位置改變」** —— `RailRow` 與 `SessionTabs` 的
  effect 依賴改為 `selected` / `focusedId` 與**目標的索引**。標題更新時索引不變 ⇒ 不捲；
  `Shift+←→` 重排時索引改變 ⇒ 照捲（既有 requirement 保住）。
- **`keyboard-navigation` 補上反向的不變式**：選取、焦點與順序**皆未改變**時 SHALL NOT 捲動 ——
  包含 session 標題更新、狀態轉換等與導航無關的重繪。既有的「目標已完整可見時 SHALL NOT 捲動」
  管的是**幅度**，管不到**時機**，而使用者踩到的是後者。
- **驗收補上載體**：`probe:keyboard` 新增一段 —— rail 捲離 focused 子列後，觸發一次與導航無關的
  session 狀態更新，斷言 `scrollTop` 不變。

**不做**（記錄理由，避免日後被當成漏掉的事）：

- **不 memo 化 `forFolder()`** —— 那不是根本解。標題更新時 `setSessions` 本來就會產生新陣列與新
  物件，memo 化之後 effect 照樣重跑。它只會讓這個 bug 更難重現，而不是消失。
- **不把滾輪／捲軸納入 `useScrollIntoView` 的 pointer guard** —— 那道 guard 解的是另一個問題
  （「以指標點半可見的目標時它在游標底下跳走」）。觸發條件修正後，使用者手動捲動與導航之間
  不再有衝突：沒有導航就不會捲。**在錯誤的觸發條件上再加一層抑制，是把症狀蓋住。**

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `keyboard-navigation`: 「選取或焦點改變時目標捲入可視範圍」補上反向不變式 —— 選取／焦點／順序
  皆未改變時 SHALL NOT 捲動，並要求驗收以「與導航無關的狀態更新」為對照。

## Impact

- `src/renderer/src/shell/useScrollIntoView.ts` —— 新增以純量 key 為觸發的原語，移除舊的
  `scrollIntoView` 匯出（改完之後它零呼叫端）。**pointer guard 的語意一字不改** —— 它與這個缺陷
  正交。
- `src/renderer/src/shell/WorkspaceRail.tsx` —— `railScroll` 與 `RailRow` 的 `rowScroll`。
- `src/renderer/src/shell/terminal/SessionTabs.tsx` —— 同型的分頁捲動 effect。
- `scripts/probe-keyboard.mjs` —— 新增驗收段落，並補上兩條既有 scenario 缺的載體。
- `src/renderer/src/shell/quick-open/QuickOpen.tsx` —— **不改**。它直接呼叫 DOM 的
  `scrollIntoView`，不是這個 hook 的消費點，觸發條件本來就是純量。
