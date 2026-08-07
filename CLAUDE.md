# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **這份文件的定位**：前半是操作事實（指令、身分、慣例），後半是**教訓** —— 那些「不知道就會踩、
> 而且失敗是靜默的」的實測結論。每個 change 交付了什麼**不在這裡**，在 `openspec/changes/archive/`
> 與 `docs/PRD.md`。往這裡加東西前先問：**下一個人不知道它，會不會靜默地做錯事？** 不會的話，
> 它屬於那個 change 的 design.md。

## Project Overview

spekterm 是一個以 agent 為核心的本地開發工作台 —— 獨立的 Electron 桌面 app（私有、專有授權），
把多個「一個 repo／資料夾各自一個 `claude` session」的 terminal 包在一個殼裡，並加上一塊懂
OpenSpec 結構的側欄，讓使用者不必另外開 IDE 就能一邊駕駛 agent、一邊看著 spec 上下文。

**側欄懂 OpenSpec，正是這個 app 相對於「開四個終端機分頁」的增量價值。** 任何讓側欄看不見使用者
當下在做的事的缺陷（例如曾經看不見 worktree 裡的 change），都是在掏空這個價值命題，不是小瑕疵。

### 現況

**Phase 0–5 已封存。** 目前具備：

- **殼層** —— 多 folder 工作區（清單持久化、拖曳排序）、活動列 + rail + 三欄版面、狀態列、
  rail 頂端一個不隸屬任何 repo 的**全域 session**。
- **終端** —— `node-pty` 多 session、xterm + webgl、session 落盤與重建（claude 以 `--resume`
  續接、shell 於最後 cwd 重生並重播畫面）、休眠喚醒、終端偏好（字型／size／行高／GPU 開關）。
- **側欄** —— OpenSpec 與 Files 兩個身分、artifact 分頁與兩棵樹、Graph／Timeline overlay、
  worktree 聚合、雙向交叉導覽、`Ctrl+P` 快速開檔、續寫入口（送 `/opsx:continue`）。
  座標（來源 repo／工作目錄／錨定的 change）是 **per-folder** 的，落盤於 `panel.json`。
- **鍵盤** —— 見下文「快捷鍵」。

**尚未開始**：打包與發佈（Phase 6）、handoff（Phase 7+）。
**session 常駐**（讓 pty 活過 app 的生命）已排入路線圖但**刻意不做** —— 見 `docs/PRD.md` §11 的
tmux 與自寫 daemon 取捨。**不要把「重建」誤當成「常駐」**：關掉 app，pty 一定會死（master fd
必須有人持有），跑到一半的 build 或 dev server 救不回來。

### 權威來源

- **`docs/PRD.md`** — 產品需求的**單一權威來源**。功能範圍、路線圖、架構決策以它為準。
- **`docs/workspace-mockup.html`** — 定案的高保真 UI 互動雛型。**UI 版面與行為以它為權威**；
  PRD §6 的文字若與雛型有出入，以雛型為準。（雛型對快捷鍵沉默 —— 那組綁定不是偏離雛型。）
- **`openspec/changes/archive/`** — 每個 change 的 proposal／design／spec delta。「為什麼這樣決定」
  的完整論證住在那裡，不在這份文件。

## 開發指令

```bash
npm run dev             # electron-vite dev（開發模式）
npm run build           # 建置至 out/
npm run typecheck       # tsc：main / preload（node）+ renderer（web）
npm run lint            # eslint（**這個 repo 沒有 prettier** —— 別順手跑 npx prettier，
                        #   它會用預設值把無分號／單引號改成分號／雙引號）
npm run measure:bundle  # renderer bundle 體積報告；產物出現語言服務 worker 即非零碼結束
```

開發模式啟動時主行程會印一行掃描摘要，目標預設本 repo，以 `SPEKTERM_SCAN_PATH` 覆寫：

```bash
SPEKTERM_SCAN_PATH=../spek npm run dev
# [openspec] scan /home/me/git/spek specs=43 activeChanges=1 archivedChanges=67 …
```

### 測試分兩層 —— 分界是**成本**，不是技術手法

| | 是什麼 | 什麼時候跑 |
|---|---|---|
| `npm test`（＝ `test:unit`） | node:test —— headless、秒級、可平行、無副作用 | **隨時**。改完就跑 |
| `npm run test:e2e` | 全部 9 支探針，走 CDP 或真 Electron 主行程，驗**被出貨的那份程式碼** | **驗收時**。約十幾分鐘 |
| `npm run test:all` | 兩層都跑 | 封存前 |

**探針不併進 `npm test` 是刻意的**：它們不可平行（各自佔 debugging port、各自起 Electron 還要收屍）。
併進去的代價是「從此沒有人敢隨手打 `npm test`」。迭代時用單支 `probe:*` 入口，不要為了改一行跑
`test:e2e`。

`test:e2e` 由 `scripts/run-probes.mjs` 依序跑完（成本遞增），它做兩件單支入口不做的事：**只 build
一次**、**清掉 `electron-vite dev` 洩漏到 shell 的環境變數**。它**不 fail fast** —— 付了十幾分鐘就該
拿到完整的一張圖。

```bash
npm run probe:shell     # workspace-app-shell（視窗 + 信任模型 + preload 白名單）
npm run probe:workspace # workspace-folders / filesystem-access / workspace-layout / repo-branch /
                        #   terminal-preferences（分支呈現與更新、repo 拖曳排序、Settings 對話框）
npm run probe:files     # file-explorer / file-viewer / 編輯 / CRUD / 導航防護 / worker / CSP
npm run probe:terminal  # terminal-sessions + session-persistence + GPU renderer
npm run probe:keyboard  # keyboard-navigation（切換、排序、按鍵不進 pty、對話框抑制、捲動）
npm run probe:openspec  # openspec-data-access / openspec-panel / worktree 聚合 / side-panel-source
npm run probe:native    # native-module-toolchain（主行程載入 node-pty + spawn pty）
npm run probe:core      # spek-core-integration（主行程掃描 OpenSpec，且不開 TCP 埠）
npm run probe:identity  # app-identity（productName／appId／userData 路徑／視窗標題）

PROBE_ONLY=runMode:build npm run probe:terminal   # 只跑一個段落（迭代用；不設就跑全部）
PROBE_DISPLAY=physical npm run probe:terminal     # 逃生口：畫在實體螢幕上
```

### 探針預設跑在虛擬螢幕上

`scripts/run-probe.mjs` 把它們包進 `xvfb-run`（需 `sudo apt install xvfb`；缺了它會**明確失敗並說明
怎麼裝**，不會靜默改用你的螢幕）。CDP 的 `Input.dispatchMouseEvent` 注入的是 Chromium 的輸入管線、
與 X server 無關，換螢幕對探針而言是透明的。

**逃生口不是可有可無的。** 虛擬螢幕沒有 GPU，探針以**軟體 GL** 執行（`--enable-unsafe-swiftshader`
`--use-angle=swiftshader`，由 `scripts/lib/display.mjs` 統一供應）。**它證明得了渲染資源的生命週期，
證明不了畫素** —— 框線相不相接、粗細一不一致只有真實驅動看得出來。`terminal-sessions` 已把這條寫成
規格：**自動化驗收通過 SHALL NOT 被詮釋為「程式化繪製的呈現是正確的」**。那一類問題由 dogfood 認定。

> 少了那兩個旗標，整條 GPU 路徑會**靜默地不被驗到**：context 取不到 → app 正確地降級為 DOM
> renderer → GPU 斷言全紅。那個紅是環境造成的，而「為此把斷言放寬」等於把交付從驗收中移除。

### 探針的幾個環境事實

- **`probe:identity` 不傳 `--user-data-dir`** —— 它要驗的正是 `app.getPath('userData')` 實際解析出來
  的路徑，那個旗標會覆寫掉待驗的對象。它啟動真正的 `electron .` 再從**子行程的 argv** 讀（寫成
  Electron 主行程腳本的話，`electron <script>` 不讀 repo 的 `package.json`，只會量到預設值 `Electron`）。
- **`probe:files` 自己起 renderer dev server（`--rendererOnly`）再自己 spawn electron** ——
  `electron-vite dev` 產生的 electron 是孫行程，殺 `npx` 殺不到（留下佔 port 的殭屍），且它轉發 CLI
  參數的 `ELECTRON_CLI_ARGS` 實測未生效，探針會讀到你真實的 workspace 設定。
- **`probe:workspace` 以 `--user-data-dir` 指向暫存 profile**，因此可反覆重啟、餵它損毀的設定檔。
- **`scripts/probe-*.mjs` 一律透過 CDP 或真 Electron 主行程驗收，不在產品程式碼裡塞測試分支** ——
  要驗的正是被出貨的那份。撰寫 Electron ESM 主行程時**不可 top-level `await app.whenReady()`**
  （ready 要等主 script 評估完才觸發，會死鎖）。

## Relationship to `spek`

- 開源的 [`spek`](https://github.com/spekhq/spek)（MIT）是 OpenSpec 內容檢視器 monorepo，本機
  clone 在 `../spek`。
- **本 repo 是獨立的私有 repo**，專有授權，**不是** spek monorepo 的 npm workspace 成員。
- 重用 core 引擎與部分前端元件，詳見 `docs/PRD.md` §9。

### `@spekjs/core` 與 `@spekjs/ui`

core 發佈為 **`@spekjs/core`**（本 repo 宣告 `^1.3.0`），UI 套件為 **`@spekjs/ui`**（`^1.2.0`）。
改名的原因：`@spek` 這個 npm scope 已被他人註冊，本專案帳號無權發佈。

- **兩者必須同時升**：`@spekjs/ui@1.2.0` 的 peer 是 `@spekjs/core >=1.3.0`，分兩次升會 `ERESOLVE`。
- **`@spekjs/ui` 對 core 是 peer 依賴** —— 升級後確認 npm **dedupe 成同一份** core，樹上若有兩份，
  套件眼中的 `ChangeInfo` 與我們的就是兩個不同型別。

**升 core 的檢查清單**（每一條都由實際咬過的版本推導出來）：

1. **grep「有沒有自己建構 core 的型別」** —— 1.1.0 對 `ChangeInfo` 加了 **required** 的
   `defaultSchema`，1.2.0 對 `WorktreeInfo` / `WorktreeSource` 加了 **required** 的 `vcs`。
   純**讀取** core 產出的值不受影響；自己 `.map()` 重建或手工組物件就 `TS2741`。
   spekterm 毫髮無傷是因為主行程把 core 的陣列**原封不動轉手** —— **這個「不重建」的性質是承重的**，
   日後若在主行程改寫 change 的欄位，就接下了同步 core 型別的義務。
2. **grep「有沒有呼叫聚合 API」** —— 修在 `scanOpenSpecAggregated` / `buildGraphDataAggregated` 的
   問題打不到 `scanOpenSpec`。「repo 有 worktree」不是觸發條件，「呼叫聚合 API」才是。
   （本 repo 自 `openspec-worktree-aggregation` 起已改用聚合版。）
3. **實測 optional 欄位何時被填，不要從語意推論** —— 這個 repo 兩次栽在這裡：假設 `source` 不在
   （結果在，含絕對路徑）、假設 `worktrees` 是空的（結果不是）。

**依賴一律宣告 npm 版本，不要把 `file:` / `link:` / `portal:` 寫進版控** —— 那會讓 CI 與
`electron-builder` 看到與開發者機器不同的依賴。本機要同步改 core 時用 `npm link` 覆寫。

## Tech Stack

Electron 43.1.0（釘死）+ electron-vite、TypeScript、React 19 + Tailwind CSS v4、
node-pty 1.2.0-beta.14（釘死）、Monaco Editor、chokidar 5、react-markdown + remark-gfm、
@xterm/xterm 6 + addon-fit / addon-web-links / addon-webgl / addon-serialize /
addon-unicode-graphemes、i18next、electron-builder（Phase 6）。

完整選型與理由見 `docs/PRD.md` §8.3。幾個容易踩的點：

- **node-pty 不需要 `@electron/rebuild`**（PRD 原本寫錯，Phase 0 實測推翻）。它是 Node-API 模組，
  prebuilt 的 `.node` 可同時被 Node 與 Electron 載入：Node 22 的 ABI 是 127、Electron 43 是 148，
  但兩者 N-API 同為 10。版本必須釘 1.2.0-beta 系列 —— npm `latest`（1.1.0）缺 Linux prebuild。
- **編輯器採 Monaco，且只取語法高亮**（`basic-languages/*` 的 monarch tokenizer），**不含任何
  `language/*` 語言服務**（`ts.worker` 單獨就佔 12.65 MB；含語言服務 21.51 MB、不含 8.81 MB）。
  深度改檔走 agent 或使用者自己的 IDE（PRD §6.2）。退守 CodeMirror 6 的成本侷限於
  `src/renderer/src/editor` 這個 wrapper 模組。
  - 只要引用任何一種 `basic-languages/*` contribution，整套 editor contribution 就已被拉進來 ——
    `import 'monaco-editor/esm/vs/editor/editor.all.js'` 加與不加只差 **15 bytes**。
- **編輯器關閉 Monaco 的 native EditContext（`editContext: false`）**，改用經典的隱形 textarea。
  理由是**可驗收性**：native EditContext 的 `ime-text-area` **恆為 `readonly`**，與編輯器唯不唯讀
  無關 —— Phase 2 曾以它斷言唯讀，那對可編輯的編輯器**一樣會通過**。關掉之後 `readonly` 正確反映
  狀態，CDP 的 `Input.insertText` 也能真的打字。
- **`react-markdown` 的安全性來自預設值**：原始 HTML 降級為純文字、URL 由 `defaultUrlTransform`
  過濾。**絕不可加 `rehype-raw`、也不可覆寫 `urlTransform`** —— 檔案樹渲染的是使用者 repo 裡的
  任意 `.md`，那是不受信任的輸入。
- **終端封裝於單一 wrapper 模組**（`src/renderer/src/shell/terminal/xterm.ts`），與編輯器同一條
  約束：renderer 的其他模組不直接 import `@xterm/*`。**web-links addon 的開啟 handler 必須覆寫為
  走主行程的 `shell.openExternal`** —— pty 的輸出同樣是不受信任的內容。

## 產品身分（**已凍結，不要改**）

| | |
|---|---|
| `package.json` 的 `name` | `spekterm`（unscoped —— 本 package 是 `private`、不發佈） |
| `productName` | `Spekterm` |
| `build.appId` | `com.spekterm.app` |
| userData | `~/.config/Spekterm` |
| 視窗標題（`document.title`） | `spekterm` |

**`appId` 與 `productName` 一旦隨安裝檔發佈就凍結。** `appId` 進 macOS 的 `CFBundleIdentifier`
與 Windows 的 uninstall registry key —— 改動它的作業系統語意是「**發佈一個不同的 app**」：舊版不會
自動更新過去。`productName` 同理（它決定 userData 的落點，改了＝所有人的設定失聯）。

- **`app.getName()` 優先讀 `productName`、缺才退回 `name`** —— 正名前沒有 `productName`，於是退回
  當時那個 **scoped** 的 `name`，scope 名直接成了路徑的一層，造出帶 `@` 的巢狀 userData 目錄。
- **品牌書寫全小寫（`spekterm`），但 `productName` 首字大寫（`Spekterm`）** —— 後者是作業系統的
  顯示名稱（Dock、安裝檔名），那些位置的慣例是專有名詞。兩者不需一致。
- **`npm test` 有一條守衛**（`scripts/naming.test.mjs`）：版控中不得殘留舊名，`archive/` 除外。
  它的對照組要求「**不排除** archive 時必須命中舊名」—— 少了這條，`git grep` 的 ANSI 顏色碼曾讓
  路徑比對靜默失準而全綠。

> **`spekterm.com` 與 `spekterm.app` 已購入**（2026-07-12，Cloudflare，到期 2027-07-12）——
> `appId` 的風險就此關閉。`com.spekterm.app` 是反寫 `spekterm.com`，若該 domain 落入他人手中，
> 這個**已凍結**的 appId 就變成在宣告別人的命名空間，且事後**無法以改 appId 化解**。
> **因此續約不是行政瑣事，是承重的。**

**GitHub 位置（`spekhq/spekterm`）不是凍結身分的一部分** —— repo 改名與 transfer 皆自動 redirect。
但 **npm scope 仍是 `@spekjs`，不要「順手對齊」成 `@spekhq`**：GitHub org 名與 npm scope 不一致是
常態（`@tailwindcss/*` 的源碼在 `tailwindlabs/tailwindcss`）。

## Workflow

- **所有變更都必須使用 OpenSpec 工作流程**：proposal → design → tasks → 實作。
  以 `/openspec-new-change` 或 `/opsx:new` 建立，`/openspec-verify-change` 驗證，
  `/openspec-archive-change` 封存。
- **Archive 時必須**：更新相關文件（CLAUDE.md、README 等若有影響），並建立 git commit。
- **Archive 時 `tasks.md` 必須全部打勾** —— 做完，或**明確轉為 issue** 並把那一條改寫成
  「本 change 不做，已轉為 issue #N」再打勾。**一個帶著未打勾方框的已封存 change，等於宣稱自己
  完成了卻沒有**，而那些缺口從此不在任何工作清單上。「已知的缺口」與「被追蹤的缺口」是兩件事。

開發路線圖見 `docs/PRD.md` §11。每個 change 的完整論證見
`openspec/changes/archive/<date>-<slug>/`，**目錄名本身就是索引** —— 不必在這裡維護一份清單。

## Conventions

- 程式碼用英文撰寫
- 註解與文件使用繁體中文（台灣用語）
- **UI 文案為英文，且一律來自字典**（`src/shared/i18n/en.json`）—— 見下文「UI 文案與 i18n」。
  註解仍是繁中：那兩件事是分開的，而它們曾經混在一起（於是每個作者一邊用中文寫註解，一邊很自然地
  把中文寫進 `aria-label`）。
- 本 repo 的 Node 版本固定在 `.nvmrc`（22.22.0），與 `../spek` 一致

## 快捷鍵

| | |
|---|---|
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 當前 **rail 項目**內的下／上一個 session（**分頁位置序**，可循環） |
| `Ctrl+↓` / `Ctrl+↑` | rail 上的下／上一個**項目**（可循環，**涵蓋全域項目**；尚未選中時選第一個） |
| `Ctrl+T` | 開啟建立 session 的入口（spawn 選單，可全鍵盤操作） |
| `Ctrl+Shift+W` | 關閉當前 focused 的 session |
| `Shift+↓` / `Shift+↑` | 把**選中的 repo** 在 rail 上移動一格（**不循環**；全域項目上無操作） |
| `Shift+→` / `Shift+←` | 把 **focused session** 在分頁列上移動一格（**不循環**） |
| `Ctrl+P` | **側欄持有焦點時**開啟檔案快速搜尋。**終端持有焦點時讓路給 pty** |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | 終端的複製貼上（macOS 用 `Cmd`） |
| `Cmd/Ctrl+S` | 存檔 |
| `Esc` | 關閉 overlay／對話框／選單 |

**原生 menu bar 已整個移除**（`Menu.setApplicationMenu(null)`，app 層設一次涵蓋整個應用程式）——
**不是** `autoHideMenuBar`，那只是「平時隱藏、按 `Alt` 浮出」，而 app 從未定義任何 menu 內容，
浮出來的是一條空的東西擋畫面。**macOS 未實測**（它的應用程式 menu 是系統層的，不在視窗內），
列為 Phase 6 打包前確認項。

### 攔截點是 window 的 **capture 階段**

終端幾乎永遠持有焦點，xterm 會把按鍵直接寫進 pty，Monaco 也會吃鍵。**但這不代表 window listener
沒用** —— 既有的 `Ctrl+S` 之所以被迫註冊在 Monaco 內部，是因為它註冊在 **bubble 階段**，Monaco
攔下該鍵並停止傳播，它永遠冒不到 window。**capture 由 window 往下傳，早於 xterm 與 Monaco 綁在各自
DOM 節點上的 listener** —— `stopPropagation()` 一下，兩者都收不到，被攔下的按鍵也不會流進 agent。

**`Ctrl+P` 是例外，它掛在側欄容器的 capture 階段而非 window。** 「焦點在側欄之內」**就是**「按鍵
事件行經側欄容器」，那是 DOM 事件傳播的定義。終端與側欄是兩塊**並列的 Panel、互不為祖先**，xterm
的按鍵又來自它自己的隱形 textarea —— 事件根本不會行經側欄。**不需要任何「如果焦點在終端就不處理」
的判斷。**

### 每一顆鍵的代價都不同種 —— 不要混為一談

- **`Ctrl+Tab` 是白撿的。** 它在標準終端編碼下**送不出去**（`Tab` 就是 `Ctrl+I`＝`0x09`），
  pty 內零損失。GNOME Terminal、iTerm2 敢拿它切分頁正是這個原因。
- **`Ctrl+Shift+<字母>`（`Ctrl+Shift+W`／`C`／`V`）代價確定為零** —— 在終端協定裡編碼不出來。
  **選 Shift 版而非 `Ctrl+W`**：後者在 zsh 是 `backward-kill-word`、bash 是 `unix-word-rubout`。
- **`Ctrl+↑/↓` 送得出去**（`CSI 1;5A`/`B`），攔截它等於從 pty 裡的程式手上**永久沒收**這顆鍵。
  實測 zsh 與 bash 皆未綁定；**唯一的犧牲者是 tmux**（pane resize、copy-mode 捲動）—— 而這個 app
  本身就要取代那個用途。
- **`Ctrl+T` 最貴，採用它有兩個前提。** zsh 與 bash readline 都把它綁成 `transpose-chars`。
  可以拿是因為：(1) 使用者的 GNOME Terminal 本來就把它拿去開新分頁了；(2) **`claude` 沒有使用它**。
  > 此結論有前提。日後若 `claude` 開始使用 `Ctrl+T`，本裁決即失效。退路 **`Ctrl+Shift+T`** 成本為零。
- **`Shift+arrow` 是「明知主場在用仍然拿走」。** 實測 zsh 與 bash 未綁定，但**已知的犧牲者正是
  `claude` 自己的 agents view**。使用者在知情下裁決採用（排 repo 的頻率遠高於用那個 view）。
  > 此裁決有前提。退路 **`Ctrl+Shift+arrow`**（`CSI 1;6A`–`D`，實測 shell 亦未綁定，且與 `Ctrl+↑↓`
  > 成對：Ctrl ＝ 移動游標，加 Shift ＝ 移動東西）。**改鍵位只動 `KeyboardNavigation.tsx` 的一個
  > 判斷 + spec + probe**，沒有任何資料格式綁在鍵位上。
- **`Ctrl+P` 讓路給 pty**：實測 `claude` 以它顯示 previous history，而 agent 是這個 app 的主場。
  使用者裁決只做焦點判定版；退路 `Ctrl+Shift+P` 成本為零。
- **`Ctrl+Alt+↑/↓` 不能用** —— Linux 上被 GNOME 拿去切工作區（被拿走的是 `Ctrl+Alt+方向鍵`，
  不是 `Ctrl+方向鍵`）。
- **`Ctrl+C` 絕不挪用** —— 它必須維持中斷訊號。agent 跑失控時要中斷它的能力，不能因為畫面上剛好
  有一段選取就失靈。

### 四條跨快捷鍵的規則

- **四顆 session 快捷鍵的作用域是「rail 上選中的項目」，不是「選中的 repo」。** 那四條 requirement
  各帶一句「沒有選中的 repo 時 SHALL 為無操作」—— **那是行為條款而不是措辭**，照字面實作會讓全域
  項目上四顆鍵全部失效，而型別檢查對此完全無感。
- **對話框開啟時抑制快捷鍵，以 `[role="dialog"]` 的存在判定** —— 任何遵守這個無障礙慣例的新對話框
  自動被尊重，不必記得去某份清單註冊。代價是**漏掉 `role` 的對話框會靜默失效**，因此驗收須以
  **多種**對話框各驗一次（session 命名、files 的、Graph／Timeline overlay）。這條紀律寫在
  `keyboard-navigation` 的 spec 裡。`Ctrl+P` 的抑制判準與作用域必須與此**完全一致**（document-wide、
  同時看 `[role="menu"]`）—— 兩者若分歧，不會有紅燈。
- **排序快捷鍵有一條導航快捷鍵沒有的例外：可編輯文字讓路。** `Shift+arrow` 就是文字選取鍵，
  全域 capture 攔下它，Monaco 連選一個字元都做不到。**判準不能寫成「activeElement 是不是
  textarea」** —— xterm 與 Monaco 的輸入路徑**都是** textarea，那樣寫排序快捷鍵會在終端持有焦點時
  （也就是絕大多數時間）**靜默失效**。兩段式：**先問「在不在 `.xterm` 之內」**，再問是不是
  input／textarea／contenteditable。兩個相反的失效方向都要驗。
- **選單必須能全鍵盤操作，這不是加分項而是前提。** 用快捷鍵叫出一個只能用滑鼠點的選單，等於沒做
  這個快捷鍵。`ContextMenu` 因此有「焦點落在第一項 / `↑↓` 循環 / `Enter` 觸發」，並且**必須有
  `focus:` 的視覺樣式**。它是共用元件（分頁右鍵、檔案樹右鍵、spawn 選單）—— 動它要跑
  `probe:terminal` 與 `probe:files` 回歸。
- **`Ctrl+T` 走「啟動既有的建立入口」**（`querySelector` 找到它並觸發），不自己算座標 —— 於是鍵盤
  叫出的選單與滑鼠點出來的**錨定在同一個地方**，spawn 選單的狀態也不必從 `SessionTabs` 搬出來。

### 選取或焦點改變時，目標要被捲進可視範圍

rail 縱向 + 分頁列橫向。此前 renderer **一個 `scrollIntoView` 都沒有** —— rail 超出視窗時按
`Ctrl+↑↓`，切過去了卻看不到，使用者會直接判定快捷鍵壞了。

- **`block: 'nearest'` 不會順便讓滑鼠點選免於捲動。** `nearest` 只保證「**完全**可見就不捲」——
  部分可見的元素它會捲最小的量把它補齊，於是點下緣那半截的列，**那一列會在游標底下跳走**。
  滑鼠的例外是一條真的要寫的路徑（`useScrollIntoView`），不是免費的副產品。
- **判定是「最後一次輸入來自哪裡」，不是「消費一次旗標」。** 直覺寫法（pointerdown 設旗標、effect
  讀完即清）會被一次**沒有造成狀態改變**的點擊留下殘值（點已選中的列、點捲軸、點空白處都不觸發
  effect），下一次可能就是 `Ctrl+↓` —— 症狀是「第一次沒捲、第二次才捲」。
- **作用域是單一容器，不是整個 renderer。** 在 rail 點一列 session 之後，**分頁列仍應**把對應分頁
  捲進視野。rail、rail 的每一塊、分頁列**各持有一份**。

## 檔案系統邊界與信任模型

renderer 以 `(folderId, relPath)` 定址檔案系統，**永遠不傳絕對路徑** —— 它沒有詞彙可以表達
workspace 之外的位置。邊界檢查一律在**主行程**執行；preload 與 renderer 同屬一個行程樹，在那裡
檢查等同沒有檢查。

- **包含關係一律用 `path.relative(root, target)` 判定，絕不用 `target.startsWith(root)`。**
  前綴比對會把 `/a/bc` 誤判為位於 `/a/b` 之內。`src/main/fs-boundary.test.ts` 有一條測試就是為了讓
  這個寫法必定失敗；不要「簡化」掉它。
- **symlink 必須在比對之前解析**（root 與 target 兩端都要 `realpath`）。
- **讀取路徑（`resolveWithinRoot`）與寫入路徑（`openExistingForWrite` / `resolveNewWithin`）分家，
  不可混用。** 讀取回傳一個路徑，呼叫端拿去 `open`；寫入若沿用這個「檢查完再依原路徑開啟」，
  已實測會逸出邊界（check 與 open 之間 leaf 被換成越界 symlink）。寫入必須解析與開啟不可分割：
  對 `realpath` 的結果、帶 `O_NOFOLLOW` 開啟。
- **TOCTOU 與 hard link 以威脅模型承擔，不是機制性防護。** Node 沒有 `openat`，`O_NOFOLLOW` 只約束
  最後一段。關鍵在**白名單不暴露 `symlink()`、寫入的 leaf 檢查一律用 `realpath`（不是 `lstat`）**
  —— renderer 既造不出、也操縱不到 race 所需的 symlink。這道邊界防的是**被入侵或有 bug 的
  renderer**，不是已拿到本機寫入權的攻擊者。
  > **此結論有前提。** 任何後續 change 若要暴露 `symlink()`、或把寫入 leaf 檢查改為 `lstat` 語意，
  > 本論證即失效，必須重新論證。完整論證見 `file-editing-and-crud` design D1–D8（`O_NOFOLLOW` 為
  > POSIX-only，Windows 退為 `lstat` 二次確認，且**本 repo 無 Windows 實測**，列為 Phase 6 打包
  > 驗收前必須確認的項目）。
- **原地寫入，不做「暫存檔 + 改名」。** 後者會把 folder 內的 symlink 取代成普通檔案、斷開 hard
  link，並讓一次存檔在 watcher 上呈現為「刪除後新增」（已實測）。
- **watcher 受同一道邊界約束**：`followSymlinks: false`（它**預設是 `true`** —— folder 內一個指向
  `/etc` 的 symlink 被展開時，watcher 會走出去，把邊界外的檔名經事件推給 renderer），且事件的絕對
  路徑轉成 `(folderId, relPath)` 之前必須**再過一次 `isWithin`**。**且 app 自身的寫入不得回推為
  外部變更事件** —— 否則每次存檔都會警告使用者磁碟被改動。
- **`slug` / `topic` 是不受信任的輸入 —— 查表，不要過濾字元。** 它們來自 renderer，且會被 core
  拿去**拼接檔案路徑**。防護是白名單：先在快取的掃描結果裡查表，只對確實存在的 identifier 呼叫
  core。這比「檢查有沒有 `..`」強（後者是黑名單）。與 `fs.*` 的路徑邊界**互補而非重複** —— 那道防
  relPath，這道防 identifier。

### 兩條 Phase 2 的實測，至今仍是承重的

- **「一個樹上的路徑對應一個被監看的目錄」是錯的。** folder 內指向 `sub/` 的 symlink，在樹上是兩個
  節點、在磁碟上是同一個目錄，而 chokidar 只認絕對路徑。訂閱（樹上的 relPath）與監看（磁碟上的
  realpath）必須分層並以**參考計數**對接，事件也必須**以訂閱者使用的路徑改寫**後才推送 —— 否則收合
  其中一個節點會停掉另一個的監看，而經 symlink 展開的節點永遠收不到事件。
  **驗收 fixture 裡沒有 symlink，這個 bug 就會躲過整輪全綠的驗收。**
- **主行程拋出的錯誤帶不了 `code` 到 renderer。** Electron 的 IPC 序列化**只保留 `message`**，
  自訂屬性一律遺失。需要結構化的失敗資訊（錯誤碼、檔案大小與上限）時，要在 IPC 接縫上改回傳
  `{ ok: false, code, detail }` 結果物件。純邏輯層仍然拋錯。

### 列舉檔案（`quick-open` 的 `listFiles`）

首選 `git ls-files`，失敗或不適用時退回手寫遞迴列舉。四個實測踩雷：

- **`fs.readdirSync` 與 `fs/promises.readdir` 對同一個 `{ recursive: true }` 行為不同。** 前者**會**
  走進 symlink 目錄（列出邊界外的檔名、讓同一個檔案出現兩次），後者**不會**。第一版的對照組用了
  promises 版，於是**天真實作與正確實作的結果完全相同、對照組沒有變紅** —— 我差點據此認為「邊界會
  從 symlink 漏掉」是個假警報。**結論是手寫遞迴**（只在 `dirent.isDirectory()` 為真時下鑽），
  而理由比原本更強：一個在兩個同語意 API 之間不一致、且未見於文件的行為，不該拿來當邊界防護的依據。
- **git 的錯誤訊息會被在地化。** 這台機器的 git 講繁體中文（「致命錯誤: 不是一個 git 版本庫」），
  於是 `/not a git repository/i` 匹配不到 ⇒ **每一個非 git 目錄都被判成「列舉失敗」**。spawn 時設
  **`LC_ALL=C`**。這與「比對 git 輸出一律加 `--no-color`」是同一族，旋鈕從顏色換成語言。
- **`git ls-files` 預設 `core.quotePath=true`** —— 非 ASCII 檔名會被 C-quote 並包上雙引號。失效方式
  是清單裡那一筆看起來像亂碼、選了之後讀檔回「找不到」。用 **`-z`**（順帶解決檔名含換行；
  `-c core.quotePath=false` 只解決前者）。
- **`git ls-files` 在被 `.gitignore` 涵蓋的目錄裡 exit 0 且無輸出** —— 在 exit code 上與「成功」無法
  區分。使用者既然正在那裡工作，把它呈現為空是錯的，因此「成功但為空」也退回保守列舉。

**模糊比對的兩條**：貪婪掃描會把查詢的開頭浪費在目錄名上（`score` 對 `src/score.ts` —— `s` 與 `c`
被 `src` 吃掉，分數低到排在一個人工的 `s-c-o-r-e.ts` 之後）。修法是**先只在檔名上比對**，命中就加一
個大的 bonus —— 那同時實現了「檔名命中優先」這條 requirement。另外**連續命中的權重必須大於詞邊界
獎勵**，否則「每個字元都落在 `-` 之後」的散落命中會勝過連續命中。

### git 分支（`repo-branch`）

rail 的每一列顯示該 folder 的 git 當前分支。**以讀取 `.git/HEAD` 實作，不 spawn `git`** —— 這是每個
folder、每次載入都要做的判定，與 `hasOpenSpec` 同一條理由（也因此 `workspace-folders` 那條「偵測
SHALL NOT 呼叫任何外部程式」依然成立）。`.git` 是**檔案**時（worktree / submodule）要解 `gitdir:`
那層間接：worktree 寫絕對路徑、submodule 寫相對路徑，兩種都要吃。

**監看分支要兩層 watcher，兩者都反直覺（實測）**：

- **`git checkout` 是寫 `HEAD.lock` 再 rename 上去**，HEAD 的 inode 每次都變。直覺會認為監看單一檔案
  的 watcher 第一次就失聯 —— **但 chokidar 撐得住**（會在 rename 後重新 attach，連續切三次分支三次
  都收到 `change`）。所以**監看單一檔案即可**，不必退而監看整個 `.git/`（那會被 `index.lock`、
  `refs/`、object 寫入的事件淹沒）。
- **但監看一個「尚不存在」的 `.git/HEAD` 是行不通的** —— `git init` 之後 800ms 內收不到任何事件
  （連父目錄都不存在，chokidar 無從 attach）。因此**第一層**監看 folder 根目錄（恆常存在，`depth: 0`，
  以 basename `.git` 過濾），用來等 `.git` 出現或消失，再據以建立／銷毀**第二層**。

**而家目錄要跳過 git 狀態偵測。** 那條路上有一個 `spawnSync` 且每 2 秒一次 —— dotfiles-as-git-repo
是常見設定，於整個家目錄跑它會**週期性阻塞主行程**。cwd 恰為家目錄時不做。

### 幾道不屬於 `fs.*` 白名單、但同樣承重的邊界

- **導航防護是渲染 markdown 的前提，不是加分項。** preload 綁在 `webContents` 上，**每次導航後都會
  重新注入，不分來源**。使用者 repo 裡一個 `[click](https://evil.com)` 就能把 renderer 帶去遠端
  頁面，而那個頁面的 `window.workspace.fs` 就是我們的檔案系統白名單。
- **`did-start-navigation` 不可當作 renderer 重新載入的訊號。** 它與 `will-navigate` 對同一次導航
  都會觸發，`preventDefault()` 只是隨後取消它 —— 於是每擋下一次導航，就會順手把該 renderer 的所有
  watcher 關掉（已實測）。要用 `did-navigate`。**「導航開始」不等於「導航發生」。**
- **`did-navigate` 不只要清 watcher，也必須殺光 pty。** reload 不銷毀 `webContents`，只掛
  `'destroyed'` 的清理不會觸發 —— 舊 pty 會變孤兒，且新頁面的 xterm **永遠收不到它們的輸出**。
- **terminal 的 cwd 邊界不是沙箱。** `create` 只收識別碼、不收路徑（renderer 在語彙上無從指定
  workspace 外的 cwd），但這**只約束初始 cwd** —— pty 起來之後使用者可以 `cd` 到任何地方，那正是
  終端的用途。**不要把它與 `fs.*` 白名單的沙箱語意混為一談。**
  - **全域 session 與「把 `~` 加進 workspace」的差別是全部的重點**：後者會把 `fs.*` 白名單與 Files
    檔案樹對整個家目錄開放；全域 session 只改變 pty 的初始工作目錄。**`filesystem-access` 因此
    一條未改** —— 家目錄不是任何 folder，renderer 一個位元組都讀不到它。
  - **git 分支要讀的 gitdir 常在 folder 邊界之外**（worktree / submodule）。那是主行程自己的檔案
    存取，不經 renderer 的 `(folderId, relPath)` 詞彙 —— **不是白名單的擴大**，推給 renderer 的只有
    分支字串。
- **`clipboard.readText()` 沒有 workspace 邊界可言**（裡面可能是剛複製的密碼）。可接受的前提有二：
  導航防護確保 renderer 不會變成別人的頁面；且只在使用者明確要求貼上時讀取，不主動、不輪詢。
- **`clipboard:writeText` 需要型別 guard** —— 它是 fire-and-forget 的 `ipcMain.on`、無回應通道，
  非字串會讓 `clipboard.writeText` 拋 `TypeError` → 主行程未捕捉例外（真實 Electron 行程會跳原生
  錯誤對話框）。

### 工作目錄識別碼：三個前提**各自擔保不同的事**

session 開得進 worktree 之後，邊界保證從「renderer 沒有路徑詞彙」換成「**不可逆識別碼 + 主行程
查表**」。第一版 design 把三個前提寫成「缺一不可」，**那是錯誤的推理**：

| 前提 | 擔保什麼 | 破壞它會怎樣 |
|---|---|---|
| 解析是**查表**、來源是 **git 的列舉** | **圍堵性** | 可達集合不再受限於列舉結果 ⇒ 邊界失守 |
| key **不可逆**（sha1 前 8 碼） | 路徑不外洩到 renderer | 洩漏路徑，但**可達集合一點也不會變大** |
| 查無此 key **即拒絕**，不 fallback | **誠實性** | 退回 folder 根逸出不了任何邊界，但使用者會以為 session 開在他選的地方 |

**為什麼要分清楚**：日後任一條被鬆動時，得能判斷「這會不會破壞邊界」。捆成一句「缺一不可」就沒有
判準可用了。

- **落盤禁路徑的理由是獨立的**：那些內容**下次啟動時會被解析**，一個落盤的路徑等同一個繞過查表的
  位置指定。於是定址可以用 folder-relative 路徑（renderer 的合法詞彙），**落盤只能用識別碼**。
- **兩道夾制，只放寬一道等於沒放寬**：`#initialCwd`（重建側）與 `cwdOf()`（**記錄側**）是獨立的
  兩道。只放寬前者的話，`cd` 到邊界外 worktree 的位置**從一開始就不會被寫進 `sessions.json`**，
  重建側收到 `undefined`，一切看起來正常。**失效方向是靜默的。**
- **folder 自身以「省略識別碼」表示** —— folder 不在版控之下時 `listWorktrees` 回空陣列，**根本
  沒有 key 可放**。

### CSP

由**主行程**施加（`webRequest.onHeadersReceived`），不是 renderer 自宣告的 `<meta>` —— 與 fs 邊界
同哲學：renderer 渲染不受信任內容，它自己宣告的約束不構成防護。已實測 `onHeadersReceived` 對
`file://` response 確實觸發。

- **切換依 `ELECTRON_RENDERER_URL` 的存在，不是 `app.isPackaged`。** 後者只有真正打包後才為 true，
  於是「未打包但載入 `file://` build 產物」會**誤發 dev 政策**，更糟的是 **production 政策從此沒有
  任何 probe 覆蓋**（probe 永遠 `isPackaged === false`）—— 一個經典的假綠。
- `style-src` 的 `'unsafe-inline'` 無法避免（Monaco／xterm／Tailwind v4 都在執行期注入 inline
  `<style>`）；`script-src` 維持 `'self'`（建置產物無 `eval`）；**`img-src` 放行 `https:`** ——
  markdown 本就該能載入遠端圖片，而 beacon 是低嚴重度（洩漏「開了這個檔」＋ IP，無程式執行／邊界
  逸出），使用者本就在這些 repo 裡跑 agent。**`http:` 不放行**（順帶擋掉對 `http://localhost` 的
  image-GET 探測）。

## 終端與 pty

### spawn 與生命週期

- **`node-pty` 的 spawn 對 execvp 失敗「不會」同步拋錯。** 實測 `spawn('/nonexistent')` → 不 throw、
  pty 以 exit code 1 結束、`execvp(3) failed.` 由 `onData` 送出。於是「shell 路徑無效」與「claude
  找不到」殊途同歸，都經 `onExit` + 終端上的錯誤訊息呈現，**不是** `create` 回一個錯誤碼。
- **GUI app 常缺使用者 shell 的 PATH**（從桌面啟動不會繼承 `.zprofile`），直接 `spawn('claude')`
  會 ENOENT。兩種目標因此都經 login shell：`$SHELL -l` / `$SHELL -l -c claude`。
  **這道緩解的真正驗證點在 Phase 6 打包後從桌面啟動** —— `npm run dev` 是從終端起的，測不出來。
- **輸出的訂閱必須早於 `create`。** pty 在 `create` 回傳的那一刻就開始吐第一個 prompt，而
  `TerminalView` 要等 React 渲染完才 attach —— 中間沒有接收者的輸出會**直接消失**。
  `SessionsProvider` 因此在任何一次 create 之前就掛好唯一的 `onData`，尚未 attach 的先進 backlog。
  （與 Phase 2 的「**先訂閱、再列目錄**」同源：那個窗口裡的變更會兩頭落空。）
- **終端必須跨「切換 folder」常駐。** 只掛載當前 folder 的 session 的話，切走再切回時 xterm 實例已
  被卸載，先前的 scrollback 就沒了。因此掛載全部、以 `display:none` 決定顯示 —— 代價是隱藏時
  `FitAddon` 量到 0，由隱藏轉為顯示時必須重新 `fit()`。
- **`disposed` 的 exit 不是 session 結束。** 關視窗與 reload 時我們自己殺光所有 pty，那些都會觸發
  `onExit`。「已結束的 session 不持久化」若直接寫成「收到 exit 就移除」——**關一次視窗，
  `sessions.json` 就被清空了**。`ExitReason` 因此區分 `self`／`killed`（真的結束）與 `disposed`
  （我們收工時殺的：持久化原封不動，**且那個 exit 也不可推給 renderer** —— reload 後的新頁面已用
  同樣的 id 重建，一則遲到的 exit 會把剛重建好的分頁標成已結束）。
- **一個 claude session 是兩個 `/bin/sh` 行程**（`$SHELL -l -c "claude …"` 的那層 shell 不會 exec，
  實測）。**拿行程數去斷言「只喚醒了一個 session」，會把好的實作判成壞的** —— 以 `-l` 認出領頭
  行程，數量才等於 session 數。

### pty 的環境必須抹掉「巢狀 Claude Code」的標記 —— 否則續接功能**靜默失效**

spekterm 若由一個 agent 啟動（dogfooding 時的常態），Electron 會繼承那個 Claude Code session 的
環境變數，pty 再整份繼承下去。於是裡面每一個 `claude` 都認為自己是**巢狀的子 session**，而**巢狀的
claude 不寫 transcript**（實測：對話真的發生了，但 `~/.claude/projects/` 底下什麼都沒有）。
後果：`--resume` 必然失敗 → 自癒接手 → 使用者拿到一個**能用的** claude，只是對話永遠是全新的。
**沒有錯誤訊息、沒有紅燈，連探針也抓不到**（探針用的是 stub claude，它不管 env）。

- **元兇是單一一個變數**（二分實測）：**`CLAUDE_CODE_CHILD_SESSION`**。單獨拿掉 `CLAUDECODE` 或
  `CLAUDE_CODE_ENTRYPOINT` 都無效。
- **絕不以 `CLAUDE*` 前綴一概剝除** —— `CLAUDE_CODE_OAUTH_TOKEN` 是認證用的。`ptyEnv()` 的名單明確
  列舉，且不含任何帶 KEY／TOKEN 的名字。
- login shell 讓副作用很小（使用者自己在 rc 裡設的會被 source 回來）。**兩種 spawn 目標都適用**。

### `claude` CLI 的實測結論（全部左右了設計）

- **`--session-id <uuid>` 可由我們指定對話 id**；`--resume <uuid>` **沿用**原 id（`--fork-session`
  才換）。於是 id 可被持久化並直接續接，**不必去猜哪個 `.jsonl` 是我們的**。
- **`--session-id <已存在的 id>` 會直接報 `already in use`** —— 於是 `claude --resume X ||
  claude --session-id X` 這種自癒寫法是個陷阱（claude 因其他原因非零退出時 `||` 會撞號）。
- **開了 session、還沒跟它講話就關掉 app → claude 根本不寫 transcript**，重建時 `--resume` **必定
  失敗**。**這不是邊角，是主線情境**（開個分頁準備等一下用）。
- **`--resume` 在互動模式下會自己把過去的對話重畫在終端上** —— 因此 **claude session 絕不重播我們
  存的畫面快照**（會看到兩份歷史），**只有 shell 存快照**（順帶省下絕大部分快照 IO）。
- **`--resume` 的查找是 git repo 關聯的**（實測：主工作目錄 ↔ worktree 互通，無關的非 git 目錄
  查不到）。於是「worktree 消失 → 退回 folder 根」這條退路是安全的，對話不會丟。
  > 限制：這是 claude 的**內部行為**，可能隨版本改變。但**降級方向安全**（猜錯的下場是自癒成新
  > 對話，不是撞號讓 session 死掉）。
- **`claude` 一啟動就宣告任務式的 OSC 標題**（`✳ Claude Code`），**即使你一個字都還沒講**。
  所以**分頁標題不是「有對話」的證據**。

### session 的重建

- **spekterm 的 session id 與 claude 的對話 id 必須解耦。** 續接失敗時必須以**全新的** uuid 開新
  對話（沿用舊的會撞號），若兩者是同一個欄位，換號就等於換掉 session 的身分（分頁 key、focus、
  順序、錨定全要跟著搬）。因此持久化有兩個識別碼：`id`（**永不改變**）與 `claudeSessionId`（可換）。
- **續接策略：一律 `--resume`，pty 若在 3 秒內以非零碼結束就判定失敗，以全新 uuid 重試一次**
  （至多一次）。**判準只看「時間 + 結束碼」，不解析 claude 的輸出** —— 這條路徑零 layout 依賴。
- **`#heal()` 是主線情境，而它對 renderer 完全不可見**（`status` 一直是 `running`）。因此凡是
  「pty 誕生時要做的事」，自癒那條路上都要自己再做一次：**推尺寸**（否則新 pty 一輩子停在 80×24）、
  **沿用 session 記住的 cwd**（否則開在 worktree 的 session 會靜默站到別的地方）。
  這兩件事**都是漏掉後才補的**，位置相同、疏漏同型。
- **喚醒把「pty 先誕生、終端後掛載」的順序倒了過來。** `fit()` 在「尺寸沒變」時回 `null`。喚醒
  休眠 session 時：終端先顯示 → `fit()` 成功量到尺寸 → 送 resize → **pty 還不存在，被丟掉**；而
  `lastCols` 已記成那個尺寸 → 之後再 `fit()` 一律回 `null` → **再也沒有人告訴 pty 真正的尺寸**。
  修法：pty 誕生的那一刻（`status` 轉 `running`）把終端當下的尺寸告訴它（`XtermHandle.size()`，
  它不做「有沒有變」的偵測 —— `fit()` 回答不了這個問題）。**新建的 session 不會踩到。**
- **`\x1b[?1049l` 只能條件式地送。** `SerializeAddon` 會把終端模式一起序列化（使用者關 app 時正開
  著 vim，快照裡就真的有 `?1049h`），所以重播完可能就站在 alternate buffer 裡。但兩個直覺修法都
  錯：寫在歷史**之前**對 alt screen 毫無作用；**無條件**寫在歷史之後會毀掉正常情況 —— `?1049l` 會
  **還原「進入 alt screen 當下所儲存的游標」**，沒進去過時那是 **(0,0)**，游標被拉回左上角，分隔線
  蓋掉歷史第二行。**正解**：只有 `term.buffer.active.type === 'alternate'` 時才送。不動游標的重置
  （滑鼠追蹤、SGR）則無條件送。
- **重播完要自己把游標挪到內容之後**（只用相對移動的 `\n` —— 絕對定位在一個尺寸不同的終端上會落在
  錯的地方），再寫分隔線，**然後才接上 live 串流**。
- **快照的取用不可以是「讀完即刪」** —— StrictMode 把掛載 effect 跑兩次，第一次就把快照取走了，
  第二次（真正存活的那個 xterm）拿到 `undefined`，畫面一片空白。改為非破壞性讀取，`close()` 才清。
- **休眠的提示會被 xterm 蓋住。** `.xterm` 是 `position: relative` 且由 `handle.open(host)` 在
  effect 裡 append —— 排在 React children **之後**，兩者都 `z-index: auto` → 依 tree order 繪製。
  修法是 host 給 `relative`、提示給 `z-10`。而**「這個 session 恢復不了」的提示不該是
  `pointer-events-none`** —— 它背後是一個永遠不會活過來的終端，沒有東西值得點。

### 標題與命名權

三層優先序：**使用者取的名字 > pty 宣告的 OSC 標題（僅 `claude` 目標）> 本地流水號**。

- **使用者一旦命名就是永久接管** —— pty 其後宣告的標題一律**靜默地不予呈現**（不覆蓋、不確認、
  不提示）。交還的唯一路徑：**把名字清空**。
  > 這裡原本有一個「pty 想改名，要採用嗎？」的確認對話框，已移除 —— **它的前提是錯的**。它假定
  > 「pty 想改名是罕見事件，值得問一次」，但 `claude` 隨任務進展**持續**改標題。而「保留我的名字」
  > 只清掉待裁決欄位、**不記錄使用者已經拒絕過**，於是下一次判定條件完全相同，對話框再跳一次。
  > 當初的 spec **已經察覺** agent 會頻繁改名（才有「待確認的標題是單一欄位而非佇列」），但緩解只
  > 做到「不要一次問太多次」，沒處理「**沿著時間軸反覆問同一個問題**」。
  > **教訓：一個高頻事件上的確認，要問的是「這個問題值得問嗎」。** 而它的答案是可預測的 ——
  > **「使用者取的名字 > pty 的標題」這條優先序本身就已經是那個裁決。**
- **接管期間 pty 的標題仍持續被記錄，只是不呈現** —— 這是「清空即交還」得以即時的前提。若直接
  丟棄，清空後會退回 `claude 1`，空等到 pty 下次宣告為止（可能永遠不會來）。
- **login shell 不採用 OSC 標題。** shell 送的是 `使用者@主機:/路徑`，對使用者零識別意義；而且它
  **比 session 晚一秒多才到**（要先載完 rc、畫出第一個 prompt），抵達時分頁從約 60px 暴增到約
  210px，把緊鄰其後的「+」入口**往右推 150px**。**分頁不限寬** —— 根因是標籤內容突變。
  - **擋在 `sessions.tsx` 的 `setTitle()`，不是顯示層** —— 那是 OSC 標題進入狀態的唯一入口。
    只改顯示層的話，標籤是對了，但衍生的行為（當年的確認對話框）仍會被觸發。

### 複製、貼上、滑鼠

- **不能靠瀏覽器原生的路徑。** xterm 的選取**不是 DOM selection**（它自己畫），原生的
  「Ctrl+C 複製選取文字」對它完全無效。複製走 `term.getSelection()` + 主行程 clipboard；貼上走
  `clipboard.readText()` + `term.paste()`。**不用 `navigator.clipboard`** —— 它的 `readText()` 在
  Electron 中受 `clipboard-read` 權限模型擺布，跨平台不一致。
- **選單操作完要把焦點還給終端。** 實測：自右鍵選單貼上之後按 Enter **不會執行**（焦點還在選單）。
- **右鍵 gate 在 mouse reporting**（`term.modes.mouseTrackingMode`）—— 程式接管滑鼠時右鍵**讓位給
  它**（使 claude 的右鍵貼上生效），沒接管時才開我們的複製／貼上選單。
- **中鍵雙貼的兇手是 Chromium 原生的中鍵貼上。** `terminal-clipboard` D5 當年寫「X11 的中鍵貼的是
  PRIMARY，而瀏覽器拿不到它」—— **那個假設在 Electron 裡不成立**。React 的 `onMouseDown`（bubble）
  擋不掉它：其一 bubble 晚於 xterm 掛在 `.xterm-screen` 上的 listener；其二**原生貼上掛在
  `auxclick` 而非 mousedown**。**正解**：host 上的 **capture 階段**原生 listener，對 button 1 的
  `mousedown`／`mouseup`／`auxclick` **一律 `preventDefault`** + `stopPropagation`，並在 mousedown
  做**唯一一次**貼上。
- **終端裡的連結歸誰管**：login shell 中純文字 URL 與 OSC 8 兩套都正常。差別只在 **claude 開了
  mouse reporting** —— xterm 此時把左鍵**轉發給程式**並 `cancel()` 掉自己的處理，而**修飾鍵是一起
  編碼進去的**，於是 `Ctrl+click` 是 **claude 自己**去開那個連結的。`Shift+左鍵`反而沒反應，因為它
  被 xterm 攔去做「強制選取」—— **Shift 從來就不是「連結的繞道」**。
  - **推論：「點檔案路徑開在側欄」在 claude session 裡做不到。** 唯一的攔法是在 capture 階段搶下
    **左鍵**，但左鍵是 claude 整個 UI 的主要互動面，代價與當初搶右鍵不是同一個量級。
    **真正的解是讓 spekterm 被 claude 認成 IDE**（它在 VS Code／JetBrains 裡就是這樣開檔的）——
    那要獨立論證，尚未進行。
- **OSC 8 超連結走 `Terminal.linkHandler`**（與 WebLinksAddon 的純文字連結是**兩套**）。未設它會
  落入 xterm 內建預設：`confirm()`（文字由不受信任的 pty 輸出控制）+ `window.open()`。
  兩套都要匯到 `openExternal`。

### 渲染

- **webgl 是唯一可用的 GPU renderer。** `@xterm/addon-canvas` 對 xterm 6 已死（latest 0.7.0，
  **唯一仍宣告 peer `^5.0.0` 的 addon**，2023-11 後未再發佈）。
- **並存的 webgl context 上限實測恰為 16，超出時最舊的靜默被丟棄、`webglcontextlost` 一次都不觸發。**
  於是「只給當下顯示的那一個終端」是**正確性要求而非優化** —— `onContextLoss` 的自癒救不了它
  （那條倚賴一個通知，而這裡根本沒有通知）。
- **關掉它的開關是必要的**：自動降級只擋得住「資源取不到」，擋不住「取得了但驅動畫錯」，那只有
  使用者看得出來。
- **行高預設 1.0，理由是「因為降級路徑存在」。** DOM renderer 下框線字元是**靠字型自己的 glyph 去
  拼**的，glyph 只有約 1em 高而 row 是 `fontSize × lineHeight` —— **行高大於 1 時上下兩列的 `│`
  接不起來**。實測（同一張表格）：DOM + 行高 1.3 是 7 段 / 30px 空洞，DOM + 行高 1.0 與 webgl 都是
  1 段 / 0 空洞。**webgl 在垂直方向的貢獻是「讓行高自由」，不是「修好縫」** —— 但 DOM 是真實可達
  的降級路徑（context 取不到、驅動有問題、使用者自己關掉），預設 1.3 的話落到 DOM 的使用者開箱就
  是破的表格，而他們正是最沒能力自救的一群。
- **webgl 真正修掉的是水平方向的分數像素。** 出貨預設下 DOM 的 `cellW = 9.63`（垂直線佔的 x 數
  `[1,2,2,1]`），webgl 是 `9`（`[1,1,1,1]`）。峰值亮度相同 —— **不是變暗，是被抹開**：外框線恰好
  落在整數像素而銳利，內部的線被反鋸齒攤到兩個像素。**同一張表格裡有的線是一條、有的是兩條淡的。**
- **`customGlyphs` 是官方機制**（xterm 6 的公開選項，預設 true），程式化繪製 block element 與
  box drawing，且**對 DOM renderer 無效**。
- **「捲動時破版」始終沒有被合成重現，是由 dogfood 認定修好的。** 合成 fixture 量到的是 fixture 的
  結構而非渲染缺陷。**紀律要留著**：下次遇到「只有真實環境才觸發的呈現問題」，能驗的就驗，驗不到
  的標示清楚交給 dogfood，不要用一個合成的綠燈假裝它被證明了。

### 字元寬度（判定單位是 grapheme cluster）

xterm 內建的寬度表是 **Unicode 6**，而 agent 依現代 wcwidth 排版 —— 每個 emoji 都讓那一行少一格。
這條缺陷與「一個 cell 內怎麼畫」（行高、GPU）**相鄰但不同層**。修法是載入
`@xterm/addon-unicode-graphemes` 並開啟 `allowProposedApi`。

| | claude 排版 | 內建 v6 | `addon-unicode11` | `addon-unicode-graphemes` |
|---|---|---|---|---|
| `✅` U+2705 | 2 | 1 ✗ | 2 ✓ | 2 ✓ |
| 星形平面 CJK 擴充 | 2 | 2 ✓ | 2 ✓ | 2 ✓ |
| `⚠️` U+26A0+FE0F | 2 | 1 ✗ | **1 ✗** | 2 ✓ |
| ZWJ 序列 | 2 | 3 ✗ | **6 ✗** | 2 ✓ |
| 膚色修飾 | 2 | 2 ✓（碰巧） | **4 ✗** | 2 ✓ |

**多個 code point 合起來算一個字，而查表式的實作沒有地方可以表達這件事** —— 於是「先用比較小的
`unicode11`，之後再換」不是可行的退路。

- **`allowProposedApi` 是硬性前提**：未開時 `loadAddon()` **當場**拋錯，沒有「載入了但沒生效」的
  中間狀態。而「版本字串在不在清單裡」是「寬度對不對」的**代理判準** —— 真正會靜默失敗的是
  「載入成功、版本對、寬度表卻答錯」，那只有「代表性字元集逐類別正確」的驗收擋得住。
- **不新增設定開關** —— 字元寬度是確定性的，沒有 GPU 那種「取得了但驅動畫錯」的失效模式。
- **效能**：同一實例重建、n=9 取中位數 —— 含 emoji **+4.6%**（4000 行多約 1.5ms），純 ASCII 在
  雜訊內。**初次量測 n=1 且跑出 −37%，唯一誠實的結論是「不具資訊量」，不是「沒有退步」。**

### 字型偏好

- **預設不該是一個「不存在的字型」。** 原本首選 `'JetBrains Mono'` —— 這台機器沒裝、專案也沒打包，
  於是靜默落到系統預設等寬字。字型從此與宣告不符，而且**畫面上看不出來**。預設收斂為誠實的
  `ui-monospace, monospace`；與使用者終端一致由**偏好**達成，不是靠猜一個字型名。
- **列舉系統等寬字用 `fc-list :spacing=100 family`**（`:spacing=100` 正是 fontconfig 的 monospace
  判準）。這是使用者開設定的一次性動作，spawn 一次 `fc-list` 可接受 —— 與「分支偵測不 spawn git」
  的熱路徑紀律不同。目前只支援 Linux。
- **UI 是純 `<select>`，不是可打字的 combobox** —— dogfood 兩次否決（free-text 難用、datalist
  combobox 要先清空才能換）。
- **preview 要含 box-drawing**：DOM renderer 下 preview 的框線就是終端的框線。（若只跑 GPU
  renderer，這條就反了，得重新想。）
- **掛載時「什麼都沒變」不該 resize。** 字型 effect 一開始無條件 `fit()` + `resize()`，於是每個終端
  掛載時都對 pty 多送一次 **SIGWINCH**，shell 收到它會**重畫 prompt，把既有輸出往上推**。
  `setFont` 要回報「有沒有真的改動 xterm 的選項」，沒改動就不打擾 pty。

## OpenSpec 側欄與 `@spekjs`

### 重用的判準是「它綁死了版面嗎」

完整論證見 `docs/PRD.md` §9.2（該節已依 Phase 5 的實作結論改寫）。一句話：**側欄自刻**（spek 的
頁面是為全寬瀏覽器設計的，不是同一個東西），**`SpecGraph` / `ChangeTimeline` 抽進 `@spekjs/ui`**
（它們吃資料、吐 SVG，對宿主零認知）。判斷「該不該重用」要問的是「**它綁死了版面嗎**」，不是
「它在 spek 長什麼樣」—— 我一度自刻了一個二分圖取代 force graph，被判定為「四不像」。

日常會踩到的兩條：

- **套件擁有自己的顏色變數名（`--spek-*`），絕不讀宿主的 token。** spek web 叫
  `--color-text-primary`，我們叫 `--color-ink` —— 名字對不上時圖會**畫得出來但完全沒有顏色**。
  換膚＝覆寫那 8 個變數。**React 必須是 peer 依賴**（兩份實例會讓 hooks 直接爆炸）。
- **d3 把顏色寫進 SVG 屬性**（命令式），不能用 `var()` —— 宿主換膚時圖必須重畫。套件**不去偵測**
  主題（監看 `data-theme` 是在猜宿主的實作），由宿主換一個 `themeKey` 明說「該重畫了」。

### Graph ≠ Timeline

**它們是兩個不同的功能。** Graph 是 spec ↔ change 的**關聯結構**（無時間概念）；Timeline 是 change
的**生命週期**（Gantt，有日期軸）。**兩者都不屬於 side panel** —— Timeline 的最小可用寬度是
**920px**，而側欄上限 620px。它們是「搞懂全局」的動作，不是「一邊駕駛 agent 一邊盯著」的動作，
沒有與 terminal 並存的需求 → 全視窗 overlay。

### `@spekjs/core` 的簽名與語意陷阱（全部實測）

- **`readSpec` / `readChange` 找不到目標時回 `null`，不拋錯**；而 **`readSpecAtChange` /
  `buildGraphData` / `findRelatedChanges` 是同步函式**（會阻塞主行程做磁碟 IO）。危險的是把 `null`
  當成成功值傳下去。
- **`SpecInfo.path` 是絕對路徑。** 直接送給 renderer 會**破壞邊界語彙**。主行程必須翻成
  folder-relative，翻不出來就回 `null` —— 側欄少一個「跳到檔案」的入口，好過洩漏一個絕對路徑。
- **`listChangeMarkdownFiles(repo, slug)` 不是它聽起來的意思** —— 實測回的是 repo 根目錄的
  `["CLAUDE.md", "README.md"]`。改以 OpenSpec 的目錄慣例推導候選路徑，再 `stat` 確認。
- **`GraphNode.label` 對 change 是 humanize 過的描述（`solo change`），不是 slug（`solo-change`）。**
  identity 一律從 `node.id` 取。在 d3 的圖上定位節點要讀 DOM 上的 `__data__.id`，不要讀文字。
- **`ChangeDetail.source` 是一個宣告了但從不被填的欄位**（core 沒有聚合版的 `readChange`）。
  要來源就**從掃描結果取**（`ChangeInfo` 本來就帶著它）。
- **`ChangeInfo.createdDate` 只來自每個 change 的 `.openspec.yaml`（`created:` key）。** 沒有它，
  change 就**放不上 Timeline**。造 fixture 時很容易漏 —— `openspec/config.yaml` 是 repo 層的，無關。
- **`SpecInfo.historyCount` 恆等於 `findRelatedChanges()` 的長度**（實測吻合），所以 Specs 清單的
  「N changes」是零成本的。
- **`schemaOrder` 的 CLI 快取 key 是 `repoRoot::schema`，不跨 worktree。** 影響比直覺小：它發生在
  `readChange`（開啟某個 change），**不在掃描路徑上**。**不在本 app 疊一層自己的快取** —— spek 用
  同一份 core，要改該在 upstream 改。

### worktree 聚合

**涵蓋範圍、去重、graph 節點命名全部委由 core**（upstream #17／#23）。宿主端只做四件事：來源 DTO
（丟棄絕對路徑，換成識別碼＋分支）、三個讀取根、兩層 watcher、Timeline 分組的適配。

- **「worktree ≤ 1 時 core 靜默退回非聚合」是最大的假綠來源。** `scanOpenSpecAggregated` 在
  `aggregate: false` **或工作目錄只有一個**時，回傳結果等同 `scanOpenSpec`。這讓回歸風險極低 ——
  但也意味著**驗收的 fixture 若 `git worktree add` 失敗，每一條斷言仍會通過**。
- **讀取根有三個，不是一個**（core 的聚合是 `specs: main.scan.specs` —— spec 一律取自主工作目錄）：

  | 讀什麼 | 根 |
  |---|---|
  | change 的內容 / 某個 change 當下的 spec 版本 | **該 change 自己的來源工作目錄** |
  | spec 的內容 | **主工作目錄**（不是 folder 自己！） |
  | relPath 的翻譯基準 | **folder**（翻不出來就 `null`） |

  沿用單一根的話兩種情形會壞：folder 是 **linked worktree** 時只存在於主工作目錄的 spec **列得出來
  卻打不開**；folder 是 repo 的**子目錄**時**每一個** spec 都打不開。
- **`isMain` 與 `isFolderRoot` 不可互代。** `listWorkspaces` 從一個 linked worktree 呼叫時，`isMain`
  掛在**該 repo 的主工作目錄**上。要問的是「**agent 站的地方，就是 change 在的地方嗎**」＝
  `source.path === folder.path`。DTO 因此帶兩個布林：`isMain`（來源的**性質**，呈現用）與
  `isFolderRoot`（來源與**這個 folder** 的關係，能力判定用）。folder 本身是 linked worktree 時兩者
  相反。
- **gitdir 要多解一層 `commondir`。** worktree 清單住在 **common dir** 底下的 `worktrees/`，而
  `.git` 檔案只指到 `<main>/.git/worktrees/<name>` —— **那底下永遠不會有 `worktrees/`**。
  少了 `resolveCommonDir()`，watcher 會 attach 到一個永不存在的路徑，而 chokidar **不報錯、也不發
  事件**。
- **監看工作目錄清單本身是承重的，不是加保險** —— worktree 是「先建立目錄、後寫入 change」，只監看
  既有工作目錄的 `openspec/` 時，新建 worktree 的第一次寫入**沒有任何 watcher 在場**。這與「先訂閱、
  再掃描」直接打架，解法是分兩層。基礎層要 `depth: 0` 且只理會 `addDir`／`unlinkDir`：實測在
  worktree 裡跑一次 `git commit` 會產生 3 個檔案事件，不收窄的話每次 commit 都重跑一次聚合掃描
  （約 175ms）。
- **`isWithin` 是純字面比較**，而這裡第一次拿兩個獨立來源的絕對路徑相比（`workspace.json` vs
  `git worktree list`）。**兩端目前都是 realpath**，所以比得起來。**若 workspace 的路徑正規化改變，
  每一個 change 的「跳到檔案」會同時靜默消失。**
- **連帶一個已接受的行為切換**：folder 是 repo 的子目錄時，該 repo 只要有 ≥2 個工作目錄，整個 repo
  的 spec 與 change 就會突然出現在側欄（`listWorkspaces` 是對 repo 作答，不是對子目錄）。

### 聚合圖的節點識別碼

聚合關係圖的 change 節點 id 是 `change:<worktreeKey>:<slug>`。**我們送出的圖必須先還原識別碼、
再剝掉來源 —— 順序是承重的**（判斷「那個 key 存不存在」靠的正是即將被剝掉的 `source`）。

只做剝除會送出一個**不自洽**的節點，而**兩個消費端都不報錯**：`SpecGraph` 把整串當成 slug 交出去
⇒ **錨定到一個不存在的 change，還會寫進落盤**；`changeTopicsMap` 查表落空 ⇒ **Timeline 的分組全部
掉到「無 topic」**。

- **`changeNodeSlug` 回傳的是 slug，不是識別碼** —— 前綴要自己補，且**只能對 `type === 'change'`
  的節點施加**（否則 `spec:auth` 會變成 `change:spec:auth`）。**直接拿回傳值當 id（裸 slug）是最
  危險的寫法**：兩個消費端對它照樣運作，只有「識別碼恰為 `change:<slug>`」這條斷言擋得住。
- **邊的兩端也要換。** 而 `GraphEdge.source` 是**端點**、`GraphNode.source` 是 **worktree 來源** ——
  兩個 `source` 在同一段程式碼裡，極容易看混。只換節點不換邊，症狀與完全沒換相同。
- **`@spekjs/ui` 內部對聚合 id 的處理不一致**：`SpecGraph` **在 `node.source` 存在時**才剝掉 key，
  `buildLanes` / `changeTopicsMap` 不剝。**spekterm 是唯一刻意剝掉 `source` 的宿主**，於是那條
  guard 對我們恰好是假的。**抄別人的行為表時要連 guard 一起抄。**
- **邊指向一個不存在的 spec 節點是合法狀態，不是 bug**（upstream 已正確駁回）。spec 節點來自**已
  納入 specs 的 capability**，而一個 change 的 delta 可以提議一個**尚未納入**的 topic —— 那正表達
  「這個 change 提議一個新 capability」。與聚合無關。
- **產生格式的地方與解析格式的地方應當同居。** 解析原本住在 `@spekjs/ui`，正是 upstream #25 的
  溫床（core 開始加 key，ui 的解析沒跟上，**沒有任何東西會紅**）。已回報並採納：現在是
  **`@spekjs/core/graph-node-id`**（node-free subpath）—— **於是主行程 import 得到它**
  （`@spekjs/ui` 的入口會拉進 JSX／d3／React，Node 環境碰不得）。
  > **判斷「該不該回報 upstream」的一個訊號：你正要手寫第二份它剛抽出來防止重寫的東西。**

### 反向導覽與工作目錄清單

判準是「**以工作目錄根由長至短逐一嘗試**，剝除該根之後首段為 `openspec` 且其後符合已知結構者即
命中」。

- **folder 自身必須恆入清單（以空字串），不經 `toRelPath`、不取決於 git 列舉是否成功。**
  三條路都會靜默把它弄丟：`toRelPath(root, root)` 回 **`null`**；非 git 目錄的 `listWorktrees` 回
  **空陣列**；folder 是 repo **子目錄**時那筆指向 repo 根而落在邊界外。
  **清單裡不以 `null` 佔位** —— 空字串是 folder 自身的合法值，兩者會在消費端糾纏。
- **`toRelPath` 對 folder 自身回 `null`，所以「合成 + 翻譯其餘」會產生兩筆。** 照抄那個結構寫新
  API，**每一個 folder 即其 repo 主工作目錄的普通 repo**（最常見的情形）都會得到兩筆，而後者標著
  「位於此 folder 之外、無法瀏覽」—— 選擇器於是在每個 git repo 都冒出來。**正解是「合併」而非
  「附加」**：列舉中 `path === root` 的那一筆**就是**代表 folder 自身的那一筆。以 `self` / `others`
  的**互斥分割**表達，讓不變式由結構保證，而不是靠事後去重。
- **spec 一律來自主工作目錄，所以它的入口要標示來源。** worktree 裡的 spec 檔案跳過去呈現的是
  主工作目錄那一份，而往返會把使用者送到**另一個檔案**。**仍然給入口**（反向導覽的目標是 **topic**
  這個實體，不給只會製造另一種不對稱），**但必須標示**，且只在該 repo 有**多於一個**工作目錄時標
  （單一工作目錄時沒有歧義，標示只是噪音）。
  > **同一個決定上，頻率假設連錯兩次，方向還相反。** 第一版裁決「不給入口」（把罕見當常態）；
  > 翻轉之後又寫「只有跑過 `/opsx:sync` 才會分歧」（把常態當罕見）。實際上工作流要求 archive 前在
  > worktree 裡 backfill main spec —— **分歧是每個 change 出貨前的常態終局**，而那正是使用者最常
  > 盯著側欄的時刻。**該動的是代價的處理，不是裁決本身。**

### Files 的工作目錄

- **權威恆為完整的 folder-relative 路徑，只有「呈現給人看的那一段」剝前綴。** 回報是三件事免費成立：
  未存變更跨工作目錄切換自然存活（鍵沒變）、反向導覽的判定一行不用改、watch 不受影響。
  - **`title` 必須留在完整座標系** —— 它同時是 6 個 probe 助手的選擇器。剝掉它，那些助手**選不到
    元素而回 `false`**，導航靜默停住，其後的斷言驗的是上一個狀態。麵包屑因此 `title={完整路徑}` 而
    顯示剝前綴 —— **兩者要成對驗**，只驗一邊的話「兩邊都不剝」或「兩邊都剝」都會通過。
- **樹根解析必須在父層，因為它同時是 key。** 在 `FilesPanel` 內解析的話，樹會先以 folder 根建起來、
  清單抵達後再整棵換掉，而 key 沒變、初始狀態也不會重設。連帶：`useFileTree` 的**根狀態鍵是
  `rootPrefix` 而非 `ROOT_PATH`** —— `rootLoading` / `rootError` 漏改，工作目錄根的「載入中…」與根層
  錯誤訊息會**靜默地永遠不出現**。
- **「使用者主動切換」四個字是規範性的。** 切換工作目錄要關閉開啟中的檔案，但**跨身分導覽也會切換
  工作目錄**，而它緊接著就要開一個檔案。兩者若共用觸發點會變成「開了又關」或「關了又開」。
  **而 bug 的方向不對稱**：關檔那條 scenario 兩種順序都會通過，只有跨身分導覽那條會時綠時紅 ——
  紅燈會指向錯的地方。觸發點因此是**選擇器的選取事件**。
- **`fs.*` 的定址一行未改** —— 可選的工作目錄一律在 folder 邊界內，切根只是換一個路徑前綴。

### 側欄的資料流與座標

- **重取時不可回到 loading。** `openspec/` 一有變更就重新取數，但**保留舊資料** —— agent 每存一次檔
  就閃一次「載入中…」，側欄會變成一塊閃爍的東西，而使用者正在讀它。`loading` 只在「還沒有任何
  資料」時為真。**反過來，key 變了（切 folder、換 change）就必須把資料清掉** —— 沿用上一份的話會有
  一瞬間顯示**上一個 folder 的 change**，那比 loading 更糟，因為它看起來像是真的。
- **側欄座標（來源 repo／工作目錄／錨定的 change）是 per-folder 的，落盤於 `panel.json`。**
  刻意**不與 folder 清單同居** —— `parseWorkspace` 是 all-or-nothing 且它損毀的代價是「失去所有
  repo」，而錨定一次 change 就要重寫一次那份清單。
  - **鍵刻意措辭為「rail 項目的識別碼」**（今日等於 folder id）—— **issue #5**（rail 把 worktree
    列為一級項目，尚未做）到來時是**擴充鍵空間**而非重做。而 per-folder 的模型順帶回答了 #5 自陳
    未解的那個問題：**rail 選中 worktree ＝ 設定工作目錄維度，不是 repo 維度** ⇒ OpenSpec 維持
    聚合、Files 以該 worktree 為根。同理 Files 的工作目錄欄位命名為**側欄來源的維度**而非 Files
    專屬，#5 到來時是擴充消費者。
- **切換來源時 `anchoredChange` 必須重置** —— slug 隸屬於某個 repo，沿用舊 slug 會對著一個在新 repo
  不存在的 change 顯示空狀態，**看起來像壞掉**。「一個 (repo, change)」在資料上是「來源 + 隸屬於它
  的錨定」，不是一個獨立的複合鍵。
- **「一堵拿不到 pid 的牆」擋住了「側欄自動跟隨 agent 實際在動的 repo」這條路。** Linux 的 inotify
  **不回報 pid**，fanotify 需 `CAP_SYS_ADMIN`。於是「哪個 session 改了哪個 repo」在核心層面就拿不到。
  被這堵牆逼一下之後，正確的框架是「把側欄的來源與 rail focus 解耦」—— 不需要偵測、不需要歸因。
  > **這條擋住未來想「加點自動化」的衝動**：那條路沒有可靠的入口，除非願意讀 claude 的 transcript，
  > 而那是把設計綁在 claude 的內部檔案佈局上。
- **「側欄選一個 repo 而非聚合多個」的決定性理由**：Files 的檔案樹是單一 repo 的階層，本就一次只能
  呈現一個來源；若 OpenSpec 聚合而 Files 只能選一個，兩個身分的來源語意會分裂。
- **`watcher.on('error', () => {})` 使「watcher 建不起來」與「檔案沒變」無法區分**（`openspec-service.ts`）。
  `inotify` 的 `max_user_instances` 是 **per-user 的 128**，app 每監看一個 folder／工作目錄／檔案樹
  就吃一個。**workspace 加夠多 repo 之後，側欄可能安靜地停止更新，而且沒有任何跡象。**
  已開為 **issue #9**（要不要降級 polling、要不要呈現給使用者，各自需要論證）。

### 與 agent 的狀態橋接（`claude-status-bridge`）

狀態列上「只有 agent 算得出來」的那幾段（模型顯示名、context 用量百分比、花費、rate limit）不是
我們算的 —— spawn 時以 **`--settings`（公開的 CLI 旗標）**注入一個 `statusLine` 命令，把 claude
已經算好的 payload 落盤，主行程監看後推給 renderer。

- **不解析 transcript。** 那裡面**有** model id、effort、token usage、cwd、gitBranch；**沒有**花費、
  rate limit、**context window 大小**。而 `message.model` 的 **`[1m]` 後綴被拿掉了** —— 1M 與 200k
  兩種變體長得一模一樣，**百分比的分母算不出來**。
- **`--settings` 吃 inline JSON 也吃檔案路徑，且是疊加**（只有 `statusLine` 被指定）。
- **注入的命令看得到我們設給 pty 的環境變數** —— 落點因此可以是 per-session 的路徑，同一份設定檔給
  所有 session 共用。
- **payload 內含 `context_window.context_window_size`** —— **於是不需要維護一張「模型 → context
  window」的對照表**。那種表會隨新模型過期，而**它失效的樣子是一個看起來很正常的錯誤百分比**。
- **`rate_limits` 在全新 session 的 payload 中缺席** —— **每個欄位都必須能單獨缺席**。
- **預設啟用**（第一版「預設關閉」的理由被實測推翻）：`⏵⏵ auto mode …` 那條**不是** statusLine，
  兩種情況都在。自訂的 statusline 是額外多出來的一行 —— **接管一個空位，損失為零**。
  **但有一條保險**：使用者已有自訂 statusline、而我們**讀不出**它的命令時，**整個不注入** ——
  注入會讓他失去自己那條，不注入只是少一個他還不知道存在的功能。**兩種失敗的代價不對等，就往代價
  小的那邊倒。**
  > **這推翻了「別綁 claude 的內部佈局」嗎？沒有，而區別是承重的**：那條教訓的情境是「猜錯 → 撞號
  > → session 死掉」，**降級方向是災難性的**；這裡猜錯的下場是狀態列少幾個欄位。而且我們綁的是一個
  > CLI 旗標與它自己的輸出。**同一條紀律不該無差別套用 —— 要問的是「失效時會怎樣」。**

### 續寫入口（`artifact-continuation`）

側欄在 change 尚缺 artifact 時提供入口，觸發即把 **`/opsx:continue <slug>` 送出並執行**於 focused
session 的 pty。

- **送 slash command 而非自然語言**：行為本就是「產生恰好一個然後停」、帶 slug 可省掉反問，
  而且它是 ASCII，**於是「該用中文還是英文」這個沒有好答案的問題根本不存在**。
- **一顆按鈕而非每個缺漏各一顆** —— 續寫流程一次只產生一個且由它自己挑，四顆按鈕會承諾一個它給
  不出的選擇。
- **`null === null` 的誤啟用是這裡最危險的一條。** 全域 session 沒有所屬 folder（`null`），而全域
  項目的側欄來源**預設也是缺席** —— 樸素的 `panelSource === session.folderId` 會讓入口亮起來，然後
  把 change 識別碼送進一個站在家目錄的 agent，它會在**家目錄**建出一個同名的空 change。
  **而一個取決於「今天恰好用 `?.` 還是 `??`」的安全判定，本身就不可接受**，不論它今天倒向哪一邊。
  判定因此抽成純函式並由**對照組**守住。
- **第 4 個條件（來源工作目錄）不能寫成「比對兩個識別碼」**：開在 folder 根的 session **沒有識別
  碼**，而 folder 本身是 linked worktree 時**它自己的 change 帶著識別碼** ⇒ 錯誤地停用一個會成功的
  入口。正確的是兩段式 —— `session 有 key ? origin.key === session.key : origin.isFolderRoot`。
  **舊判準沒有消失，它降級成了新判準的一個分支。**
  > **一般形式：一個條件依賴的「巧合」被打破時，它通常不是變得多餘，而是需要更精確的判準。**

## UI 文案與 i18n

**使用者看得到的每一個字都來自字典 `src/shared/i18n/en.json`，語言是英文。** 主行程與 renderer
**共用同一份字典**（兩個 realm 各持有一份 i18next 實例，`resources` 指向同一個 JSON）。

**「使用者可見的文案」有四類，後兩類最容易漏 —— 它們住在主行程，看起來像內部錯誤：**

1. renderer 的介面文字（JSX、`aria-label`、`title`、驗證訊息、空狀態）
2. 主行程的**原生對話框**（關窗時的未存提示）
3. 主行程**經 IPC 送達畫面**的錯誤訊息 —— `TerminalError` 與 `FsServiceError` 的 message 都會被畫
   到畫面上
4. **寫進 pty 串流給人讀的訊息**（session 重建的重播分隔線；只有**文字**進字典，ANSI 與框線字元
   留在程式碼）

**`console.*` 與內部不變式的 `throw` 不進字典**（沒有使用者會讀到），**但一律英文** —— 守衛是一刀
切的，而一刀切是對的：「這個字串會不會被顯示」**無法靜態判定**（見第 3 類）。

- **字典是 `.json` 而不是 `.ts`，因為 probe 要 import 它**（`scripts/*.mjs` import 不了 TypeScript；
  Node 22 的 import attributes 讀得到 JSON）。**而「JSON ⇒ key 沒有型別安全」是錯的**：把
  `typeof en` 餵進 i18next 的 `CustomTypeOptions`，`t('rail.emty')` 就會**編譯失敗**並提示正確拼法。
  **不需要任何型別產生器。**
- **i18n 於模組載入時初始化，不是導出一個「請記得呼叫」的 init。** **未初始化的 `t()` 不會拋錯，
  它回傳 `undefined`** —— 畫面上就只是什麼都沒有。而「誰先載入」在三個環境裡並不一致（主行程於
  `whenReady`、renderer 於進入點、**單元測試根本沒有進入點**）。
- **`i18next` 必須在 `dependencies`，不是 `devDependencies`。** main 的 build 用
  `externalizeDepsPlugin()` —— 它在**執行期 require**，而 electron-builder 只把 `dependencies` 打進
  asar。**放錯區塊時 dev 模式完全正常，打包後一啟動就 `MODULE_NOT_FOUND`。**
- **英文的語序與中文不同 —— 前綴／後綴選擇器不能機械替換。** `Remove {{name}} from workspace` 把
  變數放到了中間；rail 的展開／收合中文都以「的 session」結尾（一個 `$=` 通吃），英文
  `Expand/Collapse sessions in {{name}}` **沒有共同的固定後綴**。`copy.mjs` 因此提供
  `prefixOf` / `suffixOf` / `patternOf`；**`prefixOf` 在前綴為空時拋錯** —— `[aria-label^=""]` 會
  匹配**每一個**元素，那比選不到更糟，因為它會靜默地通過。

### 三道守衛，缺一不可（它們互補，不重複）

| 守衛 | 擋什麼 | 少了它會怎樣 |
|---|---|---|
| `copy-language.test.mjs` | 產品原始碼的字串字面值含 **CJK** | 文案慢慢變回中文（沒有東西擋著） |
| `aria-label-source.test.mjs` | **硬編**的 `aria-label`（**含本來就是英文的**） | 改文案時探針**靜默地選不到元素**；`Ctrl+T` 連紅燈都沒有 |
| `i18n-key-safety.test.mjs` | 字典 key 的**編譯期**型別安全 | 打錯的 key 在執行期把 `rail.emty` 印在畫面上 |

- **第一道必須走語法樹（`ts.createSourceFile`），不能 regex 掃行** —— **豁免註解正是它的核心語意**
  （repo 慣例是繁中註解），而註解與字串在同一行裡分不開。豁免 `*.test.ts` 與 `scripts/`。
- **第二道是第一道抓不到的**：`Side panel`、`Change artifact`、`Specs`、`Tasks` 這些 `aria-label`
  本來就是英文，CJK 守衛看不見它們 —— 第一輪實作正好漏掉了它們。
  （注意：這道守衛走**行掃描**，在註解裡寫出該屬性的字面形式也會被判違規。）
- **第三道守的是一份 ambient declaration。** `i18next.d.ts` 的 `CustomTypeOptions` **沒有任何模組
  import 它** —— **拿掉那個檔案，`npm run typecheck` 照樣 exit 0**（已實測）。**一個「拿掉之後沒有
  任何東西會紅」的防護，就是一個遲早會被拿掉的防護。**

### **`aria-label` 同時是選擇器** —— 這是本 repo 的結構性事實

驗收不得為此在產品 UI 上掛 `data-*`（既有紀律），於是 probe 只能靠 `role` 與 `aria-label` 定位元素
（**6 支 probe、數百處**），而 `Ctrl+T` 的實作也靠 `querySelector` 找到既有的建立入口。
**兩者都從字典取字串**（`scripts/lib/copy.mjs` 的 `copy()` / `label()`；`KeyboardNavigation.tsx` 用
`t(...)`）。文案與選擇器一旦分離為兩份字面值，就會在某一次改文案時失去同步 —— **而失去同步的徵狀是
「選不到元素」，不是「斷言失敗」**；`Ctrl+T` 更是連紅燈都不會有。

推論出來的日常規則：

- **可見文字可以自由改，只要 `aria-label` 不動**（`+ session` → `+` 那次 168/168 全綠即為驗證）。
- **寫 `aria-label` 文案時要避開 shell 引號會咬到的字元**（單引號、雙引號、反引號）—— probe 的
  選擇器是用字串拼的。實測：`Back to this session's repo` 的單引號提前關閉了 probe 的字串字面值，
  整個 evaluate throw、**沒有紅的斷言，只有一個 Uncaught error**。
- **`role` 也會撞。** 現在有四到五個 `role="tablist"`（身分切換、OpenSpec 視圖、artifact 分頁、
  session 分頁，overlay 開著時還有第五個）。選取時一律連 `aria-label` 一起指名。
- **同一個字串可能是兩個東西的標籤**（`panelSwitch.files` 與 `files.label` 值相同 —— 以該標籤選取會
  命中 Files 面板那個 `<section>`）。
- **「測試與被測物同源，字典寫錯時探針不會發現」不成立。** probe 驗的是**行為**：沒有哪條 spec 說
  那顆按鈕必須叫 `New session`，spec 說的是「觸發它會建立一個 session」。`aria-label` 在 probe 裡的
  角色是**定位手段**，與 `role` 或 CSS class 沒有差別。文案內容的正確性由人擔保 —— 它就印在畫面上。

### dev 模式下，改 `en.json` 或 preload／主行程**不會**熱套用

- **`en.json` 一改，vite 觸發 full page reload，而導航防護會擋掉它** —— renderer 於是**留著舊字典**，
  新增的 key 會變成 `t()` 回傳 key 字面。**必須重啟 dev。**
- **`electron-vite dev` 實測沒有在主行程／preload 改動時重啟 electron** —— 新的 preload 方法不會出現
  在 `window.workspace`。**同樣必須重啟 dev。**

## 字級、版面與 React

### 字級尺度：只有一個旋鈕

**renderer 的字級只有一個旋鈕：`index.css` 的 `--text-base`（定案 17px）。** 五級尺度全部由它以
`calc()` **平移**推導（`2xs` 13 / `xs` 14 / `sm` 15 / `base` 17 / `lg` 18），`--text-terminal`（16px）
也是。**平移，不是等比縮放** —— 使用者要的是「每個字都大一點」；等比縮放會改變版面的層次關係。

- **不得寫死字級。** `scripts/typography.test.mjs` 擋 `text-[13px]` 這類 arbitrary 值；CSS 的
  `font-size` 必須引用 token（`em` / `%` 放行 —— 它們相對父層；**`rem` 不放行**，它相對 html 的
  16px，旋鈕轉不動它）。收斂前有 **70 處**寫死字級，於是 `@theme` 裡的 token 調了也沒用。
- **字級是版面的輸入，不是裝飾。** 旋鈕從 15px 調到 17px 時，rail 立刻縮不到它宣告的 `minSize`
  —— flex item 的 `min-width` 預設是 `auto`，`Panel` 會被**內容**撐住。那道夾制**在實作上一直沒有
  真的兌現**，只是字級小的時候看不出來。修的是 `Panel` 的 `min-w-0`，**不是把 180px 調高**
  —— 最小寬度是版面契約，不該隨字級浮動。

三個會**靜默失敗**的陷阱：

- **`@theme` 會 tree-shake 掉沒有任何 utility 用到的 token。** `--text-terminal` 只被 JS 讀取，
  放在 `@theme` 裡它**會從產物中消失**。必須定義在 `:root`。
- **CSS 自訂屬性的 computed value 不會求值 `calc()`。** `getPropertyValue('--text-terminal')` 回的
  是字面的 `"calc(15px - 1px)"`，`parseFloat` 得到 `NaN` —— **而 fallback 剛好等於正確值，畫面上
  看不出來**。要讓瀏覽器求值：把 `var()` 餵給一個離屏元素的 `font-size`，再讀回它的 `fontSize`。
- **把 arbitrary 值換成具名 token，換掉的不只是你盯著的那個屬性。** `text-[12px]` 只設
  `font-size`；`text-xs` **連 `line-height` 一起設**。於是 45 處一收斂就憑空多出 16px 行高，而
  `probe:terminal` 是以**真滑鼠座標**點擊的 —— 版面一動，對時序敏感的斷言就開始點空。
  **徵狀是時綠時紅、每次紅的還是不同條，極易誤判為既有的 flaky。** 因此 `@theme` 裡的五個
  `--text-*--line-height` 全部明確釘住。

### 版面與游標

- **混排字型的列要釘住行框（`leading-none`）。** 狀態列曾回報「字型不一樣大、排列不整齊」——
  根因不是字級（整條列同一個 token），是**某些字元落到 fallback 字型，而行框高度會跟著各自的字型
  度量走**，於是 `items-center` 對齊的是「各自不同高的盒子」。實測系統等寬字（DejaVu Sans Mono）
  有 `·` `…` `↻`，**沒有 `⑂`（U+2442）**；`✳`（U+2733）同時存在於等寬字與 emoji 字型，挑到後者
  會明顯變大又偏移基線。**與終端 box-drawing 同源：字型覆蓋範圍不足時，症狀出現在版面上，而不是
  出現在缺字的地方。**
- **`<button>` 不繼承父層的 `cursor`（Tailwind v4）。** `cursor` 雖是可繼承屬性，但元素自己的宣告
  會贏過繼承來的值，而 `<button>` 帶著一條 UA 的 `cursor: default` —— Tailwind v4 的 preflight 不再
  像 v3 那樣把它改回 `pointer`。**靜止的游標要掛在使用者真正滑過的那個元素上。**
- **可拖曳且可點擊的項目，靜止時是 `pointer` 不是 `grab`** —— `grab`（張開的手）宣告的是「這東西
  只能被拖」，但它們**點一下是有作用的**，而那是使用者最常做的事。
- **拖曳中的 `grabbing` 不能靠 `body.style.cursor`，也不該由每個呼叫端各自加三元式。** 同一條規則
  讓 body 上的 grabbing 被沿路每個元素蓋掉，而 repo 的拖曳判定**刻意涵蓋整個區塊** —— 游標一定會
  掃過它們，於是一路閃爍。作法是 `useDragReorder` 在 `body` 掛 `data-dragging`，由一條 `!important`
  規則覆蓋**整棵子樹**。
- **`<Panel collapsible collapsedSize={0}>` 收合時子樹仍然掛載**（收合只是把尺寸設為 0）。
  不要據此推論「收合時焦點不可能在容器裡」。
- **可程式聚焦的容器需要 `tabIndex={-1}`** —— 對一個沒有它的 `<section>` 呼叫 `.focus()` 是 no-op。
  這在 `Ctrl+P` 的焦點歸還上是承重的：overlay 關閉後若焦點落在 `<body>`，下一次 `Ctrl+P` **靜默
  失效**，使用者看到的是「這顆鍵時好時壞」。而**「開啟檔案」正是那個記住的元素必然消失的路徑**
  —— 退路在最常走的那條路上才會被用到。

### 拖曳的落點：插入點與提交序位差一格 —— 而**兩個項目時看不出來**

命中判定回傳**插入點**（「插在第 i 個之前」，指示線畫的也是它），但提交端是「**先移除、再插入**」
—— 移除會讓被拖曳項目**之後**的元素前移一格。於是**往下／往右拖時，落點比指示線多一格**（把 repo
拖到第二個 repo 的下半部，它會**飛到清單最後**）。換算集中在 `commitIndex()` 一處，state 裡存的
**永遠是插入點**。

- **這個 bug 從 `session-rename-and-reorder` 起就在，卻通過了每一輪驗收** —— **分頁列的拖曳只用
  兩個分頁測，而兩個項目時兩種語意的結果完全相同**。**驗收拖曳排序必須用至少三個項目，且往下／
  往右拖。** 這條紀律已寫進 `workspace-layout` 的 spec 本身。
- **末端要拖得到**：命中判定在「游標落在所有中線之後」時必須回 `count`，並在最後一個項目**之後**
  畫指示線。**無操作時不畫指示線** —— 一條說「放開會移動」的線，放開卻什麼都不動，是在騙人。
- **重排一律以識別碼定位而非位置** —— 清單的權威在主行程，飛行中的索引可能已指向另一個 folder。
- **拖曳排序用滑鼠事件實作，不用 HTML5 drag-and-drop** —— 後者在 CDP 下要走
  `Input.setInterceptDrags`，與探針既有的真滑鼠序列格格不入。自己做，驗收就能送真拖曳。

### React 的陷阱

- **state updater 必須是純函式。** StrictMode（**只在 dev 生效**）會刻意 double-invoke updater ——
  把 `onCommit` 寫在 `setDrag(current => {...})` 裡面，排序就會被套用**兩次**（交換兩次＝回到原位，
  看起來像「拖曳完全沒反應」）。實測 **dev 失效、build 正常** —— 一邊過一邊不過，第一直覺會以為是
  時序 flaky，其實是 React 在告訴你「你的 updater 不純」。
- **「把 prop 同步成 state」的 effect 會在首次掛載時靜默失效。** 側欄兩個身分**互斥掛載**，跨身分
  導航送出的請求抵達時目標**那一刻才第一次掛載** —— 用「nonce 變了才套用」的寫法，`useState(nonce)`
  的初始值就等於當前 nonce，**跳過去的那一次永遠不會開檔**。**請求必須在 `useState` 的初始值就
  套用。** 連帶：這也讓「切走身分再切回來」不能用來重置（重新掛載會把上一個 request 重播一次）。
- **副作用不可寫在 effect 裡同步 setState** —— 用「渲染期間調整 state」。但**渲染期間只能改自己的
  state**，不能呼叫父層的 setState —— 所以錨定要在**送出請求的那個 event handler** 裡完成。
- **換 folder 必須清掉待處理的跨身分請求** —— 它是**上一個 repo** 的座標。
- **兩個會靜默毀掉使用者資料的陷阱**：落盤的 effect **必須有一道「restore 完成了嗎」的閘**（首次
  渲染時清單是空的，少了閘它會在 restore 回來**之前**送出一份空清單，**把上一次的全部抹掉**）；
  restore 的 `setSessions` **必須是合併，不能是覆蓋**（使用者完全可能在它回來之前就按下「+」，
  覆蓋會讓那個剛建好的 session **憑空消失，而它的 pty 還活著**）。
- **StrictMode 會把重建做兩次** —— restore 的 effect 需要一道 **ref 閘**，否則每個 session 都變成
  兩份分頁。
- **Monaco 的選取不是 DOM selection**（與 xterm 同源）—— `window.getSelection()` 讀不到，要看 view
  overlay 的 `.selected-text` 元素。

## 驗收與探針

> 這一節是全檔最貴的部分。**幾乎每一條都是「它曾經是綠的，而它測的不是它自稱在測的東西」。**

### 假綠的來源與唯一的解藥

**對照組是唯一擋得住假綠的東西** —— 把修正退回、確認測試真的變紅。這個 repo 每一條重要的守衛都
這樣驗過，而幾次沒這樣驗的，全部是假綠。

已經實際發生過的假綠（每一條都全綠過一輪以上）：

- **Enter 併進 `Input.insertText` 的文字裡送出** —— 字元確實抵達 pty（**終端上看得到回顯**），但
  shell **從未執行那一行**。xterm 的換行是在 keydown 上判讀的。**Enter 必須是一次真的 keyEvent。**
- **斷言不能區分「回顯」與「執行」** —— tty 會回顯輸入行，`echo COLS=$(stty size)` 在執行**之前**
  畫面上就已經有 `COLS=` 了。要用「回顯不含答案」的形式：`echo OUT_$((6*7))`、`echo CWD=$(pwd)`。
- **`.xterm-rows` 讀不到時回空字串、不丟錯** ⇒ **否定式**斷言（「被攔下的按鍵沒有流進 pty」）
  在瞎掉的情況下**繼續發綠燈**。
- **`cat -v` 不 escape Tab** ⇒ 檢查 `^I` 的那條**從來沒有生效過**，而它守的正是 `Ctrl+Tab`。
  用 **`cat -A`**（＝ `-vET`）。
- **`count >= 1` 驗不到「下拉列出系統字型」** —— 只有「系統預設」一個選項時 count 就是 1，
  `listMonospaceFonts` 整個壞掉回空陣列它照樣過。
- **反面測試看起來像壞情況，不代表它擋得住壞實作。** 誘餌 `docs/openspec/notes.md` 對正確版與鬆綁版
  **同解**（`openspec` 之後只剩一段，兩者都回 `null`）—— 誘餌**必須帶 `changes/` 或 `specs/` 那一
  層**。而 `<root>-suffix` 擋得住鬆綁版卻擋不住 `startsWith` 版，擋得住後者的是**正面**案例（清單
  同時有 `…/wt` 與 `…/wt-a`，開後者底下的檔案）。**一個反面案例的價值不在於它看起來是個壞情況，
  而在於它能不能區分正確與錯誤的實作。**
- **「重建後新 shell 的輸出看得見」驗不到 alt buffer 的 bug** —— 卡在 alt buffer 裡的 shell，它的
  輸出照樣看得見。有鑑別力的判準是「**normal buffer 裡的歷史看得見**」。
- **`replayed.includes('MARK_42')` 驗不到畫面被弄壞** —— `MARK_42` 確實還「在」（雖然變成 `RK_42`
  且跑到分隔線後面去了）。**順序也要驗。**
- **「複製出來比對文字」對字元寬度零鑑別力** —— 一個字元少佔一格時**字元序列完全不變**。判準必須
  取自 cell 佔用的可觀察後果（游標前進的格數、或同排版各行的右緣）。**這條寫進了 spec 的規範性
  段落** —— 它是這條要求永久的驗收陷阱。
- **「關掉 GPU 加速不遺失內容」判準「複製回來的文字非空」幾乎沒有鑑別力** —— 它其實只是在確認
  非同步抵達的 shell prompt 畫出來了沒。改成切換前自己寫入一段標記。
- **`worktree ≤ 1 時 core 靜默退回非聚合`** ⇒ fixture 若 `git worktree add` 失敗，每一條斷言仍會
  通過。關鍵是成對的**反向**斷言（「那些 change 確實不在主工作目錄底下」）。同型的還有「來自
  worktree 的 change 標示分支」要配「**來自主工作目錄的不標示**」、「邊界外的不提供入口」要配
  「邊界內的**有**」。
- **「恰好 1 個工作目錄的 git repo」這條路徑一次都沒被走到**（`probe:files` 的 fixture 非 git，
  `probe:openspec` 的有 3 個）—— 上一條的變體，**分歧點落在 0 與 1 之間**。
- **`nodeIntegration: true` 的量測 harness 得出了與產品相反的結論**（見「量測 harness」）。
- **驗收數字要連分母一起看。** `runContinuation 3/3` 曾被寫進紀錄，而那一段每個模式有 3 條、
  **兩個模式共 6 條** —— 3/3 表示當時**只跑了一個模式**。`N/N` 只說「跑到的都過了」。

### 探針證明不了的事 —— 寫明，不要留假綠

| 驗不到 | 為什麼 |
|---|---|
| 真實鍵盤抵達得了 renderer | CDP 注入 Chromium 的輸入管線，**繞過**作業系統與瀏覽器的 accelerator 層。（X11 的 XTEST 合成注入在本機也被環境擋掉了：送一顆 `a`，收到 0 個 KeyPress。） |
| OSC 8 連結的激活 | 注入式滑鼠事件驅動不了 DOM renderer 的 hit-test 與 Linkifier2 的 hover 追蹤。**對照組證明了那條斷言是假綠**（把 `linkHandler` 整個移除，仍然全綠）。 |
| 中鍵只貼一次 | CDP 的合成滑鼠事件**不觸發** Chromium 的原生中鍵貼上。 |
| 原生 `<input>` 的文字選取 | `rawKeyDown` 跳過預設動作，`keyDown` 的編輯命令來自平台的 key-binding 層。兩種送法選取長度**都恆為 0**，與 app 有沒有攔截無關。 |
| 主行程有無 uncaught exception | 不傳到 renderer，且 headless 下拋了也不整個崩潰。 |
| session 重建後仍在該 worktree | 那一段的 session 是**繞過 renderer** 以 IPC 建的，而持久化靠 renderer 推送 —— 它們從不進 `sessions.json`。 |
| preload 的簽名改變 | `probe:shell` 比的是 key 的集合差。**contextBridge 複製函式時把 `Function.length` 抹成 0**，`create.length` 釘不住參數個數。 |
| 程式化繪製的呈現是否正確 | 虛擬螢幕是軟體 GL。已寫進 `terminal-sessions` 的規格。 |

**這些缺口由 code review + design 承擔，並在原處寫明理由。** 移除假綠斷言好過留一盞測不到自己宣稱
在測的東西的綠燈。

### 用真事件，不要用 `dispatchEvent(new MouseEvent(...))`

合成事件不走完整的 pointer/mouse/contextmenu 序列，也不觸發 React 19 對 trusted discrete 事件的同步
effect flush。實測踩過：右鍵選單用合成 `contextmenu` 測「全綠」，但真右鍵完全開不起來 —— 開啟選單的
那次事件冒泡到 window，被選單自己的 dismiss listener 當場關掉。而「用選擇器 `.click()` 選單項」會
跳過定位，選單溢出 viewport 也照樣通過。

**右鍵／點擊要用 `Input.dispatchMouseEvent`，並斷言選單的 `getBoundingClientRect()` 完整落在
viewport 內。**

- **`Enter` 必須用 `keyDown` + `text`，不能用 `rawKeyDown`** —— `<button>` 是靠 Enter 的**預設
  動作**被觸發的。其餘帶修飾鍵的按鍵則相反，要用 `rawKeyDown`，否則 `keyDown` 附帶的 `text` 會在
  終端上多打一個字。
- **送真滑鼠事件，就得自己面對座標會過期。** pty 宣告的 OSC 標題比 session 晚到**很多**（實測一秒
  以上），標題一到分頁標籤寬度暴增，把「+」往右推 **150px** —— 探針量到的座標在幾毫秒內過期，
  **症狀看起來卻像「產品的選單壞了」**。兩道防護要一起上：`stableRect`（連續數次量到同一位置才算數，
  **取樣窗口必須跨過標題的延遲** —— 只量兩次、間隔 150ms 會落在抵達前的**假平靜期**裡），以及
  **點完確認選單真的開了，沒開就重量再點**。
- **終端的左緣正好是 resizable panel 的分界器。** 從 `.xterm-screen` 的左上角起拖，抓到的是分界器：
  選取是空的，**而且側欄被拉開、版面永久損毀** —— **一次錯誤的拖曳讓後面六個對照變體全部誤報失敗**。
  **正解：反向拖曳**（右下角元素內 → 左上角第 0 格內）。
  > **抓出它的是「把已知成功的變體排到已知失敗的之後 —— 它也失敗了」** ⇒ 座標不會因執行順序而改變，
  > 那一定是污染。
- **xterm 把座標四捨五入到最近的 cell 邊界**（cellW ≈ 9.6，過半進位）。終點要 `+2` 才落在第 0 格。
- **CDP 的 Escape 在「以 `evaluate` 點過 overlay 內的元素」之後送不進去**（產品沒問題，dogfood 確認
  真鍵盤關得掉）。要在探針裡收掉 overlay，用它的關閉按鈕。**而這個坑會偽裝成別的東西**：後續的
  真滑鼠操作點不到，然後 **throw 而不是回報紅燈** —— 整支探針從那裡中斷，看起來像「選單壞了」。

### 觀測管道必須是 renderer-agnostic 的

`.xterm-rows` 只存在於 DOM renderer。三條替代管道，**而且都比它強**：

| 測什麼 | 管道 | 為什麼更強 |
|---|---|---|
| pty 行為（輸入、cwd、cols、貼上） | **讀檔**（`echo X > f` → 讀檔） | 能**區分回顯與執行** |
| 畫面內容（scrollback、重播、alt buffer） | **產品自己的複製路徑**（拖曳選取 → 複製 → 讀剪貼簿） | 跨 renderer 不變；且**把折行接回邏輯行** |
| 字級 | **pty 的 `cols`**（固定寬度下字級 ↑ → cols ↓） | 證明字級真的改變了 **pty 的幾何** |

- **DOM 上沒有任何可用的字級訊號。** `.xterm` 的 computed `fontSize` **恆為 `16px`**、
  `.xterm-helper-textarea` **恆為 `13.3333px`** —— 而它們**剛好接近正確值**，換上去就是一條永遠通過
  的假綠。
- **加新的觀測點時，順序是承重的：先改觀測點、在舊 renderer 上驗到全綠，再換 renderer。** 這樣
  「改寫弄壞了什麼」與「換 renderer 弄壞了什麼」才分得開；反過來做的話，任何一條紅燈都有兩個嫌疑犯。
- **驗偏好不能直接打 `settings.*` IPC** —— 偏好的權威在主行程的 store，但 renderer 是靠
  `PreferencesProvider` 的 state 驅動 effect 的，而那個 state 只在走使用者路徑時更新。直接打 IPC →
  store 變了、renderer 沒變 → 一度被當成產品 bug。**偏好沒有推送通道，而那是對的**（單視窗、唯一
  的寫入者就是設定對話框）。
- **`pollUntil` 只吃 `evaluate` 的字串表達式**，讀終端內容是一連串真滑鼠動作 —— 要輪詢它得用
  `pollUntilText()`（吃一個取值函式）。

### 別拿方便取得的量當代理判準

**一般形式：一個方便取得、看起來相關的量，不等於規格真正在乎的那個量。** 已經咬過三次：

- **「隱藏的終端底下有沒有 `<canvas>`」** —— 其中一顆是 `TextureAtlas._tmpCanvas`（glyph 光柵化的
  暫存畫布，**不帶 GPU context**），而 **atlas 由 `charAtlasCache` 跨終端共享**，那唯一的一顆會被
  搬到「最近一次光柵化 glyph 的那個終端」底下。**DOM 節點只有一個 parent，所以總數恆為 3：它從來
  沒有多出來過，只是換了個 parent。** 紅或綠只取決於「切換之後顯示中的終端有沒有再光柵化過新字元」
  —— 一個**穩定**的狀態，輪詢等不掉。**失效方式是兩個方向都錯**：真的洩漏時可能沉默，一切正常時
  卻間歇報錯 —— **而後者誘使人把它當成 flaky 而忽略它**（我先判成「時序 flaky」、再判成「穩定的
  資源殘留」，兩次都錯，還把它寫進了這份文件）。
  - **正解是問「這個終端當下走哪一條渲染路徑」**：程式化繪製 ＝ 有 `canvas.xterm-link-layer` 且無
    `.xterm-rows`；倚賴 glyph ＝ 反之。**不要改成「數 canvas 但排除 `_tmpCanvas`」** —— 那是把判準
    綁在 xterm 的內部實作細節上。**判準寫進了 spec 而不只是 probe**：規格說「持有渲染資源」，就得
    說清楚那在外部如何觀察。
  - **驗收要兩個方向都有**：不只「隱藏的沒有」，也要「顯示中的有」。先前那條之所以能長期紅著而沒人
    發現是判準的問題，正是因為它只看隱藏的那一半。
  - **「共用暫存物不構成證據」那條 scenario 以注入構造，不等它自然發生** —— 等待版沒有鑑別力。
- **「版本字串在不在清單裡」** 是「字元寬度對不對」的代理。
- **「同步 API 未被呼叫」** 是「不阻塞主行程」的代理 —— 而 ESM 的具名匯入不經屬性查找，
  `mock.method` **攔不到它**，那條斷言在同步實作下照樣是綠的。改為驗**性質**：讓出一個完整的
  event loop tick，斷言它**還沒完成**。

> **追到底的方法是攔截 DOM 的插入 API 取建立堆疊**（`MutationObserver` 給不了：它的 callback 是
> 非同步的，堆疊只會指向 observer 自己）。而 `appendChild` 只是插入路徑之一 —— `_tmpCanvas` 走的是
> `append()`，只包 `appendChild` 會什麼都抓不到。
> **一個「沒有 class 的 canvas」不等於「我以為的那顆沒有 class 的 canvas」。**

### 一支永遠紅的探針等於沒有探針

`probe:shell` 的「fs 介面只暴露已定義邊界要求的能力」曾自 **Phase 3 起紅了很久** —— 它還在斷言
「不得有 `writeFile`」，而 Phase 3 正是加入寫入能力的那個 change。**探針的斷言會隨規格過期**：
加能力到 preload 白名單時，記得那裡有一道守衛在等著（那份白名單本身是刻意的 —— 每加一個名字，
都得先有一條 requirement 定義它的邊界）。

> **同一件事後來又發生了一次，且是 `test:e2e` 的第一次跑抓到的。** 某個 change 往 preload 加了三個
> method，**沒動 `probe-shell.mjs`，而它從頭到尾沒跑過 `probe:shell`** —— 於是白名單守衛帶著兩條
> 紅燈被封存了。**「這次沒改到那塊」不是不跑的理由**：白名單守衛守的正是「你加了東西卻沒告訴它」。
> **這是 `test:e2e` 存在的理由** —— 單支入口讓人只跑自己改到的那幾支，而漏掉的那幾支正是會抓到你
> 的那幾支。

同源的還有三種：

- **`probe:workspace` 曾以那顆 `◈` 指示鈕識別 rail 的每一列** —— `◈` 一移除，rail 的列數就變成 0，
  五條斷言連帶全紅，看起來像「rail 壞了」。
- **探針的內容斷言也會過期，不只選擇器。** 比對 UI 上**文字**的那些（`/尚未選擇 repo/`、`/過大/`、
  選單項名稱、模式名稱、重播分隔線的字樣）換文案就全紅。**但要區分文案與 fixture**：探針自己寫進
  markdown 檔的內容改了才是錯的。
- **一個新行為會讓既有段落靜默過期。** `openFileFromOpenSpec` 開始把樹根切到目標所在的工作目錄之後，
  **任何「先跨身分跳去看 worktree 的檔案、再以 folder 根座標展開別的路徑」的既有段落，第二步會靜默
  落空** —— 實測一次紅 15 條，而其中兩條「不提供入口」反而**變成假綠**（檔案根本沒開）。
  修法是加一個走產品自己選擇器路徑的重置助手，並在受影響的段落前呼叫。

### 追 flaky：它往往是**問錯了問題**，不是機器太慢

加重試或延長逾時是錯的處置 —— 那只會把「斷言問錯了問題」偽裝成「機器比較慢」。

**方法**：先問「它是不是每次都在同一個地方失敗」，再**把懷疑的中間狀態變成獨立的斷言**（「按下前
pty 已存在」「切換前終端裡確實有已知內容」「檔案到底寫出去了嗎」）。那些斷言不是用完就丟的鷹架 ——
留著它們，下次同一個前提被破壞時會**直接指出是前提壞了**。

實例：
- **stub claude 的 `logInput` 分支以 `exec sh -c 'tee -a log | "$SHELL" -i'` 收尾** —— 那個 `sh` 的
  stdin 是**管線而不是 tty**，session 數秒內就變成「已結束」，於是整段一直是一場**競態**。加上
  「pty 已存在」的斷言之後，才看見 session 其實**自己結束了**。改成 `exec cat >> <log>`。
- **「順序於重啟後一致」在重啟後只量一次** —— `app.mounted` 只保證 rail 的 `<aside>` 掛上了，
  **列本身來自一次非同步的 `folders.list()`**。讀到空陣列 → 比對失敗 → 而 detail 也是空的，
  **看起來像「順序錯了」，其實是還沒畫出來**。同一支探針第一次啟動時本來就是輪詢的，**只有重啟那條
  路徑漏了**。
- **`pollUntil` 的條件必須是「要的那個值出現了」，不能是「有東西了」** —— Timeline 的分組在關係圖
  抵達之前是 `["(no topic)"]`，長度 1 也滿足 `list.length > 0`。

> **flaky 的驗證要連跑，不能只跑一輪。** 第一輪 9/9 全綠時我已經準備收工了。

**已知未解的偶發有三條，撞到時先單獨重跑確認，不要當成自己剛改壞的**：`probe:terminal` 的
「持久化檔案損毀」（**#8**，單獨連跑為 1 紅 1 綠）、`probe:terminal` 一次拖曳失手就整支中斷
（**#6**）、`test:all` 於 app relaunch 時 CDP WebSocket 連線失敗（**#7**）。**它們記在這裡就是為了
不再被重新調查一次** —— 一條沒有被追蹤的已知紅燈，下一個人只能從頭查起。

**而診斷要往下走一層，不要在最貴的那一層重試。** `panel-coordinate-per-folder` 的一條驗收紅了
四輪，我連續提出三個言之成理又有旁證的假設（chokidar 的初次掃描窗口、新目錄看不見、inotify
instance 耗盡），三輪探針約 30 分鐘全花在懷疑產品 —— 而真因是探針自己 `runMode` 裡一個同名的
`const derived` **遮蔽**了 fixture 路徑，檔案被寫進了 repo 的工作目錄，**答案在探針行程裡一行
`existsSync` 就有**。**「把中間狀態變成獨立斷言」這條要回頭套用到最上游的前置條件。**

### 有些東西驗收工具本身量不到 —— 換工具，不要換斷言

- **驗 CSP 的 inline-script 阻擋，不能用 CDP 動態插入 script。** `Runtime.evaluate` 注入的程式碼
  **繞過頁面 CSP 的 script-src**（DevTools 的設計，否則無法在嚴格 CSP 頁面除錯），那段 inline script
  **會**執行 —— 不管政策對不對都給假結果。改從 `securitypolicyviolation` 事件的 `originalPolicy`
  端到端讀出**實際施加的政策**。**擷取它需要一個一定被擋的請求去觸發違規** —— 圖片放行後不再是
  觸發源，改用 `fetch` 一個遠端主機（`connect-src 'self'` 擋下）。遠端圖片則反過來驗「**不**引發
  `img-src` violation」—— 這條也擋得住「又改回封鎖圖片」的回歸。
- **`document.elementFromPoint()` 會跳過 `pointer-events: none` 的元素**（它回的是「**會收到指標
  事件**的最上層元素」）。拿它去量一個 `pointer-events-none` 的提示，永遠只會拿到底下的東西，
  **不管修沒修**。
  > **順著這個坑反而問出一個對的產品決定**：「這個 session 恢復不了」的提示不該是
  > `pointer-events-none` —— 讓它接住指標事件，`elementFromPoint` 也就成了真正的 hit-test。
- **`node:test` 進不去「載入時就 `import { ipcMain } from 'electron'`」的模組。** 行為住在 IPC
  handler 裡時，**把 `strict: true` 改成 `false` 不會有任何紅燈** —— 因為那條測試根本不存在。
  **修法不是改標籤，是把載體做出來**：解析抽成純函式（於是測得到），並斷言**列舉未被呼叫**
  —— 那是「空集合短路」與「列舉後沒命中」唯一的差別。

### 插入新斷言：三件事都會靜默毀掉既有測試

探針是一串按時序流動的狀態機，每段對狀態有明確的假設。

- **寫死絕對數字必死。** 「repo-a 有 3 個 session」實測是 4 —— 中間某段為了驗 Enter 而**多建了一個**。
  改為相對數字（`nBefore` 存下來），前面段落淨變化多少都自我修復。
- **位置是承重的。** 插在中間會弄壞依賴 `shell 1` 存在的後續段落（`nextOrdinal` 單調遞增，關掉不
  重用）。**插在 runMode 最後、finally 之前。**
- **插入的段落要把狀態還原**（身分、視圖、工作目錄）—— 不還原的話下一段既有驗收會整段紅，看起來
  像那一段壞了。**而新段落也不該假設前面每一段都還原了** —— 它自己建一個 session 當前置。

### 探針自身的坑

- **`pkill -f` / `pgrep -f` 會匹配到你自己那條命令。** pattern 寫在 command line 上，而 `-f` 比對
  的是整條 command line —— 它會把執行它的那個 shell 一起殺掉。**症狀是背景命令的輸出檔是空的、
  exit 1** —— 看起來像「probe 失敗了」，其實 probe 一秒都沒跑。把 `-` 或 `/` 包成字元類別即可自我
  豁免：`pkill -9 -f 'spekterm[-]files-profile'`。同理計數要用
  `ps -eo cmd | grep -c '[e]lectron/dist/electron'`。
- **收尾殺行程時，殺 wrapper 殺不到它 spawn 的真行程。** `node_modules/.bin/electron` 是 node
  wrapper，`npx electron-vite dev` 的 vite 也是孫行程 —— 對 wrapper 送 SIGTERM，底下的真行程會變
  孤兒，繼續佔著 debugging port（9224），讓下一輪 probe 連到殭屍而讀到空樹（實測：一連串失敗看起來
  像 regression，其實是殭屍）。**兩種收法**：electron 以獨一無二的 `--user-data-dir=<profile>` 用
  `pkill -9 -f <profile>` 連根拔除；dev server 以 `detached: true` spawn 成 group leader 再
  `process.kill(-pid)`。**另外，面板留有未存變更時關閉會觸發原生對話框，它會擋住主行程訊息迴圈使
  SIGTERM 失效** —— 這也是必須連根拔除的理由。
  **`probe:files` 的每次失敗若伴隨「樹是空的」，先 `pgrep -f spekterm[-]files-profile` 檢查殭屍。**
- **環境串擾**：剛跑過 `npm run dev` 的 shell 會繼承 `ELECTRON_RENDERER_URL` 等變數，之後起的
  electron 一律讀到它 —— **CSP 的 build 模式會拿到 dev 政策**，看起來像產品 bug。
  `env -u ELECTRON_RENDERER_URL -u NODE_ENV_ELECTRON_VITE -u ELECTRON_MAJOR_VER -u ELECTRON_CLI_ARGS
  -u ELECTRON_EXEC_PATH -u npm_lifecycle_script npm run probe:files`。
  **這是跨 change 的紀律**：dogfood 中途要跑 probe，先確認 dev 是否還在跑並清 env。
- **對已 `close()` 的 CDP client 呼叫 `evaluate`，會無限等待。** `send` 是靠 message id 配對 resolve
  的 —— WebSocket 關掉之後那個 Promise **永遠不會 resolve：不拋錯、不逾時**。而**症狀看起來像
  「Electron 啟動很慢」**。量測要併進 `PROBE_EXPRESSION`。
- **在模板字串裡寫註解，反引號會把字串提前結束。** 這條在 `global-session` 咬了五次，而 `node --check`
  **只抓到其中三次** —— 另外兩次外層恰好仍是合法的 JS，要到執行時才炸成 `SyntaxError` 或一句看不懂
  的 `Invalid parameters`。**可靠的做法不是「記得別用反引號」，是把說明寫在模板字串外面。**
  同一條也適用於 `*/`。
- **一個 Tailwind class 名稱是另一個的子字串。** 以 `className.includes('bg-hover')` 判斷 rail 上
  選中的項目 —— **未選中的列帶著 `hover:bg-hover/60`，那個字串也包含 `bg-hover`** ⇒ 判準恆回第一列，
  而以它為期望值的三條斷言（期望值恰好就是第一列）**不論實作對錯都通過**。
  **正解是讓產品標示選中狀態（`aria-current`）** —— 那首先是無障礙的正確標記，順帶給探針一個精確的
  判準。**而加上它立刻炸出另一件事**：`probe:keyboard` 既有的 `SELECTED_FOLDER` 有一條
  「`aria-current` → 否則讀主舞台 header」的退路，產品此前沒有它，於是那條退路**一直走的是 header**；
  加上之後它第一次走進前半段，而前半段讀的是 `innerText` 的第一行 —— 該列展開時那是一顆 `▾` 展開鈕。
  **替一個從未被滿足的條件補上滿足它的東西，會喚醒一段從未執行過的程式碼。**
- **探針取識別碼要向產品要，不自己算**（例如 sha1 的 worktree key）—— 平行實作在 core 換演算法時會
  靜默分歧，而斷言照樣全綠（兩邊各用各的 key）。
- **對照組跑到一半還原原始碼，dev 模式會驗到還原後的版本** —— **build 用的是編譯進 `out/` 的產物，
  dev 是 vite 即時讀原始碼**。**對照組要嘛跑完再還原，要嘛只採信 build 模式那一半。**
- **一條沒有 `detail` 的 `check()`，失敗時等於什麼都沒說。** 兩個不同的病擠在同一份紅色輸出裡，
  會看起來像同一個根因。
- **`probe:terminal` 一輪約 4 分鐘** —— 迭代時用 `PROBE_ONLY=<段落>[:<模式>]`。
- **一支新的 CPU 密集測試會逼出既有的競態。** `copy-language.test.mjs` 用 TypeScript 解析整個
  `src/`，平行跑時把 `terminal.test.ts` 兩處 `stub.calls()` 斷言擠爆了 —— 產品在 spawn 的**當下**就
  回報了 conversationId，但 stub 是在自己的行程裡 `echo "$@" >> log`，中間隔著一次 fork/exec。
  其餘的 `stub.calls()` 本來就都先 `waitFor` 過，那兩處漏了。

### stub `claude`：驗 OSC 標題與續接的載體

OSC 標題只對 `claude` 目標生效，但我們**叫不動真的 `claude` 去宣告一個指定的標題**，也不該讓探針
真的啟動一個 Claude Code session。產品的 claude 模式是 `$SHELL -l -c claude`（**從 PATH 解析**），
於是把一個放著 stub 的目錄前置到 `PATH` 就走的是**產品原本那條路徑**：動的是環境，不是被出貨的
程式碼。

- **`HOME` 也必須換掉，否則 stub 會被真的 claude 蓋過去。** `-l` 是 login shell，它 source
  `~/.profile`，而 Ubuntu 預設的那份有 `PATH="$HOME/.local/bin:$PATH"` —— 那一行把**真** claude 搶到
  我們前面（實測：探針真的把一個 Claude Code session 跑了起來）。把 `HOME` 指向暫存目錄後，那裡沒有
  `~/.profile` 可 source，而且 stub 就放在該 HOME 的 `.local/bin` 裡。
- **`SHELL` 要釘成 `/bin/sh`** —— zsh 會自己送 OSC 標題。
- **stub 的旗標比對不可用位置。** `claude-status-bridge` 起，命令前面多了一段 `--settings <路徑>`
  —— 以 `[ "$1" = "--resume" ]` 判斷的 stub **`$1` 從此恆為 `--settings`**，於是它**完全不再模擬
  失敗**，只是退化成一個普通的互動 shell。**失效方向是最壞的那種**：stub 看起來一切正常，紅的卻是
  產品那側的斷言 —— 一路追下去會先懷疑產品的自癒壞了。JS 那側的 `.split(' ')[1]` 是同一個病。
  **判準一律在整串裡找旗標。**
- **「stub 真的跑起來了」要以磁碟上的憑據斷言，不要看終端畫面** —— 「終端上有沒有出現某行字」對
  掛載時機、backlog flush 與捲動都很敏感（dev 的 StrictMode 還會把元件重掛一次）。

### 其他驗收紀律

- **驗 reload 要用 `Page.reload`，不能用頁面裡的 `location.reload()`** —— 後者是**頁面發起**的導航，
  會觸發 `will-navigate`，而導航防護正是無條件擋它。於是 **reload 被 app 自己的防護擋掉，探針會在
  一個從未 reload 過的頁面上把整段驗收跑完**。
  **而且要斷言 reload 真的發生了** —— 先把狀態改成非預設值，reload 之後看它有沒有回到預設。
- **驗收有前置條件時，前置沒成立會紅得莫名其妙。** 驗一個排在後面的停用原因，得先讓前面的條件全部
  成立；驗 reload 的還原要先切回同一個 session、先選 folder 再判定身分（沒選中時側欄是空狀態，
  那個 section 的 `aria-label` 是身分切換器的字串）。另外 persist 有 **500ms 的 debounce**，reload
  太快會把這次選擇丟掉 —— **而那個失敗與「持久化整個沒做」長得一模一樣**。
- **在 Files 身分導航檔案樹的五個坑**：檔案樹與檢視器**互斥渲染**（開著檔案時樹根本不在 DOM 裡，
  而**先前開著的檔案還在畫面上**，於是其後的斷言驗的是上一個檔案）；**不可用「切走身分再切回來」
  重置**；**點目錄是 toggle 不是「展開」**（判 `aria-expanded`）；**`CLICK_OPEN_FILE` 的 needle 不能
  用檔名**（artifact 一多，預設分頁就不是 proposal 了）—— 用 slug；**麵包屑裡的第一個 `button` 不
  保證是「回到樹」**（工作目錄選擇器排在它之前），修法是給那顆按鈕一個字典來源的 `aria-label`
  （順帶改善無障礙），**不是**改用位置。
- **驗捲動要自己構造溢出，而且載體選錯就是一盞假綠。** `probe:workspace` 送不進 `Ctrl+↓`（診斷顯示
  選中狀態不動而 `scrollTop` 卻變了 —— 那是**未被 preventDefault 時瀏覽器的原生捲動**），該段因此
  **整段移除而非留著**：留著就是假綠（「捲回 `scrollTop 0`」在原生捲動下照樣通過）。載體是
  `probe:keyboard`，以 `Emulation.setDeviceMetricsOverride` 壓矮 viewport 讓既有 fixture 就溢出。
  - **分頁列的橫向捲動一度零覆蓋** —— 刪掉那行 `scrollIntoView`，探針照樣全綠。補法：壓窄視窗，
    **不夠就以鍵盤補 session**（`Ctrl+T` → ↓ → Enter，與視窗寬度無關 —— 窄視窗下那顆「+」可能已被
    推出畫面）；判準是「走到第一個分頁 → 強制 `scrollLeft = 0` → 循環到最後一個」，於是「最後一個
    必然在視野外」是**溢出的定義**保證的，不是碰運氣。
  - **滑鼠的例外，半截的列要「算」出來，不能「捲到底再找找看」** —— 捲到底時被裁掉的是 session
    **子列**，而選取的單位是**標題列**，整排恰好都完整可見（第一版因此恆回 `null`）。改為主動把
    `scrollTop` 設到讓某一列剛好被邊緣切一半。
- **`aria-label` 是選擇器**，見上文 i18n 那節。
- **腳本裡比對 git 的輸出，一律加 `--no-color`** —— 見下文「工具鏈」。
- **驗證「某段邏輯沒有 spawn 外部程式」時不要用行程樹取樣** —— 開發模式的掃描摘要本來就會 spawn 一次
  `git log`，會混淆歸屬；而 `git` 是毫秒級行程，取樣容易漏抓。改在單元測試裡攔截
  `node:child_process` 的全部入口，並加一個對照組證明攔截確實生效。
- **驗證「app 沒有開 TCP 埠」時不能只讀主行程的 `/proc/<pid>/net/tcp`** —— Chromium 的 zygote 與
  renderer 跑在各自的 network namespace。`probe:core` 用兩道互補判準：逐 pid 取「該 pid 的 socket
  inode ∩ 該 pid 所屬 netns 的 LISTEN 表」，外加「app 存活期間本 netns 是否新增 LISTEN socket」。
- **驗證編輯器 worker 是否存活，不能靠「看到語法高亮」** —— tokenization 在主執行緒完成。用 Monaco
  內建的 link provider（為 `language: '*'` 註冊，呼叫 worker 端的 `$computeLinks`，命中的 URL 會被
  畫上 `.detected-link`）—— 零 bundle 成本、零測試鉤子。
- **驗證編輯能力必須讓內容真的改變並回讀磁碟**，不能只看某個 textarea 的 `readOnly`。
- **量測 harness 的 `webPreferences` 必須比照產品。** `terminal-unicode-width` 最小重現開了
  `nodeIntegration: true`（純粹為了方便回報結果），於是 `Buffer` 存在 → 撞上 addon 解碼 Unicode trie
  時 `new DataView(data.buffer)` **漏了 `byteOffset`** 的 upstream bug → **整個星形平面被判成一格**。
  獨立稽核據此得出「選型是錯的」，而我用**同一種環境**去「獨立驗證」，得到同一個結果就接受了它。
  > **兩次獨立測試若共用同一個環境假設，得到同一個錯誤結果並不構成佐證 —— 那只是同一個錯誤被執行
  > 了兩次。** 救回這件事的不是第三次測試，是去讀那個 issue 的最後一段。
  > *連帶*：任何在 **Node 環境**驗證寬度的嘗試（`@xterm/headless`、CI 腳本）**會**踩到它，且失效
  > 方式是靜默的錯誤寬度。本 repo 因此**不在 node:test 裡驗字元寬度**。
- **案例集要涵蓋類別，不是實例。** 字元寬度的對照表原本只有兩格，而那兩格恰好是新方案佔優的地方。
  兩個具體的反例都在擴充後的表裡：內建 v6 對膚色修飾「碰巧」正確（**只用它驗會給現況發綠燈**）、
  對星形平面 CJK 本來就正確。**即使結論碰巧正確，一張兩格的表也撐不起「嚴格較優」這個宣稱。**
  這條紀律已寫進 spec 本身。
- **`baseline` 對照組**：撞到怪現象時，先 stash 掉自己的改動跑一輪。實測救過兩次 —— 一次逼我承認
  SIGWINCH 是自己的新程式碼弄的（我原本準備怪 `lineHeight`），一次戳破「這是既有 flaky」的藉口。
  **撞到怪現象時，先問「這是不是我剛加的東西弄的」，而不是先怪一個看起來相關的舊常數。**
- **探針撞到怪現象時，先問「這是不是產品的 bug」，不要先調整探針去閃避它。** 我寫
  `probe:workspace` 時撞見了「repo 飛到最後」，處置卻是把準心移到區塊頂端 3px 去遷就它（註解裡還
  留著「實測踩過」）—— 驗收於是永遠是綠的，而使用者的拖曳是錯的。

## 工具鏈與環境的陷阱

### 腳本裡比對 git 的輸出，一律加 `--no-color`

已經咬過三次。**`-c color.ui=false` 不夠**：這台機器的 git config 設了 `color.diff = always`，而
`color.diff` 比 `color.ui` **更具體**。用**子命令自己的** `--no-color`，或 `-c color.diff=false`。

git 在這個環境會強制上色，於是 `git diff | grep '^-'` **匹配不到任何東西**（刪除行的開頭是一個
ANSI escape）。**而失效方式是最壞的那種 —— grep 回 0 個、exit 1，靜默跳過 `&&` 後面的每一步，
看起來就像「0 deletions，乾淨」。** 同源的還有 `git log --oneline | grep`、`git status | grep`、
`git grep`（另可用 `-I --no-color`）。

> **兩個判準對不上時，不要挑好聽的那個。** 第三次是 `--numstat` 說 5 個刪除、`grep '^-'` 說 0 個 ——
> 那個矛盾就是顏色碼還在的證據。若當時採信 grep，就會宣稱「spec 同步沒有刪掉任何東西」而放行。

### 原始碼裡一個字面的 NUL 位元組，會讓 `git diff` 與 `grep` 對整個檔案瞎掉

而 `grep` 是回空 + exit 1，**連「binary file」都不說**。修過三個檔案（`data.tsx`、
`side-panel/SidePanel.tsx`、`files/dirty-buffers.tsx` 的 cache key 分隔符），**而這份 CLAUDE.md 自己
也曾命中同一個坑** —— 上一版在警告這件事的那一段裡，把 `\x00` 寫成了真的 NUL。
**寫「不要寫字面 NUL」的時候，特別容易寫出一個字面 NUL。**

**它的代價不只是難讀 diff**：`global-session` 的 design 倚賴「把 `folderId ===` grep 一遍」來清查
每一個歸屬比較點，而 `dirty-buffers.tsx` 的 5 處命中**結構性地不在結果裡**。結論碰巧不變，但**清查
技術有一個沒人發現的盲點**。分隔符選 NUL 是對的（它不可能出現在識別碼或路徑裡），錯的只是把它寫成
字面的位元組而不是 escape 序列 —— 語意完全等價。

查法：`python3 -c "print(open(f,'rb').read().count(b'\x00'))"`（**不能用 grep 查 grep 看不到的
東西**）。三道原始碼守衛不受影響 —— 它們走 `readFileSync` + AST／regex，不經 grep。

### 不要讓 pipe 蓋掉 exit code，也不要用 `head -N` 過濾輸出

npm 會先印幾行 `>` 開頭的腳本回顯與**空行**；`npm run typecheck 2>&1 | grep -v '^>' | head -3` 於是
只顯示那幾個空行，**真正的錯誤被擠出視窗** —— 我因此一度以為「typecheck 抓不到未定義的函式」而去
懷疑 `tsconfig`。同源：pipe 到 `tail -50` 讀 probe 的 stdout 尾巴，`tail` 自己的 exit code 覆蓋了
probe 的。**要看 exit code。**

## 反覆重演的教訓（一般形式）

這些各自在上文有具體實例。列在這裡，是因為它們**跨 change 重演過至少兩次**。

- **「補一條 scenario」與「覆蓋一條 scenario」是兩個動作。** 已經發生**四次**：`session-restore` 的
  休眠提示（spec 有 scenario、design 有交代、實作零覆蓋）、`worktree-reverse-navigation` 的「design
  寫『由單元測試承擔』而那條測試沒寫」、`panel-coordinate-per-folder`、`global-session`（對照表宣稱
  了四條不存在的載體）。**它們全都躲過了** `openspec validate --strict`（scenario 存在且格式合法）、
  delta 與主 spec 的 header 稽核（那支腳本不看驗收），以及探針全綠（沒有人在看那條）。
  **而後兩次是在寫下前兩條教訓之後犯的 —— 所以「記得要小心」顯然不是機制。**
  **能結構性擋住它的做法**（已開為 **issue #12**）：稽核腳本對**每一條新增的 scenario** 要求一個
  驗收指認（哪支探針、哪條斷言、或明寫「不覆蓋，理由是…」）。而修法**不是改標籤，是把載體做出來**。
- **加一個列舉值時，把所有 `===` 比較 grep 一遍。** TypeScript 一條都不會攔（既有判斷全是
  `x === 'a' ? A : B` 這種二分寫法，多一個值只是靜默落進 `else`）。踩過兩次：`dormant`（休眠的
  session 全亮紅燈說「已結束」、快照被重複追加分隔線）、`folderId: null`（全域 session 的終端
  **永遠不是 active** ⇒ 依「休眠的 session 於首次被顯示時才 spawn」，**它永遠不會被喚醒**，而畫面上
  只是一片空白）。
  > **而「用 `null` 讓編譯器把每個消費點標紅」只對一半成立**（實測，`--strict`）：`string | null` 與
  > `string | undefined` 的 **`===` 比較合法且不報錯**，只有傳參與 Map 鍵會紅。而歸屬的消費點
  > **絕大多數是比較**。
- **一個「由測試釘住的格式假設」不如一個「使不變式無法被違反的結構」。** 實例：`global-session` 原本
  想用「保留鍵不得為合法 UUID 形狀」的測試防止碰撞（**那測的是一個實例，不是不變式** —— 而 codebase
  的註解早就寫著識別碼「不對格式設限」），改為**獨立欄位**之後碰撞**表達不出來**；`files-in-worktree`
  的 `self` / `others` **互斥分割**取代事後去重；`panel-coordinate-per-folder` 的落盤改為**逐欄位
  白名單**（`SessionStore.replace()` 原本是 `{...entry, …}` 原樣展開，於是「移除一個欄位」不等於
  「它不會再被寫進磁碟」）。**一般形式：「不接受某個東西」要由結構保證，不是由「沒有人再送它」
  保證。**
- **一個可預測答案的高頻問題不該被問。** 兩次：pty 標題的確認對話框、側欄的「跟隨/釘住」toggle。
  **優先序的裁決本身就已經是那個問題的答案**，不需要在 UI 上再問第二次。
- **core 的 optional 欄位要實測它何時被填，不要從語意推論。** 兩次方向相反：假設 `source` 不在
  （結果在，含絕對路徑，且**同一段程式碼的註解正好宣稱了相反的事**）、假設 `worktrees` 是空的
  （結果不是，於是把一個剛修好的 bug 以相反方向重新引入）。
  **換一個 core 的 API 時，要重新問一次「它回傳的東西裡有什麼」** —— 舊 API 的註解在當時是對的。
- **一個方便取得、看起來相關的量，不等於規格真正在乎的那個量。** 見上文「代理判準」。
- **design 裡寫「由 X 承擔」，就要真的去做 X** —— 寫下它的時候就該同時把 X 排進 tasks。
  同源：**實作為了避免噪音而自行收窄條件時，要回頭改 spec**，不是讓兩者各自為政。
- **入口的 gate 在一個地方、取數卻無條件** —— 沒有 `openspec/` 的 folder 為一份用不到的清單走了一趟
  `#scan`（那條路上 core 會 spawn `git worktree list`）。
- **「已實作過」與「已 commit」是兩件事。** 一份紀錄寫著「程式碼可從 git 歷史取回」，而那份 spike
  **在全歷史（含 dangling commit）搜尋為空** —— 害人去找一個不存在的東西。
- **寫下一條教訓，不會讓你自動避開它。** 我在寫下「worktree ≤ 1 時 core 靜默退回非聚合」的同一個
  小時裡，為另一件事補的測試就踩了它（fixture 不是 git repo，對照組沒有變紅）。
  **唯一擋住它的是對照組。**
