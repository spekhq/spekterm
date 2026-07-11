## Context

xterm 的選取不是 DOM selection —— 它自己維護選取範圍並繪製，因此瀏覽器原生的複製路徑對它無效。xterm 提供 `getSelection()` / `hasSelection()` / `paste(text)`，以及 `attachCustomKeyEventHandler()` 讓我們攔截按鍵。

既有可重用的東西：`ContextMenu`（已處理「開啟事件自我關閉」與「夾進 viewport」兩個坑）、`shell.openExternal` 那條「renderer 的能力一律經 preload 白名單」的通則。

## Goals / Non-Goals

**Goals：** 終端可用滑鼠與鍵盤複製貼上；`Ctrl+C` 維持 SIGINT。

**Non-Goals：** 非文字格式；選取即自動複製；剪貼簿歷史。

## Decisions

### D1. clipboard 走主行程的 Electron `clipboard` module，不用 `navigator.clipboard`

`navigator.clipboard.readText()` 在 Electron 中受 Chromium 的權限模型管轄（`clipboard-read`），沒有 permission handler 時的行為並不保證，且跨平台不一致。主行程的 `clipboard` module 沒有這個問題，且與既有的 IPC 白名單模式一致。

- `readText` 用 `invoke`（要回值）。
- `writeText` 用 `send`（單向，不必等回應）。

### D2. 這道能力的邊界：剪貼簿沒有 workspace 邊界，靠的是另外兩道防線

`readText()` 能讀到系統剪貼簿的當下內容 —— 可能是使用者剛複製的密碼。**它不像 `fs.*` 有 folder 邊界可以約束**。可接受的理由必須寫明，否則日後會被誤當成「跟 fs 一樣安全」：

1. **renderer 不會變成別人的頁面**：`workspace-app-shell` 的導航防護（`will-navigate` / `setWindowOpenHandler` 一律阻擋）是這道能力的**前提**。少了它，使用者 repo 裡一個 markdown 連結就能把遠端頁面帶進這個 renderer，而那個頁面會拿到 `workspace.clipboard.readText`。
2. **只在使用者明確要求貼上時讀取**：右鍵選單、快捷鍵、中鍵 —— 不主動讀、不背景輪詢、不在啟動時讀。

### D3. `Ctrl+C` 維持 SIGINT；複製走 `Ctrl+Shift+C`

終端裡 `Ctrl+C` 是中斷訊號。有些編輯器（VS Code）會在「有選取時」把 `Ctrl+C` 改成複製 —— **本 change 不這麼做**：agent 跑失控時要中斷它，這個能力不能因為畫面上剛好有一段選取就失靈。這正是終端模擬器普遍採用 `Ctrl+Shift+C` 的理由。

macOS 慣例不同（`Cmd+C` 不與 SIGINT 衝突），因此 macOS 用 `Cmd+C` / `Cmd+V`。

實作以 `attachCustomKeyEventHandler` 攔截：回傳 `false` 表示「xterm 不要處理這個按鍵」（我們自己處理了），回傳 `true` 則照常送給 pty。

### D4. 右鍵選單重用 `ContextMenu`，且必須以**真右鍵事件**驗收

`複製` 在無選取時 `disabled`；`貼上` 恆可用。

**驗收必須送真的 `Input.dispatchMouseEvent({ button: 'right' })`** —— CLAUDE.md 已記載過這個教訓：用合成 `contextmenu` 事件測會「全綠」，但真右鍵完全開不起來（開啟選單的那次事件冒泡到 window，被選單自己的 dismiss listener 當場關掉）。`ContextMenu` 已經延一個 tick 才掛 listener，但這條保證只有真事件測得出來。

### D5. 中鍵貼上（Linux 慣例）

X11 的中鍵貼的是 PRIMARY selection，而瀏覽器拿不到 PRIMARY。折衷：**中鍵貼上系統剪貼簿的內容**（與 `Ctrl+Shift+V` 相同來源）。這對使用者而言仍是「中鍵可以貼」，只是來源是 CLIPBOARD 而非 PRIMARY。

以 `mousedown` 的 `button === 1` 判定，並 `preventDefault()`（否則 Chromium 會進入自動捲動模式）。

### D6. 貼上的內容原封不動送給 pty

不做任何過濾或轉換 —— 貼上的是使用者自己剪貼簿裡的東西，pty 內的程式（shell、agent）自己會決定怎麼處理。xterm 的 `paste()` 已處理 bracketed paste mode（程式若啟用了它，xterm 會自動加上包裹序列，讓 shell 知道這是貼上而非鍵入）。

## Risks / Trade-offs

- **[renderer 能讀剪貼簿]** → D2 的兩道防線。導航防護是**前提**，任何削弱它的變更都會連帶削弱這道能力的安全性。
- **[中鍵貼的是 CLIPBOARD 而非 PRIMARY]** → 瀏覽器層拿不到 PRIMARY，無解；行為上仍符合「中鍵可貼」的肌肉記憶。
- **[`Ctrl+Shift+C` 比 `Ctrl+C` 多一個鍵]** → 這是刻意的取捨（D3），中斷程式的能力優先。

## Open Questions

- 是否要支援「選取即複製」（X11 慣例）？本 change 不做 —— 它會在使用者只是想標記一段文字時，靜默覆蓋掉剪貼簿裡原有的內容。若之後想要，應做成可關閉的設定。
