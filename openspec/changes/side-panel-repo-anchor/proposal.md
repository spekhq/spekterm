## Why

側欄（OpenSpec + Files）的來源綁死在 rail 的 focused folder 上。但這個 app 的主場是
agent，而 agent 的工作範圍不受 folder 邊界約束 —— 在一個 session 裡，`claude` 會自己 `cd`
到另一個 repo，或直接拿絕對路徑改另一個 repo 的檔。於是「我在 repo A 的 session 裡叫 claude
去改 repo B」時，側欄看不到 repo B 的 spec 與檔案；而要看 repo B，就得把 rail 的 focus 切過去
—— 那會**連 terminal 一起切走**，看不到正在 repo A 裡跑的那個 agent。

這不是 bug，是一個一直成立的巧合破掉了：在單 repo 的世界裡，「我正在駕駛的 agent 所在的 repo」
與「我想讀的 repo」永遠是同一個，於是可以用同一個 folder 表達兩者。agent 一旦跨 repo，這個巧合
就不再成立 —— 而「一邊駕駛 agent、一邊看著 spec 上下文」正是這個 app 存在的理由，那個上下文屬於
**agent**，不屬於 rail 上被點選的那一列。

## What Changes

- **側欄的來源與 rail 的 focus 解耦。** 側欄頂部新增一條**來源指示器**，顯示側欄當前呈現哪個
  repo，可下拉選擇 workspace 中的任一 folder。
- **側欄來源是 focused session 的屬性，切 session 就跟著那個 session 的記憶走。** 側欄永遠呈現
  focused session 的來源；terminal 那半照常隨 rail 的 focus 換。當來源指向非自己的 repo 時，
  來源列提供「回到自己的 repo」的一鍵捷徑。（不設「跟隨/釘住」切換鈕 —— session 掛在哪個 repo
  不隨 pty 的 cwd 浮動，「跟隨」退化為「釘在自己的 folder」，toggle 無事可做，見 design D1。）
- **側欄來源是 per-session 的狀態，且隨 session 一併落盤。** 每個 session 記住自己的側欄來源，
  它是既有 `anchoredChange` 的自然擴展 —— 錨定的粒度從「一個 change」放大為「一個 (repo, change)」，
  共用「側欄跟隨 focused session」這條既有的線。切換 focused session，側欄的來源與錨定一併跟隨。
  重開 app 時，比照 `anchoredChange` 一併還原 —— 上次側欄釘在哪個 repo，重建後仍在那裡。
- **沒有任何 session 時退回 folder 層。** 比照既有 `viewing` map 的處理 —— 錨定無處可去時，
  由 folder 持有側欄的檢視狀態。
- **OpenSpec 與 Files 兩個身分共用同一個側欄來源。** 切換身分不改變側欄看的是哪個 repo（Files
  的檔案樹是單一 repo 的階層結構，本來就一次只能呈現一個來源 —— 這也決定了側欄是「選一個 repo」
  而非「聚合多個 repo」）。

**不在本 change 範圍**（皆為使用者已裁決的後續）：rail 上「哪個 repo 剛有事」的弱訊號提示、
同一 repo 內多個 git worktree 的聚合、跨 repo 的全域 standup overlay，以及「側欄自動跟隨 agent
跑」（那需要把「哪個 session 改了哪個 repo」歸因，而 Linux 的 inotify 拿不到 pid —— 本 change
繞開這堵牆，改由手動釘住 + 人眼歸因）。

## Capabilities

### New Capabilities

- `side-panel-source`：側欄的來源選擇 —— 側欄呈現哪個 repo 的內容，獨立於 rail 的 focused
  folder。涵蓋來源指示器、下拉選取、「跟隨 / 釘住」切換，以及來源狀態的 per-session 歸屬
  （沿用「側欄跟隨 focused session」的既有語意）。

### Modified Capabilities

- `openspec-panel`：「側欄跟隨 focused session 的錨定 change」與「側欄資料隨檔案變更更新」
  兩條原本以**當前 folder** 為資料來源；改為以**側欄來源**為準（側欄來源可與 rail 的 focused
  folder 不同）。錨定的粒度由 change 擴展為 (repo, change)。
- `file-explorer`：「Files 身分呈現當前 folder 的檔案樹」改為呈現**側欄來源** repo 的檔案樹
  （側欄來源可與 rail 的 focused folder 不同）。
- `session-persistence`：session 的持久化狀態擴展，納入 per-session 的側欄來源 —— 重開 app 時
  比照 `anchoredChange` 一併還原。

## Impact

- **Renderer（主要）**：`MainStage` 目前把單一 `folder` prop 一路灌給 header、`SessionTabs`／
  `TerminalView`（駕駛）與 `SidePanel`（讀）；本 change 把「讀」那條路的來源改為 per-session 的
  側欄來源。`SidePanel` 需新增來源指示器；`OpenSpecPanel`／`FilesPanel` 的 `key` 與資料 hook
  改以側欄來源 folder 為準。`anchoredChange`／`viewing`／`anchorChange` 的語意隨之擴展。
- **Session 狀態**：`SessionState` 需承載側欄來源（per-session），並比照 `anchoredChange`
  一併落盤（`sessions.json`）與重建 —— `session-persistence` 的 requirement 隨之擴展。
- **主行程**：OpenSpec 與 Files 的資料供應本就以 `folderId` 定址、每個 folder 各自快取與監看；
  側欄來源指向另一個 folder 只是改變 renderer 送哪個 `folderId`，主行程的邊界與供應層不變。
- **驗收**：`probe:openspec` 與 `probe:files` 需涵蓋「側欄來源 ≠ focused folder」的情境；
  來源指示器的文案入字典（`ui-localization` 的既有紀律）。
