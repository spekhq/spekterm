## 1. session 的標籤跟隨 pty 的終端標題

- [x] 1.1 `terminal/xterm.ts`：wrapper 暴露 `onTitle(listener)`（接 xterm 的 `onTitleChange`，回傳解除訂閱的函式），維持「其他模組不直接 import `@xterm/*`」的約束（design D1）
- [x] 1.2 `terminal/sessions.tsx`：`SessionState` 增加 `title?: string`，並提供 `setTitle(sessionId, title)`；空字串視為未設定（design D2、D3）
- [x] 1.3 `terminal/TerminalView.tsx`：訂閱 wrapper 的 `onTitle` → `sessions.setTitle`
- [x] 1.4 `terminal/session-badge.tsx`：`sessionLabel()` 改為 `title ?? ${spawnTarget} ${ordinal}`；新增截斷（28 字元）與**完整標題供 tooltip 使用**的函式（design D3）
- [x] 1.5 分頁列與 rail 子列兩處都改用新的標籤與 tooltip（同一個身分，不各自為政）

## 2. 建立 session 的入口

- [x] 2.1 抽出 `useSpawnMenu()`：回傳 `open(event)` 與待渲染的選單節點，底層仍用既有的 `ContextMenu`（它已處理「開啟事件自我關閉」與「夾進 viewport」）；**分頁列與 rail 各持有自己的選單狀態**（design D4）
- [x] 2.2 `terminal/SessionTabs.tsx`：`+ session` 緊鄰最後一個分頁之後（`tablist` 不再 `flex-1`，剩餘空間交給其後的 spacer）；分頁溢出捲動時按鈕仍留在可視區（design D5）
- [x] 2.3 `WorkspaceRail.tsx`：folder 列新增建立 session 的 `+` 入口（hover 顯示、`stopPropagation`）；建立後選中該 folder 並聚焦新 session（design D6）

## 3. rail 的關閉入口

- [x] 3.1 `WorkspaceRail.tsx`：session 子列新增 `✕` 關閉入口（hover 顯示、`stopPropagation`），呼叫 `sessions.close`（design D7）

## 4. 驗收

- [x] 4.1 `scripts/probe-terminal.mjs`：以 `printf '\033]0;spek-title\007'` 送 OSC 序列，斷言分頁與 rail 子列的標籤都更新為該標題
- [x] 4.2 probe：新 session 未設定標題時，標籤為本地標籤（fallback）
- [x] 4.3 probe：自 rail 的 folder 列建立 session（真滑鼠事件開選單 → 選 spawn 目標），斷言 session 出現且被聚焦
- [x] 4.4 probe：自 rail 的 session 子列關閉 session，斷言它自 rail 與分頁列一併消失、且其 pty 被終止
- [x] 4.5 probe：斷言 `+ session` 緊鄰最後一個分頁（兩者的水平間距在合理範圍內，而非位於分頁列另一端）
- [x] 4.6 以 role／aria 定位，**不掛 `data-*`**、不在產品程式碼塞測試分支

## 5. 型別、測試與文件

- [x] 5.1 `npm run typecheck` 通過
- [x] 5.2 `npm test` 通過
- [x] 5.3 `npm run lint` 通過
- [x] 5.4 `npm run probe:terminal` 於 dev 與 build 兩模式皆通過
- [x] 5.5 更新 `CLAUDE.md`（session 標籤由 pty 的 OSC 標題決定，非本地流水號）
