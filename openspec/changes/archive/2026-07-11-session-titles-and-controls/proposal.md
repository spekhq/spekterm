## Why

Phase 4 出貨後**第一次真實使用**就暴露了四個操作上的摩擦。它們不是 bug —— 探針 46/46 全綠、機制都對 —— 而是「把工作台當工作台用」之後才浮現的東西。

最關鍵的一個是：**session 無從辨識**。標籤是 `claude 1`／`shell 2` 這種本地流水號，開到第三個 claude session 就分不出誰是誰。而 **pty 裡的程式其實一直在告訴我們它是誰** —— `claude` 會以 OSC escape sequence 設定終端標題（那正是你的 gnome terminal 分頁會自動改名的機制），xterm 也早就解析了它。我們只是沒去接那個事件。

其餘三點都是「入口放在錯的地方」：rail 看得到 session、卻既不能開也不能關；主舞台的 `+ session` 被 flex 推到分頁列的最右端，開第二個分頁之後滑鼠要橫越整條列去點它。

## What Changes

### session 的身分：標籤跟隨 pty 設定的終端標題

- 接上 xterm 的 `onTitleChange`（pty 送出 OSC 0／2 時觸發），以它作為該 session 的標籤。
- **分頁列與 rail 子列兩處都用同一個標籤** —— 它是 session 的身分，不是某個視圖的裝飾。
- pty 從未設定標題時，退回既有的本地標籤（`claude 1`）。標題過長則截斷，完整標題仍可自 tooltip 取得。

### 入口回到手邊

- **rail 的 folder 列可直接建立 session**（同樣帶 spawn 目標選擇），不必先切到主舞台。
- **rail 的 session 子列可關閉該 session**。
- **主舞台的 `+ session` 緊貼最後一個分頁之後**，不再被推到分頁列最右端。

**明確不做**：session 狀態燈的 agent 語意、change badge 的真實錨定、handoff tag、session 版面的持久化 —— 這些仍屬後續 phase。

**本 change 全在 renderer**：不動主行程、不動 IPC 白名單、不動任何檔案系統或 cwd 邊界。終端標題是 xterm 在 renderer 解析出來的，主行程不需要知道它。

## Capabilities

### Modified Capabilities

- `terminal-sessions`：新增一條 requirement —— **session 的標籤反映 pty 設定的終端標題**（未設定時退回本地標籤）。session 的「身分」自此由 pty 內的程式決定，而不是由我們的流水號決定。
- `workspace-layout`：兩條既有 requirement 的行為擴充 —— rail 的 session 子列**新增建立與關閉入口**；主舞台分頁列的**建立入口位置**改為緊鄰最後一個分頁。

## Impact

- **renderer**：`terminal/xterm.ts`（wrapper 暴露 `onTitle`）、`terminal/sessions.tsx`（session 多一個 `title` 欄位與 `setTitle`）、`terminal/session-badge.tsx`（標籤的解析與截斷）、`terminal/TerminalView.tsx`（訂閱 title）、`terminal/SessionTabs.tsx`（建立入口位置）、`WorkspaceRail.tsx`（建立與關閉入口）。spawn 選單被兩處共用，需抽出。
- **驗收**：擴充 `scripts/probe-terminal.mjs` —— 以 `printf '\033]0;…\007'` 送 OSC 序列驗標籤更新與 fallback、驗 rail 的建立與關閉入口、驗 `+ session` 緊鄰分頁。仍以 role／aria 定位，**不掛 `data-*`**。
- **不影響**：主行程、preload 白名單、`terminal-sessions` 的邊界與生命週期要求（既有的 8 條 requirement 一條都不改）。
