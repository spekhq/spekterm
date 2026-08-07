## Why

spekterm 至今只能以 `npm run dev` 啟動 —— 它是**開發者的執行方式**，不是**使用者的執行方式**。
兩者共用同一個 repo 工作副本，於是「使用它工作」與「開發它」在同一份程式碼上互相碰撞：改一行
renderer 就熱更新掉正在用的畫面，跑一次 `npm run build` 就動到正在執行的產物，重啟 dev 就中斷
正在進行的 session。

**dogfooding 需要一份與 repo 脫鉤的可執行檔** —— 裝好之後就不再隨 repo 的任何一次編輯而變動，
直到下一次明確地重新打包。這是 Phase 6 的第一步，也是唯一現在就有價值的那一步。

## What Changes

- 導入 **electron-builder**，產出 **Linux x64 AppImage** 單一可執行檔（落點 `release/`，已在
  `.gitignore` 內）。
- 打包設定**續留在 `package.json` 的 `build` 之下**（不外移為獨立的 `electron-builder.yml`）——
  `app-identity` 的既有 scenario 要求「讀取版控中的 `package.json` → `build.appId` 為
  `com.spekterm.app`」，外移會讓那條驗收失去對象。
- **native 模組落在 asar 之外**：`node-pty` 的 `.node` 在 asar 內無法 `dlopen`。以
  `asarUnpack` **明示**這件事 —— 實測發現 electron-builder 預設就會自動解出含 `.node` 的套件
  （見 design D3），因此該設定是冗餘的保險，不是承重的機制；**真正的驗收在產物的行為上**。
- 新增應用程式圖示（AppImage 與桌面項目所需）。
- 新增打包指令（`npm run dist:linux`）。
- 新增**打包產物的驗收**：設定層由 `npm test` 的靜態守衛擋住回歸，產物層由一支探針啟動**真正的
  AppImage** 驗證它能開起來、拿到 production CSP、且 pty 可用。
- **`npm run dev` 改用獨立的 userData**，以一個環境變數烤進 script 本身（**不改產品程式碼**）
  —— 打包版沿用 `~/.config/Spekterm`（使用者現有的設定原封接手），開發模式另走一處。
  沒有這一條，這個 change 的目的只達成一半：產物與 repo 脫鉤了，但兩份執行仍在同一份設定上打架。
- README 補上打包與安裝的操作說明。

**非目標**（明確不做，避免 Phase 6 整包被拖進來）：

- macOS 與 Windows 產物。兩者各自帶著未解的前置問題 —— macOS 的應用程式 menu 是系統層的、
  `Menu.setApplicationMenu(null)` 未實測；Windows 的檔案邊界在 `O_NOFOLLOW` 缺席下退為 `lstat`
  二次確認且**從未實測**。它們是 Phase 6 的正式範圍，不是這次 dogfood 的前置條件。
- 自動更新、CHANGELOG 流程、程式碼簽章。
- 深色主題與原生選單（PRD Phase 6 的其他項目）。
- **在產品程式碼裡做 userData 隔離**。上述隔離只動 npm script 的環境變數 —— 主行程一行不改
  （理由見 design D8：那個判斷有兩個靜默失效的形狀）。

## Capabilities

### New Capabilities

- `desktop-packaging`: 從版控中的原始碼產出可獨立執行的桌面應用程式產物。涵蓋產物形態與落點、
  native 模組在 asar 下的可載入性、打包後執行時的信任模型（production CSP）與 pty 可用性，
  以及「打包設定不得靜默退化」的守衛。

### Modified Capabilities

（無。`app-identity` 的既有要求正是這次的**輸入**：`productName`、`appId`、userData 路徑
皆已凍結且宣告齊備，本 change 消費它們而不改動它們。`native-module-toolchain` 規範的是
**開發環境**下 node-pty 的載入，本 change 新增的是**打包產物**下的可載入性 —— 驗收對象不同，
故收在新 capability 而非改寫舊的。）

## Impact

- **`package.json`**：新增 `electron-builder` devDependency、擴充 `build` 區塊、新增
  `dist:linux` script。
- **新增資產**：應用程式圖示（版控內）。
- **新增腳本**：打包產物的探針 + 打包設定的靜態守衛（併入既有的 `npm test`）。
- **`README.md`**：打包與安裝章節。
- **`docs/PRD.md`**：Phase 6 的進度註記。
- **產品程式碼：預期零改動。** 打包後才首次真正執行的路徑（production CSP、`app.isPackaged`
  為 true 的分支、GUI 啟動時的 login shell PATH 解析）都已就位 —— 本 change 的工作是**驗證它們
  成立**，若不成立才修。
