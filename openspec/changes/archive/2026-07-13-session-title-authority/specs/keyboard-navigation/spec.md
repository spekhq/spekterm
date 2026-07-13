## MODIFIED Requirements

### Requirement: 對話框或選單開啟時導航快捷鍵不生效

導航快捷鍵 SHALL NOT 於任一對話框或選單開啟期間生效。對話框（session 命名、檔案操作的命名與刪除確認、Graph／Timeline 的全視窗 overlay、未存變更的提示）與選單（spawn 選單、右鍵選單）正在等待使用者的裁決 —— 否則使用者會在回答問題的同時把畫面切走，而選單的方向鍵導覽也會被導航快捷鍵搶走。

判定 SHALL 以對話框與選單的無障礙角色（`dialog` / `menu`）之存在為準，**SHALL NOT 逐一列舉特定的對話框** —— 任何遵守該慣例的新對話框皆自動被尊重。此規則的失效模式因此不是判定邏輯出錯，而是**某個對話框漏了該角色標記，於是靜默地不被尊重**；驗收 SHALL 因此以**多種不同的對話框**各驗一次，而非只驗一種。

#### Scenario: 命名對話框開啟時按下導航快捷鍵

- **WHEN** session 的命名對話框開啟中，使用者按下 `Ctrl+Tab`
- **THEN** focused session 不變，對話框維持開啟

#### Scenario: 全視窗 overlay 開啟時按下導航快捷鍵

- **WHEN** Graph 或 Timeline 的全視窗 overlay 開啟中，使用者按下切換 repo 的導航快捷鍵
- **THEN** 選中的 folder 不變，overlay 維持開啟

#### Scenario: 選單開啟時按下導航快捷鍵

- **WHEN** spawn 選單開啟中，使用者按下 `Ctrl+Tab`
- **THEN** focused session 不變，選單維持開啟
