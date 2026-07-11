## ADDED Requirements

### Requirement: 使用者可替 session 命名，且優先於 pty 宣告的標題

使用者 SHALL 能替任一 session 指定名稱。session 標籤的取用順序 SHALL 為：**使用者指定的名稱 > pty 宣告的終端標題 > 由 spawn 目標與序號組成的本地標籤**。

使用者將名稱清空 SHALL 視為放棄命名權，標籤回到跟隨 pty 宣告的標題。

#### Scenario: 命名後標籤採用使用者指定的名稱

- **WHEN** 使用者替一個 session 指定名稱
- **THEN** 該 session 於分頁與 rail 子列的標籤皆為該名稱

#### Scenario: 清空名稱後回到跟隨 pty

- **WHEN** 使用者將某 session 的名稱清空
- **THEN** 該 session 的標籤回到 pty 宣告的標題（pty 未宣告時則為本地標籤）

### Requirement: 手動命名後，pty 的改名須經使用者確認

使用者已替某 session 指定名稱之後，pty 再送出設定終端標題的序列時，該標題 SHALL NOT 靜默覆蓋使用者指定的名稱。系統 SHALL 呈現確認，讓使用者於兩者之間裁決：

- **採用 pty 的名稱**：使用者指定的名稱 SHALL 被清除，標籤改用該標題，且此後 pty 的改名 SHALL NOT 再需要確認（命名權已交還）。
- **保留使用者的名稱**：該次標題 SHALL 被忽略，標籤維持使用者指定的名稱；pty 其後若再送出不同的標題，SHALL 再次請求確認。

**同一時間 SHALL 至多只有一個待確認的標題。** pty 在確認尚未被裁決時又送出新標題，SHALL 取代原本待確認的那個，SHALL NOT 產生第二個確認 —— 否則頻繁改名的 agent 會把使用者的畫面淹沒。

#### Scenario: pty 於手動命名後改名時請求確認

- **WHEN** 一個已被使用者命名的 session，其 pty 送出一個不同的終端標題
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
