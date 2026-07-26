> **順序是承重的。** 第 1–2 節把「解析與夾制」做完並以單元測試釘住 —— 那是本 change 唯一動到
> **安全邊界**的部分（`terminal-sessions` 那條「由結構保證」的要求換了形式）。UI 到第 5 節才碰。
> 反過來做的話，邊界的紅燈會混在 UI 的紅燈裡。
>
> **`create` 的簽名幾乎不動**：`SpawnOptions.cwd` 本來就存在，且本來就只由主行程供應。
> 新增的是「把識別碼查表解析成路徑」與「夾制的範圍」，不是一條新的路徑通道。

## 1. 解析：識別碼 → 路徑

- [x] 1.1 導出一個以 `folderId` + 工作目錄識別碼解析路徑的存取器，內部走**與側欄同一個
      `OpenSpecService` 實例與同一組參數**。**光說「在 IPC 層解析」不可執行**（design Risks）：
      `OpenSpecService` 住在 `ipc/openspec.ts` 的模組私有 Map，`registerTerminalHandlers` 拿不到；
      而改呼叫 core 的 `listWorkspaces` 會因 **`includeJj` 預設為 true** 而讓可達集合大於側欄
      列舉的集合 —— 那正是 D2 保證的「恆等於」被破壞
- [x] 1.2 **查無對應即拒絕**，不做任何 fallback（spec 明文）。`TerminalService` 不得 import
      OpenSpec 資料層 —— 它收到的是已解析的路徑
- [x] 1.3 拒絕的錯誤訊息進 `src/shared/i18n/en.json` 的 `terminalError` —— `TerminalError` 的
      message 會被畫到終端上，屬於使用者可見文案（CLAUDE.md 的第 3 類）
- [x] 1.4 `npm test`：不存在的、他 repo 的、空字串、格式不合的識別碼一律被拒且不產生 pty
      （比照既有的 slug traversal 測試）
- [x] 1.5 對照組：把 1.2 的拒絕改成「查無就用 folder 根」，1.4 必須變紅

## 2. 夾制：兩道，不是一道

- [x] 2.1 `#initialCwd` 的夾制放寬為「folder 根之下，**或**該 repo 任一工作目錄之下」。合法的根
      集合由呼叫端供應（`SpawnOptions` 新增欄位），**不由 `TerminalService` 自行查詢**
- [x] 2.2 **`cwdOf()` 同樣要放寬** —— 它是**第二道、獨立的**夾制（記錄側）。不改它的話，`cd` 到
      邊界外 worktree 的位置**從一開始就不會被寫進 `sessions.json`**，於是放寬後的 `#initialCwd`
      收到 `undefined`、一切看起來正常，而 spec 的「於 folder 邊界外的工作目錄重生」永遠驗不到
      自己宣稱在驗的東西。**兩道夾制共用同一個合法根集合判定**
- [x] 2.3 `cwdOf()` 現有註解的理由已過期（放寬後 `sessions.json` 會出現 folder 邊界外的絕對路徑 ——
      那是主行程擁有的欄位，可接受），一併更新
- [x] 2.4 **建立與重建兩條路徑對「路徑已消失」的行為不同**：建立時 SHALL 拒絕（spec 明文），
      重建時 SHALL 退回 folder 根（D6）。`#initialCwd` 目前在 `statSync` 失敗時一律靜默退回 ——
      實作上要能區分，不可讓建立路徑沿用重建路徑的寬容
- [x] 2.5 `src/main/terminal.test.ts`：夾制的表格式測試 —— folder 之下 ✓、邊界內 worktree ✓、
      **邊界外 worktree ✓**（本 change 的重點）、兩者皆非（`/etc`）→ 退回 folder 根、
      工作目錄集合為空時行為與現行一致
- [x] 2.6 對照組：把 2.1 的放寬拿掉，2.5 的「邊界外 worktree」必須變紅；把 2.2 的放寬拿掉，
      「記錄側」那條必須變紅

## 3. IPC 與 preload

- [x] 3.1 `src/main/ipc/terminal.ts`：`create` 的 handler 收第三個參數（工作目錄識別碼，可省略），
      解析後以 `options` 交給 `TerminalService.create`
- [x] 3.2 `src/preload/index.ts`：`terminal.create` 的簽名
- [x] 3.3 **`probe:shell` 現有的守衛看不到簽名改變** —— 它是 `Object.keys()` 的集合差，加參數不會
      改變 key 集合。要嘛**新增**一條簽名守衛（例如斷言 `create.length`），要嘛只更新註解並明說
      它不具守衛力。**不可寫成「更新既有守衛」然後打勾** —— 那是打了勾但什麼都沒做

## 4. 持久化

- [x] 4.1 `PersistedSession` 新增工作目錄識別碼（per-session、可省略）。**它是 renderer 供應的
      欄位**，因此 `session-persistence` 的「持久化不得把路徑詞彙交給 renderer」要一併改寫 ——
      識別碼不可逆、且只對查表命中的值解析（見該 delta）
- [x] 4.2 `parseSessionEntry` 對識別碼做格式驗證（`/^[0-9a-f]{8}$/`），比照 `claudeSessionId` 的
      `isUuid` —— 損毀的值在載入時就丟掉，不要走到查表
- [x] 4.3 重建時以識別碼解析為 cwd；該工作目錄已消失時退回 folder 根且**不使重建失敗**
- [x] 4.4 **`#heal()` 的 pty 也要在那個工作目錄**。`Session` 目前**不存 cwd**，自癒一律
      `#initialCwd(folderPath, undefined)` ⇒ 恆為 folder 根。而**自癒是主線情境**（沒跟 agent
      講過話的 session，`--resume` 必定失敗）且**對 renderer 完全不可見** —— 使用者拿到一個能用
      的 agent，只是它站在錯的地方，沒有任何訊號。處置與既有的「繼承將死那顆 pty 的 cols／rows」
      完全同型（那一行當年也是漏掉後才補的）
- [x] 4.5 **`refreshCwd` 的 `spawnTarget !== 'shell'` 判斷維持不變**（design D4）—— claude 的 cwd
      由識別碼決定，不從 `/proc` 讀
- [x] 4.6 `src/main/session-store.test.ts`：識別碼跨重啟保存；格式不合／未知的識別碼不使載入失敗
- [x] 4.7 `src/main/terminal.test.ts`：自癒後的 cwd 仍為該工作目錄（既有那條自癒測試不看 cwd）

## 5. renderer 與續寫入口

- [x] 5.1 `SessionState` 帶上工作目錄識別碼；建立 session 的呼叫端可傳入，不傳即為 folder 根
- [x] 5.2 `continuation.ts` 的條件 4 改判準。**必須是兩段式**：
      `session 有 key ? origin.key === session.key : origin.isFolderRoot`。
      **直接比對兩個 key 是錯的** —— 開在 folder 根的 session 沒有 key，而 folder 本身是 linked
      worktree 時它的 change **有** key（`#origin` 恆填 `key`，不論 `isFolderRoot`）⇒
      `undefined === 'xxx'` ⇒ 打破「folder 本身是 linked worktree 時入口可用」那條 scenario，
      而 `probe:openspec` 已經在守它
- [x] 5.3 新入口：**呈現條件不限於「因條件 4 而停用」**（spec 明文）。停用原因有優先序，
      `noSession`／`notClaude`／`notRunning` 皆先於條件 4，而「剛開 app、還沒有任何 session」
      正是最常見的情境 —— 只在條件 4 停用時呈現的話，使用者得先在錯的地方開一個 session
- [x] 5.4 觸發後建立 claude session **並錨定該 change**。不錨定的話，新 session 成為 focused 後
      側欄落入「尚無錨定」的空狀態（衍生預設只在該 repo 恰有一個 active change 時成立），
      續寫入口連呈現的機會都沒有 —— spec 的「建立後續寫入口可用」會必然失敗
- [x] 5.5 **不一併送出續寫指示**（spec 明文）
- [x] 5.6 來源工作目錄未出現於列舉時不呈現該入口。**位於 folder 邊界外不構成不可用** ——
      邊界外照樣開得了 session，只有檔案導覽會降級
- [x] 5.7 文案進字典，`aria-label` 自字典取。**既有的 `continueBlocked.foreignWorktree` 會說謊**
      （「The session runs in this folder」—— 本 change 後 session 可能跑在另一個 worktree），
      一併改寫

## 6. 驗收

- [x] 6.1 **`probe:terminal` 的 fixture 不是 git repo**（`/tmp` 下的暫存目錄）—— 要自己 `git init`
      並建 worktree，比照 `probe-openspec.mjs` 的 `makeWorktreeFixture()`。**沒有 worktree 時 core
      回空陣列**，於是每一條「在 worktree 開 session」的斷言都會靜默地驗不到自己宣稱在驗的東西
- [x] 6.2 在 worktree 開 session，**pty 的 cwd 確實在那裡** —— 斷言走**讀檔**（`echo CWD=$(pwd) > f`
      再讀檔），不要讀畫面（回顯與執行分不清）
- [x] 6.3 邊界**外**的 worktree 也開得起來
- [x] 6.4 **shell 目標經 IPC 直接驗**（`terminal.create(folderId, 'shell', key)`）—— D1 的入口只開
      claude session，產品上沒有「在 worktree 開 shell」的 UI（Open Question 明說本 change 不做）。
      這是 IPC 層驗收，不是使用者路徑，要寫明，否則實作者會去找一個不存在的入口
- [x] 6.5 **驗收分工（實作時修正）**：`probe:terminal` 的 session 是繞過 renderer 以 IPC 建的
      （產品沒有「在 worktree 開 shell」的 UI），而持久化靠 renderer 推送 —— 它們**從不進
      `sessions.json`**，關掉再開什麼都不會重建。原本寫在那裡的「重開後仍在該 worktree」實測
      必然紅（前提不成立），已移除並在原處寫明缺口。改由：**自癒的 cwd** → `terminal.test.ts`
      的單元測試（4.7，對照組驗過）；**重建的 cwd** → `probe:openspec` 的使用者路徑段落
- [x] 6.6 反面：偽造的識別碼被拒且不產生 pty
- [x] 6.7 `probe:openspec` **成對**：session 開在該 change 的工作目錄 ⇒ 入口**可用**；開在**另一個**
      工作目錄 ⇒ **仍然停用**。少了後者，一個把條件 4 直接取消的實作會通過前者
- [x] 6.8 **既有那兩條「來源為另一個工作目錄時停用／說明原因」維持為停用，不要改寫** —— 判準變了
      但那個情境（session 跑在 folder 根、change 在 worktree）的可觀察行為不變。**改寫一條正確的
      守衛，就是把準心移開去閃避它**
- [x] 6.9 新入口的呈現與觸發（建立 session 後續寫入口變為可用）。**前置：`noSession` 也要呈現**
      （5.3），所以這一段要能在「尚無 session」的狀態下驗

## 7. 回歸與文件

- [x] 7.1 `npm run typecheck`（看 exit code）
- [x] 7.2 `npm test`
- [x] 7.3 `npm run probe:terminal`、`npm run probe:openspec`、`npm run probe:shell`
- [x] 7.4 `openspec/specs/terminal-sessions/spec.md` 的 **Purpose 段**（「初始 cwd 落在某個
      workspace folder 之內」）—— archive 只同步 requirements，Purpose 要手動改
- [x] 7.5 `CLAUDE.md`：worktree 那一節補上「session 開在 worktree」；記下**邊界保證換了形式**
      （三個前提**各自擔保不同的事** —— 查表＋git 列舉擔保圍堵性、不可逆擔保路徑不外洩、
      查無即拒絕擔保誠實性），以及**條件 4 不是變得多餘而是需要更精確的判準**這個一般形式
