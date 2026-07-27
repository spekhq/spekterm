## MODIFIED Requirements

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
