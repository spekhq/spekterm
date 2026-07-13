## Why

第二次 dogfooding 抓到的：使用者把一個 `claude` session 改名之後，**`claude` 每隔一小段重新宣告一次
OSC 標題，每次都跳一個「pty 想改名，要採用嗎？」的確認對話框** —— 使用者被無限打斷。

根因不是實作 bug，是 `session-rename-and-reorder` 當初的一個**錯誤假設**：它假定「使用者命名後，pty
想改名是**罕見**事件，值得問一次」。實際上 `claude` 隨任務進展**持續**改標題，這是常態事件。

現行的「保留我的名稱」（`keepCustomTitle()`）只把待裁決的標題清掉，**不記錄「使用者已經拒絕過」** ——
於是下一次 pty 宣告標題時，判定條件與第一次完全相同，對話框再跳一次。**連 pty 送出同一個標題都會再問**
（「與待裁決的相同就不問」那條短路，在使用者按下「保留我的」的瞬間就失效了，因為待裁決欄位已被清空）。

當初的 spec 其實**已經察覺 agent 會頻繁改名**（「同一時間至多只有一個待確認的標題…否則頻繁改名的
agent 會把使用者的畫面淹沒」），但緩解只做到「不堆疊多個對話框」，沒有解決「反覆問同一個問題」。

而這個問題本身幾乎必然只有一個答案：使用者**才剛親手命名**，緊接著問他「pty 想改回去，要嗎？」——
答案當然是不要。問了等於白問，卻要付出打斷的代價。

## What Changes

- **使用者命名 SHALL 視為永久接管命名權。** 此後 pty 宣告的 OSC 標題**一律不覆蓋標籤**，且
  **SHALL NOT 呈現任何確認** —— 靜默丟棄。
- **BREAKING（對使用者可見的行為）**：移除「pty 想改名」的確認對話框（`TitleConflictDialog`），
  連同「採用 pty 的名稱／保留我的名稱」這組裁決入口。
- **交還命名權的路徑不變、且是唯一的**：把名字**清空**（改名時留空），標籤即回到跟隨 pty 宣告的標題。
  這條路本來就存在於 spec，只是先前被對話框搶去了風頭。
- pty 宣告的標題在使用者接管期間**仍持續被記錄**（只是不呈現）—— 於是「清空名字」的那一刻，標籤能
  **立即**回到 pty 當下最新的標題，不必空等它下一次宣告。
- 三層標籤優先序**不變**：使用者指定的名稱 > pty 宣告的終端標題（僅 `claude` 目標）> 本地標籤。
  本 change 只拿掉那個多餘的仲裁環節 —— 優先序本來就已經完整表達了使用者的意圖。

## Capabilities

### New Capabilities

（無。本 change 只收攏既有能力的行為。）

### Modified Capabilities

- `terminal-sessions`：**移除**整條 `Requirement: 手動命名後，pty 的改名須經使用者確認`；並**修改**
  `Requirement: 使用者可替 session 命名，且優先於 pty 宣告的標題`，明定「使用者命名後，pty 宣告的
  標題一律靜默丟棄、不得呈現確認」，以及「pty 的標題於接管期間仍被記錄，清空名稱時立即生效」。
- `keyboard-navigation`：**修改** `Requirement: 對話框與選單開啟期間，導航快捷鍵不生效` —— 其列舉的
  三種對話框中，「pty 標題衝突的確認」已不復存在，須自清單移除。**該 requirement 的實質行為不變**
  （判定仍以 `[role="dialog"]` 的存在為準），改的是它舉的例子。

## Impact

**產品程式碼**

- `src/renderer/src/shell/terminal/sessions.tsx` — `SessionState` 移除 `pendingTitle`；`setTitle()`
  在 `customTitle` 存在時改為「記錄 `title` 但不觸發任何裁決」；移除 `acceptPendingTitle()` 與
  `keepCustomTitle()`；`SessionsApi` 收窄。
- `src/renderer/src/shell/terminal/TitleConflictDialog.tsx` — **整個檔案刪除**。
- 其掛載點（`SessionTabs` 一帶）與 `session-badge.tsx` 的相關註解一併清理。

**驗收**

- `scripts/probe-terminal.mjs` — 移除「標題衝突對話框」的整組斷言，改為驗收**新的**行為（命名後 pty
  反覆宣告標題，SHALL 不出現任何 `[role="dialog"]`，標籤恆為使用者的名稱）。既有的 stub `claude`
  機制（PATH 前置 + `HOME` 隔離）正是驅動它的現成載體。
- `scripts/probe-keyboard.mjs` — 它以**三種**對話框各驗一次「快捷鍵被抑制」（CLAUDE.md：「只驗一種
  就宣稱涵蓋，等於沒驗」）。標題衝突對話框消失後只剩兩種（session 命名、files 的）。**這是實質的
  覆蓋率損失，必須在 design 裡裁決**：是接受兩種、還是補一種其他對話框。

**文件**

- `CLAUDE.md` — 「session 的命名權可以被使用者接管」那段記著舊的三層裁決規則，須改寫。
- `docs/PRD.md` — 若有提及該確認流程，一併同步。

**不受影響**

- pty → OSC 標題的接線（`TerminalView` 的 `onTitle`）、login shell 一律丟棄標題的規則、標籤的三層
  優先序、命名對話框本身（`SessionNameDialog`）、拖曳排序。
