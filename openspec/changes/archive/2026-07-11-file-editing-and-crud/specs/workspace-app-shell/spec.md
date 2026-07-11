## ADDED Requirements

### Requirement: 編輯器不引入任何語言服務 worker

renderer 的建置產物 SHALL NOT 包含任何語言服務 worker（TypeScript、JSON、CSS、HTML）。編輯器在本應用程式中承擔的是語法高亮，不是語意分析 —— PRD §6.2 明訂深度改檔走 agent 或使用者自己的 IDE，編輯器不是主編輯區的一級公民。

語言服務 worker 是編輯器體積的主要來源，其中 TypeScript 語言服務單獨即超過整個其餘產物。明文禁止，以免日後為了單一便利而讓它悄悄回到產物中。

#### Scenario: 建置產物不含語言服務 worker

- **WHEN** 檢視 renderer 的正式建置產物
- **THEN** 其中不存在 TypeScript、JSON、CSS 或 HTML 的語言服務 worker 資產

#### Scenario: 語法高亮不依賴語言服務

- **WHEN** 於檔案檢視中開啟一個 TypeScript 檔案
- **THEN** 其語法元素被賦予不同的呈現樣式，且未載入任何語言服務 worker

#### Scenario: 編輯內容不觸發語意診斷

- **WHEN** 使用者於編輯器中輸入一段語法正確但型別錯誤的 TypeScript
- **THEN** 編輯器不呈現任何型別診斷，亦未載入語言服務 worker

### Requirement: 視窗關閉前確認未存的變更

視窗關閉時，若存在任何未存的變更，主行程 SHALL 阻止關閉並要求使用者明確選擇：儲存全部、不儲存並關閉、或取消。未存的變更 SHALL NOT 因視窗關閉而被靜默捨棄。

此判斷 SHALL 於關閉事件中同步完成，SHALL NOT 依賴一次向 renderer 的往返查詢 —— renderer 若未能回應，等同於靜默捨棄，而那正是本 requirement 要防止的。

確認 SHALL 以作業系統的原生對話框呈現。其內容包含使用者 repo 中的檔案路徑，且此刻 renderer 正處於即將關閉的狀態。

#### Scenario: 有未存變更時阻止關閉

- **WHEN** 存在至少一個有未存變更的檔案，使用者關閉視窗
- **THEN** 視窗不關閉，並呈現要求選擇處置方式的原生對話框

#### Scenario: 選擇取消

- **WHEN** 使用者於該對話框中選擇取消
- **THEN** 視窗保持開啟，未存的變更仍在

#### Scenario: 選擇不儲存並關閉

- **WHEN** 使用者於該對話框中選擇不儲存並關閉
- **THEN** 視窗關閉，磁碟上的檔案不被修改

#### Scenario: 沒有未存變更時直接關閉

- **WHEN** 不存在任何未存的變更，使用者關閉視窗
- **THEN** 視窗直接關閉，不呈現任何對話框

## REMOVED Requirements

### Requirement: 唯讀檢視不引入任何語言服務 worker

**Reason**: 該 requirement 的標題與其理由（「唯讀檢視只需要語法標記，不需要語意分析 —— 使用者無法於此處修正編輯器回報的任何診斷」）都建立在檢視為唯讀之上。本 change 使檢視可編輯，該理由不再成立。

**結論仍然成立，只是根據不同**：編輯器在此承擔的是語法高亮，深度改檔走 agent 或使用者自己的 IDE（PRD §6.2）。

**Migration**: 由 `## ADDED Requirements` 中的「編輯器不引入任何語言服務 worker」承接。兩條既有 scenario 完整保留，並新增「編輯內容不觸發語意診斷」—— 可編輯之後，這條約束需要一個在編輯情境下成立的驗收。`npm run measure:bundle` 的閘門不變。
