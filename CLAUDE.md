# CLAUDE.md

![x](https://example.com/image.webp)

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

spekterm 是一個以 agent 為核心的本地開發工作台 —— 獨立的 Electron 桌面 app（私有、專有授權），
把多個「一個 repo／資料夾各自一個 `claude` session」的 terminal 包在一個殼裡，
並加上一塊懂 OpenSpec 結構的側欄，讓使用者不必另外開 IDE 就能一邊駕駛 agent、一邊看著 spec 上下文。

**現況：Phase 5（`openspec-side-panel`）已封存。** Phase 0–4 亦已封存：Electron
骨架、PRD §12 信任模型、`node-pty` spawn 真 pty、主行程以 `@spekjs/core` 直接掃描 OpenSpec
結構、多 folder 工作區（清單持久化於 userData）、活動列 + rail + 三欄版面、受邊界約束的
`listDir`、side panel 的 `[◈ OpenSpec │ ▤ Files]` 身分切換、遞迴檔案樹（lazy load + chokidar
監控）、面板內的檔案檢視與編輯、完整 CRUD、dirty buffer（跨換頁與跨 folder 存活）、mtime
樂觀鎖、watcher 的自寫事件抑制、關閉視窗時的未存提示，以及 Phase 4 的 terminal（`node-pty`
多 session、IPC 雙向串流、xterm + fit、session 分頁 + rail 子列、spawn 目標可選 `claude`／
login shell、關分頁／reload／關視窗三路徑皆**不留孤兒行程**）。

Phase 5 讓側欄**首次真的懂 OpenSpec**（在此之前那格只是一塊 placeholder，這個 app 相對於
「開四個終端機分頁」沒有增量價值）：主行程以 `@spekjs/core` 為**每個 folder** 供應 OpenSpec
結構（per-folder 快取 + `openspec/` 的 chokidar 監看 → **agent 改檔，側欄自己更新**）、
`openspec.*` IPC（形狀對齊 spek 的 `ApiAdapter`，全部只收 `folderId`）、renderer 的
`IpcAdapter`、side panel 的兩個視圖（**本 change** ＝每個 artifact 一個分頁；**瀏覽** ＝ Specs／
Changes 兩棵樹）、tasks 進度與 spec deltas 的 BDD 高亮、spec/change ↔ 檔案的**交叉導覽**、
session 的**錨定 change**（側欄跟隨 focused session），以及 **Graph 與 Timeline 的全視窗 overlay**
—— 那兩個來自新抽出的 **`@spekjs/ui`**（發佈至 npm，與 spek web 共用同一份 d3 力導向圖與 Gantt）。
`probe:openspec` 142/142，dev 與 build 兩模式。

`session-navigation-and-labels`（不屬於任何 Phase）再補上**鍵盤導航**——`Ctrl+Tab` 切 session、
`Ctrl+↑↓` 切 repo、`Ctrl+T` 開 spawn 選單（選單可全鍵盤操作），攔截點在 window 的 **capture 階段**
（早於 xterm 與 Monaco，被攔下的按鍵不會流進 pty）；以及 **login shell 不再採用 pty 宣告的 OSC 標題**
（那串 `使用者@主機:/路徑` 零資訊量，且它晚一秒多才到、抵達時把「+ session」入口往右推 150px）。
`probe:keyboard` 64/64、`probe:terminal` 112/112。

`renderer-security-hardening`（不屬於任何 Phase）是一次資安掃描後補上的三項**縱深防禦**——
主行程施加的 **CSP**（inline script 不執行、鎖死 script／object／iframe／base-uri，為 XSS 立足點
設第二層防線；**放行遠端 https 圖片**——那是 markdown 的正常內容；dev／production 切換依
`ELECTRON_RENDERER_URL`，不是 `app.isPackaged`）、`clipboard:writeText` 的**型別 guard**
（非字串輸入不再使主行程拋未捕捉例外）、xterm 的 **OSC 8 `linkHandler`**（OSC 8 超連結改走
`openExternal`，不落入 xterm 內建的 confirm＋window.open）。`probe:files` 101/101、`probe:terminal`
114/114。

尚未開始：打包（Phase 6）、handoff（Phase 7+）。

### 開發指令

```bash
npm run dev             # electron-vite dev（開發模式）
npm run build           # 建置至 out/
npm run typecheck       # tsc：main / preload（node）+ renderer（web）
npm test                # node:test 單元測試（fs 邊界、workspace store、listDir/readFile、watcher、外部 URL、pty 管理器、舊產品名不得殘留）
npm run probe:shell     # 驗收 workspace-app-shell（開視窗 + 信任模型 + preload 白名單，走 CDP）
npm run probe:workspace # 驗收 workspace-folders / filesystem-access / workspace-layout
npm run probe:files     # 驗收 file-explorer / file-viewer / 編輯 / 存檔 / 衝突 / CRUD / 導航防護 / 編輯器 worker / CSP（遠端圖片可載入、script-src 僅 self、注入點對 file:// 生效，dev + build 兩模式）
npm run probe:terminal  # 驗收 terminal-sessions（pty 雙向／cwd／resize／多開／關分頁・reload・關窗皆不留孤兒；剪貼簿畸形輸入防禦；OSC 標題與命名權衝突以 PATH 上的 stub claude 承載，dev + build 兩模式）
npm run probe:keyboard  # 驗收 keyboard-navigation（Ctrl+Tab 切 session／Ctrl+↑↓ 切 repo／位置序非 MRU／按鍵不流進 pty／編輯器與對話框的行為，dev + build 兩模式）
npm run probe:openspec  # 驗收 openspec-data-access / openspec-panel（兩個視圖／兩棵樹／artifact 分頁／agent 改檔即更新／錨定／交叉導覽／Graph・Timeline 的 overlay，dev + build 兩模式）
npm run probe:native    # 驗收 native-module-toolchain（Electron 主行程載入 node-pty + spawn pty）
npm run probe:core      # 驗收 spek-core-integration（主行程掃描 OpenSpec，且不開 TCP 埠）
npm run probe:identity  # 驗收 app-identity（productName／appId／userData 路徑／視窗標題）
npm run measure:bundle  # renderer bundle 體積報告（依編輯器核心／worker／語言分類歸因）
```

`probe:identity` **不傳 `--user-data-dir`** —— 它要驗的正是 `app.getPath('userData')` 實際解析出來
的路徑，而那個旗標會把待驗的對象本身覆寫掉。其他 probe 用暫存 profile 隔離自己的手法在這裡不適用，
因此它像 `probe:native` 一樣「自己就是一個 Electron 主行程」。

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
的理由。`probe:files` 的每次探針失敗若伴隨「樹是空的」，先 `pgrep -f spekterm-files-profile` 檢查
有無殭屍，別急著改產品程式碼。

> **`pkill -f` / `pgrep -f` 會匹配到你自己那條命令。** pattern 寫在 command line 上，而
> `-f` 比對的是整條 command line —— 於是 `pkill -9 -f spekterm-files-profile` 會把執行它的
> 那個 shell 一起殺掉（實測：指令中途死亡、後面的清理不再執行，看起來像「殺完就沒事了」，
> 其實一個殭屍都沒殺到）。把 `-` 包成字元類別即可自我豁免：`pkill -9 -f 'spekterm[-]files-profile'`
> —— regex 仍匹配真正的 profile 名，但你自己那條命令的字面不匹配。

**驗互動時用真事件，不要用 `dispatchEvent(new MouseEvent(...))`。** 合成事件不等於真實
輸入：它不走完整的 pointer/mouse/contextmenu 序列，也不觸發 React 19 對 trusted discrete
事件的同步 effect flush。實測踩過：右鍵選單用合成 `contextmenu` 測「全綠」，但真右鍵完全開
不起來 —— 開啟選單的那次事件冒泡到 window，被選單自己的 dismiss listener 當場關掉（React 19
在同一次事件內就把 effect 掛上了）。而「用選擇器 `.click()` 選單項」會跳過定位，選單溢出
viewport 也照樣通過。**右鍵 / 點擊要用 `Input.dispatchMouseEvent`（button:right/left），
並斷言選單的 `getBoundingClientRect()` 完整落在 viewport 內。** overlay/選單類 UI 的定位與
「開啟事件不可自我關閉」只有真事件測得出來。

**但送真滑鼠事件，就得自己面對座標會過期。「量完就點」是在賭版面不動 —— 而分頁列會動。**
pty 宣告的 OSC 標題比 session 晚到**很多**（shell 要載完 rc、畫出第一個 prompt 才送出，實測
一秒以上）。標題一到，分頁標籤就從 `shell 1` 變成 `kewang@host:/長長的/路徑`，寬度暴增，把它
右邊的「+ session」往右推（實測跳了 **150px**）。探針量到的座標於是在幾毫秒內過期，點擊落在
變寬後的分頁標籤上 —— click 的 target 是那個 `SPAN` 而不是按鈕。**症狀看起來卻像「產品的選單
壞了」**（`probe:openspec` 因此在 Phase 5 全程是紅的，一度被當成 regression 追）。兩道防護要
一起上：`stableRect`（連續數次量到同一位置才算數，**取樣窗口必須跨過標題的延遲** —— 只量兩次、
間隔 150ms 會落在標題抵達前的**假平靜期**裡，實測仍然點空），以及**點完確認選單真的開了，沒開
就重量再點**（對手是外部行程何時吐標題，穩定判準只能壓低機率、消不掉它）。

> **一條沒有 `detail` 的 `check()`，失敗時等於什麼都沒說。** 上面那個 bug 難追，正是因為與它
> 同時紅的「該 change 成為側欄呈現的 change」只斷言相等、不印出實際值 —— 它其實是**另一個**
> 競態（側欄換 change 時會清空資料、短暫回到「載入中…」，而它只 `evaluate` 一次就斷言，沒有
> 輪詢）。兩個不同的病擠在同一份紅色輸出裡，看起來像同一個根因。

開發模式（未打包）啟動時，主行程會輸出一行掃描摘要。掃描目標預設為本 repo，
以 `SPEKTERM_SCAN_PATH` 覆寫：

```bash
SPEKTERM_SCAN_PATH=../spek npm run dev
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

## 產品身分（`rename-to-spekterm` 起 —— **已凍結，不要改**）

| | |
|---|---|
| `package.json` 的 `name` | `spekterm`（unscoped —— 本 package 是 `private`、不發佈，不需要 scope） |
| `productName` | `Spekterm` |
| `build.appId` | `com.spekterm.app` |
| userData | `~/.config/Spekterm` |
| 視窗標題（`document.title`） | `spekterm` |

**`appId` 與 `productName` 一旦隨安裝檔發佈就凍結。** `appId` 進 macOS 的 `CFBundleIdentifier`
與 Windows 的 uninstall registry key —— 改動它的作業系統語意是「**發佈一個不同的 app**」：舊版不會
自動更新過去，使用者手上會同時裝著兩個。`productName` 同理（它決定 userData 的落點，改了＝所有人的
設定失聯）。**Phase 6 之後，這兩個值不可再動。**

- **`app.getName()` 優先讀 `productName`、缺才退回 `name`** —— 所以 `productName` 不只是顯示名稱，
  它同時決定使用者設定存在哪。正名前沒有 `productName`，於是退回當時那個 **scoped** 的 `name`，
  而 scope 名直接成了路徑的一層，造出一個帶 `@` 的巢狀 userData 目錄。
- **品牌書寫全小寫（`spekterm`），但 `productName` 首字大寫（`Spekterm`）** —— 後者是作業系統的
  顯示名稱（Dock、安裝檔名），那些位置的慣例是專有名詞。兩者不同源，不需一致。
- **`npm test` 有一條守衛**（`scripts/naming.test.mjs`）：版控中不得殘留舊名，`archive/` 除外。
  它的對照組要求「**不排除** archive 時必須命中舊名」—— 少了這條，`git grep` 的 ANSI 顏色碼曾讓
  路徑比對靜默失準而全綠（實測）。
- **`probe:identity` 不能傳 `--user-data-dir`**（那會覆寫掉待驗的對象），**也不能寫成 Electron 主
  行程腳本**（`electron <script>` 不讀 repo 的 `package.json`，只會量到 Electron 的預設值 `Electron`）。
  它啟動真正的 `electron .`，再從**子行程的 argv** 讀出解析後的 userData。

> **已知未結風險：`spekterm.com` 尚未購買**，而 `appId` 正是反寫它。若該 domain 被他人註冊，這個
> **已凍結**的 appId 就變成在宣告別人的命名空間 —— 而且事後無法以改 appId 化解。**Phase 6 打包發佈
> 前必須買下它**；這個窗口只會變窄，不會變寬。

### GitHub 位置：org 是 `spekhq`（**不凍結**，與上表無關）

本 repo 位於 **`spekhq/spekterm`**（原 `kewang/spekterm`，已 transfer，舊網址自動 redirect）。
org 名**不是**凍結身分的一部分 —— repo 改名與 transfer 皆自動 redirect，隨時可做。

- **`spekjs` 這個 GitHub org 開不出來。** 它被一個 0 repo、0 follower 的閒置 User 帳號佔著
  （username 與 org 共用同一個命名空間），而 GitHub **不因閒置釋出名字**，只受理商標爭議 ——
  申訴已放棄。`spekhq` 是 `rename-to-spekterm` design D5 早已寫下的備案。
- **npm scope 仍是 `@spekjs`，不要「順手對齊」成 `@spekhq`。** 那個 npm org 真的叫 `spekjs`、
  套件已發佈。**GitHub org 名與 npm scope 不一致是常態**（`@tailwindcss/*` 的源碼在
  `tailwindlabs/tailwindcss`），為了對齊而重新發佈一次 scope，成本遠大於收益。
- **開源的 `spek` 刻意留在 `kewang/spek`，沒有搬進 org。** 唯一的阻礙是 **GitHub Pages 不
  redirect**（GitHub 文件明文：git 與網頁連結會 redirect，Pages **不會**）—— 而
  `kewang.github.io/spek` 上掛著 README 頂部的 3 個 badge 與 **Live Demo**，那些 badge 隨 README
  一起出現在 npm、VS Code Marketplace、JetBrains 商店的頁面上。搬 org ＝ 這些 URL 永久 404。
  其餘一切（secrets、webhooks、deploy keys、issues、releases、fork、git 操作）都會跟著搬或 redirect。

> **日後真要搬 `spek`，成本只會漲不會跌。** 掛上自訂網域後，`<owner>.github.io/<repo>` 會自動
> redirect 到該網域 —— 所以**「換 owner」是唯一不被任何 redirect 覆蓋的一次搬家**。拖越久，指向
> `kewang.github.io/spek` 的外部連結累積越多。與 `appId` 同一個形狀的單調成本。

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
- **Phase 4** — `terminal-agent-sessions`（已封存）：node-pty 多 session 管理、IPC 雙向串流、
  xterm + fit、session 分頁 + rail 的 repo→session 子列、spawn 目標可選（claude／login shell）、
  生命週期不留孤兒行程。後續三個 change 亦已封存：`session-titles-and-controls`（pty 宣告的
  OSC 標題）、`terminal-clipboard`（複製貼上）、`session-rename-and-reorder`（命名權與拖曳排序）。
- **Phase 5** — `openspec-side-panel`（已封存）：主行程的 per-folder OpenSpec 資料
  供應層（快取 + watch）、`openspec.*` IPC、renderer 的 `IpcAdapter`、side panel 的兩個視圖
  （本 change 的 artifact 分頁 / 瀏覽的兩棵樹）、tasks 進度與 spec deltas、交叉導覽、
  session 的錨定 change、Graph 與 Timeline 的全視窗 overlay。
  跨 repo：`spek` 的 `extract-ui-package` 抽出並發佈 **`@spekjs/ui@1.0.0`**。
- **正名** — `rename-to-spekterm`（已封存，**不屬於任何 Phase**）：產品從一個描述性的佔位名
  （開源專案名 + 泛用詞，見該 change 的 proposal）正名為 **spekterm**，並定下會隨打包凍結的作業
  系統身分（見上文「產品身分」）。**它必須排在 Phase 6 之前** —— `appId` 一旦隨安裝檔發佈就改不了，
  正名的成本從打包起單調上升。
- **鍵盤導航與 session 標籤** — `session-navigation-and-labels`（已封存，**不屬於任何 Phase**）：
  新能力 `keyboard-navigation`（`Ctrl+Tab` 切 session、`Ctrl+↑↓` 切 repo、`Ctrl+T` 開 spawn 選單，
  選單可全鍵盤操作），以及 **login shell 不再採用 pty 宣告的 OSC 標題**（見上文兩節）。
  連帶：`ContextMenu` 加上鍵盤導覽、`files/dialogs.tsx` 補上 `role="dialog"`、新增 `probe:keyboard`，
  並把 `probe:terminal` 的 OSC 標題驗收換到**由探針控制的 stub `claude`** 上（不換就是假綠 —— 那些
  測試會繼續通過，但測的已經不是它們自稱在測的東西）。
- **renderer 安全硬化** — `renderer-security-hardening`（已封存，**不屬於任何 Phase**）：一次資安
  掃描後補上的三項縱深防禦 —— 主行程施加的 **CSP**（inline script 不執行、鎖死
  script／object／iframe／base-uri；**放行遠端 https 圖片**——markdown 的正常內容；dev／production
  切換依 `ELECTRON_RENDERER_URL` 而非 `app.isPackaged`）、`clipboard:writeText` 的**型別 guard**
  （非字串不再使主行程拋未捕捉例外）、xterm 的 **OSC 8 `linkHandler`**（OSC 8 超連結改走
  `openExternal`，不落入 xterm 內建的 confirm＋window.open）。詳見上文「renderer 安全硬化的實測與
  踩雷」——含 CSP 切換依據、CDP 繞過 script-src、OSC 8 probe 假綠三個踩雷。
- Phase 6 打包與發佈，Phase 7+ 建立護城河（handoff）。

> **Phase 5 對 PRD 的「抽出 `@spekjs/ui`」做了對半的裁決**（PRD §9.2 已回寫）：整頁視圖**不抽**
> （側欄是窄欄 UI，spek 是全寬頁面，不是同一個東西），但 **Graph 與 Timeline 抽了** —— 它們不是
> 頁面，是自足的視覺化元件。詳見下文「Phase 5 的實測與踩雷」。

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

- **終端的複製貼上不能靠瀏覽器原生的路徑**（`terminal-clipboard`）。xterm 的選取**不是 DOM
  selection**（它自己畫），因此原生的「Ctrl+C 複製選取文字」對它完全無效。複製走
  `term.getSelection()` + 主行程的 clipboard；貼上走 `clipboard.readText()` + `term.paste()`。
  **不用 `navigator.clipboard`** —— 它的 `readText()` 在 Electron 中受 `clipboard-read` 權限
  模型擺布，跨平台不一致。
  - **`Ctrl+C` 必須維持 SIGINT，不可挪用為複製**：agent 跑失控時要中斷它的能力，不能因為畫面
    上剛好有一段選取就失靈。複製用 `Ctrl+Shift+C`（macOS 的 `Cmd+C` 不衝突，故該平台用 Cmd）。
  - **選單操作完要把焦點還給終端**。實測（探針抓到）：自右鍵選單貼上之後按 Enter **不會執行**
    —— 焦點還在選單那邊，使用者得再點一次終端。`copy`／`paste` 之後都要 `focus()`。
  - **`clipboard.readText()` 沒有 workspace 邊界可言**（剪貼簿裡可能是剛複製的密碼）。它可接受
    的前提有二：導航防護確保 renderer 不會變成別人的頁面（少了它，一個 markdown 連結就能把這個
    能力交給遠端頁面）；且只在使用者明確要求貼上時讀取，不主動、不輪詢。

- **session 的命名權可以被使用者接管**（`session-rename-and-reorder`）。標籤三層優先序：
  **使用者取的名字 > pty 宣告的 OSC 標題 > 本地流水號**。使用者一旦命名，pty 想改名就**不得
  靜默覆蓋** —— 跳確認讓他裁決（採用 pty 的／保留我的）。「採用」＝命名權交還，此後不再問。
  **待確認的標題是單一欄位而非佇列**：`claude` 改標題很頻繁，堆疊 N 個對話框會把畫面淹掉。
- **拖曳排序用滑鼠事件實作，不用 HTML5 drag-and-drop** —— 後者在 CDP 下要走
  `Input.setInterceptDrags` + `dispatchDragEvent`，與探針既有的 `dragMouse`（真滑鼠序列）
  格格不入。自己做，驗收就能送真拖曳。

- **login shell 的 session 不採用 pty 宣告的 OSC 標題**（`session-navigation-and-labels`）。
  上面那條三層優先序，第二層**只對 `claude` 目標成立**。shell 送的是它預設的 prompt 標題
  （`使用者@主機:/路徑`），對使用者零識別意義；而且它**比 session 晚一秒多才到**（shell 要先
  載完 rc、畫出第一個 prompt），抵達時分頁從約 60px 暴增到約 210px，把緊鄰其後的「+ session」
  入口**往右推 150px** —— 使用者正要點下去時，按鈕從游標底下跳走（`probe:openspec` 就是這樣
  點空的，症狀看起來卻像「產品的選單壞了」）。**分頁不限寬** —— 根因是標籤內容突變，不是缺少
  寬度上限。
  - **擋在 `sessions.tsx` 的 `setTitle()`，不是顯示層。** 那是 OSC 標題進入狀態的唯一入口：
    擋在那裡，`title` 恆為 `undefined`（標籤自然退回本地標籤），`pendingTitle` 也永遠不會被設
    —— **確認對話框一起失去觸發條件**。只改顯示層的話，標籤是對了，但使用者仍會被一個「pty 想
    把它改名為 `kewang@host:/tmp/…`，要採用嗎？」的對話框打斷，而那個名字他根本永遠看不到。

## 快捷鍵（`session-navigation-and-labels` 起）

| | |
|---|---|
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 當前 repo 內的下／上一個 session（**分頁位置序**，可循環） |
| `Ctrl+↓` / `Ctrl+↑` | rail 上的下／上一個 repo（可循環） |
| `Ctrl+T` | 開啟建立 session 的入口（spawn 選單，可全鍵盤操作） |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | 終端的複製貼上（macOS 用 `Cmd`） |
| `Cmd/Ctrl+S` | 存檔 |
| `Esc` | 關閉 overlay／對話框／選單 |

**`docs/workspace-mockup.html` 對快捷鍵沉默** —— 這組綁定由該 change 定義，不是偏離雛型。

**選單必須能全鍵盤操作，這不是加分項而是前提。** `Ctrl+T` 跳出的是選單（spawn 目標要選），而原本的
`ContextMenu` 只處理 `Esc` —— **用快捷鍵叫出一個只能用滑鼠點的選單，等於沒做這個快捷鍵**。因此它加上了
「開啟時焦點落在第一項 / `↑↓` 循環 / `Enter` 觸發」，並且**必須有 `focus:` 的視覺樣式**（少了它，使用者
不知道 Enter 會按到什麼）。`ContextMenu` 是共用元件（分頁右鍵、檔案樹右鍵、spawn 選單都是它）——
動它要跑 `probe:terminal` 與 `probe:files` 回歸。

**`Ctrl+T` 的觸發走「啟動既有的建立入口」**（找到 `[aria-label="新增 session"]` 並觸發它），不自己算座標
—— 於是鍵盤叫出的選單與滑鼠點出來的**錨定在同一個地方**（`useSpawnMenu` 是從 `event.currentTarget` 的
rect 算位置的），spawn 選單的狀態也不必從 `SessionTabs` 搬出來，**鍵盤的接縫仍然只有一處**。

### 攔截點是 window 的 **capture 階段** —— 「`Ctrl+S` 必須寫進 Monaco」的教訓被誤讀了

終端幾乎永遠持有焦點，xterm 會把按鍵直接寫進 pty，Monaco 也會吃鍵。但這**不代表 window
listener 沒用** —— 既有的 `Ctrl+S` 之所以被迫註冊在 Monaco 內部（`editor/index.tsx`），是因為
它註冊在 **bubble 階段**：Monaco 攔下該鍵並停止傳播，它永遠冒不到 window。**capture 由 window
往下傳，早於 xterm 與 Monaco 綁在各自 DOM 節點上的 listener** —— `stopPropagation()` 一下，
兩者都收不到，被攔下的按鍵也就不會流進 agent。**階段選對就沒有這個問題**（design D1）。

「對話框開著時抑制快捷鍵」以 **`[role="dialog"]` 的存在**判定 —— 任何遵守這個無障礙慣例的新
對話框都自動被尊重，不必記得去某份清單註冊。代價是**漏掉 `role` 的對話框會靜默失效**，因此
`probe:keyboard` 與 `probe:terminal` 對**三種**對話框（session 命名、標題衝突、files 的）各驗
一次抑制 —— 只驗一種就宣稱涵蓋，等於沒驗。

### 三顆鍵，三種代價 —— 不要混為一談

- **`Ctrl+Tab` 是白撿的。** 它在標準終端編碼下**送不出去**（`Tab` 就是 `Ctrl+I`＝`0x09`）——
  沒有任何 shell 或 agent 綁得了它。拿走它，pty 內**零損失**。這正是 GNOME Terminal、iTerm2
  敢拿它切分頁的原因。
- **`Ctrl+↑/↓` 送得出去**（`CSI 1;5A` / `CSI 1;5B`）—— 攔截它等於從 pty 裡的程式手上**永久
  沒收**這顆鍵，而且沒有逃生口（本 change 不做鍵位設定）。實測：zsh 與 bash 預設皆未綁定；
  **唯一的犧牲者是 tmux**（`prefix + C-Up/C-Down` 的 pane resize、copy-mode 的捲動）—— 而這個
  app 本身就是要取代那個用途。
- **`Ctrl+T` 的代價最貴，採用它有兩個前提。** 實測 **zsh 與 bash readline 都把它綁成
  `transpose-chars`**。它之所以仍然可以拿：(1) 使用者的 GNOME Terminal **本來就把 `Ctrl+T` 拿去
  開新分頁了**（`new-tab = <Primary>t`），所以那個 `transpose-chars` 他早就沒有；(2) **`claude`
  沒有使用 `Ctrl+T`**（使用者確認）—— 後者是關鍵，claude session 是這個 app 的主場。
  > **此結論有前提。** 日後若 `claude`（或其他常駐 pty 的 agent）開始使用 `Ctrl+T`，本裁決即失效。
  > 退路是 **`Ctrl+Shift+T`**，成本為零（`Ctrl+Shift+字母` 在終端協定裡編碼不出來 —— 這正是複製
  > 貼上用 `Ctrl+Shift+C/V` 的理由）。
- **`Ctrl+Alt+↑/↓` 不能用** —— Linux 上被 GNOME 拿去切工作區，按鍵到不了我們。（被 WM 拿走的是
  `Ctrl+**Alt**+方向鍵`，不是 `Ctrl+方向鍵`。）
- **`Ctrl+C` 絕不挪用** —— 它必須維持中斷訊號。

> **探針送 `Enter` 必須用 `keyDown` + `text`，不能用 `rawKeyDown`。** `<button>` 是靠 Enter 的
> **預設動作**被觸發的，而 `rawKeyDown` 刻意跳過預設動作 —— 用它送 Enter，按鈕完全沒反應（實測：
> 選單裡按 Enter 建不出 session）。其餘帶修飾鍵的按鍵則相反，要用 `rawKeyDown`，否則 `keyDown`
> 附帶的 `text` 會在終端上多打一個字。

### 探針證明不了「真實鍵盤」—— 這道缺口只能由人補

CDP 的 `Input.dispatchKeyEvent` 是把事件**注入 Chromium 的輸入管線**，它**繞過**作業系統與瀏覽器
的 accelerator 層。因此 `probe:keyboard` 能證明 handler 正確、被攔下的按鍵沒流進 pty，**但不能
證明一顆真的 `Ctrl+Tab` 抵達得了 renderer**（若 Chromium 把它保留給分頁切換，探針照樣全綠）。

> **X11 的 XTEST 合成注入在本機被環境擋掉了** —— 自我檢驗：開一個自己的 X 視窗、確認焦點落在
> 它身上、`fake_input` 送一顆 `a`，**收到 0 個 KeyPress**。所以「用 xdotool 代替真人」這條路
> 在這台機器上不通。

### React 的 state updater 必須是純函式 —— StrictMode 會抓到你

**副作用絕不可寫在 `setState` 的 updater 裡。** StrictMode（**只在 dev 生效**）會刻意
double-invoke updater 來揪出不純的實作 —— 把 `onCommit` 寫在 `setDrag(current => {...})`
裡面，排序就會被套用**兩次**（交換兩次＝回到原位，看起來像「拖曳完全沒反應」）。

實測：**dev 模式拖曳失效、build 模式正常**。一邊過一邊不過，第一直覺會以為是時序 flaky，
其實是 React 在告訴你「你的 updater 不純」。副作用要移到 event handler 裡（以 ref 保存要提交
的值），updater 只回傳新 state。

### 驗 terminal 的兩個假綠陷阱

- **Enter 必須是一次真的 keyEvent。** 把 `\r` 併進 `Input.insertText` 的文字裡送出，字元確實
  抵達 pty（**終端上看得到回顯**），但 shell **從未執行那一行** —— xterm 的換行是在 keydown 上
  判讀的，不是從 textarea 的內容剖析出來的。只斷言「終端出現了我打的字」會誤判成功。
- **斷言要能區分「回顯」與「執行」。** tty 會回顯輸入行，因此 `echo COLS=$(stty size ...)` 這
  種命令，畫面上在**執行之前**就已經有 `COLS=` 了 —— 等它出現會讀到還沒產生的值（實測 build
  模式因此讀到 0，dev 模式僥倖通過，是典型的 flaky）。要用「回顯不含答案」的形式：
  `echo OUT_$((6*7))` 只有真的執行才會出現 `OUT_42`；驗 cwd 用 `echo CWD=$(pwd)`（`$(pwd)`
  在回顯裡不會展開）。

## Phase 5 的實測與踩雷（OpenSpec 側欄）

### PRD §9.2 的「原封不動重用 spek 頁面」—— 對頁面是錯的，對視覺化元件是對的

PRD 曾主張「新增一個 `IpcAdapter`，既有 spek 頁面（Dashboard / SpecDetail / ChangeDetail /
GraphView）幾乎可原封不動跑起來」。Phase 5 對它做了**對半的裁決**：

- **對「頁面」是錯的。** mockup 的側欄是為 320–620px 窄欄設計的緊湊 UI；spek 的頁面是為全寬瀏覽器
  設計的（自帶 `Layout` + `Sidebar`）。**不是同一個東西。** 側欄因此自刻 —— 而且它在 spek 根本
  沒有對應物（**spek web 的 sidebar 只是五個扁平的 nav link**，內容全在主頁面裡；真正的兩棵樹在
  **VSCode extension** 的 tree provider，那才是為窄側欄設計的，才是該抄的對象）。
- **對「視覺化元件」是對的。** `GraphView`（d3 力導向圖）與 `timeline/*`（Gantt）**不是頁面** ——
  它們吃資料、吐 SVG，對宿主零認知。**這兩個抽了**（`@spekjs/ui@1.0.0`，已發佈 npm，與 spek web
  共用同一份程式碼）。

**我一度自刻了一個二分圖取代 force graph，被使用者判定為「四不像」。** 教訓不是「早該抽套件」，
而是：**幾百行的 d3 模擬與時間軸刻度規則，重刻一次只會得到一個更差的版本，而且從此兩邊分叉。**
判斷「該不該重用」要問的是「**它綁死了版面嗎**」，不是「它在 spek 長什麼樣」。

**`@spekjs/ui` 不含 `ApiAdapter`。** 我們的 `IpcAdapter` 每個 method 第一個參數都是 `folderId`
（同時開著多個 repo），**簽名與 spek 的 `ApiAdapter` 不相容、實作不了它** —— 搬進套件對我們零價值。
但 **`openspec.*` IPC 照 `ApiAdapter` 形狀設計這個決定仍然回本了**：接上套件時換的是 UI，不是接縫。

### 跨宿主的元件有三條鐵律（`@spekjs/ui` 的 design）

1. **純呈現層** —— 沒有 router（導航是回呼）、沒有 adapter（資料由 props 進）、沒有 theme context。
2. **顏色是明確的契約**，套件**擁有自己的變數名**（`--spek-*`）。**它絕不可讀宿主的 token** ——
   spek web 叫 `--color-text-primary`，我們叫 `--color-ink`，名字對不上，圖會**畫得出來但完全沒有
   顏色**。換膚＝在 `index.css` 覆寫那 8 個變數（`probe:openspec` 有一條專門驗這件事：套件的
   `--spek-accent` 必須解析到我們的 `--color-accent`）。
3. **React 必須是 peer 依賴** —— 兩份 React 實例會讓 hooks 直接爆炸。

**d3 把顏色寫進 SVG 屬性**（命令式），不能用 `var()` —— 所以宿主換膚時圖必須重畫。套件**不去偵測**
主題（監看 `data-theme` 是在猜宿主的實作），而是由宿主換一個 `themeKey` 明說「該重畫了」。
我們只有深色主題，不傳。

### Graph ≠ Timeline

**它們是兩個不同的功能，別再搞混。** Graph 是 spec ↔ change 的**關聯結構**（無時間概念）；
Timeline 是 change 的**生命週期**（Gantt，有日期軸）。我一度以為使用者說的 graph 就是 gantt，
做出來的東西哪個都不是。

**兩者都不屬於 side panel** —— Timeline 的最小可用寬度是 **920px**（label 欄 200 + 圖表區 720，
皆為套件的預設常數），而側欄上限 620px。它們是「搞懂全局」的動作，不是「一邊駕駛 agent 一邊盯著」
的動作，**沒有與 terminal 並存的需求** → 全視窗 overlay。

### `@spekjs/core` 的四個簽名／語意陷阱（全部實測）

- **`readSpec` / `readChange` 找不到目標時回 `null`，不拋錯**；而 **`readSpecAtChange` /
  `buildGraphData` / `findRelatedChanges` 是同步函式**（會阻塞主行程做磁碟 IO）。把它們一律
  當成「非同步且會拋錯」會直接編譯失敗 —— 但更危險的是反過來：把 `null` 當成成功值傳下去。
- **`SpecInfo.path` 是絕對路徑。** 直接送給 renderer 會**破壞邊界語彙**（renderer 的全部設計
  前提是「它沒有詞彙可以表達 workspace 之外的位置」）。主行程必須翻成 folder-relative，
  翻不出來就回 `null` —— 側欄少一個「跳到檔案」的入口，好過洩漏一個絕對路徑。
- **`listChangeMarkdownFiles(repo, slug)` 不是它聽起來的意思** —— 實測回的是 repo 根目錄的
  `["CLAUDE.md", "README.md"]`，**不是** change 的 artifact 檔案。不要拿它推交叉導覽的路徑
  （改以 OpenSpec 的目錄慣例推導候選路徑，再 `stat` 確認存在）。
- **`GraphNode.label` 對 change 是 humanize 過的描述（`solo change`），不是 slug
  （`solo-change`）。** 拿它去錨定會找不到那個 change。identity 一律從 `node.id`
  （`change:<slug>` / `spec:<topic>`）取，`label` 只用於顯示。**這是探針抓到的 —— 而且我後來寫
  探針時又踩了一次同一個坑**（用 slug 去找節點的文字標籤，於是根本沒點下去）。在 d3 的圖上定位
  節點要讀它綁在 DOM 上的 `__data__.id`，不要讀文字。
- 好消息：**`SpecInfo.historyCount` 恆等於 `findRelatedChanges()` 的長度**（實測吻合），
  所以 Specs 清單的「N changes」是零成本的，不必為每個 topic 再跑一次查詢。

- **`ChangeInfo.createdDate` 只來自每個 change 的 `.openspec.yaml`（`created:` key）。**
  沒有它，change 就**放不上 Timeline**（會被歸到「沒有建立日期」那一區，Gantt 上一條 bar 都不會
  有）。造 fixture 時很容易漏掉 —— `openspec/config.yaml` 是 repo 層的，跟這個無關。

### `slug` / `topic` 是不受信任的輸入 —— 查表，不要過濾字元

它們來自 renderer，且會被 core 拿去**拼接檔案路徑**（`readChange(repoPath, slug)`）。
一個 `slug = "../../../../etc"` 就是 path traversal。

**防護是白名單**：先在快取的掃描結果裡**查表**，只對確實存在的 identifier 呼叫 core。這比
「檢查有沒有 `..`」強 —— 後者是黑名單，總有漏網的編碼形式。這與 `fs.*` 的路徑邊界是**互補而
非重複**的：那道防的是 relPath，這道防的是 identifier，兩者的詞彙不同。

### React：「把 prop 同步成 state」的 effect 會在**首次掛載時靜默失效**

side panel 的兩個身分**互斥掛載**（顯示 OpenSpec 時 FilesPanel 根本不存在）。於是跨身分導航
（「在 Files 中開啟」）送出的請求，抵達時 FilesPanel 是**那一刻才第一次掛載**的 —— 若用
「nonce 變了才套用」的寫法，`useState(nonce)` 的初始值就等於當前 nonce，兩者相等，**跳過去的
那一次永遠不會開檔**（實測：身分切過去了，畫面停在檔案樹）。**請求必須在 `useState` 的初始值
就套用。**

順帶兩條：**副作用不可寫在 effect 裡同步 setState**（`react-hooks/set-state-in-effect` 會抓
到，且它是對的）—— 用 React 官方的「渲染期間調整 state」（`if (next !== seen) { setSeen(next);
setX(...) }`）。但**渲染期間只能改自己的 state**，不能呼叫父層的 setState（React 會報
「Cannot update a component while rendering a different component」）—— 所以錨定要在
**送出請求的那個 event handler** 裡完成，不能等 panel 收到請求後回呼。

**換 folder 必須清掉待處理的跨身分請求** —— 它是**上一個 repo** 的座標。少了這步，切到新 repo
時側欄會停在「顯示某個 spec」的視圖，而那個 spec 屬於前一個 repo。**這也是探針抓到的。**

### 側欄的資料流：重取時不可回到 loading

`openspec/` 一有變更就重新取數 —— 但**保留舊資料、不回到 loading**。agent 每存一次檔就閃一次
「載入中…」，側欄會變成一塊閃爍的東西，而使用者正在讀它。`loading` 只在「還沒有任何資料」時為真。

反過來，**key 變了（切 folder、換 change）就必須把資料清掉**：沿用上一份的話，畫面會有一瞬間
顯示**上一個 folder 的 change** —— 那比 loading 更糟，因為它看起來像是真的。

### 驗「pty 宣告的標題」不能用真的 claude —— 用 PATH 上的一支 stub

OSC 標題只對 `claude` spawn 目標生效，於是那組驗收的載體必須是 claude 目標的 session。但我們
**叫不動真的 `claude` 去宣告一個指定的標題**，也不能要求每台機器都裝了它，更不該讓一支探針真的
去啟動一個 Claude Code session。

產品的 claude 模式是 `$SHELL -l -c claude` —— **從 PATH 解析**，而 pty 的 env 整份繼承 Electron
行程的 `process.env`。探針本來就自己 spawn Electron，因此把一個放著 stub `claude` 的目錄前置到
`PATH`，走的就是**產品原本那條路徑**：動的是環境，不是被出貨的程式碼。stub 本身是個互動 shell
（`exec /bin/sh -i`），既有的 `typeLine(printf '\033]0;…')` 一個字都不用改就能驅動它宣告標題。

- **`HOME` 也必須換掉，否則 stub 會被真的 claude 蓋過去（實測踩過）。** `-l` 是 login shell，
  它 source `~/.profile`，而 Ubuntu 的預設 `~/.profile` 裡有 `PATH="$HOME/.local/bin:$PATH"`
  —— 那一行把**真** claude 的目錄搶到我們前面，於是探針真的把一個 Claude Code session 跑了起來
  （分頁標籤變成它宣告的任務描述，四條斷言以看不懂的方式失敗）。把 `HOME` 指向暫存目錄後：那裡
  沒有 `~/.profile` 可 source，而且 stub 就放在該 HOME 的 `.local/bin` 裡 —— **即使 profile 真的
  prepend `$HOME/.local/bin`，它指的也是我們的目錄**。
- **`SHELL` 要釘成 `/bin/sh`** —— zsh 會自己送 OSC 標題（它的 prompt 就在做這件事），claude
  session 的標籤就不確定了。
- **「stub 真的跑起來了」要以磁碟上的憑據斷言，不要看終端畫面。** 「終端上有沒有出現某行字」對
  掛載時機、backlog 的 flush 與捲動都很敏感（dev 的 StrictMode 還會把元件重掛一次，實測因此讀
  不到）。把一個穩固的事實綁在脆弱的訊號上，只會換來一支時綠時紅的探針。

### 一支永遠紅的探針等於沒有探針

`probe:shell` 的「fs 介面只暴露已定義邊界要求的能力」這條，自 **Phase 3 起就是紅的** ——
它還在斷言「不得有 `writeFile`」，而 Phase 3 正是加入寫入能力的那個 change（封存時漏了它）。
Phase 5 把清單補齊，並補上兩條它本來就該守的：**`fs.symlink` 絕不可出現**（寫入邊界的 TOCTOU
論證完全建立在這個前提上），以及 `openspec.*` 也受同一條白名單原則約束。

**探針的斷言會隨規格過期。** 加能力到 preload 白名單時，記得那裡有一道守衛在等著。

### 驗 reload 要用 `Page.reload`，不能用頁面裡的 `location.reload()`

`location.reload()` 是**頁面發起**的導航，會觸發 `will-navigate` —— 而導航防護正是無條件
`preventDefault()` 它。於是 **reload 被 app 自己的防護擋掉，頁面根本沒有重新載入**，而探針
會在一個從未 reload 過的頁面上把整段驗收跑完（實測：看起來只是「莫名其妙地失敗」）。
用 CDP 的 `Page.reload`（瀏覽器層發起，不走 `will-navigate`）—— `probe:terminal` 一直是這樣做的。

**而且要斷言 reload 真的發生了。** 我一度寫了一支「重現腳本」證明 reload 之後一切正常，
但那支腳本從頭到尾沒切換過身分，side panel 的身分**本來就是預設的 OpenSpec** —— 有沒有 reload
都一樣，於是它對「頁面沒被換掉」完全無感，給了我一個假綠。可靠的作法是**先把狀態改成非預設值**
（例如切到 Files 身分），reload 之後看它有沒有回到預設。

### 現在有四到五個 `role="tablist"`

身分切換（`side panel 身分切換`）、OpenSpec 的視圖（`OpenSpec 視圖`）、**本 change 的 artifact
分頁**（`Change artifact`）、session 分頁列（`Session 分頁`），overlay 開著時還有第五個
（`視覺化`）。**探針裡全域的 `[role="tablist"] button[role="tab"]` 會把它們混在一起**
（`probe:files` 因此一度數到 6 個分頁）。選取時一律連 `aria-label` 一起指名。

## renderer 安全硬化的實測與踩雷（`renderer-security-hardening`）

一次資安掃描後補上的三項縱深防禦（都在既有邊界之上，補既有硬化未收攏的邊角）：renderer 的
**CSP**、`clipboard:writeText` 的**型別 guard**、xterm 的 **OSC 8 `linkHandler`**。

### CSP 的切換依據是「有沒有 dev server」，不是 `app.isPackaged`

CSP 由**主行程**施加（`session.defaultSession.webRequest.onHeadersReceived`），不是 renderer
自宣告的 `<meta>` —— 與 fs 邊界同哲學：renderer 渲染不受信任內容，它自己宣告的約束不構成防護。
已實測 **`onHeadersReceived` 對 `file://` response 確實觸發且 CSP 生效**，build 模式不必退回 meta。

dev 政策要放行 Vite HMR（inline preamble 的 `'unsafe-inline'` script、HMR 的 `ws:`），production
一律收回。**切換依 `ELECTRON_RENDERER_URL` 的存在，不是 `app.isPackaged`** —— 這是探針抓到的：
`app.isPackaged` 只有真正打包後才為 true，於是「未打包但載入 `file://` build 產物」（probe 的建置
模式、或開發者 `npm run build` 後直接 `electron .`）會**誤發 dev 政策**，更糟的是 **production 政策
從此沒有任何 probe 覆蓋**（probe 永遠 `isPackaged === false`）—— 一個經典的假綠。以 dev server 的
存在為準，`file://` 一律拿到緊政策，probe 的建置模式驗的就是 production 政策。

`style-src` 的 `'unsafe-inline'` 無法避免（Monaco／xterm／Tailwind v4 都在執行期注入 inline
`<style>`）；`script-src` 維持 `'self'`（建置產物無 `eval`，連 `'unsafe-eval'` 都不需要）；
`img-src` **放行 `https:`**。一度是擋掉遠端圖片（防追蹤 beacon），但使用者判定「markdown 本就該能
載入遠端圖片」—— 而且那 beacon 是低嚴重度（洩漏「開了這個檔」＋ IP，無程式執行／憑證竊取／邊界
逸出），使用者本就在這些 repo 裡跑 agent 與 shell，擋圖片划不來，改為放行。`http:` 不放行（近乎所有
真實圖片是 https，且擋 `http:` 同時擋掉惡意 markdown 對 `http://localhost` 的 image-GET 探測）。

### 驗 CSP 的 inline-script 阻擋，不能用 CDP 動態插入 script —— 它繞過 script-src

`probe:files` 起初用「CDP evaluate 動態插入一段 inline script，斷言它沒執行」驗 `script-src`。
**錯**：`Runtime.evaluate` 注入的程式碼繞過頁面 CSP 的 script-src（DevTools 的設計，否則無法在
嚴格 CSP 頁面除錯），那段 inline script **會**執行 —— 不管政策對不對都給假結果。改從
`securitypolicyviolation` 事件的 `originalPolicy` 端到端讀出**實際施加的政策**，斷言 `script-src`
僅 `'self'`。**擷取 `originalPolicy` 需要一個一定被擋的請求去觸發違規** —— 圖片放行後不再是觸發源，
改用 `fetch` 一個遠端主機（`connect-src 'self'` 擋下 → connect-src 違規 → originalPolicy）。遠端
圖片則反過來驗「**不**引發 `img-src` violation」（放行），這條也擋得住「又改回封鎖圖片」的 regression。

### OSC 8 連結的行為驗不進 probe —— 對照組證明了假綠

xterm 的 OSC 8 超連結走 `Terminal.linkHandler`（與 WebLinksAddon 的純文字連結是**兩套**）。未設它
會落入 xterm 內建預設：`confirm()`（文字由不受信任的 pty 輸出控制）+ `window.open()`。設
`linkHandler.activate → openLink` 讓兩套連結都匯到 `openExternal`（design D4）。

`probe:terminal` 曾有一條「真滑鼠 hover+click 一個 OSC 8 連結，斷言不彈 confirm／window.open」。
**對照組證明它是假綠**：把產品的 `linkHandler` 整個移除、重跑，斷言**仍然全綠** —— 那個 hover+click
根本沒觸發 xterm 的 OSC 8 連結激活（DOM renderer 下的 hit-test 與 Linkifier2 的 hover 追蹤，注入式
滑鼠事件驅動不了），confirm 於是恆為 false，與 linkHandler 設沒設無關。且即使觸發得了，正向「走了
openExternal」仍不可觀察（fire-and-forget、交主行程開系統瀏覽器）。**這條缺口由 code review +
design D4 補**，比照「探針證明不了真實鍵盤」。移除假綠斷言、把理由留在 probe 與此處，好過留一盞
測不到自己宣稱在測的東西的綠燈。

### clipboard 的 guard：probe 驗得到「主行程存活」，驗不到「無 uncaught exception」

`clipboard:writeText` 是 fire-and-forget 的 `ipcMain.on`、無回應通道；非字串會讓
`clipboard.writeText` 拋 `TypeError` → 主行程未捕捉例外（實測：真實 Electron 行程會跳原生錯誤
對話框）。guard 是一行 `typeof text !== 'string'` 的丟棄。`probe:terminal` 送幾個非字串、再確認
主行程仍服務後續 IPC、合法字串仍寫得進剪貼簿。**headless 侷限**：主行程有無 uncaught exception
不傳到 renderer，且 headless 下它拋了也不整個崩潰 —— 此斷言驗的是「畸形輸入後主行程與 clipboard
通道仍健康」（可觀察、真實發生），區分不了「有 guard 靜默丟棄」與「無 guard 拋例外但存活」。guard
本身由 code review + design D3 承擔。

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
