## MODIFIED Requirements

### Requirement: session 跨應用程式重啟與 renderer 重新載入存活

重建一個 session 所需的**事實** SHALL 被持久化，並於下次開啟應用程式時重建：**它的歸屬**
（某個 folder，或**全域** —— 見 `global-session`）、spawn 目標、使用者取的名字、分頁順序、
**它開在哪個工作目錄**、**pty 最近一次宣告的終端標題**，以及由主行程寫入的**交接來源**（見
`session-lineage`）與 claude 目標的**固定名字**（見 `agent-peer-name`）。renderer 重新載入時 SHALL 同樣重建。

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

#### Scenario: 來源與固定名字隨 session 重建

- **WHEN** 一個由交接建立的 claude session 存在，關閉並重新開啟應用程式
- **THEN** 它的來源與固定名字與關閉之前相同

## ADDED Requirements

### Requirement: session 的來源與固定名字由主行程持久化，renderer 不能寫入

session 的來源（見 `session-lineage`）與 claude 目標的固定名字（見 `agent-peer-name`）SHALL 由
**主行程**寫入並持久化。renderer 送往持久化的 session 資料中即使含有它們，亦 SHALL 不被採信 ——
落盤時 SHALL 保留主行程已知的值，SHALL NOT 以 renderer 送來的值覆寫，亦 SHALL NOT 因 renderer
沒有送來而清除。

**理由**：來源決定了 agent 被告知「誰是你的母 session」，名字是 agent 被聯絡的地址 —— 兩者都是
關於身分的事實，不是呈現偏好。renderer 若能寫入它們，一個被入侵或有 bug 的 renderer 就能讓 agent
把訊息送給錯的對象，而使用者在畫面上看到的關係也不再可信。

**兩者都會在下次啟動時被使用，因此都適用「持久化的識別碼在被用於命令或檔案路徑之前必須驗證」**：

- 來源中的 session 識別碼會被**解析**（用以查找母 session）。不合法時 SHALL 丟棄該筆來源（該 session
  成為沒有來源的 session），SHALL NOT 丟棄該 session。
- 固定名字會成為 agent CLI 的**參數**。它 SHALL 以與產生時相同的字元集與長度規則驗證；不合法時
  SHALL 丟棄，並依 `agent-peer-name` 重新決定一個，SHALL NOT 以原值啟動 agent。

來源的快照（folder 名稱、session 標籤）是給人看的文字，SHALL NOT 被用於組成任何命令或檔案路徑；
系統 SHALL NOT 在其中放入任何路徑欄位。

session 被關閉時，它作為**母 session** 的關係 SHALL 保留在其子 session 上（見 `session-lineage`）。

#### Scenario: renderer 送來的來源與名字不被採信

- **WHEN** renderer 送往持久化的資料中，替一個 session 附上另一個 session 為其來源、並附上另一個名字
- **THEN** 重新啟動之後，該 session 的來源與名字與主行程原本記下的相同

#### Scenario: renderer 沒有送來源不會清掉來源

- **WHEN** session C 有來源，renderer 送往持久化的 C 資料中不含來源
- **THEN** 重新啟動之後，C 的來源仍在

#### Scenario: 不合法的來源識別碼只丟棄來源

- **WHEN** 持久化檔案中某個 session 的來源識別碼不是合法格式
- **THEN** 該 session 被重建且沒有來源，該值不被用於任何查找、命令或路徑

#### Scenario: 不合法的固定名字不進入 agent 的參數

- **WHEN** 持久化檔案中某個 claude session 的固定名字含有字元集之外的字元
- **THEN** 該 session 被喚醒時，agent 以一個合法的、重新決定的名字啟動，原值不出現在任何參數中
