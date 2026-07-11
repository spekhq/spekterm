## Why

CLAUDE.md 開宗明義說這個工作台要讓使用者「**不必另外開 IDE** 就能一邊駕駛 agent、一邊看著 spec 上下文」。Phase 2 出貨的 side panel 能看、不能改 —— agent 寫完 `tasks.md`，使用者要打個勾，得離開這個 app。那句話目前是假的。

**而這筆債是被明文指定的，不是順手發現的。** `filesystem-access` 的最後一條 requirement 是一道閘門：「任何新的檔案系統能力 SHALL NOT 出現於 renderer 可觸及的介面上，直到後續 change 明確引入並為其定義邊界要求」，其 scenario 甚至逐字斷言介面上「不存在 `writeFile`、刪除」。`preload/index.ts` 的註解把同一件事說得更直白 ——「`writeFile` 之所以不在，不是因為忘了加，而是因為還沒有人為它定義寫入時的邊界」。Phase 2 `design.md` D10 則把寫入的 TOCTOU 論證整個推給本 Phase，並**禁止沿用它自己的結論**。

這個 change 來還那筆債：renderer 首次取得改變磁碟狀態的能力。這是信任模型的質變，不是多幾個 IPC handler。

## What Changes

### 檔案系統：renderer 首次能寫

- **新 IPC**：`writeFile`（覆寫既有檔案）、`createFile`、`createDirectory`、`deleteEntry`、`rename`。全部受既有的 `(folderId, relPath)` 定址與 folder 邊界約束。
- **寫入路徑的邊界必須重新論證，不得沿用讀取的那一套。** Phase 2 的 `resolveWithinRoot` 是「先 `realpath` 檢查、再以該真實路徑開啟」。**已實測**：把這個寫法直接拿來寫入，在 check 與 use 之間把目標換成指向邊界外的 symlink，寫入即逸出邊界（`open` 成功，邊界外的檔案被覆寫）。D10 對 `readFile` 的免責理由是「renderer 沒有建立檔案或 symlink 的能力，無法自己製造這個 race」—— 本 change 引入 `createFile`，該理由當場失效。
- **`deleteEntry` 與 `rename` 各自需要獨立的邊界要求**，不是 `writeFile` 的推論：刪除的後果不可逆；改名的來源與目標**兩端**都要在邊界內，且不得覆蓋既有目標。

### 編輯與存檔

- **檔案檢視從唯讀轉為可編輯**。編輯器移除 `readOnly` / `domReadOnly`；語言服務 worker 的禁令**不變**（我們只要語法高亮，使用者無法在此修正語意診斷）。
- **markdown 加上 `[預覽 │ 原始碼]` 切換**。預覽維持 `react-markdown` 的既有安全預設（不得加 `rehype-raw`、不得覆寫 `urlTransform`）；原始碼模式走可編輯的編輯器。OpenSpec 的一切都是 `.md` —— 不能編輯 markdown，這個 change 對本 app 的主要情境等於沒做。
- **dirty 狀態與 dirty buffer**。未存的變更**跨換頁、跨切換 folder 保留**：使用者返回檔案樹、去看另一個檔案、切到別的 repo，再回來時內容還在。換頁不提示、不捨棄。
- **代價是檔案樹必須標記哪些檔案 dirty** —— side panel 沒有 tab 列，若不標記，使用者無從得知自己還有未存的東西。
- **`Cmd/Ctrl+S` 存檔**。
- **關閉視窗 / 結束 app 時，若有任何 dirty buffer，明確提示**，不得靜默丟棄。

### 衝突與自我事件

- **存檔與外部變更的衝突處理**：檔案在磁碟上被 agent 改動、而使用者手上有未存的編輯時，存檔不得無聲覆蓋對方。Phase 2 的「提示重載」在唯讀前提下成立（沒有東西可失去），現在不成立了。
- **watcher 的自我事件必須被抑制**。我們寫檔，chokidar 就會推一則 `change` 給 renderer，而 `FileViewer` 目前收到 `change` 就顯示「檔案已在磁碟上變更」。不處理的話，**每一次存檔都會提示使用者磁碟被外部改動了** —— 一個由自己造成的假警報。

**明確不做**：git 狀態標籤（仍是獨立 change）；terminal（Phase 4）；OpenSpec 身分的內容與 `IpcAdapter`（Phase 5）；dirty buffer 的**持久化**（app 重啟後不還原，未存變更只存活於 app 的生命週期內 —— 持久化牽涉磁碟上的暫存區與其自身的邊界問題）；多檔案同時開啟的 tab 列（版面屬於 terminal，PRD §6.2）。

無 **BREAKING**：本 repo 尚無使用者，亦無對外介面。

## Capabilities

### New Capabilities

- `file-editing`: 面板內編輯檔案內容的能力與其**未存變更的保護**。核心要求不是「能打字」，而是**未存的變更絕不靜默消失** —— dirty 狀態可見於編輯處與檔案樹、buffer 跨換頁與跨 folder 存活、`Cmd/Ctrl+S` 存檔、關閉 app 前明確提示，以及存檔時若磁碟已被他人改動則不得無聲覆蓋。
- `file-operations`: 檔案樹上的新建檔案／新建目錄／刪除／重新命名。核心要求是**破壞性操作必須明確確認、名稱必須在建立之前驗證、且來源與目標兩端都不得逃逸出 workspace folder**。刪除與改名不可逆，它們與「編輯內容」是不同種類的風險，因此不與 `file-editing` 合為一條規格。

### Modified Capabilities

- `filesystem-access`: 最後一條 requirement 的 scenario 逐字斷言介面上「不存在 `writeFile`、刪除或其他未經本規格定義邊界要求的能力」—— 本 change 引入五個寫入能力，該 scenario 必須改寫。**改寫的是清單，不是原則**：白名單的形式（任何能力進入介面之前都必須先有邊界要求）保留，並為五個新能力各自寫出邊界要求。另需新增一條**寫入專屬**的路徑解析要求：讀取沿用的「先檢查、再依原路徑開啟」在寫入時已被實測證明會逸出邊界，寫入的解析與開啟必須是不可分割的一步。

- `file-viewer`: 「**檔案內容為唯讀**」這條 requirement 與本 change 直接衝突，必須改寫為可編輯。「markdown 以渲染後的樣貌呈現」需加入預覽／原始碼切換（渲染的安全要求原封不動）。「其餘文字檔以具語法高亮的**唯讀**編輯器呈現」的措辭隨之改變。「檢視中的檔案於磁碟被改動時提示重載」在有 dirty buffer 之後不足以描述正確行為 —— 重載會丟棄使用者的編輯。

- `file-explorer`: 樹上新增 **dirty 標記**（哪些檔案有未存的變更），以及 `file-operations` 的**操作入口**。既有的 lazy load、監看範圍、symlink 節點語意皆不受影響。

- `workspace-app-shell`: 「**唯讀檢視**不引入任何語言服務 worker」的約束完全保留，但其名稱與理由（「使用者無法於此處修正編輯器回報的任何診斷」）建立在唯讀之上，載體已變。措辭必須跟著載體改 —— 我們仍然不要語言服務，理由改為「本 app 的深度改檔走 agent 或使用者自己的 IDE，編輯器在此只承擔語法高亮」。另新增一條 requirement：**視窗關閉前 SHALL 確認未存的變更**。

## Impact

**權威文件必須回寫，否則往後每個 Phase 都會從一份過時的路線圖長出來。**

- `docs/PRD.md` §11 Phase 3 只寫 `fs.writeFile`。本 change 依產品決策擴大為完整 CRUD（新建／覆寫／刪除／改名），PRD 需隨之更新。
- `docs/PRD.md` §5 的 F3 寫「dirty 狀態與 `Cmd/Ctrl+S` 存檔屬 Phase 3」，與本 change 一致，但未涵蓋 CRUD 與 dirty buffer 的跨 folder 存活。
- `CLAUDE.md` 現況段仍寫「Phase 2 實作中」（實際已封存），且「檔案系統邊界」段的「TOCTOU 與 hard link 尚未防護……Phase 3 引入 `writeFile` 時此論證不再成立」需依本 change 的實際結論改寫。
- `src/preload/index.ts` 的白名單註解逐字寫著「`writeFile` 之所以不在……」，隨白名單一併更新。

**受影響的程式碼**：`src/main/fs-boundary.ts`（新增寫入專用的解析與開啟）、`src/main/fs-service.ts`、`src/main/ipc/fs.ts`、`src/main/watch-service.ts`（自我事件抑制）、`src/main/index.ts`（視窗關閉攔截）、`src/preload/index.ts`、`src/renderer/src/editor/`（唯讀 → 可編輯）、`src/renderer/src/shell/files/*`（dirty 標記、操作入口、預覽切換、衝突 UI）。**新增一層 workspace 層級的 dirty buffer 狀態** —— 目前 `FilesPanel` 以 `folder.id` 為 key 掛載，切 folder 即重新掛載、狀態歸零，buffer 無法待在其中。

**尚未解決的技術問題（留給 `design.md`）**：

- **Node 的 `fs` 沒有 `openat()`**，無法以 dirfd 逐段相對開啟。`O_NOFOLLOW` 只約束路徑的最後一段，中間的目錄段（`docs/notes.txt` 的 `docs/`）它管不到。
- **`O_NOFOLLOW` 是 POSIX 的**，Windows 上 Node 不提供，而 PRD §3.3 要出三平台。
- **原子寫入（temp + `rename`）有代價**：它會取代 symlink 而非寫穿、改變 inode、可能丟失既有的權限與 ownership、破壞 hard link。這些取捨要明文選定，不能默默繼承某個常見寫法。
- **威脅模型要重新界定**：Phase 2 D10 主張這道邊界防的是「被入侵或有 bug 的 renderer」，不是已取得本機寫入權的攻擊者（因為 terminal 裡本來就跑著有完整 shell 權限的 `claude`）。這個前提在寫入下是否仍然成立，必須重新論證而非引用。

**新增驗收**：`scripts/probe-files.mjs` 擴充或新增探針，覆蓋編輯 → dirty → 存檔 → 外部變更衝突，以及 CRUD 的四個操作。單元測試補上寫入的邊界案例（含上述實測的 TOCTOU race）。
