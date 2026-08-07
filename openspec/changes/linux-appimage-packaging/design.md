## Context

Phase 6（打包與發佈）至今零實作：沒有 electron-builder、沒有 build 設定、沒有圖示。app 只能以
`npm run dev` 啟動，而那份執行**綁在 repo 的工作副本上** —— 使用它工作與開發它是同一份程式碼。

本 change 只取 Phase 6 的第一步：**產出一份與 repo 脫鉤的 Linux 可執行檔**。

**打包後才第一次被真正執行的路徑有五條**，它們全都已經寫好了，本 change 的工作是確認它們成立：

| 路徑 | 現況 | 打包後 |
|---|---|---|
| CSP 政策切換 | 依 `ELECTRON_RENDERER_URL` 的存在（**不是** `isPackaged`） | 落在 production 分支 —— 與既有 probe 的 build 模式**同一個分支**，但 URL scheme 從 `file:///…/out/renderer` 變成 asar 內的路徑 |
| renderer 載入 | `loadFile(join(currentDir, '../renderer/index.html'))` | 該相對路徑要在 asar 內解析得到 |
| `app.isPackaged` 分支 | 恆為 `false`，掃描摘要一律輸出 | 首次為 `true`，掃描摘要不再輸出 |
| native 模組載入 | 從 `node_modules/node-pty` 直接 `require` | 從 asar 內 require，**除非 unpack 否則 `dlopen` 失敗** |
| pty 的 PATH | 從 terminal 啟動，繼承 terminal 的完整 PATH | 從桌面啟動，`process.env.PATH` 只有系統預設 —— 由 `terminal.ts` 的 login shell（design D6）承擔 |

**已實測的環境前提**（本機，2026-08-07）：Ubuntu 20.04.6 LTS、`libfuse2` 2.9.9-3 已安裝、
`/dev/fuse` 存在 ⇒ AppImage 可直接執行。`~/.cache/electron-builder/appimage` 已有快取的 runtime。

## Goals / Non-Goals

**Goals:**

- 一份 `release/Spekterm-<version>.AppImage`，`chmod +x` 後可直接執行，執行後不再受 repo 內任何
  編輯影響。
- 打包後 pty 可用 —— 這是 app 的核心功能，也是 asar 最容易靜默破壞的一環。
- 打包設定有守衛，不會在日後某次「整理 package.json」時被靜默拿掉。
- 產物的驗收走**行為**，不走檔案存在性。

**Non-Goals:**

- macOS / Windows 產物、自動更新、程式碼簽章、CHANGELOG 流程、深色主題與原生選單。
- userData 隔離（使用者已裁決，代價見 D8）。
- 產物體積優化（先量出來，不預先優化）。
- 產品程式碼的功能改動。**預期零改動**；若上表任一條不成立，才進入修正，且屆時要回頭補 spec。

## Decisions

### D1. 產物形態選 AppImage 單檔，不選 deb / unpacked

| | AppImage | deb | unpacked 目錄 |
|---|---|---|---|
| 安裝 | `chmod +x` | `sudo apt install` | 無 |
| 換版 | **覆蓋一個檔案** | 重新安裝 | 覆蓋一個目錄 |
| 桌面項目與圖示 | 可選（AppImageLauncher 或手寫 .desktop） | 自動 | 無 |
| 與 repo 脫鉤 | 完全 | 完全 | 完全 |

dogfood 的頻率決定了這個選擇：**換版會很頻繁**，而 AppImage 的換版成本是覆蓋一個檔案、不需要
sudo。deb 的桌面整合優勢在這個階段換不到等值的東西。

**AppImage 有一個承重的前提：`libfuse2`。** 本機已實測滿足。但 **Ubuntu 22.04 起預設不再安裝
`libfuse2`** —— 在那些機器上 AppImage 會以一則看似無關的錯誤失敗（`dlopen(): error loading
libfuse.so.2`），而那讀起來像「這個 app 壞了」而不是「你缺一個系統套件」。逃生口是
`--appimage-extract-and-run`（不經 fuse，解壓到暫存目錄再執行），**必須寫進 README** —— 一個
只有作者知道的逃生口等於沒有逃生口。

### D2. 打包設定續留在 `package.json` 的 `build`，不外移為 `electron-builder.yml`

`app-identity` 有一條 scenario 直接綁在檔案上：

> **WHEN** 讀取版控中的 `package.json` **THEN** `productName` 為 `Spekterm`，且 `build.appId`
> 為 `com.spekterm.app`

外移設定會讓那條驗收**失去對象**（它會繼續通過 —— `build.appId` 仍在 package.json，只是
electron-builder 不再讀它，於是驗收與實際生效的設定脫鉤）。**這正是假綠的形狀**：斷言還在、還是
綠的，但它斷言的東西已經不是被出貨的那個。

代價是 `build` 區塊會長到約 30 行。可接受。

> **此決定有前提。** 日後若設定複雜到必須外移，**必須同時**改 `app-identity` 的該條 scenario 與
> `probe:identity`，否則就製造出上面那個假綠。

### D3. node-pty 要在 asar 之外，但 **`asarUnpack` 不是達成它的必要設定**（實測推翻了初版論證）

asar 是唯讀的虛擬檔案系統。`.node` 的載入走 `dlopen`，需要一個**真實的檔案系統路徑** ——
asar 內的路徑不是。Electron 對此的機制是：被 `asarUnpack` 涵蓋的檔案會另外複製一份到
`app.asar.unpacked/`，而 `require` 到 asar 內該路徑時自動轉向 unpacked 的那一份。

glob 用 `**/node_modules/node-pty/**`（涵蓋整個套件，不只 `prebuilds/` —— `lib/index.js` 對
`.node` 的相對路徑解析必須落在同一棵樹裡）。

> **本 change 的初版寫著「這是打包後唯一會讓 app 啟動即壞的必要設定」。那是錯的，而發現它的
> 正是對照組。**
>
> 移除 `asarUnpack` 重新打包後，`probe:package` 的 pty 斷言**依然全綠**。追查產物才知道原因：
> **electron-builder 偵測到套件內含 `.node` 就會把整個套件自動解出 asar** —— 兩種設定下
> `app.asar.unpacked/node_modules/node-pty` 的檔案數皆為 **29，完全相同**。
>
> 於是這條設定的地位變了：它是**對意圖的明示**，不是承重的機制。**保留它**的理由只有一個
> —— 不把「native 模組會落在 asar 外」這件事**繫在第三方工具的隱含行為上**；那個行為沒有
> 出現在我們的設定裡，也就不會在它改變時發出任何聲音。
>
> **連帶的兩個修正**（同樣重要，因為它們是本 change 差點留下的假綠）：
>
> 1. **3.1 那條守衛守的不是「少了它 app 會壞」**，而是「這個明示不被靜默拿掉」。它的對照組
>    （3.3a）變紅只證明守衛在讀 `package.json`，**不證明那行設定有任何作用**。
> 2. **`probe:package` 的 pty 斷言需要另一個對照組。** 既然移除設定不會讓它變紅，就得用別的
>    方式證明它不是永遠綠 —— 改以「讓 pty 根本建立不起來」驗證（把探針比對用的 shell 換成一個
>    不存在的路徑）。**實測兩條 pty 斷言同時變紅**，斷言的敏感度因此成立。
>
> **一般形式**：我在這份 design 裡寫下「不要用檔案存在性代替行為驗證」，然後在同一個 change
> 裡犯了它的變體 —— **用「設定存在」代替了「產物結構正確」**。寫下一條教訓不會讓人自動避開它；
> 擋住它的是對照組。

**驗收必須是「真的 spawn 一個 pty 並收到它的輸出」，不是「檢查 `app.asar.unpacked` 之下有
`pty.node`」。** 後者是檔案存在性 —— 它會在 `dlopen` 因為任何其他理由失敗時**依然通過**
（glibc 版本、缺少 unpacked 的兄弟檔、Electron 的轉向沒有生效）。這是 CLAUDE.md 那條「一個方便
取得、看起來相關的量，不等於規格真正在乎的那個量」的第四個實例，而前三個都咬過。

**替代方案 `asar: false`**（整個不打包成 asar）：可行，會讓所有 native 問題消失。不採用 ——
產物會變成幾千個散檔（AppImage 內部仍是單檔，但啟動時的檔案系統開銷與冷啟動時間都會變差），
且失去 asar 對「一份不可變的產物」這個性質的擔保。

### D4. 兩層驗收，而它們擋的是**不同**的東西 —— 不要把靜態層當成打包成功的證明

| 層 | 是什麼 | 擋什麼 | **不**擋什麼 |
|---|---|---|---|
| 設定守衛（併入 `npm test`，秒級） | 讀 `package.json`，斷言 `build` 的關鍵欄位 | 日後某次整理把 `asarUnpack` 或 target 拿掉 | **完全不證明打包會成功**，更不證明產物能執行 |
| 產物探針（`probe:package`） | 打包 → 啟動**真正的 AppImage** → CDP 連進去 | 上表五條路徑是否成立 | 畫素（虛擬螢幕、軟體 GL，同既有探針的限制） |

設定守衛的價值不在「證明對」，在「**它變了會有人知道**」。誠實寫明這一點，避免下一個人看到綠燈
就以為打包沒問題。

**設定守衛的對照組**：把 `asarUnpack` 從 package.json 拿掉 ⇒ 該條測試必須變紅。這條很廉價，做。

**產物探針的對照組**：把 `asarUnpack` 拿掉、重新打包 ⇒ **pty 斷言必須變紅**。這條很貴（要多打一次
包），但**它是唯一能證明這支探針不是假綠的東西** —— 一支永遠會通過的探針比沒有探針更糟，因為它
會讓人以為這件事被守著了。**實作時必須真的跑一次**，並把結果記在 tasks 裡。

### D5. 產物探針驗三件事，而第三件是唯一不能省的

1. **renderer 從 asar 內的 `file://` 載入成功** —— 以 `document.title === 'spekterm'` 判定。
   它同時證明 `loadFile` 的相對路徑在 asar 內解析正確。
2. **production CSP 生效** —— 打包版與既有探針的 build 模式落在**同一個分支**（切換依
   `ELECTRON_RENDERER_URL`），所以政策內容本身已有覆蓋；這裡新增的資訊是
   **`onHeadersReceived` 對 asar 內的 `file://` response 仍然觸發**。那不是可以從既有覆蓋推論出來
   的 —— URL 的形狀變了。
3. **pty spawn 成功並回傳輸出** —— D3 的唯一真憑證。

**不驗 userData 路徑**：探針會傳 `--user-data-dir` 隔離，那條由 `probe:identity` 負責（它刻意
不傳）。

**收屍要處理 AppImage 的 fuse 掛載點。** AppImage 執行時把自己掛載到 `/tmp/.mount_XXXXXX`；
`pkill -9` 可能留下一個殘掛載點。探針結束時要確認掛載點被卸載，或至少不讓殘留累積到下一輪
（既有探針的 `pkill -f <profile>` 手法仍然適用 —— AppImage 會把 argv 原樣傳給內部的 electron，
`--user-data-dir` 那個獨一無二的值仍出現在每個子行程的 argv 裡）。

### D6. `app.isPackaged` 為 true 的那條分支，藏著一顆未來的地雷

打包後 `!app.isPackaged` 為 false ⇒ `logScanSummary()` **不執行**。這是既有意圖（那是開發模式的
除錯輸出），沒有問題。

但 `resolveScanTarget()` 的預設值是 **`app.getAppPath()`** —— 打包後那是 **asar 內的路徑**。
今天它安全，**只因為它不會被呼叫**。

> **地雷**：日後若有人把掃描摘要改成無條件輸出（或把 `resolveScanTarget()` 挪作他用），打包版會
> 去掃 asar 內部的 `openspec/`，回傳一堆零，而**那看起來像「使用者的 repo 沒有 openspec」**。
> 在 `index.ts` 該處留一行註解指出這個相依。

### D7. GUI 啟動的 PATH：已有承擔者，但**兩種啟動方式必須分開驗**

`terminal.ts` 已一律以 login shell spawn（`resolveShell()` + `-l`），註解寫著「桌面啟動的 GUI app
常缺使用者 shell 的 PATH」。本機的 `claude` 在 `~/.local/bin`、node 在 nvm 之下 —— 兩者都**只**存在
於 profile 載入後的 PATH。

**這裡有一個極易假綠的地方**：從 terminal 執行 `./Spekterm.AppImage` 時，它繼承 terminal 的完整
PATH，**於是 login shell 有沒有生效根本看不出來**。要驗的是**從桌面／檔案管理員啟動**的那一次。

- 探針**驗不到這件事**（探針必然從 shell 啟動，且跑在 xvfb 裡）。它屬於 **dogfood 驗收**，且必須
  明確寫成一條步驟，不能寫成「開起來能用」。
- 另一個未實測項：`resolveShell()` 讀 `process.env.SHELL || '/bin/bash'`。從 GUI 啟動時 `SHELL`
  通常仍由 session manager 設定，但**不保證**。若不在，會退回 `/bin/bash -l`（讀 `~/.bash_profile`
  而非本機實際使用的 zsh profile）—— 症狀是 `claude` 找不到。dogfood 時一併確認。

### D8. 開發模式的 userData 由 `dev` script 結構性隔離 —— 不靠紀律，也不改產品程式碼

打包版與 `npm run dev` 預設會共用 `~/.config/Spekterm`（`app.getName()` 讀 `productName`，兩邊
相同）。**probe 不受影響** —— 每一支都傳 `--user-data-dir` 指向暫存 profile。受影響的只有
`npm run dev`。

**為什麼非隔離不可**（兩邊同時開著時的失效路徑）：

- 兩邊的 renderer 各自落盤 `sessions.json`，**後寫的贏** —— 一邊剛建立的 session 可能被另一邊的
  快照抹掉，而**它的 pty 還活著**。
- dev 啟動時會 restore **使用者正在用的**那份 session 清單，並依「休眠的 session 於首次被顯示時
  才 spawn」重建 —— 於是可能對同一個 conversation 開出第二個 `claude --resume`。
- `panel.json`、`preferences.json`、`workspace.json` 同理，粒度較粗但衝突後果較輕。

**全部是靜默的** —— 使用者看到的是「分頁不見了」，不是一則錯誤。

**作法：把環境變數烤進 script 本身。**

```json
"dev": "XDG_CONFIG_HOME=$HOME/.config/spekterm-dev electron-vite dev"
```

本機實測（2026-08-07）Linux 上 Electron 的 userData 落在 `$XDG_CONFIG_HOME/<productName>`，
且該環境變數**確實被遵守**：

```
$ electron <probe>                                         → /home/me/.config/Electron
$ XDG_CONFIG_HOME=/tmp/spekterm-dev-home electron <probe>  → /tmp/spekterm-dev-home/Electron
```

於是開發模式的 userData 為 `~/.config/spekterm-dev/Spekterm`，打包版仍是 `~/.config/Spekterm`
（**使用者現有的設定原封不動被打包版接手**，不需要重新加 folder、重排 rail）。

**三個「為什麼是這樣而不是那樣」：**

1. **為什麼烤進 script，而不是寫進 CLAUDE.md 當紀律。** 需要 `npm run dev` 的場合（追一個探針抓
   不到的 bug、迭代純 renderer 的版面）**正是最不會記得加環境變數的場合** —— 注意力在別的地方。
   這就是 CLAUDE.md 那條反覆重演的教訓：「**不接受某個東西要由結構保證，不是由『沒有人再送它』
   保證**」。紀律在這裡的失效方式與它要防的東西完全相同：靜默。

2. **為什麼是 `XDG_CONFIG_HOME`，不是在主行程呼叫 `app.setPath`。** 後者要加一個判斷，而那個判斷
   必須**同時**滿足兩個條件才正確：依 `ELECTRON_RENDERER_URL` 而非 `app.isPackaged`（否則
   「未打包但載入 build 產物」會誤判 —— 與 CSP 同一個坑），且**命令列已帶 `--user-data-dir` 時
   不得覆蓋**（否則會壓掉每一支探針的隔離）。**兩個條件都是靜默失效的形狀。** 一個環境變數換掉了
   整個判斷 —— 而環境變數不會誤判任何東西，它只是改變一個路徑的解析起點。

3. **為什麼不用 `--user-data-dir`。** 那要經由 `electron-vite dev` 把參數轉交給 electron，
   而那條傳遞鏈本機未實測（CLAUDE.md 記載 `ELECTRON_CLI_ARGS` 實測未生效，同一族的問題）。
   環境變數沒有傳遞鏈可言。

**已知代價與限制：**

- **開發模式的 workspace 會是空的**（第一次跑 dev 要重加 folder）。對驗收無影響 —— 探針本來就
  各自用暫存 profile 與 fixture。
- **`XDG_CONFIG_HOME` 是 freedesktop 的慣例，只在 Linux 生效。** macOS 的 userData 走
  `~/Library/Application Support`，Windows 走 `%APPDATA%`，兩者都不看它。
- **`VAR=x cmd` 的 script 語法在 Windows 的原生 shell 不通**（需要 `cross-env`）。
- 上兩條在現階段（Linux only 開發、Linux only 打包）成立。**跨平台開發啟動時，這條 script 需要
  換成 `cross-env` + 各平台各自的機制** —— 屆時若沒換，症狀是 macOS/Windows 上隔離**靜默失效**、
  回到共用 userData。記在這裡，因為那時不會有任何東西提醒。
- `SPEKTERM_SCAN_PATH=../spek npm run dev` 仍照常運作（兩個環境變數不衝突）。

### D9. 圖示自製，不沿用 `spek` 的 logomark

`../spek/logo/` 有現成的 logomark。**不採用** —— spek 是獨立的開源 repo，MIT 涵蓋的是程式碼，
品牌資產（logo／商標）通常不在其內；而 spekterm 是**獨立的私有 repo**，不是那個 monorepo 的成員。
借用一份不確定授權範圍的品牌資產，代價會在發佈時才浮現。

這次產出一個 512×512 的 placeholder：深色底（`#0a0c0f`）+ amber 前景（`#f59e0b`），呼應 PRD 的
主題色。工具用本機已有的 ImageMagick 或 PIL。**它是 placeholder，不是定案的品牌識別** —— 列入
Open Questions。

### D10. electron-builder 版本與網路前提

- 版本 **`^26.15.7`**。注意 npm 的 `latest` 標籤是 26.15.3，而 **`v26` 標籤是 26.15.7（較新）**
  —— 直接 `npm i -D electron-builder` 會拿到較舊的那個。
- **首次打包需要網路**：Electron 43.1.0 的官方 binary 會被下載到 `~/.cache/electron`
  （約 100 MB；`node_modules/electron/dist` 那份 electron-builder 不會拿來用）。AppImage runtime
  已在 `~/.cache/electron-builder/appimage` 快取。
- 離線打包會失敗 —— 那是前提不是 bug，寫進 README。

## Risks / Trade-offs

- **[ESM entry point + electron-builder]** `package.json` 是 `type: "module"`，main 產物是
  `out/main/index.js`（ESM），preload 是 `.mjs`。Electron 43 原生支援 ESM entry，electron-builder
  26 亦支援，但兩者合起來在 asar 內的行為**本機未曾實測**。
  → **緩解**：這是 D5 第 1 條斷言（視窗載入成功）覆蓋的第一件事 —— 若 ESM 解析失敗，app 根本開
  不起來，探針會立刻紅。逃生口：讓 electron-vite 把 main 輸出成 CJS（`build.rollupOptions.output
  .format`），代價侷限於建置設定。

- **[產物體積]** `@xterm/*`、`@spekjs/ui`、`react-markdown` 等都在 `dependencies`，會被
  electron-builder 複製進 asar，**儘管它們已經被 vite bundle 進 renderer** —— 等於打包了兩份。
  → **緩解**：先量、不預先優化。若體積明顯不合理，用 `files` 排除已 bundle 的套件；但那是一個
  **會靜默壞掉**的優化（排錯一個就是打包後才發現的 `MODULE_NOT_FOUND`，而 `i18next` 放錯區塊
  已經是同一族的教訓），因此不在本 change 做。

- **[fuse 缺席的機器]** 見 D1。→ **緩解**：README 寫明 `--appimage-extract-and-run`。

- **[產物探針的成本]** 它必須先完成一次完整打包（下載 + 壓縮，數分鐘），再啟動 AppImage。
  → **緩解**：**不併進 `npm run test:e2e` 的預設序列**，維持既有分界（`test:e2e` 已經十幾分鐘，
  再加一次打包會把它推到沒有人願意跑的長度）。以獨立入口 `npm run probe:package` 提供，並在
  README／CLAUDE.md 註明它屬於「換版前跑一次」的層級。

- **[殘留的 fuse 掛載點]** 見 D5。→ **緩解**：探針收屍後檢查 `/tmp/.mount_*` 並清理；累積的話
  下一輪打包或執行會遇到看似無關的錯誤。

- **[「零產品程式碼改動」可能不成立]** 上表五條路徑若有任一條不成立，就會有改動。
  → **緩解**：這不是風險而是**本 change 的目的** —— 但它會影響工時估計，且屆時必須回頭補 spec，
  不能默默改掉。

## Migration Plan

無資料遷移。`release/` 已在 `.gitignore` 內，產物不進版控。

**回滾**：本 change 只新增設定、資產與腳本，產品程式碼預期零改動 —— 回滾即 `git revert`，
執行中的 dev 模式不受任何影響。已安裝的 AppImage 是獨立檔案，刪除即可。

## Open Questions

1. **圖示的定案視覺**（D9）。這次是 placeholder。要沿用 spek 的視覺語言（需先釐清授權），還是
   另做一套？
2. **使用者怎麼知道自己跑的是哪一版？** AppImage 檔名帶版本，但 dogfood 期間版本號多半不會動，
   覆蓋之後就只剩檔案 mtime 可查。三個選項：(a) 什麼都不做，靠 mtime；(b) 每次打包 bump
   patch 版本；(c) 狀態列顯示版本 —— **但 (c) 會動到產品程式碼與 `status-bar` spec，違反本
   change 的「零改動」前提**，若要做應另開 change。
3. **要不要順手產出 `.desktop` 項目**（讓 AppImage 出現在應用程式選單）？AppImage 本身不會自動
   註冊。可手寫一份放 `~/.local/share/applications/`，但那是**本機環境設定**、不是版控內的產物
   —— 傾向寫進 README 當作可選步驟，不納入打包流程。
