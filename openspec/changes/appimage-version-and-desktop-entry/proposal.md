## Why

dogfood 的換版流程是「`npm run dist:linux` 之後覆蓋同一個檔案」，而**產物與執行中的 app 都說不出
自己是哪一版**：`package.json` 的 `version` 恆為 `0.1.0`（沒有任何流程去 bump 它），檔名因此恆為
`Spekterm-0.1.0.AppImage`，app 內部也沒有任何地方呈現版本。於是換版後行為若沒變，「修正沒生效」
與「根本還在跑舊的」**無法區分** —— 這正是會讓人追錯方向的那種缺口（issue #13）。現場已有證據：
`release/` 裡躺著一個手工複製的 `Spekterm-0.1.0.AppImage.prev`，那就是這個缺口逼出來的權宜作法。

同一個換版流程還缺另一半：AppImage **不會自行註冊到桌面環境**，使用者得從檔案管理員找到它雙擊，
或自己手寫一份 `.desktop`（issue #15）。而這不只是便利問題 —— `desktop-packaging` 有兩條
requirement 明文要求「**SHALL 以自桌面環境啟動的執行驗收，SHALL NOT 以自終端機啟動的執行替代**」，
**沒有一個桌面項目可以點，那兩條現在根本驗不了**。

兩件事合為一個 change，是因為它們是同一條流程的兩半：一個讓你點得到 app，另一個讓你點下去之後
知道跑的是哪一版。

## What Changes

**版號逐次遞增（issue #13）**

- **打包指令自身 bump patch 版本並提交** —— 版號成為產物的第一辨識碼，且**不倚賴任何人記得**。
  issue #13 的選項 2 之所以被評為「要記得不是機制」，正是因為它把 bump 留給人；由打包指令承擔
  就沒有這個問題。
- **順序為 bump → commit → build**，如此戳記裡的 commit 精確指向產出這份產物的原始碼狀態。
- **只提交 `package.json`**，SHALL NOT 連同工作副本中其他未提交的變更一併提交 —— dogfood 時
  帶著未提交的編輯去打包是常態，把它們掃進一個 `chore(release)` commit 是資料損害。
- **不打 git tag** —— dogfood 期間每次打包一個 tag 只是噪音；真正發版時再另行處置。

**建置戳記（issue #13）**

- 版號之外再帶一個戳記（建置時刻 ＋ git commit ＋ **工作副本在 bump 之外是否仍 dirty**）。
  版號回答「哪一版」，戳記回答「那一版是從什麼狀態建出來的」—— 後者在 dogfood 期間承重：
  帶著未提交的編輯打包時，版號一樣會跳，但那份產物**不對應任何 commit**。
- 產物**檔名**帶版號（electron-builder 既有行為即如此）—— 回答「這個檔案是哪一版」。
- **Settings 對話框新增「關於」段**呈現版號與戳記 —— 回答「執行中的 app 是哪一版」。
  **刻意不放狀態列**：`status-bar` 明文「SHALL NOT 呈現應用程式版本號這類恆為同一個值的欄位」，
  且已判定 mockup 右下角的 `spek ws 0.1` 是佔位內容而非契約。此處不推翻該裁決。
- 戳記於**開發模式**下亦須有定義的行為（不是打包產物，沒有打包時刻可言）。

**桌面整合（issue #15）**

- 新增一個安裝指令，把打包產物複製到**固定位置**（`~/.local/bin/`）並產生指向它的 `.desktop`
  與圖示。指向 `release/` 是不行的：那個目錄在 `.gitignore` 內、會被 `rm` 掉重建，而檔名現在
  還會隨戳記改變 —— 桌面項目會**靜默失效**。
- 換版流程因此變成兩步（`dist:linux` → `install:desktop`），這是刻意的取捨：換到固定位置之後，
  桌面項目不必再隨每次打包重建。
- README 記載安裝與移除，並更新既有那條「AppImage 不會自動出現在應用程式選單」的手動步驟。

**不做的事**

- **不碰應用程式圖示的品牌識別**（issue #14）—— 安裝腳本沿用現有的 placeholder，換圖示是獨立
  的決策。
- **不修 issue #20**（agent CLI 在 nvm 下的 PATH 解析）—— 本 change 只是讓那條驗收**做得到**，
  不改變它的結果。

## Capabilities

### New Capabilities

- `build-identity`: 「這份產物是哪一版、從什麼狀態建出來的」這個問題的完整答案 —— 版號的遞增由
  打包指令承擔（含只提交 `package.json`、不打 tag 這兩條約束）、建置戳記的產生與注入、檔名與
  執行中的 app 呈現**同一個**版號與戳記、開發模式下的定義行為，以及「逐次必不同」這個性質本身
  （一個恆定的辨識碼，與現況等價）。

### Modified Capabilities

- `terminal-preferences`: 「偏好設定介面」這條 requirement 目前把該對話框描述成純粹的終端偏好，
  而它已經不是（agent 狀態橋接開關就住在那裡，且**該擴張當年正是對這條能力下 delta 完成的**）。
  本 change 再加一段唯讀的建置身分，因此把介面實際承擔的範圍與其標題一併寫進條文。
- `desktop-packaging`: 新增「專案提供將產物整合進桌面環境的機制」這條 requirement —— 安裝到固定
  位置、產生 `.desktop`、移除方式、以及 README 記載。既有那兩條「SHALL 以自桌面環境啟動驗收」的
  requirement 不改動其條文，但本 change 是它們**首次具備可執行的前提**。

## Impact

**產品程式碼**

- `src/renderer/src/shell/settings/TerminalFontDialog.tsx` —— 新增「關於」段。此對話框已有非終端
  偏好的內容（agent status 開關），**而那次擴張是對 `terminal-preferences` 下 delta 完成的**
  （`openspec/specs/terminal-preferences/spec.md` 的「偏好包含是否啟用 agent 狀態橋接」，來自
  `2026-07-21-panel-drive-and-shell-affordances`）—— 本 change 沿用同一條慣例。
- **對話框的標題文案**目前是 `Terminal`（`en.json` 的 `settings.title`）。加入建置身分之後那個
  標題不再涵蓋它實際承載的內容，須一併調整。
- 主行程／preload —— 戳記的來源與經 IPC 送達 renderer 的路徑（尚待 design 決定注入形式）。
- `src/shared/i18n/en.json` —— 「關於」段的文案（UI 文案一律來自字典）。

**建置與打包**

- `package.json` 的 `version` 自此逐次遞增；新的 `dist:linux` 前置步驟與 `install:desktop`
  script；`electron.vite.config` 的 define／產生檔（視 design 而定）。
- **`npm version patch` 在工作副本不乾淨時會直接失敗**（`Git working directory not clean`，已實測）
  —— 而 dogfood 時帶著未提交的編輯打包正是常態。實作因此不能直接用它的預設行為，須
  `--no-git-tag-version`（實測該旗標一併豁免此檢查）後自行提交。這一條若沒處理，**打包指令會在
  最常見的情況下拒絕執行**。
- **`package-lock.json` 也在版控，且 `npm version` 會一併改寫它**（實測：`git diff --numstat`
  兩個檔案各 1–2 行）。提交範圍漏掉它的後果不是不完整，是**每一份產物從此都被標為 dirty**，
  而該欄位從此不傳遞任何資訊。
- **`scripts/probe-package.mjs` 的 `findAppImage()` 以 `.sort().at(-1)` 挑檔案** —— 版號逐次
  遞增之後 `release/` 會累積多個產物，而**字典序不是版號序**（`0.1.9` 會排在 `0.1.10` 之後）。
  選檔規則要重新檢視。
- **打包失敗時版號已經跳掉一格**（bump 在 build 之前）。遞增是廉價的，此代價接受，但要寫明。

**驗收**

- `scripts/packaging-config.test.mjs`（單元層守衛）新增戳記相關欄位。
- `probe:package` 新增段落：產物檔名含戳記、且執行中的 app 呈現**同一個**戳記。**兩者一致是承重
  的** —— 各自正確但彼此不同，等於沒有解決「我跑的是不是剛才那次打包的」。
- 安裝腳本本身的驗收（產生的 `.desktop` 合法、`Exec` 指向確實存在的檔案）。

**文件**

- README 的「打包與安裝」章節（含 `Spekterm-0.1.0.AppImage` 的字面路徑，版本遞增後全部要改）、
  「AppImage 不會自動出現在應用程式選單」那一條前提。
- CLAUDE.md 的開發指令表與「現況」段；`docs/PRD.md` §11 的 Phase 6 清單（CLAUDE.md 明訂 PRD 是
  範圍的單一權威，新增一個 capability ＋ 一個打包步驟屬於那裡）。

**issue**

- 交付後可關閉 #13 與 #15。
