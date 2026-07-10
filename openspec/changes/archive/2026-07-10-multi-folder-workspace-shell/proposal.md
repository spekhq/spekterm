## Why

Phase 0 證明了三個高風險相依可行，但打開 app 只看得到一張診斷頁。工作台的組織主軸 —— PRD §6.1 的「repo 為一級單位」—— 還不存在，使用者沒有任何方式把一個 repo 交給這個 app。

Phase 2 之後的每一件事都掛在「某個已加入的 folder」這個概念上：檔案樹要有根、tab 要知道自己屬於哪個 repo、terminal 的 cwd 要是某個 repo、OpenSpec 側欄要掃某個 repo。沒有它，後面的 Phase 沒有東西可以掛。

**為什麼是現在，而不能再往後推**：folder 清單一旦存在，它同時就是**信任邊界**。PRD §12 明訂「fs 寫入與 terminal cwd 限制在已加入的 workspace folders」。這個邊界必須在**第一個 fs IPC 出現的同一刻**建立 —— 本 change 正是引入第一個 fs IPC（`listDir`）的地方。若先讓 IPC 上線、之後再補約束，那段期間 renderer 能讀取整個檔案系統，而補約束時所有既有呼叫點都要回頭審一遍。

## What Changes

- **workspace folder 清單**：以原生對話框加入 folder、可移除；清單持久化於 Electron `userData` 的 JSON，重開 app 還原。
- **openspec 偵測**：每個 folder 判定是否含 `openspec/`。沒有的 repo 在 rail 上標示（mockup 的 `spek-web`），提示它之後只能用 Files 身分，OpenSpec 身分為 disabled。
- **版面骨架**：活動列 + workspace rail + 主舞台三欄（PRD §6.1、mockup 為 UI 權威）。分界可拖動，side panel 可收合。活動列在本 change 只有 `Sessions` 可用，`Handoffs` / 搜尋 / 設定為 disabled 佔位。
- **rail 只有 repo 一層**：mockup 的 rail 是 `repos → sessions` 兩層，但 session 屬 Phase 4。本 change 只做 repo 列，結構上為 session 子層預留，不實作。
- **第一個 fs IPC**：主行程 `listDir`，經 preload 具名白名單暴露。**路徑受限於已註冊的 workspace folders**，且拒絕以 `..` 逃逸出邊界。
- **Phase 0 診斷頁退場**：`App.tsx` 由真實版面取代。這連帶影響 `workspace-app-shell` 的既有 requirement（見下），並非單純的實作替換。

**明確不做**（防止蔓延成 Phase 2–4）：遞迴檔案樹與 lazy load、`readFile` / `writeFile`、全域 tab manager、chokidar 監控、Monaco 開檔、terminal／pty UI、OpenSpec 或 Files side panel 的**內容**（只做容器與收合）、handoff。版面尺寸（pane 寬度）不持久化 —— PRD §12 有列，但留給後續 change，本 change 只持久化 folder 清單。

無 **BREAKING**：本 repo 尚無使用者，亦無對外介面。

## Capabilities

### New Capabilities

- `workspace-folders`: workspace 的 folder 清單 —— 以原生對話框加入、移除、持久化於 `userData` 並於重啟還原，去重與失效路徑處理，以及每個 folder 是否含 `openspec/` 的偵測結果。這是整個工作台的狀態根，也是信任邊界的定義來源。
- `workspace-layout`: 活動列、workspace rail、主舞台三欄的版面骨架。分界可拖動、side panel 可收合、rail 呈現每個 folder 的身分（含「無 `openspec/`」標示）。UI 行為以 `docs/workspace-mockup.html` 為權威。
- `filesystem-access`: 主行程對 renderer 暴露的檔案系統能力，本 change 只含 `listDir`。核心要求不是「能列目錄」，而是**能力受 workspace folders 邊界約束**：邊界外的路徑、以 `..` 逃逸的路徑、symlink 指向邊界外的路徑一律拒絕。後續 Phase 的 `readFile` / `writeFile` 都長在這條 requirement 上。

### Modified Capabilities

- `workspace-app-shell`: 其「Monaco 編輯器在 renderer 載入並提供語法高亮」與「Monaco 對 renderer bundle 的體積貢獻可量測」兩條 requirement，驗收載體都是 Phase 0 的診斷頁 —— 該頁是 renderer 中**唯一** import `editor/` wrapper 的地方。本 change 移除該頁後，Monaco 不再被任何模組引用，連帶不會被打包進 renderer bundle，兩條 requirement 的 scenario 都將無法成立（後者甚至變成「基準與含 Monaco 相同」的空話）。

  這不是實作細節，是 spec 級變更，必須在本 change 一併處理。兩個方向留給 `design.md` 拍板：**(a)** 將兩條 requirement 標為 `REMOVED`，理由是它們本質上是 Phase 0 的 spike requirement，其結論已記錄於封存的 `design.md` D3；待 Phase 2／3 的 Files 檢視真正掛載 Monaco 時，以真實使用情境重新確立。代價是 dev／build 兩模式的 worker 保證在 Phase 1–2 期間無人看守，可能悄悄壞掉。**(b)** 保留 requirement，但把驗收載體從產品 UI 換成獨立的探針 harness —— 該保證本就是 renderer **建置管線**的性質，而非版面的性質。代價是要在不把測試分支塞進產品程式碼的前提下做到（本 repo 既有慣例，見 `CLAUDE.md`）。

  「編輯器透過 wrapper 介面存取」那條 requirement 不受影響：Monaco 仍只被 `src/renderer/src/editor/` 引用，且該模組保留供 Phase 2／3 使用。

## Impact

**新增依賴**：一個 split pane 套件（`design.md` D7 選定 `react-resizable-panels`），以及一個能執行 TypeScript 測試檔的 runner（D9 選定 `tsx`）。兩者皆為 devDependency —— renderer 由 electron-vite 打包，`react` 與 `monaco-editor` 在本 repo 亦置於 devDependencies。**不新增 runtime 依賴**：folder 持久化用 Node 內建 `fs` 與 Electron `app.getPath('userData')`，原生對話框用 `dialog.showOpenDialog`。

**`@spekjs/core` 不在本 change 動它。** PRD §9.3 規劃把 `listDir` / `readFile` / `writeFile` / `stat` 抽成 core 的公開模組供 workspace 重用，但**這些函式目前不存在於 core**（`safeReadDir` / `readFileOrNull` 是 `scanner.ts` 的私有 helper），且 core 位於另一個 repo（`spek`，MIT 公開授權）。要動它就得改那個 repo 並發一版 npm —— 與 Phase 0 被 `@spek` scope 卡住的是同一種跨 repo 前置，而本 change 的 `allowedEditRoots` 只有 `spek-workspace`。

本 change 因此主張主行程直接用 `node:fs` 實作 `listDir`，待 Phase 2／3 累積到三、四個實際消費者、API 形狀穩定後，再評估是否值得推回 core。理由是不該讓一個私有 app 的單一需求去驅動公開套件的 API 設計。此取捨於 `design.md` 正式拍板；若結論相反，需先在 `spek` repo 開獨立 change（依 Phase 0 `design.md` D5 的先例）。

**既有探針需要更新**：`scripts/probe-shell.mjs` 的斷言綁在 Phase 0 診斷頁上（`p-10` → `padding=40px`、`data-testid="trust-model"` 的文字、`data-preload-api`）。版面替換後，信任模型的**可驗證性不得退化** —— 那些 `data-*` 探測點必須在新版面中有對應歸屬，或探針改以新版面的結構斷言。`scripts/probe-editor.mjs` 的去留取決於上述 `workspace-app-shell` 的決策。

**新的持久化檔案**：`userData` 下的 workspace 設定 JSON。它是本 repo 第一個跨 session 的磁碟狀態，需要一個版本欄位供日後遷移，並在檔案損毀或 schema 不符時可退回空 workspace 而非讓 app 開不起來。

**信任模型的邊界從「宣告」變成「有東西要守」**：Phase 0 的 `contextIsolation` / preload 白名單只守著一個 `ping`。本 change 起，preload 暴露的是真正能碰檔案系統的能力，PRD §12 的約束首次有實質內容。

**文件回寫**：`openspec/config.yaml` 的 `context:` 區塊仍寫著「Tech stack（規劃中，尚未安裝）」與「Status: 規劃／設計階段，尚無產品程式碼」，Phase 0 之後兩句皆為假。該區塊會被注入每一份 artifact 的產生指示，放著不管會讓後續每個 change 從錯誤的專案描述長出來。本 change 一併更新它，以及 `CLAUDE.md` 與 `README.md` 的現況段落。
