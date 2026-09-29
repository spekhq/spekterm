## MODIFIED Requirements

### Requirement: 目標以告知 agent 的那份清單查表解析，完整相等，歧義與查無皆拒絕

系統 SHALL 把投遞中的目標解析為一個 workspace folder，作法 SHALL 為在**告知 agent 的那份清單
所取自的同一個來源**中查表：先比對 folder 的顯示名稱（不分大小寫、**完整相等**），再比對其
絕對路徑。

- 命中恰一個 ⇒ 採用。
- **命中多於一個 ⇒ 拒絕**，並列出候選。
- **零命中 ⇒ 拒絕。**

**SHALL NOT 以模糊比對、前綴比對或最接近者取代完整相等。** 這條路徑上沒有使用者在看，一個
「猜得很有把握」的結果會讓 session 開在他沒有指名的 repo 裡，而他不會知道。

**顯示名稱可能重複**（它取自路徑的最後一段），因此以絕對路徑為目標 SHALL 是一條可用的脫困
路徑，且該形式 SHALL 出現在告知 agent 的內容中 —— 否則歧義是一個 agent 無從化解的死路。

目標等於來源是合法的，SHALL 正常處理。

#### Scenario: 以名稱完整相等命中

- **WHEN** workspace 中有名為 `billservice` 的 folder，一則交接的目標為 `BillService`
- **THEN** 解析結果為該 folder

#### Scenario: 名稱僅為前綴時不命中

- **WHEN** workspace 中有名為 `billservice` 的 folder，一則交接的目標為 `bill`
- **THEN** 該則交接被拒絕，且不建立任何 session

#### Scenario: 兩個同名的 folder 使解析拒絕

- **WHEN** workspace 中有兩個顯示名稱相同的 folder，一則交接以該名稱為目標
- **THEN** 該則交接被拒絕，其說明列出兩個候選
- **AND** 不建立任何 session

#### Scenario: 以絕對路徑化解歧義

- **WHEN** 承上，其後一則交接以其中一個 folder 的絕對路徑為目標
- **THEN** 解析結果為該 folder

#### Scenario: 目標等於來源

- **WHEN** 一則交接的目標與其來源為同一個 folder
- **THEN** 該 folder 中建立一個新的 agent session
