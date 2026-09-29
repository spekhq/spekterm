## MODIFIED Requirements

### Requirement: 由交接建立的 session 於建立當下記住它的來源 session

一則交接建立 session 時，系統 SHALL 讓該 session 記住它的**來源 session**：來源 session 的識別碼，
以及**交接被攝入時**來源的呈現快照。快照的歸屬 SHALL 為三者之一，且三者 SHALL 可被明確區分：
**某個 folder**（連同它當時的名稱）、**全域項目**、**未知**（攝入時來源已經結束）。快照另含來源
session 當時的標籤（未知時缺席）。標籤是 pty 宣告或使用者輸入的文字，SHALL 經與投遞內容相同的
正規化並截斷長度之後才被記下。

**快照 SHALL 取自攝入的那一刻，SHALL NOT 取自 session 建立的那一刻。** 一則退回待處理的交接（預填逾時）
可能在數天之後才被接受，那時來源 session 可能已經改名或關閉。

**來源 SHALL 由主行程於建立該 session 的當下寫入**，取自 `agent-handoff-source` 由落點推導出的
那一個來源 session：

- SHALL NOT 採信投遞內容中任何自稱來源的欄位；
- renderer SHALL NOT 能替任何 session 宣告或更改來源。renderer 至多能出示一張由主行程簽發的
  **單次憑證**，指明「這個新 session 是為了哪一則交接而建立的」；主行程查該則交接自己記下的來源。
  憑證 SHALL 綁定該則交接、目標 folder 與 agent 目標，**使用一次即失效**，且只在主行程決定要為該則
  交接建立 session 時簽發（到達即建立，或使用者接受）—— 一則歷史上的交接 SHALL NOT 能被重複引用
  來產生子 session。**對一個已經存在的 session，SHALL NOT 有任何途徑寫入來源**。

**兩條建立路徑皆適用**：到達即建立的交接，以及因預填逾時退回待處理、其後由使用者接受的交接。
使用者接受之前改選了 folder 時，來源不變。同一則交接因重新處理而建立了第二個 session 時，
兩者 SHALL 皆以同一個來源 session 為母 session。

非由交接建立的 session SHALL 沒有來源。

來源 session 在交接被攝入時已經結束者，來源 SHALL 仍被記下；其快照的歸屬為**未知**，且該來源
自始即不存在（見「session 的存在」）。歸屬為未知的來源 SHALL NOT 被呈現為來自全域項目。

#### Scenario: 交接建立的 session 帶著來源

- **WHEN** folder A 的 session S 投遞一則交接，目標為 folder B
- **THEN** folder B 中建立的 session 其來源為 S
- **AND** 其快照含 folder A 的名稱與 S 於攝入當下的標籤

#### Scenario: 投遞內容自稱的來源不被採信

- **WHEN** session S 投遞一則交接，其內容含有自稱來源為另一個 session T 的欄位
- **THEN** 建立的 session 其來源為 S

#### Scenario: 降級為待處理後接受的交接，快照是攝入當下的

- **WHEN** 一則由 session S 投遞的交接因預填逾時退回待處理，使用者其後把 S 重新命名，再接受該則交接
- **THEN** 建立的 session 其來源為 S，且其快照中的標籤為重新命名之前的標籤

#### Scenario: 一則交接建立兩個 session 時兩者皆為子 session

- **WHEN** 一則由 session S 投遞的交接建立了 session C1，其後因預填等不到就緒而回到待處理，使用者改選另一個 folder 接受，建立了 session C2
- **THEN** C1 與 C2 的來源皆為 S

#### Scenario: 攝入時已結束的來源不被呈現為全域

- **WHEN** session S 投遞一則交接之後、它被攝入之前，S 已經結束
- **THEN** 建立的 session 其來源標示標明來源已關閉，且不呈現為來自全域項目

#### Scenario: 同一張憑證不能用兩次

- **WHEN** 一則交接建立了 session C1，renderer 以同一張憑證再建立一個 session
- **THEN** 第二個 session 沒有來源

#### Scenario: 手動建立的 session 沒有來源

- **WHEN** 使用者於 folder A 手動建立一個 session
- **THEN** 該 session 沒有來源，且不呈現任何來源標示

#### Scenario: renderer 無法替既有的 session 宣告來源

- **WHEN** renderer 送往持久化的 session 資料中，替一個手動建立的 session 附上來源
- **THEN** 該 session 仍沒有來源，重新啟動之後亦然

### Requirement: agent 隨時查得到它當下的母、子、兄弟 session

每個 agent session SHALL 能於它存活期間的任何時刻，取得它**當下**的關係：它有沒有母 session、
母 session 是否存在與是否在執行、它目前存在的子 session，以及它目前存在的**兄弟**（與它有同一個
母 session 的其他 session，不含它自己）；每一個對象 SHALL 附帶它的固定名字
（見 `agent-peer-name`）、所屬的 rail 項目名稱與標籤。

**子 session 與兄弟 session 另 SHALL 附帶它的生命週期狀態（見 `handoff-completion`：已完成、進行中、
等你，或不呈現狀態 —— 後者含休眠者），以及它最新的完成結果（若有）。** 生命週期狀態改變時 SHALL
視同關係改變，agent 下一次查詢即得到新的值。 這是結果抵達母 session 的補償路徑：子 session 完成時母 session 可能不在
執行中，或子 agent 送出的訊息可能被忽略 —— 母 session 的 agent 仍查得到結果，而系統不必經手訊息。

**自我介紹只在 agent 的脈絡被建立或重建時注入**，而母 session 的子 session 是在它啟動**之後**才
長出來的，兄弟亦然。關係 SHALL NOT 只經由自我介紹提供；關係改變時（子或兄弟 session 建立、任一方不再存在、
改名、進入或離開執行中）SHALL NOT 需要重建 agent 的脈絡，agent 下一次查詢即得到新的值。

系統 SHALL NOT 在提供給 agent 的關係中放入任何路徑欄位或 spekterm 的 session 識別碼 —— agent 需要的
只有名字。

關係的提供隨交接偏好啟用與關閉：交接關閉時 SHALL NOT 提供，已提供者 SHALL 被移除。

**本能力不經手訊息本身。** 母子之間的訊息由 agent CLI 自身的訊息功能傳遞；本能力交付的是
「對方是誰、叫什麼名字、此刻收不收得到」。**休眠的 session 沒有行程，收不到訊息** —— 關係中
SHALL 標明它不在執行中，本能力 SHALL NOT 為此喚醒它。

#### Scenario: 母 session 於啟動之後查得到新長出的子 session

- **WHEN** session P 啟動之後投遞一則交接，因而建立了 session C，其間 P 的脈絡未被重建
- **THEN** P 此時查詢自己的關係，結果中含有 C 與 C 的固定名字

#### Scenario: 子 session 查得到母 session 的名字

- **WHEN** session C 由 session P 交接而來
- **THEN** C 查詢自己的關係，結果中的母 session 為 P，並附帶 P 的固定名字

#### Scenario: 不存在的子 session 自查詢結果中消失

- **WHEN** 承「母 session 於啟動之後查得到新長出的子 session」，使用者關閉 C
- **THEN** P 此時查詢自己的關係，結果中不含 C

#### Scenario: 兄弟查得到彼此

- **WHEN** session P 先後交接出 session C1 與 C2，其間 C1 的脈絡未被重建
- **THEN** C1 此時查詢自己的關係，結果的兄弟中含有 C2 與 C2 的固定名字
- **AND** C1 的兄弟中不含 C1 自己

#### Scenario: 不存在的兄弟自查詢結果中消失

- **WHEN** 承上，使用者關閉 C2
- **THEN** C1 此時查詢自己的關係，結果的兄弟中不含 C2

#### Scenario: 母 session 不存在之後兄弟仍互相查得到

- **WHEN** 承「兄弟查得到彼此」，使用者關閉 P
- **THEN** C1 此時查詢自己的關係，母 session 標明已關閉，且兄弟中仍含有 C2

#### Scenario: 休眠的母 session 標明不在執行中

- **WHEN** 應用程式重新啟動之後，C 已被顯示而其母 session P 仍為休眠
- **THEN** C 查詢自己的關係，結果標明 P 存在但不在執行中
- **AND** P 仍為休眠

#### Scenario: 關係中沒有路徑欄位

- **WHEN** 檢視提供給 agent 的關係內容，其中各對象所屬的 folder 皆位於 workspace 之內
- **THEN** 其中沒有任何表示路徑或 spekterm session 識別碼的欄位

#### Scenario: 交接關閉時不提供關係

- **WHEN** 使用者把交接偏好關閉
- **THEN** 任何 session 都查詢不到關係

#### Scenario: 母 session 查得到子 session 的狀態與結果

- **WHEN** session P 的子 session C 投遞了摘要為 S 的完成報告
- **THEN** P 此時查詢自己的關係，結果中 C 標明為已完成，並附帶 S

#### Scenario: 尚未完成的子 session 沒有結果

- **WHEN** P 的子 session C 尚未投遞任何完成報告
- **THEN** P 查詢自己的關係，結果中 C 標明其狀態，且沒有結果
