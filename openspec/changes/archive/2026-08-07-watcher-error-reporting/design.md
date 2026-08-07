## Context

主行程有三個建立 chokidar watcher 的站點，各自獨立演化，對錯誤的姿態三種都不同（見 proposal
的對照表）。三者的建構樣板高度雷同 —— 都是
`shouldUsePolling` → `pollingInterval` → `withAuthoritativeChokidarEnv(…, () => chokidarWatch(target, {…}))`，
且都設 `followSymlinks: false`、`ignoreInitial: true`：

| 站點 | 形態 | `depth` | 其他 options | **`shouldUsePolling()` 收到的路徑** |
|---|---|---|---|---|
| `branch-service.ts:43` | module-level `createWatcher(target, root, depth)` | 第一層 `0`、第二層 `undefined` | — | **`root`**（`folder.path`），而 target 可能是 folder 之外的 gitdir |
| `openspec-service.ts:842` | class private `#watch(folderId, target, options?)` | 可選；另有事件種類過濾 | — | **`target`** 本身 |
| `watch-service.ts:239` | inline 在方法裡 | `0` | `alwaysStat: true` | **`root`**（folder 根），而 target 是被訂閱的子目錄 |

**三份樣板重複，正是三種姿態的成因** —— 沒有任何一處是「唯一該改的地方」，於是每個作者各自
決定要不要掛 handler，而型別檢查與探針對此都無感。

**最後一欄是本文件第一版漏掉的**（獨立 review 抓到）。它在 options 物件**之外**算出，因此逐項
比對 options 時看不見它 —— 這正是 repo 那條「一個方便取得、看起來相關的量，不等於規格真正在乎
的那個量」，這次落在本設計自己身上。它是承重的：見 D1。

## Goals / Non-Goals

**Goals:**

- 每一個經建立入口產生的 watcher，其 `'error'` 都被回報 —— 既不靜默吞掉，也不成為未捕捉例外。
- **讓「建立一個沒有 handler 的 watcher」在結構上表達不出來**，而不是靠一條「記得要掛」的紀律。
- 不改變任何使用者可見的行為（renderer 一行不動），**也不改變三個站點現有的 polling 判定**。

**Non-Goals:**

- 把 watcher 失效呈現到 UI、`ENOSPC` 降級 polling、收斂 watcher 數量 —— 三者皆為 issue #9 的
  其他方向，各自需要獨立論證（proposal 已列）。
- **watcher 失效後的復原**。本 change 讓失敗可觀察，不讓它自癒。
- **以輪詢方式觀察檔案的機制**（`session-status.ts` 每 2 秒讀 agent 狀態與 `git status`）不在本
  能力的範圍內 —— 它不經 chokidar，D2 的守衛永遠碰不到它。它今日的讀取端都有 try/catch，
  但那不是本 change 保證的。
- **修正 `branch-service` 第二層 watcher 的 polling 判定**（見 D7）。

## Decisions

### D1: 抽一個共用的 watcher factory，介面收**兩個**路徑

**選擇**：新增 `src/main/watcher.ts`，導出建立 watcher 的唯一入口；三個 service 一律經它建立。

介面必須把**監看目標**與 **polling 判定的依據**分開收：

```
create({ target, pollingRoot, depth?, alwaysStat? })
```

**為什麼不能只收一個路徑**：`shouldUsePolling(p)` 會 `realpath(p)` 再查 `/proc/mounts`，判定的是
**那條路徑所在掛載點**的檔案系統。三處目前餵給它的路徑不同（見 Context 的最後一欄），而 worktree
落在與 folder 根不同的掛載點是常態 —— 那正是 `worktree-aggregation` 三個讀取根的前提。

**失效情境**（若合併為一個參數）：使用者的 worktree 在 NFS／SMB／overlay 上、folder 根在 ext4。
`shouldUsePolling` 拿到 folder 根 ⇒ `false` ⇒ 對一個不送 inotify 事件的檔案系統用 native watch ⇒
**側欄對那個 worktree 靜默停止更新**。而且**這個失效連新的 error handler 都救不到**：`fs.watch`
只是永遠不觸發，沒有任何錯誤可以 emit。單元測試、守衛、探針全綠（它們都跑在本機 ext4 上）。

**本 change 不改變任何一處現在傳的值** —— 三處各自傳它今天傳的東西，差異被保留而非被統一。
統一它們是一個行為變更，不屬於一個宣稱「不改變使用者可見行為」的 change（見 D7）。

**為什麼不是三處各補一行**：那是把「三種姿態」改成「三種姿態碰巧一致」。第四個站點依然可以用
第四種姿態出現，而這正是本次缺陷的成因。repo 已有同形的先例：編輯器封裝於
`src/renderer/src/editor`，且**該先例是以 eslint 強制的**（見 D2）。

**代價**：這比 proposal 預估的「三到五行」大，它是一次重構。減輕的理由：三處的差異已完整清點
（`depth` / `alwaysStat` / 事件註冊 / **polling 路徑**），factory 介面由**三處的聯集**決定，
不臆測未來的需求；`npm test` 與 `probe:files` / `probe:openspec` / `probe:workspace` 覆蓋既有行為。

**被否決的替代**：讓守衛做資料流分析（追 `chokidarWatch()` 的回傳值流向哪個變數、該變數是否
被 `.on('error', …)`）。三處的回傳值都經過 `withAuthoritativeChokidarEnv` 的 callback、再經
`return` 跨出函式邊界 —— 要正確追蹤得做跨函式的別名分析，而一個會誤判的守衛比沒有守衛更糟
（它會被加豁免，然後被忽略）。

### D2: 以 eslint 擋靜態 import，自寫守衛只補 eslint 擋不到的兩件事

**兩個機制，作用域不重疊**：

| 機制 | 擋什麼 | 為什麼是它 |
|---|---|---|
| `@typescript-eslint/no-restricted-imports`（`eslint.config.js`，`src/main/**`，`ignores: watcher.ts`） | 靜態 `import … from 'chokidar'` | **repo 已用它擋 monaco**（`eslint.config.js:40`，註解寫著「靠人工 grep 把關撐不住」）。`allowTypeImports: true` 讓型別 import 合法 —— 三個 service 仍可 `import type { FSWatcher } from 'chokidar'` |
| `scripts/watcher-source.test.mjs`（AST，並入 `npm test`） | ① `await import('chokidar')` ② `watcher.ts` re-export chokidar 的**值** ③ `followSymlinks` 出現在 watcher.ts 之外 | eslint 的規則對這三者皆無感（動態 import 已實測不被攔） |

**第一版把整套守衛都自己寫，是沒有查既有機制的結果** —— 而 D1 引用的 monaco 先例正是用 eslint
做的。`allowTypeImports` 一併消掉了第一版「要求 `watcher.ts` re-export `type FSWatcher`」那段
彆扭：那個 re-export 本身就是下一條要擋的漏洞。

**第 ② 條是必要的，因為 D2 的「蘊含」不是自動成立的**：守衛證明的是「沒有檔案 import chokidar」，
那**不蘊含**「每個 watcher 都有 handler」。`watcher.ts` 只要 `export { watch } from 'chokidar'`，
呼叫端就能 `import { watch } from './watcher'` 建出一個裸的、沒有 handler 的 watcher，而所有守衛
全綠。**本 change 的全部理由就是「讓它表達不出來」，所以這個漏洞必須一起堵。**

**自寫的那支仍走語法樹不走逐行比對**，理由同 `copy-language.test.mjs`：`openspec-service.test.ts`
與 `watch-service.test.ts` 的**註解**都提到 chokidar，逐行掃描會誤判它們。

**對照組**（守衛必須被驗證有鑑別力）：把任一 service 改回直接 import，確認 eslint 變紅；
加一個 `await import('chokidar')`、一個 value re-export，各自確認自寫守衛變紅。

### D3: factory 不接受 `followSymlinks`，一律 `false`

三處目前各自寫著 `followSymlinks: false`，各自帶一段解釋（chokidar 的預設是 `true`，folder 內一個
指向邊界外的 symlink 被展開時，watcher 會跟著走出去）。那是**檔案系統邊界的一部分**，不是每個
呼叫端的偏好。factory 在型別上不暴露這個選項，第四個站點就無從忘記它。

這是本 change 的**順帶收益**，也是它值得做成 factory 而非三行修正的第二個理由。

### D4: handler 回報什麼 —— 以及三處各自能識別到什麼

`console.error`，訊息**英文**（CLAUDE.md：`console.*` 不進字典，但一律英文），沿用
`watch-service.ts:268` 既有的 `[watch] <label>: <error>` 形狀。

**那一行 log 的是 `root` 而不是 target，而且那是對的** —— 第一版 design 兩處都寫錯了。
`watch-service` 刻意讓**一個 folder 一個 FSWatcher 服務 N 個動態增減的 target**
（`watcher.add(target)` / `watcher.unwatch(target)`），而 chokidar 的 `'error'` payload 只有 Error
本身，**不指出是哪一個被監看的路徑失敗**。要求它印出「監看目標」，只會讓它從「哪個 folder」
退化成「碰巧第一個被訂閱的目錄」—— 比現況更沒有識別力。

因此 factory 收一個**識別標籤**，由呼叫端決定傳什麼：

| 站點 | 傳什麼 | 為什麼 |
|---|---|---|
| `watch-service` | folder 根 | 一個 watcher 服務多個 target，根是唯一恆定且有意義的識別 |
| `openspec-service` | 監看目標 | 一個 watcher 對一個目標，且同一個 folder 有多個（`openspec/`、worktrees 清單、每個工作目錄） |
| `branch-service` | 監看目標 | 同上；第二層的 gitdir 路徑正是分辨它的東西 |

spec R1 因此寫「識別該監看者的路徑」而非「監看目標的路徑」。

**不做**：把錯誤往 renderer 送、不重試、不關閉 watcher。皆為 Non-Goals。

### D5: 單元測試以 stub `console.error` 觀察，產品程式碼不開注入口

驗收要斷言「錯誤有被回報」，最直接的做法是讓 factory 接受一個可注入的 reporter —— **不採用**，
那是在產品程式碼裡開一條只有測試會走的岔路（repo 既有紀律）。改以 `node:test` 的
`mock.method(console, 'error')` 在測試側攔截（已實測可行）。

三條測試，各自的失效方向不同：

1. 對 factory 建出的 watcher `emit('error', …)` → **不 throw**（守 `branch-service` 那個未捕捉例外）
2. 同上 → `console.error` **收到一則含識別標籤的訊息**（守 `openspec-service` 那個靜默吞掉）
3. 對照組：暫時移除 factory 內的 handler → 前兩條各自變紅

第 3 條是這三條裡唯一擋得住假綠的 —— 沒有它，一個「handler 掛了但沒真的接到事件」的實作照樣通過。

**兩個測試必須做的收尾**（否則 `node --test` 會 hang，或後續測試失去 console）：`close()` 那個
watcher、`restore()` 那個 spy。

**一個容易誤判的事實**：`on('all', …)` **不算** error listener —— chokidar 的 `emitWithAll` 對
`EV.ERROR` 跳過 `EV.ALL`。`branch-service` 兩層都掛了 `on('all')`，那沒有給它任何保護。

### D6: 事件註冊留在呼叫端

factory 只負責建構與錯誤處理；`'all'` / 各事件種類的註冊仍由三個 service 自己做（三者的事件語意
完全不同：`branch-service` 過濾 basename、`watch-service` 逐事件轉譯路徑、`openspec-service`
收斂為「結構已變更」）。把它們也搬進 factory 會做出一個帶著三套分支的參數怪物。

### D7: 不順手修 `branch-service` 第二層的 polling 判定

清點 Context 那張表時發現：`branch-service` 第二層 watcher 監看的是 gitdir 底下的 `HEAD`，
而 worktree 與 submodule 的 gitdir **可能落在與 folder 根不同的掛載點**上 —— 它卻用
`folder.path` 判定 polling。**這看起來是既有的 bug**，不是本 change 造成的。

**本 change 不修它**，理由有三：(1) 它是行為變更，而本 change 對外宣稱「不改變任何使用者可見的
行為」，兩者混在一起會讓回歸失去基準；(2) 它沒有驗收載體 —— 要一個跨掛載點的 worktree 才驗得到，
本機探針一律在 ext4 上跑；(3) 它與本 change 的目的（錯誤可回報）無關，只是被同一次清點撿到。

**開為 issue**，並在 factory 的介面上留下讓它容易修的形狀（`pollingRoot` 是顯式參數，改一處即可）。

## Risks / Trade-offs

- **F1 那類的靜默行為漂移**（合併 polling 路徑）→ 已寫進 D1 與 tasks 的逐項核對清單。**任何
  「三處都是機械替換」的說法，都要先有一份完整的差異清單** —— 第一版沒有，而缺的那一項恰好是
  唯一會靜默失效的。
- **`withAuthoritativeChokidarEnv` 的同步窗口** → core 要求 env 的對齊只在
  `set → chokidar 建構 → restore` 這段**同步**窗口內有效。factory 內部必須維持 callback 同步，
  不可為了介面好看而改成 async。三處現有的註解都寫著這件事，搬進 factory 時一併搬。
- **`console.error` 的噪音比第一版預期的低** → chokidar 的 `_handleError` 過濾掉 `ENOENT` 與
  `ENOTDIR`（`index.js:551-559`，已實測），所以「監看目標在正常操作中消失」這個最常見的情形
  **根本不會 emit**。剩下會 emit 的是 `EPERM`／`EACCES`（`ignorePermissionErrors` 預設 false）
  與 `ENOSPC` —— **正好都是應該印出來的**。
- **守衛擋不住直接呼叫 `fs.watch`** → 本 change 的不變式是「chokidar watcher 一律出自 factory」，
  不是「主行程不得有其他監看機制」。已清查：`src/` 下沒有 `fs.watch` / `fs.watchFile` 的使用點，
  `@spekjs/core` 也不自建 watcher（它只導出 `shouldUsePolling` / `pollingInterval` /
  `withAuthoritativeChokidarEnv`）。唯一的其他觀察機制是 `session-status.ts` 的輪詢，已列 Non-Goal。

## Open Questions

兩條都已裁決，留在此處記錄：

1. ~~範圍是否接受 D1 的重構~~ → **接受**。而 review 之後理由更強了：D3（邊界約束不該是呼叫端的
   選項）與 D1 的 `pollingRoot` 都要求一個共用入口才能表達。
2. ~~README 的疑難排解是否順帶~~ → **做**（tasks 5.1）。
