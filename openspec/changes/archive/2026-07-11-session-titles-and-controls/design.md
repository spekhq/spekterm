## Context

`terminal-agent-sessions`（Phase 4）已出貨並封存：pty 多 session、雙向串流、生命週期不留孤兒，探針 46/46。本 change 只處理**實際使用後浮現的四個操作摩擦**，不碰任何機制層。

現況：
- session 標籤是 `sessionLabel()` 產生的本地流水號（`claude 1`／`shell 2`），分頁列與 rail 子列共用（`session-badge.tsx`）。
- spawn 選單在 `SessionTabs.tsx` 內，重用既有的 `ContextMenu`（它已處理「開啟事件自我關閉」與「夾進 viewport」兩個坑）。
- `WorkspaceRail.tsx` 的 session 子列只能點選聚焦與收合。

## Goals / Non-Goals

**Goals：**
- session 的標籤由 pty 內的程式決定（OSC 終端標題），未設定時退回本地標籤。
- rail 可建立與關閉 session；主舞台的建立入口緊鄰分頁。

**Non-Goals：**
- 不動主行程、IPC 白名單、cwd 邊界、生命週期。
- 不做狀態燈的 agent 語意、change badge、handoff tag、持久化。

## Decisions

### D1. 標題來源用 xterm 的 `onTitleChange`，不用 node-pty 的 `pty.process`

node-pty 的 `IPty.process` 提供「前景程式的標題」，但那是**輪詢式的近似值**（要主行程定期去看、還得經 IPC 推給 renderer）。

OSC 終端標題則是程式**主動宣告的身分**：`claude` 送 `ESC ] 0 ; <title> BEL`，xterm 早就解析了它並暴露 `onTitleChange: IEvent<string>`。接一個既有事件即可 —— **零主行程改動、零 IPC、零輪詢**。這也正是使用者觀察到「gnome terminal 分頁會自動改名」的同一個機制。

### D2. `title` 只活在 renderer 的 session 狀態

標題是 xterm 在 renderer 解析出來的，主行程完全不需要知道它。`SessionState` 多一個 `title?: string`，由 `TerminalView` 訂閱 `onTitle` 後呼叫 `sessions.setTitle(id, title)` 寫入。**不經過 IPC**。

### D3. 標籤 = `title ?? 本地標籤`，並截斷

`session-badge.tsx` 的 `sessionLabel()` 改為：有 `title` 就用它，否則退回 `${spawnTarget} ${ordinal}`。

- 截斷到 28 字元（超過以 `…` 結尾）——分頁列與 rail 都是窄的橫向空間。
- **完整標題仍必須拿得到**：兩處的 `title` 屬性（tooltip）帶完整字串。截斷是呈現，不是資料遺失。
- 標題可能是空字串（程式送了空的 OSC）——視為未設定，退回本地標籤。

### D4. spawn 選單抽成共用 hook，分頁列與 rail 各自持有自己的選單狀態

兩處都要「點一個按鈕 → 開選單 → 選 claude／login shell」。把選單的 items 與開啟邏輯抽成 `useSpawnMenu()`（回傳 `open(event)` 與要渲染的 `menu` 節點），底層仍是既有的 `ContextMenu`。

**不共用同一份選單狀態**：rail 與分頁列可能同時存在，各自開各自的。共用一個 state 會讓「在 rail 開了選單、按鈕卻是分頁列的」這種錯位變得可能。

### D5. `+ session` 緊鄰最後一個分頁

現況：`tablist` 佔 `flex-1`，把按鈕推到最右端。改為 `tablist` 不再 `flex-1`（僅在分頁過多時 `overflow-x-auto`），按鈕緊接其後，**剩餘空間交給其後的 spacer 吸收**。分頁很多而溢出時，按鈕仍留在可視區域（不隨捲動消失）。

### D6. rail 的建立入口：folder 列上的 `+`，hover 才顯示

比照既有的移除鈕（`✕`，`opacity-0 group-hover:opacity-100`）：rail 每列已經有兩顆常駐鈕（`◈`、`✕`），再塞一顆常駐的會更擠。`+` 於 hover 時出現，`stopPropagation` 以免順手改變選中的 repo。

**建立後聚焦到新 session，但不強制切換選中的 repo**——不對：建立 session 必然要看到它，因此**也選中該 folder**（與點 session 子列的行為一致）。

### D7. rail 的關閉入口：session 子列上的 `✕`，hover 才顯示

比照 folder 列的移除鈕。關閉的語意與分頁的 `✕` 完全相同（呼叫 `sessions.close`），只是入口多一個。

## Risks / Trade-offs

- **[OSC 標題可能很長或含控制字元]** → 截斷至 28 字元；xterm 已把 OSC 的 payload 解析為純字串（控制字元不會混進來）。仍以 React 文字節點渲染（不用 `dangerouslySetInnerHTML`），因此標題**是不受信任的內容也無妨**——它來自使用者 repo 裡跑的程式。
- **[標題可能頻繁變動]**（agent 每換一個任務就改一次）→ 這正是要的行為（gnome terminal 也是如此）。React 的 state 更新成本可忽略。
- **[rail 每列的按鈕變多]** → `+` 與 `✕` 都只在 hover 顯示，靜態時 rail 仍乾淨。

## Open Questions

- 標題截斷長度（28）憑感覺定，實際用起來若嫌短再調。
- 是否要讓使用者**手動重新命名** session（覆寫 OSC 標題）？本 change 不做 —— 先看 pty 給的標題夠不夠用。
