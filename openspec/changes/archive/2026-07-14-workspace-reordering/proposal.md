## Why

**session 的順序可以由使用者決定，repo 的順序不行。** rail 上的 repo 一律照「加入的先後」排列，
而那個順序是**一次性的偶然**（哪天想到就加哪個），與使用者實際的注意力分配無關 —— 手邊在推的
repo 可能排在第五個，一個半年沒動的 repo 卻永遠佔著第一列。`workspace.json` 的陣列順序就是呈現
順序，但 renderer 沒有任何入口能改動它。

**而排序這件事目前只有滑鼠一條路。** session 的拖曳排序（`workspace-layout`）沒有鍵盤對應
—— 這與這個 app 的前提相衝突：終端幾乎永遠持有焦點，使用者的手在鍵盤上，`Ctrl+Tab` / `Ctrl+↑↓`
已經讓他不必碰滑鼠就能在 repo 與 session 之間穿梭，唯獨「把這個東西往上挪一格」得把手從鍵盤上
拿開、瞄準一個幾十像素高的列、按住、拖、放。

第四次 dogfooding 的回饋。

## What Changes

- **repo 的順序可由使用者拖曳調整**（rail 上）。插入點以**整個 repo 區塊**判定 —— 包含它展開時
  底下的 session 子列，因為那正是使用者眼中「這個 repo 佔的地盤」。
- **repo 的順序落盤並於重啟後還原** —— `workspace.json` 的陣列順序即呈現順序（它本來就是，只是
  沒有東西能改動它）。新增 `folders.reorder` IPC。
- **新增兩顆排序快捷鍵**：
  - `Shift+↑` / `Shift+↓` —— 把**選中的 repo** 在 rail 上往上／往下移動一格。
  - `Shift+←` / `Shift+→` —— 把**當前 repo 的 focused session** 在分頁列上往左／往右移動一格。
- **排序快捷鍵在「可編輯文字持有焦點」時讓路** —— 這是排序快捷鍵**獨有**的例外，導航快捷鍵沒有
  （既有的 requirement 明文要求「編輯器持有焦點時快捷鍵仍生效」）。理由：`Shift+arrow` **就是**
  文字選取鍵，攔下它，側欄 Monaco 與對話框輸入框裡的選取會**整個消失**。而**終端不算可編輯文字**
  —— xterm 的輸入路徑雖然是一個隱形的 `<textarea>`，但終端是這個 app 的主場，快捷鍵在它上面必須
  生效（既有 requirement 已如此要求）。這道判準因此不能寫成「activeElement 是不是 textarea」。
- 移動到端點時**不循環**（no-op）。這與導航快捷鍵的「可循環」**刻意不同** —— 見 design。
- **可拖曳項目的游標統一為 `pointer`（食指），只有拖曳進行中才是 `grabbing`。** 現況是 session
  子列與分頁列靜止時為 `grab`（張開的手），而 repo 列是 `pointer` —— 兩者都是「可點擊也可拖曳」的
  東西，游標卻不一致。`grab` 宣告的是「這裡只能拖」，但這些項目**點一下是有作用的**（切換 focused
  session／選中 repo），而那才是使用者最常做的事。repo 列這次也要變成可拖曳，這條規則因此必須一次
  講清楚，否則新的拖曳能力會把不一致再擴散一次。

## Capabilities

### New Capabilities

（無 —— 三個既有 capability 各長出新的 requirement，沒有新的能力邊界。）

### Modified Capabilities

- `workspace-layout`: 新增「repo 的順序可由使用者拖曳調整」，並為既有的「session 的順序可由使用者
  拖曳調整」補上**游標的呈現契約**（靜止 `pointer`、拖曳中 `grabbing`）—— 它同時約束 repo 與
  session 兩種項目。
- `workspace-folders`: 新增「folder 的順序由使用者決定並持久化」—— 重排後寫回 `workspace.json`，
  重啟後照該順序還原。
- `keyboard-navigation`: 新增「以鍵盤調整 repo 的順序」與「以鍵盤調整 session 的順序」兩條
  requirement，以及一條「排序快捷鍵於可編輯文字持有焦點時不生效」的例外（它是既有的「編輯器持有
  焦點時快捷鍵仍生效」的**受限例外**，只作用於排序快捷鍵）。

## Impact

**主行程**
- `workspace-store.ts`：重排 folder 的順序並落盤（沿用既有的原子寫與版本欄位）。
- IPC：新增 `workspace:folders:reorder`，回傳重排後的清單（比照 `add` / `remove` —— 發起的
  renderer 拿回傳值即可，不另外廣播）。

**preload**
- 白名單新增 `folders.reorder`。**`probe:shell` 的白名單守衛在等著** —— 它逐一列舉允許出現的
  method（`folders.*` 的守衛是 `repo-branch` 那次才補上的），加能力不同步就會紅。

**renderer**
- `useDragReorder`：現居 `shell/terminal/`，但 repo 排序與 terminal 無關 —— 提升到 shell 層共用。
- `WorkspaceRail.tsx`：folder 列接上拖曳（與既有的 session 子列拖曳並存，兩者不得互相誤觸），
  session 子列的靜止游標由 `grab` 改為 `pointer`。
- `SessionTabs.tsx`：分頁的靜止游標由 `grab` 改為 `pointer`。
- `useWorkspaceFolders.ts`：新增 `reorderFolders`。
- `KeyboardNavigation.tsx`：新增 `Shift+arrow` 四顆鍵與「可編輯文字讓路」的判準。

**pty 的代價（採用 `Shift+arrow` 的前提）**
- `Shift+arrow` 送得出去（`CSI 1;2A`–`D`），攔下它等於從 pty 裡的程式手上**永久沒收**這顆鍵。
  實測 **zsh 與 bash 皆未綁定**；**已知的犧牲者是 `claude` 自己的 agents view**（使用者確認它用
  `Shift+↑↓`）—— 使用者已在知情下裁決採用，理由與退路見 design。

**驗收**
- `probe:workspace`：repo 拖曳改變順序、順序跨重啟還原、rail 上可拖曳項目的靜止游標為 `pointer`。
- `probe:terminal`：分頁的靜止游標為 `pointer`、拖曳進行中為 `grabbing`（`getComputedStyle` 直接
  可觀察，不需要任何測試鉤子）。
- `probe:keyboard`：四顆鍵各驗一次、端點不循環、按鍵不流進 pty、**焦點在編輯器時 `Shift+arrow`
  仍是文字選取**（這條是新例外的對照組，少了它等於沒驗）。
- `npm test`：workspace-store 的重排（含越界索引）。
