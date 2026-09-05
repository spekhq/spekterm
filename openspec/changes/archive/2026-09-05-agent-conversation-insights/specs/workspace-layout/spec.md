## MODIFIED Requirements

### Requirement: 活動列呈現尚未實作的入口為停用狀態

活動列 SHALL 呈現雛型所定義的全部入口，並 SHALL 額外呈現一個開啟對話計量 overlay 的入口
（見 `conversation-insights`）。**尚未實作**的入口 SHALL 呈現為停用狀態，並說明其尚未可用，
SHALL NOT 於點擊後無聲無息。**已實作**的入口 SHALL 為可用狀態。

保留位置而非隱藏，是為了讓版面比例自第一天起就與雛型一致；標示停用而非靜默，是為了讓使用者知道那不是壞掉。

Settings 入口為**已實作**（開啟終端偏好設定介面，見 `terminal-preferences`）；對話計量入口為
**已實作**；尚未實作而維持停用的入口為 Handoffs 與 Search。

> **對話計量入口是對 `docs/workspace-mockup.html` 的一次明示偏離。** 雛型枚舉了活動列的入口
> （Sessions／Handoffs／Search／Settings），本 requirement 原本把入口集合整個釘在雛型上 ——
> 因此加第五個入口**不是**雛型沉默之處的延伸（對照 `rail-pinned-repos` 的置頂段，那件事雛型
> 確實沒講過，故不構成偏離），而是**改變了雛型講過的一件事**，必須留下裁決紀錄。
>
> 裁決理由：對話計量的範圍是整個 workspace，不隸屬任何 folder、也不是側欄的座標之下的東西
> —— 活動列正是「不隸屬任何 repo 的全域入口」該在的位置。已排除的替代方案是放進 Settings
> 對話框：**Settings 是放旋鈕的地方，而這是內容**，兩者混在一起會讓 Settings 逐漸變成雜物間。

#### Scenario: 尚未實作的活動列入口

- **WHEN** 使用者檢視活動列中尚未實作的入口（Handoffs 或 Search）
- **THEN** 該入口呈現為停用狀態，並附有說明其尚未可用的提示

#### Scenario: 已實作的活動列入口

- **WHEN** 使用者檢視 Sessions、Settings 或對話計量入口
- **THEN** 該入口為可用狀態

#### Scenario: 對話計量入口開啟 overlay

- **WHEN** 使用者觸發活動列的對話計量入口
- **THEN** 對話計量的全視窗 overlay 開啟
