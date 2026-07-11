## Context

主舞台的左半邊到 Phase 3 為止還是一塊寫著「terminal（Phase 4）」的 placeholder。這個 change 把它換成真的能跑 agent 的多 session 終端。

三個既有事實構成本設計的地基：

- **Phase 0（`native-module-toolchain`）已證明 node-pty 能在 Electron 主行程 spawn 出真實 pty**（Node-API，免 `electron-rebuild`）。那是拋棄式驗證：spawn、讀一行、殺掉。本 change 把它產品化。node-pty 的 `spawn(file, args, { name, cols, rows, cwd, env, encoding })` 回傳 `IPty`；`encoding` 預設 `utf8`，故 `onData` 交付 `string`、`write` 吃 `string` —— 跨 IPC 傳字串即可。`IPty` 提供 `onData`/`onExit`（皆為 `IEvent`）、`resize(cols, rows)`、`kill(signal?)`、`pid`。
- **`WatchService` 是「主行程長生命週期資源 + IPC 推送 + 擁有者記帳」的既有範本，pty 管理器整套沿用。** 它不依賴 Electron（建構時注入 `send` callback 當出口，因此可由單元測試直接驅動）；擁有者記帳在 `ipc/fs.ts` 層——每個 `webContents` 一份 service，以 `webContents.id` 為 key；`webContents` `'destroyed'` → `dispose()`，`'did-navigate'` → 全清（reload 不銷毀 `webContents`）。
- **版面現況**：`MainStage` 已是「左 terminal ｜ 右 side panel」的水平 split（`react-resizable-panels`）；`WorkspaceRail` 的 `FolderRow` 巢狀結構已預留 session 子列（其註解明寫「Phase 4 加子層時不需重構」）。「session」這個層級在 renderer 尚不存在。

**約束**（沿用 CLAUDE.md）：驗收走 `scripts/probe-*.mjs`（CDP 連進真 app）與 `npm test`；不在產品程式碼塞測試分支、不為驗收在 UI 掛 `data-*`；程式碼英文、註解繁中。

## Goals / Non-Goals

**Goals：**

- 多個真 pty session，雙向串流、resize 時 pty 尺寸同步、生命週期不留孤兒行程。
- 主舞台頂部 session 分頁列 + rail 的 repo→session 子列（兩處呈現同一組 session）。
- 新 session 的 spawn 目標由使用者選：`claude` 或 login shell。
- login shell 模式可被 CDP probe 自動驗收（`pwd` 驗 cwd、`echo` 驗雙向、行程清理驗生命週期）。

**Non-Goals：**

- session 狀態燈的**真實 agent 語意**（`waiting`/`running`/`done`/`err`）：本 change 只反映 pty **存活／已結束**。
- session 分頁／rail 子列的 **change badge 真實錨定**（Phase 5）、**handoff tag**（Phase 7）。
- **持久化**：app 重啟不還原開了哪些 session、也不還原 scrollback（layout 持久化屬 Phase 6）。
- **把 terminal 當 fs 那樣的沙箱**（見 D5）—— 它給的是真 shell。

## Decisions

### D1. pty 管理器與 WatchService 同形：每 `webContents` 一份 `TerminalService`，`send` 為出口，擁有者記帳在 ipc 層

`TerminalService` 管理一份 `Map<sessionId, IPty>`，不 import Electron；建構時注入 `send`（推送 data/exit）。`ipc/terminal.ts` 以 `Map<webContents.id, TerminalService>` 記帳，比照 `ipc/fs.ts` 的 `serviceFor`。

**替代**：全域單一 manager，每個 pty 各記一個 `ownerId`。**否決**——與 watcher 不對稱、`destroyed → dispose` 要自己過濾擁有者，且更難單元測試。對稱於既有範本的價值高於「少一層 Map」。

### D2. reload（`did-navigate`）必須殺光該 `webContents` 的所有 pty，不只 `destroyed`

這是 Phase 2 watcher 那條教訓（「`did-navigate` 而非 `did-start-navigation`」）的直接類比，但後果更重：reload 不銷毀 `webContents`，若只在 `destroyed` 清理，**舊 pty 會變孤兒**，且**新頁面的 xterm 永遠收不到它們的 `onData`**（listener 綁在已消失的舊 renderer 上）。因此 `ipc/terminal.ts` 在 `did-navigate` 呼叫 `service.dispose()`（殺光並清空），與 `WatchService.unwatchAll()` 同源。

### D3. sessionId 由主行程產生

`create` 在主行程 spawn 成功後產生 id（`crypto.randomUUID()`）並回傳；renderer 之後以 id 做 `write`/`resize`/`kill`。pty 是主行程資源，其識別碼由擁有者發放——renderer 不該能捏造一個 id 去操作別的 pty（跨 `webContents` 本就隔離，同 `webContents` 內以主行程持有的 Map 為準）。

### D4. data 串流不 debounce、不重排；輸入 fire-and-forget

- **pty → renderer**：`onData` 的每個 chunk 立即 `contents.send('…:data', sessionId, chunk)`。**這是與 watcher 的關鍵差異**——watcher 有 50ms debounce（「十個檔案不該重繪十次」），但終端輸出**必須低延遲且嚴格保序**，任何合批或重排都會弄亂畫面。xterm 自身有寫入緩衝，交給它。
- **renderer → pty**：`write`/`resize`/`kill` 用 `ipcRenderer.send`（單向、不等回應），不用 `invoke`。逐鍵輸入若每次都等一次 round-trip 的回應是浪費。
- **例外**：`create` 用 `invoke`——它要回傳 sessionId，且 cwd 解析可能失敗（要結果物件）。

**風險**在 D「Risks」段（高頻輸出的 IPC 壓力）。

### D5. cwd 邊界由「只接受 folderId」在結構上保證；且明確地——這不是 fs 那種沙箱

- **本 change 的 `create` 只接受 `folderId`，不接受任何路徑**（連 `relPath` 都不傳）。cwd 恆為該 folder 的 root。於是 **renderer 在語彙上無從指定 workspace 之外的 cwd** —— 這比 `filesystem-access` 的 `(folderId, relPath)` 更收斂（連 `..` 逃逸的空間都沒有），主行程只需驗 `folderId` 存在且 `status === 'ok'`。未來若要「在子目錄開 session」，才需引入 `relPath` 並套用 `resolveWithinRoot`；那時邊界論證要重做。
- **這道邊界防的是「app 不會把 session 的初始 cwd 開在 workspace 之外」，不是「限制 pty 內的行為」。** pty 一旦啟動，使用者在其中可 `cd /` 、可執行任何命令——那正是終端的用途。**必須誠實區分**：`fs.*` 白名單是沙箱（renderer 只能碰 workspace）；terminal 給的是**真 shell 的真能力**，等同使用者自己開一個終端機。把它誤當沙箱，會在日後（例如評估 handoff auto-spawn 的信任邊界時）做出錯誤假設。PRD §12「terminal cwd 限制在已加入的 workspace folders」指的正是**初始 cwd**這一件事，本 change 完整滿足它，不多也不少。

### D6. 兩種 spawn 目標都經 `$SHELL -l` 啟動——因為 GUI app 常缺使用者 shell 的 PATH

- **login shell 模式**：`spawn($SHELL, ['-l'], …)`（`$SHELL` 缺時退 `/bin/bash`）。互動 login shell。
- **claude 模式**：`spawn($SHELL, ['-l', '-c', 'claude'], …)`。以 login shell 執行 `claude`；claude 退出後 session 隨之結束（語意正確：這個 session 就是為了跑 claude）。

**為什麼不直接 `spawn('claude')`**：桌面環境啟動的 GUI app，其 `process.env.PATH` 往往**不含**使用者在 `.zprofile`/`.bashrc` 裡設定的路徑（nvm、Homebrew、`~/.local/bin`），`claude` 會 `ENOENT`。透過 `$SHELL -l` 讓 login shell 先把完整環境載入，`claude`（及其所需的 `node`/API 設定）才找得到。env 傳 `{ ...process.env, TERM: 'xterm-256color' }`。

**替代**：用 `shell-env` 之類套件預先解析登入環境再 `spawn('claude')`。**否決**——多一個相依、且要處理跨平台差異；`$SHELL -l -c` 是 POSIX 慣用法，直接可用。Windows 的 `-l -c` 語意不同，列入 Risks 與 Phase 6 打包驗收。

### D7. 每個 session 一個常駐 xterm 實例，未 focused 以 `display:none` 隱藏，不 dispose

切換分頁**不卸載** Terminal——scrollback buffer 活在實例裡，卸載即遺失，重建也昂貴。未 focused 的 terminal 容器設 `display:none`。

**代價**：`display:none` 的元素不佈局，`FitAddon` 量到 0——因此**每次由隱藏轉為顯示時要重新 `fit()` 一次**（見 D8）。N 個 session＝N 個常駐實例，但每 repo 的 session 數本就少，且 xterm scrollback 有上限（預設 1000 行）。若未來變成問題，再做「閒置 session 卸載 + 主行程保存 scrollback」——本 change 不做。

**常駐的範圍是「所有 folder 的所有 session」，不只當前 folder（實作時修正）。** 主舞台只*顯示*當前 repo 的 session，但若只*掛載*當前 folder 的，切走再切回時 xterm 實例已被卸載，先前的 scrollback 就沒了 —— backlog（D16）只補得回「未顯示期間的新輸出」，補不回已經卸載的歷史。因此 `MainStage` 掛載 `sessions.all()`，由 `active` 決定顯示。

**替代**：單一 Terminal 實例，切換時清空重寫。**否決**——要主行程保存每個 session 的完整 scrollback 並在切換時重放，慢且複雜，違背「terminal 純淨、低延遲」。

### D8. fit 與 pty resize：`ResizeObserver` → `fit()` → 同步 rows/cols 回 pty

容器尺寸變化（分界拖動、視窗縮放、side panel 收合、由隱藏轉顯示）由 `ResizeObserver` 觸發：`FitAddon.fit()` 算出 cols/rows，再 `terminal.resize(sessionId, cols, rows)` 同步回 pty。**不同步的後果**：agent 以為終端是 80 欄、實際更寬，輸出會在錯誤位置換行。fit 做 debounce；尺寸未變則不送 resize（避免無謂的 `SIGWINCH`）。

### D9. session 狀態：renderer 持清單（AppShell 層），主行程持 pty 實例

- **renderer**：`SessionState = { id, folderId, spawnTarget: 'claude' | 'shell', status: 'running' | 'exited', exitCode?: number }` 的清單，持有於 `AppShell`（比照 `DirtyBuffersProvider`）——因為 session 綁 folder，切換 selected folder 不該讓清單消失，且 rail 要同時呈現**所有** folder 的 session。
- **focused**：`Map<folderId, sessionId>`——每個 repo 記住自己上次聚焦的 session。
- **主行程**：只持有 pty 實例與擁有關係，不知道 spawnTarget 的 UI 語意。`create` 回 id 建立兩邊對應；`onExit` 推送後 renderer 把該 session 標為 `exited`（**不自動移除**——使用者要看到「它結束了」，且可能想讀最後的輸出）。

### D10. 版面：分頁列插在 repo header 與 split-view 之間；只顯示 selected folder 的 sessions

- **頂部 session 分頁列**（`MainStage` 內、`Group` 之上）：呈現 selected folder 的 session、標示 focused、`+ session`、每個分頁可關閉。無 session 時顯示空狀態 + 明顯的 `+ session` 入口。
- **rail 子列**：`FolderRow` 之下渲染其 session 子列；點 session 子列＝選中該 folder 並將其設為 focused。
- **不自動開 session**（mockup 畫的是已有 session 的狀態）：spawn 目標需使用者選，替他決定跑 claude 在缺環境時體驗差；且 app 啟動不憑空開一堆 pty。這是刻意選擇。

### D11. preload 白名單 `workspace.terminal.*`

```
create(folderId, spawnTarget): Promise<FsResult<{ sessionId: string }>>   // invoke，cwd/spawn 失敗回 code
write(sessionId, data): void                                              // send
resize(sessionId, cols, rows): void                                       // send
kill(sessionId): void                                                     // send
onData(listener: (sessionId, chunk) => void): () => void                  // on + 回傳 unsubscribe
onExit(listener: (sessionId, exitCode) => void): () => void               // 同上
```

沿用 `onWatchEvent` 的訂閱形狀（`ipcRenderer.on` + 回傳解除函式，renderer 拿不到 `ipcRenderer` 本身）。`FsResult` 沿用既有結果物件（IPC 只保留 message，錯誤碼要靠結構帶）。此白名單受 `workspace-app-shell`「能力僅經由 preload 白名單暴露」通則約束，本 change 不放寬該通則。

### D12. 關閉分頁＝kill pty＋移除清單；已 exit 者只移除清單

`kill` 用預設 `SIGHUP`。分頁的關閉入口對 `running` 的 session 先 `kill` 再移除清單項；對 `exited` 的只移除清單項。

### D13. terminal 內的連結走 `shell.openExternal`，不讓 xterm 自行 `window.open`

`@xterm/addon-web-links` 的 handler 覆寫為呼叫既有的 `workspace.shell.openExternal`（協定驗證在主行程，只放行 http/https）。這與渲染 markdown 連結同源的信任考量一致——絕不讓使用者 repo 的內容（此處是 pty 輸出）直接驅動導航或開窗。

### D14. 驗收：login shell 模式是 CDP probe 的載體；claude 模式只驗「能起來」

`scripts/probe-terminal.mjs`（dev 與 build 兩模式，比照 `probe:files`）：

- **雙向 + cwd**：create 一個 shell session（cwd = 某暫存 folder）→ `write('pwd\r')` → 斷言 `onData` 出現該 folder 路徑；`write('echo __SPEK__\r')` → 斷言回顯。
- **多 session**：再 create 一個，斷言兩個 pty 並存、分頁列有兩項。
- **resize**：改變容器尺寸 → 斷言 pty 收到（shell 內 `stty size` 或讀 `$COLUMNS` 回顯）。
- **生命週期不留孤兒**：關閉一個分頁 → 該 pty 的 pid（自 `/proc` 或 `ps` 查，比照 `probe-native`）消失；**關閉視窗 → 該 window 的所有 pty pid 全數消失**。為了能精準 pgrep，spawn 的 env 帶一個獨一 marker。
- **claude 模式**：只驗「選 claude 後 pty 能 spawn 起來且存活」，不驗互動（claude 是 TUI）。

terminal 與分頁的可識別性用 role/aria（`section aria-label="Terminal"` 已存在；分頁列與分頁加 `role="tablist"`/`role="tab"` + `aria-selected`）——**不掛 `data-*`**。

**撰寫探針時實測補正的兩點（兩者都會製造假綠或假紅）**：

- **Enter 必須是一次真的 keyEvent。** 把 `\r` 併進 `Input.insertText` 的文字裡送出，字元確實抵達 pty（終端上看得到回顯），但 shell **從未執行那一行** —— xterm 的換行是在 keydown 上判讀的，不是從 textarea 的內容剖析出來的。只看「終端上出現了我打的字」會誤判成功。
- **斷言必須能區分「回顯」與「執行」。** tty 會回顯輸入行，所以 `echo COLS=$(stty size ...)` 這種命令，畫面上在**執行之前**就已經有 `COLS=` 了 —— 等它出現會讀到還沒產生的值（實測 build 模式因此讀到 0）。斷言要等的是「marker 後面跟著數字」，或用 `echo OUT_$((6*7))` 這種**回顯不含答案、只有真的執行才會產出 `OUT_42`** 的形式；驗 cwd 同理用 `echo CWD=$(pwd)`（`$(pwd)` 在回顯裡不展開）。

### D15. 啟動失敗一律走 onExit，不走 create 的同步拋錯（**原假設已被實測推翻**）

原本寫的是「`pty.spawn` 對無效 shell 會同步 throw，`create` 以 `try/catch` 回 `SPAWN_FAILED`」。**那是錯的。**

實測（node-pty 1.2.0-beta.14）：`spawn('/nonexistent', ['-l'])` **不拋錯** —— 它成功回傳一個 `IPty`，該 pty 隨即以 **exit code 1** 結束，且 `execvp(3) failed.: No such file or directory` 由 `onData` 送出。

於是**兩種啟動失敗殊途同歸**，都經 `onExit`（非零）+ 終端上的錯誤訊息呈現：

- **shell 路徑無效**（`$SHELL` 壞）：exit 1 + `execvp failed`。
- **claude 找不到**：shell 起得來、`claude` 命令失敗 → 極快 exit + shell 的 `command not found`。

這其實是**好的 UX**（使用者看到真實的錯誤），renderer 只需把該 session 標為 exited。`create` 的 `try/catch → SPAWN_FAILED` 仍保留，但只防罕見的**底層 pty 無法配置**（那才會同步拋錯），不是 execvp 失敗的主路徑。

`src/main/terminal.test.ts` 有一條測試釘住這個結論（`create` 不拋錯、pty 以非零碼結束、輸出含 `execvp`），以免它被悄悄改回去。

### D16. 輸出的 backlog：訂閱必須早於 `create`（實作時發現）

`create` 回傳 sessionId 的那一刻，pty 已經開始吐出 shell 的第一個 prompt；而 `TerminalView` 要等 React 完成渲染才 attach。中間這段**沒有接收者的輸出會直接消失**。

因此 `SessionsProvider` 在**任何一次 `create` 之前**就掛好唯一的 `onData` listener：尚未被終端 attach 的 session，其 chunk 先進 backlog；終端掛載時先 flush backlog、再接上 live sink。這同時讓「未 focused 的 session 其輸出不遺失」（spec）成立 —— detach 之後的輸出一樣落進 backlog。

與 Phase 2 的「**先訂閱、再列目錄**」同源：訂閱要早於**那個會產生事件的動作**，而不是早於「你想開始看事件的時刻」。

### D17. session 序號單調遞增（實作時發現）

分頁標籤用「該 folder 內第幾個 session」。若以「當前 session 數 + 1」計算，關掉一個之後新開的會**撞號**（實測：關掉 `shell 1` 後開的 claude 被標成 `claude 2`，與現存的 `shell 2` 同號）。改用每個 folder 各自單調遞增的計數器。

## Risks / Trade-offs

- **[高頻 pty 輸出的 IPC 壓力]**（`yes`、大型 build log）→ node-pty 的 `onData` 已是讀取層的合批 chunk，非逐字元；Electron IPC 傳字串足夠快。本 change **不做** flow control，但 node-pty 具備 `handleFlowControl`，若實測成為瓶頸再啟用。先不過度設計。
- **[GUI app 缺 shell PATH]** → D6 以 `$SHELL -l` 化解。但**從終端 `npm run dev` 啟動時 env 本就完整，問題只在打包後從桌面啟動**——因此這道緩解的真正驗證點在 Phase 6 打包驗收，須明確覆蓋（比照 `fs-boundary` 的 `O_NOFOLLOW` Windows 退路列為 Phase 6 前置）。
- **[多常駐 xterm 實例的記憶體/DOM]** → session 數少 + scrollback 上限；必要時未來做閒置卸載。
- **[Windows]**：`kill` 不支援 signal、`$SHELL -l -c` 語意不同、pid 清理與 `/proc` 查法不同。**本 repo 無 Windows 實測**，列 Phase 6 打包前必須確認（與既有跨平台債同一批）。
- **[`did-navigate` 漏殺 → 孤兒 pty]** → D2 已處理，且 probe 的「關視窗後 pid 全消失」會抓到回歸。**驗收 fixture 必須真的關閉視窗並回查 pid，不能只斷言 UI 清空**——UI 清了但行程還在，正是最危險的假綠。

## Migration Plan

本 repo 尚無使用者，無資料遷移。部署面：

1. 安裝 `@xterm/xterm`、`@xterm/addon-fit`、`@xterm/addon-web-links`（node-pty 已在 Phase 0 安裝並釘死）。xterm 系列以 caret 宣告即可（純 JS、無原生相依）。
2. Electron／node-pty／xterm 任一升版後，重跑 `npm run probe:native`（pty 載入）與 `npm run probe:terminal`（本 change 的驗收）。

## Open Questions

- **login shell 是否一律 `-l`**（每開 session 重載 profile 有成本）vs 僅 claude 模式需要？暫定一律 `-l`（環境一致優先），實測體感後可調。
- **claude 退出後是否回到互動 shell** 而非結束 session？本 change 選「結束」（session＝為了跑 claude）；若使用者回饋希望「claude 收工後繼續用該終端」，再議。
- **session 版面持久化**（重開還原分頁）留待 Phase 6。
