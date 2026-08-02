## MODIFIED Requirements

### Requirement: session 跨應用程式重啟與 renderer 重新載入存活

重建一個 session 所需的**事實** SHALL 被持久化，並於下次開啟應用程式時重建：**它的歸屬**
（某個 folder，或**全域** —— 見 `global-session`）、spawn 目標、使用者取的名字、分頁順序、
**它開在哪個工作目錄**，以及 **pty 最近一次宣告的終端標題**。renderer 重新載入時 SHALL 同樣重建。

**歸屬為全域** SHALL 以一個明確的狀態表示，SHALL NOT 以一個保留的 folder 識別碼字串表示 ——
後者會使每一處「以識別碼查找 folder」的讀取靜默地查無此 folder。

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
**全域 session 不具備工作目錄識別碼**（它不隸屬任何 repo，沒有可供查表的集合），其工作目錄由
`global-session` 定義。

重建 SHALL NOT 使既有的 pty 生命週期鬆動 —— 重建產生的是**新的** pty；`terminal-sessions` 的
「關閉分頁／重新載入／關閉視窗三路徑皆不留孤兒行程」不受影響。

#### Scenario: 關閉並重新開啟應用程式後 session 回來

- **WHEN** 使用者建立若干 session、為其中之一命名、調整順序，然後關閉並重新開啟應用程式
- **THEN** 這些 session 以相同的名字與順序重新出現於其所屬的 folder

#### Scenario: 全域 session 一併重建於全域項目之下

- **WHEN** 使用者同時開著隸屬於某 folder 的 session 與全域 session，關閉並重新開啟應用程式
- **THEN** 兩者各自重建於其原本的 rail 項目之下，且全域 session 不出現在任何 folder 之下

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

### Requirement: shell 目標的 session 於最後已知的工作目錄重生

spawn 目標為 login shell 的 session 被喚醒時，其 pty 的工作目錄 SHALL 為該 session **最後已知的**
工作目錄，而非恆為 folder 的根目錄。

**隸屬於某個 folder 的 session**，該工作目錄 SHALL 被夾制於**所屬 folder 的邊界內，或該 folder
所屬 repo 任一工作目錄的邊界內** —— 兩者皆不成立、或無法取得時，SHALL 退回 folder 的根目錄。

**全域 session 不受此路徑夾制**：它沒有所屬 folder，家目錄是它的起點而非邊界（見
`global-session`）—— 僅在該目錄已不存在或無法取得時退回家目錄。

**兩道夾制 SHALL 使用同一個判定**：記錄側（觀測並保存工作目錄時）與重建側（啟動 pty 時）各有一道，
只放寬其中一道等於沒有放寬 —— 記錄側若仍夾制，越界的位置從一開始就不會被保存，而重建側收到的是
缺席值，一切看起來正常。

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

#### Scenario: 全域 shell session 於家目錄之外的目錄重生

- **WHEN** 使用者在一個**全域** shell session 內切換到家目錄之外的某個目錄，關閉應用程式，重新開啟並喚醒該 session
- **THEN** 新的 shell 的工作目錄為該目錄，不被夾制回家目錄

#### Scenario: 無法取得最後工作目錄時退回根目錄

- **WHEN** 系統無法取得某個 shell session 最後的工作目錄
- **THEN** 該 session 被喚醒時的工作目錄為其 folder 的根目錄；該 session 為全域 session 時，為家目錄

### Requirement: 重建的 session 為休眠態，於首次被顯示時才啟動 pty

重建出來的 session SHALL 處於**休眠**狀態 —— 具備完整身分（名字、順序）但**沒有 pty**。
休眠的 session SHALL 於**首次被顯示**時才啟動其 pty。

於是開啟應用程式時 SHALL **至多一個** session 被啟動 —— 即被選中之 rail 項目的 focused session；
SHALL NOT 一次啟動所有 session。**選中的 rail 項目不被持久化，且冷啟動時 SHALL NOT 有任何項目
被預設選中**（含 `global-session` 的全域項目 —— 它恆常存在，因此「預設選中它」是極其自然的實作，
而那會使冷啟動立刻喚醒一個 session，本條的保證即失效）。使用者選一個項目之後，該項目的 focused
session 才醒過來。

休眠狀態 SHALL 被明確地呈現，SHALL NOT 呈現為一個空白的終端。

未被喚醒的休眠 session SHALL 維持持久化 —— 使用者一路未喚醒它便再次關閉應用程式時，它 SHALL 於
下次開啟時仍然存在。

#### Scenario: 開啟應用程式至多啟動一個 session

- **WHEN** 使用者關閉應用程式時有多個 session，重新開啟應用程式並選中其中一個 rail 項目
- **THEN** 只有該項目的 focused session 啟動了 pty，其餘 session 皆為休眠且無 pty

#### Scenario: 冷啟動不因全域項目恆存而喚醒 session

- **WHEN** 使用者關閉應用程式時全域項目有數個 session，重新開啟應用程式但尚未選中任何 rail 項目
- **THEN** 沒有任何 session 啟動 pty，全域項目的 session 皆為休眠

#### Scenario: 顯示一個休眠的 session 使其啟動

- **WHEN** 使用者切換到一個休眠 session 所在的 rail 項目並使其成為顯示中的 session
- **THEN** 該 session 啟動其 pty

#### Scenario: 休眠的 session 不呈現為空白終端

- **WHEN** 使用者檢視一個尚未被喚醒的休眠 session
- **THEN** 該 session 明確地呈現其休眠狀態，而非一個沒有內容的終端

#### Scenario: 未喚醒的休眠 session 於再次重啟後仍存在

- **WHEN** 使用者重新開啟應用程式、未喚醒某個休眠 session、再次關閉並重新開啟應用程式
- **THEN** 該 session 仍然存在且仍為休眠

### Requirement: claude 目標的 session 於其建立時的工作目錄重生

spawn 目標為 `claude` 的 session 被喚醒時，其 pty 的工作目錄 SHALL 為該 session **建立時所選定的
工作目錄**，而非恆為 folder 的根目錄。

**隸屬於某個 folder 的 session**，該位置 SHALL 由持久化的工作目錄識別碼查表解析，SHALL NOT 由觀測
pty 當下的工作目錄取得 —— agent 在 session 內執行的 `cd` 發生於子行程，不改變 pty 自身的工作目錄；
而識別碼記錄的是使用者的**選擇**，它比任一時刻的觀測值都更能代表這個 session 該在哪裡。

**全域 session 沒有工作目錄識別碼可查**（見 `global-session`）—— 它建立時的工作目錄恆為家目錄，
其位置由該能力定義，SHALL NOT 因查表落空而退回任何 folder 的根目錄。**「不由觀測值取得」這條對它
同等成立且更為要緊**：`claude --resume` 的對話查找與所在位置相關，一個開在家目錄的對話自其他目錄
續接時會查無此對話，隨後靜默自癒為全新對話。

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

#### Scenario: 全域 claude session 重生於家目錄

- **WHEN** 一個全域 claude session 被重建並喚醒
- **THEN** 新的 pty 的工作目錄為家目錄，且不因沒有工作目錄識別碼可查而退回任何 folder
