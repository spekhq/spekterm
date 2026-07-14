## 1. 主行程：folder 順序的權威與持久化

- [x] 1.1 `WorkspaceStore` 新增 `reorder(id, toIndex)`：以識別碼定位（**不是位置**，D5）、目標位置夾制於清單範圍、未知識別碼靜默返回（比照既有的 `remove`），變動後 `save()`（沿用既有的原子寫）
- [x] 1.2 `src/main/workspace-store.test.ts` 補測：重排改變順序且不改動 folder 內容、未知 id 為無操作、`toIndex` 越界（負數與超出長度）被夾制、重排後重新 `load()` 讀回新順序
- [x] 1.3 `src/main/ipc/folders.ts` 新增 `workspace:folders:reorder` handler：呼叫 store、回傳 `store.list()`，並沿用既有的 `branchServiceFor(...).sync()`

## 2. preload 與 renderer 的接縫

- [x] 2.1 preload 白名單新增 `folders.reorder(id, toIndex)`（`src/preload/index.ts` 與其型別）
- [x] 2.2 更新 `scripts/probe-shell.mjs` 的 `surplusFolderKeys` 允許清單 —— **它是一道守衛，不同步就會紅**（那正是它存在的目的）
- [x] 2.3 `useWorkspaceFolders` 新增 `reorderFolders(id, toIndex)`：呼叫 IPC 並以回傳的清單更新 state（`selectedId` 不動 —— 它是 id，不是位置，D4）

## 3. 拖曳排序（repo）

- [x] 3.1 `useDragReorder` 自 `shell/terminal/` 搬到 `shell/`（純檔案搬移，D7），更新 `SessionTabs.tsx` 與 `WorkspaceRail.tsx` 的 import
- [x] 3.2 `WorkspaceRail` 為 folder 清單接上第二個 `useDragReorder`（垂直軸）：`rectOf` 回傳**整個 `<li>`** 的 rect（含展開的 session 子列，D6），`onCommit` 換算成 `(id, toIndex)` 後呼叫 `reorderFolders`
- [x] 3.3 拖曳的 `onMouseDown` **只掛在 repo 的標題列**，不掛在 `<li>` 上 —— 否則於 session 子列按下會同時啟動兩個拖曳（D6）
- [x] 3.4 folder 列加上插入指示線與拖曳中的半透明（比照既有的 session 子列）

## 4. 游標（D8）

- [x] 4.1 `WorkspaceRail` 的 session 子列與 `SessionTabs` 的分頁：靜止游標由 `cursor-grab` 改為 `cursor-pointer`。**游標必須掛在使用者真正滑過的元素上** —— 分頁的 `role="tab"` 是一顆 `<button>`，它帶著 UA 的 `cursor: default`（Tailwind v4 的 preflight 不再改回 pointer），外層 wrapper 的 `cursor-pointer` 到不了它
- [x] 4.2 rail 的圖示鈕（▾／＋／✕）與「加入 folder」鈕同樣補上 `cursor-pointer`（它們坐在一列食指裡，自己卻是箭頭）
- [x] 4.3 拖曳進行中的 `grabbing` —— 見 7.4（最終改由 `body[data-dragging]` 全域覆蓋，不由呼叫端各自維護）

## 5. 排序快捷鍵

- [x] 5.1 `KeyboardNavigation` 新增 `Shift+↑↓`（移動選中的 repo）與 `Shift+←→`（移動 focused session）：純 Shift（`!ctrlKey && !altKey && !metaKey`），端點 **no-op 不循環**（D3），無選中／單一項目為無操作
- [x] 5.2 新增「可編輯文字讓路」的判準（D2）：焦點在 `.xterm` 之內 → **不算**可編輯文字，快捷鍵生效；否則焦點為 `input` / `textarea` / `contenteditable` → **完全不攔**（不 `preventDefault`、不 `stopPropagation`）。此判準**僅作用於排序快捷鍵**，導航快捷鍵不受影響
- [x] 5.3 更新 `KeyboardNavigation` 的模組註解（快捷鍵表、`Shift+arrow` 的 pty 代價與「claude agents view 是已知犧牲者」的前提與退路）

## 6. 驗收

- [x] 6.1 `probe:workspace`：拖曳 repo 改變 rail 順序（真滑鼠事件，`Input.dispatchMouseEvent`）；**fixture 必須有一個展開著 session 子列的 repo**，且驗「於 session 子列上拖曳只移動 session，repo 順序不變」（少了它，巢狀拖曳的 bug 會躲過整輪全綠）
- [x] 6.2 `probe:workspace`：重排後重啟 app，rail 以使用者排定的順序呈現（沿用既有的暫存 `--user-data-dir` profile）
- [x] 6.3 `probe:workspace`：rail 上 repo 列的靜止游標為 `pointer`（`getComputedStyle`）
- [x] 6.4 `probe:terminal`：分頁靜止游標為 `pointer`、拖曳進行中為 `grabbing`
- [x] 6.5 `probe:keyboard`：`Shift+↑↓` 移動 repo、`Shift+←→` 移動 session（且 rail 子列呈現相同新順序）、端點不循環、移動後仍為選中／focused
- [x] 6.6 `probe:keyboard`：焦點在終端時 `Shift+↑` 仍移動 repo，且**該按鍵未抵達 pty**（沿用既有的「回顯不含答案」判準）
- [x] 6.7 `probe:keyboard`：焦點在 side panel 編輯器時 `Shift+→` **仍選取文字**且順序不變 —— 判準需實測（Monaco 的選取不是 DOM selection；候選為 view overlay 的 `.selected-text`），並以**對照組**證明它有鑑別力（拿掉讓路的例外，這條必須變紅）
- [x] 6.8 `probe:keyboard`：對話框開啟時 `Shift+↓` 不排序
- [x] 6.9 六支 probe 全綠（`probe:shell` / `probe:workspace` / `probe:files` / `probe:terminal` / `probe:keyboard` / `probe:openspec`）—— `useDragReorder` 搬家與 `ContextMenu` 無關，但分頁列與 rail 的拖曳是 `probe:terminal` 的地盤，游標改動則跨 `probe:workspace` 與 `probe:terminal`

## 7. 獨立稽核抓到的（`/opsx:verify`）

- [x] 7.1 **拖曳的落點修正**（design D9）：`useDragReorder` 的 state 改存**插入點**（`insertAt`），提交時以 `commitIndex()` 換算（往下拖要補償「先移除」造成的位移）—— 修正前東西會落在指示線的**下一格**（把 repo 拖到第二個 repo 的下半部，它會飛到清單末端）
- [x] 7.2 末端拖得到：命中判定在游標落於所有中線之後時回 `count`（不是 `count - 1`），新增 `dropAtEnd` 供呼叫端在最後一個項目**之後**畫指示線
- [x] 7.3 無操作時不畫指示線（拖在自己原本的位置上）
- [x] 7.4 拖曳中的游標改由 `body[data-dragging]` + `index.css` 的 `!important` 規則覆蓋整棵子樹 —— 呼叫端各自維護三元式修不完（session 子列與 ▾／＋／✕ 都會在 repo 拖曳途中閃回食指）
- [x] 7.5 `useWorkspaceFolders.reorderFolders` 樂觀更新 —— 否則**連按 `Shift+↓` 會靜默丟失移動**（第二次按下時 `folders` 仍是舊的，算出同一個 `toIndex`，主行程視為無操作）
- [x] 7.6 spec 補上「拖曳的落點與插入指示線一致」（含「驗收 SHALL 以至少三個項目進行」——**兩個項目時這個 off-by-one 看不出來**，那正是它躲過既有驗收的原因）
- [x] 7.7 `probe:workspace`：落點的期望值改以**指示線語意**為準（拖到下一個 repo 的上半＝原地不動／下半＝插在它之後／最下方＝落到末端），**對照組已證明其鑑別力**（改回舊語意，四條如期變紅）
- [x] 7.8 `probe:terminal`：分頁列的拖曳補到**三個分頁**（兩個分頁測不出這個 bug —— 它就是這樣躲過每一輪全綠的）
- [x] 7.9 `probe:keyboard`：補上零覆蓋的兩條 scenario（只有一個 folder／只有一個 session 時，排序快捷鍵為無操作）
- [x] 7.10 `workspace-store.test.ts`：補 `NaN` 與非整數的目標位置
- [x] 7.11 proposal 的 Impact 與實作對齊（`reorder` 不另外廣播 `folders:changed`，比照 `add`／`remove`）

## 8. 收尾

- [x] 8.1 `npm test` 與 `npm run typecheck` 全綠
- [x] 8.2 更新 `CLAUDE.md` 的快捷鍵表（新增四顆鍵）與「三顆鍵，三種代價」一節（`Shift+arrow` 是第四種代價：**明知 claude 在用仍然拿走**，與 `Ctrl+T` 的前提正好相反）
