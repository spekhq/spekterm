## Why

session 的身分現在**完全由 pty 決定**（`session-titles-and-controls` 接上了 OSC 終端標題）。這解決了「三個 `claude 1` 分不出誰是誰」，但也把命名權整個交了出去 —— 使用者**無法自己替 session 取名**。開了五個 session 在同一個 repo 上做不同的事，你想叫它們「重構」「查 bug」「跑測試」，做不到。

而 session 的**順序**是建立的先後，改不了。VSCode 的分頁可以拖，這裡不行 —— 開到第五個 session 之後，順序就是一團你無法整理的東西。

## What Changes

### 使用者可以替 session 取名

- 分頁與 rail 子列的**右鍵選單**提供「重新命名」。
- 標籤的優先序：**使用者取的名字 > pty 宣告的標題 > 本地流水號**。

### 手動命名之後，pty 想改名要經過確認

使用者取了名字，就等於**接管了這個 session 的身分**。此後 pty（如 `claude`）再送 OSC 標題時，**不得靜默覆蓋** —— 而是跳出確認，讓使用者決定：

- **採用 pty 的名稱** → 交還命名權，此後回到自動跟隨（不再詢問）。
- **保留我取的名字** → 忽略這次的標題，繼續用使用者的名字。

**同時只會有一個確認對話框。** pty 在對話框開著時又送新標題，只會更新「待確認的那個名字」，不會堆疊出第二個框 —— 否則 `claude` 頻繁改標題時會把使用者的畫面淹掉。

### 分頁與 rail 的 session 可以拖曳排序

- **分頁列**：拖曳分頁改變順序（像 VSCode）。
- **rail 的 session 子列**：同樣可拖曳。
- 兩處共用**同一個順序** —— 它是 session 在該 repo 內的次序，不是某個視圖的裝飾。順序只在同一個 repo 之內有意義（不支援把 session 拖到別的 repo 底下 —— 那會需要改變它的 cwd，而 pty 的 cwd 是啟動時就定了的）。

**明確不做**：跨 repo 拖曳 session；順序的持久化（app 重啟不還原，與 session 本身一樣屬 Phase 6 的 layout 持久化）。

## Capabilities

### Modified Capabilities

- `terminal-sessions`：新增兩條 requirement —— **使用者可替 session 命名**（且優先於 pty 的標題）；**手動命名後 pty 的改名需經確認**（不得靜默覆蓋）。
- `workspace-layout`：分頁列與 rail 的 session 子列 **可拖曳排序**，且兩處共用同一個順序；兩處皆提供右鍵選單（重新命名／關閉）。

## Impact

- **renderer**：`terminal/sessions.tsx`（`customTitle` 與 `pendingTitle` 兩個欄位、`rename`／`acceptPendingTitle`／`keepCustomTitle`／`reorder`）、`terminal/session-badge.tsx`（標籤的優先序）、`terminal/SessionTabs.tsx`（右鍵選單、拖曳）、`WorkspaceRail.tsx`（右鍵選單、拖曳）、`terminal/TitleConflictDialog.tsx`（新增）。
- **拖曳以滑鼠事件實作，不用 HTML5 drag-and-drop** —— 後者在 CDP 下要走 `Input.setInterceptDrags` + `dispatchDragEvent` 那套，而滑鼠事件可以直接用探針既有的 `dragMouse` 驗真拖曳。
- **驗收**：擴充 `scripts/probe-terminal.mjs` —— 重新命名、pty 改名時的確認對話框（接受／保留兩條路徑）、拖曳分頁與 rail 子列後順序改變且兩處一致。
- **不動**：主行程、IPC 白名單、任何邊界。
