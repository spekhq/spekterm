## MODIFIED Requirements

### Requirement: folder 的順序由使用者決定

workspace 的 folder 順序 SHALL 可由使用者重排。清單的順序**就是** rail 上各 folder 的**相對**呈現
順序 —— 它不是某個視圖的裝飾，而是 workspace 狀態的一部分。

**rail 另有不屬於此清單的固定項目**（`global-session` 的全域項目，位於所有 folder 之前）。因此
清單的索引與 rail 的列位置**相差一位**，兩者 SHALL NOT 被當成同一個座標系使用：重排的位置計算
SHALL 以本清單為基準。以 rail 列位置計算會使每一次重排都落錯一格，而**該錯誤在 workspace 只有
兩個 folder 時觀察不到** —— 越界的目標位置會被下述夾制拉回末端，結果與正確實作相同。

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

#### Scenario: 清單不含 rail 的固定項目

- **WHEN** 檢視 workspace 的 folder 清單
- **THEN** 其中不含代表全域項目的任何條目，且其索引與 rail 的列位置不相等
