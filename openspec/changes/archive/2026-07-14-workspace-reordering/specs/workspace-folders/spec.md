## ADDED Requirements

### Requirement: folder 的順序由使用者決定

workspace 的 folder 順序 SHALL 可由使用者重排。清單的順序**就是** rail 上的呈現順序 —— 它不是
某個視圖的裝飾，而是 workspace 狀態的一部分。

重排 SHALL 只改變順序：SHALL NOT 新增、移除或改動任何 folder 的內容。

重排的目標 SHALL 以 folder 的**識別碼**指定，SHALL NOT 僅以其在清單中的位置指定。folder 清單的
權威在主行程，renderer 手上是一份經推送的複本，且該複本隨時可能被更新（分支變動、folder 被移除）
—— 一個飛行中的位置索引可能已經指向**另一個** folder，而以識別碼定位時，最壞情況只是落點偏一格，
不會**移錯一個 repo**。

不存在的識別碼 SHALL 為無操作；越界的目標位置 SHALL 被夾制於清單範圍內。兩者皆 SHALL NOT 產生
錯誤，也 SHALL NOT 使清單損毀。

#### Scenario: 重排改變清單順序

- **WHEN** 使用者將清單中第三個 folder 重排至第一個位置
- **THEN** 清單以新的順序呈現，且其中的 folder 與內容皆未改變

#### Scenario: 重排後的順序立即落盤

- **WHEN** 使用者重排 folder 的順序
- **THEN** 持久化的 workspace 設定檔即以新的順序保存

#### Scenario: 未知的識別碼為無操作

- **WHEN** 以一個不存在於清單中的識別碼要求重排
- **THEN** 清單不變，且應用程式不產生錯誤

#### Scenario: 越界的目標位置被夾制

- **WHEN** 以一個超出清單範圍的目標位置要求重排
- **THEN** 該 folder 被移至清單的端點，且應用程式不產生錯誤

## MODIFIED Requirements

### Requirement: workspace 設定持久化並於重啟後還原

workspace 的 folder 清單 SHALL 持久化於使用者資料目錄，且 SHALL 於應用程式重新啟動後還原，順序與**使用者排定的順序**一致。

> 此處原本要求「順序與**加入時**一致」—— 在 folder 的順序尚不可變動的年代，那兩者是同一件事。順序成為使用者可決定的狀態之後，權威是使用者排定的順序，而不是加入的先後。

設定檔 SHALL 帶有版本欄位，供日後的結構變更辨識。寫入 SHALL 為原子操作 —— 先寫入暫存檔再更名，使中途失敗只會留下舊內容或新內容，不會留下不完整的檔案。

#### Scenario: 重啟後還原清單

- **WHEN** 使用者加入數個 folder 後重新啟動應用程式
- **THEN** workspace 清單包含相同的 folder，順序一致

#### Scenario: 重啟後還原使用者排定的順序

- **WHEN** 使用者重排 folder 的順序後重新啟動應用程式
- **THEN** rail 以使用者排定的順序呈現這些 folder，而非加入的先後

#### Scenario: 設定檔帶有版本欄位

- **WHEN** 檢視持久化的 workspace 設定檔
- **THEN** 其中含有一個標示結構版本的欄位

#### Scenario: 寫入過程不留下不完整的設定檔

- **WHEN** workspace 設定被寫入
- **THEN** 目標設定檔在任一時刻的內容，要嘛是寫入前的完整內容，要嘛是寫入後的完整內容
