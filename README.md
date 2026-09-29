# spekterm

一個以 agent 為核心、懂 OpenSpec 的本地開發工作台 —— 獨立的 Electron app，以 [MIT 授權](./LICENSE)開源。

把多個「一個 repo／資料夾各自一個 `claude` session」的 terminal 包在一個殼裡，
再加上一塊**懂 OpenSpec 結構**的側欄 —— 讓你不必另開 IDE，就能一邊駕駛 agent、一邊看著
它正在改的那個 change。

core 邏輯與視覺化元件重用開源的
[`@spekjs/core`](https://www.npmjs.com/package/@spekjs/core) 與
[`@spekjs/ui`](https://www.npmjs.com/package/@spekjs/ui)（皆 MIT，來自
[`spek`](https://github.com/spekhq/spek)）。

## 現況

**Phase 0–5 已封存。** 主舞台能駕駛 agent、側欄能看懂 OpenSpec，而且兩者已經對上 —— 這正是這個
app 相對於「開四個終端機分頁」的增量價值。

**Linux 產物已可打包**（AppImage —— 見下方「打包與安裝」）。**收件匣與交接（Phase 7）已交付**：
Slack 提及成為待處理項目、agent 可以把工作交接給另一個 repo 的 session。
**尚未開始**：macOS／Windows 產物、自動更新、程式碼簽章。

### 已經可以用的

**多 folder 工作區**

- 原生對話框加入 folder、清單持久化於 `userData`、重啟還原；設定檔損毀時以空 workspace 啟動
  並保留原檔，不讓 app 開不起來
- 活動列 + workspace rail + 主舞台三欄版面，分界可拖動與鍵盤操作，side panel 可收合
- **repo 可置頂**（圖釘或右鍵選單，也可直接拖過分界）：置頂的那一段**不隨 rail 捲動**，
  repo 一多時它們一直在視野裡。全域項目恆為置頂段的第一列且不可取消

**Terminal（agent 的主場）**

- `node-pty` 多 session、IPC 雙向串流、xterm + fit
- session 分頁列 + rail 的 repo→session 子列；**spawn 目標可選 `claude` 或 login shell**，
  cwd = 選中的 folder
- session 的標籤由 **pty 自己宣告**（OSC 序列 —— `claude` 正是這樣讓終端分頁改名的）；
  使用者可接管命名權，此後 pty 想改名須經他裁決；分頁可拖曳排序
- 複製貼上（`Ctrl+Shift+C` / `Ctrl+Shift+V`；**`Ctrl+C` 維持 SIGINT** —— agent 跑失控時
  要中斷得了它，不能因為畫面上剛好有一段選取就失靈）
- 關分頁／reload／關視窗三種路徑皆**不留孤兒行程**

**OpenSpec 側欄**

- **本 change**：每個 artifact 一個分頁（Proposal │ Design │ Tasks │ Specs，依 schema 排序），
  tasks 進度條**恆常可見、不進分頁**；tasks 依 section 分組；spec deltas 標示 `ADDED` /
  `MODIFIED` 並高亮 BDD 關鍵字
- **瀏覽**：Specs（`topic → heading`）與 Changes（`Active / Archived → change`，帶進度）兩棵樹
- **Graph 與 Timeline**：全視窗 overlay（`Esc` 關閉），來自 `@spekjs/ui` —— 與 spek web
  **同一份** d3 力導向圖與 Gantt 時間軸
- **agent 改檔，側欄自己更新** —— 不必重新整理。這個 app 的前提就是旁邊有 agent 一直在寫檔
- **session 的錨定 change**：側欄跟隨當前 focused session 正在做的那個 change
- **交叉導覽**：spec / change ↔ 底層 `.md` 互跳

**檔案瀏覽與編輯**

- 遞迴檔案樹（子目錄 lazy load、隨磁碟的外部變更即時更新）
- markdown 渲染、其餘以 Monaco 高亮（只取語法高亮，不含任何語言服務 worker）
- 完整 CRUD、dirty buffer（跨換頁、跨 folder、跨身分存活）、mtime 樂觀鎖、關窗前的未存提示

**信任模型**

- `contextIsolation` 啟用、`nodeIntegration` 停用，能力只走 preload 白名單
- renderer 無法導航離開 app、無法開新視窗，外部連結交系統瀏覽器（協定於主行程驗證）
- 主行程對 renderer 施加 **Content-Security-Policy**（`onHeadersReceived`）：inline script 一律
  不執行、鎖死 script／object／iframe／base-uri，為 XSS 立足點設第二層防線（遠端 https 圖片照常
  放行 —— 那是 markdown 的正常內容）
- 檔案系統的每一次存取都受 workspace folder 邊界約束：renderer 以 `(folderId, relPath)` 定址，
  **它沒有詞彙可以表達 workspace 之外的位置**
- 主行程直接 `import` `@spekjs/core` 掃描 OpenSpec，全程不開任何 TCP 埠

**收件匣與交接**

- 活動列的 `Handoffs` 收件匣：外部來源投遞的工作項目，使用者看過本文、確認要開在哪個 folder
  之後，得到一個 context 備妥、第一則 prompt 已填好的 agent session
- **Slack**：有人在 Slack 提及你，那件事就成為一則待處理項目（啟動時、每五分鐘、存下憑證時各回補一次）
- **agent 自己發起的交接**：agent 把工作交接給另一個 repo，spekterm 在那裡開好 session 並送出第一則
  prompt；交接出來的 session 記得它的母 session，做完會回報，完成時發一則通知
- 待處理數的計數標示，與新項目到達時的作業系統原生通知

## 文件

- **`docs/PRD.md`** — 產品需求的**單一權威來源**（範圍、路線圖、架構決策）
- **`docs/workspace-mockup.html`** — 定案的高保真 UI 互動雛型。**UI 版面與行為以它為權威**
- **`CLAUDE.md`** — 給 agent 的工作指引，含歷次 Phase 的**實測與踩雷**（那些憑直覺還會再犯一次的錯）
- `openspec/specs/` — 各 capability 的規格
- `openspec/changes/archive/` — 歷次 change 的完整論證（proposal / design / specs / tasks）

## 開發

需要 Node 22.22.0（見 `.nvmrc`）。

```bash
npm install
npm run dev             # 開發模式（userData 走 ~/.config/spekterm-dev —— 見下方「打包與安裝」）
npm run build           # 建置至 out/
npm run dist:linux      # 換版（bump + commit）→ 建置 → 打包成 AppImage → 清掉更舊的產物
npm run install:desktop # 把產物裝進應用程式選單（見下方「打包與安裝」）
npm run uninstall:desktop
npm run typecheck       # 型別檢查
npm run lint
npm test                # 單元測試（fs 邊界、workspace store、watcher、pty 管理器、OpenSpec 供應層、
                        #   舊產品名不得殘留、打包設定不得靜默退化…）
```

驗收一律走**探針**：以 CDP 連進真正執行中的 app 驗收，**不在產品程式碼裡塞測試分支**，
也不為驗收在 UI 上掛 `data-*`（一律以 `role` / `aria-label` 定位）。

```bash
npm run probe:shell     # 開視窗 + 信任模型 + preload 白名單
npm run probe:workspace # folder 清單持久化、fs 邊界、三欄版面
npm run probe:files     # 檔案樹、檢視、編輯、CRUD、導航防護、編輯器 worker、CSP（dev + build）
npm run probe:terminal  # pty 雙向／cwd／resize／多開／不留孤兒行程、剪貼簿防禦（dev + build）
npm run probe:openspec  # 側欄兩視圖、兩棵樹、artifact 分頁、agent 改檔即更新、錨定、
                        #   交叉導覽、Graph・Timeline 的 overlay（dev + build）
npm run probe:native    # 主行程載入 node-pty 並 spawn 真 pty
npm run probe:core      # 主行程掃描 OpenSpec，且不開 TCP 埠
npm run probe:identity  # productName / appId / userData 路徑 / 視窗標題
npm run measure:bundle  # renderer bundle 體積報告（依編輯器核心／worker／語言歸因）

npm run probe:package   # 打包產物本身（會先跑一次完整打包 —— 屬於「換版前跑一次」的層級，
                        #   刻意不併進 test:e2e）
```

## 打包與安裝

```bash
npm run dist:linux      # → release/Spekterm-<version>.AppImage
npm run install:desktop # → ~/.local/bin/Spekterm.AppImage ＋ 應用程式選單項目
```

產物是**單一可執行檔**，與 repo 工作副本完全脫鉤 —— 裝好之後不隨任何一次編輯而變動，直到你
明確重新打包。

### 換版是兩步，而版號每次都會變

`dist:linux` 的第一步是**遞增 patch 版本並提交**（`chore(release): <version>`，不打 tag）。
要升 minor 或 major 時以環境變數指定：`RELEASE_LEVEL=minor npm run dist:linux`（值不是 `patch`／`minor`／
`major` 時，它在動手之前就拒絕執行）。
這不是儀式 —— 在此之前檔名恆為 `Spekterm-0.1.0.AppImage`、app 內也不顯示版本，於是換版後行為
若沒變，「**修正沒生效**」與「**根本還在跑舊的**」分不出來，而這兩者要用完全不同的方式處理。

- **版號在哪裡看**：Settings 對話框的「About」段，含版號、建置時刻、commit，以及**建置當時
  工作副本乾不乾淨**。最後那一項是承重的：帶著未提交的編輯打包時版號一樣會跳，但那份產物
  **不對應任何 commit**，此時上面顯示的 commit 指的是最近一次提交而不是它。
- **`package.json` 或 `package-lock.json` 已被改過時，`dist:linux` 會拒絕執行。** 換版提交只能
  指名這兩個檔案，而遞增與你的編輯落在同一個檔案裡 —— 一次提交會把兩者一起帶走。先提交或還原
  它們再打包。
- **`release/` 只保留最近兩份產物**（當次與前一次）。換版後出問題時，退回上一份是第一個處置。
- **`install:desktop` 可以重複跑**，包括在**目前正在執行**已安裝的那一份時（它走
  「暫存檔 + rename」而不是就地覆寫）。移除用 `npm run uninstall:desktop`。

**開發模式與產物的設定分家。** 產物用 `~/.config/Spekterm`（也就是你原本的設定，原封接手），
`npm run dev` 走 `~/.config/spekterm-dev` —— 兩者同時開著時才不會互相覆蓋 session 清單。
這是靠 `dev` script 裡的 `XDG_CONFIG_HOME` 達成的，**主行程沒有任何對應的程式碼**；探針各自
用暫存 profile，不受影響。

> **只在 Linux 生效。** `XDG_CONFIG_HOME` 是 freedesktop 的慣例，macOS 與 Windows 上 Electron
> 不看它 —— 跨平台開發啟動時，這條隔離會**靜默失效**。

### 幾個前提（失敗訊息不會指向真正的原因）

- **執行 AppImage 需要 `libfuse2`。** Ubuntu 22.04 起預設不再安裝它，而缺少時的錯誤指向動態
  連結器（`dlopen(): error loading libfuse.so.2`），讀起來像「這個 app 壞了」。
  逃生口是不經 fuse 執行：

  ```bash
  ./Spekterm-*.AppImage --appimage-extract-and-run
  ```

- **首次打包需要網路** —— Electron 的官方 binary 會被下載到 `~/.cache/electron`（約 100 MB）。
  之後從快取取用。

- **AppImage 本身不會自動註冊到桌面環境** —— 這是 `npm run install:desktop` 存在的理由。
  它把產物複製到 `~/.local/bin/Spekterm.AppImage`（**檔名不帶版本**，於是桌面項目不必隨換版
  重寫），並寫入 `.desktop` 與圖示。位置全部尊重 `XDG_DATA_HOME` / `XDG_BIN_HOME`。
  **不要手寫一份指向 `release/` 的 `.desktop`** —— 那個目錄會被清除重建，而其中的檔名隨版本
  改變，桌面項目會靜默失效（項目還在選單裡，點下去沒有反應）。

- **`fs.inotify.max_user_watches` 過低的機器上，側欄與檔案樹會停止更新。** 每個被監看的目錄各佔
  一個 watch descriptor，而 app 監看的是每個 folder 與每個工作目錄的 `openspec/`（遞迴，
  `changes/archive/` 通常佔絕大多數）、工作目錄清單、`.git/HEAD`，以及 Files 身分**每一個已展開
  的目錄**。實測單一主行程佔用約 7700 個。

  ```bash
  cat /proc/sys/fs/inotify/max_user_watches   # 現代發行版預設 524288，夠用
                                              # 若是 8192（舊發行版與部分容器的預設）就會撞到
  ```

  撞到時的錯誤是 `ENOSPC`，會出現在主行程的 stderr（`[watch] <path>: … ENOSPC …`）——
  **自桌面選單啟動的話沒有人看得到它**，症狀只是畫面安靜地不再更新。提高上限：

  ```bash
  echo 'fs.inotify.max_user_watches=524288' | sudo tee /etc/sysctl.d/60-inotify.conf
  sudo sysctl --system
  ```

  注意**與 `max_user_instances`（預設 128）無關** —— libuv 對整個 event loop 只開一個 instance，
  主行程實測只佔 3 個。那個上限離耗盡很遠。

## 與 `spek` 的關係

開源的 [`spek`](https://github.com/spekhq/spek)（MIT）是 OpenSpec 的內容檢視器。
本 repo 是**獨立的 repo**（同樣以 MIT 開源）、不是它的 npm workspace 成員，透過 npm 消費它的兩個套件：

- **`@spekjs/core`** — scanner / tasks / git-cache / worktrees / types。主行程直接 `import`
  （純 Node 模組，行程內函式呼叫，不需要 HTTP server）。
- **`@spekjs/ui`** — `SpecGraph`（d3 力導向圖）與 `ChangeTimeline`（Gantt）。**純呈現層**：
  沒有 router、沒有 adapter、沒有 CSS 框架。顏色是一份 8 個 CSS 變數的契約，我們在 `index.css`
  覆寫它們，接上自己的深色主題。

**spek 的整頁視圖（Dashboard / SpecDetail / ChangeDetail）不重用** —— 它們為全寬瀏覽器設計、
自帶 `Layout` + `Sidebar`，而我們的側欄是 320–620px 的窄欄。**不是同一個東西。**
可重用的是「不綁版面」的那種元件（Graph / Timeline）與介面契約。詳見 `docs/PRD.md` §9.2。

## 授權

[MIT](./LICENSE)。打包出去的產物另附一份第三方授權彙總（`THIRD_PARTY_LICENSES.txt`），列出被打包進去的
每一個套件與它的授權。

想參與貢獻或贊助，請先看 [CONTRIBUTING.md](./CONTRIBUTING.md)。
