## Why

這個 app 的日常姿勢是「**多個 repo，每個 repo 幾個 agent session**」，而使用者在它們之間移動的頻率極高。
目前**唯一**的移動方式是滑鼠：點分頁列、點 rail。一個以終端為主場的工作台沒有鍵盤導航，等於逼使用者
在打字與抓滑鼠之間反覆切換 —— 這正是終端模擬器與編輯器一律提供分頁快捷鍵的原因。

同時，session 的標籤在 login shell 上是**壞的**：shell 會以 OSC 序列宣告 `kewang@host:/長長的/路徑`，
對使用者零資訊量（那是 shell 的預設 prompt 標題，不是「這個 session 在幹嘛」）。更糟的是它**比 session
晚一秒多才抵達**：分頁先以 `shell 1`（約 60px）呈現，標題一到就暴增到約 210px，把緊鄰其後的
「+ session」入口往右推 **150px** —— 使用者正要點下去時，按鈕從游標底下跳走。這不是理論：
`probe:openspec` 正是因此點空而紅了整個 Phase 5（誤診為「選單壞了」，見 CLAUDE.md）。

## What Changes

**鍵盤導航（新能力）**

- `Ctrl+Tab` / `Ctrl+Shift+Tab` —— 於**當前 repo 內**切換至下一個／上一個 session。依**分頁的位置序**
  （非 MRU），可循環。位置序是使用者自己拖曳排出來的，只有它可預測。
- `Ctrl+↓` / `Ctrl+↑` —— 切換至 rail 上的下一個／上一個 repo，可循環。
- 切換 repo 時，focused session 落在該 repo **最後聚焦過**的那一個。此行為**不限鍵盤** —— 以滑鼠點
  rail 切換 repo 時同樣適用，否則會出現「鍵盤會還原、滑鼠不會」的分裂。
- 這些快捷鍵 SHALL 在**終端持有焦點時**仍然生效（那是常態），因此攔截必須早於 xterm 把按鍵寫進 pty，
  也必須早於 Monaco 吃掉按鍵。
- 對話框（session 命名、標題衝突、未存提示）開啟時 SHALL NOT 生效 —— 那些畫面正在等鍵盤輸入。

**session 標籤（修改既有行為）**

- **BREAKING（對既有 spec 而言）**：pty 以 OSC 宣告的標題**僅對 `claude` spawn 目標生效**。
  login shell 的 session 一律使用本地標籤（`shell 1`、`shell 2`…）。
- 使用者親自命名仍然**最優先**，兩種 spawn 目標皆然 —— 命名權的歸屬不變。
- 因為 shell 不再採用 pty 的標題，「手動命名後 pty 改名須經確認」對 shell session **不再有觸發條件**；
  該要求的適用範圍縮至 `claude` 目標。
- 分頁**不限寬**（已決定）。跳動的根因是「標籤內容突變」，不是「分頁沒有上限」；拿掉 shell 的 OSC
  標題就從源頭解決了它。`claude` 宣告的標題本來就短且有意義。

## Capabilities

### New Capabilities

- `keyboard-navigation`：以鍵盤在 session 與 repo 之間移動。涵蓋按鍵綁定、**攔截順序**（早於 xterm 與
  Monaco）、對話框開啟時的抑制，以及切換 repo 時 focused session 的落點。

### Modified Capabilities

- `terminal-sessions`：「session 的標籤反映 pty 設定的終端標題」的適用範圍**縮至 `claude` spawn 目標**；
  login shell 一律用本地標籤。「手動命名後，pty 的改名須經使用者確認」隨之只對 `claude` 目標有觸發條件。
- `workspace-layout`：新增「切換當前 repo 時，focused session 落在該 repo 最後聚焦過的 session」。
  此前任何 spec 都未規定切換 repo 後的焦點落點。

## Impact

**程式碼**

- 新增一個鍵盤綁定模組（`window` 的 **capture** 階段 keydown），接上既有的 `useWorkspaceFolders.select`
  與 `SessionsApi.focus`。
- `src/renderer/src/shell/terminal/sessions.tsx` —— `setTitle()` 對 login shell 的 session 直接忽略
  pty 宣告的標題（該處是 OSC 標題進入狀態的唯一入口，見 design D4）。
- `src/renderer/src/shell/files/dialogs.tsx` —— 補上 `role="dialog"`（既有的無障礙缺口，同時是
  「對話框開啟時抑制快捷鍵」的判定依據，見 design D5）。
- **per-repo「最後聚焦的 session」不需要新狀態** —— `SessionsProvider` 的 `focused` 本來就是
  `Map<folderId, sessionId>`，`focusedIdFor()` 的行為正好就是本 change 要求的（見 design D6）。
  此處只是把一個**已存在但從未被寫進 spec 的行為**釘住並補上驗收。

**驗收（必須連帶處理，否則是假綠）**

- `probe:terminal` 現有的「pty 宣告標題」「命名權衝突」測試**全部以 login shell session 送 OSC 序列來測**。
  本 change 一旦生效，那些測試就失去載體 —— 它們會「通過」，但通過的是「標籤沒變」這個新行為，
  **而不是它們自稱在測的東西**。必須改以 `claude` 目標的 session 承載；環境沒有 `claude` 時
  SHALL 明確跳過並印出原因，**不得靜默視為通過**。
- 新增 `probe:keyboard`（或併入 `probe:terminal`）驗鍵盤導航 —— 且**必須送真的按鍵事件**，
  斷言終端持有焦點時快捷鍵仍然生效、且該按鍵**沒有**被寫進 pty。

**取捨（詳見 design）**

- `Ctrl+↑/↓` 在終端協定裡**送得出去**（`CSI 1;5A` / `CSI 1;5B`），攔截它等於從 pty 內的程式手上
  **永久沒收**這個按鍵。實測：zsh 與 bash 預設皆未綁定；唯一的犧牲者是 **tmux**（`prefix + C-Up/C-Down`
  的 pane resize 與 copy-mode 捲動）。`Ctrl+Tab` 則相反 —— 它在標準終端編碼下**根本送不出去**，
  拿走它對 pty 零損失。
