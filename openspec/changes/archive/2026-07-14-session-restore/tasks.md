## 1. 相依與持久化層

- [x] 1.1 加入相依 `@xterm/addon-serialize`（版本對齊 `@xterm/xterm` 6）
- [x] 1.2 新增 `src/main/session-store.ts`：`sessions.json` 的讀寫 —— 版本欄位、原子寫入（`.tmp` → `rename`）、整份損毀時 `quarantine` 成 `sessions.json.corrupt-<ISO>` 並以空清單啟動（比照 `workspace-store.ts`）
- [x] 1.3 `session-store` 的逐項驗證：`id` / `claudeSessionId` 必須是嚴格 UUID、`spawnTarget` 必須是列舉值之一、`folderId` 必須對應已加入的 folder；**單項不合法只丟棄該項**，其餘照常回傳
- [x] 1.4 scrollback 快照的落盤：每個 session 一個檔 `<userData>/sessions/<id>.scrollback`（檔名的 `id` 必須先通過 UUID 驗證）；關閉 session 時刪除；啟動時清掉沒有對應 session 的孤兒快照檔
- [x] 1.5 `src/main/session-store.test.ts`：版本不符 / 解析失敗 / 單項欄位不合法 / 非 UUID 的 id / 孤兒快照清理 —— 各一條

## 2. 主行程：續接、自癒與 cwd

- [x] 2.1 `terminal.ts` 的 `create` 擴充：claude 目標可指定「新建對話（`--session-id <uuid>`）」或「續接對話（`--resume <uuid>`）」；uuid 在拼進 `$SHELL -l -c` 之前**必須**通過 UUID 驗證（design D8）
- [x] 2.2 shell 目標的 cwd 覆寫：接受一個由**主行程自己**提供的工作目錄，並以既有的 `isWithin` 夾制於 folder 邊界內；越界或取不到 → 退回 folder 根目錄。**`create` 仍不接受來自 renderer 的任何路徑**
- [x] 2.3 cwd 追蹤：`readlink /proc/<pty.pid>/cwd`（Linux，零外部行程）；`/proc` 不存在時優雅降級為「無最後 cwd」→ 喚醒時用 folder 根目錄
- [x] 2.4 續接失敗的自癒：pty 在 T 秒內以非零碼結束 → 判定為續接失敗 → 以**全新** uuid 重新 spawn `--session-id`，並回報新的對話識別碼供持久化；**至多重試一次**，且**不解析 claude 的輸出**（只看時間與結束碼）
- [x] 2.5 `terminal.test.ts`（或等價的單元測試）：UUID guard 擋下被竄改的識別碼、cwd 夾制、自癒只重試一次

## 3. IPC 與 preload 白名單

- [x] 3.1 `src/main/ipc/terminal.ts`：新增 session 持久化的 IPC —— renderer 送出 session 清單（**payload 不含任何路徑**）、renderer 送出 scrollback 快照、renderer 啟動時取回重建所需的資料
- [x] 3.2 主行程對 metadata 寫入做 debounce（~500ms），並在落盤前自行補上 cwd（renderer 不提供、也無從提供）
- [x] 3.3 `src/preload/index.ts` 白名單新增對應 method
- [x] 3.4 同步更新 `scripts/probe-shell.mjs` 的白名單守衛（它會列舉允許的 method —— 不更新就會紅，且那道守衛正是為了讓「往白名單加能力」不會靜默通過）

## 4. renderer：休眠態、重建與快照

- [x] 4.1 `SessionState` 擴充：新增 `dormant` 狀態與 `claudeSessionId` 欄位（session 自身的 `id` **永不改變**，design D1）
- [x] 4.2 `SessionsProvider` 啟動時取回持久化內容並建立**休眠**的 session（分頁、名字、順序、錨定就位，但沒有 pty）
- [x] 4.3 首次被顯示時喚醒：休眠 session 於首次顯示時才呼叫 `create`。folder 路徑失效時保留 metadata 但不可喚醒
- [x] 4.4 狀態變更時把 session 清單送去持久化（建立 / 關閉 / 命名 / 排序 / 錨定 / 對話識別碼被自癒替換）；**已結束（`exited`）的 session 不送**
- [x] 4.5 scrollback：pty 有新輸出後 debounce 2 秒，以 `serialize({ scrollback: 1000 })` 產生快照並送往主行程；**只對 shell 目標**（claude 不存 —— design D3）；關閉視窗時做一次 best-effort flush（有 timeout，不阻塞關窗）
- [x] 4.6 重播：由 xterm 的 wrapper 自己處理（`replay()`），**完成後才 `attach()` 接上 live** —— 順序仍由既有的 backlog 機制保證（design D6，實作時修正：快照帶著終端模式與游標定位，不能只當成一段文字寫進去）
- [x] 4.7 分隔線的呈現：明確表達「以上是上次的內容，app 已重新啟動」（design D5 —— 這是誠實性，不是裝飾）
- [x] 4.8 休眠態的呈現：shell 顯示重播的歷史 + 可喚醒的提示；claude 顯示「休眠中 —— 顯示即恢復對話」的提示，**不得是一塊空白終端**
- [x] 4.9 實測並處理 alternate screen / mouse tracking 的殘留：`SerializeAddon` **會把終端模式一起序列化**（快照裡真的有 `?1049h`／`?1003h`），因此重播完會**站在 alternate buffer 裡**。修法是**條件式**送 `?1049l`（只在 `buffer.active.type === 'alternate'` 時）—— 無條件送會把游標拉回 (0,0) 而毀掉正常情況。`probe:terminal` 有一條專驗它的斷言，且**以對照組證明過它不是假綠**

## 5. 探針：stub claude 的續接行為

- [x] 5.1 擴充 `probe:terminal` 的 stub `claude`（PATH 上那支）：能記錄自己被呼叫時的 argv、能依 argv 模擬「續接成功（印出可辨識的歷史）」與「續接失敗（印出 `No conversation found` 並以非零碼結束）」兩種行為 —— **真的 claude 叫不動、也不該讓探針去啟動一個 Claude Code session**
- [x] 5.2 `probe:terminal` 新增：關閉並重新啟動 app（同一個 `--user-data-dir`）後，分頁、使用者取的名字、順序、錨定的 change 皆重建
- [x] 5.3 新增：重啟後**只有一個** session 有 pty（被選中 folder 的 focused session），其餘為休眠且無 pty；切過去顯示它 → pty 啟動
- [x] 5.4 新增：claude 目標以 `--session-id <uuid>` 新建、重建時以 `--resume <同一個 uuid>` 續接（由 stub 記錄的 argv 斷言）
- [x] 5.5 新增：**從未對話過**的 claude session 重建後自癒 —— stub 模擬續接失敗，斷言它以**另一個** uuid 被重新 spawn，且該 session 的名字 / 順序 / 錨定不變、仍可用；並斷言啟動嘗試**不超過兩次**
- [x] 5.6 新增：shell 目標於最後已知 cwd 重生（在 session 內 `cd` 到子目錄後重啟）；`cd` 到 folder 之外後重啟 → 退回根目錄
- [x] 5.7 新增：shell 的畫面重播可見，且與 live 內容有明確區分；claude 的歷史**不重複出現**
- [x] 5.8 新增：**強制結束（`kill -9`）** app 之後重開，shell session 仍有（略舊的）畫面 —— 這條擋住「只靠關窗時序列化」的實作
- [x] 5.9 新增：損毀韌性 —— 餵一份無法解析的 `sessions.json` → app 正常啟動、無 session、原檔被改名保留；餵一份「單項欄位不合法」的 → 其餘 session 照常重建
- [x] 5.10 新增：被竄改的 `claudeSessionId`（非 UUID）不得被拼進命令 —— 由 stub 記錄的 argv 斷言，且該 session 以全新對話重建

## 7. dogfooding 抓到的：pty 的環境（`session-restore` 實作後追加）

- [x] 7.1 `ptyEnv()`：spawn pty 前抹掉「巢狀 Claude Code」的標記（元兇為 `CLAUDE_CODE_CHILD_SESSION`，二分實測）—— 否則裡面的 claude 不寫 transcript，`--resume` 永遠失敗，而自癒會把這個失敗**掩蓋掉**（design D14）
- [x] 7.2 名單以明確列舉為之，**不以 `CLAUDE*` 前綴一概剝除**（`CLAUDE_CODE_OAUTH_TOKEN` 是認證用的）；兩種 spawn 目標皆適用
- [x] 7.3 `terminal.test.ts`：標記被抹掉、認證變數留下、其餘保留
- [x] 7.4 `XtermHandle.size()` + pty 誕生時推送尺寸：喚醒倒轉了「pty 先誕生、終端後掛載」的順序，導致 pty 停在 spawn 時的 80×24（design D15）—— 探針加了一條擋回歸的斷言，但**對照組證實它證明不了這個修正**，缺口由 code review 承擔

## 6. 文件與回歸

- [x] 6.1 `docs/PRD.md` §11 新增「session 常駐」Phase（落在 Phase 6 之後）：記下 **pty master fd 必須有人持有**這個物理事實、以及 **tmux vs 自寫 daemon** 的取捨（外部硬相依 / 雙層 multiplexer / tmux 攔截 OSC 0/2 標題 / 「不留孤兒」不變式反轉且需回收路徑）
- [x] 6.2 `docs/PRD.md` §11 Phase 6 那句「持久化開啟的 tab / layout / 最近工作區」與本 change 對齊，避免兩處各說各話
- [x] 6.3 `CLAUDE.md`：新增本 change 的實測與踩雷 —— `--session-id` 撞號會報錯（故 `--resume X || --session-id X` 是陷阱）、**沒對話過就沒有 transcript**（故續接失敗是主線而非例外）、session id 與對話 id 必須解耦、claude 不重播快照、磁碟上的識別碼是不受信任的輸入
- [x] 6.4 `npm run typecheck` 通過
- [x] 6.5 `npm test` 通過（含新增的 session-store 測試）
- [x] 6.6 回歸：`npm run probe:terminal`、`npm run probe:shell`、`npm run probe:keyboard`、`npm run probe:workspace`（dev 與 build 兩模式）
