## Why

這個 app 至今沒有名字，只有一句描述。「spek workspace」＝ 一個開源專案的名字 + 一個泛用詞：
它在名字上與 spek web、spek VSCode extension 平級，看起來像 spek 的一個子功能，而不是一個獨立
產品 —— 但它是專有授權的商業產品（PRD §10 的 Freemium），而 spek 是 MIT 的開源檢視器，兩者共用
一個名字，在授權與定位上分不開。同時 `package.json` 的 `name` 仍是 **`@spek/workspace`**，借用了
**不屬於本專案的 npm scope** —— `@spek` 已被他人註冊，這正是 core 當初被迫改名為 `@spekjs/core`
的原因（CLAUDE.md 已記載此矛盾，但 `package.json` 本身沒修）。

**為什麼是現在。** Phase 6 要打包發佈，而 `appId` 是 macOS `CFBundleIdentifier` 與 Windows
uninstall registry key 的來源：**一旦隨安裝檔發佈出去就等於凍結** —— 之後再改，作業系統會視為一個
全新的 app，舊版不會自動更新過去，使用者手上會同時裝著兩個。userData 路徑同理（由 app 名稱解析而來），
發佈後改名會讓所有使用者的 workspace 設定失聯。**正名的成本從 Phase 6 起單調上升，現在是最後一個
便宜的時機。**

## What Changes

產品正名為 **spekterm**。可用性已驗證：npm `spekterm` 未被佔用、GitHub 零同名 repo、
`spekterm.com` / `.dev` / `.app` 皆未註冊。

- **產品身分**：明訂 app 在作業系統中的名稱（`productName`）、`appId`（反向域名，Phase 6 打包的
  輸入）與視窗標題，作為一份可驗收的規格 —— 而不是散落在各檔案裡的字串。
- **`package.json` 的 `name`**：`@spek/workspace` → `spekterm`（unscoped）。本 package 是
  `private`、不發佈至 npm，因此不需要 scope；改為 unscoped 徹底擺脫借來的 `@spek`。
- **BREAKING — userData 路徑改變，且不做遷移**：Electron 以 `app.getName()` 解析 userData 目錄，
  而 `getName()` **優先讀 `productName`、缺才退回 `name`**。現況沒有 `productName`，於是退回
  `@spek/workspace`，造出帶 `@` 的巢狀目錄 `~/.config/@spek/workspace/workspace.json`（實測吻合）。
  正名後路徑隨之改變，**既有的 folder 清單不會被讀到，app 開起來是空 workspace**。
  **本 change 明確不寫遷移程式碼** —— app 尚未發佈，唯一的使用者是作者本人，手動重新加入 folder 的
  成本遠低於一段只會執行一次、卻要長期維護的遷移路徑。**此決策有前提**：一旦有第一個外部使用者，
  任何改動 `productName` 的後續 change 都必須附遷移（見 design D4）。
- **內部識別字串**：`SPEK_SCAN_PATH` 環境變數、probe 的 `--user-data-dir` profile 名
  （`spek-*-profile`）—— 後者是 CLAUDE.md 記載的殭屍行程收屍手法（`pkill -9 -f <profile>` 連根
  拔除整棵行程樹）所依賴的識別字，改名時必須與 probe 腳本同步，否則收屍會失效。
- **文件**：`docs/PRD.md`（標題與內文）、`README.md`、`CLAUDE.md`、`docs/workspace-mockup.html`
  的標題列。
- **GitHub 位置**：repo 正名為 **`spekterm`**（GitHub 上該名稱未被佔用）。**org 歸屬待定，且
  刻意不阻塞本 change** —— 首選是把 repo 放進 `spekjs` org，讓 GitHub org 與 npm scope `@spekjs`
  對齊，但該名稱目前被一個閒置的 User 帳號佔著（0 repo、0 follower、2020 年建、2022 年後無動靜），
  已向 GitHub Support 申請釋出（作者曾以同一管道成功要回 `kewang`）。申訴結果不影響本 change 的
  任何凍結決策：`appId`、`package.json` 的 `name`、`productName` **都不依賴 GitHub org**，而 GitHub
  的 repo 改名與 transfer 皆自動 redirect、隨時可做。備案見 design D5。

**明確不改**（避免範圍蔓延，也避免製造無意義的 diff）：

- `openspec/changes/archive/**` —— 歷史紀錄。改動它等於竄改當時的決策脈絡；那些文件記載的是
  「在那個時間點這個專案叫什麼」，本身是正確的。
- 既有 capability 名稱（`workspace-app-shell`、`spek-core-integration` 等）—— 內部 identifier。
  其中 `spek-core-integration` 指的是「整合開源的 `@spekjs/core`」，正名後這個名字**依然正確**。
- `@spekjs/core` / `@spekjs/ui` 依賴 —— 那是 spek 開源專案的套件，不隨本 app 改名。

## Capabilities

### New Capabilities

- `app-identity`: app 在作業系統中的正式身分 —— 產品名稱、`appId`、視窗標題、userData 路徑的解析
  來源，以及「不得借用不屬於本專案的 npm scope」這條約束。Phase 6（打包與發佈）將直接消費這份規格：
  `appId` 與 `productName` 是 electron-builder 的輸入，且發佈後即凍結。

### Modified Capabilities

（無。）

`workspace-folders` 的「設定持久化並於重啟後還原」**行為本身沒有變**：設定仍寫在
`app.getPath('userData')` 之下、重啟仍還原。變的只是那個目錄的名字，而既有 requirement 從未
承諾任何特定路徑。由於本 change 不做遷移（見上），也就沒有「跨版本還原舊設定」這條新行為要進 spec。
`app-identity` 會規範「userData 路徑由誰決定」，那是新的關注點，不是對舊 requirement 的修改。

## Impact

- **程式碼**：`package.json`（`name`、新增 `productName` 與 `build.appId`）、
  `src/renderer/index.html`（視窗標題）。`src/main/index.ts` **預期不需要改** —— userData 路徑由
  Electron 依 `productName` 自動解析，`app.getPath('userData')` 這行呼叫本身不動。
- **驗收**：`scripts/probe-*.mjs`（profile 名、`SPEK_SCAN_PATH`）；新增對 app 身分的斷言
  （`productName` / `appId` / userData 路徑 / 視窗標題）。
- **文件**：`docs/PRD.md`、`README.md`、`CLAUDE.md`、`docs/workspace-mockup.html`。
- **下游**：Phase 6 的打包設定依賴 `app-identity` 定下的 `appId` / `productName`。
- **依賴**：無新增。
