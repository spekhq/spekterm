## Why

**使用者的 change 開在 git worktree 裡時，側欄看到的 active change 是 0。**

主行程用的是 `@spekjs/core` 的**非聚合** `scanOpenSpec`，它只掃 folder 根目錄的 `openspec/`。而
「每個 change 各自開一個 worktree」是一種真實且常見的工作流（使用者自己的 `common-openspec-change`
skill 就是這樣做的）。在那種佈局下，**正在開發的那個 change 根本不在主 repo 的 `openspec/changes/`
底下** —— 於是「本 change」視圖、tasks 進度、spec deltas、續寫入口，對使用者的主線工作全部失能。
CLAUDE.md 已記著實測：在有 3 個 worktree 的 core-lib 上，`scanOpenSpec` 回 `active=0`。

側欄懂 OpenSpec，正是這個 app 相對於「開四個終端機分頁」的增量價值所在。它看不見使用者當下在做的
那個 change，那個價值命題就是空的。

**而這件事在 `@spekjs/core` 裡早就做好了**（upstream #17 / #23，spek 的 web 與 VSCode extension
都已在用）—— worktree 列舉、去重、關係圖的節點命名全都在 core。spekterm 這邊要做的是換用它，
並把「來源」呈現到畫面上。

## What Changes

- **資料層改用 core 的聚合掃描** —— `scanOpenSpec` → `scanOpenSpecAggregated`、`buildGraphData` →
  `buildGraphDataAggregated`（**注意後者是 async，非聚合版是同步的**）。worktree 的列舉、active change
  的 git 分歧選舉去重、archived 的去重、graph 節點的 key 命名，**一律由 core 負責，本 change 不自己
  實作任何一項**。
- **change 的來源（worktree）成為資料的一部分，並呈現在側欄上** —— 來源以本地 DTO 呈現
  （識別碼、分支、是否為主工作目錄），**不透傳 core 的絕對路徑**。主工作目錄的 change 不標示來源。
- **快取失效的監看範圍擴大** —— 從「folder 的 `openspec/`」擴為「**每個** worktree 的 `openspec/`」，
  外加**worktree 清單本身**。後者是承重的：worktree 是「先建目錄、後寫 change」，不監看清單的話，
  新 worktree 的第一次寫入沒有任何 watcher 在場。
- **worktree 位於 folder 邊界外是主線情境之一，不是邊角** —— worktree 可以在任何地方（實例：`/tmp`）。
  此時 change 照樣列出、tasks 照樣算、spec deltas 照樣看，只有「跳到檔案」與「在 Files 中開啟」這兩個
  入口沒有（relPath 翻不出來時回 `null`，即既有的 design D5）。
- **jj（Jujutsu）workspace 本 change 不納入** —— `includeJj: false`，與 spek 的 web 與 extension
  的**預設**一致。core 的 jj 路徑（內容指紋去重、`isCurrent` / `conflictsWith`）整條不會被走到。
  **這是延後，不是否決** —— 見下方「最終方向」。
- **不含**：session 開在 worktree（terminal 的 cwd 夾制不動）、rail 把 worktree 列為一級項目。
  兩者各自有未決的前提，見「Impact」。

### 最終方向

**終點是對齊 spek 現有的能力集** —— 聚合範圍的使用者控制（spek web 的 `off` / `worktrees` /
`worktrees-jj` 三態）、來源徽章、以及 jj workspace。本 change 只走第一步：**把資料層接上，
讓側欄先看得見 worktree 裡的 change**。

這對本 change 有一個具體的約束：**不做開關，但也不得做出讓開關加不進來的設計**。聚合與否是
`scanOpenSpecAggregated` 的一個參數（`aggregate`），core 在 `aggregate: false` 或 worktree ≤ 1
時會退回等同非聚合的行為 —— 因此「日後把它接上一個使用者控制」是加一層設定的事，不是改資料流。

## Capabilities

### New Capabilities

- `worktree-aggregation`: 側欄的 OpenSpec 資料涵蓋 folder 所屬 repo 的全部 git worktree ——
  涵蓋範圍與去重的責任歸屬（在 core，不在本 app）、change 的來源如何被呈現與定址（識別碼而非路徑）、
  以及 worktree 位於 folder 邊界外時的降級行為。

### Modified Capabilities

- `openspec-data-access`: 兩條 requirement 的範圍改變 ——
  「主行程為每個 workspace folder 供應 OpenSpec 結構」的掃描涵蓋範圍由「folder 根目錄的 `openspec/`」
  擴為「該 folder 所屬 repo 的全部 git worktree」；
  「掃描結果快取，並於 openspec 目錄變更時失效」的監看範圍隨之擴大，並須調和既有的
  「監看 SHALL NOT 跟隨 symlink 走出 folder 邊界」—— 那條約束的對象是 **symlink 的展開**，
  與「監看一個由 git 列舉出來、已知的 worktree 路徑」是兩件事，spec 必須把這個區別寫明。
- `openspec-panel`: 新增 change 的來源呈現（來源徽章），並確認「側欄資料隨檔案變更更新」在
  worktree 的 `openspec/` 被改動時同樣成立。
- `artifact-continuation`: 續寫入口在 change 的來源**非主工作目錄**時不呈現 —— 該入口把
  `/opsx:continue <slug>` 送進 focused session 的 pty，而 session 的 cwd 是 folder 根目錄，
  對只存在於 worktree 的 change 會找不到目標（或在主 repo 建出一個同名的空 change）。
  這是 session 尚不能開在 worktree 的直接後果，L2 落地後可取消（design D7）。

## Impact

**程式碼**

- `src/main/openspec-service.ts` — 掃描函式、快取型別（`ScanResult` → `AggregatedScanResult`）、
  watcher 的建立與釋放、change 讀取時的來源解析、DTO 的來源欄位翻譯。
- `src/main/openspec.ts` — 開發模式的掃描摘要。
- `src/main/ipc/openspec.ts`、`src/preload/index.ts` — DTO 型別。
- `src/renderer/src/shell/openspec/` — 來源徽章的呈現。

**依賴**

- `@spekjs/core` **不升版**（已是 `^1.2.0`，聚合 API 自 1.0.0 起就在）。
- `@spekjs/ui` **不升版、不改套件**，但**需要一次宿主端適配** —— 該套件內部對聚合節點 id 的處理
  並不一致：`SpecGraph` 會自己剝掉 worktree key，`buildLanes`（Timeline 的 group-by-topic）**不會**，
  於是聚合後 Timeline 的分組會靜默退化成「全部落在無 topic」。適配在我們這側完成，並回報 upstream
  （design D10）。

**承擔的義務**

- `ChangeInfo` 由「原封不動轉手 core 的陣列」改為**重建 DTO**（來源的絕對路徑必須翻譯）。這正式
  接下「core 加欄位時要同步 DTO」的義務 —— CLAUDE.md 已預先標價過這個 trade。

**成本（已實測，非估計）**

在 core-lib（2 個 worktree、197 個 archived change）上量測單次掃描：

| | cold | warm |
|---|---|---|
| `scanOpenSpec` | 278ms | 84ms |
| `scanOpenSpecAggregated` | 257ms | ~175ms |

warm 之後約 **+90ms**。`getTimestamps` 的快取是永久的，因此每次重掃真正重付的是**分歧判定**的
`git status` / `git diff`（無快取，約 `3N+1` 個 spawn，N 為非主工作目錄數）。150ms debounce 之下，
agent 連續寫檔時會反覆付這筆。

`workspace-folders` 那條「偵測 SHALL NOT 呼叫任何外部程式」管的是 **rail 的 folder 偵測**，
不受本 change 影響。

**不在本 change 內，但被它照亮的兩件事**

- **session 開在 worktree** — 目前 `#initialCwd` 以 `isWithin(folderPath, cwd)` 夾制，邊界外的
  worktree 過不了；連帶使「手動 `cd` 到邊界外的 worktree、關 app 再開，cwd 被靜默丟掉」成為
  **現存**的缺陷。要做需放寬 `terminal-sessions` 的 spec，且有一個未驗證的前提（`claude --resume`
  的 transcript 落點以 cwd 編碼）。
- **rail 把 worktree 列為一級項目** — 需要在「為 worktree 列舉破例 no-spawn 規格」與「自己寫一套
  檔案式列舉」之間裁決。其形狀應由本 change 落地後的 dogfood 決定。
