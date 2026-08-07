## 1. 建立入口

- [x] 1.1 新增 `src/main/watcher.ts`：導出建立檔案監看者的唯一入口。介面
      `create({ target, pollingRoot, label, depth?, alwaysStat? })` —— **`target` 與 `pollingRoot`
      必須分開收**（design D1：三處餵給 `shouldUsePolling()` 的路徑本來就不同，合併會靜默改變
      polling 判定，而那個失效連錯誤 handler 都救不到）
- [x] 1.2 樣板搬入 factory：`shouldUsePolling(pollingRoot)` / `pollingInterval` /
      `withAuthoritativeChokidarEnv`。**callback 必須維持同步** —— core 的 env 對齊只在
      `set → chokidar 建構 → restore` 這段同步窗口內有效，三處現有的註解一併搬過來
- [x] 1.3 `followSymlinks` **不出現在介面上**，於 factory 內硬編為 `false`；把三處各自的理由
      註解收斂為一段（design D3）
- [x] 1.4 掛上 `'error'` handler：`console.error`，訊息**英文**，形狀
      `[watch] <label>: <error>`。**`label` 由呼叫端傳**（design D4 的對照表：`watch-service`
      傳 folder 根、另兩處傳監看目標）
- [x] 1.5 **不得** re-export chokidar 的任何值；三個 service 若需要 `FSWatcher` 型別，各自以
      `import type` 取用（eslint 的 `allowTypeImports` 放行）

## 2. 三個站點改用建立入口

- [x] 2.1 `src/main/branch-service.ts`：移除 module-level 的 `createWatcher()`，兩層 watcher
      改用新入口
- [x] 2.2 `src/main/openspec-service.ts`：`#watch()` 改用新入口，移除空的
      `on('error', () => {})`；事件註冊留在原地（design D6）
- [x] 2.3 `src/main/watch-service.ts`：inline 的建構改用新入口；既有的 `console.error` 由 factory
      承擔，**`label` 傳 `root`（維持現況 —— 一個 watcher 服務 N 個動態 target，根是唯一恆定的
      識別）**
- [x] 2.4 **逐項核對三處的建構參數未變**，四項缺一不可：`depth`（branch 第一層 0／第二層
      undefined、openspec 條件式、watch 0）、`alwaysStat`（僅 watch）、事件註冊、
      **`shouldUsePolling()` 收到的路徑**（branch 傳 `folder.path`、watch 傳 `root`、openspec 傳
      `target`）。**第四項是第一版 design 漏掉的那一項，也是唯一會靜默失效的**

## 3. 驗收 —— 錯誤被回報（spec R1）

- [x] 3.1 新增 `src/main/watcher.test.ts`，對 factory 建出的 watcher `emit('error', …)`，
      斷言**不 throw**〔R1 scenario「監看者發出錯誤時主行程存活」〕
- [x] 3.2 同上，以 `mock.method(console, 'error')` 攔截，斷言訊息**含 label**
      〔R1 scenario「回報指出是哪一個監看者出錯」〕。**不得在產品程式碼開注入口**（design D5）
- [x] 3.3 兩條測試都要 `close()` watcher 並 `restore()` spy —— 否則 `node --test` 會 hang，
      或後續測試失去 `console.error`
- [x] 3.4 **對照組**：暫時移除 factory 內的 handler，確認 3.1 與 3.2 各自變紅，再還原。
      〔R1 requirement 明文要求的鑑別力〕

## 4. 驗收 —— 建立入口是唯一的（spec R2、R3）

- [x] 4.1 `eslint.config.js`：對 `src/main/**` 新增 `@typescript-eslint/no-restricted-imports`
      擋 `chokidar`，`ignores` 排除 `src/main/watcher.ts`，並設
      **`allowTypeImports: true`**（實作時確認該選項在本 repo 的 eslint 版本上生效）
      〔R2 scenario「產品原始碼中只有建立入口取用監看套件」〕
- [x] 4.2 新增 `scripts/watcher-source.test.mjs`（TypeScript AST，走語法樹不走逐行比對 ——
      既有測試的**註解**提及 chokidar，逐行掃描會誤判），補 eslint 擋不到的三件事：
      ① `await import('chokidar')` ② `watcher.ts` re-export chokidar 的**值**
      〔R2 scenario「建立入口再導出底層的值即失敗」〕 ③ `followSymlinks` 出現在 `watcher.ts`
      之外〔R3 scenario「跟隨 symlink 的設定只出現在建立入口」〕
- [x] 4.3 **對照組**（三個機制各驗一次）：把任一 service 改回直接 `import { watch } from 'chokidar'`
      確認 **eslint** 變紅；加一個 `await import('chokidar')`、一個 value re-export、一個呼叫端的
      `followSymlinks`，各自確認**守衛**變紅；全部還原
      〔R2 scenario「繞過建立入口即失敗」〕
- [x] 4.4 確認新的 `scripts/*.test.mjs` 被 `test:unit` 的 glob 收進去（應為 no-op 驗證）

## 5. 文件

- [x] 5.1 README 新增疑難排解：`max_user_watches` 過低的機器會撞 `ENOSPC`（判準——低於一萬會有
      問題，預設 524288 不會；dogfood 中的主行程實測佔用 7675 個 watch descriptor，多數來自
      `openspec/changes/archive/`）
- [x] 5.2 **`docs/lessons/side-panel.md:180` 的 inotify 段落已被推翻，必須改寫** —— 它寫著
      「`max_user_instances` 是 per-user 的 128，app 每監看一處就吃一個」，而實測是 libuv
      每個 event loop 只開一個 instance（3 個），每個路徑是一個 watch descriptor（7675 個，
      上限 524288）。CLAUDE.md 把那份列為動側欄前**必讀**
- [x] 5.3 **`scripts/probe-openspec.mjs:1372` 的段落註解同樣帶著那個假根因**，而且它是一個**排序
      決定**的理由。**注意：它附帶的實測現象（「把這一段放在後段時，連改一個既有檔案都不會觸發
      更新」）是真的，被推翻的只有歸因** —— 改註解時不得把現象一起刪掉，要標明它目前沒有已知的
      解釋（`docs/lessons/probes.md:223` 記著那輪四次誤診的真因是探針自己的變數遮蔽，可能同源）
- [x] 5.4 CLAUDE.md：於「檔案系統邊界與信任模型」補一條 —— chokidar watcher 一律經
      `src/main/watcher.ts` 建立，錯誤處理與 `followSymlinks` 都在那裡，不由呼叫端決定
- [x] 5.5 準備新主 spec 的 `## Purpose` 段內容（delta 檔不帶它，sync 時併入
      `openspec/specs/watcher-error-reporting/spec.md`）：這條能力管的不是監看**做什麼**
      （那由 `filesystem-access` / `openspec-data-access` / `repo-branch` /
      `worktree-aggregation` 各自定義），而是**監看失敗時會怎樣**；它橫切，因為缺陷本身橫切

## 6. 回歸

> **dogfood 不列為本 change 的驗收項** —— 使用者將於方便時自行進行。因此
> 「不改變任何使用者可見的行為」這句宣稱，其證據**止於下列自動化驗收**：探針跑在虛擬螢幕上，
> 證明得了行為與資源生命週期，證明不了畫素與手感。

- [x] 6.1 `npm test`（442 通過）、`npm run typecheck`、`npm run lint`
- [x] 6.2 `npm run probe:files`（117 ✓）、`npm run probe:openspec`（436/436，含 worktree 聚合
      全段）、`npm run probe:workspace`（91/91）。**`probe:core` 不列入 —— 它只驗 `scanOpenSpec`
      與不開 TCP 埠，完全不碰 watcher**。
      過程中連續跑多支之後出現數條紅燈與一次中斷，**含 baseline 三次重現、一度誤判為確定性的
      pre-existing bug**；機器靜下來後單獨重跑三支皆全綠 —— 已轉為 issue #17

## 7. 後續追蹤

- [x] 7.1 `branch-service` 第二層 watcher 的 polling 判定（監看的是可能位於別的掛載點的 gitdir，
      卻以 `folder.path` 判定）—— 既有 bug，本 change 不做，**已轉為 issue #16**（理由見
      design D7）
