# status-bar Specification

## Purpose
TBD - created by archiving change panel-drive-and-shell-affordances. Update Purpose after archive.
## Requirements
### Requirement: 狀態列呈現 focused session 的脈絡

狀態列 SHALL 呈現當前 focused session 的脈絡資訊，至少包含：其所屬 repo 的名稱、該 repo 的
git 當前分支、該 session 的標籤，以及它錨定的 change（若有）與該 change 的任務進度（若有）。

側欄來源**不等於** focused session 自身 folder 時，狀態列 SHALL 一併標示側欄來源；
**相等時 SHALL NOT 標示** —— 那是常態，標示它等於在每一列都重複同一個值。

#### Scenario: 呈現 focused session 的 repo 與分支

- **WHEN** 存在 focused session
- **THEN** 狀態列呈現該 session 所屬 repo 的名稱與其 git 當前分支

#### Scenario: 呈現錨定的 change 與進度

- **WHEN** focused session 錨定了一個含 tasks 的 change
- **THEN** 狀態列呈現該 change 的識別碼與其任務完成進度

#### Scenario: 側欄來源指向別的 repo 時標示

- **WHEN** 側欄來源被指向 workspace 中另一個 folder
- **THEN** 狀態列標示側欄來源

#### Scenario: 側欄來源即自身時不標示

- **WHEN** 側欄來源等於 focused session 自身所屬的 folder
- **THEN** 狀態列不標示側欄來源

#### Scenario: 切換 focused session 時內容隨之改變

- **WHEN** 使用者把焦點切換到另一個 session
- **THEN** 狀態列呈現的脈絡改為該 session 的

### Requirement: 狀態列呈現該 session 的工作目錄與 git 工作區狀態

狀態列 SHALL 呈現 focused session 的 pty **當下的工作目錄**（不是它所屬 folder 的路徑 ——
使用者在終端裡 `cd` 之後，這個欄位 SHALL 隨之改變）。路徑過深時 SHALL 縮寫。

git 分支之外，狀態列 SHALL 標示該工作目錄的 git 工作區**是否有未提交的變更**；當它位於一個
linked worktree 時，SHALL 呈現該 worktree 的名稱而非完整路徑。

工作目錄的取得 SHALL NOT 倚賴 agent 提供 —— login shell 的 session 同樣要有這個欄位。

#### Scenario: 於終端內切換目錄後欄位隨之更新

- **WHEN** 使用者在 focused session 的終端內切換到另一個目錄
- **THEN** 狀態列呈現的工作目錄於短時間內改為新的目錄

#### Scenario: login shell 的 session 同樣呈現工作目錄

- **WHEN** focused session 的 spawn 目標為 login shell
- **THEN** 狀態列仍呈現其當下的工作目錄

#### Scenario: 工作區有未提交的變更時標示

- **WHEN** focused session 的工作目錄所屬的 git 工作區有未提交的變更
- **THEN** 狀態列在分支旁標示該狀態

### Requirement: 狀態列呈現只有 spekterm 知道的工作區事實

狀態列 SHALL 呈現下列 spekterm 獨有的事實：當前 repo 的 session 數與 workspace 的 session 總數、
focused session 的執行狀態、**side panel 中未存檔的緩衝區數**，以及側欄來源 repo 的 spec 數與
進行中的 change 數。

未存檔的緩衝區數為零時 SHALL NOT 呈現該欄位 —— 它是一個警示，恆常呈現會讓它失去警示的作用。

#### Scenario: 呈現 session 計數

- **WHEN** 當前 repo 有數個 session，而 workspace 中另有其他 repo 的 session
- **THEN** 狀態列同時呈現當前 repo 的 session 數與 workspace 的總數

#### Scenario: 有未存檔的變更時呈現，沒有時不呈現

- **WHEN** side panel 中有未存檔的緩衝區
- **THEN** 狀態列呈現其數量
- **WHEN** 沒有任何未存檔的緩衝區
- **THEN** 狀態列不呈現該欄位

### Requirement: 狀態列呈現 agent 回報的用量，缺席時退回第一手欄位

當 focused session 的 agent 狀態可取得時（見 `claude-status-bridge`），狀態列 SHALL 呈現該 agent
回報的：**模型顯示名稱、推理強度（effort）、是否啟用延伸思考、context window 的使用百分比、
本次工作累計的增刪行數、花費，以及各個用量上限的使用比例與其重置時刻。**

重置時刻 SHALL 以**使用者當地時區**呈現。用量上限的窗口跨日與否決定其精細度：當日內重置者
SHALL 只呈現時間，跨日者 SHALL 一併呈現日期。

增刪行數在兩者皆為零時 SHALL NOT 呈現 —— 尚未改動任何東西時，一組零只是雜訊。

百分比 SHALL 以 agent 自己回報的 context window 大小為分母計算，SHALL NOT 由 spekterm 自行
維護「模型 → context window 大小」的對照表 —— 那樣的對照表會隨新模型過期，而它失效的樣子是
**一個看起來很正常的錯誤數字**。

agent 狀態缺席、過期或無法解析時（偏好未啟用、session 為 login shell、agent 未回報該欄位），
狀態列 SHALL 僅呈現第一手欄位，SHALL NOT 呈現錯誤訊息，亦 SHALL NOT 留下空白的欄位。
payload 中缺少的**個別欄位** SHALL 各自不呈現，SHALL NOT 使整條狀態列失效。

#### Scenario: agent 狀態可取得時呈現用量

- **WHEN** focused session 是啟用了狀態橋接的 claude session，且其 agent 已回報狀態
- **THEN** 狀態列呈現模型顯示名稱、推理強度與 context window 使用百分比
- **AND** agent 已回報用量上限時，一併呈現其使用比例與重置時刻

#### Scenario: 尚未改動任何行數時不呈現該欄位

- **WHEN** agent 回報的增行數與刪行數皆為零
- **THEN** 狀態列不呈現增刪行數

#### Scenario: 未啟用橋接時退回第一手欄位

- **WHEN** 狀態橋接的偏好未啟用
- **THEN** 狀態列呈現 repo、分支、工作目錄等第一手欄位
- **AND** 不呈現任何錯誤訊息或空白欄位

#### Scenario: payload 缺少個別欄位時只略過該欄位

- **WHEN** agent 回報的狀態中不含用量上限資訊
- **THEN** 狀態列不呈現該欄位
- **AND** 其餘欄位照常呈現

### Requirement: 狀態列不呈現恆定不變的欄位

狀態列的每一個欄位 SHALL 隨脈絡改變。狀態列 SHALL NOT 呈現字元編碼、應用程式版本號這類
**恆為同一個值**的欄位 —— 一個永遠顯示同一個值的欄位不傳遞任何資訊，只佔位置。

`docs/workspace-mockup.html` 的狀態列含有此類欄位（`UTF-8`、產品名與版本號）。**那是雛型的
佔位內容，不是版面契約**：雛型對狀態列的權威在於它的位置、高度與分段形式，不在於它填了什麼字。

#### Scenario: 不呈現字元編碼或版本號

- **WHEN** 狀態列呈現於畫面上
- **THEN** 其內容不含字元編碼字樣，亦不含應用程式版本號

### Requirement: 無可呈現的脈絡時狀態列仍存在並呈現空狀態

workspace 沒有任何 folder、或當前 repo 沒有任何 session 時，狀態列 SHALL 仍然存在，
並 SHALL 呈現一個說明當下狀態的空狀態，SHALL NOT 呈現為一列空白。

#### Scenario: workspace 為空時

- **WHEN** workspace 中沒有任何 folder
- **THEN** 狀態列存在，且呈現空狀態文字

#### Scenario: 當前 repo 沒有 session 時

- **WHEN** 當前選中的 repo 沒有任何 session
- **THEN** 狀態列存在，且呈現空狀態文字

### Requirement: 寬度不足時由右往左省略，優先保留 repo 與分支

狀態列的內容超出可用寬度時 SHALL **由右往左**省略，且 SHALL 優先保留 repo 名稱與 git 分支。
狀態列 SHALL NOT 因內容過長而換行，亦 SHALL NOT 產生橫向捲動 —— 它的高度是版面契約的一部分。

此要求是本能力存在的理由本身：使用者的 agent 自行繪製的狀態行之所以會被截斷，正是因為它與
終端內容**共用同一個寬度**；狀態列若以同樣的方式失控，就沒有解決任何問題。

#### Scenario: 視窗變窄時仍看得到 repo 與分支

- **WHEN** 主視窗寬度縮減至狀態列內容無法完整呈現
- **THEN** repo 名稱與 git 分支仍然可見
- **AND** 狀態列維持單行，且不出現橫向捲動

