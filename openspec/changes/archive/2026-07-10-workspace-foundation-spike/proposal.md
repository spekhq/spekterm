## Why

`spek-workspace` 目前只有文件與 OpenSpec 骨架，沒有任何可執行的程式碼。PRD §8「系統架構」建立在三個尚未被驗證的假設上：主行程能直接 `import` `@spek/core`、`node-pty` 能在 Electron 的 ABI 下 spawn 真 pty、renderer 能載入編輯器。這三個假設只要有一個不成立，架構就得重畫。

**為什麼是現在**：PRD §13 把 `node-pty` native ABI 與編輯器的 Vite worker 設定列為最高技術風險，但它們分別要到 Phase 4 與 Phase 2 才會被碰到。若拖到那時才爆，前面幾個 Phase 寫的工作台程式碼會整批返工。§2.3 的戰略結論也明說差異化的窗口不會永遠開著、「而且要快」。Phase 0 的唯一職責就是把這些風險提前引爆，在還沒有東西可以返工的時候。

此外，在盤點 Phase 0 的驗收條件時發現一個 PRD 從未寫出來的阻塞，而且它有兩層：**`@spek/core` 現在拿不到**。第一層，它在 `spek` monorepo 裡標記 `"private": true`、沒有 `files` 欄位、從未發佈到 npm，只能被 `spek` 自己的 npm workspaces 解析；`spek-workspace` 是獨立的私有 repo，不是它的 workspace 成員，無法用任何合法管道安裝它。第二層更根本：**`@spek` 這個 npm scope 已被他人註冊**，本專案的帳號無權發佈至該 scope，即使解除 `private` 也發不出去（證據見 `design.md` D1）。PRD §8.1／§9.1／§11 全部預設「主行程可直接 import `@spek/core`」，卻沒有一個字交代跨 repo 要怎麼拿到。這個阻塞擋住的正是 Phase 0 自己的驗收條件，必須在本 change 解決。

## What Changes

- **建立 `@spek/workspace` 的 package 骨架**：electron-vite + React 19 + Tailwind CSS v4 + TypeScript，能開啟視窗、renderer 正常載入，且從第一天就套用 PRD §12 的信任模型（`contextIsolation: true`、停用 `nodeIntegration`、能力只走 preload 白名單）。
- **解決 core 套件的跨 repo 分發**：因 `@spek` scope 被佔，core 更名為 **`@spekjs/core`** 並發佈至 npm public，讓 `spek-workspace` 能以合法的套件依賴取得它（決策與替代方案見 `design.md` D1）。PRD §9.2 規劃於 Phase 5 抽出的 UI 套件對應更名為 `@spekjs/ui`。
- **主行程 `import @spekjs/core` 並掃描 repo**：能印出某個 repo 的 `scanOpenSpec()` 結果，證明純 Node 的 core 在 Electron 主行程可用、無需 HTTP 中介（驗證 PRD §8.1 的核心論證）。
- **確立 `node-pty` 的取得與載入策略**：釘死 `node-pty@1.2.0-beta.14`（VS Code 同系列），驗證它能在 Electron 主行程載入並 spawn shell。`design.md` D2 的實測證明它是 Node-API 模組、prebuilt `.node` 可直接被 Electron 載入，因此**不需要 `@electron/rebuild`**；且唯有 1.2.0-beta 系列提供 Linux prebuilt，選它即免除本地編譯。
- **驗證 Monaco 可在 renderer 載入**：沿用 PRD §5 F3 / §8.3 的 Monaco 選型。但 §13 標記的兩項風險（Vite worker 設定、打包體積）必須在本 change 實測而非假設 —— 驗收條件為 worker 在 electron-vite 的 dev 與 build 兩種模式皆正常，且能量出 Monaco 對 renderer bundle 的實際貢獻。若證明不可行，依 PRD §8.3 原文退守 CodeMirror 6（取捨見 `design.md` D3）。

**明確不做**（防止 spike 蔓延成 Phase 1）：不實作任何工作台功能 — 沒有多 folder 工作區、沒有檔案樹、沒有 terminal UI、沒有 OpenSpec 側欄、沒有 handoff。本 change 只證明相依可行並立起骨架；所有能力的實作留給 Phase 1 之後。

無 **BREAKING** 變更：本 repo 尚無任何使用者或既有介面。

## Capabilities

### New Capabilities

- `workspace-app-shell`: Electron app 的最小外殼 — 主行程開啟視窗、renderer 載入 React 應用、主行程與 renderer 依 PRD §12 信任模型隔離（`contextIsolation`、preload 白名單），以及 Monaco 編輯器能在 renderer 載入並高亮（worker 於 dev 與 build 模式皆正常）。Phase 1 之後的所有 UI 都長在這個外殼上。
- `spek-core-integration`: `spek-workspace` 以合法套件依賴取得已發佈的 `@spekjs/core`，主行程可直接 `import` 並呼叫其掃描 API 取得 OpenSpec 結構，無需 HTTP 或 IPC 中介。這是 PRD §9「重用而非重造」的地基。
- `native-module-toolchain`: native 模組能在 Electron runtime 直接載入並運作，無需針對 Electron ABI 重建。以 `node-pty` 為首個案例 —— 它是 Node-API 模組，prebuilt `.node` 可同時被 Node 與 Electron 載入（故不需 `electron-rebuild`）。此能力同時要求所選版本的 prebuilt 涵蓋全部目標平台，並在 Electron 或 native 模組升版時可重新驗證。

### Modified Capabilities

無。`openspec/specs/` 目前是空的 — 這是本 repo 的第一個 change，沒有既有 requirement 被改動。

## Impact

**新增依賴**：`electron`（鎖定 43.1.0）、`electron-vite`、`react` 19、`tailwindcss` v4、`typescript`、`node-pty`（釘死 1.2.0-beta.14）、`monaco-editor`、`@spekjs/core`。`electron-builder` 連同其設定一併留給 Phase 6，本 change 不引入。**不含 `@electron/rebuild`** —— design 階段實測證明 Node-API 模組不需要它。Electron 鎖版的理由是建置可重現，而非 ABI 對齊。

**跨 repo 影響（重要）**：`design.md` D1 已拍板註冊 npm org `spekjs`、將 core 更名為 `@spekjs/core` 並發佈到 npm public。因此本 change 依賴一次人工的 org 註冊，以及一次對 **`spek` repo** 的改動（更名、解除 `private`、加上 `files` 與 `publishConfig`、批次更新引用）與 npm publish。這超出本 change 的 `allowedEditRoots`（僅 `spek-workspace`）—— OpenSpec change 是 repo-local 的。依 `design.md` D5，該工作由 `spek` repo 自己的獨立 change 承載，本 change 的 `tasks.md` 只驗證其**結果**（`npm view @spekjs/core version` 能取得版本），不列出他 repo 的編輯步驟。

更名在 `spek` repo 波及 412 處引用，其中 `openspec/changes/`（68 個檔案，含 archive）是歷史記錄，**不得改動**；`openspec/specs/`（11 個檔案）描述現況，應改。`@spek/web`（47 處）是 `private` workspace 名、從不發佈，不需更名。

**回寫文件**：本 change 的實測推翻了 PRD 對 native 模組的假設，並改變了 core 的套件名，需回頭修訂 —— §8.1／§9.1／§9.2／§11 的 `@spek/core` 與 `@spek/ui` 更名為 `@spekjs/core` 與 `@spekjs/ui`；§8.3 移除「`node-pty` 需 `electron-rebuild` 對齊 Electron ABI」並補上「須採用有全平台 prebuilt 的 1.2.0-beta 系列」；§13 將「node-pty native ABI 對不上 Electron」改寫為「須選用涵蓋目標平台 prebuilt 的版本；N-API 使其免 `electron-rebuild`」。編輯器選型（Monaco）維持不變，但其 worker 與體積風險由假設轉為本 change 的實測項。core 分發方式定案後，需清掉 `CLAUDE.md` 中記錄的兩個待決事項。

**不影響**：`docs/PRD.md` 與 `docs/workspace-mockup.html` 作為權威來源的地位不變（除上述回寫）；`spek` repo 的 web / VS Code / IntelliJ 三個既有產物不受影響 — 分發方式的改動只涉及 `@spek/core` 的發佈設定，不動其程式碼。
