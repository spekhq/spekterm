> **每一條驗收 task 標明它覆蓋哪些 scenario**（以 spec 中的 scenario 名指認）。五條 requirement
> 共 **23 條 scenario**，全部在下面出現恰好一次。其中**一條明寫不覆蓋並給出理由**（§1.8）——
> 那是刻意的：一個宣稱有載體而實際上是人工目視的 scenario，比一個明寫「不覆蓋」的更糟。

## 0. 前置：取得收斂前的斷言數基準

- [x] 0.1 在動任何站點之前，跑 **build 模式**的 `npm run probe:openspec`、`probe:terminal`、
      `probe:keyboard`，記下各自的斷言總數與通過數。**該輪必須每個段落都完整執行**（無中斷、
      無逾時、無因前置失敗而未執行）—— 不完整就作廢重跑
      → 覆蓋：**基準取自完整執行的一輪**
      （基準並非事後不可得 —— `git stash` 隨時可重跑；但那是十幾分鐘的成本，先做省一次）
      **已完成** → `baseline.md`：build 模式 openspec **225/225**、terminal **135/135**、
      keyboard **109/109**；三支共 38 個段落全部「通過」，結束碼皆 0

## 1. 重試原語（`scripts/lib/instrument.mjs`）

- [x] 1.1 實作 `retryAction({ act, read, settled, attemptWindowMs, attemptIntervalMs, timeoutMs, label, evidence })`，
      **以 `pollFor` 組合而成**：外層 `pollFor` 的讀取 ＝「執行一次 `act()` ＋ 內層 `pollFor`」。
      原語內部**不得出現任何自己的 deadline 比較** —— 那會讓 `wait-source.test.mjs` 的
      `PRIMITIVE` 豁免必須從一個名字變成一組名字，而那是對既有 requirement 的實質改動。
      簽名中**不存在次數參數**
- [x] 1.2 耗盡時回傳最後一次讀到的值、不拋例外；內層每輪的窗口耗盡照常經 `pollFor` 回報
- [x] 1.3 耗盡時輸出一行匯總（試了幾輪、合計多久、內層窗口），並呼叫 `evidence()` 輸出現場；
      `evidence()` 自身拋錯時吞掉該例外並照常回傳最後的值
- [x] 1.4 單元測試：第一輪即生效時 `act` 恰好執行一次；一輪內多次輪詢時 `act` 仍只執行一次
      → 覆蓋：**動作生效後不再重做**、**動作每輪只執行一次**
- [x] 1.5 單元測試：耗盡時回傳最後一次的值且不拋
      → 覆蓋：**預算耗盡時回傳最後一次的值**
- [x] 1.6 單元測試：耗盡時輸出含現場與匯總；一輪即成功時兩者皆不輸出；`evidence()` 拋錯時
      呼叫端仍拿到最後的值而非例外
      → 覆蓋：**時限耗盡時輸出現場與匯總**、**重試成功時不輸出**、**現場採樣失敗不改變回傳值**
- [x] 1.7 單元測試：多輪耗盡時每一輪的內層窗口耗盡都出現在輸出中（**對照組**：確認沒有任何
      參數能把它們關掉）
      → 覆蓋：**內層的窗口耗盡照常回報**
- [x] 1.8 **不覆蓋「採樣 SHALL NOT 阻塞」**（該條款在 requirement 正文中，無對應 scenario）：
      理由是「不阻塞」的反例需要造出一個在該狀態下永不完成的回呼，而那正是本 repo 記載過
      「為了診斷 hang 而寫的探測自己會 hang」的形狀 —— 造得出來就表示已經寫錯了。
      改以 §6.1 在 lessons 記載該約束，並由 code review 承擔

## 2. 開選單站點收斂（八處）

- [x] 2.1 `probe-openspec.mjs:1087` `createSession` —— `timeoutMs` = **51000**
      （＝ 3 × (15s `stableRect` + 2s)；**15 秒那一項是第一版漏掉的**），註解記載推導
- [x] 2.2 `probe-openspec.mjs:1182` `anchorChange` —— `timeoutMs` = **42000**（＝ 3 × (8s + 6s)）；
      第一階段的等待留在 `act` 內
- [x] 2.3 `probe-terminal.mjs:789` `openTabMenu` —— `timeoutMs` = **8500**（＝ 5 × (1.5s + 0.2s)）
- [x] 2.4 `probe-terminal.mjs:1097` `openSessionViaRail` —— 今日 1 輪（8s + 3s + **一次求值**）；
      **讀項目那次 `evaluate` 改為等待**（既有缺陷：選單已開、項目尚未渲染即 throw）
- [x] 2.5 `probe-terminal.mjs:1110` `openSessionViaMenu` —— 今日 1 輪（10s + 3s + **一次求值**）；
      同 2.4 的缺陷。**這是 issue #19 記載的中斷位置**
- [x] 2.6 `probe-keyboard.mjs:508` `createSession` —— 今日 1 輪（10s + 3s）
- [x] 2.7 `probe-keyboard.mjs:2074` 全域項目的建立入口（行內）—— 今日 1 輪（10s + 6s）
- [x] 2.8 `probe-package.mjs:309` 全域項目的建立入口（行內）—— 今日 1 輪（15s + 6s）。
      **它與 2.7 是同一段程式碼的兩份拷貝**，已裁決納入（design D9）：邊際成本為零 ——
      §7.7 的 `probe:package` 本來就要跑（連線入口的第 8 個呼叫端也在那一支裡）
- [x] 2.9 八處各自提供 `evidence`：選單容器在不在、項目在不在、剛才點的矩形、該座標
      `elementFromPoint` 命中誰；`openTabMenu` 另加分頁矩形是否已改變；`anchorChange` 另加
      當下錨定的 slug 與視圖狀態
- [x] 2.10 兩個真實呼叫端的行為相反：`createSession` 耗盡時 throw、`anchorChange` 耗盡時回傳
      當下的 slug 讓斷言紅 —— 以單元測試或探針斷言確認兩者互不影響
      → 覆蓋：**呼叫端可將耗盡升級為例外**

## 3. 連線入口（`scripts/lib/cdp.mjs`）

- [x] 3.1 新增入口，包住 `waitForPageTarget` + `connect`：握手失敗時**重新探詢 target** 再重試，
      至顯式時限為止；每次失敗的 WebSocket 確實丟棄（移除 listener）
- [x] 3.2 **探詢本身失敗時立即終止重試**，以 `waitForPageTarget` 原本的錯誤訊息失敗
      （它會查 port 持有者並給出兩種解釋 —— 比任何一次重試都有用）
- [x] 3.3 三個時限：外層預算明顯大於「探詢窗口 ＋ 握手時限」之和；後兩者由新入口**顯式指定**
      （`waitForPageTarget` 的 `timeoutMs` 與 `connect()` 的 `connectTimeoutMs` 都已可注入），
      不沿用各自 30 秒的預設。註解記載三者的關係與取值理由（design OQ2）
- [x] 3.4 時限耗盡的訊息載明 `error` 事件實際帶著的內容，以及該 target 當下是否仍存在
- [x] 3.5 八個呼叫端改用新入口：`probe-openspec:390`、`probe-terminal:408`、`probe-files:175`、
      `probe-keyboard:156`、`probe-workspace:123`、`probe-shell:209`、`probe-identity:93`、
      `probe-package:278`。**新入口的簽名必須讓每個呼叫端保留自己的 target 時限**
      （`probe-package` 傳的是自己的 `STARTUP_TIMEOUT_MS`，不是預設值）
- [x] 3.6 確認 `connect()` 維持單次語意，`scripts/cdp-transport.test.mjs` 既有測試**一條未改**
- [x] 3.7 單元測試（時限可注入）：第一次握手失敗、其後成功時連線建立成功；每一輪重新探詢而非
      重用快照；探詢失敗時立即終止且耗時明顯小於總預算
      → 覆蓋：**首次握手失敗後重試成功**、**每一輪重新探詢目標**、**探詢失敗立即終止重試**
- [x] 3.8 單元測試：耗盡時的訊息含 error 內容與 target 存否；每次失敗的 socket 不殘留 listener
      → 覆蓋：**預算耗盡的訊息可歸因**、**失敗的連線不殘留**
- [x] 3.9 稽核三個時限的關係（由 §3.3 的註解與實際值判定）
      → 覆蓋：**外層預算大於一輪的最壞內層耗時**

## 4. 第四類：以次數為界的等待

- [x] 4.1 `probe-terminal.mjs:2304` 的 `for (let i = 0; i < 60 && !stubRan; i++)` ＋ `sleep(250)`
      改用 `pollFor`（15 秒的隱含預算變顯式）。**它不是重試**（無副作用、每輪無淨效果），
      所以用既有原語而非新原語

## 5. 守衛

- [x] 5.1 判準實作（新增 `scripts/retry-source.test.mjs`，或在 `wait-source.test.mjs` 內新增
      一節）：`for` 的條件為單一 `<識別字> <關係運算子> <運算式>`，且迴圈體內有 `return`／
      `break` 即違規。**走語法樹**
- [x] 5.2 同一支守衛加一條：經 `retryAction` 的呼叫不得傳入次數參數
      → 覆蓋：**原語不具表達次數的手段**
- [x] 5.3 **對照組（該紅）**：把 §2 三處原本有重試的站點之一改回手寫固定次數，確認守衛失敗
      並指出該處
      → 覆蓋：**手寫的固定次數重試使守衛失敗**
- [x] 5.4 **對照組（該綠）**：現況全部 12 個非命中計數迴圈逐一通過 —— 遞增兩處
      （`probe-keyboard:1930/1945`）、重複六處（`probe-keyboard:680/1445/1677`、
      `probe-terminal:1842`、`probe-workspace:498`、**`lib/cdp.mjs:322`**）、
      `.test.mjs` 內一處、`for (;;)` 一處、AST 上溯一處。
      **`lib/cdp.mjs:322` 不可省** —— 它是唯一位於 `lib/` 內的，而掃描範圍是否含 `lib/`
      取決於實作
      → 覆蓋：**其餘三類計數迴圈全數不被誤判**
- [x] 5.5 **對照組**：`probe-files.mjs:290/301`（位於送往頁面求值的 template literal 之內）
      不被命中
      → 覆蓋：**位於求值字串之內的迴圈不被誤判**
- [x] 5.6 對現況全庫執行守衛，通過
      → 覆蓋：**既有原始碼全數通過**
- [x] 5.7 決定 design OQ1（是否涵蓋 `while` 形狀）：**不涵蓋** —— 需要辨識「計數變數在條件裡
      遞增」，判準複雜且誤判面大，而該形狀今天不存在。已與第四類一起記為 lessons 的已知缺口

## 6. 文件

- [x] 6.1 `docs/lessons/probes.md`：三個原語的分工（等畫面／等讀取成功／等帶副作用的動作生效，
      **且分工的判準是頻率不是副作用** —— `readTerminalText` 是既有的反例）、**四類計數迴圈**、
      「以次數為界的等待」兩道守衛都抓不到（已知缺口）、以及 §1.8 未覆蓋的那條約束
- [x] 6.2 `CLAUDE.md`「驗收與探針」一節：原始碼守衛的數量與名稱隨之更新

## 7. 回歸

- [x] 7.1 `npm test`（含新守衛與新單元測試）
- [x] 7.2 `npm run lint`
- [x] 7.3 `npm run probe:openspec`、`probe:terminal`、`probe:keyboard` 各完整一輪，
      斷言總數與通過數與 §0.1 的基準一致
      → 覆蓋：**收斂前後 build 模式的斷言數一致**
      **已完成**（於 §7.6 的 `test:e2e` 一併取得）：build 模式 openspec **225/225**、
      terminal **135/135**、keyboard **109/109** —— 與基準逐一相同；dev 模式亦同
- [x] 7.4 稽核八處站點的時限值與其註解記載的推導
      → 覆蓋：**時限的推導可被稽核**
- [x] 7.5 **改以結構性測試承擔**（原本寫的是「跑一次 app 比對節點數」）：斷言 `menuEvidence`
      只送出**一次**求值，且該求值字串裡不存在 `addEventListener` / `setInterval` /
      `requestAnimationFrame` / `appendChild` / `MutationObserver` / `window.__`。
      理由：「這一輪沒看到殘留」證明不了「下一版不會留」，而結構性判準每次 `npm test` 都在看
      → 覆蓋：**採樣不在被測頁面留下常駐物**
- [x] 7.6 `npm run test:e2e` —— 新的連線入口有 8 個呼叫端，其中 7 支在此涵蓋
- [x] 7.7 `npm run probe:package` —— **不可省**：第 8 個呼叫端與 §2.8 的站點都在它裡面，
      而 `probe:package` **不在 `test:e2e` 之內**（它自成第三個成本層級）
      **已完成**：打包 → 啟動真正的 AppImage → **6/6 全部通過**
