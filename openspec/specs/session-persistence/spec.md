# session-persistence Specification

## Purpose

**session 跨「關閉並重新開啟應用程式」與「renderer 重新載入」存活。**

關掉 app，pty 一定會死 —— **pty 的 master fd 必須有人持有**，app 一死，slave 收到 SIGHUP，底下的
行程跟著死。但「使用者建立了哪些 session」是**使用者親手做的事實**，沒有理由跟著 pty 一起消失。

因此本能力交付的是**重建**，不是**常駐**：重開時我們**重新開一個 pty**，然後讓 `claude` 續接它原本
的對話、讓 shell 回到最後的工作目錄並重播上次的畫面。**跑到一半的長行程（build、dev server）救不
回來** —— 那需要「讓 pty 活過 app 的生命」，是一個不同量級的架構決定（見 `docs/PRD.md` §11 的
「session 常駐」）。**不要把兩者混為一談。**

重建**不使 `terminal-sessions` 的「三路徑皆不留孤兒行程」鬆動**：舊 pty 照樣被殺，重建開的是新的。
## Requirements
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

該工作目錄 SHALL 被夾制於**所屬 folder 的邊界內，或該 folder 所屬 repo 任一工作目錄的邊界內** ——
兩者皆不成立、或無法取得時，SHALL 退回 folder 的根目錄。

shell 的行程狀態（環境變數、執行中的行程）SHALL NOT 被宣稱可還原 —— 這是重生，不是續接。

#### Scenario: 於子目錄重生

- **WHEN** 使用者在一個 shell session 內切換到 folder 底下的某個子目錄，關閉應用程式，重新開啟並喚醒該 session
- **THEN** 新的 shell 的工作目錄為該子目錄

#### Scenario: 於 folder 邊界外的工作目錄重生

- **WHEN** 使用者在一個 shell session 內切換到該 repo 位於 folder 邊界外的某個 worktree，關閉應用程式，重新開啟並喚醒該 session
- **THEN** 新的 shell 的工作目錄為該 worktree —— 它落在該 repo 的工作目錄之內，不再被夾制掉

#### Scenario: 越界的工作目錄退回根目錄

- **WHEN** 使用者在一個 shell session 內切換到既不在所屬 folder、也不在該 repo 任何工作目錄之下的目錄，關閉應用程式，重新開啟並喚醒該 session
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

### Requirement: claude 目標的 session 於其建立時的工作目錄重生

spawn 目標為 `claude` 的 session 被喚醒時，其 pty 的工作目錄 SHALL 為該 session **建立時所選定的
工作目錄**，而非恆為 folder 的根目錄。

該位置 SHALL 由持久化的工作目錄識別碼查表解析，SHALL NOT 由觀測 pty 當下的工作目錄取得 ——
agent 在 session 內執行的 `cd` 發生於子行程，不改變 pty 自身的工作目錄；而識別碼記錄的是使用者
的**選擇**，它比任一時刻的觀測值都更能代表這個 session 該在哪裡。

**續接失敗後自癒產生的 pty 同樣 SHALL 位於該工作目錄。** 這不是邊角：對話續接失敗是**主線情境**
（開了 session 卻還沒跟 agent 講過話時，它不寫 transcript，`--resume` 必定失敗），而自癒對
renderer **完全不可見** —— 使用者拿到的是一個能用的 agent，只是它站在錯的地方，且沒有任何訊號。

#### Scenario: 於 worktree 建立的 claude session 重生後仍在該 worktree

- **WHEN** 使用者於某個 linked worktree 建立一個 claude session，關閉並重新開啟應用程式，喚醒它
- **THEN** 新的 pty 的工作目錄為該 worktree 的根

#### Scenario: 續接失敗自癒後仍在該 worktree

- **WHEN** 一個於 linked worktree 建立的 claude session 被喚醒，而其對話無法續接因而自癒為全新對話
- **THEN** 自癒產生的 pty 的工作目錄仍為該 worktree 的根，而非該 folder 的根目錄

#### Scenario: 於 folder 根建立的 claude session 重生於 folder 根

- **WHEN** 一個未指定工作目錄的 claude session 被重建並喚醒
- **THEN** 新的 pty 的工作目錄為該 folder 的根目錄
