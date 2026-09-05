## Purpose

把 Claude Code 自己寫在磁碟上、**預設 30 天後即被刪除**的 session transcript，萃取成一份逐列、
可長期保存的本機存檔，讓「我是怎麼跟 agent 工作的」這件事在原始資料消失之後仍然答得出來。
這個能力只負責資料在不在、對不對，不負責任何呈現。

## ADDED Requirements

### Requirement: 存檔以列為單位保存，不得只保存彙總結果

存檔 SHALL 以**一則使用者訊息一列、一次工具呼叫一列**的顆粒度保存，SHALL NOT 只保存直方圖、
計數或任何預先聚合的結果。彙總 SHALL 於讀取時計算。

**理由是不可逆性。** 來源資料會被刪除；一旦只留下彙總，將來想問一個當初沒想到的問題，
就再也沒有東西可以重算了。**「存錯顆粒度」與「沒存」在事後是同一件事。**

#### Scenario: 事後新增一個當初未規劃的指標

- **WHEN** 存檔中有某段期間的紀錄，而該期間的來源 transcript 已不存在
- **AND** 需要計算一個當初未被呈現、但其輸入欄位在萃取範圍內的指標
- **THEN** 該指標 SHALL 可自存檔完整重算，無須回頭讀取來源

#### Scenario: 存檔不保存彙總結果

- **WHEN** 檢視存檔的內容
- **THEN** 其中 SHALL NOT 出現任何直方圖、百分位或跨列的計數結果

### Requirement: 存檔保存來源已不存在的紀錄

一筆紀錄一旦寫入存檔，SHALL 在其來源 transcript 檔案被刪除之後繼續存在。掃描 SHALL NOT 以
「來源目前掃得到什麼」重建存檔 —— 那會讓存檔的內容始終等於來源，於是**這個能力等於不存在**。

#### Scenario: 來源檔案消失後重新掃描

- **WHEN** 存檔中已有某個 session 的紀錄
- **AND** 該 session 的 transcript 檔案已自來源目錄消失
- **AND** 隨後執行一次掃描
- **THEN** 該 session 的紀錄 SHALL 仍存在於存檔中

### Requirement: 萃取的欄位範圍

每一列 SHALL 保存足以重算已規劃指標的欄位，且 SHALL 保存 token 用量。具體為：

- **使用者訊息列**：時間、session 識別、專案識別、**訊息的完整內文**、是否為中斷標記。
  字元數等衍生值 SHALL 於讀取時計算，SHALL NOT 取代內文被保存。
- **工具呼叫列**：時間、session 識別、專案識別、工具名稱，以及該工具的**單一辨識參數**
  —— Bash 取指令的第一個 token、Skill 取 skill 名稱、Agent 取 subagent 類型。
- **用量列**：時間、session 識別、專案識別，以及 `input_tokens`、`output_tokens`、
  `cache_read_input_tokens`、`cache_creation_input_tokens` 四個數值。

**用量欄位在本 change 的呈現中不被使用，仍 SHALL 保存。** 它每列只多四個整數，而它是對
「將來想看成本」唯一的保險 —— 來源被刪之後補不回來。

#### Scenario: 使用者訊息的內文被保存

- **WHEN** 一則使用者訊息被萃取為一列
- **THEN** 該列 SHALL 含其完整內文

#### Scenario: 用量欄位被保存

- **WHEN** 來源的某一則 assistant 訊息帶有用量資訊
- **THEN** 上述四個 token 欄位 SHALL 出現在存檔中

#### Scenario: 工具的辨識參數被保存

- **WHEN** 來源含一次 Bash 呼叫與一次 Skill 呼叫
- **THEN** 存檔 SHALL 分別保有該 Bash 指令的第一個 token 與該 skill 的名稱

### Requirement: 以來源的結構旗標判定訊息是否為使用者所輸入

來源中有一類記錄其角色為 `user`、但**使用者從未輸入**：skill 與 slash command 被展開的內文、
其他 agent session 送來的訊息、圖片佔位、harness 的追問（`[Your previous response…]`）等。
判定 SHALL 以來源記錄本身的**結構旗標**為準（`isMeta`、`isCompactSummary`），
**SHALL NOT 以內文的文字樣式比對為主要判準**。

**這不是效率考量，是準確度。** 實測本機資料：以文字樣式比對只認得出 53 筆，而帶 `isMeta` 旗標
的實際有 **965 筆** —— 漏掉的 912 筆會讓使用者訊息數**高估 24%**，並讓長度的平均值從 53 膨脹到
1,119、最長值從 3,784 膨脹到 922,812。**那些數字全部看起來完全正常。**

**比照本 repo 既有的紀律：「一個由測試釘住的格式假設，不如一個使不變式無法被違反的結構。」**
文字樣式是一份永遠追不完的清單；結構旗標是來源自己標的。

各類記錄的歸屬：

| 記錄 | 歸屬 |
|---|---|
| `isMeta: true` | **不是**使用者訊息，不保存為使用者訊息列 |
| `isCompactSummary: true` | **不是**使用者訊息；SHALL 標示為脈絡壓縮而非丟棄（模型確實收到了它） |
| 頂層帶 `interruptedMessageId` 的記錄 | SHALL 保存並標示為中斷 —— 「我踩了煞車」本身就是要被計量的行為。判定 SHALL 以該欄位為準，**SHALL NOT 比對內文的 `[Request interrupted by user…]` 字串**（實測該類記錄不帶 `isMeta`，且字串是英文文案，改版即失效 —— 屆時「我什麼時候踩煞車」會變成一條零線） |
| slash command 的展開（`<command-name>` 等） | **是**使用者輸入；SHALL 還原為該 slash command |
| `<bash-input>` | **是**使用者輸入；其對應的 `<bash-stdout>` / `<bash-stderr>` **不是** |
| 背景工作通知（`<task-notification>`）**通篇只有通知** | **不產生任何列。** 實測本機資料：非 `isMeta` 的通知記錄 130 筆**全部是這一種** |
| 背景工作通知夾在真實訊息中 | 通知部分 SHALL 移除，其餘內文 SHALL 保留。實測本機資料為 **0 筆** —— 罕見但必須正確 |

#### Scenario: 帶 isMeta 旗標的記錄不成為使用者訊息列

- **WHEN** 來源含一則角色為 `user`、帶 `isMeta` 旗標的記錄
- **THEN** 存檔 SHALL NOT 因此新增使用者訊息列

#### Scenario: 脈絡壓縮被標示而非丟棄

- **WHEN** 來源含一則帶 `isCompactSummary` 旗標的記錄
- **THEN** 存檔 SHALL 保存一列並標示其為脈絡壓縮，且該列 SHALL NOT 被計為使用者訊息

#### Scenario: 中斷以結構欄位判定

- **WHEN** 來源含一則頂層帶 `interruptedMessageId` 的記錄
- **THEN** 存檔 SHALL 新增一列並標示其為中斷，且該列 SHALL NOT 被計為使用者訊息

#### Scenario: 內文像中斷但無結構欄位的記錄不被計為中斷

- **WHEN** 一則使用者訊息的內文恰好含有中斷標記的文字，但該記錄不帶 `interruptedMessageId`
- **THEN** 該列 SHALL 為一般的使用者訊息，SHALL NOT 被計為中斷

#### Scenario: slash command 還原為使用者輸入

- **WHEN** 來源含一則以 `<command-name>` 形式展開的 slash command 記錄
- **THEN** 存檔 SHALL 保存一則使用者訊息列，其內文 SHALL 為該 slash command 而非展開後的 XML

#### Scenario: 通篇只有背景工作通知的記錄不產生列

- **WHEN** 來源含一則角色為 `user`、內容僅為背景工作通知的記錄
- **THEN** 存檔 SHALL NOT 因此新增任何使用者訊息列（**SHALL NOT 新增一列空內文的訊息**）

#### Scenario: 夾帶通知的真實訊息仍被保留

- **WHEN** 一則使用者訊息的內容同時含有使用者輸入的文字與一段背景工作通知
- **THEN** 該列 SHALL 存在，且其內文 SHALL 為扣除通知之後的文字

### Requirement: 存檔的內文不離開本機，且不整批送往 renderer

存檔含使用者輸入的完整內文，因此：

- 存檔 SHALL 只寫入本機的 userData 之下，SHALL NOT 被送往任何網路端點。
- 主行程 SHALL NOT 將訊息內文整批送往 renderer；送往 renderer 的 SHALL 為彙總結果，
  以及呈現所需的**有限、明確**的片段（例如最常出現的極短訊息）。
- 存檔 SHALL NOT 含使用者 repo 的檔案內容或工具輸出 —— 那些不是使用者說的話。
- 存檔的目錄與檔案 SHALL 以僅限擁有者存取的權限建立。這是這台機器上最私密的一份文字之一，
  而它比來源活得久。

#### Scenario: renderer 不取得訊息內文的整批資料

- **WHEN** renderer 取得一份彙總結果
- **THEN** 其中 SHALL NOT 含有使用者訊息內文的完整清單

#### Scenario: 工具輸出不進存檔

- **WHEN** 來源含一則工具執行結果
- **THEN** 存檔 SHALL NOT 保存其內容

### Requirement: 以白名單處理來源的記錄類型

萃取 SHALL 只處理記錄類型為 `user` 與 `assistant` 的記錄，其餘類型 SHALL 一律忽略，
且忽略一個未知的類型 SHALL NOT 造成錯誤。

**這不是效能考量，是唯一撐得住版本更新的寫法。** 來源格式是 Claude Code 的內部格式而非公開
API：實測本機資料的記錄類型有 **21 種**，其中多數是隨版本陸續長出來的。黑名單式的排除
（「忽略這幾種」）會在下一次更新時把新類型當成資料處理。

#### Scenario: 未知的記錄類型不造成錯誤

- **WHEN** 來源含一種本能力未曾預期的記錄類型
- **THEN** 掃描 SHALL 正常完成，該記錄 SHALL 被忽略，且其他記錄的萃取結果 SHALL 不受影響

#### Scenario: 工具結果不被誤認為使用者訊息

- **WHEN** 來源含一則角色為 `user`、其內容為工具執行結果的記錄
- **THEN** 該記錄 SHALL NOT 產生使用者訊息列

### Requirement: 掃描為增量，且增量結果與全掃相同

掃描 SHALL 以來源檔案為單位判定是否需要重讀，未變更的檔案 SHALL NOT 被重新讀取。
**對同一份來源，增量掃描的結果 SHALL 與從零全掃的結果相同。**

首次掃描需讀取全部來源（實測 488 檔、31 萬行、約 24 秒）；其後每日實際變動的檔案僅數個。
缺少增量，這個能力每次使用都要付一次全掃的代價，於是不會有人開它。

#### Scenario: 未變更的檔案不被重讀

- **WHEN** 連續執行兩次掃描，其間來源沒有任何檔案變動
- **THEN** 第二次掃描 SHALL NOT 重新讀取任何來源檔案的內容

#### Scenario: 被追加內容的檔案其新增部分被萃取

- **WHEN** 一個先前已掃描過的來源檔案被追加了新的記錄
- **AND** 隨後執行一次掃描
- **THEN** 新增的記錄 SHALL 出現在存檔中，且既有的列 SHALL NOT 重複

#### Scenario: 增量結果與全掃一致

- **WHEN** 對同一份來源分別執行「多次增量掃描」與「一次從零全掃」
- **THEN** 兩者產生的存檔內容 SHALL 相同

### Requirement: 掃描於獨立於主行程的行程中執行

掃描與聚合 SHALL 於一個**獨立於主行程**的行程中執行，SHALL NOT 阻塞主行程的訊息迴圈。
掃描的進行狀態 SHALL 可被查詢。

首次掃描實測約 24 秒。同樣的工作放在主行程上就是 24 秒的 IPC 停擺 —— pty 的輸出、側欄的請求、
所有東西一起卡住。

#### Scenario: 掃描期間介面維持可用

- **WHEN** 一次掃描正在進行
- **THEN** 使用者 SHALL 仍可操作 session、側欄與其他介面元素，且終端的輸出 SHALL 持續流動

### Requirement: 掃描行程的失敗不得波及主行程與既有的 pty

掃描行程異常結束時，主行程 SHALL 存活，既有的終端 session SHALL 不受影響，且狀態
SHALL 回報為掃描失敗而非永遠停留在進行中。掃描行程 SHALL NOT 於關閉視窗、reload 或結束
應用程式後留下孤兒行程。

**這是「獨立行程」這個選擇的決定性理由，不是它的附帶好處。** 本能力解析的是一份會隨版本改變
的內部格式，它出事的機率高於這個 repo 裡其他任何模組 —— 而它出事時使用者正在跑的 agent
不該跟著死。少了這條 requirement，把它改回與主行程共用行程（或直接改回主行程）不會有任何
一個字變紅。

#### Scenario: 掃描行程異常結束

- **WHEN** 掃描行程於掃描期間異常結束
- **THEN** 主行程 SHALL 存活，既有的終端 session SHALL 仍可輸入與輸出，
  且掃描狀態 SHALL 為失敗

#### Scenario: 三條結束路徑皆不留孤兒行程

- **WHEN** 使用者關閉視窗、重新載入 renderer，或結束應用程式
- **THEN** 掃描行程 SHALL 已結束

### Requirement: 掃描於應用程式啟動後自動執行一次

應用程式啟動後 SHALL 自動觸發一次增量掃描，**與使用者是否要檢視結果無關**。

**這是本能力的保命動作。** 來源的保留期是 30 天：只在使用者開啟呈現介面時掃描的話，
使用者若一個月沒有開啟過它，那一個月的來源已經被刪除，而存檔裡永遠不會有它 ——
**那正是本能力要解決的問題本身**。少了這條 requirement，日後有人為了節省啟動資源把它改成
按需掃描，型別、測試與探針一律不紅，而資料開始靜默地流失。

#### Scenario: 未開啟呈現介面時掃描仍已發生

- **WHEN** 應用程式啟動並閒置一段時間，期間使用者未開啟任何呈現介面
- **THEN** 一次增量掃描 SHALL 已經執行

### Requirement: renderer 不取得來源的檔案系統位置

存檔的來源位於 workspace 邊界之外。主行程 SHALL NOT 將來源目錄或任何 transcript 檔案的
絕對路徑送往 renderer。專案 SHALL 以一個不含絕對路徑的識別呈現。

這與 `repo-branch` 讀取 worktree 的 gitdir 同類：**主行程自己的檔案存取不構成 `filesystem-access`
白名單的擴大**，因為 renderer 從頭到尾沒有、也不會取得指向那些位置的詞彙。

#### Scenario: 送往 renderer 的任何內容都不含絕對路徑

- **WHEN** renderer 取得彙總結果、掃描狀態，或任何一則錯誤訊息
- **THEN** 其中 SHALL NOT 含有來源目錄、transcript 檔案或存檔的絕對路徑

> 錯誤訊息是這條最容易漏的出口：`ENOENT: /home/…/.claude/projects/…` **不是彙總結果**，
> 卻會被畫到畫面上（比照本 repo 對「使用者可見文案」的第 3 類）。

### Requirement: 來源根尊重使用者 shell 的 `CLAUDE_CONFIG_DIR`

來源根 SHALL 為 `<設定目錄>/projects`，其中設定目錄取自 `CLAUDE_CONFIG_DIR`，
未設定時為 `~/.claude`。該變數的解析 SHALL 以**使用者互動 shell 的環境**為優先來源。

**理由是本 repo 既有的一道分界。** 使用者 shell 的環境於啟動時取得一次，但**只有 `PATH`
併進主行程的 `process.env`**，其餘由 `user-env` 持有、只在建構 pty 環境時合併 —— 那道分界是
承重的，不可為了這個能力放寬。因此若只讀 `process.env`，使用者在 `.zshrc` 裡設的
`CLAUDE_CONFIG_DIR` **主行程一個字都看不到**：掃到一個空目錄、呈現「來源不可用」，
而他的資料就在旁邊。**這個失效完全靜默，而且會被包裝成一個看起來很正常的畫面。**

（實測確認：設定該變數後，`projects/` 與其中的 transcript 確實一併搬到新位置。）

#### Scenario: 使用者 shell 設定的來源根被採用

- **WHEN** 使用者的互動 shell 設定了 `CLAUDE_CONFIG_DIR`，而主行程自身的環境沒有該變數
- **THEN** 掃描 SHALL 以該變數所指的位置為來源根

### Requirement: 存檔的損毀只影響它自己

單一存檔檔案或索引損毀時，掃描 SHALL 只重建受影響的部分，SHALL NOT 使掃描整體失敗、
SHALL NOT 使應用程式無法啟動。

應用程式在整檔覆寫的中途被結束是常態。比照 `session-persistence` 對持久化檔案損毀的既有要求。

#### Scenario: 單一存檔檔案損毀

- **WHEN** 存檔中有一份檔案的內容不是合法的 NDJSON
- **AND** 執行一次掃描
- **THEN** 掃描 SHALL 完成，該來源檔案 SHALL 被重新萃取，其餘存檔 SHALL 不受影響

### Requirement: 來源不存在或不可讀時的行為

來源目錄不存在、或個別來源檔案無法讀取時，掃描 SHALL 正常完成而非失敗，並 SHALL 使
「來源不可用」與「來源可用但沒有資料」兩種狀態可被區分。

使用者可能從未用過 `claude`，也可能只是這一台機器上沒有資料 —— 把兩者都呈現為空白，
會讓一個設定問題看起來像沒有東西可看。

#### Scenario: 來源目錄不存在

- **WHEN** 來源目錄不存在
- **AND** 執行一次掃描
- **THEN** 掃描 SHALL 完成而非失敗，且狀態 SHALL 指出來源不可用

#### Scenario: 個別檔案無法讀取

- **WHEN** 來源中有一個檔案無法讀取，其餘檔案正常
- **THEN** 掃描 SHALL 完成，其餘檔案的內容 SHALL 被萃取
