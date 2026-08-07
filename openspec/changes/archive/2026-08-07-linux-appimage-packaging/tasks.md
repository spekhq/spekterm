# Tasks

> **每一條 scenario 的驗收載體對應表在最後一節。** 它存在的理由是 CLAUDE.md 那條已經重演四次的
> 教訓 ——「補一條 scenario」與「覆蓋一條 scenario」是兩個動作。**但表本身不是覆蓋**：
> `global-session` 的對照表就曾宣稱了四條不存在的載體。表裡的每個編號都必須指向這份清單裡一個
> 真的被打勾的 task。

## 1. 依賴與資產

- [x] 1.1 加入 `electron-builder` 為 devDependency，版本 `^26.15.7`
      （**注意**：npm 的 `latest` 標籤是 26.15.3，`v26` 標籤才是 26.15.7 —— 直接
      `npm i -D electron-builder` 會拿到較舊的那個）
- [x] 1.2 產生 512×512 的 placeholder 應用程式圖示（深底 `#0a0c0f` + amber `#f59e0b`），
      納入版控。**不沿用 `../spek/logo/` 的資產**（design D9）
      → `build/icon.png`，以幾何形狀繪製（`>_` prompt），**不依賴任何字型** —— 字型缺字的
      失效方式是靜默的（CLAUDE.md 狀態列那條的同族）

## 2. 打包設定與開發／產物的資料隔離

- [x] 2.1 於 `package.json` 的 `build` 之下補齊設定：Linux 目標為 AppImage（x64）、
      `directories.output` 為 `release`、`files` 涵蓋 `out/**` 與 `package.json`、
      `asarUnpack` 涵蓋 `node-pty` 整個套件、圖示路徑。**設定續留 `package.json`，
      不外移為獨立設定檔**（design D2）
      → 實作時多加兩項，兩項都不在原本的 artifact 裡：
      **(a) `npmRebuild: false`** —— electron-builder **預設為 `true`**，會對 native 相依執行
      重建，而 `native-module-toolchain` 整條規格建立在相反的前提上（node-pty 是 N-API、
      無需為 Electron ABI 重建）。開著它的代價是打包從此需要 C++ toolchain，且重建出來的
      binary 反而綁死 ABI。打包輸出已確認 `skipped dependencies rebuild`。詳見 5.1
      **(b) `syncDesktopName: true`** —— 打包時 electron-builder 明確警告：未設定時桌面環境
      無法把執行中的視窗連到 `.desktop` 項目（工作列圖示與視窗分組會不對）。缺 `desktopName`
      時它 fallback 到 `executableName`
- [x] 2.2 新增 npm script `dist:linux`
- [x] 2.3 首次打包實測並記錄產物體積於本檔（design 的「產物體積」風險要求先量出來、
      **不做優化**）。若 ESM 進入點在 asar 內解析失敗，改以 CJS 輸出 main（design 風險段的逃生口）
      → **`release/Spekterm-0.1.0.AppImage`，125 MB**，具執行權限。打包階段 ESM 進入點無異常
      （能否執行由 4.2 回答）。electron 43.1.0 的 binary 於本次下載並快取
- [x] 2.4 `dev` script 改為 `XDG_CONFIG_HOME=$HOME/.config/spekterm-dev electron-vite dev`
      （design D8）。**主行程一行不改。** 同時確認 `SPEKTERM_SCAN_PATH=… npm run dev` 仍照常運作
- [x] 2.5 **不得清理或搬動 `~/.config/Spekterm`** —— 那是使用者現行的設定，打包產物要原封接手它
      （這條是為了擋一次「順手整理」）→ 未觸碰；mtime 於 6.5 覆核

## 3. 設定守衛（單元層，併入 `npm test`）

- [x] 3.1 新增 `scripts/packaging-config.test.mjs`：斷言 `build.linux.target` 含 AppImage、
      `directories.output` 為 `release`、`build.asarUnpack` 涵蓋 `node-pty`、圖示檔存在、
      repo 根目錄**不存在**獨立的 electron-builder 設定檔，且 **`dev` script 設定了隔離
      userData 的環境變數**（不是只在文件裡記載）
      → 8 條斷言。兩個講究：glob 以 `path.matchesGlob` **真的匹配**（不是字串包含 —— 後者
      在 pattern 漏一個層級時仍會通過）；且 `asarUnpack` 有一條**反向**斷言（一個純 JS 相依
      SHALL NOT 被匹配到），否則 `**` 這種把整個 asar 解開的 pattern 也會通過。
      另加一條 `npmRebuild === false`（見 2.1a）
- [x] 3.2 確認新檔已被 `test:unit` 的 glob（`scripts/*.test.mjs`）納入
      → `npm test` 436 tests / 436 pass（既有 428 + 新增 8）
- [x] 3.3 **對照組（兩條，各驗一次）**：(a) 暫時移除 `asarUnpack` 的 `node-pty` 涵蓋；
      (b) 暫時把 `dev` script 還原成不帶環境變數的版本 —— 兩次都確認 3.1 的守衛**變紅**，
      再各自還原。結果記於本檔
      → **(a) 變紅**：`not ok 3 - asarUnpack …`（7 pass / 1 fail）。
      **(b) 變紅**：`not ok 8 - dev script 以環境變數隔離 userData`（7 pass / 1 fail）。
      還原後 8/8 綠。
      **但 (a) 的意義在 6.1 之後變了**：它只證明守衛確實在讀 `package.json`，**不證明那行設定
      有任何作用**（實測：拿掉它產物結構完全相同）。該條斷言與測試名稱已據此改寫

## 4. 打包產物探針

- [x] 4.1 新增 `scripts/probe-package.mjs`：先執行打包，再把產物**複製到 repo 之外的暫存目錄**
      執行，傳 `--remote-debugging-port` 與 `--user-data-dir`（獨一無二的 profile 名，
      前綴 `spekterm-`）並以 CDP 連入
- [x] 4.2 斷言四件事：(a) 打包產出的 `.AppImage` 具執行權限；(b) 視窗開啟且 `document.title`
      為 `spekterm`；(c) 生效中的 CSP 為 production（`script-src` 為 `'self'`、無 dev server
      來源）；(d) **建立一個終端 session 並收到 shell 的輸出**
      → 6/6 通過。(d) 的判準改為「**pty 行程存在 + 送進去的指令在磁碟上留下副作用**」而非
      讀畫面 —— 理由見第 5 節與 spec 的對應修訂
- [x] 4.3 收屍：`pkill -f <profile>` 之後清理殘留的 `/tmp/.mount_*` 掛載點（design D5）
      → 初版兩個講究都漏了，見 5.3
- [x] 4.4 新增 npm script `probe:package`。**不併入 `scripts/run-probes.mjs` 的預設序列**
      —— `test:e2e` 已經十幾分鐘，再加一次完整打包會把它推到沒有人願意跑的長度（design 風險段）
      → `run-probes.mjs` 的 `PROBES` 是寫死清單，未含 `package`，確認無誤
- [x] 4.5 確認探針在 `xvfb` 下可執行（沿用 `scripts/run-probe.mjs` 的既有包裝）
- [x] 4.6 於 `scripts/probe-identity.mjs` 增加一個段落：在**設定**與**未設定**
      `XDG_CONFIG_HOME` 的兩種情況下各啟動一次，斷言兩次解析出的 `userData` 不同、且設定時的
      路徑落在該變數所指的目錄之下。**理由**：這條驗的是 Electron 的行為而非我們的程式碼 ——
      而 Electron 升版若改變它，隔離會**靜默消失**（`dev` script 照常執行、一切看起來正常，
      設定卻又寫回 `~/.config/Spekterm`）。載體選 `probe:identity` 是因為它已經在做 userData
      路徑的外部觀察，手法可直接複用
      → 9/9 通過（既有 7 + 新增 2）。啟動流程抽成 `launchAndObserve()` 以便呼叫兩次；
      第二次用 `DEBUG_PORT + 1`，且 electron 的 stderr 在拋錯前印出（否則它會隨函式一起消失）

## 5. 實作揭露的三件事（artifact 已據此修訂）

- [x] 5.1 **`npmRebuild: false`** —— electron-builder 預設會重建 native 相依，與
      `native-module-toolchain` 的整條前提相反。已補為 spec 的一條 requirement（含兩條
      scenario）與 3.1 的一條斷言。**失效是遲滯且異地的**：在有 toolchain 的機器上打包照樣
      成功，問題出現在別人的機器上
- [x] 5.2 **CSP 收集器的注入時機有兩個相反的夾制** —— 必須在觸發違規**之前**，但也必須在
      **頁面導航完成之後**。Electron 的 renderer 起初是 `about:blank`，隨後才導航到 asar 內的
      `index.html`；在那之前注入，listener 會隨舊 context 一起消失。
      **這一輪真的紅了一次，而紅的形狀指向一個不存在的安全退化**（政策明明生效 —— 事後以
      inline script 實測確認被擋 —— 但收集器讀到空字串）。修法是把武裝移到 `MOUNTED` 之後，
      並把這兩個夾制寫進 `CSP_ARM` 的註解
- [x] 5.3 **探針留下了六個 AppImage 掛載點殘留**（其中一個仍真的掛載著）。兩個原因，
      4.3 的初版兩個都漏了：(a) `fusermount -u` 在「行程剛被 `SIGKILL`、fd 尚未關閉」時會以
      device busy 失敗 —— 要用 **`-uz`（lazy）**；(b) 卸載之後**目錄不會消失**，沒人刪它，
      `/tmp` 會慢慢長出一堆空殼。已修正並清空既有殘留（掛載數 0、目錄數 0）

## 6. 驗收

- [x] 6.1 **產物探針的對照組**：移除 `asarUnpack` 後重新打包，確認 4.2 的 (d) pty 斷言**變紅**；
      還原後重打，確認轉綠。結果記於本檔。**這是唯一能證明這支探針不是假綠的東西**（design D4）
      → **對照組沒有變紅（6/6 依然全綠），而這是本 change 最有價值的一條結果。**
      追查產物才知道原因：**electron-builder 偵測到套件內含 `.node` 就自動整包解出 asar** ——
      有無設定時 `app.asar.unpacked/node_modules/node-pty` 的檔案數**皆為 29，完全相同**。
      也就是說 `asarUnpack` 是**冗餘的明示**，不是承重的機制，而 design 初版寫的「唯一會讓
      app 啟動即壞的必要設定」是錯的。artifact 已據此修正（proposal／design D3／spec）
- [x] 6.2 **改以另一個對照組證明 pty 斷言不是永遠綠**（6.1 既然不變紅，就需要它）：
      把探針比對用的 shell 換成一個不存在的路徑，使 pty 根本建立不起來。
      → **兩條 pty 斷言同時變紅**（`pty 行程數 = 0`、副作用未出現），4/6。還原後 6/6。
      斷言的敏感度成立。
      連帶修掉探針裡一句**錯誤歸因**的診斷訊息（原本寫「asarUnpack 漏掉 node-pty 時就是這個
      徵狀」—— 那個歸因現在已知是錯的，會把下一個人送去查一個沒問題的設定）
- [x] 6.3 `npm run typecheck`、`npm run lint`、`npm test` 全綠
      → typecheck exit 0、lint exit 0、`npm test` 436/436
- [x] 6.4 `npm run test:e2e` 全綠（確認本 change 未影響既有 9 支探針）
      → **9/9 全過，全檔 0 個 ✗**：native 9/9、core 17/17、**identity 9/9**（含新增的兩條）、
      shell 19/19、workspace 91/91、files 111/111、keyboard 200/200、openspec 436/436、
      terminal 252/252。總計 754s
- [x] 6.5 端到端確認隔離生效：跑一次 `npm run dev`，確認設定落在
      `~/.config/spekterm-dev/Spekterm`，且 `~/.config/Spekterm` 的 mtime **未被更動**
      → dev 產生了 `~/.config/spekterm-dev/Spekterm/{panel,sessions}.json`；
      `~/.config/Spekterm/workspace.json`（2026-08-06 15:06:38）與 `sessions.json`
      （2026-08-07 10:45:18）的 mtime 前後**完全相同**
- [x] 6.6 最終產物以**正式設定**重打並複驗：`release/Spekterm-0.1.0.AppImage`（125 MB，
      mode 755），`probe:package` **6/6**。收屍檢查：掛載點殘留 0、仍掛載 0、殘留行程 0
- [x] 6.7 確認隔離在產物側也成立：帶 `--user-data-dir` 啟動 AppImage 時，隔離 profile
      確實被建立，且 `~/.config/Spekterm/{sessions,panel}.json` 的 mtime **未變動** ——
      `probe:identity` 亦同（實測前後 mtime 相同，其「只讀不寫」的註解成立）
- [x] 6.8 **dogfood（由使用者執行）**：自應用程式選單或檔案管理員（**不是終端機**）啟動 AppImage，
      加入一個 folder、建立一個 agent session，確認 `claude` 成功啟動。同時確認
      `resolveShell()` 在 GUI 啟動下取得的 `SHELL`（design D7 的未實測項）
      → **使用者實測通過。** `claude` 在桌面啟動的 AppImage 中起得來 —— 這正是 D7 要的證據：
      桌面環境啟動的行程只繼承系統預設 PATH，而 `claude`（`~/.local/bin`）與 node（nvm 之下）
      都只存在於 profile 載入後的 PATH，因此 `terminal.ts` 的 login shell spawn 確實生效。
      **`SHELL` 的具體值未回報** —— D7 那條「GUI 啟動時 `SHELL` 不保證存在、缺席會退回
      `/bin/bash -l`」的顧慮在這台機器上未成為問題，但也未取得直接讀數

## 7. 文件與註記

- [x] 7.1 `README`：打包與安裝章節 —— `dist:linux` 用法、`libfuse2` 前提、
      `--appimage-extract-and-run` 逃生口、首次打包需要網路、`.desktop` 選單項目為可選步驟
- [x] 7.2 `src/main/index.ts`：於 `resolveScanTarget()` 處補註解，指出它的預設值是
      `app.getAppPath()`（打包後為 asar 路徑），**今天安全只因為 `app.isPackaged` 擋著**
      —— 若日後把掃描摘要改成無條件輸出，打包版會去掃 asar 內部並回傳一堆零（design D6）
- [x] 7.3 `CLAUDE.md`：開發指令補上 `dist:linux` 與 `probe:package`，註明後者屬於「換版前跑
      一次」的成本層級（與 `test:e2e` 同一張表的邏輯）；並記下 `dev` 與打包產物的 userData 已
      分家 —— **含那條跨平台的失效**（`XDG_CONFIG_HOME` 只在 Linux 生效，macOS／Windows 上
      隔離會靜默消失，見 design D8）
- [x] 7.4 `docs/PRD.md`：Phase 6 註記 Linux AppImage 已交付，其餘項目未動

## 驗收載體對應

| Spec scenario | 載體 | Task |
|---|---|---|
| 打包指令產出可執行的 AppImage | `probe:package` | 4.2 (a) |
| 產物脫離 repo 仍可執行 | `probe:package` | 4.1 + 4.2 (b) |
| 打包設定位於 package.json | 單元守衛 | 3.1 |
| 版控中不存在獨立的 electron-builder 設定檔 | 單元守衛 | 3.1 |
| 打包產物中建立的 session 產生真實的 pty 行程 | `probe:package` | 4.2 (d) |
| 送進 session 的指令確實被執行 | `probe:package` | 4.2 (d) |
| 打包設定明示 node-pty 須解出 asar | 單元守衛 | 3.1 |
| asarUnpack 的涵蓋範圍不致使 asar 失去意義 | 單元守衛（反向斷言） | 3.1 |
| 打包設定關閉 native 模組重建 | 單元守衛 | 3.1 |
| 打包過程回報未執行重建 | 打包輸出（已實測記錄） | 2.1 (a) |
| 打包產物的 renderer 收到 production CSP | `probe:package` | 4.2 (c) |
| 打包產物開啟視窗並載入 renderer | `probe:package` | 4.2 (b) |
| 關鍵設定齊備時守衛通過 | `npm test` | 3.1 + 6.3 |
| 移除 asarUnpack 時守衛失敗 | 人工對照組（跑一次並記錄） | 3.3 (a) |
| 開發模式的啟動指令自身宣告了資料目錄的隔離 | 單元守衛 + 對照組 | 3.1 + 3.3 (b) |
| 該環境變數確實改變 userData 的解析結果 | `probe:identity` 新段落 | 4.6 |
| 自桌面環境啟動後可建立 agent session | 人工 dogfood | 6.8 |
| README 記載執行前提與逃生口 | 人工（README 內容由人擔保） | 7.1 |
