## 1. session 狀態：命名與命名權

- [x] 1.1 `terminal/sessions.tsx`：`SessionState` 增加 `customTitle?`（使用者取的名字）與 `pendingTitle?`（pty 想改、尚未裁決的名字）（design D1、D2）
- [x] 1.2 `rename(sessionId, name)`：空字串＝放棄命名權（清除 `customTitle`，回到跟隨 pty）
- [x] 1.3 改寫 `setTitle`：**沒有 `customTitle` 時照舊直接寫入**；**有 `customTitle` 且標題不同時寫入 `pendingTitle` 而不覆蓋**（design D2）
- [x] 1.4 `acceptPendingTitle(sessionId)`：清 `customTitle`、`title` 設為 `pendingTitle`、清 `pendingTitle` —— 命名權交還 pty，此後不再詢問
- [x] 1.5 `keepCustomTitle(sessionId)`：只清 `pendingTitle`，`customTitle` 不動 —— 下次 pty 再改名會再問一次
- [x] 1.6 `pendingTitle` 為**單一欄位**：pty 在確認未裁決時又送新標題，取代之而非堆疊（避免對話框淹沒畫面）
- [x] 1.7 `terminal/session-badge.tsx`：標籤優先序改為 `customTitle > title > 本地標籤`

## 2. 命名與確認的 UI

- [x] 2.1 `terminal/TitleConflictDialog.tsx`：呈現「使用者的名字」與「pty 想改的名字」，兩個選項：採用 pty 的名稱／保留我的名稱（design D5）
- [x] 2.2 `MainStage.tsx`：當前 folder 有任一 session 帶 `pendingTitle` 時呈現該對話框（同時只有一個）
- [x] 2.3 重新命名的入口重用既有的 `NameDialog`，預設值填入當前標籤

## 3. 右鍵選單（分頁與 rail 共用入口）

- [x] 3.1 `terminal/SessionTabs.tsx`：分頁的右鍵選單（重新命名／關閉），重用 `ContextMenu`（design D6）
- [x] 3.2 `WorkspaceRail.tsx`：session 子列的右鍵選單（重新命名／關閉）

## 4. 拖曳排序

- [x] 4.1 `terminal/sessions.tsx`：`reorder(folderId, fromIndex, toIndex)` —— 只重排該 folder 的那一段，其餘 folder 的相對順序不動（design D4）
- [x] 4.2 抽出拖曳的共用邏輯（`terminal/useDragReorder.ts`）：`mousedown → mousemove → mouseup`，**4px 閾值區分點擊與拖曳**，listener 掛在 `window` 上（拖曳中滑鼠會離開元素），卸載時解除（design D3）
- [x] 4.3 `terminal/SessionTabs.tsx`：分頁可拖曳排序，拖曳中呈現插入位置指示
- [x] 4.4 `WorkspaceRail.tsx`：session 子列可拖曳排序（垂直）
- [x] 4.5 拖曳中的 session 若結束或被關閉，以 id 查 index，找不到就放棄這次拖曳（不得因此崩潰或錯置）

## 5. 驗收

- [x] 5.1 `scripts/probe-terminal.mjs`：**真右鍵**開分頁選單（`Input.dispatchMouseEvent` `button: 'right'`），斷言選單出現且完整落在 viewport 內
- [x] 5.2 probe：重新命名 —— 自右鍵選單重新命名，斷言分頁與 rail 子列的標籤**兩處皆更新**
- [x] 5.3 probe：命名後送 OSC 標題 → 斷言**跳出確認**且標籤**尚未被覆蓋**；選「保留我的名稱」→ 標籤維持使用者的名字
- [x] 5.4 probe：再送 OSC 標題 → 再次確認 → 選「採用 pty 的名稱」→ 標籤變為 pty 的標題；**其後再送標題不再跳確認**（命名權已交還）
- [x] 5.5 probe：以 `dragMouse` 真拖曳分頁改變順序，斷言分頁列與 rail 子列**兩處順序一致地改變**
- [x] 5.6 probe：以 `dragMouse` 自 rail 拖曳，斷言順序改變且分頁列同步
- [x] 5.7 probe：未位移的按下放開仍是點擊（切換 focus，順序不變）

## 6. 型別、測試與文件

- [x] 6.1 `npm run typecheck` 通過
- [x] 6.2 `npm test` 通過
- [x] 6.3 `npm run lint` 通過
- [x] 6.4 `npm run probe:terminal` 於 dev 與 build 兩模式皆通過
- [x] 6.5 更新 `CLAUDE.md`：session 的命名權（使用者取名後 pty 的改名需經確認）、拖曳以滑鼠事件實作而非 HTML5 DnD 的理由
