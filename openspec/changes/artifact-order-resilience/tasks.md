## 1. 依賴

- [x] 1.1 `@spekjs/core` 由 `^1.6.0` 升至 **`^1.7.0`**（`sortArtifacts` 泛型化，spek #45）。
      已驗：`ChangeArtifactView[]` 進出保持型別、`relPath` 不消失、**無需任何 cast**；
      core CHANGELOG 列出的三個 source-level caveat 逐一確認對本 repo 皆不成立；
      `npm ls @spekjs/core --all` 顯示 `deduped`

## 2. 排序委由 core（spec: openspec-panel）

- [x] 2.1 `ChangeView.tsx`：**刪除** `orderArtifacts`，改為
      `sortArtifacts(data.artifacts, 'schema', data.schemaOrder)`
      （`import { sortArtifacts } from '@spekjs/core/artifact-order'` —— node-free subpath，
      與 `BrowseView.tsx` 既有的 `@spekjs/core/headings` 同一條路）
- [x] 2.2 **模式固定為 `'schema'`**，不接出使用者偏好（design D1 的裁決；日後要放寬很便宜）
- [x] 2.3 確認 `fallbackId`（預設停在 tasks）與分頁的 `key` 不受順序改變影響 —— 兩者都以
      `artifact.id`／`kind` 定位，與位置無關，但要親眼確認而不是推論
- [x] 2.4 **不得**在本 repo 出現任何 `DEFAULT_ORDER` / `defaultRank` 的排序運算 —— spec 明文要求不
      自行實作該規則。`grep -rn "defaultRank\|DEFAULT_ORDER" src/` 應只在（若有）註解中出現

## 3. 退路提示（spec: openspec-panel）

- [x] 3.1 `src/shared/i18n/en.json` 新增兩條文案，沿用上游 spek web 的措辭：
      archived → `Schema order isn't tracked for archived changes — showing default order.`；
      其餘 → `Schema order unavailable — showing default spec-driven order.`
- [x] 3.2 `ChangeView.tsx`：`schemaOrder` 為 undefined 或空陣列時，於分頁列附近呈現對應的一句。
      判準以 `data.status === 'archived'` 二分（design D2）
- [x] 3.3 **權威順序可用時不呈現** 〔scenario「權威順序可用時不呈現說明」〕。
      這條是三條裡唯一擋得住「一律顯示」那種實作的
- [x] 3.4 文案取用一律經 `t(...)`，**不得硬編**（`copy-language` 與 `aria-label-source` 兩道守衛）

## 4. 主行程取得使用者 PATH（spec: desktop-packaging）

- [x] 4.1 新增 `src/main/user-path.ts`，導出兩個**純函式**與一個啟動入口：
      `mergeUserPath(current, user)`、`parsePathOutput(stdout)`、`startUserPathResolution()`
- [x] 4.2 `mergeUserPath` —— **使用者路徑前置**，既有項目一個不移除，重複項只留前面那個
      〔scenario「使用者的路徑前置而非附加」〕
- [x] 4.3 取得方式 `$SHELL -i -l -c 'printf "@@%s@@" "$PATH"'`。**`-i` 是承重的**（非互動不 source
      `.zshrc`，而 nvm 正是在那裡初始化）
- [x] 4.4 **shell 白名單**：只對 basename 為 `sh` / `bash` / `zsh` / `ksh` 者執行，其餘 resolve
      `null`。`fish` 的 `$PATH` 是 list，同一個 `printf` 會印成 `@@/a@@@@/b@@…`，「取標記之間」
      只拿得到第一個目錄 —— **無錯誤、只是路徑少掉大半**
      〔scenario「無法安全查詢的 shell 一律放棄」〕
- [x] 4.5 `parsePathOutput` 取**最後一組** `@@…@@` 之間的內容（互動 rc 印東西到 stdout 是常態，
      噪音裡也可能含 `@@`）；無標記回 `null`
- [x] 4.6 **stderr 以 `stdio: 'ignore'` 丟棄**，不是接一條沒人 drain 的 pipe —— 實測本機 zsh 在非
      tty 下噴十行以上 gitstatus 錯誤，pipe 滿了會讓子行程卡到逾時
- [x] 4.7 逾時 **5 秒**（1.3 秒是熱的量測，冷啟動更慢），逾時／非零／解析失敗一律 resolve `null`；
      **逾時必須 `child.kill()`**〔scenario「取得失敗不致使功能失效」〕
- [x] 4.8 `process.platform === 'win32'` 直接 resolve `null`（design D6）
- [x] 4.9 失敗時 `console.warn` 一行，**英文**、不進字典（不是使用者可見文案）
- [x] 4.10 `src/main/index.ts` 於 `whenReady` **早期**呼叫 `startUserPathResolution()`，並**在它的
      `.then()` 裡套用一次** `process.env.PATH`。**不在任何功能的使用點套用**（design D5）
      〔scenario：spec 中「套用 SHALL 只發生在單一、確定的時點」那一條〕
- [x] 4.11 `OpenSpecService.getChange()` 於呼叫 `readChange` 前 `await` 同一個 Promise（僅時序對齊，
      不負責套用）

## 5. 驗收 —— 排序與提示（probe:openspec）

- [x] 5.1 `repo-archived-only` 的 archived change 補上 `design.md` 與 `tasks.md`，使其有四個
      artifact。**先確認這不會動到既有斷言**：該 fixture 目前被「只有 archived change 的 repo」
      那一段使用，改動前後都要跑一次那一段（②「先修選擇器 → 確認既有全綠 → 再改 fixture」的同一條
      紀律）
- [x] 5.2 以 `fs.utimesSync` 明確把該 change 的檔案 mtime 設成**反序**（proposal 最舊、tasks 最新）。
      **specs 那一項要對 `specs/<topic>/spec.md` 這個檔案下手，不是對 `specs/` 目錄** ——
      core 的 `specsMtime()` 取的是 delta 檔案的最大 mtime，對目錄設定完全無效
- [x] 5.3 **寫出錨定 archived change 的路徑** —— 既有的 `anchorChange()` 只在 `CHANGE_TREE_ROWS('Active')`
      裡找 slug，用不了 archived。需先展開 Archived 群組（`ACTIVATE_TREE_ROW('Archived')`）再選該
      change，並等 `ANCHORED_SLUG`
- [x] 5.4 斷言該 archived change 的分頁順序為 proposal、design、specs、tasks
      〔scenario「已封存的 change 亦依敘事順序」〕。**這條天然走退路** —— core 對 archived 一律不查
      CLI，因此不需要為了製造「openspec 不可用」而操弄 probe 的環境
- [x] 5.5 `repo-single` 的 `solo-change` 段落補一條順序斷言，斷言為 **proposal、specs、tasks**
      —— 該 fixture **只有三個 artifact，沒有 design**（`probe-openspec.mjs:141-144`）。
      **不要為此補一個 `design.md`**：補了它 `missingArtifacts` 會變空，續寫入口整個消失，
      `probe-openspec.mjs` 那兩條「focused session 為 shell 時入口停用」的斷言會靜默落空
- [x] 5.6 **5.5 明寫「回歸用，不覆蓋〔分頁順序依 schema〕」**。它對「CLI 可用」與「CLI 不可用」兩種
      情況都會通過（spec-driven 的權威順序恰等於敘事順序），因此不具鑑別力。該 scenario 的載體是
      6.5 的人工驗收
- [x] 5.7 提示的斷言：archived 顯示「未被追蹤」那句〔scenario 1〕。以文案（來自字典）定位，
      不掛 `data-*`。
      **scenario 3（權威順序可用時不呈現）刻意不在探針驗** —— 載體改為 6.7 的單元測試。
      實測：`schemaOrder` 由 core spawn `openspec` 取得，而 core 對結果（**含 `null`**）有 30 秒
      TTL 快取，於是 app 啟動早期一次暫時性失敗會讓同一個 repo 在半分鐘內持續拿到 `null`。
      同一份程式碼、同一輪執行，**build 模式紅而 dev 模式綠**。已回報 upstream（spek #46）。
      〔scenario 2（active 且不可用）同樣改由 6.7 承擔 —— 探針無法穩定製造那個狀態〕
- [x] 5.8 **對照組**：把 2.1 退回原本的「`schemaOrder` 不可用就原樣回傳」，確認 5.4 變紅；
      把 `fallbackReason` 的第一條判斷（權威可用回 `null`）拿掉，確認 6.7 的第一條測試變紅

## 6. 驗收 —— 使用者 PATH（spec: desktop-packaging）

- [x] 6.1 新增 `src/main/user-path.test.ts`
- [x] 6.2 `mergeUserPath`：前置、既有全數保留、重複不重出〔scenario「使用者的路徑前置而非附加」〕
- [x] 6.3 `parsePathOutput`：前後含噪音時仍取出最後一組標記之間的內容；無標記回 `null`；
      **噪音中含 `@@` 時仍正確**
- [x] 6.4 shell 白名單：`fish` 等未知 shell 回 `null` 且不執行任何子行程
      〔scenario「無法安全查詢的 shell 一律放棄」〕
- [ ] 6.5 **人工驗收（dogfood）**：`npm run dist:linux` 後**自應用程式選單／檔案管理員**啟動
      AppImage（**不可自終端機**：那樣 PATH 天生完整，機制失效也照樣通過），開一個**進行中**的
      change，**不應出現任何退路說明**。
      **判準是「說明的有無」，不是排列順序**（design D7）—— 原本寫的「schema 順序 ≠ 敘事順序的
      repo」查證後**造不出來**：`openspec` 只有 `spec-driven` 與 `workspace-planning` 兩個內建
      schema，兩者的 `planningArtifacts` 都等於敘事順序，且 CLI 無自訂 schema 的機制。
      **用本 repo 自己就可以驗**，不需要 scratch repo。
      判讀請在啟動**約一分鐘後** —— core 對「取不到」也快取 30 秒（spek #46），啟動早期的第一次
      讀取可能落在 PATH 補好之前。機制真的沒生效時那句說明會**持續存在**
- [ ] 6.6 scenario「主行程解析得到只由互動 rc 提供的可執行檔」**不覆蓋於自動化**，載體為 6.5。
      spec 明文要求不得以自終端機啟動的執行替代
- [x] 6.7 新增 `src/renderer/src/shell/openspec/schema-order.test.ts`：`fallbackReason` 的判斷
      〔scenario「權威順序可用時不呈現說明」「進行中的 change 取不到順序時說明退路」
      「已封存的 change 說明順序未被追蹤」〕。**這是前兩條 scenario 的載體**（見 5.7 的理由）。
      含一條優先序測試：archived 若真的取得順序也不說話 —— 今天走不到，但釘住「權威優先於狀態」

## 7. 追蹤已知缺口

- [x] 7.1 開一個 GitHub issue：「agent CLI 目標以非互動 shell 執行，安裝於 nvm 之下的 `claude` 於
      桌面環境啟動時解析不到」。內容含 `zsh -l -c 'command -v openspec'` 與真 pty 下 `zsh -l` 的
      對照實測、以及退路（改為互動 shell 會把互動 rc 的副作用帶進每個 agent session）
- [x] 7.2 把編號回填 `specs/desktop-packaging/spec.md` 的 `issue #TBD`。
      **未回填即不得封存** —— 一個 `#TBD` 等於「已知但沒有人在追」

## 8. 文件

- [x] 8.1 `docs/lessons/side-panel.md`：artifact 順序的權威來自 `openspec` CLI 的 spawn，
      **archived change 一律拿不到**；排序規則**委由 `sortArtifacts`，本 repo 不自寫**
- [x] 8.2 `docs/lessons/terminal.md`：`$SHELL -l` 掛在 pty 上是互動 shell、而 `-l -c` 不是 ——
      兩個 spawn 目標的涵蓋範圍不同；以及 PATH 前置 vs 附加的失效方式（附加時「找得到但跑不起來」
      與「沒安裝」無法區分）
- [x] 8.3 CLAUDE.md **不新增章節** —— 上面兩條都有明確觸發器（動側欄／動 pty），依 CLAUDE.md 開頭
      的判準屬於 `docs/lessons/`

## 9. 收尾

- [ ] 9.1 `npm run typecheck` 與 `npm run lint`（**不要跑 prettier**）
- [ ] 9.2 `npm test`
- [ ] 9.3 `npm run probe:openspec`
- [ ] 9.4 `npm run test:e2e` 全套。**已知有 7 條 dev 模式的既有紅燈（issue #19）與 port 殭屍造成的
      假紅（issue #18）** —— 判讀時先與那兩張票對照，不要當成本 change 的迴歸
