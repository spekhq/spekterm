## 1. 相依安裝

- [x] 1.1 安裝 `@xterm/xterm`、`@xterm/addon-fit`、`@xterm/addon-web-links`（node-pty 已於 Phase 0 安裝並釘死；xterm 系列為純 JS，以 caret 宣告即可，見 design Migration）

## 2. 主行程：pty 管理器 `TerminalService`

- [x] 2.1 建 `src/main/terminal.ts`：`TerminalService` 持有 `Map<sessionId, IPty>`，建構時注入 `send` 出口，**不 import Electron**（比照 `WatchService`，可由單元測試直接驅動，design D1）
- [x] 2.2 `create(folderId, spawnTarget)`：查 store 驗 `folderId` 存在且 `status === 'ok'`；cwd = folder root（**只接受 folderId、不接受任何路徑**，design D5）；spawn `$SHELL`（login shell 用 `['-l']`、claude 用 `['-l', '-c', 'claude']`，design D6）；`env` 帶 `{ ...process.env, TERM: 'xterm-256color' }`，`encoding: 'utf8'`；主行程產生並回傳 `sessionId`（`crypto.randomUUID()`，design D3）
- [x] 2.3 `onData` 逐 chunk `send('data', sessionId, chunk)`，**不 debounce、不重排**（與 watcher 的關鍵差異，design D4）；`onExit` `send('exit', sessionId, exitCode)`，且**保留** Map 中的實例直到被明確關閉（已結束的 session 仍要能讀輸出，design D9）
- [x] 2.4 `write(sessionId, data)` / `resize(sessionId, cols, rows)` / `kill(sessionId)`（`SIGHUP`）；`kill` 後自 Map 移除（design D12）
- [x] 2.5 `dispose()`：kill 全部 pty 並清空 Map —— 供 `destroyed` 與 `did-navigate` 呼叫（design D1、D2）
- [x] 2.6 spawn 以 `try/catch` 包覆，底層 shell 起不來時拋帶 `code` 的 `TerminalError`（design D15）
- [x] 2.7 `src/main/terminal.test.ts`：以 `send` spy 驗雙向串流與 `exit`（用 `printf`/`echo` 等短命令，不依賴 CDP）；驗 `create` 拒絕未知／失效 folder；驗 `dispose` 殺光所有 pty；驗 spawn 失敗回錯

## 3. IPC 與 preload 白名單

- [x] 3.1 建 `src/main/ipc/terminal.ts`：`TERMINAL_CHANNELS`；每個 `webContents` 一份 `TerminalService`（`serviceFor`，比照 `ipc/fs.ts`）；`create` 用 `ipcMain.handle` + `toResult`（cwd／spawn 失敗回結果物件）；`write`/`resize`/`kill` 用 `ipcMain.on`（單向 `send`，design D4）；push 用 `contents.send`；`webContents` `'destroyed'` → `dispose()`；**`'did-navigate'` → `dispose()`**（reload 不殺 pty 會留孤兒且新頁面收不到輸出，design D2）
- [x] 3.2 `src/main/index.ts`：`registerTerminalHandlers()`
- [x] 3.3 `src/preload/index.ts`：新增 `workspace.terminal.*`（`create`/`write`/`resize`/`kill`/`onData`/`onExit`）；`onData`/`onExit` 沿用 `onWatchEvent` 的訂閱形狀，回傳解除函式；補檔頭白名單註解（design D11）
- [x] 3.4 更新 `src/preload/index.d.ts` 的型別

## 4. renderer：xterm wrapper 與終端元件

- [x] 4.1 建 `src/renderer/src/shell/terminal/` 的 xterm wrapper（**單一模組直接 import `@xterm/*`**，比照 `workspace-app-shell`「編輯器透過 wrapper 介面存取」的約束）：組裝 `Terminal` + `FitAddon` + `WebLinksAddon`；web-links 的開啟 handler 覆寫為 `workspace.shell.openExternal`（不讓 xterm 自行導航／開窗，design D13）
- [x] 4.2 `TerminalView` 元件：掛載 `Terminal`；訂閱 `onData`（過濾本 `sessionId`）→ `term.write`；`term.onData` → `workspace.terminal.write`；`ResizeObserver` → `fit()` → `resize`（debounce，尺寸未變不送，design D8）
- [x] 4.3 常駐實例策略：每個 session 一個 `Terminal`，未 focused 以 `display:none` 隱藏、**不 dispose**；由隱藏轉顯示時重新 `fit()` 一次（design D7）

## 5. renderer：session 狀態與版面

- [x] 5.1 session 狀態管理（`AppShell` 層，比照 `DirtyBuffersProvider`）：`SessionState { id, folderId, spawnTarget, status, exitCode? }` 清單 + `Map<folderId, focusedSessionId>`；`create`/`close`/`exit` 更新狀態；**跨切換 folder 存活**（design D9）
- [x] 5.2 頂部 session 分頁列元件：呈現當前 folder 的 session、標示 focused、切換、`+ session`（帶 spawn 目標選擇 claude／shell）、關閉分頁；當前 repo 無 session 時呈現空狀態與建立入口（spec `workspace-layout` 分頁列；design D10）
- [x] 5.3 `MainStage.tsx`：換掉「terminal（Phase 4）」placeholder —— 於 `Group` 之上插入分頁列，左 Panel 掛載當前 folder 各 session 的 `TerminalView`（常駐、以 focused 決定 `display`）
- [x] 5.4 `WorkspaceRail.tsx`：`FolderRow` 之下渲染 session 子列（巢狀結構已預留），可見、點選聚焦（選中該 folder 並設為 focused）、可展開收合（spec `workspace-layout` session 子列）
- [x] 5.5 `src/renderer/src/shell/types.ts`：由 preload 白名單回推 terminal DTO（sessionId、spawnTarget 等），不直接 import 主行程模組

## 6. 驗收 probe

- [x] 6.1 `scripts/probe-terminal.mjs`（dev 與 build 兩模式，比照 `probe:files` 自起 renderer dev server + 自 spawn electron、以獨一 `--user-data-dir` profile）：login shell session 的 `pwd` 驗 cwd、`echo __SPEK__` 驗雙向回顯、建立第二 session 驗多開、改變尺寸驗 pty 收到（`stty size`／`$COLUMNS`）
- [x] 6.2 生命週期 probe：spawn 的 env 帶獨一 marker；關閉分頁 → 該 pid 自 `/proc`／`ps` 消失；**關閉視窗 → 該 window 所有 pty pid 全數消失**（驗不留孤兒，design D14、Risks；必須真的關窗回查 pid，不能只斷言 UI 清空）
- [x] 6.3 claude 模式 probe：驗「選 claude 後 pty 能 spawn 起來且存活」（不驗互動）；分頁列與終端以 role／aria 可識別（**不掛 `data-*`**）
- [x] 6.4 `package.json` 新增 `probe:terminal` script

## 7. 型別、測試與文件

- [x] 7.1 `npm run typecheck` 通過（main／preload node + renderer web）
- [x] 7.2 `npm test` 通過（含新增的 `terminal.test.ts`）
- [x] 7.3 `npm run probe:terminal` 於 dev 與 build 兩模式皆通過
- [x] 7.4 更新 `CLAUDE.md`：Phase 4 現況，與 terminal 的踩雷點（`did-navigate` 必須殺 pty、GUI app 缺 shell PATH 故經 `$SHELL -l`、cwd 邊界只約束初始 cwd 非沙箱、`display:none` 後需 refit）
- [x] 7.5 更新 `openspec/config.yaml` 的 Status 與（若需要）dev 指令清單
