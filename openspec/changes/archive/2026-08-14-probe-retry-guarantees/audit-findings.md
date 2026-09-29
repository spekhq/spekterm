# 獨立稽核：`probe-retry-guarantees`

> 稽核者未參與撰寫。**文件裡的每一項事實宣稱都回原始碼查證過**，下面每一條都標了檔案:行。
> 稽核時的 HEAD：`04f427a`。

---

## 錯誤 1：`createSession` 的乘積算錯了 —— 實際上界是 51s，不是 6s

**宣稱**：

- `proposal.md:8` —— 「`probe-openspec.mjs` `createSession` ｜ 3 次 × 2s ｜ **6s**」
- `design.md:135` —— 「`createSession` 6s」
- `tasks.md:34` —— 「`timeoutMs` = **6000**（＝ 3 × 2s）」
- delta spec `spec.md:199` —— 「各站點的時限 SHALL 以其收斂前的實際上界（重試次數與內層窗口的乘積）為起點」
- delta spec `spec.md:218` —— 「每一處的值等於其收斂前的重試次數與內層窗口的乘積」

**實際**（`scripts/probe-openspec.mjs:1087-1099`）：

```js
for (let attempt = 1; attempt <= 3; attempt++) {
  const btn = await stableRect(client, NEW_SESSION_RECT)   // ← 內層窗口 15_000ms
  if (!btn) throw new Error('找不到「+ session」按鈕')
  await realClick(client, btn)

  const item = await pollUntil(client, MENU_ITEM_RECT(target), (value) => value !== null, 2000)
  if (item) { await realClick(client, item); return }
}
```

`stableRect` 的預設時限是 **15 秒**（`scripts/probe-openspec.mjs:1018`）：

```js
async function stableRect(client, expression, { samples = 3, gapMs = 250, timeoutMs = 15_000 } = {}) {
```

而它**在迴圈體內**，每一輪都跑一次。所以 `createSession` 的實際上界是
**3 × (15s + 2s) = 51s**，不是 6s。文件把「內層窗口」窄化成只有 `pollUntil` 的那 2 秒，
漏掉了同一輪裡另一個、而且大七倍的等待。

**更關鍵的是最小值也超過 6s**：`stableRect` 要求連續 3 次量到同一個矩形、間隔 250ms，
因此**成功路徑**上每一輪至少是 2 × 250ms ＋ 3 次 CDP 求值 ≈ 0.6–0.8s，加上內層 2s
⇒ 每輪 ≥ 2.6s。**三輪 ≥ 7.8s > 6000ms。**

**後果**（三層，一層比一層嚴重）：

1. **在病態輪次上，重試韌性被砍成三分之一。** `stableRect` 因為畫面不動而燒滿 15s 時
   （那正是 issue #17 記載的那一類輪次），第一輪結束已經 17s ≥ 6000ms ⇒ 外層**只跑 1 輪**。
   今天是 3 輪。**這個 change 宣稱要處置的正是那一輪。**
2. **在正常輪次上，那個「顯式時限」不 bound 任何東西。** 每輪 ≈ 0.5–0.8s（`stableRect`）
   ＋ 2s（內層）≈ 2.6s；若外層照 `pollFor` 的形狀「在兩輪之間檢查 deadline」，
   第三輪會在 5.2s（< 6s）起跑並在 **7.8s** 結束 —— 宣告的預算是 6s，實際返回是 7.8s。
   若改成「剩餘預算不足一個內層窗口就不再起跑」（同樣自然的實作），則變成**只跑 2 輪**。
   **兩種實作各壞一邊**，而 design 沒有指定是哪一種 —— 這本身是一個必須先裁決的缺口。
3. R5 的驗收判準（「build 模式斷言總數與通過數不變」）**驗不出 1 與 2** —— 只要那一輪沒有恰好
   撞上競態，減少的重試次數在斷言數上完全看不見。這是本 repo 反覆記載的假綠形狀：
   **一個方便取得的量（斷言數）冒充規格真正在乎的量（重試韌性）**。

**最小修正**：`createSession` 的乘積改為 `3 × (15s + 2s) = 51s`；或在收斂時把 `stableRect`
的時限一併顯式化（例如 `act` 內傳一個小的 `timeoutMs`）並在 design 裡論證那個縮小。
**不可以只把 6000 改成別的數字而不說明 `stableRect` 去了哪裡** —— 它是這個站點最大的一塊預算。

---

## 錯誤 2：漏掉第五個站點 —— 而它正是 issue #17 最近一次中斷的那一個

**宣稱**：

- `proposal.md:6-11` 的表格列出**四個**站點，`design.md:7` —— 「**四個站點**各自手寫」
- `design.md:11` —— 「**翻遍探針之後**，計數迴圈實際上有三類」

**實際**（`scripts/probe-terminal.mjs:1110-1124`）：

```js
async function openSessionViaMenu(client, itemLabel) {
  const btn = await pollUntil(client, NEW_SESSION_RECT, (value) => value !== null, 10_000)
  if (!btn) throw new Error('找不到「+ session」按鈕')
  await realClick(client, btn)

  const menu = await pollUntil(client, MENU_IN_VIEWPORT, (value) => value !== null, 3000)
  const itemRect = await client.evaluate(MENU_ITEM_RECT(itemLabel))
  if (!itemRect) throw new Error(`選單中找不到「${itemLabel}」`)

  await realClick(client, itemRect)
  return menu
}
```

這是 `probe-openspec.mjs` 的 `createSession` **一模一樣的動作**（點「+ session」→ 等選單 →
點選單項），差別只有：

| | `createSession` | `openSessionViaMenu` |
|---|---|---|
| 座標取得 | `stableRect`（等矩形連續三次不變） | `pollUntil`（**量到就點，正是「座標過期」那個賭** ） |
| 重試 | 3 次 | **0 次** |
| 呼叫站點 | 8 處 | **9 處**（1148 / 1600 / 2038 / 2275 / 2455 / 2537 / 2679 / 2703 / 3000） |

**而 issue #17 的第一則 comment（2026-08-09）記載的中斷點正是它**：

```
Error: 選單中找不到「Login shell」
    at openSessionViaMenu (scripts/probe-terminal.mjs:1060)
```

comment 自己寫著：「本票記的是 `probe:openspec` 的 `createSession`……這次是 `probe:terminal`
的 `openSessionViaMenu` —— **同一個失敗模式的第三個站點**。」

**後果**：

1. 這個 change 把 `connect()` 納入的理由是「**零次重試**也是這一族的極端」（`proposal.md:36`）。
   **那條理由逐字適用於 `openSessionViaMenu`**，而它沒有被納入。
2. 守衛（D5）也**抓不到它** —— 它沒有計數迴圈。於是收斂完成、守衛全綠之後，
   探針裡仍留著一個 0 次重試的選單開啟站點，而它有 9 個呼叫站點、且**是 #17 最近一次中斷的
   實際位置**。
3. 敘事上更糟：change 交付後會給人「選單競態這一族已收斂」的印象，而 `probe:terminal` 裡
   使用最頻繁的那個入口一個字都沒動。

**最小修正**：把 `openSessionViaMenu` 列入 §2 一併收斂（它也該用 `stableRect`），
或在 design 明寫「不收斂它，理由是…」並在 tasks 記為已知缺口／開 issue。
**目前的文件連提都沒提到它的存在。**

---

## 錯誤 3：`readTerminalText` 已經是「帶副作用的重試」，而 D1 宣稱那個形狀不成立

**宣稱**（`design.md:43-49`，D1）：

> 最誘人的作法是 `pollFor({ read: async () => { await act(); return probe() } })` —— 一層搞定。
> **不行**：`pollFor` 每 250ms 重讀一次，而這些動作**有副作用**。……那是一個**自己製造失敗的重試**。
> 所以原語必須表達兩層。

delta spec `spec.md:20-22` 把它升級成規範性的理由：「把動作塞進既有等待原語的讀取函式
（於是每 250ms 重做一次）會產生一個**自己製造失敗的重試**，因此兩層是結構上的必要」。

**實際**（`scripts/probe-terminal.mjs:1023-1038`）：

```js
async function readTerminalText(client) {
  let attempt = 0
  return retrySample(
    async () => {
      // **重試前要把畫面收回原狀。** 失敗時右鍵選單很可能還開著…
      if (attempt++ > 0) {
        await pressKey(client, 'Escape')
        await pollUntil(client, MENU_IN_VIEWPORT, (value) => value === null, 1000)
      }
      return attemptReadTerminalText(client)
    },
    { timeoutMs: 3000, label: 'readTerminalText（拖曳擷取，失手即重試）' },
  )
}
```

`attemptReadTerminalText`（`probe-terminal.mjs:1041-`）做的是**一次真滑鼠拖曳、一次右鍵、
一次點「複製」、一次寫剪貼簿** —— 副作用滿載。它就是「把帶副作用的動作塞進既有等待原語的
`read`」，而且**它是本 repo 已封存並運作中的解法**（issue #6 的處置）。

它之所以不「自己製造失敗」，是因為它**在重試之前把畫面收回原狀**（那段註解逐字寫了這件事，
還寫了「一個必然失敗的重試比不重試更糟」）。**也就是說：D1 否決的不是那個形狀，而是那個
形狀「沒有重置步驟」的版本。**

**後果**：

1. D1 的論證與 delta spec 的「理由」段落，把一個**已經在這個 codebase 裡運作的形狀**
   宣告為結構上不可行。一份規格裡寫著與自家原始碼相反的事，日後會被當成裁決依據。
2. 更實際的問題：新原語的要求「**動作 SHALL 每輪只執行一次，SHALL NOT 隨內層輪詢的頻率重複
   執行**」（delta spec `spec.md:8-9`）與 `readTerminalText` 現行實作**直接衝突** ——
   它的動作正是隨輪詢頻率重複執行的。若稽核者照這條 requirement 掃一遍探針，
   `readTerminalText` 會被判違規；而它不該被改。**delta spec 沒有給它任何豁免依據。**
3. `retrySample` 的 `interval` 預設是 200ms（`instrument.mjs:221`），不是 D1 寫的 250ms
   —— 250ms 是 `pollFor` 的預設。小事，但它顯示 D1 的論證沒有回原始碼核對。

**最小修正**：D1 改寫成「兩層的必要條件是**每輪的動作之間需要一個重置**，或動作本身的成本
高到不能以輪詢頻率重複」，並明確把 `readTerminalText` 列為**已知的、正確的單層形狀**；
delta spec 的「動作每輪只執行一次」要限定作用域（例如「經由本原語的重試」），
否則它是一條會把既有正確程式碼判成違規的全稱條款。

---

## 錯誤 4：「`connect()` 在每一支探針的啟動路徑上」不成立；「九支」是八支

**宣稱**：

- `proposal.md:100-101` —— 「`connect()` 在**每一支**探針的啟動路徑上」
- `design.md:159` —— 「現況是 **9 支探針**各寫兩行 `waitForPageTarget` + `connect`」
- `tasks.md:52-53` —— 「**九支探針**（`openspec` / `terminal` / `files` / `keyboard` /
  `workspace` / `shell` / `identity` / `package` 等）」（列了 **8** 個，卻寫「九支」）

**實際**（`grep -n "await connect(" scripts/*.mjs`）：

| 檔案 | 行 |
|---|---|
| `scripts/probe-keyboard.mjs` | 156 |
| `scripts/probe-identity.mjs` | 93 |
| `scripts/probe-files.mjs` | 175 |
| `scripts/probe-workspace.mjs` | 123 |
| `scripts/probe-openspec.mjs` | 390 |
| `scripts/probe-package.mjs` | 278 |
| `scripts/probe-shell.mjs` | 209 |
| `scripts/probe-terminal.mjs` | 408 |

**共 8 處**。而 `probe-core.mjs` 與 `probe-native.mjs` **完全不連 CDP**
（兩者只 `import { check, pollFor } from './lib/instrument.mjs'`，`waitForPageTarget` 出現 0 次）。

`test:e2e` 的九支裡有 **7 支**用 `connect()`；第 8 個呼叫端 `probe-package` **不在** `test:e2e`
之內（CLAUDE.md：「`probe:package` 自成第三個成本層級 —— 它不在上面那九支裡」）。

**後果**：

1. `tasks.md:53` 的清單照著做會漏掉／多找檔案，而它同時是 §3.3 的完成判準。
2. `proposal.md:101`（「`connect()` 在每一支探針的必經之路上 ⇒ 必須以 `test:e2e` 收尾」）
   與 `design.md:171` 的風險評估都建立在一個誇大的事實上。結論（要跑 `test:e2e`）仍然對，
   但**理由的精確度是這個 repo 的既有紀律**（「一個方便取得、看起來相關的量」）。
3. 附帶：`probe-package` 的改動**不會**被 `test:e2e` 覆蓋，而 tasks §6 沒有排 `probe:package`。
   一個在 8 個站點裡改了 1 個而完全沒有驗收覆蓋的站點 —— 這是實際的缺口，不只是措辭。

---

## 錯誤 5：把一個明示為「假說」的東西，當成已確立的根因寫進 proposal 與 spec

**宣稱**：

- `proposal.md:22-24` —— 「issue #17 最近一次採證中 `createSession` 中斷的那一輪，**根因是**
  renderer 的 `requestAnimationFrame` 完全停擺（`probe-timing-guarantees` 已處置）」
- `proposal.md:68-69` —— 「**根因已由** `probe-timing-guarantees` **指認為**背景節流而非負載，
  該建議的前提不成立」（用來否決 #17 建議 3）
- delta spec `spec.md:24-26` —— 「**實測中造成中斷的那一輪**，其 renderer 的動畫框完全停擺，
  每一次重試都在等一個不會發生的重繪」

**實際**（issue #17 第三則 comment，2026-08-14）：

> ⚠️ **這則現場採自一輪 37/37 全綠的執行**（`watch-openspec.log` 與 `openspec-basics-2.log`
> 的時間戳相差 88ms，是同一輪）。它證明**這個狀態確實會發生**，**不是**「那些紅出自這個狀態」
> —— **迄今沒有任何一輪同時觀測到 hidden 與那些紅。因果是目前最強的解釋，但它是假說。**

也就是說：**沒有任何一輪同時觀測到「rAF 停擺」與「`createSession` 中斷」**。
「造成中斷的那一輪其動畫框停擺」是文件憑空補上的因果，issue 的原文恰好否定了它。

**後果**：

1. delta spec `spec.md:24` 的「**實測中造成中斷的那一輪**」是一句規格層級的事實宣稱，
   而它沒有出處。它一旦封存進主 spec，就成了日後裁決的依據。
   本 repo 的既有規格已經明文寫過相反的紀律：「處置的有效性 SHALL 以多輪觀測建立，
   SHALL NOT 以單輪的成敗差異建立」（design.md:34-36 自己也引了這條，卻在別處違反它）。
2. `proposal.md:68` 用這個未確立的根因**否決** #17 建議 3（探針之間留冷卻）。
   若那個因果只是假說，這個否決就沒有根據 —— 它可能是對的，但目前的理由不成立。
3. 它同時削弱了整個 change 最核心的論證（「次數與時限都不是那個病的旋鈕」）。
   那個論證未必錯，但它現在**靠一句不存在的觀測撐著**。

**最小修正**：把三處改寫成假說語氣（「目前最強的解釋是…，而 #17 明記它尚未與任何一輪紅燈
同時觀測到」），特別是 delta spec 那一句 —— 規格裡不該有查不到出處的實測宣稱。

---

## 錯誤 6：`tasks.md` 漏了一個**必做**的步驟 —— 新原語會讓既有的等待守衛紅

**宣稱**：`tasks.md` §1 只列了實作原語與五條單元測試；§4 只談**新**守衛。

**實際**（`scripts/wait-source.test.mjs:33-34, 77-90`）：

```js
/** 等待原語自身 —— **以函式名豁免，不以檔案豁免**（同一個檔案裡的第二個迴圈仍要被擋）。 */
const PRIMITIVE = 'pollFor'
…
function insidePrimitive(node) {
  for (let cursor = node.parent; cursor; cursor = cursor.parent) {
    if (ts.isFunctionDeclaration(cursor) && cursor.name?.text === PRIMITIVE) return true
```

豁免是**單一硬編的函式名**，而 `probeSources()`（`wait-source.test.mjs:107-115`）掃
`scripts/` 與 `scripts/lib/` 的每一支非 `.test.mjs`。

`retryAction` 的外層要「以 `timeoutMs` 為界」（`tasks.md:13-15`），實作上必然出現
`Date.now()` 與 deadline 的大小比較 —— 而那正是 `hasDeadlineComparison` 的判準
（`wait-source.test.mjs:59-75`）。

**後果**：照現在的 tasks 做，§1.1 一寫完 `npm test` 就紅在**既有**守衛上，而 §6.1 才會發現。
更重要的是它的規格意義：**`PRIMITIVE` 從一個名字變成一組名字，等於既有 requirement
「等待必須經由單一原語實作」的守衛定義域被改動了** —— 這與 delta spec **全部 ADDED、
一條 MODIFIED 都沒有**不一致（見下面「缺口 1」）。

**最小修正**：§1 加一條「把 `wait-source.test.mjs` 的 `PRIMITIVE` 改為集合並納入 `retryAction`，
且補一條對照組確認豁免沒有擴大到別的函式」。

---

## 缺口 1：delta spec 全部 ADDED，但至少有兩處既有條文被這個 change 改變了語意

**宣稱**：

- 待稽核的 delta spec（`specs/probe-execution-scope/spec.md:1`）第一行只有 `## ADDED Requirements`
- `proposal.md:82-85` —— 「既有『等待必須經由單一原語實作』其守衛的定義域隨之擴充。
  既有『對被測 app 的每一次求值必須在有限時間內返回』已涵蓋**連線建立本身有時限**，
  本 change 在其上加的是**失敗前先重試**與**失敗訊息可歸因**。」

proposal 自己承認既有條文的守衛定義域會被擴充，**卻沒有任何 MODIFIED**。

**實際**，既有主 spec（`openspec/specs/probe-execution-scope/spec.md:694-704`）那條
requirement 有六個 bullet，其中**第五個**是：

> - 對被測 app 的其他網路探詢（取得可連線的目標）SHALL 同樣受時限約束，
>   **且該時限 SHALL 明顯小於包住它的等待窗口**。

現況正好滿足它：`TARGET_FETCH_TIMEOUT_MS = 3_000` ≪ `waitForPageTarget` 的 30 秒窗口
（`scripts/lib/cdp.mjs:32, 34`）。

而 D7 選了方案 B：「**新入口包住 `waitForPageTarget` + `connect`，重試時重新探詢**」
（`design.md:156`），同時 Open Question 2 傾向「訂一個**明顯小的值**」（`design.md:196`），
而 §3.4 又要求 `connect()` 維持單次語意、`CONNECT_TIMEOUT_MS` 不動（＝ **30 秒**）。

**這三條合在一起是自相矛盾的**：

| 層 | 現況時限 | 這個 change 的處置 |
|---|---|---|
| `TARGET_FETCH_TIMEOUT_MS` | 3s | 不動 |
| `waitForPageTarget` 窗口 | **30s** | 被包進新入口，**一輪一次** |
| `connect()` 握手 | **30s** | 明文不動（§3.4） |
| **新入口的外層預算** | — | 「**明顯小的值**」 |

一輪的最小可能耗時是 `waitForPageTarget`（最壞 30s）＋ 握手（最壞 30s）＝ **60s**。
一個「明顯小」的外層預算**結構上不可能兌現** —— 外層的 deadline 只在兩輪之間檢查，
於是新入口的實際返回時間由**內層**決定，而那個顯式時限成為一個不生效的裝飾。
這正是既有 bullet 5 在警告的形狀（內層時限必須明顯小於包住它的窗口），只是升了一層而沒有人管。

同時，`waitForPageTarget` **會拋**，而且拋的是一段精心組出來的訊息（查 port 持有者、
兩種不同的解釋，`cdp.mjs:54-66`）。把它包進重試意味著二選一，而 design 沒有選：

- **重試它** ⇒「app 根本沒起來」的情形從 30s 變成 N × 30s，而 CLAUDE.md 的既有教訓是
  「任一不成立就**立刻失敗並指出處置**，不進入那 30 秒的『等待 CDP target 逾時』」。
- **不重試它** ⇒ 與 delta spec R4「重試 SHALL **重新探詢**可連線的目標，SHALL NOT 重複使用
  同一份已取得的目標描述」（`spec.md:157`）直接衝突 —— 而那條被 design 稱為「這條的關鍵，
  不是細節」。

**後果**：

1. 既有 requirement 的 bullet 5 在改動後**不再明顯成立**（或必須重新論證），
   而 delta 沒有 MODIFIED 去承載那個重新論證。
2. `spec.md:173-174` 的那句免責（「本要求 SHALL NOT 被理解為放寬既有的『連線的建立本身受時限
   約束』」）只擋了 bullet 4，**沒有碰 bullet 5**，而受影響的正是 bullet 5。
3. 加上「錯誤 6」的守衛豁免，**這個 change 至少改動了兩條既有 requirement 的實質**，
   卻宣稱「既有條文一個字都不必改」。

**最小修正**：把「對被測 app 的每一次求值必須在有限時間內返回」列為 **MODIFIED**，
在其中把三層時限的關係寫死（外層預算 ≥ 一輪的最壞內層耗時，或把 `connect()` 在新入口內
以較小的 `connectTimeoutMs` 呼叫 —— 那是既有的可注入參數，`cdp.mjs:108`），
並解決 `waitForPageTarget` 拋錯要不要被重試接住。**這是實作前必須先裁決的事，不是實作細節。**

---

## 缺口 2：計數迴圈不只三類 —— 第四類已經存在，而兩道守衛都抓不到它

**宣稱**（`design.md:11-21`）：

> **翻遍探針之後，計數迴圈實際上有三類**，而只有第一類是本 change 的對象：重試／遞增／重複。

D5 的表（`design.md:116-123`）列了 **6 個**迴圈並宣稱「對現況是精確的」。

**實際**：我把 D5 的判準寫成一支 AST 腳本對 `scripts/` + `scripts/lib/` 的全部 `.mjs` 跑過
（判準：`for` 的條件為 `<identifier> <關係運算子> <expr>` 單一項，且迴圈體內有 `return`／`break`）。
現況的 `for` 計數迴圈共 **15 個**，不是 6 個：

| 判定 | 位置 | 形狀 |
|---|---|---|
| **HIT** | `probe-openspec.mjs:1087` | `createSession` ✓ |
| **HIT** | `probe-openspec.mjs:1182` | `anchorChange` ✓ |
| **HIT** | `probe-terminal.mjs:789` | `openTabMenu` ✓ |
| 放過 | `probe-keyboard.mjs:680` | 重複（建三個 session） |
| 放過 | `probe-keyboard.mjs:1445` | 重複（建三個 session） |
| 放過 | `probe-keyboard.mjs:1677` | 重複（**建兩個全域 session** —— design 未列） |
| 放過 | `probe-keyboard.mjs:1930` | 遞增（非純計數） |
| 放過 | `probe-keyboard.mjs:1945` | 遞增（非純計數） |
| 放過 | `probe-terminal.mjs:1842` | 重複（`ctrlTab()` ×20 —— design 未列） |
| 放過 | `probe-terminal.mjs:2304` | **第四類，見下** |
| 放過 | `probe-workspace.mjs:498` | 重複（`ArrowRight` ×5 —— design 未列） |
| 放過 | `lib/cdp.mjs:322` | 重複（`dragMouse` 的 steps —— design 未列，**且在 `lib/` 內**） |
| 放過 | `sections.test.mjs:482` | 重複（`.test.mjs`，既有守衛已排除該類檔案） |
| 放過 | `wait-source.test.mjs:79` | 非計數（AST 上溯） |
| 放過 | `lib/instrument.mjs:172` | `for (;;)`（原語自身） |

**判定本身全對** —— 命中集合**恰好**是那三個重試站點，沒有誤判也沒有漏判。
**§3 的核心結論成立。** 但兩件事需要修：

**(a) 第四類存在**（`scripts/probe-terminal.mjs:2303-2307`）：

```js
let stubRan = false
for (let i = 0; i < 60 && !stubRan; i++) {
  stubRan = existsSync(stub.receipt)
  if (!stubRan) await sleep(250)
}
```

這是**以次數為界的等待** —— 沒有帶副作用的動作（不是重試）、每輪沒有淨效果（不是遞增）、
有退出條件（不是重複）。它的隱含預算是 **60 × 250ms = 15 秒**，而那個數字同樣「藏在乘法裡、
沒有任何一處寫下來」—— 也就是這個 change 的 Why 逐字描述的病。

**兩道守衛都放過它**：既有的等待守衛判準是「迴圈裡有 `Date.now()` 的大小比較」
（`wait-source.test.mjs:59-75`），它沒有 `Date.now()`；D5 的判準要求純計數的界，
它的條件有 `&& !stubRan`。

**(b) 對照組的覆蓋面不足**：`tasks.md:69-71` 的「該綠」對照組寫的是
「兩處遞增迴圈 ＋ **三處重複迴圈（建 N 個 session）**」。實際的重複迴圈有 **6 處**，
其中三處**不是**建 session（`ctrlTab` ×20、`ArrowRight` ×5、`dragMouse` 的 steps），
而 `lib/cdp.mjs:322` 那一處位於 **`lib/` 之內** —— 若新守衛沿用
`wait-source.test.mjs` 的 `probeSources()`（含 `lib/`，排除 `.test.mjs`），它就在掃描範圍內。
只拿「建 N 個 session」當對照組，等於沒有驗到 `lib/` 這一支。

**最小修正**：design 的三類改為四類（或明寫第四類是既有等待守衛的漏網、已登記為缺口）；
tasks §4.3 的對照組改成「以 §缺口2 的完整清單為準，12 個非命中迴圈全部通過」。
**`probe-terminal.mjs:2304` 那個 15 秒的隱含預算，要嘛在本 change 一併收斂，要嘛開成 issue。**

---

## 缺口 3：三條「稽核類」載體不是載體，而本 repo 對這件事已經重演四次

**宣稱**（`tasks.md:1-3`）：

> **每一條驗收 task 都標明它覆蓋哪些 scenario**……五條 requirement 共 20 條 scenario，
> 全部在下面出現恰好一次 —— 這份 change 不留「宣稱了卻沒有載體」的 scenario。

**帳目查證：對的。** 我逐條核對過 20 條 scenario 與 tasks 的指認，**每一條恰好出現一次，
沒有重複、沒有遺漏**（R1 六條 → 1.4/1.5/1.7/2.5；R2 四條 → 4.2/4.3/4.4；
R3 四條 → 1.6/2.4；R4 四條 → 3.5/3.6；R5 兩條 → 6.3+6.4/2.5）。

**但其中四條的「載體」不會失敗**：

| Scenario | 指認的載體 | 問題 |
|---|---|---|
| 採樣不阻塞且不留常駐物 | §2.4「三處的 `evidence` 實作**稽核**」 | 一次人工目視。**明天改壞了沒有任何東西會紅。** scenario 自己的措辭就是「WHEN 稽核…」 |
| 上界為時限而非次數 | §2.5「**稽核**時限值…原始碼中不再有次數」 | 同上。而這一條**做得到自動化** —— 新守衛已經在掃 AST，多一條「經 `retryAction` 的呼叫不得傳次數參數」即可 |
| 時限以收斂前的實際上界為起點 | §2.5 同上 | 同上，且**它現在的基準數字是錯的**（見「錯誤 1」） |
| 呼叫端可將耗盡升級為例外 | §1.5「呼叫端於返回後自行拋出不影響其他呼叫端」 | **不可能失敗** —— 這測的是 JavaScript 的 `throw`，不是原語。原語只要「返回而不拋」（scenario 3 已經驗了），這條就自動成立 |

對照既有主 spec 的同名 scenario（「呼叫端可將逾時升級為例外」，`specs/…/spec.md:257`），
它的載體是 **`scripts/cdp.test.mjs:154-158` 對真實呼叫端 `waitForPageTarget` 的測試** ——
一個**真的呼叫端**，改壞了會紅。新 change 用一個合成的 stub 取代它，鑑別力歸零。

**後果**：這正是 CLAUDE.md 記載已重演**四次**的病（「補一條 scenario 與覆蓋一條 scenario 是
兩個動作」）。四條裡三條可以直接補救：

- 「上界為時限而非次數」→ 併進新守衛（AST 可判定）
- 「呼叫端可將耗盡升級為例外」→ 改成對**真實呼叫端**斷言：`createSession` 耗盡時 throw、
  `anchorChange` 耗盡時回傳當下的 slug（兩者行為相反，這才有鑑別力）
- 「採樣不阻塞且不留常駐物」→「不留常駐物」可自動化（採樣前後對 DOM 取節點數／查特定選擇器）；
  「不阻塞」若真的只能稽核，就在 tasks 明寫「不覆蓋，理由是…」而不是假裝有載體

---

## 缺口 4：R5 的驗收判準對這個 change 最可能引入的退步**沒有鑑別力**

**宣稱**（delta spec `spec.md:201`）：

> 收斂的驗收 SHALL 以 **build 模式**收斂前後的斷言總數與通過數一致判定。

**實際**：我用 AST 掃過 `probe-openspec.mjs` 與 `probe-terminal.mjs`，
**兩者都沒有任何條件式發出的 `check()`**（`probe-keyboard.mjs` 有 6 處，但不在本 change 範圍）。
所以在**每個段落都完整執行**的前提下，斷言總數確實是決定性的。**這一點成立。**

但它量到的東西與規格在乎的東西不是同一個：

1. 重試次數從 3 降到 2（「錯誤 1」）在斷言數上**完全看不見** —— 只要那一輪沒撞上競態。
2. 反過來也成立：`createSession` 一 throw，該段落就中斷、斷言數就變 ——
   於是「基準」本身只能取自一輪**完整執行**的跑。而 `probe:openspec` 正是這個 change
   引用的、**已知會偶發中斷**的那一支。`tasks.md:7-9` 的 §0 沒有要求那一輪必須完整執行，
   而既有 spec 已有現成的判準可引（「完整驗收的總結必須標示每支探針是否完整執行」、
   「成本判斷不得以未完整執行的輪次為依據」，`specs/…/spec.md:154, 169`）。
3. 更根本的：既有 spec 明文「處置的有效性 SHALL 以多輪觀測建立，**SHALL NOT 以單輪的成敗差異
   建立**」（design.md:34-36 自己引了它）。R5 的驗收**就是單輪對單輪**。
   R5 驗的是「沒有退步」而不是「處置有效」，兩者不同 —— 但一個對主要退步方向沒有鑑別力的
   單輪對照，撐不起「這個 change 唯一碰到既有站點行為的動作」的驗收。

**附帶**：`tasks.md:5` 的標題「**事後無法取得**」不成立 —— 程式碼在 git 裡，
`git stash` / checkout 前一個 commit 隨時可以重跑（issue #17 的原文就描述了做這件事）。
真正的理由是「重跑一次要十幾分鐘」，那是成本，不是不可得。

**最小修正**：§0 加一句「該輪必須是**每個段落都完整執行**的一輪，否則作廢重跑」；
R5 的 scenario 補一條真正對得上退步方向的載體 —— 例如**斷言各站點收斂後的實際輪數下界**
（以可注入的時限在單元測試層驗，不必真的跑探針）。

---

## 缺口 5：`probe-package` 改了卻沒有任何驗收覆蓋

`scripts/probe-package.mjs:277-278` 是 `connect()` 的第 8 個呼叫端，而
**`probe:package` 不在 `test:e2e` 之內**（CLAUDE.md：「它不在上面那九支裡，也刻意不併進
`test:e2e`」）。`tasks.md` §6 排了 `npm test` / `lint` / `probe:openspec` / `probe:terminal` /
`test:e2e`，**沒有 `probe:package`**。

於是 §3.3 會改到一個檔案，而那個改動在整份 tasks 裡沒有任何一條會執行到它。
考慮到新入口會包住 `waitForPageTarget`（`probe-package` 傳的是自己的 `STARTUP_TIMEOUT_MS`，
不是預設 30s），這不是形式問題 —— 新入口的簽名必須讓每個呼叫端保留自己的 target 時限，
而 tasks 對此隻字未提。

**最小修正**：§6 加一條 `npm run probe:package`（或明寫「本 change 不改 `probe-package.mjs`，
它繼續直接呼叫 `waitForPageTarget` + `connect`」——但那就違反 §3.3 自己的目標）。

---

## 風險 1：`openTabMenu` 與 `anchorChange` 的乘積是「等待窗口之和」，不是真正的上界

`openTabMenu`（`probe-terminal.mjs:788-800`）：`attempts = 5` 的預設值沒有任何呼叫端覆寫
（呼叫點 2404 / 2695 / 3005 都只傳兩個參數）。每輪 `pollUntil(…, 1500)` ＋ **無條件的**
`sleep(200)`（含最後一輪）⇒ **5 × 1700 = 8500ms**。**算法正確。**

`anchorChange`（`probe-openspec.mjs:1182-1200`）：每輪 `pollUntil(…, 8000)` ＋
`pollUntil(…, 6000)` ⇒ **3 × 14000 = 42000ms**。**算法正確**（`if (!rows) continue` 只會讓某輪
更短，不會更長）。

但兩者的乘積都**只加總了等待窗口**，沒有計入迴圈體內的 `client.evaluate` 與 `realMouse`。
正常情形下那是毫秒級，可忽略；**病態情形下每一次 CDP 往返的上限是 `CALL_TIMEOUT_MS = 30_000`**
（`lib/cdp.mjs:21`）。`openTabMenu` 一輪有 4 次往返、`anchorChange` 一輪有 2 次。

這對這兩個站點不是致命的（它們的等待窗口佔絕對多數），**但它正是「錯誤 1」的成因** ——
`createSession` 那一輪裡被忽略的不是往返，是一個 **15 秒的完整等待**。
把「乘積」定義成「重試次數 × 內層窗口」時，要同時定義「內層窗口」包含哪些東西；
delta spec `spec.md:218` 把這個定義寫進了規格，而它在三個站點裡有一個是錯的。

---

## 風險 2：新原語與 `retrySample` 的分工說法不精確，但新原語本身有存在理由

**§7 查證結果**：`retryAction` **不是**重造輪子，但 proposal 對分工的描述不成立。

`proposal.md:51-53` 說：「`retrySample` 等**讀取本身成功**（**動作無副作用**）」。
`retrySample` 的**唯一實質用途** `readTerminalText` 的動作是「真滑鼠拖曳 ＋ 右鍵 ＋ 點複製 ＋
寫剪貼簿」（見「錯誤 3」）—— 副作用滿載。所以那個括號是錯的。

`retryAction` 仍有存在理由，而理由**不是**「有沒有副作用」，是這兩個：

1. **回傳語意**：`retrySample` 耗盡時**拋出最後一次的例外**（`instrument.mjs:191`），
   而 `anchorChange` 要的是「回傳當下的實際值讓斷言紅得有話可說」。
2. **兩層頻率**：`retrySample` 的 `interval` 是 200ms（不是 D1 寫的 250ms），
   動作與檢查同頻；`anchorChange` 一輪要等 8s ＋ 6s，同頻是不可行的。

**最小修正**：把 proposal 與 D1 的分工論證改寫成上面這兩條（它們查得到出處），
並停止宣稱「動作有副作用就不能放進 `read`」——本 repo 已經有一個正確的反例。

---

## 查證正確的項目（一行帶過）

- **§1 的兩個乘積**：`openTabMenu` 的 `5 × (1.5s + 0.2s) = 8.5s` **正確**
  （`attempts = 5` 無呼叫端覆寫；`sleep(200)` 無條件執行含最後一輪，所以計入是對的）；
  `anchorChange` 的 `3 × (8s + 6s) = 42s` **正確**。
  只有 `createSession` 錯（見「錯誤 1」），而遺漏的站點見「錯誤 2」。
- **§3 守衛判準的命中集合**：我把 D5 的判準寫成 AST 腳本跑過全庫，
  **命中恰好是那三個重試站點，零誤判、零漏判**。`continue`、`for...of`、`while`、`.forEach`
  都不在定義域內，`probe-files.mjs:290/301` 的 `for` 位於 CDP expression 的 template literal
  之內（AST 判準看不到它，regex 判準會誤判 —— `tasks.md:66` 已正確要求走語法樹）。
  D5 的核心結論成立；要補的只有 design 表格的完整性與第四類（見「缺口 2」）。
- **§6 前半**：`waitForPageTarget` 確實輪詢到 `/json/list` 回傳一個帶 `webSocketDebuggerUrl`
  的 `page` target 才返回（`scripts/lib/cdp.mjs:37-53`），拿不到就 throw。
  所以 issue #7 body 的推測（「port 還沒就緒 ⇒ 第一次 `ECONNREFUSED`」）**確實與現行程式碼
  不相容**，proposal 的判斷正確。
- **§6 後半**：「#17 建議 1 至今一次現場都沒採到」**有依據** —— issue #17 body 第 1 點
  自己寫「實測加上這段之後那一次就全綠了，所以目前**還沒有一次成功的現場採樣**」，
  第一則 comment 又重申「這一輪**仍然沒有採到**」。而現行 `createSession`
  （`probe-openspec.mjs:1087-1099`）確實沒有任何 dump。
- **§5 的帳目**：20 條 scenario 在 tasks 中**恰好各出現一次**，沒有重複也沒有遺漏。
  問題不在帳目，在其中四條的載體品質（見「缺口 3」）。
- **斷言數的決定性**：`probe-openspec.mjs` 與 `probe-terminal.mjs` **沒有任何條件式發出的
  `check()`**（AST 掃描確認），所以在每個段落都完整執行的前提下，§0 的基準是取得得到的。
- **D5「不誤判遞增」的兩處**（`probe-keyboard.mjs:1930, 1945`）確實都把退出條件寫在迴圈條件裡，
  design 對它們的描述逐字正確。

---

## 總評：**現在不能開始實作。**

不是因為方向錯 —— 方向是對的，而且 D1（兩層）、D2（回傳語意）、D3（不加抑制開關）、
D5（判準取語法上明確的形式）都是站得住的裁決，D5 更是我實測過**零誤判**的。

不能開始的理由是：**這份 change 對「現況是什麼」的認定有四處錯誤，而其中三處會直接寫進
實作或規格。** 尤其是這三條 —— 它們各自單獨就足以讓交付物比現況更糟：

1. **`createSession` 的預算算錯八倍**（漏掉迴圈體內 15 秒的 `stableRect`）。照 `tasks.md` 訂
   `timeoutMs = 6000`，在**這個 change 宣稱要處置的那種輪次上**，重試從 3 輪變 1 輪。
2. **漏掉 `probe-terminal.mjs` 的 `openSessionViaMenu` 與 `probe-keyboard.mjs` 的
   `createSession`** —— 兩個 0 次重試、9 個與 6 個呼叫站點的同族站點，其中前者正是
   issue #17 最近一次中斷的實際位置。收斂完成後它們一個字都沒動，而守衛也抓不到它們。
3. **delta spec 全部 ADDED，但至少兩條既有條文的實質被改動了**（`wait-source.test.mjs` 的
   單一原語豁免、既有 requirement 的「網路探詢時限須明顯小於包住它的窗口」），
   而 `connect()` 新入口的三層時限彼此矛盾（外層「明顯小的值」包住兩個各 30 秒的內層）。

### 最小的修正（做完這四件事就可以開工）

1. **回原始碼重算四個乘積，並定義「內層窗口」包含什麼。**
   `createSession` 是 `3 × (15s + 2s)`，不是 `3 × 2s`。同時在 D1 裡指定外層檢查 deadline 的
   時機（「兩輪之間檢查」還是「剩餘不足一個內層窗口就不起跑」）—— 兩種實作的行為不同，
   而 R5 的「不改變行為」只有在指定之後才判定得了。
2. **把 `openSessionViaMenu`（`probe-terminal.mjs:1110`）與 `createSession`
   （`probe-keyboard.mjs:508`）納入站點清單**，或明寫不納入的理由並開成 issue。
   同時決定 `probe-terminal.mjs:2304` 那個 60 × 250ms 的隱含等待怎麼辦。
3. **`connect()` 新入口的三層時限先裁決再實作**：外層預算、`waitForPageTarget` 的 30s 窗口、
   `CONNECT_TIMEOUT_MS` 的 30s 握手，三者的關係要寫死；`waitForPageTarget` 的 throw
   要不要被重試接住也要決定（兩個選項各自違反一條既有紀律，必須選一個並論證）。
   接著把「對被測 app 的每一次求值必須在有限時間內返回」改列為 **MODIFIED**。
4. **修掉四條假載體**（缺口 3），並在 §1 補上「`wait-source.test.mjs` 的 `PRIMITIVE`
   要納入新原語」這一步（錯誤 6）。

### 順帶（不阻擋開工，但封存前要改）

- proposal 與 delta spec 裡三處把「假說」寫成「實測／根因」的句子（錯誤 5）——
  規格裡不該有查不到出處的實測宣稱。
- D1 對 `retrySample` 的描述（「動作無副作用」）與 250ms 的數字都與原始碼不符（錯誤 3、風險 2）。
- 「九支探針」是八處呼叫端、七支在 `test:e2e` 之內；`probe-package` 改了卻沒有驗收（錯誤 4、缺口 5）。
