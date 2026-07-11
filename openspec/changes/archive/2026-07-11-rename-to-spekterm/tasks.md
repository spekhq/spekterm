## 1. 產品身分（`package.json`）

- [x] 1.1 `name`：`@spek/workspace` → `spekterm`（unscoped）
- [x] 1.2 新增 `productName`：`Spekterm` —— 這同時決定 userData 目錄名（`app.getName()` 優先讀它）
- [x] 1.3 新增 `build.appId`：`com.spekterm.app`（electron-builder 預設讀 `package.json` 的 `build`
      欄位，Phase 6 裝了就直接生效）

## 2. 應用程式內的產品名

- [x] 2.1 `src/renderer/index.html` 的 `<title>`：`spek workspace` → `spekterm`
- [x] 2.2 `src/main/index.ts`：`SPEK_SCAN_PATH` → `SPEKTERM_SCAN_PATH`（第 71 行的讀取，以及第 68
      行的註解）

## 3. 驗收腳本

- [x] 3.1 **先**以舊 profile 前綴清一次殘留殭屍，**再**改名 —— 改名後舊的 `pkill` 模式就抓不到
      它們了，而它們還佔著 debugging port。（實測無殘留。**踩雷**：`pkill -f` 比對整條 command
      line，會把執行它的 shell 自己殺掉 —— pattern 要寫成 `'spekterm[-]files-profile'` 自我豁免。
      已補進 CLAUDE.md）
- [x] 3.2 probe 的暫存目錄前綴 `spek-*` → `spekterm-*`。**實際範圍比預期大**：不只 `--user-data-dir`
      的 profile（5 支），還有 **fixture 目錄**（`spek-fixture-`、`spek-files-fixture-`、
      `spek-openspec-fixture-`、`spek-term-fixture-`、`spek-corrupt-`、`spek-noopenspec-`）——
      手動 grep `profile` 完全看不到它們，是 3.5 的測試揪出來的
- [x] 3.3 `scripts/probe-core.mjs`：`SPEK_SCAN_PATH` → `SPEKTERM_SCAN_PATH`
- [x] 3.4 新增 `scripts/probe-identity.mjs` 與 `npm run probe:identity`（7/7 通過）。
      **設計被實作推翻了一次**：原本打算像 `probe:native` 那樣寫成 Electron 主行程腳本
      （`electron scripts/probe-identity.mjs`），但那種跑法**不會讀 repo 的 `package.json`** ——
      `app.getName()` 回退到 `"Electron"`、userData 落在 `~/.config/Electron`，量到的是 Electron
      的預設值而非我們的宣告。改為啟動真正的 `electron .`（不傳 `--user-data-dir`），再從**子行程的
      argv** 讀 `--user-data-dir=<path>` —— userData 是外部可觀察的，不需要產品程式碼吐任何診斷資訊
- [x] 3.5 新增 `scripts/naming.test.mjs`：版控追蹤的檔案不得殘留舊識別字串（排除 archive），
      並將 `scripts/*.test.mjs` 納入 `npm test`。**對照組立了大功**：它要求「不排除 archive 時必須
      命中舊名」，因而抓到 `git grep` 的輸出帶 ANSI 顏色碼（本機 `color.ui` 設定所致）使路徑比對
      靜默失準 —— 少了對照組，正面斷言會全綠，而那個綠是假的

## 4. 文件

- [x] 4.1 `README.md`
- [x] 4.2 `CLAUDE.md`：專案概述、`SPEKTERM_SCAN_PATH`、收屍手法的 profile 名、新增 `probe:identity`
      的說明，以及 `pkill -f` 自我匹配的踩雷紀錄
- [x] 4.3 `docs/PRD.md`：文件標題與內文
- [x] 4.4 `docs/workspace-mockup.html`：`<title>` 與畫面上的標題列
- [x] 4.5 `openspec/config.yaml` 的 `context:` 區塊（**tasks 原本漏列** —— 它是 OpenSpec 餵給
      每個 change 的專案脈絡，含舊產品名）
- [x] 4.6 `package-lock.json`（**tasks 原本漏列** —— `name` 欄位含舊 package 名，以
      `npm install --package-lock-only` 重新產生）
- [x] 4.7 `openspec/specs/spek-core-integration/spec.md` 內文以 `spek-workspace` 指稱本專案
      （**tasks 原本漏列**）。這是**帶連字號**的舊名 —— 搜「spek workspace」搜不到它，是 repo 目錄
      改名後才被揪出來的。capability 名稱本身保留（它指的是整合 `@spekjs/core`，正名後依然正確）。
      改的是內文的專案名、非 requirement 行為，因此不需要 delta spec。已把此形式加進 3.5 的
      forbidden 清單

## 5. repo 的位置

> 買下 `spekterm.com` / `spekterm.app` **不列為任務** —— 它不動 codebase。它是一筆**已知的未結
> 風險**（`appId` 已凍結，但它反寫的 domain 尚未買下），記於 design 的 Risks 段。

- [x] 5.1 GitHub repo 改名：`kewang/spek-workspace` → **`kewang/spekterm`**（以 `gh repo rename`
      完成，本機 `git remote` 已同步更新）。舊 URL 的 redirect 實測有效（`git ls-remote` 舊網址仍
      列得出 ref），其他機器上的既有 clone 不會斷。**org 歸屬待 `spekjs` 申訴結果** —— 申訴成功後
      再 transfer 進 org，同樣自動 redirect，不阻塞本 change
- [x] 5.2 本機工作目錄 `/home/me/git/spek-workspace` → `/home/me/git/spekterm`，並一併搬移
      Claude Code 的 project 目錄（`~/.claude/projects/-home-me-git-spek-workspace` →
      `-home-me-git-spekterm`），否則既有 memory 會失聯 —— project 識別是綁 cwd 路徑的

## 6. 驗證

- [x] 6.1 `npm run typecheck` —— 通過
- [x] 6.2 `npm run lint` —— 通過
- [x] 6.3 `npm test` —— 165/165
- [x] 6.4 **所有** probe（profile 更名觸及每一支）：`identity` 7/7、`native` 9/9、`shell` 13/13、
      `core` 17/17、`workspace` 35/35、`terminal` 88/88、`files` 94/94、`openspec` 142/142
- [x] 6.5 手動啟動實測（作者親測）：**folder 清單是空的 —— D4 的預期行為，不是 regression**。
      重新加入 folder 後重啟，`workspace-folders` 的還原行為未被正名破壞
