## MODIFIED Requirements

### Requirement: 使用者可替 session 命名，且優先於 pty 宣告的標題

使用者 SHALL 能替任一 session 指定名稱，**不分 spawn 目標**。session 標籤的取用順序 SHALL 為：**使用者指定的名稱 > 交接的標題（僅由交接建立的 session，見 `handoff-brief`）> pty 宣告的終端標題（僅 `claude` 目標）> 由 spawn 目標與序號組成的本地標籤**。

**交接的標題為空或只含空白時不參與取用順序。** **交接的標題高於 pty 宣告的標題**：由交接建立的 session 以固定名字啟動，而固定名字會把 pty 宣告的標題釘成那個名字（`agent-peer-name`）—— 讓 pty 標題勝出，等於讓交接的標題永遠不被看見。**交接的標題 SHALL NOT 被寫成使用者指定的名稱**，否則清空名稱無法回到它。

**指定名稱 SHALL 視為使用者永久接管該 session 的命名權。** 此後 pty 送出設定終端標題的序列時，該標題 SHALL NOT 覆蓋使用者指定的名稱，且系統 SHALL NOT 因此呈現任何確認或提示 —— 該標題被靜默地不予呈現。

此規則**不因 pty 送出的標題與先前是否相同而異**：pty 反覆宣告同一個標題，與宣告一連串不同的標題，處理方式相同 —— 皆不呈現、不打斷。

**pty 宣告的標題 SHALL 於使用者接管期間持續被記錄**（僅不呈現）。

使用者將名稱清空 SHALL 視為放棄命名權：由交接建立的 session 標籤**立即**回到交接的標題；其餘 `claude` 目標的 session 標籤**立即**回到 pty **最近一次**宣告的標題（含接管期間所宣告者；pty 從未宣告過時則為本地標籤），login shell 的 session 則回到本地標籤。

#### Scenario: 命名後標籤採用使用者指定的名稱

- **WHEN** 使用者替一個 session 指定名稱
- **THEN** 該 session 於分頁與 rail 子列的標籤皆為該名稱

#### Scenario: 命名後 pty 宣告不同的標題不打斷使用者

- **WHEN** 一個已被使用者命名的 `claude` session，其 pty 送出一個與該名稱不同的終端標題
- **THEN** 不呈現任何對話框或提示，且該 session 的標籤維持使用者指定的名稱

#### Scenario: 命名後 pty 反覆宣告標題仍不打斷使用者

- **WHEN** 一個已被使用者命名的 `claude` session，其 pty 連續送出多個終端標題（含與先前相同者）
- **THEN** 全程不呈現任何對話框或提示，且該 session 的標籤始終維持使用者指定的名稱

#### Scenario: claude session 清空名稱後立即回到 pty 最近宣告的標題

- **WHEN** 使用者將某個 spawn 目標為 `claude`、非由交接建立、且其 pty 曾於接管期間宣告過標題的 session 的名稱清空
- **THEN** 該 session 的標籤**立即**變為 pty 最近一次宣告的標題，不需等待 pty 再次宣告

#### Scenario: claude session 清空名稱後回到跟隨 pty

- **WHEN** 使用者將某個 spawn 目標為 `claude`、非由交接建立的 session 的名稱清空
- **THEN** 該 session 的標籤回到 pty 宣告的標題（pty 未宣告時則為本地標籤）

#### Scenario: login shell 的 session 清空名稱後回到本地標籤

- **WHEN** 使用者將某個 spawn 目標為 login shell 的 session 的名稱清空
- **THEN** 該 session 的標籤回到本地標籤（`shell N`），即使其 pty 曾宣告過標題

#### Scenario: 由交接建立的 session 清空名稱後回到交接的標題

- **WHEN** 使用者將一個由交接建立、交接標題為 T 的 session 的名稱清空，其 pty 曾宣告過標題
- **THEN** 該 session 的標籤**立即**變為 T

#### Scenario: 交接的標題不被 pty 宣告的標題蓋過

- **WHEN** 一個由交接建立、交接標題為 T 的 session，其 pty 宣告一個終端標題
- **THEN** 該 session 的標籤仍為 T
