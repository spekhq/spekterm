## Why

**第三次 dogfooding 的回饋：「把 app 關掉然後重開，原本的 claude session 跟 shell session 都會消失不見。」**

消失的不只是 pty（那是必然 —— pty 的 master fd 由主行程持有，app 一死，slave 收到 SIGHUP，
底下的行程跟著死）。真正的問題是 **session 狀態是純記憶體的**（`sessions.tsx` 的 `useState`，
沒有任何持久化；`workspace.json` 只存 folder 清單）：於是「開過哪些 session、叫什麼名字、什麼
順序、錨定哪個 change」也一併蒸發。重開 app 面對的是一片空白，連「我上次在幹嘛」都無從得知。

而 claude 那一半其實**救得回來，只是現在白白丟掉了**：`claude` CLI 有 `--session-id <uuid>`
（session id 可由我們指定）與 `--resume <uuid>`（預設**沿用**原 id，`--fork-session` 才換新），
也就是說 spekterm 主行程那顆 `randomUUID()` 的 sessionId 可以直接**當成 claude 的對話 id**，
一對一綁死 —— 重開時 `--resume` 就真的把對話續回來。

這件事讓 app 當不成「工作台」：**使用者不敢關它。** 一個要跟 IDE 搶位置的殼，不能有這種性質。

## What Changes

- **新增 session 的持久化**：session 清單寫入 userData 的 `sessions.json`（比照 `workspace.json`：
  版本欄位 + 原子寫入 + 損毀隔離，任何讀取失敗都不得讓應用程式開不起來）。存的是使用者親手建立的
  事實 —— `folderId`、spawn 目標、**使用者取的名字**、順序、`ordinal`、**錨定的 change**；不存
  任何衍生狀態。
- **重開 app 時原樣重建 session 分頁**：名字、順序、錨定全部回來。
- **重建的 session 預設是「休眠」的，於首次被顯示時才 spawn** —— 於是重開 app 只會起**一個**
  claude（上次選中的 folder 的 focused session），不是 N 個一起搶 CPU。休眠是一個明確的呈現狀態，
  不是一塊空白的終端。
- **claude 目標真的續上對話**：建立時以 `claude --session-id <spekterm sessionId>` 啟動，重建時以
  `claude --resume <同一個 id>` 續接。失敗路徑乾淨（已實測：resume 一個不存在的 id 會印
  `No conversation found with session ID: …` 並 **exit 1**，**不會**默默開一個空對話 —— 所以不會有
  「以為續上了、其實 context 全空」的假象）。
- **shell 目標無從 resume，改為重生**：在**最後已知的 cwd**（不是初始 cwd —— 使用者 `cd` 過）
  重開一個新的 login shell。**shell 的狀態（環境變數、跑到一半的行程）是真的救不回來的**，這是
  本 change 明確接受的代價。
- **終端畫面（scrollback）快照與重播**：使用者看得到「上次做到哪」，而不是一塊空白的終端。
- **reload（`did-navigate`）之後 session 同樣重建** —— 現行行為是連同 pty 一起清光，重建機制順手
  把這個坑也填了。
- **PRD §11 路線圖新增「session 常駐」Phase**（落在 Phase 6 之後，編號待定），並記下 **tmux vs
  自寫 daemon 的取捨**。**本 change 明確不做常駐** —— 見下方「不做什麼」。

### 不做什麼（且理由要留下來）

**不讓 pty 活過 app 的生命。** 這不是偷懶，是一個架構層級的分界：**pty 的 master fd 必須有人
持有**，app 一死就沒人持有了。要讓 session 真的活著，就**必須有一個活過 app 的行程握著那個 fd**
—— 那正是 tmux／dtach／abduco 在做的事。它的代價是實在的：硬相依外部二進位（Windows 沒有 tmux）、
兩層 multiplexer 疊在一起（resize 協商、alternate screen、滑鼠模式，而且 **tmux 會攔截 OSC 0/2
標題**拿去當自己的 window name —— 我們整套 session 標題機制正是建立在 OSC 上），以及**把 Phase 4
立的「三路徑皆不留孤兒」不變式整個反轉**成「刻意留孤兒」，還得補上回收路徑，否則使用者機器上會
慢慢累積一堆還活著的殭屍 claude。

本 change 交付的重建**不動那條不變式**（舊 pty 照殺，重建開的是新 pty），風險低、涵蓋使用者痛點
的絕大部分。做完之後還缺的大概只剩「跑到一半的長行程死了」這一項 —— 到那時候再決定要不要付常駐
的代價，會是個資訊充分的決定，而不是現在猜。

## Capabilities

### New Capabilities

- `session-persistence`: session 跨「關閉並重新開啟應用程式」與「renderer 重新載入」存活 ——
  持久化使用者建立的 session 事實（folder、spawn 目標、名字、順序、錨定的 change）、重開時原樣
  重建分頁、claude 目標以穩定的對話識別碼續接、shell 目標於最後已知 cwd 重生、終端畫面以快照
  還原，以及持久化檔案自身的損毀韌性。

### Modified Capabilities

- `terminal-sessions`: 「session 的 pty **初始工作目錄 SHALL 為該 folder 的根目錄**」這條字面約束
  要放寬為「SHALL 落在該 folder 的**邊界內**」—— 新建的 session 仍為根目錄，**重建的 shell session
  為其最後已知的工作目錄**（取不到或越界則退回根目錄）。**邊界本身沒有鬆動**，鬆動的是「恆為根目錄」
  這個更強的字面條件；而且 cwd 由**主行程**追蹤與夾制，**renderer 依然沒有任何路徑詞彙**
  （「renderer SHALL 僅以 `folderId` 指定位置」完好無損）。

`terminal-sessions` 的其餘 requirement 全數維持 —— 尤其是**「不留孤兒行程」與「重新載入後的頁面
不接收先前 pty 的輸出」**：重建開的是**新的** pty，舊 pty 在關閉分頁／reload／關視窗三路徑上照樣
被終止。**這正是不做常駐所買到的**。

## Impact

**新增**
- `src/main/session-store.ts` —— `sessions.json` 的讀寫（版本 / 原子寫 / 損毀隔離），比照
  `workspace-store.ts`。
- 相依：`@xterm/addon-serialize`（把 xterm 的 buffer dump 成帶跳脫序列的字串）。

**修改**
- `src/main/terminal.ts` —— `create` 要能承載 claude 的對話識別碼與「續接 / 全新」兩種模式，
  以及 shell 的 cwd 覆寫（仍**只收 `folderId` 與受控的參數，不收任意路徑** —— 邊界語彙不能破）。
- `src/main/ipc/terminal.ts` —— 新的持久化 IPC；`did-navigate` 的清理與重建的接縫。
- `src/preload/index.ts` —— 白名單新增 method。**注意 `probe:shell` 有一道白名單守衛在等著**
  （它會列舉 `fs.*` / `openspec.*` / `folders.*` 的允許清單）。
- `src/renderer/src/shell/terminal/sessions.tsx` —— 狀態的初始來源改為持久化內容；變更時寫回。
- `src/renderer/src/shell/terminal/xterm.ts` —— serialize addon（renderer 只准這個模組碰 `@xterm/*`）。
- `docs/PRD.md` §11 —— 新增「session 常駐」Phase 與 tmux vs 自寫 daemon 的取捨紀錄。
  （§11 的 Phase 6 已有「持久化開啟的 tab / layout / 最近工作區」一句，需與本 change 對齊，
  避免兩處各說各話。）
- `scripts/probe-terminal.mjs` —— 重啟後 session 重建的驗收。
- `CLAUDE.md` —— 實測與踩雷。

**留給 design 的未決問題**（不在 proposal 裁決）
1. **重開時要不要自動 spawn？** 全部自動重生 / 分頁先以休眠態呈現（畫面是上次的 scrollback，
   使用者互動才真的 spawn）/ 只自動重生上次 focused 的那一個。
2. **`claude --resume` 在互動模式下會不會自己把過去的對話重新畫在終端上？** 若會，claude session
   就**不該**再重播我們存的 scrollback（會看到兩次）。**這條必須實測，不能推測。**
3. **cwd 怎麼追蹤？** Linux 可讀 `/proc/<pty.pid>/cwd`，但那是 Linux-only（macOS 沒有 `/proc`）。
   替代是 OSC 7，但不保證每個 shell 都送。跨平台的退路是什麼？
4. **已結束（`exited`）的 session 要不要持久化？**
5. **scrollback 快照的寫入時機與體積上限**（不能每次 `onData` 都寫檔 —— agent 一直在吐字）。
6. **使用者在 claude 裡 `/clear` 之後**，claude 內部會換一個新的 session id，我們存的 id 就指向
   清空前的對話 —— 重開時會把已清空的對話 resume 回來。這個邊角要怎麼處理（或明確接受）？
