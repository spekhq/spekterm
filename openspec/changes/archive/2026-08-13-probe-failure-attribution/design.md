## Context

`probe-section-isolation` 與 `probe-failure-instrumentation` 已經把「**哪一段**失敗、花多久、
等待窗口燒掉多少」做成輸出的一部分。本 change 接著處理**歸因**：失敗訊息目前會把人帶去錯的地方。

三個站點的現況（皆已核實於當前 HEAD）：

- **`scripts/run-probe.mjs`** 只檢查探針腳本存在與 `xvfb` 可用。**產物是否存在、port 是否可用
  都不檢查** —— 兩者都表現為隨後那 30 秒的 `等待 CDP target 逾時`。
- **debugging port 分散在八支探針各自的常數裡**（`probe-shell` 9222、`probe-workspace` 9223、
  `probe-files` 9224/9225、`probe-terminal` 9226/9227、`probe-openspec` 9228/9229、
  `probe-keyboard` 9234/9235、`probe-identity` **9225 與 9226**、`probe-package` 9240。
  `probe-core` 與 `probe-native` 不經 CDP）。**`probe-identity` 同時撞到兩支**：它的 `DEBUG_PORT`
  （9225）是 `probe-files` 的 dev port，而它第二次啟動用的 `DEBUG_PORT + 1`（`probe-identity.mjs:169`）
  是 `probe-terminal` 的 build port。
  > **這件事 repo 早就記下來了** —— `docs/lessons/probes.md:429-437`「為什麼不平行化」正是以它為
  > 理由之一。**而本 change 的第一版 design 沒有讀那份文件就寫了 port 表**，於是把 identity 當成
  > 只用一個 port，提出的號碼（9221）會與 `probe-shell`（9222）造出新的相鄰撞號 —— **一個宣稱
  > 要關掉撞號的 change，差一點連同一個缺陷一起出貨**。CLAUDE.md 的觸發器（動探針前先讀
  > `docs/lessons/probes.md`）是承重的，這是它的又一個實例。
- **`scripts/lib/cdp.mjs` 沒有訂閱 `Runtime` 或 `Log`。** renderer 的 console 輸出一個字都沒有
  進入探針的視野；`send()` 的 message handler 只認得帶 `id` 的回應（`cdp.mjs:56`），事件訊息被
  直接忽略。

`pollFor` 的 `tolerateErrors`（`instrument.mjs:132`）**已經實作、已有三條測試**
（`cdp.test.mjs:82/102/125`），也**已有一個呼叫端在用**（`probe-terminal.mjs:974` 的
`pollTerminalText`）。缺的不是這個能力，是**同一個讀取的其他呼叫姿態沒有它**（見 D5）。

## Goals / Non-Goals

**Goals:**

- 三種前置條件失敗（缺產物、port 被佔、缺 xvfb）在輸出上**互相可區分**，且各自帶可執行的處置。
- 一次偶發的讀取失手不再中止整支探針；窗口耗盡時仍然拋出最後一次的例外。
- dev 模式的失敗留下 renderer 的 console 證據。
- 斷言總數與通過數不變 —— 本 change **不動 `src/`**。

**Non-Goals:**

- 不修 dev 模式那七條紅（#19／#21／#22）。本 change 交付採證能力，不猜根因。
- 不改 `pollFor` 的預設語意。容忍例外是**呼叫端的判斷**，不是原語的（既有 spec 明文如此）。
- 不做「探針之間的冷卻」或「收 Chromium 輔助行程」（#18 的方向 2）—— 那要另外論證。

## Decisions

### D1：前置檢查放在 `run-probe.mjs`，不放在各探針

`run-probe.mjs` 是**單支入口與完整驗收共用的唯一必經之路**（`run-probes.mjs` 刻意不直接 spawn
探針，理由就寫在它的檔頭）。螢幕選擇與 GL 旗標已經因為同一個論證收在那裡。

**替代方案**：在 `run-probes.mjs` 開跑前掃一次（issue #18 的原始建議）。**不採用** —— 實測那一次
的症狀正是**單獨重跑一支**得到 `0/0`，而單支入口不會經過 `run-probes.mjs`。只在完整驗收檢查，
等於在最需要它的那條路上沒有它。

**「必經」是慣例，不是不變式。** `node scripts/probe-terminal.mjs` 繞得過去，前置檢查與 xvfb
檢查會一起消失。這與既有那道檢查的涵蓋範圍**完全相同**，所以是一致的先例而不是新缺口 ——
但要寫成「所有經過 `npm run probe:*` 與 `test:e2e` 的路徑」，不要寫成「強制」。

### D2：port 收斂到 `scripts/lib/ports.mjs`，**一支探針對應一組 port**，並以 `npm test` 守衛禁止重複

前置檢查要問「這支探針要用的 port 通不通」，就必須有一份**探針 → port** 的對照。現況那份對照
散在八個檔案裡，於是 D1 沒有定義域。

**表的形狀是「探針 → port 的陣列」，不是「探針 → 一個 port」。** 這不是為了將來的彈性，是因為
現況就有一支用兩個：`probe-identity` 啟動兩次（`:135` 用 `DEBUG_PORT`、`:169` 用
`DEBUG_PORT + 1`）。一對一的表**放不下第二個**，於是那個 port 不會出現在表上 —— 守衛看不見它，
前置檢查也不會檢查它。**一份漏掉一半的表，比沒有表更糟**：它讓人以為問題已經被結構擋住了。

**衍生的 port 一律禁止，兩個都要明寫。** `DEBUG_PORT + 1` 這種寫法正是它從表上消失的原因；
而選號要**避開相鄰**（取 9221 與 9231，不取 9221/9222），否則下一個人再寫一次 `+1` 就又撞上
隔壁那一支。

**守衛不能只是「找 `const *PORT* = 數字`」的字面比對** —— 那條規則對 `DEBUG_PORT + 1` 一個字都
看不到。

> **實作時修正過一次。** 原本寫的是「`--remote-debugging-port=` 的插值**必須是對匯入的表的直接
> 成員存取**」—— 那條判準**會把五支探針全部誤判**：`files` / `identity` / `terminal` / `openspec`
> / `keyboard` 都把 port 當參數傳進 `launch()`，插值處看到的是參數名（`${port}`），不是成員存取。
> 一個會誤判的守衛遲早會被加上例外開關。

判準改為三條，走語法樹（形狀比照既有的 `wait-source.test.mjs`）：

| 判準 | 抓什麼 |
|---|---|
| 一、表上不得有重複的號碼 | 收斂的目的本身 |
| 二、探針裡不得有 port 的數字字面（`--remote-debugging-port=` 的插值是數字字面；或名稱含 `PORT` 的宣告以數字字面為初始值） | `const DEBUG_PORT = 9225` |
| 三、不得對表的成員做算術 | 改寫之後的 `PROBE_PORTS.identity.default + 1` |

**二與三是接力的，各有定義域**：對照組（改動前的八支原始碼）上判準二報 12 處、判準三報 0 處
—— 當時的算術是對本地常數做的，而那個常數已被判準二抓住。改寫成表的成員之後，同一個手勢才輪到
判準三。**只有二，改寫後就沒人擋；只有三，本地常數的世界一片綠。**

這是本 repo 反覆記載的判準的一次應用：**「不接受某個東西」要由結構保證，不是由「沒有人再送它」
保證。** 但**結構保證是有定義域的** —— 上面那條字面守衛看起來也像結構保證，實際上放過了正在
出問題的那一個。

**代價**：八支探針各改一處 import。機械改動，其回歸基準就是「斷言總數與通過數不變」。

### D3：port 是否可用，判定與歸因分離

- **判定**用 Node 內建的 `net.connect('127.0.0.1', port)`：連得上 ⇒ 有人在 listen。不依賴任何
  外部程式，也不受語言環境影響（`LC_ALL` 那一族的坑）。
- **歸因**才用 `ss -tlnp` 找出持有者並印那一行。`ss` 不存在或無權讀取時，**降級為「被佔用，
  但查不出是誰」而不是判定失敗**。

分離的理由：#18 那次的持有者是 `dconf watch`，命令列與 Electron 毫無關係 —— **歸因是這張票的
全部價值**，但它不可靠（需要外部程式、需要權限）。讓一個加分項決定判定的成敗，就是把一個穩固
的檢查換成一個會在別的機器上失靈的檢查。

**四種情形的失效方向**（判定的可靠性靠這張表成立，不靠「`net.connect` 聽起來很準」）：

| 情形 | `net.connect` | 判定 | 對不對 |
|---|---|---|---|
| #18 的實況（輔助行程繼承 LISTEN fd） | 連得上 | 被佔用 | **正確**，這是要抓的那個 |
| 沒有人 listen（含 TIME_WAIT 殘留） | `ECONNREFUSED` | 可用 | 正確 |
| 只有 IPv6 的 listener | 連不上 v4 | 可用 | 無害 —— Electron 綁的就是 `127.0.0.1` |
| listener 在但 accept queue 滿 | **可能一直不返回** | —— | **唯一的壞方向** |

最後一列必須處理：**socket 要設 timeout 並在每條路徑上 `destroy()`**。少了它，一個為了取代
30 秒神秘逾時而做的檢查，自己變成一次無界的 hang（`pollFor` 攔不住 —— 它等的是 `read()` 返回）；
未銷毀的 socket 還會在 `run-probe.mjs` 留下一個不放的 handle。

### D4：被佔用時先退避重試，再失敗

完整驗收裡前一支剛結束、下一支立刻檢查，前者的 Electron 可能還在收尾 —— 直接失敗會製造一種
新的假紅。因此檢查是「短暫退避後仍被佔用才失敗」（走 `pollFor`，順帶讓這次等待也出現在窗口
耗盡的輸出裡）。

**這條的失效方向要挑對**：窗口太短 ⇒ 假紅；太長 ⇒ 退化成它要取代的那 30 秒。取數秒量級，
且**失敗訊息要載明「已等待多久仍被佔用」** —— 沒有那個數字，讀的人無法判斷該調哪一邊。

### D5：重試放進 `readTerminalText` 自己，不放在它的每一個呼叫端

**清點推翻了 issue #6 的範圍。** 它指名的是 `pollUntilText`（現況 `probe-terminal.mjs:1016`，
確實沒有 `tolerateErrors`），但 `readTerminalText` 的**六個**呼叫站點裡有**三處是裸呼叫**
（`:1647`、`:1894`、`:2493`）—— 它們連輪詢都沒有，一次失手同樣讓整支從那裡死掉。
**只修 `pollUntilText` 會留下三個一模一樣的坑，而且從此看起來像修好了。**

另一方面 `pollTerminalText`（`:963`）**早就傳了 `tolerateErrors: true`** 並在註解裡寫明語意。
也就是說現況是「同一個讀取，三種呼叫姿態」—— 與 `watcher-error-reporting` 之前那三個 watcher
站點同型的病。

因此重試下放到讀取自己：把「一次拖曳擷取」抽成內部函式，`readTerminalText` 本身成為
「失手即重試、窗口耗盡拋最後一次例外」的入口。**六個呼叫站點一處都不必改。**

**但這只是「現況全覆蓋」，不是結構保證。** 它擋不住明天有人寫出第二個哨兵式讀取而忘了包 ——
`pollFor` 的 `tolerateErrors` 仍然是一個要記得傳的旗標。要真正做到結構保證，得先定義「哪些讀取
算哨兵式」，而那個判準寫得出來就會誤判（一個會誤判的守衛遲早會被加上例外開關）。**因此本 change
明說它是現況全覆蓋，不在載體表上宣稱結構保證** —— 這個 repo 已經四次栽在這兩者的落差上。

**重試包在一個非冪等的 UI 序列外面，因此需要嘗試之間的重置。** 一次擷取會污染剪貼簿、拖曳選取、
右鍵開選單、點「複製」。失敗時選單**可能是開著的**，下一次嘗試的拖曳就從一個蓋著選單的畫面開始
—— 重試因此可能**必然失敗**。更糟的是失敗形態會變質：`MENU_ITEM_RECT` 回 `null` 時
`realClick(null)` 拋的是 `TypeError`，**不是那個帶診斷訊息的哨兵**。

現成的先例在同一個檔案裡（`openTabMenu`，`:766-778`）：每次嘗試都重新量測，N 次之後拋一個具名
錯誤。照它做，並且**驗收的控制組要斷言「拋出來的是哨兵」而不只是「有東西被拋出來」**。

共用的部分（`pollFor` + `settled` 恆真 + `tolerateErrors`）抽成 `scripts/lib/` 的一個小入口，
因為那是**唯一可被單元測試注入的接縫**：`readTerminalText` 依賴 probe-terminal 的表達式常數與
真滑鼠序列，搬不動也不該搬。

`pollUntil` 仍然不動。它的 `read` 是 `client.evaluate`，拋錯的典型原因是 **CDP 斷線或 renderer
不在了** —— 容忍它只會把「app 已死」變成「等滿整個窗口再說」，而那正是既有教訓裡「對已
`close()` 的 client 呼叫 `evaluate` 會無限等待」那一族。**兩類讀取的失敗語意相反，不能共用
一個預設。**

驗收要有鑑別力（issue #6 已寫明形狀）：對該入口注入「前 N 次 throw、之後成功」的讀取，確認重試
到成功；注入「永遠 throw」的，確認**逾時後仍然拋出**（不可回傳空字串通過 —— 那會把這道防護變成
一盞測不到自己宣稱在測的東西的綠燈）。

**內層窗口要小。** 一次擷取約 0.5–1 秒，而外層 `pollTerminalText` 的窗口是 10 秒；內層取數秒
量級（約兩三次嘗試）即可，否則兩層窗口相乘會把一次失手的代價從「多半秒」放大成「多十秒」。

### D6：console 以段落為單位收集，且沒有錯誤就不輸出

- `connect()` 之後送 `Runtime.enable` 與 `Log.enable`，在 ws 上掛一個常駐 listener 收
  `Runtime.consoleAPICalled`（`error` / `warning` 層級）、`Runtime.exceptionThrown`、
  `Log.entryAdded`（`error` 層級）。
- 每筆記錄**發生當下的段落 token**（`instrument.mjs` 的 `sectionToken()`，與 CDP 往返計時同一個
  機制）—— 逾時段落飛在半空的訊息不會記到下一段頭上。
- **緩衝住在 `instrument.mjs`，由 `cdp.mjs` 推入。** 不能放 `cdp.mjs`：`sections.mjs` 只 import
  `instrument.mjs`，而 `instrument.mjs` 的檔頭（`:4-8`）明文說明它為什麼保持與 CDP 無關
  （`probe-native` 要在沒有 CDP 的情況下用 `check()`）。反過來讓 `sections.mjs` 去 import
  `cdp.mjs` 會把那層隔離拆掉。
- **段落結束時，該段若有失敗的斷言、例外或逾時，才輸出該段收到的 console 錯誤**（環形緩衝，
  最近數筆）。沒有失敗就不輸出。

**捕捉窗口的問題已經實測，而實測推翻了原本的推論。**

原本寫的是：「`connect()` 發生在 `waitForPageTarget` 之後，renderer 在 attach 之前寫的東西
`Runtime.enable` 一個字也拿不到」—— 那段窗口正是 Vite 模組載入失敗會出現的地方，也就是這整條
requirement 存在的理由，所以它是個 blocker 級的問題。**實測（2026-08-13，Electron 43）證明它是
錯的**：以「ws 連上但先不 enable → `Runtime.evaluate` 發出訊息 → 才 enable」模擬那段窗口，

```
enable 之前的訊息，重播收到：3
    Runtime.consoleAPICalled  {"type":"error","args":[…"BEFORE_ENABLE_CONSOLE"]}
    Log.entryAdded            {"source":"security","level":"error","text":"…CSP…"}
    Log.entryAdded            {"source":"javascript","level":"error","text":"Fetch API cannot load…"}
```

**兩個 domain 都會緩衝並在 enable 時重播。** 於是「connect 之後發出的標記」不再是假綠 ——
它與 connect 之前的訊息走同一條管道，只是時間點不同；假綠的擔憂建立在「窗口不涵蓋早期」這個
**已被證偽**的前提上。驗收因此採真實路徑（`probe:keyboard` 的一條斷言）。

> 這是「**實測，不要從語意推論**」的又一個實例，而且方向與直覺相反 —— 若當初照推論設計，會為了
> 一個不存在的限制去做一套繞路的驗收，還會把「早期訊息採不到」寫進 spec 當成已知限制。

**代價是這個性質變成承重的**：日後 Electron 升版若改掉重播，症狀是「採不到早期訊息」，
而不是任何一條紅燈。結論與實驗方法寫進 `lib/cdp.mjs` 的 `subscribeConsole` 檔頭。

最後這條是既有紀律的直接套用：窗口耗盡的累計「**沒有時 SHALL NOT 輸出該欄位** —— 一個恆為零的
欄位掛在每個正常段落上，只會讓人學會不看它」。

**為什麼不是「斷言失敗時立刻印」**：#19 那七條分佈在三支探針的不同段落，逐條印會把 dev 模式
本來就吵的 Vite 訊息鋪滿輸出。以段落收口，一段只印一次。

**為什麼不是「只在段落 throw 時印」**：#19 那七條**是斷言紅、不是例外**。只接 throw 就採不到
它們 —— 而它們正是這一項的目標。

### D7：`MOUNTED` 參與的斷言，求值一次、detail 取自那一次

`probe-keyboard.mjs` 那條「repo 只有一個 session 時 `Ctrl+Tab` 為無操作」（`check(` 開在 `:963`，
行內的 `evaluate(MOUNTED)` 在 `:966`）把求值寫在**條件運算式裡**，detail 只有 `shell 1 → shell 1`。
改為先求值成變數、條件用它、detail 走 `describeMounted()` —— 與同一支已經修好的那條（`:954`）一致。

這不是新規格，是既有 requirement（「多子條件的狀態判定，其 detail 必須取自做出判定的那一次
求值」）的實作缺口。**既有的 `check-detail` 守衛看不見它**：那道守衛只問「有沒有 detail」，
不問「detail 涵不涵蓋每個子條件」。**不擴充守衛** —— 要判斷「這個 detail 有沒有涵蓋那個子條件」
需要語意分析，做出來會誤判，而**一個會誤判的守衛遲早會被加上例外開關，例外開關會被用在不該用
的地方**（這條紀律就寫在 `probe-execution-scope` 現行條文裡）。改用一次全域掃描把同型的站點
清乾淨，並在 spec 上留下「同源求值」這條既有要求。

### D8：issue #19 要求的四樣現場資料，交付三樣、拒絕一樣，各有理由

#19 的建議 1 要 dump 四樣：`document.readyState`、`#root` 的子節點**數量**、最近一次
`did-navigate`、console error。第一版只處理了 console，其餘沒有交代 —— 那正是這個 repo 記載了
四次的「宣稱覆蓋而實際沒有」。逐樣拍板：

| 要的東西 | 交付 | 理由 |
|---|---|---|
| console error | ✅ D6 | 本 change 的主體 |
| `document.readyState` | ✅ | 一行，且**必須與判定同源**（放進 `MOUNTED` 那一次求值，不是失敗後再問一次） |
| `#root` 子節點數量 | ✅ | 同上。**現況拿不到**：`mounted.mjs:36` 把每個子條件 `Boolean(...)` 掉了，`root` 只剩真假 |
| 最近一次 `did-navigate` | ❌ | 它是**主行程**的 `webContents` 事件，renderer 求值看不到它。要讓探針拿到就得在 `src/` 印出來 —— 那違反「產品程式碼零改動」，而且是為了驗收改產品。CDP 端的近似物 `Page.frameNavigated` 不等價：導航防護擋下所有導航，dev 的 HMR 也不走它 |

**加診斷欄位會動到 `MOUNTED` 的形狀，要區分兩種欄位。** 現在每個欄位都 `Boolean()` 且都參與
`ok = every(Boolean)`；數量與 `readyState` **不能參與判定**（`readyState === 'complete'` 不是
掛載的必要條件，把它加進 `ok` 會改變七條紅的判定本身，那會污染 #19 的對照）。因此
`mountedExpression` 要分成「參與判定的子條件」與「只帶回不判定的診斷值」兩類，`describeMounted`
把後者附在訊息尾端。**既有 `cdp.test.mjs` 對 `describeMounted` 的四條測試是這次改動的對照組** ——
它們必須仍然通過。

## Risks / Trade-offs

- **`Runtime.enable` 改變被觀測者** → 探針本來就以 CDP attach 進 renderer，`enable` 只是開啟事件
  推送，不經過任何產品程式碼路徑，也不需要在 `src/` 加測試分支。**但它不是零成本**：Chromium 會
  為 console 訊息保留物件引用。**這個風險的真正承擔者是「#19 的七條紅在交付後仍然紅」那條驗收**
  —— 一個為了觀測而改變被觀測者的機制，去診斷一個觀測不到的病，唯一的保險是**確認那七條沒有
  因為它而移動**。斷言數與段落耗時的比對太鈍（它們對「紅燈換了一條」無感），只能當輔助。
- **dev 模式的 console 噪音淹掉訊號** → 層級過濾 + 只在該段有失敗時輸出。若實測仍吵，收窄到
  `error` 一級（先做寬的，因為 Vite 的模組載入失敗有些走 `warning`）。
- **port 檢查誤判成失敗**（前一支尚未收乾淨）→ D4 的退避；失敗訊息載明已等待時間。
- **前置檢查有 TOCTOU 缺口** → 檢查通過之後 port 才被搶走（或 app 因無關原因死掉），症狀又變回
  那句 30 秒逾時。**它結構上補不掉**，但補償很便宜：在 `waitForPageTarget` 的逾時訊息裡**再查一次
  持有者**。那涵蓋了前置檢查涵蓋不到的每一種情形，約五行。
- **八支探針改 port 常數引入靜默退步** → 回歸基準是 build 模式的斷言總數與通過數一致
  （`probe-execution-scope` 對段落切分已有同型的條文：**SHALL NOT 以含 dev 的總數判定**，
  隔離會讓此前未執行的段落開始執行）。
- **`ss` 在別的機器上不存在** → 判定不依賴它（D3）；歸因降級為一句「查不出持有者」。
- **本 change 修不掉 #19** → 這是刻意的。交付之後要跑一輪 dev 採樣，把採到的東西貼回 #19；
  **若採不到任何 console 錯誤，那本身就是結論**（renderer 沒掛載的原因不在 console），
  而目前連這個否證都做不到。

## Migration Plan

純腳本改動，無資料格式、無產品程式碼。回退即 revert 該 commit；port 表回退時八支探針一併回退
（它們是同一次改動的兩半）。

## Open Questions

1. **console 環形緩衝的容量與層級**：起手 `error` + `warning` + uncaught exception，每段最近 20
   筆。實測 dev 一輪之後再收窄。
2. **`probe-identity` 的兩個 port 取哪兩個**：9221 與 9231 —— **刻意不相鄰**，理由見 D2
   （相鄰會讓下一個 `+1` 的寫法直接撞上隔壁那一支，而現在這個缺陷正是這樣來的）。
3. **`Log.enable` 的重播是否涵蓋 connect 之前的 console API 呼叫**：**必須實測**（見 D6）。
   涵蓋 ⇒ 驗收以「模組作用域發出的訊息」為標的；不涵蓋 ⇒ 把限制寫進 spec。
4. **`ports.mjs` 不得為 `core` / `native` 建立條目**：`probe-core` 的驗收內容之一就是
   「主行程不開任何 TCP 埠」（`probe-core.mjs:103-146`）—— 給它一個 debugging port 會讓它
   **依設計失敗**。表上要有一行註解擋住這個「順手補齊」的直覺。
5. **前置檢查是否涵蓋 `probe:package`**：它不吃 `out/`（豁免產物檢查），但它**用 9240 且會啟動
   真 AppImage** —— port 檢查對它同樣有效，納入。附帶承認一個不對稱：它自己的產物（AppImage）
   因此**沒有存在性檢查**，與現行 spec 的寫法一致，但值得寫明。
