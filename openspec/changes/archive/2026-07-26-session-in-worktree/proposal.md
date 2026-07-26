## Why

`openspec-worktree-aggregation` 與 `worktree-reverse-navigation` 讓側欄**看得見也走得到** worktree
裡的 change，但**駕駛不了**它：session 一律 spawn 在 folder 的根目錄。要在 worktree 裡跑 agent，
只能開 shell 手動 `cd` 再打 `claude` —— 於是失去 claude 目標的一切整合（`--resume` 續接、狀態橋接
注入、休眠喚醒、身分持久化）。

而「每個 change 各自開一個 worktree」是使用者的標準工作流。直接的後果是續寫入口的**第 4 個條件**
（`artifact-continuation`）：change 的來源工作目錄不是 session 所屬 folder 時，入口停用。那條停用
是誠實的，但它描述的正是這個缺口 —— 本 change 完成後該條件需要一個更精確的判準（**不是取消**，
見 design D3）。

PRD §6 早已預告這個能力（「+ session 開新 pty（預設 cwd = 當前 repo／**worktree**）」）。

## What Changes

- **session 可開在 folder 所屬 repo 的任一 linked worktree**（含邊界外的，例如 `/tmp/...`），
  兩種 spawn 目標皆然。

- **renderer 以 `worktreeKey` 指定，不傳路徑**。這是本 change 對現行規格最要緊的一處改動：
  `terminal-sessions` 目前明文要求「renderer SHALL **僅以 `folderId`** 指定 session 的位置，
  SHALL NOT 傳遞任何絕對或相對路徑」，且有一條 scenario 寫著介面「**僅接受 `folderId` 與 spawn
  目標**」。新增的 key 是 core 算的**不可逆識別碼**（路徑的 sha1 前 8 碼），主行程**查表**解析為
  路徑 —— 與 `openspec-data-access` 既有的 slug／topic 白名單同構。**規格的精神不變**（renderer
  仍然沒有詞彙表達 workspace 之外的位置），但字面要改。

- **初始 cwd 的夾制放寬**：由「落在該 folder 邊界內」改為「該 folder 根目錄，或其所屬 repo 的
  某個工作目錄的根」。合法性的來源是 **git 的列舉**，不是字串驗證。

- **session 記住它開在哪個工作目錄**（`session-persistence` 加 `worktreeKey?`，比照
  `anchoredChange` / `panelFolderId` 的成熟先例）。重建時該 worktree 已消失則退回 folder 根目錄。

- **claude session 重生時回到它原本的工作目錄**。目前 `refreshCwd` 明文
  `if (session.spawnTarget !== 'shell') continue`，於是 claude session 重生永遠在 folder 根目錄。
  **手段不是放寬 `refreshCwd`**（design D4）：claude 的 pty cwd 不會漂移，它恆等於 spawn 時的
  位置，而那個位置就是 `worktreeKey` —— 以 key 重新解析比讀 `/proc` 更準，因為它記錄的是使用者
  的**意圖**而非某個時刻的觀測值。shell 則相反（使用者真的會 `cd`），繼續讀 `/proc`，但夾制放寬。

- **續寫入口的第 4 個條件改判準，不取消**（`artifact-continuation`）。issue #4 寫的是「可以取消」，
  **實作前的調查推翻了它**（design D3）：那個條件現在比對的是「來源 vs session 所屬的 **folder**」，
  而本 change 之後 session 的工作目錄不再恆等於 folder 根 —— 取消它會讓「change 在 worktree A、
  session 開在 folder 根或 worktree B」被誤判為可用，而後果正是這個條件當初要防的那件事
  （agent 在錯的地方建出一個同名的空 change）。判準改為比對 **focused session 的實際工作目錄**。

- **順帶修好一個現存缺陷**：手動 `cd` 到邊界外的 worktree、關 app 再開，session 會回到 folder
  根目錄 —— cwd 被那道 `isWithin` 夾制靜默丟掉了。這在本 change 之前就存在。

## 一個前提已經實測，結論與 issue 的擔憂相反

issue #4 列了一條「**做之前先驗這件事**」：重建時 cwd 與當初不同，`--resume` 可能找不到對話而
靜默自癒成全新對話。**已驗完（見 issue #4 的留言），擔憂不成立** —— `claude --resume` 的查找是
**git repo 關聯**的：

| 對話開在 | 從哪 `--resume` | 結果 |
|---|---|---|
| 主工作目錄 | 邊界內／邊界外 worktree | ✅ 記得 |
| worktree | 主工作目錄 | ✅ 記得 |
| 主工作目錄 | 無關目錄（非 git repo） | ❌ `No conversation found` |

三個影響：記住 worktree 的動機從「否則對話靜默丟失」降級為「**否則 agent 站錯工作目錄**」（後者
仍完全成立）；「worktree 消失 → 退回 folder 根」這條退路**安全**，錯誤處理可以簡單很多；邊界外
worktree 在 `--resume` 上沒有障礙 —— 阻礙純粹是我們自己那道夾制。

## Capabilities

### New Capabilities

無。這是既有能力的擴展，不引入新概念。

### Modified Capabilities

- `terminal-sessions`：定址參數新增 `worktreeKey`（不可逆識別碼，主行程查表）；初始 cwd 的邊界
  由「folder 邊界內」放寬為「folder 根目錄或其所屬 repo 的某個工作目錄根」。**兩條 requirement
  與至少兩條 scenario 要改**。

- `session-persistence`：持久化的事實清單納入「session 開在哪個工作目錄」；重建時該工作目錄已
  消失則退回 folder 根目錄；新增「claude 目標於其建立時的工作目錄重生」（**含續接失敗後自癒
  產生的 pty** —— 那是主線情境）。**並修改「持久化不得把路徑詞彙交給 renderer」** —— 它明文
  宣告自己是 `terminal-sessions` 邊界論證的延續，本 change 改了那條論證，這條不一起改，主 spec
  就會同時存在兩條互相矛盾的 SHALL（獨立稽核抓到的）。

- `artifact-continuation`：第 4 個停用條件**改判準**（以 session 的實際工作目錄比對，見 design D3）；
  並**新增**一條 requirement —— 因該條件停用時，提供「於該工作目錄開啟 session」的入口（design D1）。

`openspec-panel` **不動**：design D1 裁定入口就長在續寫入口停用的那句話上，那是
`artifact-continuation` 的地盤。

## 一個 design 必須拍板的問題：入口放哪裡

**使用者要怎麼指定「在哪個 worktree 開 session」？** 這不是實作細節，它決定本 change 的範圍：

- **完整的答案是 issue #5**（rail 把 worktree 列為一級組織單位）—— 但 #5 明文「刻意排在最後，
  形狀應由本 change 的 dogfood 決定」。兩者互為前提，所以本 change 必須自己給一個**最小**入口。
- 一個候選是**從側欄的 change 觸發**（「在這個 change 的工作目錄開 session」）—— 它直接命中使用者
  的真實情境（看到 worktree 裡的 change、想驅動它），也正好是續寫入口第 4 個條件的解藥。
- 另一個候選是 **spawn 選單加一層**（選目標之後選工作目錄）。

**design D1 已裁決：從側欄的 change 觸發。** spawn 選單加一層會逼使用者記得 worktree 的名字，
而側欄那個 change 的上下文本來就完整。入口的呈現條件**不限於「因條件 4 而停用」** —— 停用原因
有優先序，`noSession` 先於條件 4，而「剛開 app、還沒有任何 session」正是最常見的情境（稽核指出
的）。**本 change 不做 rail 的 worktree 呈現** —— 那是 #5。

## Impact

**程式碼**

- `src/main/terminal.ts` — `create()` 的定址參數、`#initialCwd` 的夾制、**`cwdOf()` 的第二道
  夾制**（記錄側；不放寬它的話，邊界外的 cwd 從一開始就不會被寫進 `sessions.json`，而放寬後的
  `#initialCwd` 收到的是 `undefined` —— 看起來一切正常，失效方向是靜默的）、**`#heal()` 的 cwd**
  （自癒目前恆在 folder 根重生，而 `Session` 沒有存 cwd）
- `src/main/ipc/terminal.ts` — 重建時的 cwd 供應、工作目錄識別碼的解析接縫
- `src/main/session-store.ts` — `PersistedSession` 新增 `worktreeKey?`
- `src/preload/index.ts` — `terminal.create` 的簽名（`probe:shell` 的白名單守衛會擋）
- `src/renderer/src/shell/terminal/sessions.tsx` — 建立 session 的呼叫端
- 入口的 UI（位置待 design 裁決）與其文案（`src/shared/i18n/en.json`）
- `src/renderer/src/shell/openspec/continuation.ts` — 第 4 個條件**改判準**（不是移除），
  並新增「於該工作目錄開啟 session」的入口

**驗收**

- `probe:terminal` — 在 worktree 開 session（兩種目標）、pty 的 cwd 確實在那裡、重建後仍在那裡、
  worktree 消失時退回 folder 根。**cwd 的斷言要走讀檔**（`echo CWD=$(pwd) > f`），不要讀畫面
  （既有紀律：回顯與執行分不清）。
- `probe:openspec` — **成對**：session 開在該 change 的工作目錄時入口**可用**；開在**另一個**
  工作目錄時**仍然停用**。**既有那兩條「停用並說明原因」的斷言維持為停用，不必改寫** —— 判準變了
  但那個情境（session 跑在 folder 根、change 在 worktree）的可觀察行為不變。少了「仍然停用」那一半，
  一個把條件 4 直接取消的實作會通過另一半。
- `probe:shell` — `terminal.*` 的白名單守衛。
- `npm test` — worktreeKey 的查表（不存在的 key 必須被拒，比照既有的 slug traversal 測試）。

**不受影響**

- pty 內執行的命令仍不受任何邊界限制（`terminal-sessions` 的既有立場：cwd 的邊界只約束**初始**
  工作目錄，它不是沙箱）。
