## Why

主行程有三個建立 chokidar watcher 的站點，它們對 watcher 錯誤採取**三種不同的姿態**：

| 站點 | 現況 | 錯誤發生時 |
|---|---|---|
| `watch-service.ts:267` | `console.error(...)` | 可回報的失敗 |
| `openspec-service.ts:876` | `on('error', () => {})` | **靜默吞掉** |
| `branch-service.ts` | **沒有 handler** | **未捕捉例外** —— chokidar 的 `FSWatcher extends EventEmitter`，Node 對沒有 listener 的 `'error'` 直接 throw（`src/` 下沒有任何 `uncaughtException` handler） |

**只有第三條是使用者可見的修復，而它一條就夠了**：主行程一死，它底下所有 pty 跟著死，而 pty 裡
跑的是使用者正在進行的工作（`session-persistence` 交付的是重建、不是常駐 —— 跑到一半的 build 或
agent 救不回來）。

**另外兩條要誠實說**：`openspec-service` 改完之後，側欄該停止更新時**照樣**安靜地停止更新 ——
產物從桌面啟動，stderr 沒有人在看。這個 change 把它從「對誰都不可見」變成「對跑 `npm run dev` 的
人可見」。真正讓使用者看見它，是 issue #9 的另一個方向（呈現到 UI），不在本 change 內。

**那個空 handler 從來沒有保護過任何東西。** 它的註解寫著「例如 `openspec/` 不存在」，而 chokidar
的 `_handleError` 過濾掉 `ENOENT` 與 `ENOTDIR`（`index.js:551-559`，已實測）—— 它設想的情形根本
不會 emit。所以它不是一個有代價的取捨，是純損失。

**現在做的理由是成本不對稱**：三個站點對齊加上一道守衛，換掉一條「使用者非自願地失去正在跑的
工作」的路徑。

**這個 change 沒有已知的重現案例，而那正是它的性質。** 已實測的是「一旦 chokidar emit `'error'`，
三種姿態各自的結果」（無 handler → throw、空 handler → 靜默、有 handler → 收到）；**未實測的是
「什麼情況下 chokidar 真的會 emit」**（已知會過濾 `ENOENT`／`ENOTDIR`，剩下 `EPERM`／`EACCES`／
`ENOSPC`）。所以這不是在修一個看得見的 bug，是在補一個結構性缺口 —— 而缺口本身（三個站點三種
姿態）不需要重現案例就已經是缺陷：下一個加 watcher 的人不知道該照哪一個抄。

## What Changes

- **三個站點的錯誤處理對齊**：每一個 watcher 的 `'error'` 都必須有 handler，且該 handler 必須
  回報（`console.error`，含識別該監看者的路徑），SHALL NOT 為空、SHALL NOT 缺席。
- **建立收斂到單一入口** `src/main/watcher.ts`，錯誤處理與 `followSymlinks` 都在那裡，不由呼叫端
  決定。入口的介面把**監看目標**與 **polling 判定的依據**分開收 —— 三個站點餵給
  `shouldUsePolling()` 的路徑本來就不同，合併會靜默改變 polling 判定（詳見 design D1）。
- **兩道守衛，作用域不重疊**：eslint 的 `no-restricted-imports` 擋靜態 import（repo 已用它擋
  monaco），一支 AST 守衛補它擋不到的三件事（動態 `import()`、`watcher.ts` re-export chokidar 的
  值、`followSymlinks` 出現在入口之外）。**這是本 change 的重點** —— 三行修正沒有守衛的話，
  第四個站點會以完全相同的方式再犯一次。
- **單元測試**覆蓋錯誤被回報（含對照組：移除 handler 確認變紅）。
- **清掉兩處已被推翻的分析**：`docs/lessons/side-panel.md` 與 `scripts/probe-openspec.mjs` 都還
  寫著 issue #9 原本那個錯誤的 inotify 根因（instance 上限 128），而本 change 正是關掉那張票的。

**明確不做**（issue #9 的其餘方向，各自需要獨立論證）：

- 把 watcher 失效**呈現到側欄 UI**。
- `ENOSPC` 時**降級為 polling**。
- **收斂 watcher 數量** —— `openspec-service.ts` 的 783 / 838 兩處監看 `openspec/` 時沒給 `depth`，
  遞迴吃掉整棵樹（dogfood 中的主行程實測 7675 個 watch descriptor，多數來自 `changes/archive/`）。
- **修 `branch-service` 第二層的 polling 判定**（清點時撿到的既有 bug，見 design D7，另開 issue）。

## Capabilities

### New Capabilities

- `watcher-error-reporting`: 主行程檔案監看的錯誤處理紀律 —— 每一個經建立入口產生的 watcher，
  其錯誤都必須被回報，既不得靜默吞掉、也不得成為未捕捉例外。**刻意寫成橫切的 capability 而非
  分散到三個既有 spec**：這個缺陷的成因正是三個站點各自為政，而分散的規格只約束當下這三處，
  第四個站點依然不受任何條款約束。

### Modified Capabilities

無。既有 spec 對 watcher 的**錯誤處理**沒有任何條款（`file-explorer`、`worktree-aggregation`、
`repo-branch`、`filesystem-access` 講的都是監看範圍與事件語意）。`workspace-app-shell` 的
「主行程未拋出未捕捉的例外」限於 app 啟動，`openspec-data-access` 的「失敗以結果物件跨越 IPC」
是 IPC 層 —— 兩者都與 watcher 的行程內錯誤不同層。

## Impact

**產品程式碼**（主行程）

- 新增 `src/main/watcher.ts` —— 建立入口
- `src/main/branch-service.ts` —— 移除自有的 `createWatcher()`，兩層 watcher 改用入口（該檔只有
  一個 `chokidarWatch()` 呼叫點）
- `src/main/openspec-service.ts` —— `#watch()` 改用入口，移除空 handler
- `src/main/watch-service.ts` —— inline 建構改用入口
- `eslint.config.js` —— 對 `src/main/**` 新增 chokidar 的 import 限制

**驗收**

- 新增 `scripts/watcher-source.test.mjs`（AST 守衛）與 `src/main/watcher.test.ts`

**文件**

- README（`max_user_watches` 疑難排解）、CLAUDE.md、`docs/lessons/side-panel.md`、
  `scripts/probe-openspec.mjs` 的段落註解

**不受影響**：renderer 一行未改、無 IPC 變更、無新相依。

**風險**：主要在 D1 那類的靜默行為漂移（合併 polling 路徑會讓跨掛載點的 worktree 靜默停止更新，
且錯誤 handler 救不到它）。緩解是逐項核對三處的建構參數，清單見 tasks 2.4。
