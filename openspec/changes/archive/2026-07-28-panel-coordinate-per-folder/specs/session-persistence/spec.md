## MODIFIED Requirements

### Requirement: session 跨應用程式重啟與 renderer 重新載入存活

重建一個 session 所需的**事實** SHALL 被持久化，並於下次開啟應用程式時重建：所屬 folder、
spawn 目標、使用者取的名字、分頁順序、**它開在哪個工作目錄**，以及 **pty 最近一次宣告的終端
標題**。renderer 重新載入時 SHALL 同樣重建。

持久化的內容 SHALL 限於重建所必需的事實，SHALL NOT 包含**可由當下環境廉價重算**的衍生狀態
（例如 folder 是否含 `openspec/`、git 分支 —— 那些每次載入都重算，存下來只是持久化謊言）。

**側欄座標（來源 repo、側欄的工作目錄、錨定的 change）SHALL NOT 由 session 持久化。** 它隸屬於
rail 上的項目而非任何 session（見 `side-panel-source`），由該能力自行持久化 —— 一個沒有任何
session 的 folder，其側欄座標同樣要跨重啟存活，而掛在 session 上的資料做不到這件事。

pty 宣告的標題屬於「必需」而非「衍生」：**休眠的 session 沒有 pty 可以再宣告一次**，不存它，重開後
那些分頁就全部退回流水號標籤，而它們正是被 agent 依任務命名的那些 —— 使用者認不出哪個是哪個。
它一經喚醒即被 pty 的下一次宣告覆蓋。

**session 開在哪個工作目錄**同樣屬於「必需」：它記錄的是使用者建立該 session 時的**選擇**，不是
某個時刻的觀測值。以工作目錄識別碼保存，重建時查表解析 —— 該工作目錄若已不存在（worktree 於應用
程式未開啟時被移除），該 session SHALL 於其 folder 的根目錄重建，SHALL NOT 使重建失敗。

重建 SHALL NOT 使既有的 pty 生命週期鬆動 —— 重建產生的是**新的** pty；`terminal-sessions` 的
「關閉分頁／重新載入／關閉視窗三路徑皆不留孤兒行程」不受影響。

#### Scenario: 關閉並重新開啟應用程式後 session 回來

- **WHEN** 使用者建立若干 session、為其中之一命名、調整順序，然後關閉並重新開啟應用程式
- **THEN** 這些 session 以相同的名字與順序重新出現於其所屬的 folder

#### Scenario: 側欄座標不隨 session 落盤

- **WHEN** 檢視 renderer 送往 session 持久化的資料
- **THEN** 其中不含側欄來源、側欄的工作目錄與錨定的 change

#### Scenario: renderer 重新載入後 session 回來

- **WHEN** renderer 重新載入
- **THEN** 先前的 session 以相同的名字與順序重建，且先前的 pty 皆已終止

#### Scenario: 開在工作目錄的 session 重建後仍在那裡

- **WHEN** 使用者於某個 linked worktree 建立一個 session，關閉並重新開啟應用程式，喚醒該 session
- **THEN** 新的 pty 的工作目錄為該 worktree 的根

#### Scenario: 工作目錄已消失時退回 folder 根目錄

- **WHEN** 一個 session 所開的 worktree 於應用程式未開啟期間被移除，其後該 session 被喚醒
- **THEN** 該 session 於其 folder 的根目錄重建，且不呈現為失敗

### Requirement: 重建的 session 為休眠態，於首次被顯示時才啟動 pty

重建出來的 session SHALL 處於**休眠**狀態 —— 具備完整身分（名字、順序）但**沒有 pty**。
休眠的 session SHALL 於**首次被顯示**時才啟動其 pty。

於是開啟應用程式時 SHALL **至多一個** session 被啟動 —— 即被選中的 folder 之 focused session；
SHALL NOT 一次啟動所有 session。**選中的 folder 不被持久化**，因此冷啟動當下沒有任何 folder 被選中，
也就沒有任何 session 被啟動；使用者選一個 repo 之後，該 repo 的 focused session 才醒過來。

休眠狀態 SHALL 被明確地呈現，SHALL NOT 呈現為一個空白的終端。

未被喚醒的休眠 session SHALL 維持持久化 —— 使用者一路未喚醒它便再次關閉應用程式時，它 SHALL 於
下次開啟時仍然存在。

#### Scenario: 開啟應用程式至多啟動一個 session

- **WHEN** 使用者關閉應用程式時有多個 session，重新開啟應用程式並選中其中一個 folder
- **THEN** 只有該 folder 的 focused session 啟動了 pty，其餘 session 皆為休眠且無 pty

#### Scenario: 顯示一個休眠的 session 使其啟動

- **WHEN** 使用者切換到一個休眠 session 所在的 folder 並使其成為顯示中的 session
- **THEN** 該 session 啟動其 pty

#### Scenario: 休眠的 session 不呈現為空白終端

- **WHEN** 使用者檢視一個尚未被喚醒的休眠 session
- **THEN** 該 session 明確地呈現其休眠狀態，而非一個沒有內容的終端

#### Scenario: 未喚醒的休眠 session 於再次重啟後仍存在

- **WHEN** 使用者重新開啟應用程式、未喚醒某個休眠 session、再次關閉並重新開啟應用程式
- **THEN** 該 session 仍然存在且仍為休眠

### Requirement: 對話無法續接時自癒為全新對話，不留下無法使用的 session

續接的對話不存在時，應用程式 SHALL 以一個**全新的**對話識別碼啟動一個全新的 claude session，
並更新持久化的對話識別碼；SHALL NOT 沿用原識別碼重新建立對話。使用者從未與該 session 對話過時
即屬此情形 —— 那時不存在任何對話紀錄可供續接。

自癒 SHALL NOT 改變該 session 於應用程式中的身分 —— 其分頁、名字與順序皆 SHALL 不受影響。

自癒 SHALL 至多嘗試一次 —— `claude` 本身無法啟動時，該 session 依 `terminal-sessions` 的既有要求
呈現為已結束並於終端顯示訊息，SHALL NOT 反覆重試。

#### Scenario: 從未對話過的 session 於重建後仍可用

- **WHEN** 使用者建立一個 claude session 但從未與它對話，關閉應用程式，重新開啟並喚醒該 session
- **THEN** 該 session 啟動一個可用的全新 claude，且其名字與順序不變

#### Scenario: claude 無法啟動時不反覆重試

- **WHEN** 一個重建的 claude session 被喚醒，但環境中 `claude` 無法啟動
- **THEN** 該 session 呈現為已結束並於終端顯示訊息，且啟動的嘗試不超過兩次

### Requirement: 持久化不得把路徑詞彙交給 renderer

renderer 送往持久化的內容 SHALL NOT 包含任何絕對或相對路徑。session 的工作目錄 SHALL 由主行程
自行解析、驗證與夾制 —— renderer 至多供應一個**不可逆的工作目錄識別碼**（不含路徑資訊），
SHALL NOT 能指定任何路徑。

此為 `terminal-sessions`「renderer 僅以 `folderId` 與工作目錄識別碼指定 session 位置」的延續：
持久化若接受 renderer 送來的**路徑**，即等同把一個路徑詞彙交還給 renderer，該邊界論證即失效。
**識別碼不構成例外**：它不可逆推為路徑，且主行程只對查表命中的值解析 —— 於是 renderer 可達的
位置集合仍恆等於工作目錄的列舉結果，而不是任意路徑。

**本要求涵蓋 session 落盤資料中的每一個工作目錄事實。** 側欄的工作目錄已不在其中（它隨側欄座標
改基到 rail 的項目上，見 `side-panel-source`）—— **但那條原則 SHALL NOT 因此鬆動**，它由
`side-panel-source` 的「側欄座標跨應用程式重啟存活」以相同的措辭承接：落盤的內容會在**下次啟動
時**被解析，一個落盤的路徑等同一個繞過查表的位置指定，其危害與它當初是為了什麼用途、又寫進哪
一個檔案，都無關。

**這與 renderer 記憶體中持有 folder-relative 路徑並不衝突** —— 那本來就是它對檔案系統定址的
合法詞彙（見 `filesystem-access`）。本要求約束的是**送往持久化的內容**。

主行程自行取得的路徑（例如 shell 的最後工作目錄）SHALL NOT 送往 renderer。

#### Scenario: 持久化介面不接受任何路徑參數

- **WHEN** 檢視 renderer 可用的持久化能力介面
- **THEN** 其中不存在任何讓 renderer 指定工作目錄**路徑**或檔案路徑的參數

#### Scenario: 工作目錄以不可逆識別碼往返

- **WHEN** 檢視 renderer 送往持久化、以及自持久化取回的 session 資料
- **THEN** 其中的工作目錄僅以不可逆識別碼表示，不含任何路徑片段
