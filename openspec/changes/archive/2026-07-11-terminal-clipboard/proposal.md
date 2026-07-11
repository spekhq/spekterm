## Why

**終端不能複製貼上，等於不能用。** 使用者實測時第一件想做的事就是把一段指令貼進去 —— 做不到。

原因不是漏了一顆按鈕，而是 xterm 的選取**根本不是 DOM selection**（它自己在畫布/DOM 層畫選取範圍），因此瀏覽器原生的「Ctrl+C 複製選取文字」對它完全無效。滑鼠路徑（右鍵選單、中鍵貼上）我一條都沒做。終端最基本的兩個操作因此都不存在。

而終端裡的 `Ctrl+C` 是 **SIGINT**，不能拿來當複製 —— 這正是所有終端模擬器都用 `Ctrl+Shift+C` / `Ctrl+Shift+V` 的原因。

## What Changes

### 終端的複製與貼上

- **右鍵選單**（滑鼠路徑）：`複製`（無選取時停用）與 `貼上`。重用既有的 `ContextMenu`（它已處理「開啟事件自我關閉」與「夾進 viewport」）。
- **鍵盤**：`Ctrl+Shift+C` 複製選取、`Ctrl+Shift+V` 貼上（macOS 為 `Cmd+C`／`Cmd+V`）。
- **中鍵貼上**（Linux 慣例）。
- **`Ctrl+C` 維持 SIGINT，不被挪用**。使用者要中斷程式的能力，遠比省一個 Shift 重要。

### 新的主行程能力：clipboard

- preload 新增 `workspace.clipboard.readText()` / `writeText(text)`，主行程以 Electron 的 `clipboard` module 實作。
- **不用 `navigator.clipboard`**：它的 `readText()` 在 Electron 中受權限模型擺布（需要 `clipboard-read`），行為跨平台不一致；主行程的 clipboard 沒有這個問題。

### 這道能力的邊界（必須誠實寫明）

`readText()` 讓 renderer 能讀取**系統剪貼簿的當下內容** —— 那可能是使用者剛複製的密碼。這與 `fs.*` 那種「只能碰 workspace folder」的沙箱不同：**剪貼簿沒有 workspace 邊界可言**。

之所以可接受：
- renderer 是本應用程式自身的程式碼，且**導航防護**（`workspace-app-shell`）已確保它不會變成遠端頁面 —— 少了那道防護，一個 markdown 連結就能把這個能力交給任意網站。
- 讀取只發生在**使用者明確要求貼上**時（右鍵選單、快捷鍵、中鍵），不主動、不背景輪詢。
- 這是終端貼上的**必要條件**，沒有替代路徑。

**明確不做**：不讀寫剪貼簿的非文字格式（圖片、檔案）；不做「選取即自動複製」（它會在使用者只是想標記一段文字時，靜默覆蓋掉他剪貼簿裡的東西）。

## Capabilities

### Modified Capabilities

- `terminal-sessions`：新增一條 requirement —— **終端支援複製與貼上**（滑鼠與鍵盤兩條路徑，且 `Ctrl+C` 保留為 SIGINT）。

## Impact

- **主行程**：新增 `src/main/ipc/clipboard.ts`（Electron `clipboard` module）；`src/main/index.ts` 註冊。
- **preload**：新增 `workspace.clipboard.*`（受 `workspace-app-shell` 的白名單通則約束）。
- **renderer**：`terminal/xterm.ts`（wrapper 暴露 `getSelection` / `hasSelection` / `paste` / 自訂按鍵處理）、`terminal/TerminalView.tsx`（右鍵選單、中鍵貼上）。
- **驗收**：擴充 `scripts/probe-terminal.mjs` —— 以**真滑鼠右鍵事件**開選單（合成事件測不出 overlay 的自我關閉）、驗選單落在 viewport 內、驗複製與貼上真的往返（寫入剪貼簿 → 貼上 → pty 執行到那段文字）。
