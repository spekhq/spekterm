## Why

rail 的順序早已完全由使用者決定（拖曳與 `Shift+↑↓`，且落盤）——「把常用的 repo 排到最上面」今天
就做得到。**但那不解決真正的問題：rail 是一個捲動容器。** repo 一多、session 子列一展開，往下捲
去看別的 repo 時，排在最上面的那幾個就整批捲出視野；要回到它們得先捲回頂端。使用者要的不是一個
順序，而是**一組永遠在視野裡的項目**。

而全域項目（`global-session`）恰好是這個需求的既有特例：它已經恆為第一列，卻**同樣會被捲走**——
一個「這個應用程式恆常提供的一格」，在最需要它的時候（正在別的 repo 之間翻找）反而不在畫面上。

## What Changes

- **新增「置頂」（pinned）狀態**，可套用於任何 workspace folder，並持久化於 workspace 設定。
- **rail 分成兩段**：上段（pinned）與下段（其餘），兩段之間維持既有的視覺分隔線。pinned 的 folder
  SHALL 恆位於未 pinned 的 folder 之前。
- **上段留在 rail 的頂端，不隨捲動移開** —— 含各列展開的 session 子列。下段捲動時，上段一直在
  視野裡。**不設高度上限**（見下方「已知取捨」）。
- **全域項目恆為上段的第一列，且其 pinned 狀態不可取消。** 它呈現一個**停用**的圖釘指示（tooltip
  說明它恆置頂），使用者一眼看得出「它是 pinned 的，而且動不了」。
- **兩個 pin／unpin 入口**：
  - rail 標題列上一顆 hover 才出現的圖釘按鈕（與既有的「＋」「✕」同一族）；
  - **folder 標題列的右鍵選單**（今天只有 session 子列有右鍵選單）——「Pin to top / Unpin」與
    「Remove…」收在一起。
- **拖過分界即改變 pin 狀態**：把未 pinned 的 repo 拖進上段就 pin，拖出去就 unpin。同一條語意也
  套用於 `Shift+↑↓` —— 它就是鍵盤版的「移動一格」，跨過分界時 pin 狀態隨之改變。
- **`Ctrl+↑↓` 的巡覽順序**跟著 rail 的呈現順序（全域項目 → pinned → 其餘），不需新規則。
- **上段不得遮擋捲入可視範圍的目標** —— 見下方「這個 change 必須繞開的一個隱患」。

### 已知取捨

**上段不設高度上限**（使用者裁決）：pin 很多 repo、或 pinned repo 的 session 子列全部展開時，
上段可能吃掉整個 rail 的高度，下段就看不到了。裁決的理由是「pin 幾個是使用者自己的決定」。此缺口
於 design 記錄，不於本 change 處理。

### 這個 change 必須繞開的一個隱患

`keyboard-navigation` 要求「目標被捲入可視範圍，且**完整可見**」。「把上段固定在頂端」最自然的
實作是 CSS sticky，而那會讓上段**覆蓋在捲動容器的視口之上**；`scrollIntoView({ block: 'nearest' })`
把目標貼齊視口上緣時，就是把它送到上段的底下：**捲動確實發生了、目標確實落在視口的座標範圍內、
斷言確實會過，而使用者什麼都沒看到。**

處置是把上段放到**捲動容器之外**，讓遮擋在結構上不可能發生（design D2／D4）—— 而不是引入一套
避讓機制去維持它。對應的 requirement 與驗收仍然保留，作為防止日後改回 sticky 的載體。

## Capabilities

### New Capabilities

- `rail-pinning`: rail 項目的置頂狀態 —— 它的語意（pinned 佔呈現順序的前綴）、兩個操作入口、
  跨分界的移動如何改變它、上段不隨捲動移開，以及全域項目恆為 pinned 且不可取消。

### Modified Capabilities

- `workspace-folders`: 持久化的 folder 條目新增置頂狀態；「順序由使用者決定」新增一條不變式
  —— pinned 的 folder 恆佔清單的前綴（於載入時正規化），使「pinned 散落在中間」表達不出來。
- `global-session`: 「與 folder 清單之間有明確的視覺分隔」這條**與本 change 直接衝突** —— 分隔線
  之上從此不只有全域項目，還有 pinned 的 repo。改為：全域項目恆為 **pinned 段**的第一列，分隔線
  劃在 pinned 段與其餘 folder 之間。並新增：它的 pinned 狀態不可取消、不寫入持久化設定。
- `workspace-layout`: rail 的呈現新增置頂指示與 pin 入口、folder 標題列新增右鍵選單；repo 的拖曳
  新增「跨分界即改變 pin 狀態」。
- `keyboard-navigation`: 「捲入可視範圍」的「完整可見」明訂為**不被上段遮擋**；`Shift+↑↓`
  跨越分界時改變 pin 狀態（既有那條「選中全域項目時為無操作」不變 —— 它連移動都不會發生）。

## Impact

**主行程**
- `src/main/workspace-store.ts` —— `PersistedFolder` 新增 `pinned`、`parseWorkspace` 的驗證與
  載入時的前綴正規化、新的 `setPinned`、`reorder` 改為連帶重算 pin、`remove` 維持不變式。
- `src/main/ipc/folders.ts` —— 新增一個頻道。
- `src/preload/index.ts` + `index.d.ts` —— 白名單新增對應方法。

**renderer**
- `src/renderer/src/shell/WorkspaceRail.tsx` —— 分段渲染（上段移出捲動容器）、圖釘按鈕、
  folder 右鍵選單、拖曳命中判定涵蓋分界。
- `src/renderer/src/shell/useWorkspaceFolders.ts`、`types.ts` —— `pinned` 欄位與 `setPinned`。
- `src/renderer/src/shell/KeyboardNavigation.tsx` —— `Shift+↑↓` 跨分界。
- `src/renderer/src/shell/useScrollIntoView.ts` —— **不需改動**（遮擋以結構消除，見 design D4）。

**文案**
- `src/shared/i18n/en.json` —— 圖釘按鈕與右鍵選單的 `aria-label`／tooltip／選單標籤。
  **`aria-label` 同時是探針的選擇器**，命名須避開 shell 引號會咬到的字元。

**驗收**
- `scripts/probe-workspace.mjs`（`workspace-folders` / `workspace-layout`）、
  `scripts/probe-keyboard.mjs`（`Shift+↑↓` 跨界、上段之下的目標「完整可見」）。
  **這些驗收需要 rail 真的捲得動** —— 種足夠多的 folder 或縮小視窗，否則斷言恆為真。
  rail 的 `<ul>` 從一個變成兩個，直接抓捲動容器的探針程式碼會抓到不捲動的那一個（失效方向
  全部指向假綠）。
- `src/main/workspace-store.test.ts` —— 前綴不變式、載入正規化、舊設定檔的相容。

**相容性**
- 舊的 workspace 設定檔沒有 `pinned` 欄位，讀入後一律視為未置頂 —— **不需要升 `WORKSPACE_VERSION`**
  （新檔被舊版讀時，舊的 `parseWorkspace` 只挑它認得的欄位，多出來的 `pinned` 被忽略）。
