# OpenSpec 側欄（Phase 5）

## Why

side panel 的 OpenSpec 身分至今是一塊寫著「OpenSpec 側欄（Phase 5）」的 placeholder。主行程雖然已經
`import` 了 `@spekjs/core`，但掃描結果在 `src/main/openspec.ts` 裡被解構丟棄，只留下四個計數欄位印成一行
stdout —— 掃描的目標甚至與使用者加入的 workspace folder 無關（由 `SPEK_SCAN_PATH` 或 app 自己的路徑決定）。

這使得 spek workspace 目前只是「一個能開很多 terminal 的殼」。PRD §2 的產品定位是「懂 OpenSpec 結構的
agent 工作台」—— **側欄正是「懂」的那一半**。使用者一邊駕駛 agent 改 code，一邊要能看見那個 change 的
tasks 進度與 spec deltas，不必切到 IDE 或瀏覽器。少了側欄，這個 app 相對於「開四個終端機分頁」沒有增量價值。

Phase 4 已經讓主舞台能駕駛 agent，terminal session 的資料模型也已成熟（含 pty 宣告的標題、使用者命名、
排序）。此時接上側欄，才能讓「agent 在跑的那個 change」與「側欄正在顯示的那個 change」對上 —— 這是
Phase 7 handoff（session ↔ change 的錨定關係）的地基。

## What Changes

### 主行程：從「印一行摘要」變成 per-folder 的 OpenSpec 資料供應層

- `src/main/openspec.ts` 由「掃描並丟棄」擴充為以 **folder 為單位**的資料供應層：保留完整的 `ScanResult`，
  並代理 core 的 `readChange` / `readSpec` / `readSpecAtChange` / `findRelatedChanges` / `buildGraphData`。
- 新增 `src/main/ipc/openspec.ts`，暴露 `openspec.*` channel。契約形狀**刻意對齊 spek 前端既有的
  `ApiAdapter`**（`getOverview` / `getSpecs` / `getSpec` / `getChanges` / `getChange` / `getSpecAtChange` /
  `getGraphData`），差別只在每個 method 的第一個參數是 `folderId`。
- 掃描結果做 per-folder 快取，並在該 folder 的 `openspec/` 目錄有檔案變更時失效並推送給 renderer ——
  這個 app 的前提就是旁邊有 agent 一直在寫檔，側欄不能是啟動時的快照。
- 既有的開發模式 stdout 掃描摘要（`[openspec] scan …`）**維持不變** —— 它是 `spek-core-integration` 規格
  要求的產品行為，`probe:core` 依賴它。

### renderer：側欄從 placeholder 變成四個 nav tab

依 `docs/workspace-mockup.html`（UI 權威）實作：

- **本 change**：change slug + 狀態 badge + 描述；tasks 進度條與**依 section 分組**的 checklist；
  spec deltas 的 requirement 區塊（`ADDED` / `MODIFIED` badge + BDD 關鍵字上色：`WHEN` / `THEN` / `AND` / `MUST`）。
- **Specs**：spec topic 清單（含各 topic 的相關 change 數）。
- **Changes**：active / archived change 清單（含 tasks 進度），focused session 所錨定的 change 那列高亮。
- **Graph**：spec ↔ change 的關係圖。**側欄的 graph 是為 320–620px 窄欄新設計的**，不是搬 spek 的
  全寬 d3 force graph。
- 側欄以 `IpcAdapter` 取資料 —— 一個對齊 spek `ApiAdapter` 介面的 renderer 端 class，內部走 `openspec.*` IPC。
- **交叉導覽**：從 spec / change 可跳到其底層 `.md` 檔（切到 Files 身分並開啟該檔）；反向亦然。
- side panel 的**預設身分翻回 OpenSpec**（mockup 的預設）。Phase 2 暫設為 Files，理由是「OpenSpec 還沒有
  內容」—— 該理由於本 change 消失。

### terminal session：新增「錨定 change」

- session 資料模型新增錨定的 change slug，使側欄的「本 change」tab 能跟隨 focused session。
- 錨定關係的推導與使用者覆寫規則見 `design.md`。

### 明確**不**做的事

- **不抽出 `@spekjs/ui`**。PRD §9.2 假設「既有 spek 頁面（Dashboard / SpecDetail / ChangeDetail /
  GraphView）幾乎可原封不動在 Electron renderer 跑起來」—— 經探查，這個假設不成立：mockup 定義的側欄是
  為窄欄設計的緊湊 UI，而 spek 的頁面是為全寬瀏覽器頁面設計的（自帶 Layout + Sidebar，GraphView 是 336 行的
  d3 force graph）。可重用的其實是**介面契約與型別**，而那些從 `@spekjs/core` 直接就拿得到。
  IPC 契約仍照 `ApiAdapter` 的形狀設計，日後真要接軌時是同一個介面。詳見 `design.md` D1。
  本 change 需**回寫 PRD §9.2 與 §11 Phase 5**。

## Capabilities

### New Capabilities

- `openspec-data-access`: 主行程以 `@spekjs/core` 為每個 workspace folder 供應 OpenSpec 結構，經
  `openspec.*` IPC 送達 renderer；含 folderId 定址邊界、結果物件式錯誤、per-folder 快取與變更推送、
  per-webContents 生命週期。
- `openspec-panel`: side panel 的 OpenSpec 身分內容 —— 四個 nav tab（本 change / Specs / Changes / Graph）、
  tasks 進度、spec deltas 與 BDD 高亮、與 Files 身分之間的交叉導覽、跟隨 focused session 的錨定 change。

### Modified Capabilities

- `workspace-layout`: side panel 的**預設身分**改為 OpenSpec（該 folder 可用時），Files 為退路。
  原規格未規定預設身分，實作暫以 Files 為預設。
- `terminal-sessions`: session 新增「錨定 change」—— session 可對應到一個 change slug，供側欄跟隨。

## Impact

**主行程**
- `src/main/openspec.ts` — 擴充為 per-folder 資料供應層（快取、失效）
- `src/main/ipc/openspec.ts` — 新檔，`openspec.*` channel 與 handler 註冊
- `src/main/index.ts` — 註冊新 handler；`logScanSummary` 維持不變
- 既有的 chokidar 監控層（`src/main/ipc/fs.ts` 的 watch）— 評估重用以監控 `openspec/`

**preload**
- `src/preload/index.ts` — 白名單新增 `openspec.*`

**renderer**
- `src/renderer/src/shell/side-panel/SidePanel.tsx` — placeholder 移除
- `src/renderer/src/shell/openspec/` — 新目錄：`IpcAdapter`、四個 tab、BDD 高亮、tasks 進度、graph
- `src/renderer/src/shell/MainStage.tsx` — 預設身分翻回 OpenSpec；承接交叉導覽的跨身分導航
- `src/renderer/src/shell/terminal/sessions.tsx` — session 新增錨定 change
- `src/renderer/src/index.css` — `@theme` 補上 mockup 用到但目前缺的 token（blue / green / red / accent-soft）
- `src/renderer/src/shell/types.ts` — 由 `window.workspace` 回推的 OpenSpec DTO

**驗收**
- `scripts/probe-openspec.mjs` — 新探針（dev + build 兩模式，獨佔 debug port 9228）
- `package.json` — 新增 `probe:openspec`
- 單元測試（`node:test`）— 資料供應層的快取與失效、folderId 邊界、BDD 解析

**文件**
- `docs/PRD.md` §9.2、§11 Phase 5 — 回寫「原封不動重用 spek 頁面」的錯誤假設
- `CLAUDE.md` — 更新現況（Phase 4 已封存）、新增 Phase 5 的實測與踩雷

**依賴**
- 不新增 npm 依賴。graph 若需要力導向佈局，優先以既有依賴或自寫的輕量佈局完成（見 `design.md`）。
