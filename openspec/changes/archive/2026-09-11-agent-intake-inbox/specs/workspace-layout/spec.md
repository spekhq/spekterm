## MODIFIED Requirements

### Requirement: 活動列呈現尚未實作的入口為停用狀態

活動列 SHALL 呈現雛型所定義的全部入口，並 SHALL 額外呈現一個開啟對話計量 overlay 的入口
（見 `conversation-insights`）。**尚未實作**的入口 SHALL 呈現為停用狀態，並說明其尚未可用，
SHALL NOT 於點擊後無聲無息。**已實作**的入口 SHALL 為可用狀態。

保留位置而非隱藏，是為了讓版面比例自第一天起就與雛型一致；標示停用而非靜默，是為了讓使用者知道那不是壞掉。

Settings 入口為**已實作**（開啟終端偏好設定介面，見 `terminal-preferences`）；對話計量入口為
**已實作**；**Handoffs 入口為已實作**（開啟收件匣 overlay，見 `agent-intake`）；尚未實作而維持
停用的入口為 Search。

> **Handoffs 入口的啟用不是對雛型的偏離，而是兌現它。** 雛型枚舉的入口集合中本來就有 Handoffs，
> 它此前為停用只因為背後的能力尚未存在。`agent-intake` 交付的正是 PRD §11 Phase 7 的
> 「本機 inbox」，因此把它接上是這個入口原本的用途。
>
> **收件匣採「活動列入口 ＋ 全視窗 overlay」的形狀，與對話計量同構。** 已排除的替代方案有二：
> **側欄的第三個身分** —— 側欄的身分被本 spec 定義為 OpenSpec 與 Files **兩個**互斥的身分，
> 且它們的座標都隸屬於當下選中的 folder，而收件匣的範圍是整個 workspace、且它的項目尚未歸屬
> 於任何 folder；**Settings 對話框的一個區段** —— Settings 是放旋鈕的地方，而收件匣是內容
> （對話計量當初也是以同一條理由排除它）。
>
> **routing 規則的編輯入口隨收件匣走，位於該 overlay 之內**，同樣不進 Settings 對話框 ——
> 它是這塊內容自己的設定，不是終端偏好的一部分（見 `intake-routing`）。

#### Scenario: 尚未實作的活動列入口

- **WHEN** 使用者檢視活動列中尚未實作的入口（Search）
- **THEN** 該入口呈現為停用狀態，並附有說明其尚未可用的提示

#### Scenario: 已實作的活動列入口

- **WHEN** 使用者檢視 Sessions、Settings、對話計量或 Handoffs 入口
- **THEN** 該入口為可用狀態

#### Scenario: 對話計量入口開啟 overlay

- **WHEN** 使用者觸發活動列的對話計量入口
- **THEN** 對話計量的全視窗 overlay 開啟

#### Scenario: Handoffs 入口開啟收件匣 overlay

- **WHEN** 使用者點擊 Handoffs 入口
- **THEN** 收件匣以全視窗 overlay 呈現
- **AND** 側欄的身分（OpenSpec／Files）不因此改變
