## Why

段落隔離與儀器化之後，探針的輸出已經能回答「**哪一段**失敗」與「它花了多久」。缺的是
**「為什麼」** —— 而現況是失敗訊息會主動指向錯的地方：

- **兩個處置完全相反的前置條件，產生一模一樣的失敗訊息。** `out/` 不存在（忘了 build）與
  debugging port 被殘留行程抓著，都表現為八支探針各等滿 30 秒、每支回報
  `等待 CDP target 逾時（30000ms，port 9223）` 與 `0/0 通過`。實測一輪這樣的執行花了約 20 分鐘、
  一條斷言都沒驗到，而追查時**先誤判成 port 佔用、查完才發現是產物不存在**（issue #23、#18）。
- **一次偶發的讀取失手就報銷一輪十幾分鐘。** `readTerminalText` 在拖曳選不到時刻意 throw（那道
  防護是對的），但呼叫端不接住它，整支探針從那裡死掉而不是重試一次（issue #6）。
- **dev 模式七條穩定失敗，至今沒有任何現場證據。** 其中三條的判定式含 `MOUNTED`；
  `probe-failure-instrumentation` 已讓它印出是 `rail` / `root` / `visible` 哪個子條件不成立，
  但**renderer 的 console 輸出目前一個字都沒有被收集** —— 而 dev 與 build 唯一的結構差異就是
  多一層 Vite dev server，它的失敗會留在 console 而不在 DOM 上（issue #19）。

三者是同一個病的三種形態：**探針知道自己失敗了，卻說不出失敗屬於誰。** 前兩者讓人把環境問題
讀成 regression，第三者讓人無從開始。

## What Changes

- **探針啟動前檢查前置條件，不成立即刻失敗並指出處置。** 涵蓋（1）建置產物存在、（2）要用的
  debugging port 未被佔用（並印出佔用者）。兩者的訊息必須**互相可區分**——那正是它們此前的失效
  方式。不吃建置產物的探針（`probe:native` / `probe:package`）豁免第一項。
- **等待中的讀取拋出例外時視為「尚未就緒」而重試**，窗口耗盡後拋出**最後一次**的例外。共用原語
  `pollFor` 已具備此語意（`tolerateErrors`）**且已有三條測試**（`cdp.test.mjs:82/102/125`）——
  缺的是**同一個讀取的其他呼叫姿態沒有它**：`readTerminalText` 的六個站點裡，一個經
  `pollTerminalText` 有容忍、三個是裸呼叫、其餘經 `pollUntilText` 沒有容忍。修法是把重試下放到
  讀取自己，而不是逐個呼叫端補。
- **debugging port 收斂到單一來源並禁止重複。** 前置檢查要問「這支要用哪個 port」就必須有這份
  對照；而現況 `probe-identity` **同時撞到兩支探針**（它啟動兩次，用 `DEBUG_PORT` 與
  `DEBUG_PORT + 1`）。`docs/lessons/probes.md:429-437` 早已記載此事並以它為「不平行化」的理由。
- **CDP 連線收集 renderer 的 console 錯誤**（環形緩衝），段落失敗時隨其他診斷一併輸出。
- **`MOUNTED` 參與的複合斷言，其 detail 必須涵蓋它。** `probe-keyboard.mjs:965`
  （「repo 只有一個 session 時 `Ctrl+Tab` 為無操作」）的 detail 仍只有 `shell 1 → shell 1`，
  掛載子條件不成立時說不出話 —— 而它正是 issue #19 那七條之一。既有的 `check-detail` 守衛只看
  「有沒有 detail」，看不出「detail 涵不涵蓋每個子條件」。

**不在本 change 範圍**：修好 dev 模式那七條紅（#19／#21／#22）。本 change 交付的是採到證據的
能力；**沒有證據之前不猜根因**是這條能力反覆記載的紀律。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `probe-execution-scope`: **新增五條**要求 ——「執行前置條件必須在啟動前檢查並可區分地失敗」、
  「port 佔用的判定不得依賴外部程式」、「port 的配置必須有單一來源且不得重複」、「等待中的讀取
  例外得由呼叫端選擇容忍」、「renderer 的 console 輸出必須被收集並於段落失敗時呈現」。
  **修改一條**：「等待窗口耗盡必須可見」原本無條件禁止原語拋出例外，與上述第四條矛盾（而且它在
  HEAD 就已經與實作不符），加上「未選擇容忍時」的作用域。
  既有的「複合條件的斷言必須輸出可定位失敗的 detail」不改條文，補上其實作缺口。

## Impact

**新增**：`scripts/lib/ports.mjs`（port 的單一來源）、`scripts/lib/preflight.mjs`（前置檢查）、
`scripts/ports.test.mjs`、`scripts/preflight.test.mjs`

**修改**：
- `scripts/run-probe.mjs`（接上前置檢查）
- `scripts/lib/cdp.mjs`（console 收集、`waitForPageTarget` 逾時訊息補查持有者）、
  `scripts/lib/instrument.mjs`（緩衝的家、重試入口）、`scripts/lib/sections.mjs`（段落失敗時呈現）、
  `scripts/lib/mounted.mjs`（診斷欄位）
- 八支帶 debugging port 的探針（`shell` / `workspace` / `files` / `identity` / `terminal` /
  `openspec` / `keyboard` / `package`）改取自 `ports.mjs`
- `scripts/probe-terminal.mjs`（`readTerminalText` 的重試與重置）、`scripts/probe-keyboard.mjs`
  （`MOUNTED` 的 detail）、`scripts/cdp.test.mjs` 與 `scripts/sections.test.mjs`（補測試）
- `docs/lessons/probes.md`（三節，含 `:322` 與 `:429-437` 兩處會過期的敘述）、`CLAUDE.md`（一行）

**不改**：`scripts/run-probes.mjs` —— 前置檢查放在單支入口而非完整驗收的入口，理由見 design D1。

- **產品程式碼零改動**，`src/` 一個字都不動。因此本 change 的回歸基準是「斷言總數與通過數不變」。
- 關聯 issue：#23、#18、#6，以及 #19 的第 1、2 兩點（第 3 點是調查，不在此）。
