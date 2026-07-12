# terminal-sessions Specification（delta）

## MODIFIED Requirements

### Requirement: session 的標籤反映 pty 設定的終端標題

**spawn 目標為 `claude` 的 session**，其 pty 內執行的程式 SHALL 能決定該 session 的標籤：程式送出設定終端標題的序列（OSC）時，該 session 在 UI 上的每一處呈現（分頁與 rail 子列）SHALL 以該標題為標籤。

session 的身分因此由**跑在裡面的東西**宣告，而不是由本應用程式的流水號決定 —— 這正是終端模擬器讓分頁自動改名的同一個機制。

**spawn 目標為 login shell 的 session SHALL NOT 採用 pty 宣告的標題**，一律使用由 spawn 目標與序號組成的本地標籤（`shell 1`、`shell 2`…）。login shell 宣告的標題是它的預設 prompt 標題（`使用者@主機:/路徑`），對使用者不具識別意義；且它比 session 本身晚抵達，採用它會使分頁的寬度在使用者眼前突變，把緊鄰其後的建立入口推離游標。

pty 從未設定標題（或設定為空）時，標籤 SHALL 退回一個由 spawn 目標與序號組成的本地標籤。

標籤過長時 SHALL 截斷呈現，且**完整標題 SHALL 仍可自該元素的提示取得** —— 截斷是呈現上的取捨，不是資料的遺失。

#### Scenario: claude session 的 pty 設定標題後標籤隨之更新

- **WHEN** 一個 spawn 目標為 `claude` 的 session，其 pty 內的程式送出設定終端標題的序列
- **THEN** 該 session 於分頁與 rail 子列的標籤更新為該標題

#### Scenario: login shell 的 session 不採用 pty 宣告的標題

- **WHEN** 一個 spawn 目標為 login shell 的 session，其 pty 送出設定終端標題的序列
- **THEN** 該 session 的標籤**維持**本地標籤（`shell N`），不因該標題而改變

#### Scenario: pty 未設定標題時退回本地標籤

- **WHEN** 一個 session 的 pty 從未設定終端標題
- **THEN** 該 session 的標籤為由其 spawn 目標與序號組成的本地標籤

#### Scenario: 過長的標題被截斷但不遺失

- **WHEN** 一個 spawn 目標為 `claude` 的 session，其 pty 設定了一個超出可呈現長度的標題
- **THEN** 標籤以截斷後的形式呈現，且完整標題可自該元素的提示取得

### Requirement: 使用者可替 session 命名，且優先於 pty 宣告的標題

使用者 SHALL 能替任一 session 指定名稱，**不分 spawn 目標**。session 標籤的取用順序 SHALL 為：**使用者指定的名稱 > pty 宣告的終端標題（僅 `claude` 目標）> 由 spawn 目標與序號組成的本地標籤**。

使用者將名稱清空 SHALL 視為放棄命名權：`claude` 目標的 session 標籤回到跟隨 pty 宣告的標題，login shell 的 session 則回到本地標籤。

#### Scenario: 命名後標籤採用使用者指定的名稱

- **WHEN** 使用者替一個 session 指定名稱
- **THEN** 該 session 於分頁與 rail 子列的標籤皆為該名稱

#### Scenario: claude session 清空名稱後回到跟隨 pty

- **WHEN** 使用者將某個 spawn 目標為 `claude` 的 session 的名稱清空
- **THEN** 該 session 的標籤回到 pty 宣告的標題（pty 未宣告時則為本地標籤）

#### Scenario: login shell 的 session 清空名稱後回到本地標籤

- **WHEN** 使用者將某個 spawn 目標為 login shell 的 session 的名稱清空
- **THEN** 該 session 的標籤回到本地標籤（`shell N`），即使其 pty 曾宣告過標題

### Requirement: 手動命名後，pty 的改名須經使用者確認

本要求 SHALL 僅適用於 **spawn 目標為 `claude` 的 session** —— login shell 的 session 不採用 pty 宣告的標題，因此不存在「pty 想改名」這個情境。

使用者已替某 `claude` session 指定名稱之後，pty 再送出設定終端標題的序列時，該標題 SHALL NOT 靜默覆蓋使用者指定的名稱。系統 SHALL 呈現確認，讓使用者於兩者之間裁決：

- **採用 pty 的名稱**：使用者指定的名稱 SHALL 被清除，標籤改用該標題，且此後 pty 的改名 SHALL NOT 再需要確認（命名權已交還）。
- **保留使用者的名稱**：該次標題 SHALL 被忽略，標籤維持使用者指定的名稱；pty 其後若再送出不同的標題，SHALL 再次請求確認。

**同一時間 SHALL 至多只有一個待確認的標題。** pty 在確認尚未被裁決時又送出新標題，SHALL 取代原本待確認的那個，SHALL NOT 產生第二個確認 —— 否則頻繁改名的 agent 會把使用者的畫面淹沒。

#### Scenario: pty 於手動命名後改名時請求確認

- **WHEN** 一個已被使用者命名的 `claude` session，其 pty 送出一個不同的終端標題
- **THEN** 呈現確認，且該 session 的標籤仍為使用者指定的名稱（尚未被覆蓋）

#### Scenario: 採用 pty 的名稱後不再詢問

- **WHEN** 使用者於確認中選擇採用 pty 的名稱，其後 pty 再送出另一個標題
- **THEN** 標籤直接更新為新的標題，不再呈現確認

#### Scenario: 保留使用者的名稱

- **WHEN** 使用者於確認中選擇保留自己的名稱
- **THEN** 標籤維持使用者指定的名稱，該次 pty 的標題被忽略

#### Scenario: 待確認的標題至多一個

- **WHEN** 確認尚未被裁決時，pty 又送出另一個不同的標題
- **THEN** 待確認的標題被取代為最新的那一個，且確認仍只有一個

#### Scenario: 已命名的 login shell session 不因 pty 的標題而請求確認

- **WHEN** 一個已被使用者命名的 login shell session，其 pty 送出一個不同的終端標題
- **THEN** 不呈現任何確認，且標籤維持使用者指定的名稱
