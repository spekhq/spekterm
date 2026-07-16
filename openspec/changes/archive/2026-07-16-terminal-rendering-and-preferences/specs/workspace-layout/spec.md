## MODIFIED Requirements

### Requirement: 活動列呈現尚未實作的入口為停用狀態

活動列 SHALL 呈現雛型所定義的全部入口。**尚未實作**的入口 SHALL 呈現為停用狀態，並說明其尚未可用，SHALL NOT 於點擊後無聲無息。**已實作**的入口 SHALL 為可用狀態。

保留位置而非隱藏，是為了讓版面比例自第一天起就與雛型一致；標示停用而非靜默，是為了讓使用者知道那不是壞掉。

Settings 入口為**已實作**（開啟終端偏好設定介面，見 `terminal-preferences`）；尚未實作而維持停用的入口為 Handoffs 與 Search。

#### Scenario: 尚未實作的活動列入口

- **WHEN** 使用者檢視活動列中尚未實作的入口（Handoffs 或 Search）
- **THEN** 該入口呈現為停用狀態，並附有說明其尚未可用的提示

#### Scenario: 已實作的活動列入口

- **WHEN** 使用者檢視 Sessions 或 Settings 入口
- **THEN** 該入口為可用狀態
