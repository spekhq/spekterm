## 1. 純函式（主行程，不 import electron）

- [x] 1.1 `src/main/report-runner.ts` 新增 `delegateEnv({ processEnv, userEnv, configDir })`
      —— 三個輸入皆由呼叫端注入、**無預設值**；`configDir` 型別為 `string | undefined`。
      白名單內容依 design D2。**docstring 明寫「呼叫端傳 `process.env` 本身，不可展開」**
      （Windows 的大小寫不敏感代理）。驗證 `npm run typecheck` 通過
- [x] 1.2 `PATH` 取 `processEnv.PATH`，**不是** `userEnv.PATH` —— 後者結構上恆為 undefined
      （`user-env.ts:176`）。原始碼註明理由（`process.env.PATH` 是使用者路徑前置後的超集）
- [x] 1.3 白名單的每一項各有一句理由，**且明寫刻意不在上面的四類**：憑證與計費歸屬那二十餘個、
      `SHELL`（唯一生效處是 `apiKeyHelper`＝憑證路徑，實測不需要）、`TERM`、
      `XDG_CONFIG_HOME`（**排除它不提供保護**，只是委派不需要它）、`NODE_OPTIONS`。
      驗證 `npm run lint` 通過
- [x] 1.4 `src/main/insights-source.ts` 新增 `explicitConfigDir(env): string | undefined`
      —— 與 `resolveConfigDir()` 同一組來源、同一優先序，只是未指定時回 `undefined`；
      `resolveConfigDir()` 改以它實作（單一來源）。驗證既有的
      `insights-source.test.ts` 仍全綠

## 2. 委派紀錄的刪除（design D7）

- [x] 2.1 `src/main/report.ts` 的 `deleteDelegateRecord` 改為**以委派專案目錄為單位**刪除，
      不再依賴 `sessionId`；保留既有紀律「刪完回頭確認目錄真的不含紀錄，不只看有沒有拋錯」
- [x] 2.2 `generate()` 的失敗路徑（`report.ts:177` 的早退）改為**先刪除再回傳** ——
      認證失敗、逾時、回覆無法解析都留下了一份完整語料副本
- [x] 2.3 單元測試：委派以 `delegateFailed` / `delegateTimeout` / `unparsableReply` 結束時，
      委派專案目錄下的紀錄檔不存在。**對照組**：把 2.2 的刪除拿掉，確認它變紅
- [x] 2.4 既有的 `report.test.ts:305`（刪除成功）與 `:440`（刪不掉時據實記錄）仍全綠 ——
      後者靠「委派 cwd 算錯」製造失敗，改為目錄單位後該機制仍成立，**要確認它沒有變成恆綠**

## 3. 單次解析與接線（design D3／D4）

- [x] 3.1 `ReportDeps` 的 `spawn` 改為收一個參數（`{ configDir: string | undefined }`），
      `ReportRunner` 相應轉手。驗證 `npm run typecheck` 通過
- [x] 3.2 `report.ts` 的 `generate()` **解析一次**：`explicit = deps.explicitConfigDir()`，
      刪除用 `explicit ?? 預設`，`spawn` 收 `explicit`。兩邊分歧在結構上表達不出來
- [x] 3.3 `src/main/ipc/insights.ts` 的 `spawnReportDelegate` 收下 `configDir`，
      `env` 改為呼叫 `delegateEnv(...)`；移除 `{ ...process.env, ...userEnv, PATH }`
- [x] 3.4 更新 `spawnReportDelegate` 的 docstring —— **第 4 點目前是錯的**
      （宣稱 `PATH` 取自 `getUserEnv()`，而那份結構上沒有 `PATH`）
- [x] 3.5 `src/main/index.ts` 接上 `explicitConfigDir`，且 `configDir` **在 `spawn` 的 closure
      之內求值**（寫在物件字面值上會在 `whenReady` 當下快照，那時 `getUserEnv()` 還是空的）

## 4. 單元測試與對照組（這條規格唯一的載體）

- [x] 4.1 `report.test.ts` 新增 `delegateEnv` 段落：**斷言輸出的鍵集合等於一個字面陣列**
      （`Object.keys(...).sort()` 的 `deepEqual`）。**不可寫成 `[...WHITELIST, …]` 從實作
      import** —— 那是「兩端讀同一個常數」，往白名單加一個憑證名字照樣全綠
- [x] 4.2 注入集合要涵蓋三類，缺一則對應的 scenario 沒有被驗到：
      **(a) 已知憑證** `ANTHROPIC_API_KEY` / `_AUTH_TOKEN` / `_BASE_URL` / `_PROFILE` /
      `CLAUDE_CODE_USE_BEDROCK`；
      **(b) 巢狀標記** `CLAUDECODE` / `CLAUDE_CODE_CHILD_SESSION` / `CLAUDE_CODE_MESSAGING_SOCKET` /
      `_TOKEN` / `CLAUDE_CODE_SESSION_ID` / `CLAUDE_CODE_EXECPATH` / `CLAUDE_PID`；
      **(c) 兩份清單都沒有的** `TERM` / `XDG_CONFIG_HOME` / `NODE_OPTIONS`
      ＋**至少一個發明出來的名字**（「今天還不存在的名字」只有發明一個才驗得到）。
      `processEnv` 與 `userEnv` 兩邊都放（兩條路徑分別驗）
- [x] 4.3 斷言 `HOME`、`PATH` **有**被帶進去，且 `PATH` 取的是 `processEnv` 那一份
- [x] 4.4 斷言 `CLAUDE_CODE_OAUTH_TOKEN` **有**被帶進去（訂閱憑證，見 design D1／D2）
- [x] 4.5 設定目錄兩條：`configDir` 為 `undefined` 時輸出**不含** `CLAUDE_CONFIG_DIR`；
      給值時等於該值，且 `processEnv` / `userEnv` 裡不同的 `CLAUDE_CONFIG_DIR` **不會勝出**
- [x] 4.6 **服務層**斷言（不是純函式層）：`fakeDelegate` 記下它收到的 `configDir`，
      斷言等於 `bed()` 注入的那一份。**沒有這條，3.1–3.5 的接線一個斷言都沒有**，
      而 `index.ts` import electron、單元測試進不去
- [x] 4.7 **三組對照組，逐組記下實際結果**（design D5 的表）。**實際跑過，結果如下**：
      (a) 全展開 → 紅 4 條（鍵集合／憑證／巢狀標記／兩份清單都沒有的）＋「未指定設定目錄時
      不傳入任何值」也紅（環境裡的值會漏進去），共 5 條；4.3／4.4 如預期**不紅**。
      (b) 白名單移除 `HOME` → 「委派仍取得執行所需的環境」紅（＋鍵集合紅）。
      (c) 換成剝除清單 → **鍵集合紅**＋「兩份清單都沒有的名字」紅 —— **D1 的載體確實有鑑別力**
      （憑證與巢狀那兩條在 (c) 下是綠的，正是為什麼需要 (c)）。
      另外 2.3 的失敗路徑刪除也單獨驗過對照組（把刪除移回早退之後 → 紅），
      6.1 的探針斷言也驗過（拿掉那個 `<p>` 重新 build → 33/34）
- [x] 4.8 `ReportDeps` 加一個 `maxChars` 旋鈕（轉手給 `report-corpus`），使 `bed()` 造得出
      「語料超過上限」。既有的 `report.test.ts:347`（授權數字＝實際送出的那一份）
      **在 `truncated === true` 的前提下重跑一次** —— 它目前比的是 `false === false`，
      而該 scenario 的 WHEN 正是「超過上限」

## 5. 介面與文案

- [x] 5.1 `src/shared/i18n/en.json` 新增 `insights.report.authorize.identity`
      —— 委派以使用者自己的 `claude` 登入執行，shell 環境中的**憑證**不會被使用。
      **措辭用「憑證」不用「端點設定」**（proxy 是會轉送的，與 spec 的區分一致）
- [x] 5.2 改寫 `insights.report.error.delegateFailed` —— 現行文案只指向「尚未登入」，
      對憑證只存在於 shell 環境的使用者是誤導（他在終端機跑得起來）。
      新文案要同時涵蓋兩種情況
- [x] 5.3 `ReportTab.tsx` 的授權對話框在 `blurb` 之後渲染 `identity`。驗證 `npm test` 的
      三道 i18n 守衛（copy-language / aria-label-source / i18n-key-safety）全綠

## 6. 驗收

- [x] 6.1 `scripts/probe-insights.mjs` 的授權畫面段落加一條斷言：`dialog.dialogText` 含
      `copy('insights.report.authorize.identity')`。驗證 `PROBE_ONLY` 單段跑得過
- [x] 6.2 逐條核對下表 —— 標「既有」的每一列都要**開檔案讀到那一行的字串**，
      且要問「它驗的是不是這條 scenario 說的事」（前一版有兩列答錯）

| Scenario | 載體 | 狀態 |
|---|---|---|
| 環境中的憑證變數不進入委派 | `report.test.ts` §`delegateEnv`（4.2a） | 新增 |
| 白名單與剝除清單皆未涵蓋的變數也不進入委派 | 同上（4.2c ＋ 對照組 4.7c） | 新增 |
| 委派仍取得執行所需的環境 | 同上（4.3 ＋ 對照組 4.7b） | 新增 |
| 使用者自身訂閱登入的 token 仍然可用 | 同上（4.4） | 新增 |
| 隸屬於某個 Claude Code session 的標記不進入委派 | 同上（4.2b） | 新增 |
| 使用者未指定設定目錄時不傳入任何值 | `report.test.ts`（4.5 前半） | 新增 |
| 使用者明確指定時傳入該值 | `report.test.ts`（4.5 後半）＋**服務層**（4.6） | 新增 |
| 委派失敗後同樣不留下對話紀錄 | `report.test.ts`（2.3） | 新增 |
| 授權畫面說明委派以什麼身分執行 | `probe-insights.mjs` 授權段落（6.1） | 新增 |
| 委派失敗的訊息不只指向尚未登入 | **無自動化載體** —— 文案內容的正確性由人擔保，它就印在畫面上（CLAUDE.md 既有立場）。由 6.4 的 dogfood 目視 | 無載體 |
| 授權畫面的數字為截斷後的數字 | `report.test.ts:347`，**但需 4.8 補上 `maxChars` 旋鈕才具鑑別力** —— 現行版本比的是 `false === false` | 既有但假綠，本 change 修 |
| 未授權則不送出 | `report.test.ts:261`（`code: 'notAuthorized'` ＋報告清單為空）。**前一版指向 `probe-insights.mjs:606`，那條只驗對話框關了** | 既有（已讀，已更正） |
| 委派不讀取 repo | `report.test.ts:364` 的 `--allowed-tools ''`（工具）＋`:369` 的「跨兩端的等式」（cwd） | 既有（已讀，兩半都指名） |
| 委派結束後不留下對話紀錄 | `report.test.ts:305` `3.9 委派留下的紀錄被刪除，且結果記進報告` | 既有（已讀） |
| 刪除失敗被記錄且可見 | `report.test.ts:440` `委派紀錄刪不掉時據實記錄` | 既有（已讀，見 2.4） |
| 授權畫面說明送出的範圍 | `probe-insights.mjs:589–595` | 既有（已讀） |
| 授權畫面不是全文檢視器 | `probe-insights.mjs:597–602` | 既有（已讀） |

- [x] 6.3 `npm run test:all` 全綠。**已跑**：單元 898/898；`test:e2e` **11/11 全部通過**，
      四支帶段落資訊的皆標示「完整執行」（keyboard／insights／agent-view／openspec），
      terminal 284/284
- [x] 6.4a **「巢狀標記會不會讓 `-p` 不寫紀錄」已直接實測，不必再靠 dogfood 推論**
      （2026-09-06、`claude` 2.1.263）。以不存在的模型跑兩趟 `-p`（`total_cost_usd: 0`，
      不計費），一趟帶著 `CLAUDE_CODE_CHILD_SESSION`、一趟 `env -u` 剝除：
      **兩趟都寫下了紀錄**（221,740 / 221,758 bytes）。
      **原本的因果宣稱因此被推翻** —— `terminal.md` 那個二分實測的對象是掛在 pty 上的
      互動式 claude，我把它外推到 `-p` 上了。design 與 spec 已改寫：剝除的理由只剩白名單
      本身與「通往父 session 的通訊管道」，兩者都夠，但不能用一個沒發生的後果去論證。
      兩份實驗紀錄已刪除
- [x] 6.4b **dogfood 真實委派已執行**（2026-09-06 22:09，dev、`claude-sonnet-5`，自一個帶有
      `CLAUDE_CODE_CHILD_SESSION=1` 的 Claude Code session 之內啟動）。語料 4,071 則 /
      175,151 字元 / 29 個專案，US$0.74，20 條論斷、丟棄 0 條。五項全數符合：
      (1) 報告產得出來；
      (2) `delegateRecordDeleted: true`，且**委派的整個專案目錄已不存在** ——
      委派中途實測那裡留著一份 **9.99 MB** 的紀錄，目錄單位的刪除把它清掉了；
      (3) **`~/.claude/.claude.json` 沒有被建出來**，`~/.claude.json` 仍是唯一的主設定檔
      （design D3 那個缺陷的直接觀測，修正生效）；
      (4) 授權畫面的身分說明在畫面上；
      (5) 新的 `delegateFailed` 文案已在字典中目視（這一趟沒有失敗，無法在畫面上觸發）

## 7. 文件

- [x] 7.1 `docs/lessons/transcript.md` 的委派章節增加：委派的環境是白名單、官方認證優先序
      （訂閱 OAuth 排最後、`-p` 不詢問、`CLAUDE_CODE_OAUTH_TOKEN` 是訂閱憑證的例外）、
      `process.env` 在 Claude Code session 裡實測含有的 11 個變數、
      **以及 `CLAUDE_CONFIG_DIR` 設與不設時主設定檔位置不同的實測**。附實測日期與 CLI 版本
- [x] 7.2 同一份文件 `:174`「不能用 `CLAUDE_CONFIG_DIR` 把它整個導去別處」那一行要補充 ——
      這個 change 之後程式碼會在明確指定時設它，`grep` 到那一行的下一個人會看到
      「程式碼在設、文件說不准設」
- [x] 7.3 CLAUDE.md 的踩雷指南把 `src/main/report.ts` 寫進觸發器（現行的 `src/main/report-*`
      因為沒有連字號而命中不了它，目前靠同列的「或委派 `claude` CLI 的東西」兜底）
- [x] 7.4 **已開為 issue #38**：`terminal.ts` 的 `NESTED_CLAUDE_ENV` 只有 7 個名字，涵蓋實測 11 個裡的
      5 個 —— `CLAUDE_CODE_MESSAGING_SOCKET` / `_TOKEN`（通往父 session 的通道）、
      `_EXECPATH`、`CLAUDE_PID`、`CLAUDE_EFFORT`、`CLAUDE_CODE_NO_FLICKER` 今天照樣流進每個 pty。
      **本 change 不做**（Non-Goals：不動 pty 環境）
