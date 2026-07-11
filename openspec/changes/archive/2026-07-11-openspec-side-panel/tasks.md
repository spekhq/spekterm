## 1. 主行程：OpenSpec 資料供應層

- [x] 1.1 擴充 `src/main/openspec.ts`：由「掃描後丟棄」改為保留完整 `ScanResult`，並代理 core 的
      `readChange` / `readSpec` / `readSpecAtChange` / `findRelatedChanges` / `buildGraphData`。
      既有的 `ScanSummary` 與 `formatScanSummary()` 維持不變（`probe:core` 依賴那行 stdout）。
- [x] 1.2 實作 per-folder 的 `ScanResult` 快取（D4），並提供顯式的失效入口。
- [x] 1.3 實作路徑翻譯（D5）：core 回傳的絕對路徑一律轉為 folder-relative 的 relPath，並過
      `src/main/fs-boundary.ts` 的 `isWithin` 再確認；落在 root 外者其路徑欄位回 `null`，不得回絕對路徑。
- [x] 1.4 實作 identifier 白名單（D6）：`slug` / `topic` 先在快取的 `ScanResult` 中查表，
      查不到即回失敗且**不呼叫 core**。
- [x] 1.5 實作 `openspec/` 的 chokidar 監看（D4）：`followSymlinks: false`、`ignoreInitial: true`、
      變更後使該 folder 快取失效並 debounce 送出通知。**先訂閱、再掃描。**
- [x] 1.6 單元測試（`node:test`）：快取命中不重複掃描、變更後失效、traversal 形式的 slug / topic 被拒且
      未觸及 folder 外的檔案、絕對路徑不出現在任何 DTO、debounce 合併連續事件。

## 2. IPC 契約與 preload

- [x] 2.1 新增 `src/main/ipc/openspec.ts`：channel 常數表 + `registerOpenSpecHandlers(deps)`，
      method 形狀對齊 spek 的 `ApiAdapter`（D1）：`getOverview` / `getSpecs` / `getSpec` /
      `getSpecAtChange` / `getChanges` / `getChange` / `getGraphData`，第一個參數皆為 `folderId`。
- [x] 2.2 失敗一律回結果物件（`{ ok: false, code }`），不拋例外跨 IPC —— 沿用 `ipc/fs.ts` 的 `toResult` 樣式。
- [x] 2.3 per-webContents 的服務實例與生命週期記帳：`contents.once('destroyed')` 與
      `contents.on('did-navigate')` 皆釋放該 renderer 的監看與快取（**必須是 `did-navigate`**）。
- [x] 2.4 主行程 → renderer 的變更推送（`openspec:changed`，帶 `folderId`），preload 包成
      `onChanged(listener) => unsubscribe`。
- [x] 2.5 `src/preload/index.ts` 白名單新增 `openspec.*`；於 `src/main/index.ts` 的 `app.whenReady()` 註冊 handler。
- [x] 2.6 `src/renderer/src/shell/types.ts` 由 `Window['workspace']` 回推 OpenSpec 的 DTO 型別
      （不得 import 主行程模組）。

## 3. renderer：IpcAdapter 與資料層

- [x] 3.1 新增 `src/renderer/src/shell/openspec/IpcAdapter.ts`：實作對齊 `ApiAdapter` 的介面，
      內部走 `openspec.*` IPC，把結果物件的失敗轉為 rejected promise（呈現層以 error state 承接）。
- [x] 3.2 資料 hooks：以 `openspec:changed` 通知觸發重新取數；資料未到達時回 loading 狀態
      （**不得呈現空狀態**）。
- [x] 3.3 `src/renderer/src/shell/openspec/delta.ts`：delta spec 的 markdown parser（D9），
      純函式、輸出 `{ verb, name, body }[]`；格式不符預期時降級為原樣 markdown。
- [x] 3.4 單元測試（`node:test`）：delta parser 的 ADDED / MODIFIED / REMOVED / RENAMED、
      多個 requirement、格式不符預期的降級。

## 4. renderer：側欄 UI

- [x] 4.1 `src/renderer/src/index.css` 的 `@theme` 補上 mockup 用到但目前缺的 token（D10）：
      `--color-blue` / `--color-green` / `--color-red` / `--color-accent-soft`，值取自 mockup 的 `:root`。
- [x] 4.2 side panel 的 OpenSpec 身分外殼：header（breadcrumb + 收合）與四個 nav tab 的切換
      （`role="tablist"` / `role="tab"`，不掛 `data-*`）。移除 `SidePanel.tsx` 的 placeholder。
- [x] 4.3 **本 change** 視圖：change 識別 + 狀態 badge；tasks 進度條與依 section 分組的 checklist；
      spec deltas 的 requirement 區塊（delta badge + BDD 關鍵字上色，經 `react-markdown` 的
      `components.strong` —— **不得加 `rehype-raw`、不得覆寫 `urlTransform`**）。
- [x] 4.4 本 change 視圖的空狀態（無錨定 change）：引導至 Changes 視圖，且不影響其餘三個 tab。
- [x] 4.5 **Specs** 視圖：topic 清單（含相關 change 數）＋ 單一 spec 的內容檢視（換頁，非並列）。
- [x] 4.6 **Changes** 視圖：active / archived 分區的清單（含 tasks 進度）；錨定的 change 那列 highlight；
      點選一列即錨定到 focused session 並切至本 change 視圖。
- [x] 4.7 **Graph** 視圖：自寫 SVG 二分圖（D8），左 changes、右 specs，節點可點選導向對應內容。
      零新依賴。

## 5. session 錨定與跨身分導覽

- [x] 5.1 `src/renderer/src/shell/terminal/sessions.tsx`：session 新增錨定的 change slug；
      建立 session 時若該 folder 恰有一個 active change 則自動錨定，否則不錨定（**不由 pty 輸出推測**）。
- [x] 5.2 側欄的本 change 視圖跟隨 focused session 的錨定；切換 session 時隨之改變。
- [x] 5.3 `MainStage.tsx` 提供跨身分的導航入口（D7），並將 side panel 的預設身分翻回 OpenSpec
      （folder 的 OpenSpec 身分可用時）。
- [x] 5.4 交叉導覽 OpenSpec → Files：spec / change artifact 提供「在 Files 中開啟」，帶 folder-relative 的 relPath。
- [x] 5.5 交叉導覽 Files → OpenSpec：位於 `openspec/specs/<topic>/` 或 `openspec/changes/<slug>/` 之下的檔案
      提供「在 OpenSpec 中檢視」，由 relPath 反推 topic / slug。

## 6. 驗收

- [x] 6.1 `scripts/probe-openspec.mjs`（debug port **9228**，dev + build 兩模式）：四個 tab 的切換、
      本 change 的 tasks 進度與 delta badge、Specs / Changes 清單、Graph 節點、預設身分為 OpenSpec、
      不含 `openspec/` 的 folder 退回 Files。以 `role` / `aria-label` 選取，互動用
      `Input.dispatchMouseEvent` 真事件。收尾以 `pkill -9 -f <profileDir>` 連根拔除。
- [x] 6.2 probe 涵蓋「agent 改檔 → 側欄更新」：探針於 app 執行中直接改動 fixture repo 的
      `openspec/changes/<slug>/tasks.md`，斷言 tasks 進度隨之改變（不重新整理、不重啟）。
- [x] 6.3 probe 涵蓋錨定：兩個 session 錨定不同 change，切換 focused session 後本 change 視圖隨之改變。
- [x] 6.4 probe 涵蓋交叉導覽：自 spec 跳至其 `.md` 檔（side panel 切換至 Files 且開啟該檔）。
- [x] 6.5 `package.json` 新增 `"probe:openspec": "npm run build && node scripts/probe-openspec.mjs"`。
- [x] 6.6 回歸：`npm test`、`npm run typecheck`、`npm run probe:core`（stdout 摘要仍在）、
      `npm run probe:files`、`npm run probe:terminal`、`npm run measure:bundle`（不得引入語言服務 worker）。

## 7. 文件

- [x] 7.1 回寫 `docs/PRD.md` §9.2 與 §11 Phase 5：刪除「既有 spek 頁面幾乎可原封不動跑起來」的錯誤假設，
      改述為「重用的是 `ApiAdapter` 的介面契約與 core 的型別；側欄的 UI 依 mockup 自刻」（design D1）。
- [x] 7.2 回寫 `docs/PRD.md` §6.3：OpenSpec 身分的啟用條件為「repo 含 `openspec/`」，
      刪去「且有 active change」（design D2）。
- [x] 7.3 更新 `CLAUDE.md`：現況改為 Phase 5（Phase 4 已封存）、新增 Phase 5 的實測與踩雷、
      開發指令加入 `probe:openspec`。

## 8. 側欄重構（使用者實測後）

- [x] 8.1 「本 change」改為 **artifact 分頁**（Proposal │ Design │ Tasks │ Specs），順序依
      `schemaOrder`；進度條留在標題底下、不進分頁（design D13）。
- [x] 8.2 錨定改為**衍生的預設值**：沒有明確錨定時，folder 恰有一個 active change 就顯示它 ——
      不再只在建立 session 時取快照（尚未開 session 就看到空白側欄是說不過去的）。
- [x] 8.3 nav 由四個縮為兩個（`本 change` / `瀏覽`），移除 Specs / Changes / Graph 三個視圖。
- [x] 8.4 **Specs 樹**：`spec topic → heading(h2/h3)`，heading 由 core 的 `extractHeadings` 解析
      （node-free subpath，renderer 可 runtime import，**不需要新 IPC**）。
- [x] 8.5 **Changes 樹**：`Active / Archived → change`（葉節點，帶 tasks 進度）；觸發即錨定並切至
      本 change；錨定中的節點被標示。
- [x] 8.6 兩棵樹上下堆疊、各自可收合（design D11）。
- [x] 8.7 移除自寫的二分圖 `GraphView.tsx`（design D8 作廢）。

## 9. 抽出 `@spekjs/ui`（spek repo）

- [x] 9.1 於 `spek` repo 建立 OpenSpec change：抽出 `@spekjs/ui`（`ApiAdapter` 介面 + 共用型別 +
      `GraphView` + `timeline/*`；**不含**整頁的 Dashboard / SpecDetail / ChangeDetail）。
- [x] 9.2 解決**主題契約**：`GraphView` 以 `getComputedStyle` 讀 CSS 變數取色（`--accent`），而
      workspace 的 token 是 `--color-accent` —— 套件必須連同 CSS 出貨或改由 props 傳色，
      否則圖在 Electron 裡沒有顏色（design D1 的修訂）。
- [x] 9.3 讓 `@spekjs/web` 改依賴 `@spekjs/ui`，跑 web 的回歸（build + 既有測試）。
- [x] 9.4 發佈 `@spekjs/ui` 至 npm public registry。

## 10. Graph 與 Timeline 的全視窗 overlay

- [x] 10.1 workspace 宣告 `@spekjs/ui` 依賴（**npm 版本，不可用 `file:` / `link:`**）。
- [x] 10.2 全視窗 overlay 容器：側欄提供兩個入口，`Esc` 關閉（design D12）。
- [x] 10.3 接上 `@spekjs/ui` 的 `GraphView`（d3 力導向圖）與 Timeline（Gantt），資料走既有的
      `getGraphData` / `getChanges`（**IPC 不需改**）。
- [x] 10.4 於 Graph／Timeline 中觸發一個 change → 關閉 overlay 並錨定該 change。
- [x] 10.5 `npm run measure:bundle` 確認 d3 的體積可接受，且仍無語言服務 worker。

## 11. 驗收與文件（重構後）

- [x] 11.1 更新 `scripts/probe-openspec.mjs`：四視圖 → 兩視圖、兩棵樹、artifact 分頁、overlay 的
      開啟與 `Esc` 關閉、衍生的預設錨定（尚未建 session 就看得到唯一的 active change）。
- [x] 11.2 回歸：`npm test`、`npm run typecheck`、`npm run lint`、`probe:files`、`probe:terminal`、
      `probe:shell`、`probe:core`。
- [x] 11.3 更新 `docs/PRD.md` §9.2（`@spekjs/ui` 改為「抽出，內容為 ApiAdapter + Graph + Timeline」）
      與 §6.3（側欄的視圖結構）。
- [x] 11.4 更新 `CLAUDE.md`：側欄結構、`@spekjs/ui` 的分工、Graph≠Timeline 的區別。
