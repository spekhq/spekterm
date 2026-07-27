## MODIFIED Requirements

### Requirement: session 跨應用程式重啟與 renderer 重新載入存活

重建一個 session 所需的**事實** SHALL 被持久化，並於下次開啟應用程式時重建：所屬 folder、
spawn 目標、使用者取的名字、分頁順序、錨定的 change、**側欄來源**（見 `side-panel-source`）、
**側欄的工作目錄**（見 `side-panel-worktree`）、**它開在哪個工作目錄**，以及 **pty 最近一次宣告
的終端標題**。renderer 重新載入時 SHALL 同樣重建。

持久化的內容 SHALL 限於重建所必需的事實，SHALL NOT 包含**可由當下環境廉價重算**的衍生狀態
（例如 folder 是否含 `openspec/`、git 分支 —— 那些每次載入都重算，存下來只是持久化謊言）。

pty 宣告的標題屬於「必需」而非「衍生」：**休眠的 session 沒有 pty 可以再宣告一次**，不存它，重開後
那些分頁就全部退回流水號標籤，而它們正是被 agent 依任務命名的那些 —— 使用者認不出哪個是哪個。
它一經喚醒即被 pty 的下一次宣告覆蓋。

**session 開在哪個工作目錄**同樣屬於「必需」：它記錄的是使用者建立該 session 時的**選擇**，不是
某個時刻的觀測值。以工作目錄識別碼保存，重建時查表解析 —— 該工作目錄若已不存在（worktree 於應用
程式未開啟時被移除），該 session SHALL 於其 folder 的根目錄重建，SHALL NOT 使重建失敗。

**側欄的工作目錄**是與上者**各自獨立的第二個工作目錄事實** —— 前者決定 pty 開在哪，後者決定側欄
的 Files 身分讀哪一份原始碼，兩者 SHALL 可不相同（在主工作目錄駕駛 agent、同時閱讀某個 worktree
的內容是合法且有用的）。它同樣以工作目錄識別碼保存（見下一段的邊界要求）；重建時該工作目錄若已
不存在，該 session 的側欄工作目錄 SHALL 退回 folder 自身，SHALL NOT 使重建失敗。

**側欄來源**指向的 folder 於重建時可能已不在 workspace（使用者重開前移除了它）—— 此時該 session
的側欄來源 SHALL 退回其所屬 folder，SHALL NOT 使 session 重建失敗。持久化的座標不保證重開後仍然
有效，這與「folder 路徑失效 → 喚醒錯誤」是同一種防禦姿態。

重建 SHALL NOT 使既有的 pty 生命週期鬆動 —— 重建產生的是**新的** pty；`terminal-sessions` 的
「關閉分頁／重新載入／關閉視窗三路徑皆不留孤兒行程」不受影響。

#### Scenario: 關閉並重新開啟應用程式後 session 回來

- **WHEN** 使用者建立若干 session、為其中之一命名、調整順序，然後關閉並重新開啟應用程式
- **THEN** 這些 session 以相同的名字與順序重新出現於其所屬的 folder

#### Scenario: 錨定的 change 一併回來

- **WHEN** 一個錨定了某個 change 的 session，經歷應用程式關閉並重新開啟
- **THEN** 該 session 重建後仍錨定同一個 change

#### Scenario: 側欄來源一併回來

- **WHEN** 一個側欄來源指向另一個 repo 的 session，經歷應用程式關閉並重新開啟
- **THEN** 該 session 重建後其側欄仍指向同一個 repo

#### Scenario: 側欄的工作目錄一併回來

- **WHEN** 一個 Files 身分選定了某個 worktree 的 session，經歷應用程式關閉並重新開啟
- **THEN** 該 session 重建後其 Files 身分仍以該 worktree 為樹根

#### Scenario: 側欄的工作目錄與 session 開啟的工作目錄各自保存

- **WHEN** 一個開在 folder 根、而側欄選定了某個 worktree 的 session，經歷應用程式關閉並重新開啟
  後被喚醒
- **THEN** 新的 pty 的工作目錄為 folder 根，而其 Files 身分以該 worktree 為樹根

#### Scenario: 側欄來源指向的 folder 已被移除

- **WHEN** 一個側欄來源指向 repoB 的 session，於重開前 repoB 已從 workspace 移除
- **THEN** 該 session 重建成功，其側欄來源退回自己所屬的 folder

#### Scenario: 側欄的工作目錄已消失

- **WHEN** 一個 Files 身分選定了某個 worktree 的 session，該 worktree 於應用程式未開啟期間被移除
- **THEN** 該 session 重建成功，其 Files 身分以 folder 自身為樹根

#### Scenario: renderer 重新載入後 session 回來

- **WHEN** renderer 重新載入
- **THEN** 先前的 session 以相同的名字與順序重建，且先前的 pty 皆已終止

#### Scenario: 開在工作目錄的 session 重建後仍在那裡

- **WHEN** 使用者於某個 linked worktree 建立一個 session，關閉並重新開啟應用程式，喚醒該 session
- **THEN** 新的 pty 的工作目錄為該 worktree 的根

#### Scenario: 工作目錄已消失時退回 folder 根目錄

- **WHEN** 一個 session 所開的 worktree 於應用程式未開啟期間被移除，其後該 session 被喚醒
- **THEN** 該 session 於其 folder 的根目錄重建，且不呈現為失敗

### Requirement: 持久化不得把路徑詞彙交給 renderer

renderer 送往持久化的內容 SHALL NOT 包含任何絕對或相對路徑。session 的工作目錄 SHALL 由主行程
自行解析、驗證與夾制 —— renderer 至多供應一個**不可逆的工作目錄識別碼**（不含路徑資訊），
SHALL NOT 能指定任何路徑。

此為 `terminal-sessions`「renderer 僅以 `folderId` 與工作目錄識別碼指定 session 位置」的延續：
持久化若接受 renderer 送來的**路徑**，即等同把一個路徑詞彙交還給 renderer，該邊界論證即失效。
**識別碼不構成例外**：它不可逆推為路徑，且主行程只對查表命中的值解析 —— 於是 renderer 可達的
位置集合仍恆等於工作目錄的列舉結果，而不是任意路徑。

**本要求涵蓋落盤資料中的每一個工作目錄事實**，包含 session 開啟的工作目錄與側欄的工作目錄
（見 `side-panel-worktree`）。後者雖然只決定側欄呈現哪一份原始碼、不涉及任何行程的工作目錄，
仍 SHALL 以不可逆識別碼保存：落盤的內容會在**下次啟動時**被解析，一個落盤的路徑等同一個繞過
查表的位置指定，其危害與它當初是為了什麼用途而寫入無關。

**這與 renderer 記憶體中持有 folder-relative 路徑並不衝突** —— 那本來就是它對檔案系統定址的
合法詞彙（見 `filesystem-access`）。本要求約束的是**送往持久化的內容**。

主行程自行取得的路徑（例如 shell 的最後工作目錄）SHALL NOT 送往 renderer。

#### Scenario: 持久化介面不接受任何路徑參數

- **WHEN** 檢視 renderer 可用的持久化能力介面
- **THEN** 其中不存在任何讓 renderer 指定工作目錄**路徑**或檔案路徑的參數

#### Scenario: 工作目錄以不可逆識別碼往返

- **WHEN** 檢視 renderer 送往持久化、以及自持久化取回的 session 資料
- **THEN** 其中的工作目錄僅以不可逆識別碼表示，不含任何路徑片段

#### Scenario: 側欄的工作目錄同樣以識別碼落盤

- **WHEN** 一個 Files 身分選定了某個 worktree 的 session 被持久化，檢視落盤的資料
- **THEN** 其側欄的工作目錄以不可逆識別碼表示，不含該 worktree 的路徑或其任何片段
