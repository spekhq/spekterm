## ADDED Requirements

### Requirement: side panel 呈現 OpenSpec 與 Files 兩個同層互斥身分

主舞台的 repo header SHALL 提供切換 side panel 身分的入口。OpenSpec 與 Files 是 side panel 的兩個同層級、互斥的身分：任一時刻 SHALL 只顯示其中一個，且兩者 SHALL 與左側的主舞台其餘部分並存。

身分切換的行為以 `docs/workspace-mockup.html` 的 `#panel-switch` 為權威。

#### Scenario: 切換至 Files 身分

- **WHEN** 使用者於 repo header 觸發 Files 身分的入口
- **THEN** side panel 呈現 Files 身分的內容，OpenSpec 身分的內容不再顯示

#### Scenario: 一次只顯示一個身分

- **WHEN** 檢視 side panel
- **THEN** OpenSpec 與 Files 之中恰有一個身分的內容被呈現

#### Scenario: 當前身分於入口上可辨識

- **WHEN** 使用者檢視身分切換的入口
- **THEN** 當前顯示的身分於該入口上被明確標示

### Requirement: 收合狀態下觸發任一身分皆重新展開 side panel

side panel 處於收合狀態時，觸發任一身分的入口 SHALL 重新展開 side panel 並顯示該身分的內容。

#### Scenario: 收合後觸發身分入口

- **WHEN** side panel 已收合，使用者觸發 Files 身分的入口
- **THEN** side panel 重新展開並呈現 Files 身分的內容

### Requirement: OpenSpec 為條件式身分，Files 恆可用

當前選中的 folder 不含 `openspec/` 時，OpenSpec 身分的入口 SHALL 為停用狀態，且該狀態 SHALL 可被輔助技術辨識。Files 身分 SHALL 恆為可用。

這是「spek 以 OpenSpec 為核心，但版面不因缺少 OpenSpec 就殘廢」的體現 —— 使用者應在點擊之前就知道該 repo 只能以 Files 身分使用。

#### Scenario: 選中不含 openspec 的 folder

- **WHEN** 使用者選中一個不含 `openspec/` 的 folder
- **THEN** OpenSpec 身分的入口為停用狀態，Files 身分的入口為可用狀態

#### Scenario: 選中含 openspec 的 folder

- **WHEN** 使用者選中一個含有 `openspec/` 的 folder
- **THEN** OpenSpec 與 Files 兩個身分的入口皆為可用狀態

#### Scenario: 停用的身分不可被切換至

- **WHEN** 使用者觸發一個停用的身分入口
- **THEN** side panel 的當前身分不改變
