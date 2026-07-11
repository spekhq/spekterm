# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

spek workspace 是一個以 agent 為核心的本地開發工作台 —— 獨立的 Electron 桌面 app（私有、專有授權），
把多個「一個 repo／資料夾各自一個 `claude` session」的 terminal 包在一個殼裡，
並加上一塊懂 OpenSpec 結構的側欄，讓使用者不必另外開 IDE 就能一邊駕駛 agent、一邊看著 spec 上下文。

**現況：Phase 4（`terminal-agent-sessions`）實作完成，待封存。** Phase 0–3 已封存：Electron
骨架、PRD §12 信任模型、`node-pty` spawn 真 pty、主行程以 `@spekjs/core` 直接掃描 OpenSpec
結構、多 folder 工作區（清單持久化於 userData）、活動列 + rail + 三欄版面、受邊界約束的
`listDir`、side panel 的 `[◈ OpenSpec │ ▤ Files]` 身分切換、遞迴檔案樹（lazy load + chokidar
監控）、面板內的檔案檢視與編輯、完整 CRUD、dirty buffer（跨換頁與跨 folder 存活）、mtime
樂觀鎖、watcher 的自寫事件抑制、關閉視窗時的未存提示。

Phase 4 讓主舞台**首次能駕駛 agent**：`node-pty` 多 session 管理器（每個 `webContents` 一份、
以擁有者生命週期釋放）、IPC 雙向串流（輸出不 debounce、嚴格保序）、xterm + fit（封裝於單一
wrapper 模組）、頂部 session 分頁 + rail 的 repo→session 子列、**spawn 目標可選 `claude` 或
login shell**、cwd = 選中的 folder、resize 時 pty 尺寸同步、以及關分頁／reload／關視窗三種
路徑皆**不留孤兒行程**（`probe:terminal` 38/38，dev 與 build 兩模式）。尚未開始：OpenSpec
側欄的內容（Phase 5）、打包（Phase 6）、handoff（Phase 7+）。

### 開發指令

```bash
npm run dev             # electron-vite dev（開發模式）
npm run build           # 建置至 out/
npm run typecheck       # tsc：main / preload（node）+ renderer（web）
npm test                # node:test 單元測試（fs 邊界、workspace store、listDir/readFile、watcher、外部 URL、pty 管理器）
npm run probe:shell     # 驗收 workspace-app-shell（開視窗 + 信任模型 + preload 白名單，走 CDP）
npm run probe:workspace # 驗收 workspace-folders / filesystem-access / workspace-layout
npm run probe:files     # 驗收 file-explorer / file-viewer / 編輯 / 存檔 / 衝突 / CRUD / 導航防護 / 編輯器 worker（dev + build 兩模式）
npm run probe:terminal  # 驗收 terminal-sessions（pty 雙向／cwd／resize／多開／關分頁・reload・關窗皆不留孤兒，dev + build 兩模式）
npm run probe:native    # 驗收 native-module-toolchain（Electron 主行程載入 node-pty + spawn pty）
npm run probe:core      # 驗收 spek-core-integration（主行程掃描 OpenSpec，且不開 TCP 埠）
npm run measure:bundle  # renderer bundle 體積報告（依編輯器核心／worker／語言分類歸因）
```

`probe:files` 的開發模式**自己起 renderer dev server（`--rendererOnly`）再自己 spawn electron**，
不用 `electron-vite dev` 直接拉起 electron —— 後者產生的 electron 是孫行程，殺 `npx` 殺不到它
（會留下佔著 debugging port 的殭屍），且它轉發 CLI 參數的 `ELECTRON_CLI_ARGS` 實測未生效，
`--user-data-dir` 進不到 electron 的 argv，探針會讀到你真實的 workspace 設定。

`probe:workspace` 以 `--user-data-dir` 指向暫存 profile，因此可以反覆重啟 app、餵它一份
損毀的設定檔，而不會污染你真實的 workspace 設定。

**收尾殺行程時，殺 wrapper 殺不到它 spawn 的真行程。** `node_modules/.bin/electron` 是個
node wrapper，它自己再 spawn 真正的 electron 二進位；`npx electron-vite dev` 的 vite 也是孫
行程。對 wrapper 送 SIGTERM／SIGKILL，底下的真行程會變孤兒，繼續佔著 debugging port（9224）
或 dev port，讓下一輪 probe 連到殭屍而讀到空樹（實測：一連串失敗看起來像 regression，其實是
殭屍）。**兩種收法**：electron 以獨一無二的 `--user-data-dir=<profile>` 用 `pkill -9 -f <profile>`
連根拔除整棵樹（每個子行程的 argv 都帶著它）；dev server 以 `detached: true` spawn 成 group
leader，再 `process.kill(-pid)` 殺整組。**另外，面板留有未存變更時關閉會觸發原生對話框
（design D15），它會擋住主行程訊息迴圈使 SIGTERM 失效** —— 這也是必須連根拔除而非溫柔關閉
的理由。`probe:files` 的每次探針失敗若伴隨「樹是空的」，先 `pgrep -f spek-files-profile` 檢查
有無殭屍，別急著改產品程式碼。

**驗互動時用真事件，不要用 `dispatchEvent(new MouseEvent(...))`。** 合成事件不等於真實
輸入：它不走完整的 pointer/mouse/contextmenu 序列，也不觸發 React 19 對 trusted discrete
事件的同步 effect flush。實測踩過：右鍵選單用合成 `contextmenu` 測「全綠」，但真右鍵完全開
不起來 —— 開啟選單的那次事件冒泡到 window，被選單自己的 dismiss listener 當場關掉（React 19
在同一次事件內就把 effect 掛上了）。而「用選擇器 `.click()` 選單項」會跳過定位，選單溢出
viewport 也照樣通過。**右鍵 / 點擊要用 `Input.dispatchMouseEvent`（button:right/left），
並斷言選單的 `getBoundingClientRect()` 完整落在 viewport 內。** overlay/選單類 UI 的定位與
「開啟事件不可自我關閉」只有真事件測得出來。

開發模式（未打包）啟動時，主行程會輸出一行掃描摘要。掃描目標預設為本 repo，
以 `SPEK_SCAN_PATH` 覆寫：

```bash
SPEK_SCAN_PATH=../spek npm run dev
# [openspec] scan /home/me/git/spek specs=43 activeChanges=1 archivedChanges=67 defaultSchema=spec-driven
```

`scripts/probe-*.mjs` 一律透過 CDP 或真正的 Electron 主行程來驗收，**不在產品程式碼裡塞測試分支** ——
要驗的正是被出貨的那份程式碼。撰寫 Electron ESM 主行程時注意：**不可 top-level `await app.whenReady()`**，
ready 事件要等主 script 評估完成才觸發，會死鎖。

### 權威來源

- **`docs/PRD.md`** — 產品需求的**單一權威來源**。任何關於功能範圍、路線圖、架構決策的問題以它為準。
- **`docs/workspace-mockup.html`** — 定案的高保真 UI 互動雛型。**UI 版面與行為以它為權威**；
  PRD §6 的文字若與雛型有出入，以雛型為準。

## Relationship to `spek`

- 開源的 [`spek`](https://github.com/kewang/spek)（MIT）是 OpenSpec 內容檢視器 monorepo，本機 clone 在 `../spek`。
- **本 repo 是獨立的私有 repo**，專有授權（All rights reserved），**不是** spek monorepo 的 npm workspace 成員。
- 計畫重用 core 引擎（scanner / tasks / git-cache / worktrees / types）與 spek 的前端元件，
  詳見 `docs/PRD.md` §9。

### core 套件的名稱與分發（已定案）

core 對外發佈為 **`@spekjs/core`**（已於 npm public registry 發佈，本 repo 以 `^1.0.0`
宣告依賴）。Phase 5 要抽出的 UI 套件對應為 `@spekjs/ui`。

改名的原因：**`@spek` 這個 npm scope 已被他人註冊**（佔用者 0 個套件），本專案帳號無權
發佈至該 scope —— 決策與證據見 `openspec/changes/.../design.md` D1。更名與發佈由 `spek`
repo 自己的 change 承載（OpenSpec change 是 repo-local 的）。

**依賴一律宣告 npm 版本，不要把 `file:` / `link:` / `portal:` 寫進版控** —— 那會讓 CI 與
`electron-builder` 打包看到與開發者機器不同的依賴。本機要同步改 core 時用 `npm link` 覆寫。

> 驗證 npm scope 是否可發佈時，**不要用 `npm publish --dry-run`** —— 它只做本地打包，
> 不向 registry 驗證權限（對你無權的 scope 也會「成功」）。npm 的 `scope:` 搜尋過濾器
> 同樣不可靠。可用的方法是 `npm org ls <scope>` 與 `npm access list packages @<scope>`，
> 且都要拿已知存在／不存在的名稱當對照組。

## Tech Stack

Electron 43.1.0（釘死）+ electron-vite、TypeScript、React 19 + Tailwind CSS v4、
node-pty 1.2.0-beta.14（釘死）、Monaco Editor、chokidar 5、react-markdown + remark-gfm、
@xterm/xterm 6 + addon-fit / addon-web-links（terminal UI）、electron-builder（打包，Phase 6）。

完整技術選型與理由見 `docs/PRD.md` §8.3。幾個容易踩的點：

- **node-pty 不需要 `@electron/rebuild`**。它是 Node-API 模組，prebuilt 的 `.node` 可同時
  被 Node 與 Electron 載入（兩者 ABI 編號不同，但 N-API 版本相同）。版本必須釘 1.2.0-beta
  系列 —— npm `latest`（1.1.0）缺 Linux prebuild，會強迫本地編譯。
- **編輯器採 Monaco，且只取語法高亮**（`basic-languages/*` 的 monarch tokenizer），
  **不含任何 `language/*` 語言服務**。編輯器承擔的是語法高亮，深度改檔走 agent 或使用者自己的
  IDE（PRD §6.2）；`ts.worker` 單獨就佔 12.65 MB。實測：含語言服務 21.51 MB、不含 8.81 MB。
  `npm run measure:bundle` 會在建置產物出現任何語言服務 worker 時以非零碼結束。退守 CodeMirror 6
  的成本侷限於 `src/renderer/src/editor` 這個 wrapper 模組。
- **編輯器關閉 Monaco 的 native EditContext（`editContext: false`）**，改用經典的隱形 textarea
  輸入路徑。理由是可驗收性：native EditContext 的 `ime-text-area` **恆為 `readonly`**，與編輯器
  唯不唯讀無關 —— Phase 2 的 probe 曾以「textarea.readOnly === true」斷言唯讀，那條對可編輯的
  編輯器**一樣會通過**，是假驗收（Phase 2 結論剛好正確才沒被發現）。關掉 EditContext 後，
  textarea 的 `readonly` 正確反映狀態，且 CDP 的 `Input.insertText` 能真的打字。驗證編輯能力
  **必須讓內容真的改變並回讀磁碟**，不能只看某個 textarea 的 `readonly`。
- **`react-markdown` 的安全性來自預設值**：原始 HTML 被降級為純文字、URL 由
  `defaultUrlTransform` 過濾（只放行 `http(s)`/`mailto`/`xmpp`）。**絕不可加 `rehype-raw`、
  也不可覆寫 `urlTransform`** —— 檔案樹渲染的是使用者 repo 裡的任意 `.md`，那是不受信任的輸入。
- **終端封裝於單一 wrapper 模組**（`src/renderer/src/shell/terminal/xterm.ts`），與編輯器同一
  條約束：renderer 的其他模組不直接 import `@xterm/*`。**web-links addon 的開啟 handler 必須
  覆寫為走主行程的 `shell.openExternal`** —— pty 的輸出同樣是不受信任的內容（使用者 repo 裡
  任何東西都可能印出一個 URL），不得讓 xterm 自行導航或開窗。

## Workflow

- **所有變更都必須使用 OpenSpec 工作流程**：每個功能、修復或修改都要先建立 OpenSpec change，
  經過 proposal → design → tasks 流程後再實作。
- 使用 `/openspec-new-change` 或 `/opsx:new` 建立新的 change。
- 實作完成後使用 `/openspec-verify-change` 驗證，再用 `/openspec-archive-change` 封存。
- **Archive 時必須**：更新相關文件（CLAUDE.md、README 等若有影響），並建立 git commit。

### 路線圖與 change 的對應

開發路線圖見 `docs/PRD.md` §11。每個 Phase 對應一個（或數個）OpenSpec change，可單獨驗收。

- **Phase 0** — `workspace-foundation-spike`（已封存）：package 骨架 + 高風險相依的技術驗證。
  除 PRD 列的三項外，另納入 core 套件的跨 repo 分發（`@spekjs/core`）。
- **Phase 1** — `multi-folder-workspace-shell`（已封存）：folder 清單持久化、活動列 + rail +
  三欄版面、受邊界約束的 `listDir`。
- **Phase 2** — `file-explorer-readonly-view`（已封存）：side panel 的身分切換、檔案樹
  （lazy load + chokidar）、`readFile` / `watch`、面板內的唯讀檢視、導航防護。
- **Phase 3** — `file-editing-and-crud`（已封存）：編輯能力、完整 CRUD、dirty buffer、
  mtime 樂觀鎖、寫入路徑的邊界。
- **Phase 4** — `terminal-agent-sessions`（實作完成，待封存）：node-pty 多 session 管理、
  IPC 雙向串流、xterm + fit、session 分頁 + rail 的 repo→session 子列、spawn 目標可選
  （claude／login shell）、生命週期不留孤兒行程。
- Phase 5–6 建立工作台其餘部分，Phase 7+ 建立護城河（handoff）。

> **Phase 1 欠下的 Monaco 債，已於 Phase 2 償還。** `multi-folder-workspace-shell` 曾把
> `workspace-app-shell` 的兩條 Monaco requirement 標為 `REMOVED`（診斷頁退場後沒有模組引用
> `editor/`）。`file-explorer-readonly-view` 以 side panel 的檔案檢視為載體重新確立它們，並
> 新增兩條：「不引入任何語言服務 worker」與「worker 於 dev 與 build 兩模式皆完成一次往返」。

> **Phase 3 已償還 Phase 1/2 欠下的寫入邊界債**（`file-editing-and-crud`）：讀取的「先
> `realpath` 檢查、再依原路徑開啟」**不被寫入沿用**（已實測會逸出邊界）；寫入改為解析與開啟
> 不可分割、帶 `O_NOFOLLOW`。中間目錄段的 TOCTOU 因 Node 無 `openat` 無法機制性防護，改以
> 「白名單不暴露 `symlink()`、寫入 leaf 一律 `realpath`」的威脅模型承擔 —— 詳見上文「檔案系統
> 邊界」段與 design D1–D8。**此結論有前提，暴露 `symlink()` 或改用 `lstat` 語意即失效。**

## Conventions

- 程式碼用英文撰寫
- 註解與文件使用繁體中文（台灣用語）
- 本 repo 的 Node 版本固定在 `.nvmrc`（22.22.0），與 `../spek` 一致

## Phase 0 推翻的 PRD 假設

以下三點 PRD 原本寫錯，已於 `workspace-foundation-spike` 實測並回寫。留在此處，
是因為它們是容易憑直覺再犯的錯：

- **「node-pty 需要 `electron-rebuild` 對齊 Electron ABI」—— 錯。** 那是它還用 NAN 的時代的
  舊事實。實測 `pty.node` 有 40 個 `napi_*` symbol、0 個 `v8::` symbol；Node 22 的 ABI 是 127、
  Electron 43 是 148，但兩者 N-API 同為 10，同一顆 `.node` 兩邊都載入得了。
- **「Monaco 的 Vite worker 設定是風險」—— 已證偽。** dev（`http://`）與 build（`file://`）
  兩模式的 worker 皆正常。`file://` 下的動態 import 與 module worker 建立也都沒問題，
  不需要改用自訂協定。
- **「主行程可直接 import `@spek/core`」—— 論點對，名字錯。** 主行程確實能直接 import core、
  在行程內完成掃描（已實測，全程不開任何 TCP 埠）。但 `@spek/core` 從未發佈、`@spek` scope
  也不屬於本專案 —— PRD 假設了一個不存在的取得管道。改名並發佈為 `@spekjs/core` 後才成立。

驗證編輯器 worker 是否存活時，**不能靠「看到語法高亮」** —— tokenization 在主執行緒完成。
必須讓 worker 真的做一次往返。Phase 2 起不再有語言服務 worker，改以 Monaco 內建的 link
provider 驗證：它為 `language: '*'` 註冊，呼叫 worker 端的 `$computeLinks`，命中的 URL 會被
畫上 `.detected-link`。**開一個含 URL 的檔案，看到 `.detected-link` 就是往返的證據** ——
零 bundle 成本、零測試鉤子。

## Phase 2 推翻的假設

- **「`import 'monaco-editor/esm/vs/editor/editor.all.js'` 是必要的」—— 錯。** 只要引用任何一種
  `basic-languages/*` 的 contribution，`_.contribution.js` 就已經把整套 editor contribution 拉了
  進來。實測：加與不加，建置產物只差 **15 bytes**。
- **「chokidar 監看 folder 內的目錄不會越界」—— 錯。** 它的 `followSymlinks` **預設為 `true`**，
  folder 內一個指向 `/etc` 的 symlink 被展開時，watcher 會跟著走出去，把邊界外的檔名經事件
  推給 renderer。`listDir` 守住的邊界，會從 watcher 這道側門漏掉。必須 `followSymlinks: false`，
  且事件路徑在推送前再過一次 `isWithin`。
- **「渲染 markdown 只是個顯示功能」—— 錯，它是攻擊面。** preload 綁在 `webContents` 上，
  **每次導航後都會重新注入，不分來源**。使用者 repo 裡一個 `[click](https://evil.com)` 就能把
  renderer 帶去遠端頁面，而那個頁面的 `window.workspace.fs` 就是我們的檔案系統白名單。
  `will-navigate` / `setWindowOpenHandler` 的防護是渲染 markdown 的**前提**，不是加分項。
- **「`did-start-navigation` 可以當作 renderer 重新載入的訊號」—— 錯。** 它與 `will-navigate`
  對同一次導航都會觸發，`preventDefault()` 只是隨後取消它。於是每擋下一次導航，就會順手把
  該 renderer 的所有 watcher 關掉，檔案樹與檢視器從此靜默地不再更新（已實測）。要用
  `did-navigate`（已 commit）。**「導航開始」不等於「導航發生」。**
- **「主行程拋出的錯誤可以帶著 `code` 傳到 renderer」—— 錯。** Electron 的 IPC 序列化**只保留
  `message`**，自訂屬性一律遺失。需要結構化的失敗資訊（錯誤碼、檔案大小與上限）時，要在 IPC
  接縫上改回傳 `{ ok: false, code, detail }` 結果物件。純邏輯層仍然拋錯。
- **「一個樹上的路徑對應一個被監看的目錄」—— 錯。** folder 內指向 `sub/` 的 symlink，在樹上是
  兩個節點、在磁碟上是同一個目錄，而 chokidar 只認絕對路徑。訂閱（樹上的 relPath）與監看
  （磁碟上的 realpath）必須分層並以參考計數對接，事件也必須**以訂閱者使用的路徑改寫**後才推送
  —— 否則收合其中一個節點會停掉另一個的監看，而經 symlink 展開的節點永遠收不到事件。
  **驗收 fixture 裡沒有 symlink，這個 bug 就會躲過整輪全綠的驗收。**
- **「先列目錄、再開始監看」—— 錯。** 兩者之間的窗口裡發生的變更會兩頭落空：列目錄沒看到它，
  事件也還沒開始送。**必須先訂閱、再列目錄** —— 訂閱前的狀態由列目錄補齊，之後的由事件送達。
  這個 app 的前提就是旁邊有 agent 一直在寫檔，那個窗口一點都不理論。

驗證「app 沒有開 TCP 埠」時，**不能只讀主行程的 `/proc/<pid>/net/tcp`** —— Chromium 的 zygote
與 renderer 跑在各自的 network namespace，主行程那張表看不到它們。`probe:core` 因此用兩道互補
判準：逐 pid 取「該 pid 的 socket inode ∩ 該 pid 所屬 netns 的 LISTEN 表」，外加「app 存活期間
本 netns 是否新增 LISTEN socket」—— 後者不需要讀任何 pid 的 fd，可繞過 sandbox 造成的權限死角。

## Phase 4 的實測與踩雷（terminal）

- **`did-navigate` 不只要清 watcher，也必須殺光 pty。** reload 不銷毀 `webContents`，只掛
  `'destroyed'` 的清理不會觸發 —— 舊 pty 會變成孤兒行程，且新頁面的 xterm **永遠收不到它們
  的輸出**（listener 綁在已消失的舊 renderer 上）。`probe:terminal` 真的 reload、再回查行程表。
- **`node-pty` 的 spawn 對 execvp 失敗「不會」同步拋錯 —— 原假設是錯的。** 實測
  `spawn('/nonexistent', ['-l'])` → 不 throw、pty 以 exit code 1 結束、`execvp(3) failed.` 由
  `onData` 送出。於是「shell 路徑無效」與「claude 找不到」殊途同歸，都經 `onExit`（非零）+
  終端上的錯誤訊息呈現，而**不是** `create` 回一個錯誤碼。`create` 的 try/catch 只防罕見的
  「底層 pty 配置不出來」。
- **GUI app 常缺使用者 shell 的 PATH**（從桌面啟動不會繼承 `.zprofile` / `.bashrc`），直接
  `spawn('claude')` 會 ENOENT。兩種 spawn 目標因此都經 login shell：shell 模式 `$SHELL -l`、
  claude 模式 `$SHELL -l -c claude`。**這道緩解的真正驗證點在 Phase 6 打包後從桌面啟動** ——
  `npm run dev` 是從終端起的，env 本來就是完整的，測不出這個問題。
- **terminal 的 cwd 邊界不是沙箱。** `create` **只收 `folderId`、不收任何路徑**（renderer 在
  語彙上無從指定 workspace 外的 cwd），但這只約束**初始** cwd —— pty 起來之後使用者可以 `cd`
  到任何地方、執行任何命令，那正是終端的用途。**不要把它與 `fs.*` 白名單的沙箱語意混為一談**
  （日後評估 handoff auto-spawn 的信任邊界時，這個區別很要命）。
- **輸出的訂閱必須早於 `create`。** pty 在 `create` 回傳的那一刻就開始吐第一個 prompt，而
  `TerminalView` 要等 React 渲染完才 attach —— 中間沒有接收者的輸出會**直接消失**。
  `SessionsProvider` 因此在任何一次 create 之前就掛好唯一的 `onData`，尚未 attach 的 session
  其輸出先進 backlog，終端掛上時先 flush 再接 live。與 Phase 2 的「**先訂閱、再列目錄**」同源。
- **終端必須跨「切換 folder」常駐。** 若只掛載當前 folder 的 session，切走再切回時 xterm 實例
  已被卸載，先前的 scrollback 就沒了（backlog 補得回未顯示期間的新輸出，補不回已卸載的歷史）。
  因此掛載 `sessions.all()`、以 `display:none` 決定顯示 —— 代價是隱藏時 `FitAddon` 量到 0，
  由隱藏轉為顯示時必須重新 `fit()` 一次。

- **session 的身分由 pty 自己宣告，不是我們給的流水號**（`session-titles-and-controls`）。
  pty 內的程式以 OSC 序列（`ESC ] 0 ; <title> BEL`）設定終端標題 —— `claude` 正是這樣讓終端
  模擬器的分頁自動改名的。xterm 的 `onTitleChange` 直接把這個事件交給我們：**不必輪詢
  node-pty 的 `pty.process`（那是近似值），也不需要任何主行程改動或 IPC**。分頁列與 rail
  子列共用同一個標籤；pty 沒宣告時才退回 `claude 1` 這種本地標籤。截斷只是呈現，完整標題
  留在 tooltip。

### 驗 terminal 的兩個假綠陷阱

- **Enter 必須是一次真的 keyEvent。** 把 `\r` 併進 `Input.insertText` 的文字裡送出，字元確實
  抵達 pty（**終端上看得到回顯**），但 shell **從未執行那一行** —— xterm 的換行是在 keydown 上
  判讀的，不是從 textarea 的內容剖析出來的。只斷言「終端出現了我打的字」會誤判成功。
- **斷言要能區分「回顯」與「執行」。** tty 會回顯輸入行，因此 `echo COLS=$(stty size ...)` 這
  種命令，畫面上在**執行之前**就已經有 `COLS=` 了 —— 等它出現會讀到還沒產生的值（實測 build
  模式因此讀到 0，dev 模式僥倖通過，是典型的 flaky）。要用「回顯不含答案」的形式：
  `echo OUT_$((6*7))` 只有真的執行才會出現 `OUT_42`；驗 cwd 用 `echo CWD=$(pwd)`（`$(pwd)`
  在回顯裡不會展開）。

## 檔案系統邊界（`multi-folder-workspace-shell` 起）

renderer 以 `(folderId, relPath)` 定址檔案系統，**永遠不傳絕對路徑** —— 它沒有詞彙可以表達
workspace 之外的位置。邊界檢查一律在**主行程**執行；preload 與 renderer 同屬一個行程樹，
在那裡檢查等同沒有檢查。

- **包含關係一律用 `path.relative(root, target)` 判定，絕不用 `target.startsWith(root)`。**
  前綴比對會把 `/a/bc` 誤判為位於 `/a/b` 之內。`src/main/fs-boundary.test.ts` 有一條測試就是
  為了讓這個寫法必定失敗；不要「簡化」掉它。
- **symlink 必須在比對之前解析**（root 與 target 兩端都要 `realpath`）。只看字面路徑會漏掉
  「folder 內的 symlink 指向 folder 外」。
- **讀取路徑（`resolveWithinRoot`）與寫入路徑（`openExistingForWrite` / `resolveNewWithin`）
  分家，不可混用。** 讀取回傳一個路徑，呼叫端拿去 `open`；寫入若沿用這個「檢查完再依原路徑
  開啟」，已實測會逸出邊界（check 與 open 之間 leaf 被換成越界 symlink）。寫入必須解析與開啟
  不可分割：對 `realpath` 的結果、帶 `O_NOFOLLOW` 開啟。
- **TOCTOU 與 hard link：Phase 3 起以威脅模型承擔，不是機制性防護。** Node 沒有 `openat`，
  `O_NOFOLLOW` 只約束路徑最後一段，中間目錄段的 race 防不住。關鍵在**白名單不暴露 `symlink()`、
  寫入的 leaf 檢查一律用 `realpath`（不是 `lstat`）** —— 於是 renderer 既造不出、也操縱不到
  race 所需的 symlink。這道邊界防的仍是**被入侵或有 bug 的 renderer**，不是已拿到本機寫入權的
  攻擊者。**此結論有前提**：任何後續 change 若要暴露 `symlink()`、或把寫入 leaf 檢查改為 `lstat`
  語意，本論證即失效，必須重新論證。完整論證見 `file-editing-and-crud` 的 `design.md` D1–D8
  （`O_NOFOLLOW` 為 POSIX-only，Windows 退為 `lstat` 二次確認，且本 repo 無 Windows 實測，
  列為 Phase 6 打包驗收前必須確認的項目）。
- **原地寫入，不做「暫存檔 + 改名」。** 後者會把 folder 內的 symlink 取代成普通檔案、斷開
  hard link，並讓一次存檔在 watcher 上呈現為「刪除後新增」（已實測）。取捨見 design D5。
- **watcher 也受同一道邊界約束**：`followSymlinks: false`，且事件的絕對路徑轉成
  `(folderId, relPath)` 之前必須再過一次 `isWithin`。推給 renderer 的每一個路徑，
  都必須是 renderer 有詞彙表達的路徑。**且 app 自身的寫入不得回推為外部變更事件** —— 否則
  每次存檔都會警告使用者磁碟被改動（自寫抑制見 design D12）。

驗證「某段邏輯沒有 spawn 外部程式」時，**不要用行程樹取樣** —— 開發模式的掃描摘要本來就會
spawn 一次 `git log`（core 的 `getTimestamps`），會混淆歸屬；而 `git` 是毫秒級行程，取樣容易
漏抓。改在單元測試裡攔截 `node:child_process` 的全部入口，並加一個對照組證明攔截確實生效。
