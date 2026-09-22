## Why

tasks 分頁對已完成的項目施加淡化（`text-ink-faint`）與刪除線，作法是把顏色掛在 `<li>` 上、
讓內文**繼承**它。但內文走 `MarkdownView`，而它的 `strong` 元件**自己指定了顏色**
（`font-semibold text-ink`，BDD 關鍵字另有 `text-blue` / `text-green` / `text-danger`），
連結亦然。**子元素自己的 `color` 贏過繼承來的值** —— 於是一條已完成的 task 裡，每一段
`**粗體**` 仍是最亮的前景色。

實際使用時這很吵：一條被刪除線劃掉、卻夾著數段全亮粗體字的 task，讀起來像是還有東西要做。
而 tasks 清單是側欄的**主要閱讀內容**（見 `ChangeView.tsx` 既有的註解）—— 「哪些還沒做」是
使用者掃視它時唯一在找的東西，全亮粗體正好偽裝成那個訊號。

`openspec-panel` 已有一條 scenario 說「多行項目的視覺區分**涵蓋該項目的整段文字**」，而它是綠的
—— 因為它只看 `<li>` 的 `text-decoration-line`。刪除線確實涵蓋了整段（`text-decoration` 會傳播給
後代），顏色沒有。**那條 scenario 的措辭已經表達了正確的意圖，載體卻只驗到其中一半。**

## What Changes

- 已完成的 task 列之內，**任何元素都不得宣告自己的顏色** —— 以一條涵蓋整棵子樹的 CSS 規則
  （`.task-done .markdown * { color: inherit }`）強制繼承該列的淡化色。作法與理由見 `design.md` D1。
- `ChangeView.tsx` 的已完成 `<li>` 多掛一個 class；未完成的列不掛。
- **`MarkdownView` 一個字都不改。** 拿掉 `strong` 的 `text-ink` 會改到**散文**（非 dense 的容器是
  `text-ink-dim`，那裡的層級差是承重的），而散文的一般 `strong` **沒有任何載體**。
  另一個理由更強：列舉「要修哪些元素」是白名單，而那份清單第一次寫就漏了三條
  （`h1..h4` / `blockquote` / `th` 也自帶顏色）。見 `design.md` D1。
- 散文（proposal／design／spec deltas／檔案檢視）與未完成 task 的呈現皆不變。
- `openspec-panel` 的 tasks 分頁 requirement 明文化：已完成項目的視覺區分 SHALL 涵蓋其文字
  **經 markdown 渲染出來的行內元素**，SHALL NOT 被渲染路徑自身的配色蓋過。
- 補上載體：`TASKS` fixture 的 task 1.1 補一個外部連結與一個 `**SHALL**`，新增三條顏色斷言
  —— 原本只驗粗體，而鑑別力最高的恰好是連結與 BDD 標示（見 `design.md` D5）。
- 已完成列的顏色**維持 `text-ink-faint` 不變** —— 提高到 `ink-dim`（6.95:1、過 WCAG AA）的方案
  經渲染比對後被否決：淡化不夠，而「已完成的東西不該搶注意力」正是本 change 的訴求。
- 不跟進上游「tasks 分頁不做 BDD 上色」—— 那會改變**未完成** task 的呈現，超出本 change 的
  作用域（見 `design.md` D6）。

**不採用 `opacity` 來淡化。** 它在顏色決定之後才套用、一次作用於每一個後代，連「整列同一個顏色」
這個性質都保不住。上游 spek 走過這條路並 revert（`packages/web/src/styles/contrast.test.ts:572-591`
至今擋著整個 `opacity-*`）。

**對比度是一個被知情裁決的缺口。** 已完成列落在 **3.06:1**，低於 WCAG AA 的 4.5:1，也低於上游
判定不可接受的 3.24:1 —— 而該列的內文今天就已經是這個值。完整的量測、與上游相反的方向、
以及裁決的三個理由見 `design.md` D4。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `openspec-panel`：「tasks 分頁呈現進度與分組的項目」這條 requirement 的完成狀態區分，
  其涵蓋範圍由「整段文字」明確到「整段文字**及其行內渲染結果**」。

## Impact

- `src/renderer/src/shell/openspec/ChangeView.tsx` —— 已完成 `<li>` 的 class
- `src/renderer/src/index.css` —— 強制繼承的那一條規則
- `scripts/probe-openspec.mjs` —— `TASK_ITEMS` 取出顏色、新增斷言
- `scripts/scenario-coverage.test.mjs` —— 本 change 登記進 `COVERED_CHANGES` 並填表
- `scripts/probe-openspec.mjs` 的 `TASKS` fixture —— task 1.1 補一個外部連結與一個 `**SHALL**`
- **`MarkdownView.tsx` 不動** —— 見 `design.md` D1。
- 不動主行程、不動資料流、不新增依賴。`@spekjs/*` 無涉。
