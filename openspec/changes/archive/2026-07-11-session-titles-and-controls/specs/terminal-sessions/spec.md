## ADDED Requirements

### Requirement: session 的標籤反映 pty 設定的終端標題

pty 內執行的程式 SHALL 能決定其 session 的標籤：程式送出設定終端標題的序列（OSC）時，該 session 在 UI 上的每一處呈現（分頁與 rail 子列）SHALL 以該標題為標籤。

session 的身分因此由**跑在裡面的東西**宣告，而不是由本應用程式的流水號決定 —— 這正是終端模擬器讓分頁自動改名的同一個機制。

pty 從未設定標題（或設定為空）時，標籤 SHALL 退回一個由 spawn 目標與序號組成的本地標籤。

標籤過長時 SHALL 截斷呈現，且**完整標題 SHALL 仍可自該元素的提示取得** —— 截斷是呈現上的取捨，不是資料的遺失。

#### Scenario: pty 設定標題後標籤隨之更新

- **WHEN** 一個 session 的 pty 內的程式送出設定終端標題的序列
- **THEN** 該 session 於分頁與 rail 子列的標籤更新為該標題

#### Scenario: pty 未設定標題時退回本地標籤

- **WHEN** 一個 session 的 pty 從未設定終端標題
- **THEN** 該 session 的標籤為由其 spawn 目標與序號組成的本地標籤

#### Scenario: 過長的標題被截斷但不遺失

- **WHEN** pty 設定了一個超出可呈現長度的標題
- **THEN** 標籤以截斷後的形式呈現，且完整標題可自該元素的提示取得
