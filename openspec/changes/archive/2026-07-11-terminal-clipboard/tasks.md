## 1. 主行程：clipboard 能力

- [x] 1.1 建 `src/main/ipc/clipboard.ts`：以 Electron 的 `clipboard` module 實作 `readText`（`ipcMain.handle`，要回值）與 `writeText`（`ipcMain.on`，單向）（design D1）
- [x] 1.2 `src/main/index.ts`：註冊 clipboard handlers
- [x] 1.3 `src/preload/index.ts`：新增 `workspace.clipboard.readText()` / `writeText(text)`，**並於註解寫明其邊界** —— 剪貼簿沒有 workspace 邊界，可接受性建立在導航防護與「只在使用者明確要求貼上時讀取」之上（design D2）

## 2. renderer：xterm wrapper

- [x] 2.1 `terminal/xterm.ts`：暴露 `getSelection()`、`hasSelection()`、`paste(text)`，維持「其他模組不直接 import `@xterm/*`」的約束
- [x] 2.2 `terminal/xterm.ts`：以 `attachCustomKeyEventHandler` 攔截複製／貼上快捷鍵（`Ctrl+Shift+C`／`Ctrl+Shift+V`；macOS 為 `Cmd+C`／`Cmd+V`），**`Ctrl+C` 不攔截**（維持 SIGINT，design D3）

## 3. renderer：滑鼠路徑

- [x] 3.1 `terminal/TerminalView.tsx`：終端上的右鍵選單（重用 `ContextMenu`），提供複製（無選取時 `disabled`）與貼上（design D4）
- [x] 3.2 `terminal/TerminalView.tsx`：中鍵貼上（`mousedown` 的 `button === 1`，並 `preventDefault()` 以免進入 Chromium 的自動捲動模式）（design D5）
- [x] 3.3 複製 → `clipboard.writeText(getSelection())`；貼上 → `clipboard.readText()` → `paste(text)`（原封不動送交 pty，design D6）

## 4. 驗收

- [x] 4.1 `scripts/probe-terminal.mjs`：以**真右鍵事件**（`Input.dispatchMouseEvent` `button: 'right'`）開啟終端的右鍵選單，斷言它出現且**完整落在 viewport 內**（合成事件測不出 overlay 的自我關閉，CLAUDE.md 已記載此教訓）
- [x] 4.2 probe：貼上的往返 —— 先寫入剪貼簿，再自右鍵選單觸發貼上，斷言那段文字**真的被 pty 執行**（用「回顯不含答案」的命令形式，區分 tty 回顯與真正的執行）
- [x] 4.3 probe：無選取內容時，右鍵選單的複製項為停用狀態
- [x] 4.4 probe：複製 —— 選取終端內容後觸發複製，斷言剪貼簿內容改變（經主行程讀回）

## 5. 型別、測試與文件

- [x] 5.1 `npm run typecheck` 通過
- [x] 5.2 `npm test` 通過
- [x] 5.3 `npm run lint` 通過
- [x] 5.4 `npm run probe:terminal` 於 dev 與 build 兩模式皆通過
- [x] 5.5 更新 `CLAUDE.md`：終端的複製貼上路徑，與 `Ctrl+C` 維持 SIGINT 的取捨
