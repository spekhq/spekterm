> **本 change 交付後，#19／#21／#22 的 dev 紅燈仍然是紅的。** 那是 Non-Goal，不是缺口 ——
> 本 change 交付的是**採到證據**的能力，驗收條款見 §7。
>
> **產品程式碼零改動**：`src/` 一個字都不動，因此回歸基準是「build 模式的斷言總數與通過數不變」。

## 1. debugging port 的單一來源與守衛

> 現況（已核實）：`shell` 9222、`workspace` 9223、`files` 9224/9225、**`identity` 9225 與 9226**
> （`:135` 用 `DEBUG_PORT`、`:169` 用 `DEBUG_PORT + 1`）、`terminal` 9226/9227、
> `openspec` 9228/9229、`keyboard` 9234/9235、`package` 9240。`core` 與 `native` 不經 CDP。
>
> **`probe-identity` 同時撞到兩支**：9225 是 `files` 的 dev port，9226 是 `terminal` 的 build
> port。`docs/lessons/probes.md:429-437` 早已記載此事。

- [x] 1.1 新增 `scripts/lib/ports.mjs`：**探針名 → 一組具名的 port**。一對一的形狀放不下
      `identity` 的第二個 port，而放不下就等於守衛看不見、前置檢查不檢查 —— **一份漏掉一半的表
      比沒有表更糟**
- [x] 1.2 `probe-identity` 的兩個 port 改為 **9221（`default`）與 9231（`xdgHome`），各自明寫**
      （不得保留 `+ 1` 的寫法）。**刻意不相鄰** —— 取 9221/9222 的話，下一個人再寫一次 `+1`
      就撞上 `probe-shell`
- [x] 1.3 `ports.mjs` 加註解擋住「順手補齊 `core` / `native`」的直覺：**`probe-core` 的驗收內容
      之一就是「主行程不開任何 TCP 埠」**，給它一個 debugging port 會讓它依設計失敗。
      另加一條測試釘住 `portsOf('core')` / `portsOf('native')` 為空
- [x] 1.4 八支探針改為自 `ports.mjs` 取用，移除各自的數字字面（區域別名保留，值取自表）
- [x] 1.5 新增 `scripts/ports.test.mjs`，**三條**判準（走語法樹，形狀比照 `wait-source.test.mjs`）：
      （a）攤平後不得有重複；（b）探針裡不得有 port 的數字字面；（c）不得對表的成員做算術。
      > **實作時修正了原本的判準。** 原訂「`--remote-debugging-port=` 的插值必須是對表的直接成員
      > 存取」**會誤判五支探針** —— `files`／`identity`／`terminal`／`openspec`／`keyboard` 都把
      > port 當參數傳進 `launch()`，插值處是參數名。已回頭更新 design D2
- [x] 1.6 對照組五個（全部在 `ports.test.mjs` 內，以 fixture 餵）：本地數字字面常數 → (b) 紅；
      `PROBE_PORTS.identity.default + 1` → (c) 紅；數字直接寫進旗標 → (b) 紅；
      **取自表且以參數轉手 → 綠**（這一條擋的是上面那個誤判）；與 port 無關的算術 → 綠。
      **另以 `git show HEAD` 的八支舊碼跑一次真實對照**：判準二報 12 處、判準三報 0 處
      （當時的算術是對本地常數做的 —— 兩條判準的定義域已寫進守衛檔頭）

## 2. 執行前置條件的檢查

- [x] 2.1 新增 `scripts/lib/preflight.mjs`，兩個檢查各自獨立、各自的訊息：
  - `ensureBuildArtifacts(name)` —— 檢查 `out/main/index.js` 與 `out/renderer/index.html`；
    `native` / `package` 豁免（**沿用 `run-probe.mjs` 既有的 `NO_BUILD` 名單，不要複製第二份**）
  - `ensurePortsFree(ports, options)` —— 判定用 `net.connect('127.0.0.1', port)`
- [x] 2.2 **socket 要設 timeout 並在每條路徑上 `destroy()`。** 失效方向分析見 design D3：唯一的
      壞方向是「listener 在但 accept queue 滿」⇒ `connect` 一直不返回。少了這一步，一個為了取代
      30 秒神秘逾時而做的檢查，自己變成一次無界的 hang（`pollFor` 攔不住 —— 它等的是 `read()` 返回）
- [x] 2.3 被佔用時經 `pollFor` 短暫退避重試，窗口耗盡才失敗；**退避窗口與持有者查詢都要留注入
      接縫**（`options`）—— 否則 2.7 的兩條測試要嘛燒掉數秒真實時間（`npm test` 現在全部只要
      約 15 秒），要嘛驗不到出貨的預設值
- [x] 2.4 佔用者的辨識走 `ss -tlnp`，**取不到時降級為「被佔用，但查不出持有者」**；失敗訊息要
      載明**已等待多久仍被佔用** —— 沒有那個數字，讀的人無法判斷該調退避窗口還是去清行程
- [x] 2.5 `scripts/run-probe.mjs` 在 `buildIfNeeded()` 之後依序呼叫兩個檢查（該處已經在處理
      `PROBE_SKIP_BUILD` 與 `SPEKTERM_PROBE_BUILT` 兩個「你自己負責產物是新的」的旁路，
      **而那兩個旁路正是產物可能不存在的來源**）
- [x] 2.6 `scripts/lib/cdp.mjs` 的 `waitForPageTarget` 逾時訊息**再查一次持有者**（約五行）——
      前置檢查有 TOCTOU 缺口（通過之後 port 才被搶走），這一步涵蓋它結構上涵蓋不到的每一種情形
- [x] 2.7 新增 `scripts/preflight.test.mjs`：產物不存在→失敗且訊息含建置指示；產物存在→通過
      （對照組）；`NO_BUILD` 名單的探針豁免產物檢查；以 `net.createServer` 佔住一個 port→失敗且
      訊息含 port 與已等待時間；退避窗口內釋放→通過；注入不可用的 lookup→**仍判定為被佔用**
- [x] 2.8 **可區分性要有自動判準，不能只靠人看**：斷言兩種失敗訊息不相等，且**各自含自己的處置
      token**（一個含 `npm run build`、一個含 port 號與等待時間）。少了這條，日後有人給兩者加上
      共同的泛用前綴時，不會有任何東西變紅 —— 而「兩種前置失敗長得一模一樣」正是 issue #23 的全部內容
- [x] 2.9 確認缺 xvfb 那條既有訊息不被新訊息淹掉（三種前置失敗互相可區分）

## 3. 讀取失手不再中止整支探針

> 清點推翻了 issue #6 的範圍：`readTerminalText` 有**六個**呼叫站點
> （`:969`、`:1647`、`:1894`、`:2289`、`:2311`、`:2493`），其中**三處是裸呼叫**（連輪詢都沒有）。
> 而 `pollTerminalText`（`:963`）**早就傳了 `tolerateErrors`**。同一個讀取，三種呼叫姿態。

- [x] 3.1 於 `scripts/lib/instrument.mjs` 新增重試入口（`pollFor` + `settled` 恆真 +
      `tolerateErrors: true`）—— 它是**唯一可被單元測試注入的接縫**，`readTerminalText` 依賴
      probe-terminal 的表達式常數與真滑鼠序列，搬不動也不該搬
- [x] 3.2 `readTerminalText` 拆成「一次擷取」的內部函式 + 走 3.1 的外層入口；**六個呼叫站點一處
      都不必改**
- [x] 3.3 **加嘗試之間的重置。** 失敗時右鍵選單**可能是開著的**，下一次嘗試的拖曳就從一個蓋著選單
      的畫面開始 ⇒ 重試可能**必然失敗**；而 `MENU_ITEM_RECT` 回 `null` 時 `realClick(null)` 拋的是
      **`TypeError`，不是那個帶診斷訊息的哨兵**。先例在同一個檔案裡：`openTabMenu`（`:766-778`）
      每次嘗試重新量測、N 次後拋具名錯誤
- [x] 3.4 內層窗口取數秒量級（約兩三次嘗試）—— 一次擷取約 0.5–1 秒，而外層 `pollTerminalText`
      的窗口是 10 秒；兩層相乘會把一次失手的代價從「多半秒」放大成「多十秒」
- [x] 3.5 `pollTerminalText` 的 `tolerateErrors` 成為第二道，**保留並在註解寫明**（移除等於把語意
      押在「內層永遠會容忍」這個沒有守衛的假設上）
- [x] 3.6 `scripts/cdp.test.mjs` 補 3.1 入口的測試：注入「前 N 次 throw、之後成功」→重試到成功；
      注入「永遠 throw」→**逾時後仍然拋出，且拋的是最後一次那個例外本身**（控制組要斷言**拋出來
      的是哨兵**，不只是「有東西被拋出來」—— 見 3.3，形態變質正是這裡的失效方式）
- [x] 3.7 `pollUntil` **不動**，在該函式的註解寫明界線：它的 `read` 是 `client.evaluate`，拋錯的
      典型原因是 CDP 斷線或 renderer 不在了，容忍它只會把「app 已死」變成等滿整個窗口

## 4. renderer 的 console 收集

- [x] 4.1 `scripts/lib/cdp.mjs` 的 `connect()` 之後送 `Runtime.enable` 與 `Log.enable`，在 ws 上掛
      常駐 listener 收 `Runtime.consoleAPICalled`（error／warning）、`Runtime.exceptionThrown`、
      `Log.entryAdded`（error）—— 現況 `send()` 的 handler 只認得帶 `id` 的回應（`cdp.mjs:56`），
      **事件訊息被直接忽略**
- [x] 4.2 **緩衝放在 `scripts/lib/instrument.mjs`，由 `cdp.mjs` 推入。** 不能放 `cdp.mjs`：
      `sections.mjs` 只 import `instrument.mjs`，而 `instrument.mjs` 的檔頭（`:4-8`）明文說明它
      為什麼保持與 CDP 無關（`probe-native` 要在沒有 CDP 的情況下用 `check()`）
- [x] 4.3 每筆記錄**發生當下的段落 token**（`sectionToken()`，與 CDP 往返計時同一機制）；環形緩衝，
      每段保留最近數筆
- [x] 4.4 `scripts/lib/sections.mjs` 於段落結束時，**該段落若有失敗的斷言、例外或逾時**才輸出；
      沒有失敗**不輸出該欄位**（與窗口耗盡累計同一條紀律）
- [x] 4.5 **已實測，而且推翻了原本的推論。** 以「ws 連上但先不 enable → `Runtime.evaluate` 發出
      訊息 → 才 enable」模擬 attach 之前的窗口，結果：`Runtime.consoleAPICalled` 與
      `Log.entryAdded` **都重播了**（含一則 console.error 與兩則 CSP 錯誤）。Chromium 兩個 domain
      都會緩衝。結論寫進 `lib/cdp.mjs` 的 `subscribeConsole` 檔頭與 design D6 —— **這個性質是承重
      的**：日後 Electron 升版若改掉它，症狀是「採不到早期訊息」而不是任何一條紅燈
- [x] 4.6 `scripts/sections.test.mjs` 補測試：有失敗時輸出、全過時不輸出（對照組）、逾時段落的
      殘留訊息不計入下一段
- [x] 4.7 `scripts/probe-keyboard.mjs` 加一條斷言驗「對真 renderer 有效」：**標的必須是 connect
      之前就發出的訊息**（由 renderer 模組作用域產生的既有訊息，或 4.5 證實可行的等價物）。
      **不可用「探針自己在 connect 之後 `console.error` 一個標記」** —— 那條無論捕捉窗口有沒有涵蓋
      都會通過，是一盞測不到自己宣稱在測的東西的綠燈。若 4.5 證實拿不到，改為斷言「connect 之後
      的訊息可被捕捉」並**把限制寫進 spec**
- [x] 4.8 選 `probe:keyboard` 而非 `probe:shell`：出貨的讀取路徑是「`sections.mjs` 於段落結束時
      印出」，而 **`probe-shell` 沒有段落機制**（只有 keyboard／terminal／openspec import
      `sections.mjs`），在它裡面只能驗一個沒有人在用的存取器

## 5. `MOUNTED` 的診斷欄位與 detail 的實作缺口

- [x] 5.1 `scripts/lib/mounted.mjs` 區分兩類欄位：**參與判定的子條件**與**只帶回不判定的診斷值**。
      加入 `document.readyState` 與 **`#root` 的子節點數量**（現況 `:36` 把每個欄位 `Boolean(...)`
      掉了，數量拿不到）。**兩者都不得參與 `ok`** —— `readyState === 'complete'` 不是掛載的必要
      條件，把它加進判定會改變那七條紅的判定本身，污染 #19 的對照
- [x] 5.2 `describeMounted` 把診斷值附在訊息尾端；**既有 `cdp.test.mjs` 對它的四條測試是這次改動
      的對照組**，必須仍然通過
- [x] 5.3 **`did-navigate` 明確不做**（#19 建議 1 的第三樣）：它是主行程的 `webContents` 事件，
      renderer 求值看不到；要讓探針拿到就得在 `src/` 印出來，那違反「產品程式碼零改動」，而且是
      為了驗收改產品。CDP 的 `Page.frameNavigated` 不等價（導航防護擋下所有導航，dev 的 HMR 也不
      走它）。**這一條寫進 issue #19 的回覆，不是默默略過**
- [x] 5.4 修四處行內求值（**全部在 `probe-keyboard.mjs`：`:966`、`:1279`、`:1294`、`:1309`**）——
      改為先求值成變數、條件用它、detail 走 `describeMounted()`。`:616`／`:946`／
      `probe-terminal.mjs:1997` 已是正確形式，不動
- [x] 5.5 **不擴充 `check-detail` 守衛** —— 它只問「有沒有 detail」，要判斷「detail 涵不涵蓋那個
      子條件」需要語意分析，做出來會誤判，而**一個會誤判的守衛遲早會被加上例外開關**（這條紀律
      就寫在現行 spec 裡）。5.4 是一次性清查，在該處註明

## 6. 文件

- [x] 6.1 `docs/lessons/probes.md` 補三節：（a）前置條件的兩種失敗長得一模一樣、處置相反；
      （b）port 表與撞號；（c）**`dconf watch` 繼承 debugging port fd 的變種** —— 該文件既有
      「殺 wrapper 殺不到真行程」一節，但例子是 electron 的孫行程，而這個變種**抓著 port 的行程
      名稱與 Electron 毫無關係**，更難發現（issue #18 方向 3）
- [x] 6.2 同一份文件的**兩處會過期的敘述**：`:429-437`「為什麼不平行化」把 identity 的撞號列為
      理由之一（本 change 一落地它就不再成立，但**另外兩條理由仍然成立** —— 不要順手刪掉整節）；
      `:322` 寫死了 port 9224
- [x] 6.3 `CLAUDE.md` 的「測試分兩層」一節補一句：port 配置在 `scripts/lib/ports.mjs`，加新探針
      要在那裡登記（**一句，不展開** —— 細節屬於 `docs/lessons/probes.md`）

## 7. 驗收與回歸

- [x] 7.1 `npm test`、`npm run lint`、`npm run typecheck` 全綠
- [x] 7.2 `git diff --stat -- src/` **為空** —— 「產品程式碼零改動」的直接證據。斷言數一致只是
      旁證，而拿旁證當直接證據正是這個 repo 反覆記載的那個錯誤
- [x] 7.3 **斷言總數與通過數的比對** —— 一輪完整 `test:e2e`（九支）＋ `probe:package` 單跑。
      本輪數字：`native` 9/9、`core` 17/17、`identity` 9/9、`shell` 19/19、`workspace` 91/91、
      `files` 111/111、`keyboard` 200/202、`openspec` 320/322、`terminal` 242/246、
      **`package` 6/6**（完整打包 → 啟動真 AppImage，全綠 —— 它同樣經 `connect()`，
      所以 `Runtime.enable` 對打包產物也驗過了）。
      > **`probe:keyboard` 跑了真正的 baseline 對照**（`git stash` 到 HEAD 再跑一次）：
      > **198/200 → 200/202**。總數 +2 恰為新增的那 1 個 `check()` 呼叫點 × build/dev 兩模式
      > （靜態清點：整個 diff 淨新增 1 個 `check(` 行），通過數 +2，**紅燈數不變、且是同樣那兩條**。
      >
      > 其餘九支未各跑 baseline —— 它們沒有新增或移除任何 `check()`，紅燈也全部可歸因於已知票
      > （見 7.6）。**這一點要誠實記著**：本 change 的回歸基準對那九支是「紅燈逐條歸因」，
      > 不是「與 baseline 逐數字比對」。
- [x] 7.4 三種前置失敗各**真的觸發一次**（xvfb 那條沿用既有驗證）。兩者都立即失敗、訊息指向
      正確的處置：
      > 缺產物：`[probe:shell] 建置產物不存在：out/main/index.js、out/renderer/index.html` ＋
      > 「先跑 `npm run build`」。
      > port 被佔：`[probe:shell] debugging port 9222 被佔用（已等待 3.0 秒仍未釋放）` ＋
      > `持有者：LISTEN 0 511 127.0.0.1:9222 … users:(("node",pid=1265776,fd=21))`，**3.1 秒**
      > 結束（此前是 30 秒空轉）。
      >
      > **驗證方式本身踩了一次坑，值得記著**：直接把 `out/` 移走跑探針**測不到**這道檢查 ——
      > `run-probe.mjs` 會直接重建。要觸發它必須走 `PROBE_SKIP_BUILD=1` / `SPEKTERM_PROBE_BUILT=1`，
      > 而**那兩個旁路正是 issue #23 所說「產物可能不存在的來源」**。已寫進 `docs/lessons/probes.md`
- [x] 7.5 跑一輪 **dev 模式**的 `probe:keyboard` 與 `probe:terminal`，把採到的 console 訊息與
      `describeMounted`（含新的診斷欄位）樣本貼回 issue #19。**若一條 console 錯誤都沒採到，那本身
      就是結論**（renderer 不掛載的原因不在 console），一併記錄 —— 目前連這個否證都做不到
      > **採到了，而且第一輪就改寫了 #19 的診斷方向。** 三條 `MOUNTED` 紅燈的 detail 現在是
      > `未成立：visible（rail=true root=true visible=false）｜ readyState=complete rootChildren=1`
      > —— **renderer 完全正常掛載，不成立的是 `document.visibilityState`**。本票原本的線索一
      > （「renderer 不是掛載狀態」）就此被證偽。console 另外採到兩條真實線索：
      > `Too many active WebGL contexts. Oldest context will be lost.`（就在 `cols 68 → 68`
      > 那兩條所在的 `runMode` 段落）與 xterm 的
      > `Trying to add a disposable to a DisposableStore that has already been disposed of`
- [x] 7.6 確認 #19／#21／#22 的紅燈**仍然存在、且是同樣那幾條** —— 這同時是 `Runtime.enable`
      擾動被觀測者的唯一保險。若有任何一條轉綠或換了位置，要查明原因，**不得直接視為修好**
      > 本輪 10 條紅，逐條歸因後**沒有一條是新的**：#19 的七條全部重現（keyboard 2、openspec 2、
      > terminal 3）、#8 一條（build 的持久化損毀）、#21 一條（`dev：runMode` 中斷）、
      > #17 族一條（`dev：runAnchoringAndCoordinate` 的「選單中找不到 shell」）。
      > `probe:keyboard` 的 baseline 對照另外證實了那兩條**逐字相同**。
      > **`Runtime.enable` 沒有擾動任何一條。**
- [x] 7.7 關閉 issue **#23**、**#18**、**#6**（各附處置摘要，含三處與票面不同的地方：#23 的
      驗證方式、#18 的檢查位置改單支入口、#6 的範圍被清點推翻）；**#19 已貼上採證結果**
      （`visible=false`、WebGL context 被回收、xterm 的 disposable 洩漏，以及 5.3 那條
      「`did-navigate` 明確不做」的理由）

### 每一條新增 scenario 的驗收載體

> 依 issue #12 的精神逐條指認。**沒有載體的 scenario 不得存在**，而**載體必須是上面實際存在的一條 task**。

| Requirement | Scenario | 載體 |
|---|---|---|
| 執行的前置條件必須在啟動之前檢查 | 缺少建置產物時立即失敗 | 2.1 + **2.7** + **7.4** |
| 同上 | 不需要建置產物的探針不受此檢查影響 | 2.1 + **2.7** 的 `NO_BUILD` 那條 |
| 同上 | port 被佔用時立即失敗 | 2.1 + 2.4 + **2.7** + **7.4** |
| 同上 | 兩種前置失敗互相可區分 | **2.8**（自動判準：訊息不相等 + 各含自己的處置 token）+ **7.4**（兩種都真的觸發過） |
| port 佔用的判定不得依賴外部程式 | 佔用者查不出時仍然正確判定 | 2.4 + **2.7** 的「注入不可用的 lookup」 |
| 同上 | 短暫佔用後釋放不視為失敗 | 2.3 + **2.7** 的「退避窗口內釋放」（**2.3 的注入接縫是這條測得起來的前提**） |
| port 的配置必須有單一來源且不得重複 | 重複的 port 配置使守衛失敗 | 1.5(a) + **1.6** 的第一個對照組 |
| 同上 | 前置檢查與探針取自同一來源 | 1.4 + 1.5(b) + **1.6** 的第二、三個對照組。**第三個（`ports.identity[0] + 1`）是這條真正的判準** —— 現在正在出問題的那一個就是衍生 port |
| 等待中的讀取例外得由呼叫端選擇容忍 | 偶發失敗的讀取重試到成功 | **既有** `cdp.test.mjs:102` + **3.6** |
| 同上 | 持續失敗的讀取在窗口耗盡後拋出 | **既有** `cdp.test.mjs:82` + **3.6**（新增的部分是「拋出來的是哨兵」） |
| 同上 | 未選擇容忍時例外照常傳播 | **既有** `cdp.test.mjs:125`（對照組） |
| 同上 | 以拋錯表達「取樣失敗」的讀取，其容忍收於讀取本身 | 3.1 + 3.2 + **3.6**。**這條驗的是「六個站點都不必各自選擇」，不是「不可能有第七個沒被包住的讀取」** —— 後者擋不住明天寫出的第二個哨兵式讀取（3.5 的註解正是承認這一點）。scenario 的措辭已收斂到前者；要做到後者得先定義「哪些讀取算哨兵式」，而那個判準寫得出來就會誤判 |
| renderer 的 console 輸出必須被收集 | 段落有失敗時輸出該段的 console 訊息 | 4.4 + **4.6** + **4.7**（真 renderer） |
| 同上 | 段落全數通過時不輸出該欄位 | **4.6** 的對照組 |
| 同上 | 訊息歸屬於發生當下的段落 | 4.3 + **4.6** 的「殘留訊息不計入下一段」 |
| 同上 | 收集不需要改動產品程式碼 | **7.2**（`git diff --stat -- src/` 為空 —— 直接證據，不是旁證） |
| **（MODIFIED）** 等待窗口耗盡必須可見 | 原語的逾時不拋出例外（未選擇容忍時） | **既有** `cdp.test.mjs:35`（該條文只加作用域，行為未變）+ **既有** `:125` |
| 同上 | 其餘五條 scenario | **既有** `cdp.test.mjs:50/60/72`、`sections.test.mjs:347/361` —— 一字未改，此處僅為 MODIFIED 的完整內容而重列 |
