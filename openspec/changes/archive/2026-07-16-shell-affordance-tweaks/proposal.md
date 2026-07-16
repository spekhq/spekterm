## Why

第五次 dogfooding 抓到三個殼層的小毛病，彼此獨立、都便宜：

1. 按 `Alt` 會浮出一條原生 menu bar，但這個 app 從未定義任何 menu 內容 —— 那是一塊空殼，
   對使用者零價值，只會擋住畫面、讓人以為漏看了什麼。
2. 建立 session 的入口寫著「+ session」，字太多 —— 一顆「+」已足夠表意。
3. 有 `Ctrl+T` 開建立入口，卻沒有對應的關閉快捷鍵 —— 關 session 只能靠滑鼠點分頁的 ✕。

## What Changes

- **移除原生 menu bar。** 主行程不再為視窗設定 menu bar（改用等效於 `Menu.setApplicationMenu(null)`
  的作法，取代目前的 `autoHideMenuBar: true`）—— `Alt` 不再叫出任何東西。
- **精簡建立 session 的入口文字**：分頁列與空狀態列的「+ session」可見文字改為「+」。
  **`aria-label` 維持 `sessions.new`（"New session"）不變** —— 它同時是無障礙標籤與 6 支 probe
  加 `Ctrl+T` 的選擇器，動它會讓探針靜默選不到元素。這是純呈現微調，不改任何 spec 行為。
- **新增關閉當前 session 的快捷鍵 `Ctrl+Shift+W`**（鍵位已與使用者確認）：關閉當前 focused
  的 session，攔截點同既有快捷鍵 —— window 的 capture 階段（早於 xterm 與 Monaco）。

## Capabilities

### New Capabilities

（無 —— 三條都落在既有 capability 上，或是純呈現微調。）

### Modified Capabilities

- `workspace-app-shell`：新增一條 requirement —— 應用程式視窗 SHALL NOT 呈現原生 menu bar
  （`Alt` 不叫出 menu）。
- `keyboard-navigation`：新增一條 requirement —— `Ctrl+Shift+W` 關閉當前 session。

## Impact

- **主行程**：`src/main/index.ts` 的 `createWindow` —— 移除 `autoHideMenuBar: true`，改為
  移除整個 menu。
- **Renderer**：`SessionTabs.tsx` 兩處可見文字「+ session」→「+」（aria-label 不動）；
  `KeyboardNavigation.tsx` 加 `Ctrl+Shift+W` 的處理（關閉 `sessions.focusedIdFor` 取得的
  當前 session），攔截於 window 的 capture 階段。
- **驗收**：`probe:keyboard` 加 `Ctrl+Shift+W` 的驗收（含「按鍵不流進 pty」）；
  `probe:terminal` 確認「+」文字改動不打到既有選擇器（既有選擇器靠 `aria-label`，應不受影響）；
  `probe:shell` 若有 menu 相關可觀察點則一併涵蓋。CLAUDE.md 的快捷鍵表更新。
