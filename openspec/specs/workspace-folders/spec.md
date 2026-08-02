## Purpose

workspace 的 folder 清單 —— 以原生對話框加入、移除、持久化於使用者資料目錄並於重啟還原，
含去重與失效路徑處理，以及每個 folder 是否含 `openspec/` 的偵測結果。
這是整個工作台的狀態根，也是檔案系統信任邊界的定義來源。
## Requirements
### Requirement: 以原生對話框將 folder 加入 workspace

使用者 SHALL 能透過作業系統的原生目錄選擇對話框，將一個目錄加入 workspace。加入後該 folder SHALL 立即出現於 workspace 清單。

folder 的路徑 SHALL 以解析 symlink 後的真實路徑保存。清單 SHALL NOT 含有重複的 folder —— 判定以真實路徑為準，因此同一個目錄經由不同的 symlink 路徑加入時視為同一個。

#### Scenario: 加入一個新目錄

- **WHEN** 使用者於原生對話框選擇一個目錄並確認
- **THEN** 該 folder 出現於 workspace 清單

#### Scenario: 取消對話框

- **WHEN** 使用者關閉原生對話框而未選擇任何目錄
- **THEN** workspace 清單不變

#### Scenario: 同一目錄不因 symlink 而重複加入

- **WHEN** 使用者加入一個目錄，其後再加入一個指向該目錄的 symlink 路徑
- **THEN** workspace 清單中該 folder 只出現一次

### Requirement: 自 workspace 移除 folder

使用者 SHALL 能將 folder 自 workspace 清單移除。移除 SHALL 只影響 workspace 設定，SHALL NOT 更動磁碟上的任何檔案或目錄。

#### Scenario: 移除後清單與磁碟的狀態

- **WHEN** 使用者移除一個 folder
- **THEN** 該 folder 自 workspace 清單消失，且磁碟上對應的目錄仍然存在

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

### Requirement: 設定檔損毀不得阻止應用程式啟動

當 workspace 設定檔無法解析、版本無法辨識，或結構不符預期時，應用程式 SHALL 以空的 workspace 正常啟動。原始檔案 SHALL 被保留（改名而非刪除），供使用者事後救回。

設定檔損毀導致應用程式打不開，是最糟的失敗模式；此要求明確排除它。

#### Scenario: 設定檔內容不是有效的 JSON

- **WHEN** 設定檔的內容無法解析，而後啟動應用程式
- **THEN** 應用程式正常啟動、workspace 清單為空，且原始檔案以另一個名稱保留於同一目錄

#### Scenario: 設定檔的版本無法辨識

- **WHEN** 設定檔的版本欄位不是應用程式認得的值，而後啟動應用程式
- **THEN** 應用程式正常啟動、workspace 清單為空，且原始檔案以另一個名稱保留

### Requirement: 路徑失效的 folder 保留於清單並標示

當還原的 folder 其路徑已不存在或不再是目錄時，該 folder SHALL 保留於 workspace 清單並標示為失效，SHALL NOT 被靜默移除。應用程式 SHALL 正常啟動。

靜默移除會讓使用者在外接磁碟未掛載時失去整份 workspace 設定。

#### Scenario: 還原時目錄已不存在

- **WHEN** 一個已加入的 folder 於應用程式關閉期間被刪除或移動，而後啟動應用程式
- **THEN** 該 folder 仍在清單中並被標示為失效，應用程式正常啟動

### Requirement: 偵測 folder 是否含有 openspec 目錄

每個 folder SHALL 標示其是否含有 `openspec/` 目錄。此標示 SHALL 為衍生狀態 —— 於加入 folder 時與每次載入 workspace 時重新判定，SHALL NOT 持久化於設定檔。

判定 SHALL 以單次檔案系統查詢完成。它 SHALL NOT 執行完整的 OpenSpec 掃描，亦 SHALL NOT 呼叫任何外部程式。

#### Scenario: folder 含有 openspec 目錄

- **WHEN** 加入一個含有 `openspec/` 目錄的 folder
- **THEN** 該 folder 被標示為含有 OpenSpec

#### Scenario: openspec 存在但不是目錄

- **WHEN** 加入一個其中 `openspec` 是一般檔案的 folder
- **THEN** 該 folder 被標示為不含 OpenSpec

#### Scenario: 標示隨磁碟內容更新而非沿用舊值

- **WHEN** 一個原本不含 `openspec/` 的 folder 於應用程式關閉期間被建立了該目錄，而後啟動應用程式
- **THEN** 該 folder 被標示為含有 OpenSpec

#### Scenario: 偵測不觸發外部程式

- **WHEN** 加入一個含有 `openspec/` 與 git 歷史的 folder
- **THEN** 主行程未為此偵測 spawn 任何外部程式

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

#### Scenario: 重排後的順序立即落盤

- **WHEN** 使用者重排 folder 的順序
- **THEN** 持久化的 workspace 設定檔即以新的順序保存

#### Scenario: 未知的識別碼為無操作

- **WHEN** 以一個不存在於清單中的識別碼要求重排
- **THEN** 清單不變，且應用程式不產生錯誤

#### Scenario: 越界的目標位置被夾制

- **WHEN** 以一個超出清單範圍的目標位置要求重排
- **THEN** 該 folder 被移至清單的端點，且應用程式不產生錯誤

