## Why

change 住在 linked worktree 時，側欄的**正向**導覽可用（change → 在 Files 中開啟該檔案），
**反向**卻不可用：在 Files 身分開著**同一個檔案**，卻沒有 **View in OpenSpec** 的入口。
**同一個檔案，去得了、回不來。**

而「每個 change 各自開一個 worktree」正是使用者自己的標準工作流（`common-openspec-change`
skill 產生 `<repo>/.claude/worktrees/<slug>` 佈局）—— 於是這條壞掉的路徑不是邊角，**它正是
使用者當下在做的那個 change 會走的路徑**。`openspec-worktree-aggregation` 讓側欄看得見那些
change 之後，兩個身分之間的往返只通了一半。

**這不是迴歸。** 正向導覽是 `openspec-worktree-aggregation` 新增的；反向從來沒有支援過
worktree 佈局，只是在聚合之前，worktree 裡的 change 根本不會出現在側欄上，所以看不出缺口。
由該 change 的 `/opsx:verify` 獨立稽核指出（列為 SUGGESTION，當時裁決留給後續 change）。

## What Changes

- **反向導覽的判準改變**：由「folder-relative 路徑的**第一段**是 `openspec`」改為「該路徑落在
  **某個工作目錄**的 `openspec/` 之下」。邊界內 worktree 的檔案其路徑為
  `.claude/worktrees/<slug>/openspec/changes/<slug>/proposal.md`，首段是 `.claude`，現行判準
  一律回 `null`，入口因此不呈現。

- **主行程供應工作目錄的 folder-relative 根**。renderer 目前**沒有詞彙**做上面那個判斷：工作
  目錄清單雖然主行程有（`AggregatedScanResult.worktrees`），但送往 renderer 的來源 DTO
  （`ChangeOrigin`）**刻意丟棄了絕對路徑** —— 那是 `openspec-worktree-aggregation` 的獨立稽核
  抓到的 CRITICAL，不可回頭。**具體形狀由 design 拍板**（在既有 DTO 上補一個 folder-relative
  的根，或把反推整個移進主行程），但無論走哪條路，供應端都是 OpenSpec 的資料層。

- **明確排除誤判**：判準 SHALL NOT 鬆綁為「路徑裡出現 `openspec` 就算」。一個位於
  `docs/openspec/changes/<slug>/` 之下的檔案不是 OpenSpec artifact，不得呈現 **View in OpenSpec**。
  這條要有自己的驗收，否則「修好」與「鬆綁」在測試上長得一樣 —— **而反面案例必須帶
  `changes/` 或 `specs/` 那一層**：`docs/openspec/notes.md` 對鬆綁實作**也**回 `null`
  （已實測），拿它當反面驗收等於沒驗。

- **spec 檢視標示其內容的來源工作目錄**。worktree 裡的 spec 檔案照樣提供入口（design D3），
  而側欄呈現的是主工作目錄那一份 —— 兩者在 archive 前的 backfill 之後會分歧，且那是**每個
  change 出貨前的標準動作**，不是邊角。少了標示，這個入口就是在製造一個安靜的謊。

- **範圍限於邊界內的 worktree**。邊界外的 worktree（例如 `/tmp/...`）本來就沒有 folder-relative
  路徑，Files 根本看不到那些檔案 —— `worktree-aggregation` 既有的「邊界外僅檔案導覽降級」不變。

- 補上 `nav.ts` 的單元測試（目前沒有）—— 判準從「一段字串比對」變成「查一份清單」之後，
  它值得有自己的一組表格式測試。

## Capabilities

### New Capabilities

無 —— 本 change 修的是既有能力的一個不對稱，不引入新概念。

### Modified Capabilities

- `openspec-panel`：「OpenSpec 與 Files 兩個身分之間可交叉導覽」的**反向那半**，其條件由
  「位於 `openspec/` 之下的檔案」放寬為「位於**某個工作目錄**的 `openspec/` 之下的檔案」，
  並新增一條「路徑僅含 `openspec` 字樣者不得被誤判」的要求。

- `worktree-aggregation`：「邊界內 worktree 的 change 可跨身分導覽」目前只寫了**正向**
  （change → 檔案）。補上反向，使該 requirement 描述的是一趟完整的往返。

- `openspec-data-access`：新增「掃描結果 SHALL 供應各工作目錄的 folder-relative 根」一類的
  要求（翻不出來時為 `null`，延續既有的「路徑欄位 SHALL 為 folder-relative，SHALL NOT 為
  絕對路徑」）。**若 design 裁決把反推移進主行程**，改動的則是該能力的 IPC 介面；兩種形狀
  都落在這個 capability 上。

## Impact

**程式碼**

- `src/renderer/src/shell/openspec/nav.ts` — `targetOfPath()` 的判準（本 change 的核心）
- `src/renderer/src/shell/files/FilesPanel.tsx:292` — 唯一的呼叫端
- `src/main/openspec-service.ts` — 工作目錄根清單的計算與 DTO。**folder 自身必須恆入清單**
  （不經 `toRelPath` —— 它對 folder 自身回 `null`），否則非 git 的 folder 與 repo 子目錄的
  folder 會連**現行**的反向導覽都失去
- `src/main/ipc/openspec.ts` + `src/preload/index.ts` — 新的 IPC 與白名單
- `src/renderer/src/shell/openspec/adapter.ts`（`OpenSpecApi` / `IpcAdapter`）與
  `src/renderer/src/shell/types.ts`
- `src/renderer/src/shell/openspec/data.tsx` — 取數 hook
- spec 檢視的來源標示與其文案（`src/shared/i18n/en.json`）

**驗收**

- `probe:openspec` — 新增反向導覽於 worktree 佈局下的斷言。**必須成對**：邊界內 worktree 的
  檔案**有**入口、`docs/openspec/*` 之類的檔案**沒有**入口 —— 少了後者，一個「路徑裡有
  openspec 就算」的鬆綁實作照樣全綠。
- `npm test` — 新增 `nav.ts` 的單元測試；主行程 DTO 若新增欄位，比照既有的「DTO 不得含絕對
  路徑」守衛。

**不受影響**

- 正向導覽（change → 檔案）、邊界外 worktree 的降級行為、非 worktree 佈局的既有路徑
  （`openspec/...` 首段判定仍須繼續成立）。
