## Why

Phase 1 立起了 workspace rail 與三欄版面，但主舞台右側的 side panel 是一塊寫著「OpenSpec / Files（Phase 2+）」的佔位文字。使用者把 repo 加進 workspace 之後，**看不到裡面有什麼**。

這個工作台的前提是「agent 在左邊改檔，你在右邊看著它改了什麼」。左邊的 terminal 要到 Phase 4 才到位，但**右邊的 Files 身分不需要等它** —— 一個能展開、會隨磁碟變動更新、點下去看得到內容的檔案樹，本身就是 Phase 5 之前唯一能讓 app 有用的東西。它也是 Phase 3（編輯）與 Phase 5（OpenSpec 側欄的交叉導覽：spec ↔ 底層 `.md`）的地基。

**為什麼檔案監控不能延到 Phase 3**：這個 app 的整個賣點是旁邊坐著一個一直在改檔案的 agent。一棵不會更新的樹，在這個場景下不是「稍後再補的體驗優化」，而是**顯示錯誤資訊**。Phase 3 才引入 watcher，等於讓 Phase 2 出貨一個已知會說謊的檢視。

**為什麼唯讀檢視器現在就要做**：Phase 1 為了讓 spec 繼續描述真實，把 `workspace-app-shell` 的兩條 Monaco requirement 標為 `REMOVED` —— 診斷頁退場後沒有任何模組引用 `editor/`，Monaco 不再進入 bundle，「SHALL 載入」成了假話。那份 `design.md` D5 明文把債記在本 Phase：**Files 檢視是 Monaco 的第一個真實載體，requirement 要在這裡以真實使用情境重新確立**，包含 dev 與 build 兩種模式的 worker 驗證。再延一期，Monaco 的打包與 worker 保證就要無人看守到 Phase 3。

## What Changes

- **side panel 的身分切換**：repo header 右側加上 `[◈ OpenSpec │ ▤ Files]` segmented switch（mockup `#panel-switch`）。兩個身分同層互斥、共用面板 chrome。Files 恆可用；**OpenSpec 於 repo 不含 `openspec/` 時停用**（Phase 1 已偵測 `hasOpenSpec`），其內容仍為佔位，留給 Phase 5。
- **遞迴檔案樹（Files 身分）**：目錄預設收合，**展開時才 `listDir`**（lazy load），已載入的子樹保留。呈現 mockup 的視覺狀態：`▾`／`▸`／`·` 字符、深度縮排、目錄名稱加粗、hover。
- **樹上的資訊**：每列顯示相對修改時間（「2 小時前」），面板 header 顯示當前目錄的項目數（「18 個項目」）。
- **`listDir` 擴充回傳 `mtime`**：`stat` 本來就在做，成本為零。
- **新 IPC `fs.readFile`**：受同一道 `(folderId, relPath)` 邊界約束。附**大檔上限**與**二進位偵測** —— 兩者都是拒絕條件，不是「截斷後照樣顯示」。
- **新 IPC `fs.watch` / `fs.unwatch`**：主行程以 chokidar 監看，變更以 IPC push 至 renderer；樹即時更新，**已開啟的檔案若在磁碟上被改動則提示重載**（唯讀檢視無 dirty 狀態，不需要衝突解決，那是 Phase 3 的事）。polling 決策重用 `@spekjs/core` 已匯出的 `shouldUsePolling` / `pollingInterval` / `withAuthoritativeChokidarEnv`。
- **面板內的檔案唯讀檢視**：點檔案時，Files 身分從「樹」換頁成「檔案內容」，以既有的 `.os-crumb` breadcrumb（`project-a / files / scanner.ts`）返回樹。**markdown 渲染**（`react-markdown` + `remark-gfm`，與 spek web 同一組，Phase 5 抽 `@spekjs/ui` 時不必再換），**其餘檔案以 Monaco 唯讀呈現**。
- **重新確立 Monaco 的兩條 requirement**：以此檢視為載體 —— 「在 renderer 載入並提供語法高亮」「對 renderer bundle 的體積貢獻可量測」。驗證 worker 存活**不得**靠「看到語法高亮」（tokenization 在主執行緒完成，Phase 0 已記錄此陷阱），必須讓 worker 真的做一次往返。

**明確不做**（防止蔓延成 Phase 3–5）：

- **git 狀態標籤**（mockup 的 `M` / `A`）。它需要一個新的 IPC、spawn `git status --porcelain`、處理非 git repo 與 worktree、並在 watcher 觸發時失效重算 —— 那是一個獨立的 change，不該綁在檔案樹的第一版裡。`@spekjs/core` 的 `git-cache` 幫不上忙：它只算 change 的 commit 時間戳，沒有 file-level 狀態。
- **主舞台的檔案 tab**（PRD §11 原文的「全域 tab manager」）。見 Impact 的權威文件衝突。
- 寫檔、dirty 狀態、`Cmd/Ctrl+S`、存檔衝突（Phase 3）；OpenSpec 身分的**內容**與 `IpcAdapter`（Phase 5）；terminal（Phase 4）；mockup 上「focused session 正在做的 change」那條 accent highlight（需要 session 概念，Phase 4+）。
- 樹的展開狀態與捲動位置**不持久化**（PRD §12 有列，隨 pane 尺寸一起留給後續 change）。

無 **BREAKING**：本 repo 尚無使用者，亦無對外介面。

## Capabilities

### New Capabilities

- `file-explorer`: side panel 的 Files 身分中呈現的檔案樹 —— 目錄 lazy load、展開／收合、每列的種類與相對修改時間、當前目錄的項目數，以及**隨磁碟外部變更即時更新**（新增／刪除／改名）。它是 Phase 3 編輯與 Phase 5 交叉導覽的入口。
- `file-viewer`: 面板內的檔案唯讀檢視 —— markdown 以渲染後的樣貌呈現、其餘檔案以語法高亮的唯讀編輯器呈現；超過上限的大檔與二進位檔案明確拒絕而非勉強顯示；檔案於磁碟被外部改動時提示重載。與樹之間以 breadcrumb 換頁，**不佔用主舞台**。

### Modified Capabilities

- `filesystem-access`: 目前它的最後一條 requirement 明文寫著「**本能力只暴露 `listDir`**」，且 scenario 斷言「其上不存在 `readFile`」。本 change 引入 `readFile` 與 `watch`，這條 requirement 必須改寫 —— 不是刪掉約束，而是把「白名單只含已定義邊界要求的能力」這個**原則**保留下來，並為兩個新能力各自寫出邊界要求（大檔／二進位的拒絕條件、watcher 的監看範圍不得逃逸 folder、renderer 收到的路徑事件一律以 `(folderId, relPath)` 表達）。`listDir` 的回傳新增 `mtime`，亦屬 requirement 層級的變更。

- `workspace-layout`: 目前 side panel 只有「可收合」的要求，內容為單一佔位。本 change 加入 **OpenSpec ／ Files 兩個同層互斥身分**的要求：切換、一次只顯示一個、收合狀態下點任一身分皆重新展開（mockup `togglePanel(true)` 的行為）、以及 **OpenSpec 為條件式身分**（repo 無 `openspec/` 時停用並可被輔助技術辨識）。

- `workspace-app-shell`: 重新確立 Phase 1 標為 `REMOVED` 的兩條 Monaco requirement，載體由已退場的診斷頁換成 `file-viewer`。措辭必須跟著載體改變 —— 舊的說法是「診斷頁載入編輯器」，新的說法是「檢視非 markdown 檔案時載入編輯器並提供語法高亮」。「編輯器透過 wrapper 介面存取」那條不受影響，且正是它讓本 change 的接線侷限於 `src/renderer/src/editor/`。

## Impact

**權威文件之間有實質衝突，本 change 必須解決而非繞過。** PRD §11 的 Phase 2 寫「**全域 tab manager**：開檔成 tab；markdown 用 spek 渲染、其餘用 Monaco 唯讀」；PRD §6.2 與定案的 `docs/workspace-mockup.html` 卻把 Files 定為 side panel 的一個身分，並註明「Monaco 不是主編輯區的一級公民」，主舞台那排 tab 是 **session 分頁**。查證 mockup 全文：**它沒有畫任何開檔畫面**，`.file-row` 甚至刻意設為 `cursor: default`，樹是靜態的 —— 也就是說 mockup 對「開檔如何呈現」**沒有表態**，不能被任一方引為權威。CLAUDE.md 訂明衝突時以 mockup 為準，但 mockup 在此處沉默，因此這是一個必須新做的設計決定（已定：side panel 內以 breadcrumb 換頁，理由入 `design.md`）。**`docs/PRD.md` §11 的 Phase 2 條目需隨之回寫**，否則往後每個 Phase 都會從一份自相矛盾的路線圖長出來。

**新增依賴**：
- `chokidar` 5.0.0 —— 純 JS（唯一依賴 `readdirp`），**無原生模組**，不涉及 `@electron/rebuild`；`engines.node >= 20.19.0`，本 repo 為 22.22.0。它是 runtime 依賴（主行程執行期需要），與 Phase 1 至今「不新增 runtime 依賴」的紀錄不同，需在打包設定中確認會被納入。`@spekjs/core` **自己不依賴 chokidar**，只匯出 polling 決策的純函式，watcher 由消費者建立 —— 這正是 Phase 1 D4 立下的分工。
- `react-markdown` + `remark-gfm`（renderer）—— 與 `spek` repo 的 `packages/web` 同一組（`^10.1.0` / `^4.0.1`），使 Phase 5 抽出 `@spekjs/ui` 時不必替換渲染器。

**renderer bundle 體積會顯著回升**：Monaco 重新被引用。Phase 0 的量測是含 Monaco 20.88 MB、其中 `ts.worker` 佔 12.65 MB，不含 Monaco 的基準為 0.54 MB；Phase 1 之後實測為 620,743 B（JS）+ 12,672 B（CSS）。**唯讀檢視是否需要 `language/typescript` contribution，是本 change 必須回答的問題** —— 唯讀不需要 diagnostics，移除它可省下大半體積，但「worker 真的做了一次往返」的驗收就得換一個載體（例如 JSON 的 marker）。此取捨與量測入 `design.md`；`npm run measure:bundle` 是既有的量測工具。

**信任邊界的攻擊面擴大**：`readFile` 讀的是內容而非檔名，越界的後果從「看到不該看的檔名」升級為「讀到不該讀的內容」。Phase 1 `design.md` 記載 **TOCTOU 與 hard link 尚未防護**，並要求「Phase 3 引入 `writeFile` 時必須重新評估，不可沿用 Phase 1 的『只讀所以還好』」。本 change 仍屬唯讀，但**必須明確重新論證這個立場對 `readFile` 是否仍成立**，而不是默默沿用。`watch` 則帶來新的一面：watcher 的監看根目錄由主行程決定，renderer 不得指定 —— 否則等於把邊界交給呼叫端。

**新的 IPC 方向**：Phase 1 的 IPC 全是 renderer → main 的 `invoke`／回應。`watch` 首次引入 **main → renderer 的 push**（`webContents.send`）。這需要訂閱的生命週期管理：視窗關閉、folder 被移除、renderer 重新載入（dev 熱更新）時 watcher 必須被清理，否則行程留下無主的 fd 與 CPU 佔用。

**既有探針與測試需要擴充**：`probe:workspace` 目前驗證 `listDir` 的邊界與持久化；`readFile` 的邊界與大檔／二進位拒絕、watcher 的清理、身分切換與 disabled 態，都需要對應的驗收。Monaco 的兩條 requirement 回歸，意味著 **dev 與 build 兩種模式的 worker 驗證要有一支探針**（Phase 1 移除的 `scripts/probe-editor.mjs` 不能原樣復活 —— 它驗的是不會出貨的診斷頁；新的載體是真實的檔案檢視）。

**`src/renderer/src/editor/`**：Phase 1 已把它的探針鷹架清乾淨（`data-testid`、`dataset.*`、`probeTypeScriptWorker()` 等），只留 wrapper。本 change 是它自誕生以來第一個真實消費者，wrapper 的介面（唯讀模式、語言判定、主題）會在此定形。

**`openspec/config.yaml` 的 `context:` 區塊**寫著「Phase 1『多 folder 工作區骨架』實作中」與「monaco-editor（保留於 `src/renderer/src/editor`，Phase 2/3 才會被引用）」，兩句在本 change 之後皆為假。該區塊會被注入每一份 artifact 的產生指示，需與 `CLAUDE.md`、`README.md` 一併回寫。
