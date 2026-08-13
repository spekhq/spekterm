## 1. 建立入口：讓安全的選擇成為預設

- [x] 1.1 `CreateWatcherOptions.pollingRoot` 改為 optional，`createWatcher` 內部以
      `pollingRoot ?? target` 判定輪詢
- [x] 1.2 改寫 `src/main/watcher.ts` 檔頭「兩個路徑參數是分開的，不要合併」那一段 ——
      論證從「它們不同，別合併」改為「**預設一致，顯式才分開**」，並寫明四個建立點裡只有一個
      需要顯式
- [x] 1.3 `pollingRoot` 的 JSDoc 寫明顯式傳入的語意（「我這個監看者服務多個目標，請以共同根
      判定」）**以及它的限定**：共同根只在該根與所有目標同掛載點時成立（design D5）

## 2. 呼叫端：一對一全部改為省略，顯式只剩一處

- [x] 2.1 `src/main/branch-service.ts` 第二層（HEAD watcher）移除 `pollingRoot`，並刪除
      `#refreshHead` 中指向 issue #16 的那段註解（它隨本 change 作廢）
- [x] 2.2 `branch-service` 第一層（folder 根）移除 `pollingRoot` —— 一對一監看，保留顯式會讓
      「顯式＝服務多目標」的語意不精確
- [x] 2.3 `src/main/openspec-service.ts` 的 `#watch` 移除 `pollingRoot: target`，並改寫該處註解
      （它現在寫「這裡是一個 watcher 對一個目標，所以 polling 判定與識別標籤都用 target」——
      前半改為「靠預設」，`label` 的部分維持不變）
- [x] 2.4 `src/main/watch-service.ts` 保留顯式傳入，補一句註解說明**為何**顯式（一個 watcher
      服務 N 個動態增減的子目標）—— 它是改完之後**唯一**還顯式的一處
- [x] 2.5 grep `createWatcher(` 確認產品程式碼中恰為四個建立點，且除 `watch-service` 外均已省略

## 3. 可測性接縫

- [x] 3.1 `BranchService` 建構子接受 optional 的 watcher 工廠參數，預設為 `createWatcher`
      （依賴反轉，不是條件分支。先例：`OpenSpecService` 注入 `scan`，`openspec-service.ts:319`）
- [x] 3.2 主行程的建構呼叫不傳該參數，確認行為不變

## 4. 驗收

**斷言對象是 `watcher.options.usePolling`，不是傳出的參數**（design D3／D4）。

- [x] 4.1 測試輔助：從 `/proc/mounts` **探測**一個會觸發輪詢的掛載點（以 core 的
      `fsTypeNeedsPolling` 篩選，再以 `shouldUsePolling` 自檢）。**不得寫死 uid 或路徑。**
      探測不到時回 `null`，由呼叫端 skip 並**印出略過的事實**
- [x] 4.2 單元測試（`watcher.test.ts`）：省略 `pollingRoot` 且 `target` 位於需輪詢的掛載點時，
      `options.usePolling === true`；**對照組**：同一個 target 配一個本機 `pollingRoot` 時為 `false`
- [x] 4.3 單元測試（`watcher.test.ts`）：顯式指定共同根時以該根判定（`target` 在需輪詢的掛載點、
      共同根在本機 ⇒ `false`），確認顯式傳入仍然有效
- [x] 4.4 單元測試（`src/main/branch-service.test.ts`，**新檔**）：以 spy 工廠取得 HEAD watcher，
      斷言其 `options.usePolling === true`。fixture：folder 根在 tmpdir（本機），`.git` 為**檔案**
      且內容為 `gitdir: <需輪詢掛載點下的路徑>`（該路徑**不需存在** —— `detectMountFsType` 對
      `realpath` 失敗會沿用原字串比對）
- [x] 4.5 **對照組**：把 `pollingRoot: folder.path` 加回第二層，實際執行 4.4 確認它變紅，再還原。
      **對照組沒跑過就不算做完這一條** —— 這個 repo 每一次省略它的守衛都是假綠
- [x] 4.6 單元測試（`watch-service.test.ts`）：釘住 `watch-service` 仍以 folder 根判定 ——
      **這條擋的是「把唯一的孤例清理掉」**（design Risks 第一條）。對照組：移除該處的
      `pollingRoot`，確認測試變紅
- [x] 4.7 保留一組不依賴掛載點的參數層級斷言作為基準（任何機器都跑得動），與 4.2–4.6 並存
- [x] 4.8 `npm test` 全綠
- [x] 4.9 `npm run typecheck` 與 `npm run lint` 通過
- [x] 4.10 `npm run probe:workspace` 的 `repo-branch` 段落全綠（design 指定的回歸基準 ——
      同掛載點下 `pollingRoot ?? target` 得到相同答案，本機行為應完全不變）

## 5. 文件與既有測試

- [x] 5.1 `openspec/specs/watcher-error-reporting/spec.md` 的 **Purpose** 擴寫 —— 它現在把這條
      能力定義成「監看**失敗**時會怎樣」，與新增的 requirement（連錯誤都不會產生的失敗）說法
      相反。**delta 只含 requirements，sync 不會動 Purpose，所以這一條必須手動做**
- [x] 5.2 `src/main/watcher.test.ts` 既有三處 `pollingRoot: base` —— 改為省略（它們都是一對一），
      否則入口自己的測試讀起來就是「我服務多個目標」
- [x] 5.3 更新 CLAUDE.md「檔案系統邊界與信任模型」中 watcher 那一條：
      「建立入口的 `target` 與 `pollingRoot` 是兩個參數，不要合併」需改為反映新的預設語意，
      並記下「四個建立點裡三個的正確答案就是 target 自己」
- [x] 5.4 issue #16 補一則說明：採用的是「`pollingRoot` 改 optional」而非票中設想的
      「第二層改傳 `target`」；驗收涵蓋「輪詢是否被啟用」，未涵蓋「輪詢啟用後事件真的送達」。
      **關閉留到 archive 時**（與 commit 同步）—— 已在 comment 中說明修法與未涵蓋的部分
