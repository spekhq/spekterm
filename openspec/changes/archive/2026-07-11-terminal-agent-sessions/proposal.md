## Why

CLAUDE.md 開宗明義：這個工作台要把多個「一個 repo／資料夾各自一個 `claude` session」的 terminal 包在一個殼裡。PRD §6.2 更把它講死 ——「**terminal（跑真 `claude` 的 pty）是主舞台中央**」、「跑 agent 的主場」。到 Phase 3 為止，主舞台左半邊還是一塊寫著「terminal（Phase 4）」的 placeholder（`MainStage.tsx`）。**這個 app 的主舞台是空的** —— 使用者能看 spec、能改檔，卻還不能在殼裡駕駛任何 agent。核心賣點目前不存在。

Phase 0 的 `native-module-toolchain` 已經證明 node-pty 能在 Electron 主行程 spawn 出真實 pty（Node-API，免 `electron-rebuild`）。那是一次拋棄式的技術驗證：spawn 一個 pty、讀一行、殺掉。本 change 把那個能力變成產品 —— 真正能跑、能多開、能隨版面 reflow、生命週期正確（不留孤兒行程）的 terminal，並讓「repo 為一級單位、session 為其下子項」（§6）的組織主軸首次成真：頂部 session 分頁 + rail 的 repo→session 子列。

## What Changes

### 主行程：多 session 的 pty 管理與雙向串流

- **pty 管理器**（新 `src/main/terminal.ts`）：每個 session 對應一個 node-pty 行程，以**建立它的 `webContents` 為擁有者**登記。IPC 雙向串流：`create`（回傳 sessionId）、`data`（pty → renderer，主行程主動推送）、`write`（renderer → pty）、`resize`（rows/cols）、`kill`。pty 的 `exit` 事件推送給 renderer。
- **preload 白名單新增 `workspace.terminal.*`**，比照既有 `fs`／`folders`／`app`／`shell` 的具名白名單模式（`workspace-app-shell` 的「能力僅經由 preload 白名單暴露」通則涵蓋之，本 change 不放寬該通則）。

### 新 session 的兩個變數：cwd 與 spawn 目標

- **cwd = 當前選中的 folder**，以 `(folderId)` 定址、在主行程解析為邊界內的絕對路徑（重用 `fs-boundary`）。renderer **不傳絕對路徑** —— 沿用 `filesystem-access` 既有的定址原則。
- **spawn 目標由使用者於建立時選擇**：`claude`（agent 主場，對齊 PRD §6.2）或 **login shell（`$SHELL`）**。`+ session` 因此不是單一動作，而是一個帶選擇的入口。

### renderer：xterm 終端與多 session 版面

- **終端元件**：`@xterm/xterm` + `@xterm/addon-fit`（+ `@xterm/addon-web-links`），封裝於單一 wrapper 模組（比照編輯器的 wrapper 約束）。取代 `MainStage` 左側的 placeholder。terminal **保持純淨** —— 結尾就是行程自己的 prompt 行，spek **不另外畫輸入框**（PRD §6.2、mockup line 594–596）。
- **頂部 session 分頁列**：呈現**當前 repo** 的所有 session，標示 focused、可切換、`+ session`、可關閉單一分頁（mockup `.session-tabs`）。
- **rail 的 repo→session 子列**：每個 folder 列之下呈現其 session 子列，可見、可切換 focused、可展開／收合（mockup `.ws-sessions`）。
- **切換 session 保留各自的終端內容**：pty 在背景持續運作，切回來看得到期間的輸出 —— session 未顯示不等於其輸出遺失。

### resize 與生命週期

- **fit 與 pty 尺寸同步**：xterm 隨容器尺寸 reflow，且把 rows/cols 同步回 pty，否則 agent 的輸出會以錯誤寬度換行。
- **生命週期，且不留孤兒**：關閉單一分頁清理其 pty；**視窗關閉／`webContents` 銷毀時，清理該擁有者的所有 pty**（沿用 watcher 以擁有者生命週期釋放的模式）。pty 自行結束（`exit`）時，該 session 在 UI 標示為已結束，而非靜默消失。

### 兩處必須誠實寫明的邊界

- **PRD 與 mockup 的版面出入**：PRD §11 Phase 4 寫 terminal 是「**底部 dock** 多 tab」，但定案 mockup 畫的是「**左半邊主舞台 terminal + 頂部 session 分頁**」（右邊仍是 side panel）。CLAUDE.md 明訂「UI 版面與行為以雛型為權威，PRD §6 的文字若與雛型有出入，以雛型為準」——**依 mockup**，且現有 `MainStage` 已是此左／右版面。
- **terminal 給的是真 shell，其信任模型不同於 fs 白名單**：cwd 邊界只約束「app 決定的**初始** cwd 落在 workspace 內」。pty 一旦啟動，使用者在其中可 `cd` 到任何地方、執行任何命令 —— 這正是 terminal 的用途。這道邊界**不是** fs 白名單那種「renderer 只能碰 workspace」的沙箱，它防的是「app 自己不會把 session 開在 workspace 之外」，不是限制使用者在自己終端機裡的行為。此區別在 `design.md` 詳述，避免日後誤把它當成沙箱。

### 明確不做（本 change 界線）

- **session 狀態燈的真實 agent 語意**（mockup 的 `running`／`waiting`／`done`／`err`）：`waiting`＝「等你回應」需解析 agent 輸出，超出本 phase。本 change 的狀態燈只反映 **pty 存活／已結束**。
- **session 分頁與 rail 子列上的 change badge 真實錨定**：需 Phase 5 的 OpenSpec 整合才知道 session 在做哪個 change。本 change 分頁標籤只用得到 branch／spawn 目標之類的本地資訊。
- **handoff tag**（`待 ack`／`↩ 接棒`）：Phase 7。
- **terminal scrollback／session 版面的持久化**：app 重啟後不還原開了哪些 session、也不還原終端內容。layout／tab 的持久化屬 Phase 6（§12「持久化開啟的 tab／layout」）。
- **在既有 folder 邊界之外新增任何 fs 能力**：本 change 不碰 `fs.*` 白名單。

無 **BREAKING**：本 repo 尚無使用者，亦無對外介面。

## Capabilities

### New Capabilities

- `terminal-sessions`：在主舞台跑真 pty 的多 session 終端能力。核心要求不是「能顯示字元」，而是**一個 session 就是一個受擁有者生命週期約束、初始 cwd 落在 workspace folder 內、雙向串流且會被確實清理（不留孤兒行程）的 pty**；並涵蓋 spawn 目標的選擇（claude／login shell）、resize 時 pty 尺寸的同步、pty 結束在 UI 的呈現，以及 spawn 失敗的處置。

### Modified Capabilities

- `workspace-layout`：主舞台與 rail 首次呈現「session」這個層級。新增兩條 requirement —— 主舞台在 repo header 與 split-view 之間呈現**當前 repo 的 session 分頁列**（切換 focused、`+ session`、關閉入口）；rail 的每個 folder 列之下呈現其 **repo→session 子列**（可見、可切換、可展開收合）。既有的三欄版面、分界拖動、side panel 收合、rail 的 folder 身分等 requirement 不變。

## Impact

- **新依賴**：`@xterm/xterm`、`@xterm/addon-fit`、`@xterm/addon-web-links`（node-pty 已在 Phase 0 安裝並釘死）。
- **主行程**：新增 `src/main/terminal.ts`（pty 管理器）與 `src/main/ipc/terminal.ts`；`src/main/index.ts` 註冊 handler 並在 `webContents` 銷毀時清理該擁有者的 pty。
- **preload**：`src/preload/index.ts` 新增 `workspace.terminal.*`；更新 `src/preload/index.d.ts`。
- **renderer**：新增 `src/renderer/src/shell/terminal/`（xterm wrapper 與終端元件）；`MainStage.tsx` 換掉 placeholder；新增 session 分頁列與 session 狀態管理（session 清單／focused／擁有關係）；`WorkspaceRail.tsx` 加 session 子列（`FolderRow` 的巢狀結構已預留）；`types.ts` 由白名單回推 terminal DTO。
- **驗收**：新增 `scripts/probe-terminal.mjs` 與 `npm run probe:terminal`；以 login shell 模式自動驗 pty 往返（`pwd` 驗 cwd、`echo` 驗回顯）、多 session、resize、關閉分頁與視窗關閉的行程清理。單元測試涵蓋 pty 管理器的擁有者記帳與清理、cwd 的邊界解析。
- **specs**：`terminal-sessions`（新增）、`workspace-layout`（delta：ADDED 兩條 requirement）。
- **文件**：`CLAUDE.md`（Phase 4 現況、terminal 相關的踩雷點）、`openspec/config.yaml` 的 Status。
