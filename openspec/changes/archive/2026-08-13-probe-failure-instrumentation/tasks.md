> **本 change 交付後，#21／#19 的 dev 紅燈仍然是紅的。** 那是 Non-Goal，不是缺口 ——
> 驗收條款見 §9。

## 1. 共用的等待原語

- [x] 1.1 於 `scripts/lib/cdp.mjs` 新增 `pollFor({ read, settled, timeoutMs, interval, label, tolerateErrors })`：先讀一次再判斷 deadline；耗盡窗口時**回傳最後一次讀到的值、不拋錯**（要不要升級為例外由呼叫端決定）
- [x] 1.2 `tolerateErrors` 的語意**逐字對齊 `pollTerminalText` 現況**：每次成功讀取即清掉上一個例外，**只有最後一次讀取仍失敗才拋出**（實作成「窗口內出現過例外就拋」會把一條紅燈換成段落中斷）
- [x] 1.3 `pollFor` 在窗口耗盡時輸出一行，載明實際等待時間與 `label`；條件滿足時**不輸出任何東西**
- [x] 1.4 `pollFor` 累計「窗口耗盡的次數與合計時間」，累計帶段落 token（見 5.3）
- [x] 1.5 `pollUntil` 改為委派 `pollFor`，`label` 預設取表達式的前若干字元（空白收斂成單一空格）
- [x] 1.6 新增 `scripts/cdp.test.mjs`（node:test，秒級）：`pollFor` 的逾時回傳語意、逾時輸出、滿足時不輸出、`tolerateErrors` 的兩種路徑；**每條機制配一條對照組**（把機制退回要變紅）

## 2. 十七處手寫等待全部改為委派

> 清點見 design.md。**每一處都要給 `label`** —— 沒有標籤的逾時輸出等於沒有輸出。

- [x] 2.1 `scripts/lib/cdp.mjs`：`waitForPageTarget`（**逾時仍要拋錯** —— 改為在 `pollFor` 返回後由它自己判斷並拋）
- [x] 2.2 `scripts/probe-terminal.mjs` 具名輔助：`waitForFile`／`waitForPtyCount`／`pollTerminalText`（走 `tolerateErrors`）／`waitPtysGone`
- [x] 2.3 `scripts/probe-terminal.mjs` 的 `pollUntilText` —— **它是唯一把時限判斷寫在迴圈體內的那一份**（`for (;;)` + `Date.now() >= deadline`），也是 §4 守衛判準的第二種形狀的來源
- [x] 2.4 `scripts/probe-terminal.mjs` 三處匿名行內迴圈：reload 後的孤兒 pty 檢查（`:2232`）、休眠 session 喚醒（`:2538`）、`--resume` 自癒的 stub 呼叫次數（`:2714`）
- [x] 2.5 `scripts/probe-package.mjs`：`waitForPty`、`pollDisk`
- [x] 2.6 `scripts/probe-files.mjs`：`pollDisk`；`scripts/probe-keyboard.mjs`：`waitForPtyFile`
- [x] 2.7 `scripts/probe-workspace.mjs`：`layoutUntil`
- [x] 2.8 `scripts/probe-openspec.mjs`：`stableRect`（`settled` 為有狀態閉包 —— 連續 N 次相同才算滿足）
- [x] 2.9 `scripts/probe-core.mjs`：摘要等待 —— **它在語意上是「取樣」不是「等待」**（迴圈體內累積 listeners／blindSpots／appeared 三個集合，另有子行程結束的競賽）。轉換後**逐行核對三個集合的累積時機沒有改變**

## 3. CDP 往返計時

- [x] 3.1 `scripts/lib/cdp.mjs` 的 `connect()` 內，`send()` 累計往返次數與總耗時（帶段落 token）
- [x] 3.2 `check()` 輸出該區間的往返次數與總耗時；段落總結輸出該段的累計
- [x] 3.3 `scripts/cdp.test.mjs` 補測試：往返計數隨呼叫累加、區間輸出後歸零

## 4. 手寫等待迴圈的守衛

- [x] 4.1 新增 `scripts/wait-source.test.mjs`：走語法樹，**兩種形狀都要判為違規** ——（a）`Date.now()` 出現在 `while`／`for` 的條件；（b）迴圈體內以 `Date.now()` 與 deadline 比較後跳出。`pollFor` 自身以**函式名**豁免（不以檔案豁免）
- [x] 4.2 對照組：**兩種形狀各放一個 fixture**，確認守衛各自變紅；移除後變綠。**少了第二個 fixture，這道守衛在現況上就已經漏掉一份**

## 5. 斷言與段落的耗時

- [x] 5.1 `check()` 於行首輸出距上一條斷言的耗時與 CDP 往返（`[+0.4s cdp 12×0.30s]` 形式），**無門檻**；用語為「距上一條斷言」，不得寫成「本步驟耗時」
- [x] 5.2 `scripts/lib/sections.mjs` 的段落狀態總結加上每段耗時
- [x] 5.3 段落開始時換一個 token 並重置累計；`check()` 與 `pollFor` 的寫入帶著建立當下的 token，**非當前 token 的寫入只丟棄其對耗時歸屬的影響**（不影響 `results` —— 那會改變既有行為）。理由：逾時的段落不會被中止，它的殘留活動會切碎下一個段落的數字
- [x] 5.4 `scripts/sections.test.mjs` 補測試：段落耗時進總結、窗口耗盡的累計進總結、殭屍段落的寫入不計入下一段（各配對照組）

## 6. 斷言函式收斂為單一定義

- [x] 6.1 `scripts/probe-core.mjs`（`:282`）與 `scripts/probe-native.mjs`（`:35`）的本地三引數 `check` 改用 `lib/cdp.mjs` 的共用版 —— 否則這 28 條斷言拿不到耗時，而 §7 的守衛也沒有定義域
- [x] 6.2 `probe-native` 以 Electron 主行程執行（不經 CDP），確認它 import 得到 `lib/cdp.mjs` 的 `check` 且不連帶拉進 CDP 相關的東西；拉不動就把 `check` 抽到獨立模組

## 7. 複合條件斷言的 detail 與守衛

- [x] 7.1 新增 `scripts/check-detail.test.mjs`：`check()` 的條件引數含 `&&`／`||`（**下鑽巢狀函式與 IIFE**）而無 detail 引數即違規；**另擋「自訂同名而簽名不同的斷言函式」**；**不提供逐處豁免開關**
- [x] 7.2 補齊現存 **18 處**違規的 detail：`probe-core` 1（**在 `:313`，不是 `:298`** —— 後者的 `||` 在 detail 裡）、`probe-native` 2（`:95`、`:97`）、`probe-files` 4、`probe-keyboard` 4（含 **`:944`，#19 指名的那條**）、`probe-openspec` 3、`probe-workspace` 4
- [x] 7.3 對照組：確認守衛在補齊前報 18 處；補齊後變綠；再拿掉其中一處的 detail，確認變紅；另加一個「自訂三引數 check」的 fixture 確認被擋

## 8. `MOUNTED` 改為攜帶子條件

- [x] 8.1 於 `scripts/lib/` 提供共用的 `MOUNTED` 表達式，求值結果為 `{ ok, rail, root, visible }`，另提供純函式 `describeMounted(value)`（**只吃已求值的物件、拿不到 client** —— 使「事後再求值一次」在結構上不可能）
- [x] 8.2 六支探針的本地 `MOUNTED` 定義改用共用版；`probe-workspace` 的兩個額外條件（分界器數量、rail 寬度）以「這支額外要求什麼」的形式表達
- [x] 8.3 `probe-package` 維持不要求 `visibilityState`，並在共用定義處寫明理由（AppImage 於 Xvfb 下的 visibility 未經驗證）—— **已查證 archive 與 `git log -S` 皆無紀錄，不必再查**
- [x] 8.4 改判準的 **27 處**：直接引用 `MOUNTED` 的 18 處（`grep MOUNTED` 的 26 個 token 扣掉 6 個定義與 2 個註解），**外加 9 處 `app.mounted === true` / `remounted === true`** —— 後者**不含 `MOUNTED` 這個字**，必須另外 grep `\.mounted\b` 與 `remounted`
- [x] 8.5 修掉三處會靜默失效的 detail：`probe-files.mjs:590`、`:1133`、`probe-workspace.mjs:335` 的 `app.mounted ? '' : app.stderr()` —— 物件恆為 truthy，**啟動失敗時的 stderr 診斷會變成空字串**。改為以 `describeMounted` 產生
- [x] 8.6 所有以 `MOUNTED` 為條件的斷言改為傳入 `describeMounted(該次求值的值)` 作為 detail
- [x] 8.7 `scripts/cdp.test.mjs` 補 `describeMounted` 的測試：各子條件不成立時 detail 指得出來；**並釘住它的純函式簽名**（拿不到 client）

## 9. `runMode` 的段落時限、文件與驗收

- [x] 9.1 `scripts/probe-terminal.mjs` 的 `runMode` 改用 `LONG`，註解寫明理由（**不是**「逾時搶走了診斷輸出」—— stdout 是 inherit，已印的不會消失；理由是想看完後半段與段落的累計）
- [x] 9.2 `docs/lessons/probes.md` 補一節：靜默的等待落空是耗時的主要去向；`pollFor` 的用法與兩道守衛；`describeMounted` 為什麼必須與判定同源；**以及「取最後一個引數當時限」那個把 546 秒算錯的教訓**
- [x] 9.3 `CLAUDE.md` 的「驗收與探針」一節補觸發器（動 `scripts/lib/cdp.mjs` 或新增等待前先讀 `docs/lessons/probes.md`）
- [x] 9.4 `npm test`、`npm run lint`、`npm run typecheck` 全綠
- [x] 9.5 **build 模式的斷言總數與通過數，與改動前一致** —— 逐支比對**十支**（terminal / keyboard / openspec / files / workspace / core / shell / identity / **native** / **package**）。`probe:package` 要先 `dist:linux`，成本已知；**本 change 動到它，就不能不驗它**
- [x] 9.6 跑一次 `PROBE_ONLY=runMode npm run probe:terminal`（**build 與 dev 兩模式**）—— 只跑 dev 就沒有對照，而「dev 每一步都慢」正是要證偽的假設之一
- [x] 9.7 把 9.6 的兩份逐條耗時**並排**回貼 issue #21，把 `describeMounted` 的樣本回貼 #19（**這是本 change 的目的，不是額外的行政工作**）；並在 #19 註明「建議 1 只做了子條件那一半，console error 收集器未做」
- [x] 9.8 確認 #21／#19 的紅燈**仍然存在且未被本 change 掩蓋**（不得因等待語意改變而偶然轉綠 —— 若真的轉綠，要查明原因，不得直接視為修好）

### 每一條新增 scenario 的驗收載體

> 依 issue #12 的精神逐條指認。**沒有載體的 scenario 不得存在**，而**載體必須是上面實際存在的一條 task**。

| Requirement | Scenario | 載體 |
|---|---|---|
| 等待窗口耗盡必須可見 | 窗口耗盡時輸出可見 | 1.3 + **1.6** |
| 同上 | 條件滿足時不輸出 | 1.3 + **1.6**（對照組性質） |
| 同上 | 原語的逾時不拋出例外 | 1.1 + **1.6** |
| 同上 | 呼叫端可將逾時升級為例外 | 2.1 + **1.6** 的「呼叫端可把逾時升級為例外」測試（直接對 `waitForPageTarget` 斷言）|
| 同上 | 段落結束時輸出該段的累計 | 1.4 + 5.3 + **5.4** 的「段落的窗口耗盡累計進總結」 |
| 同上 | 沒有窗口耗盡的段落不帶該欄位 | **5.4** 的「對照組：沒有窗口耗盡時，總結不出現那一段文字」 |
| 等待必須經由單一原語實作 | 時限寫在迴圈條件的手寫等待使守衛失敗 | **4.2** 的第一個 fixture |
| 同上 | 時限寫在迴圈體內的手寫等待同樣使守衛失敗 | **4.2** 的第二個 fixture |
| 同上 | 既有等待全數改為經由原語 | 2.1–2.9 + 4.1 對真實 `scripts/` 執行（`npm test`） |
| 執行輸出必須提供斷言、段落與 CDP 往返的耗時 | 每一條斷言都帶耗時與往返計數 | 5.1 + 6.1 + **1.6／3.3** |
| 同上 | 段落總結帶每段耗時 | 5.2 + **5.4** |
| 同上 | 逾時段落的殘留活動不污染其他段落 | 5.3 + **5.4** |
| 複合條件的斷言必須輸出可定位失敗的 detail | 複合條件缺少 detail 時守衛失敗 | **7.3** 的對照組 |
| 同上 | 邏輯運算寫在巢狀函式內時同樣視為複合條件 | 7.1 + 7.2 的 `probe-workspace.mjs:695`（IIFE）+ **7.3** |
| 同上 | 自訂的斷言函式使守衛失敗 | 6.1 + **7.3** 的第三個 fixture |
| 同上 | 既有的複合條件斷言全數附有 detail | 7.2 + 7.1 對真實 `scripts/` 執行 |
| 多子條件的判定，其 detail 必須取自做出判定的那一次求值 | 判定失敗時可辨識是哪些子條件不成立 | 8.1 + **8.7** |
| 同上 | detail 與判定同源 | **結構保證**：8.1 的 `describeMounted(value)` 是純函式、拿不到 client，因此不可能自行求值；**8.7 釘住這個簽名** |
