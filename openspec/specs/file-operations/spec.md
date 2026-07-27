# file-operations Specification

## Purpose
TBD - created by archiving change file-editing-and-crud. Update Purpose after archive.
## Requirements
### Requirement: 檔案樹提供新增、重新命名與刪除的入口

Files 身分 SHALL 提供於當前 workspace folder 內新增檔案、新增目錄、重新命名與刪除項目的入口。

入口 SHALL 亦可用於空目錄與**當前選定工作目錄的根**（見 `side-panel-worktree`）—— 該處沒有可供
操作的項目列，因此 SHALL NOT 僅以項目列上的操作作為唯一入口。

**此處的「根」一律指當前呈現之樹的根，SHALL NOT 恆為 folder 的根目錄。** 選定某個工作目錄之後，
於根發起的新增若落在 folder 根，新項目不會出現在當下可見的樹中 —— 使用者看到的是「按了沒反應」，
而那同時違反本能力的「操作的結果反映於檔案樹」。邊界不因此改變：工作目錄的根仍位於當前 workspace
folder 之內。

`docs/workspace-mockup.html` 對檔案操作的入口沒有表態（其 `.file-row` 為靜態且 `cursor: default`），因此入口的形式由本規格定義。

#### Scenario: 於項目上發起操作

- **WHEN** 使用者於檔案樹的一個項目上觸發操作入口
- **THEN** 呈現新增檔案、新增目錄、重新命名與刪除的可用選項

#### Scenario: 於空目錄中新增

- **WHEN** 使用者展開一個空目錄並觸發新增
- **THEN** 新項目建立於該目錄之下

#### Scenario: 於選定工作目錄的根新增

- **WHEN** 使用者選定某個 linked worktree，並自面板的根層入口新增一個檔案
- **THEN** 該檔案建立於該 worktree 的根目錄之下，並出現在當下可見的樹上
- **AND** 該檔案未被建立於 folder 的根目錄

### Requirement: 刪除必須經過明確確認

刪除 SHALL 在執行之前要求使用者明確確認。確認 SHALL 指出將被刪除的項目，且於目標為目錄時 SHALL 指出其為遞迴刪除。

刪除 SHALL NOT 提供以「稍後可復原」為前提的略過確認路徑 —— 本能力不提供復原。

#### Scenario: 刪除檔案前確認

- **WHEN** 使用者對一個檔案觸發刪除
- **THEN** 於實際移除之前要求確認，取消時該檔案不被移除

#### Scenario: 刪除非空目錄前指出其遞迴性

- **WHEN** 使用者對一個含有子項目的目錄觸發刪除
- **THEN** 確認的內容指出該目錄之下的項目將一併被移除

### Requirement: 名稱於建立之前被驗證並呈現失敗的原因

新增與重新命名 SHALL 於執行之前驗證名稱。名稱不合法或目標已存在時 SHALL NOT 執行，並 SHALL 呈現具體的原因。

介面的驗證 SHALL NOT 取代主行程的驗證。

#### Scenario: 名稱已被使用

- **WHEN** 使用者以一個同目錄下已存在的名稱新增檔案
- **THEN** 不建立任何項目，介面指出該名稱已存在

#### Scenario: 名稱不合法

- **WHEN** 使用者以一個含有路徑分隔符的名稱新增檔案
- **THEN** 不建立任何項目，介面指出該名稱不合法

#### Scenario: 取消新增

- **WHEN** 使用者發起新增之後取消
- **THEN** 磁碟上不出現任何新項目

### Requirement: 操作的結果反映於檔案樹

新增、重新命名與刪除成功之後，檔案樹 SHALL 反映其結果，且 SHALL NOT 要求使用者手動重新整理。

#### Scenario: 新增後出現於樹上

- **WHEN** 使用者於一個已展開的目錄中新增一個檔案
- **THEN** 該檔案出現在樹上對應的位置

#### Scenario: 刪除後自樹上消失

- **WHEN** 使用者刪除一個項目
- **THEN** 該項目自樹上消失

### Requirement: 刪除或改名一個有未存變更的檔案時提示

刪除或重新命名一個有未存變更的檔案之前，SHALL 告知使用者該檔案有未存的變更。

刪除該檔案之後，其未存的變更 SHALL 被一併捨棄 —— 其目標已不存在。重新命名之後，未存的變更 SHALL 跟隨新的路徑。

#### Scenario: 刪除有未存變更的檔案

- **WHEN** 使用者刪除一個有未存變更的檔案
- **THEN** 確認的內容指出該檔案有未存的變更；確認後該檔案被移除，其未存的變更一併消失

#### Scenario: 重新命名有未存變更的檔案

- **WHEN** 使用者重新命名一個有未存變更的檔案
- **THEN** 該檔案以新名稱存在，其未存的變更仍在且對應到新的名稱

