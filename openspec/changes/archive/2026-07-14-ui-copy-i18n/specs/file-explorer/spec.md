## MODIFIED Requirements

### Requirement: 每列呈現項目的種類與相對修改時間

檔案樹的每一列 SHALL 呈現該項目的名稱與相對修改時間（例如 `2 hours ago`）。相對時間 SHALL 於呈現層依當下時刻計算，SHALL NOT 由主行程提供已格式化的字串。

相對時間的 locale SHALL 取自 i18n 層當前的語言，SHALL NOT 硬編（見 `ui-localization`）——
檔案樹的每一列都在顯示它，locale 未一併改動時，一個全英文的介面裡會混入「3 分鐘前」。

項目 SHALL 以目錄優先、其次名稱的順序排列。

#### Scenario: 呈現相對修改時間

- **WHEN** 檔案樹呈現一個項目
- **THEN** 該列顯示其相對於當下的最後修改時間

#### Scenario: 相對時間以 UI 的語言呈現

- **WHEN** 檔案樹呈現一個最後修改於數小時前的項目
- **THEN** 該列的相對時間以英文呈現（如 `2 hours ago`）

#### Scenario: 目錄排在檔案之前

- **WHEN** 一個目錄同時含有子目錄與檔案
- **THEN** 所有子目錄排在所有檔案之前，各自再依名稱排序
