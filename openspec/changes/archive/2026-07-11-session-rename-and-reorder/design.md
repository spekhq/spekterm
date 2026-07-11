## Context

`SessionState` 目前有 `title?`（pty 以 OSC 宣告的標題），標籤是 `title ?? ${spawnTarget} ${ordinal}`。session 的順序＝建立順序（`sessions` 陣列的順序）。

既有可重用的：`ContextMenu`（已處理「開啟事件自我關閉」與「夾進 viewport」）、`NameDialog`（`files/dialogs.tsx` 的重新命名輸入框）、探針的 `dragMouse`。

## Goals / Non-Goals

**Goals：** 使用者可命名 session；手動命名後 pty 的改名需經確認；分頁與 rail 可拖曳排序。

**Non-Goals：** 跨 repo 拖曳；順序／名稱的持久化（Phase 6）。

## Decisions

### D1. 三層標籤優先序：`customTitle > title(pty) > 本地流水號`

`SessionState` 增加 `customTitle?: string`。`sessionTitle()` 依序取用。

清空名稱（重新命名時輸入空字串）＝**放棄命名權**，回到跟隨 pty。

### D2. 命名權的轉移，用 `pendingTitle` 表達

`SessionState` 再增加 `pendingTitle?: string`：pty 想改成的名字，**尚未被使用者裁決**。

`setTitle(id, title)` 的邏輯因此分岔：

- **沒有 `customTitle`**（使用者沒接管）→ 照舊直接寫入 `title`，不打擾任何人。
- **有 `customTitle`**，且 `title !== customTitle` → **不覆蓋**，寫入 `pendingTitle`，UI 據此跳出確認。

裁決：

- `acceptPendingTitle(id)`：`customTitle` 清除、`title` 設為 `pendingTitle`、`pendingTitle` 清除 —— **命名權交還給 pty**，此後不再詢問（沒有 `customTitle` 就走上面第一條路）。
- `keepCustomTitle(id)`：`pendingTitle` 清除，`customTitle` 不動 —— 下次 pty 再送不同的標題，會再問一次（使用者要的就是「每次都確認」）。

**同時只有一個待確認的標題。** `pendingTitle` 是單一欄位而非佇列：pty 在對話框開著時又送新標題，只會覆蓋掉待確認的那個。這是刻意的 —— `claude` 改標題很頻繁，堆疊 N 個對話框會把畫面淹掉，而使用者真正關心的只有「它現在想叫什麼」。

### D3. 拖曳以滑鼠事件實作，不用 HTML5 drag-and-drop

HTML5 DnD 在 CDP 下要走 `Input.setInterceptDrags` + `dispatchDragEvent` 那一套，繁瑣且與探針既有的 `dragMouse`（真滑鼠序列）格格不入。改以 `mousedown → mousemove → mouseup` 自己實作：

- `mousedown`（左鍵）記下被拖的 session 與起點。
- `mousemove` 超過閾值（4px）才算開始拖 —— 否則單純的點擊會被誤判為拖曳。
- 移動中依滑鼠座標與各項目的 rect 算出**插入位置**，並以一條插入指示線呈現。
- `mouseup` 提交 `reorder(folderId, fromIndex, toIndex)`；沒有實際位移就當作一次普通點擊（切換 focus）。

listener 掛在 `window` 上（拖曳中滑鼠會離開元素本身），並於 `mouseup` 或元件卸載時解除。

### D4. 順序是 session 在 repo 內的次序，兩個視圖共用

`reorder` 直接重排 `sessions` 陣列中**同一 folder 的那一段**，其餘 folder 的相對順序不動。分頁列與 rail 都從 `forFolder()` 取資料，因此自動一致 —— **不做兩份順序**。

跨 folder 拖曳不支援：session 的 cwd 是 pty 啟動時就定了的，把它「移到別的 repo」在語意上不成立（那是開一個新 session）。

### D5. 重新命名**不能**重用 `NameDialog`（實作時發現）

原本打算重用 `files` 的 `NameDialog`。**不行** —— 它套的是**檔案名稱**的驗證（`validateName`：禁止 `/`、`..`、Windows 保留字、尾端空白…）。session 的名字是**自由文字**，使用者大可把它叫做「fix: bug #3」或「重構 auth/」，套上檔名規則會把完全合法的名字擋掉。

因此另寫 `SessionNameDialog`：純文字輸入、不做檔名驗證，空字串＝放棄命名權。

標題衝突則需要並陳兩個名字並提供兩個裁決 —— `ConfirmDelete` 的形狀不合，另寫 `TitleConflictDialog`。兩者都渲染在主舞台之內（與其他對話框同層），**不是原生 dialog**。

### D6. 右鍵選單成為分頁與 rail 子列的共同入口

分頁目前只有 `✕`（關閉），rail 子列亦然。重新命名沒有合適的常駐位置（再塞一顆鈕會更擠），因此兩處都加**右鍵選單**：`重新命名` / `關閉`。

**驗收必須送真右鍵**（`Input.dispatchMouseEvent` `button: 'right'`）—— CLAUDE.md 已記載：合成 contextmenu 測會全綠，但真右鍵開不起來（開啟選單的事件冒泡到 window 被自己的 dismiss listener 關掉）。

## Risks / Trade-offs

- **[「每次都跳確認」可能很吵]** → 這是使用者明確選的。緩解：同時只有一個對話框（D2），且「採用 pty 的名稱」會一次性交還命名權、不再詢問。若實際用起來仍嫌吵，再議「記住選擇」。
- **[自己實作拖曳要處理的邊角多]**（拖到清單外、拖曳中 session 結束、單擊 vs 拖曳的判別）→ 以 4px 閾值區分點擊與拖曳；拖曳中的 session 若結束，`reorder` 以 id 查 index，找不到就放棄這次拖曳。
- **[順序不持久化]** → 與 session 本身一致（重啟本來就不還原 session），屬 Phase 6。

## Open Questions

- 重新命名是否該支援鍵盤快捷鍵（如 F2）？本 change 不做，先看右鍵選單夠不夠用。
