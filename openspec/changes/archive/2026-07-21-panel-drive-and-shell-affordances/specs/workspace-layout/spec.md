## ADDED Requirements

### Requirement: 主視窗於三欄版面之下呈現一列狀態列

renderer SHALL 於活動列、rail 與主舞台三個區域**之下**呈現一列狀態列，橫跨主視窗的整個寬度，
高度固定。

狀態列 SHALL NOT 受 side panel 的收合、任一分界的拖動或當前身分的切換影響而消失或改變高度 ——
它是版面的一部分，不隸屬於任何一欄。其呈現的內容由 `status-bar` 能力定義。

`docs/workspace-mockup.html` 已定義此列（`.statusbar`）的位置與形式，UI 以該雛型為權威。

#### Scenario: 啟動後狀態列與三個區域並存

- **WHEN** 應用程式啟動並完成 renderer 載入
- **THEN** 狀態列存在於活動列、rail 與主舞台之下，且橫跨整個視窗寬度

#### Scenario: 收合 side panel 後狀態列不受影響

- **WHEN** 使用者收合 side panel
- **THEN** 狀態列仍然存在，且高度不變

### Requirement: 選單以滑鼠選取項目後即關閉

選單（`ContextMenu` 及其所有使用處）在使用者**以滑鼠觸發其中一個項目**之後 SHALL 關閉。

關閉 SHALL 由選單自身在項目被觸發時完成，SHALL NOT 倚賴「該次點擊冒泡至 window 後由關閉外部
點擊的監聽器順帶關掉」這條路徑 —— 該路徑在「項目的動作使上層元件於**同一次事件中**重新
render」時會失效（React 對受信任的離散事件同步 flush effect，重新註冊的監聽器排到下一個
tick，該次點擊冒泡至 window 時已無人監聽）。側欄的來源下拉即屬此種情形。

選單 SHALL 同時維持既有的關閉方式：點選單以外之處、按 `Esc`。

#### Scenario: 選取項目後選單關閉（動作觸發上層重新 render）

- **WHEN** 使用者於側欄的來源下拉中選取一個 folder
- **THEN** 側欄來源改為該 folder
- **AND** 該下拉選單關閉

#### Scenario: 選取項目後選單關閉（動作不觸發上層重新 render）

- **WHEN** 使用者於任一選單中觸發一個項目
- **THEN** 該選單關閉

#### Scenario: 點選單以外之處仍關閉選單

- **WHEN** 選單開啟中，使用者點擊選單以外的區域
- **THEN** 該選單關閉
