## MODIFIED Requirements

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

Relations SHALL always be provided to running claude sessions: handoff has no switch (removed
2026-09-30), so there is no state in which they are withdrawn.

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

- **WHEN** 應用程式重新啟動之後，C has been woken while its parent session P is still dormant
- **THEN** C 查詢自己的關係，結果標明 P 存在但不在執行中
- **AND** P 仍為休眠

#### Scenario: 關係中沒有路徑欄位

- **WHEN** 檢視提供給 agent 的關係內容，其中各對象所屬的 folder 皆位於 workspace 之內
- **THEN** 其中沒有任何表示路徑或 spekterm session 識別碼的欄位

#### Scenario: 母 session 查得到子 session 的狀態與結果

- **WHEN** session P 的子 session C 投遞了摘要為 S 的完成報告
- **THEN** P 此時查詢自己的關係，結果中 C 標明為已完成，並附帶 S

#### Scenario: 尚未完成的子 session 沒有結果

- **WHEN** P 的子 session C 尚未投遞任何完成報告
- **THEN** P 查詢自己的關係，結果中 C 標明其狀態，且沒有結果
