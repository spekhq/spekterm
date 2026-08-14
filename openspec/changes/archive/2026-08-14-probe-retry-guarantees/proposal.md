## Why

探針裡「**點一個入口、等選單出現、點其中一項**」這件事有 **8 個各自為政的實作**，加上形狀相同
的第 9 個（CDP 握手）。它們對同一種競態給出九個不同的答案：

| 站點 | 輪數 | 一輪的內層預算 | 最終姿態 |
|---|---|---|---|
| `probe-openspec.mjs:1087` `createSession` | 3 | **15s**（`stableRect`）+ 2s | throw ⇒ 段落中斷 |
| `probe-openspec.mjs:1182` `anchorChange` | 3 | 8s + 6s | 回傳實際值 ⇒ 斷言紅 |
| `probe-terminal.mjs:789` `openTabMenu` | 5 | 1.5s + 0.2s | throw |
| `probe-terminal.mjs:1097` `openSessionViaRail` | **1** | 8s + 3s + **一次求值** | throw |
| `probe-terminal.mjs:1110` `openSessionViaMenu` | **1** | 10s + 3s + **一次求值** | throw |
| `probe-keyboard.mjs:508` `createSession` | **1** | 10s + 3s | throw |
| `probe-keyboard.mjs:2074` 全域入口（行內） | **1** | 10s + 6s | throw |
| `probe-package.mjs:309` 全域入口（行內） | **1** | 15s + 6s | throw |
| `scripts/lib/cdp.mjs:124` `connect()` 握手 | **1** | 30s 握手 | throw |

**六個完全不重試。** 而 issue #17 與 #19 記載的兩次中斷，正好一個出自有重試的
（`probe-openspec` 的 `createSession`，「選單中找不到 shell」），一個出自不重試的
（`probe-terminal` 的 `openSessionViaMenu`，「選單中找不到『Login shell』」）。

### 兩個站點有一個可指認的缺陷，不只是策略不一致

`openSessionViaRail` 與 `openSessionViaMenu` 等到**選單容器**出現之後，用**一次 `evaluate`**
讀其中的項目（`probe-terminal.mjs:1103, 1119`）—— 沒有任何等待。**選單已開、項目那一刻還沒
渲染**，就直接 throw。這正是 #19 記載的那個中斷訊息的形狀。

### 變因不是機器，是每一輪自己

開發與驗收一直在同一台機器上，同一份程式碼時綠時紅。變的是每一輪：pty 什麼時候吐出標題、
側欄什麼時候因為掃描回來而重繪、以及那一輪 renderer 的呈現有沒有被節流。

**所以「把 3 調大」是錯的方向。** 對於 #17 那次中斷，目前最強的解釋是該輪 renderer 的
`requestAnimationFrame` 停擺 —— 但 **issue #17 明記那是假說**：「迄今沒有任何一輪同時觀測到
hidden 與那些紅」，而那次現場採自一輪 37/37 全綠的執行。若該假說成立，每一次重試都在等一個
不會發生的重繪，多少次都不夠；若不成立，我們至今不知道那次為什麼中斷 —— **兩種情形都指向同
一件事：缺的不是次數，是失敗當下的現場。**

### 真正缺的是失敗當下的現場

`probe-timing-guarantees` 已經替**等待**做過這件事：掛載判定帶回 frame 診斷，等不到掛載時說明
「沒有任何 frame 被產生」及其後果。**開選單這一族沒有對應物。**

#17 的建議 1（失敗前 dump 選單診斷）提出至今**一次現場都沒採到** —— issue 原文與其後的 comment
兩處都記著這件事，而九個站點裡沒有任何一個有 dump。少了它，下一次撞到仍然分不出「競態沒收斂」
與「那一輪畫面沒有更新」，而兩者要修的是完全不同的東西。

### 而既有守衛結構性地看不見這一族

`scripts/wait-source.test.mjs` 的判準涵蓋「時限寫在迴圈條件」與「時限寫在迴圈體內」兩種形狀，
但固定次數的重試迴圈裡**根本沒有時限判斷**，零次重試的站點更是連迴圈都沒有 —— 它們不在那道
守衛的定義域內。

## What Changes

- **這一族收斂為單一原語**，實作為既有 `pollFor` 的**組合**（外層 `pollFor` 的讀取 ＝
  「做一次動作 ＋ 等一個內層窗口」），而非第二份等待迴圈的實作。因此既有 requirement
  「等待必須經由單一原語實作」與 `wait-source.test.mjs` 的原語豁免**都不必改動**。
- **上界改以時限表達，且顯式。** 這條的價值**不是宣稱新數字更對** —— 是讓「等多久才算真的
  壞了」成為一個寫得出來、可論證的決定，取代九個藏在乘法裡、彼此不知道對方存在的答案。
  各站點的起點是它今天的實際上界（見 design D6）。
- **`openSessionViaRail` 與 `openSessionViaMenu` 讀項目的那次 `evaluate` 改為等待** ——
  這是一個可指認的缺陷，不是策略問題。
- **最終放棄前留下現場。** 由原語承擔，不由某個站點的一段程式碼承擔 —— 現場的價值只在失敗
  那一次兌現，掛在單一站點上，下一個站點就得重新記得一次。
- **`connect()` 的握手從零次重試改為受同一條紀律約束**，並帶主詞地失敗。連帶處理一個既有的
  結構問題：交給它的 target 是**一次性快照**，target 若已消失，重試同一個位址永遠不會成功。
- **守衛**：手寫的固定次數重試無法通過 `npm test`，且不誤判**遞增**與**重複**兩類計數迴圈。

**不做**：`run-probes.mjs` 兩支之間留冷卻（#17 建議 3）。理由不是「根因已確立」（見上，那是
假說），而是該建議自己的前提（負載）已被 `probe-timing-guarantees` 的量測削弱，且它的成本
落在每一輪完整驗收上。

**本 change 不宣稱**：它不會讓 #7 / #17 / #19 記載的中斷消失，也不宣稱知道那些中斷的成因。
它讓下一次中斷**說得出自己是哪一種**，並讓九個站點第一次有一個共同的、可論證的預算。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `probe-execution-scope`: 新增四條要求 —— 帶副作用的重試經由單一原語且以時限為界、重試最終
  失敗必須留下現場、建立連線必須先重試且失敗可歸因、收斂不得改動斷言。
  **既有條文無一需要改動**：新原語是 `pollFor` 的組合（不觸及「等待必須經由單一原語實作」），
  `connect()` 維持單次語意（不觸及「連線的建立本身受時限約束」），而新入口的三層時限關係
  由新要求自己承載（見 design D7）。

## Impact

- `scripts/lib/instrument.mjs` —— 新的重試組合子（以 `pollFor` 實作）
- `scripts/lib/cdp.mjs` —— 新的連線入口；`connect()` 本身不動
- `scripts/probe-openspec.mjs`、`scripts/probe-terminal.mjs`、`scripts/probe-keyboard.mjs`、
  `scripts/probe-package.mjs` —— 八個開選單站點
- `scripts/wait-source.test.mjs` 或新增同族守衛 —— 判準
- `scripts/cdp-transport.test.mjs`、`scripts/instrument.test.mjs` —— 新行為的單元測試
- `docs/lessons/probes.md` —— 原語的分工、四類計數迴圈、以及守衛涵蓋不到的那一類
- **產品程式碼零改動。**

**回歸的成本**：八個站點分佈於四支探針，其中 `probe:package` **不在 `test:e2e` 之內**
（CLAUDE.md 明載它自成第三個成本層級），必須另外跑一次。`connect()` 的新入口有 **8 個呼叫端**，
其中 7 支在 `test:e2e` 內、第 8 支是 `probe:package`。
