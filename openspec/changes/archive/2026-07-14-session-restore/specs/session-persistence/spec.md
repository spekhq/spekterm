## ADDED Requirements

### Requirement: session 跨應用程式重啟與 renderer 重新載入存活

重建一個 session 所需的**事實** SHALL 被持久化，並於下次開啟應用程式時重建：所屬 folder、
spawn 目標、使用者取的名字、分頁順序、錨定的 change，以及 **pty 最近一次宣告的終端標題**。
renderer 重新載入時 SHALL 同樣重建。

持久化的內容 SHALL 限於重建所必需的事實，SHALL NOT 包含**可由當下環境廉價重算**的衍生狀態
（例如 folder 是否含 `openspec/`、git 分支 —— 那些每次載入都重算，存下來只是持久化謊言）。

pty 宣告的標題屬於「必需」而非「衍生」：**休眠的 session 沒有 pty 可以再宣告一次**，不存它，重開後
那些分頁就全部退回流水號標籤，而它們正是被 agent 依任務命名的那些 —— 使用者認不出哪個是哪個。
它一經喚醒即被 pty 的下一次宣告覆蓋。

重建 SHALL NOT 使既有的 pty 生命週期鬆動 —— 重建產生的是**新的** pty；`terminal-sessions` 的
「關閉分頁／重新載入／關閉視窗三路徑皆不留孤兒行程」不受影響。

#### Scenario: 關閉並重新開啟應用程式後 session 回來

- **WHEN** 使用者建立若干 session、為其中之一命名、調整順序，然後關閉並重新開啟應用程式
- **THEN** 這些 session 以相同的名字與順序重新出現於其所屬的 folder

#### Scenario: 錨定的 change 一併回來

- **WHEN** 一個錨定了某個 change 的 session，經歷應用程式關閉並重新開啟
- **THEN** 該 session 重建後仍錨定同一個 change

#### Scenario: renderer 重新載入後 session 回來

- **WHEN** renderer 重新載入
- **THEN** 先前的 session 以相同的名字與順序重建，且先前的 pty 皆已終止

### Requirement: 重建的 session 為休眠態，於首次被顯示時才啟動 pty

重建出來的 session SHALL 處於**休眠**狀態 —— 具備完整身分（名字、順序、錨定）但**沒有 pty**。
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

### Requirement: claude 目標的 session 續接其原本的對話

spawn 目標為 `claude` 的 session SHALL 以一個由應用程式指定、且被持久化的**對話識別碼**啟動。
該 session 重建並被喚醒時，SHALL 續接**同一個**對話 —— 使用者 SHALL 看到先前的對話內容。

該對話識別碼 SHALL 獨立於 session 自身的識別碼，使前者可被替換而不影響後者。

#### Scenario: 重建後的 claude session 續上先前的對話

- **WHEN** 使用者與一個 claude session 對話過，關閉應用程式，重新開啟並喚醒該 session
- **THEN** 該 session 續接先前的對話，先前的對話內容可見

### Requirement: 對話無法續接時自癒為全新對話，不留下無法使用的 session

續接的對話不存在時，應用程式 SHALL 以一個**全新的**對話識別碼啟動一個全新的 claude session，
並更新持久化的對話識別碼；SHALL NOT 沿用原識別碼重新建立對話。使用者從未與該 session 對話過時
即屬此情形 —— 那時不存在任何對話紀錄可供續接。

自癒 SHALL NOT 改變該 session 於應用程式中的身分 —— 其分頁、名字、順序與錨定的 change 皆 SHALL 不受影響。

自癒 SHALL 至多嘗試一次 —— `claude` 本身無法啟動時，該 session 依 `terminal-sessions` 的既有要求
呈現為已結束並於終端顯示訊息，SHALL NOT 反覆重試。

#### Scenario: 從未對話過的 session 於重建後仍可用

- **WHEN** 使用者建立一個 claude session 但從未與它對話，關閉應用程式，重新開啟並喚醒該 session
- **THEN** 該 session 啟動一個可用的全新 claude，且其名字、順序與錨定的 change 不變

#### Scenario: claude 無法啟動時不反覆重試

- **WHEN** 一個重建的 claude session 被喚醒，但環境中 `claude` 無法啟動
- **THEN** 該 session 呈現為已結束並於終端顯示訊息，且啟動的嘗試不超過兩次

### Requirement: shell 目標的 session 於最後已知的工作目錄重生

spawn 目標為 login shell 的 session 被喚醒時，其 pty 的工作目錄 SHALL 為該 session **最後已知的**
工作目錄，而非恆為 folder 的根目錄。

該工作目錄 SHALL 被夾制於所屬 folder 的邊界內 —— 越界、或無法取得時，SHALL 退回 folder 的根目錄。

shell 的行程狀態（環境變數、執行中的行程）SHALL NOT 被宣稱可還原 —— 這是重生，不是續接。

#### Scenario: 於子目錄重生

- **WHEN** 使用者在一個 shell session 內切換到 folder 底下的某個子目錄，關閉應用程式，重新開啟並喚醒該 session
- **THEN** 新的 shell 的工作目錄為該子目錄

#### Scenario: 越界的工作目錄退回根目錄

- **WHEN** 使用者在一個 shell session 內切換到所屬 folder 之外的目錄，關閉應用程式，重新開啟並喚醒該 session
- **THEN** 新的 shell 的工作目錄為該 folder 的根目錄

#### Scenario: 無法取得最後工作目錄時退回根目錄

- **WHEN** 系統無法取得某個 shell session 最後的工作目錄
- **THEN** 該 session 被喚醒時的工作目錄為其 folder 的根目錄

### Requirement: 喚醒的 session 其 pty 自誕生起即採用終端當下的尺寸

休眠的 session 被喚醒時，其 pty SHALL 自誕生起就採用該終端**當下**的欄列數，SHALL NOT 停留在
spawn 時的預設尺寸直到下一次尺寸變化為止。

**喚醒倒轉了「pty 先誕生、終端後掛載」的順序**：休眠 session 的終端在 pty 存在**之前**就已經量測
過尺寸了，那次同步因此落空（沒有 pty 可以接收）；而依「尺寸有沒有變化」來決定是否同步的機制，
其後不會再送出第二次。若不另行處理，pty 將**永遠**停在 spawn 時的預設尺寸 —— pty 內的程式以錯誤
的寬度排版，畫面看起來縮成一小塊，直到使用者手動改變視窗大小為止。

#### Scenario: 喚醒後 pty 的尺寸與終端一致

- **WHEN** 使用者顯示一個休眠的 session，使其啟動 pty
- **THEN** 該 pty 的欄列數與終端當下的可用尺寸相符，而非 spawn 時的預設尺寸

### Requirement: 終端畫面以快照還原，且歷史與 live 內容明確區分

shell session 的終端畫面 SHALL 被快照並於重建時重播，使使用者看得到上次的內容。

重播的內容 SHALL 與新 pty 產生的內容**明確區分**——重播的內容並非由該 pty 產生，若不加區分，
使用者會誤以為該 shell 仍是先前那一個。

claude session SHALL NOT 重播快照 —— `claude` 續接對話時會自行重現先前的對話內容，重播將使
使用者看到兩份歷史。

快照 SHALL 有明確的體積上限，SHALL NOT 無限增長。

#### Scenario: 重建的 shell session 顯示上次的畫面

- **WHEN** 使用者在一個 shell session 產生若干輸出，關閉應用程式，重新開啟並喚醒該 session
- **THEN** 先前的終端內容可見，且與新 shell 產生的內容之間有明確的區分

#### Scenario: 重建的 claude session 不出現重複的歷史

- **WHEN** 一個對話過的 claude session 被重建並喚醒
- **THEN** 先前的對話內容只出現一次

### Requirement: session 的 pty 不得繼承「執行中的 Claude Code session」標記

session 的 pty SHALL NOT 繼承那些宣告「本行程隸屬於某個執行中的 Claude Code session」的環境變數 ——
應用程式本身若由這樣的行程啟動，那些標記 SHALL 在 spawn 之前被移除。

**這是「claude 續接對話」得以成立的前提**：帶著那些標記啟動的 `claude` 會把自己視為**巢狀的子
session**，而巢狀的 claude **不留下對話紀錄** —— 於是重建時的續接 SHALL 永遠失敗，而自癒機制會把
這個失敗**掩蓋掉**（使用者拿到一個可用的 claude，只是對話永遠是全新的）。

移除 SHALL 以明確列舉的名單為之，SHALL NOT 以名稱前綴一概剝除 —— 認證用的變數必須留下。

此要求對**兩種** spawn 目標皆適用：使用者於 login shell 內手動啟動 `claude` 時，面對的是同一個問題。

#### Scenario: 巢狀標記不進入 pty 的環境

- **WHEN** 應用程式由一個執行中的 Claude Code session 啟動，其環境帶有宣告該從屬關係的變數
- **THEN** 這些變數不出現在任何 session 的 pty 環境中

#### Scenario: 認證用的變數不被剝除

- **WHEN** 環境中存在 `claude` 用於認證的變數
- **THEN** 它們原封不動地傳入 pty 的環境

### Requirement: 持久化的識別碼在被用於命令或檔案路徑之前必須驗證

任何持久化的識別碼 SHALL 在被用於組成外部命令或檔案路徑之前，以嚴格的格式驗證。持久化的內容是
**不受信任的輸入** —— 它是磁碟上的檔案，可能被竄改或損毀。

驗證不通過時 SHALL 丟棄該筆資訊 —— 對話識別碼不合法時 SHALL 以全新的對話重建該 session；
session 識別碼不合法時 SHALL 丟棄該 session。SHALL NOT 將未經驗證的值拼接進任何命令或路徑。

#### Scenario: 不合法的對話識別碼不進入命令

- **WHEN** 持久化檔案中某個 session 的對話識別碼不是合法格式
- **THEN** 該值不被拼接進任何命令，且該 session 以一個全新的對話重建

#### Scenario: 不合法的 session 識別碼不進入檔案路徑

- **WHEN** 持久化檔案中某個 session 的識別碼不是合法格式
- **THEN** 該值不被用於組成任何檔案路徑，且該 session 被丟棄

### Requirement: 持久化不得把路徑詞彙交給 renderer

renderer 送往持久化的內容 SHALL NOT 包含任何絕對或相對路徑。session 的工作目錄 SHALL 由主行程
自行取得、驗證與夾制 —— renderer 在語彙上 SHALL NOT 能指定任何 session 的工作目錄。

此為 `terminal-sessions`「renderer 僅以 `folderId` 指定 session 位置」的延續：持久化若接受 renderer
送來的路徑，即等同把一個路徑詞彙交還給 renderer，該邊界論證即失效。

#### Scenario: 持久化介面不接受任何路徑參數

- **WHEN** 檢視 renderer 可用的持久化能力介面
- **THEN** 其中不存在任何讓 renderer 指定工作目錄或檔案路徑的參數

### Requirement: 持久化檔案的損毀不得使應用程式無法啟動

持久化檔案無法解析、或版本不符時，應用程式 SHALL 隔離該檔案（改名保留，不刪除）並以空的 session
清單啟動。

個別 session 項目不合法時 SHALL 只丟棄**該項**，其餘 session SHALL 照常重建 —— 一個壞掉的 session
SHALL NOT 使所有 session 一併消失。

任何讀取失敗 SHALL NOT 使應用程式無法啟動。

#### Scenario: 整份損毀時以空清單啟動並保留原檔

- **WHEN** 持久化檔案的內容無法解析
- **THEN** 應用程式正常啟動且沒有任何 session，原檔案被改名保留

#### Scenario: 單一項目不合法時其餘照常重建

- **WHEN** 持久化檔案中有一個 session 項目的欄位不合法，其餘項目合法
- **THEN** 應用程式重建其餘的 session，只丟棄不合法的那一個

### Requirement: 已結束的 session 不被持久化

pty 已結束（`exited`）的 session SHALL NOT 被持久化 —— 重新開啟應用程式時它們 SHALL NOT 出現。

#### Scenario: 已結束的 session 於重啟後不出現

- **WHEN** 一個 session 的 pty 已結束，使用者未關閉該 session 便關閉應用程式，然後重新開啟
- **THEN** 該 session 不出現於清單中

### Requirement: 應用程式非正常結束時仍保有最近一次快照

終端畫面的快照 SHALL NOT 只在關閉視窗時才產生 —— 應用程式非正常結束（未經正常關閉流程）時，
最近一次的快照 SHALL 仍然可用。

#### Scenario: 強制結束後仍能還原畫面

- **WHEN** 使用者在一個 shell session 產生輸出、稍候片刻，應用程式隨後被強制結束
- **THEN** 重新開啟應用程式並喚醒該 session 時，先前的終端內容仍可見
