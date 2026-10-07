## MODIFIED Requirements

### Requirement: 對話框或選單開啟時入口不生效

**文件中任一處**有對話框或選單正在等待使用者的裁決時，`Ctrl+P` SHALL 為無操作，且該按鍵 SHALL
照常抵達該對話框或選單。

**作用域是整份文件，不是 side panel 的子樹。** 兩種情形各自把一半的範圍變成必要：

- side panel 的檔案操作對話框（新增檔案與重新命名的命名對話框、刪除確認）與右鍵選單**渲染於側欄
  的 DOM 子樹之內** —— 使用者正在為一個新檔案命名時按下 `Ctrl+P`，本能力的觸發條件恰好成立。
- A dialog rendered at the top of the document (the inbox and conversation-metrics overlays, the
  Settings dialog) can be open while focus is still inside the side panel — any dialog that does not
  take focus when it opens leaves it there. The trigger condition then holds while the screen is
  covered by something else. A check limited to the side panel's subtree would open the entry under
  that dialog. (The Graph / Timeline overlay was the first such case; it is gone — Graph and
  Timeline are now views of the maximized side panel, see `openspec-panel` — and the rule does not
  depend on any particular dialog existing.)

判定 SHALL 以對話框與選單的無障礙角色（`dialog` / `menu`）之存在為準，SHALL NOT 逐一列舉特定的
對話框 —— 此為 `keyboard-navigation` 既有的同一條判定紀律，**兩者 SHALL 使用相同的判準與相同的
作用域**，否則會在「哪些東西算是在等待裁決」上分歧。

#### Scenario: 命名對話框開啟時按下快捷鍵

- **WHEN** side panel 的檔案命名對話框開啟中、焦點位於其輸入欄位，使用者按下 `Ctrl+P`
- **THEN** 快速開啟的入口未出現，對話框維持開啟

#### Scenario: 全視窗 overlay 開啟時按下快捷鍵

- **WHEN** the inbox's full-window overlay is open, focus is inside the side panel, and the user
  presses `Ctrl+P`
- **THEN** the quick-open entry does not appear and the overlay stays open
