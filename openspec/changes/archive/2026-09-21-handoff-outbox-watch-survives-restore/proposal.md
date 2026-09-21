## Why

**一則交接可以被寫進落點、通過所有驗證、然後永遠不被偵測到** —— 只要它的來源 session 是
「app 啟動時被還原回來的」。dogfood 當場踩到：兩份合法的交接躺在落點裡，目標 repo 什麼都沒
發生，來源 agent 回報它已經交接出去了。

根因在落點的**建立**，不在監看。`prepareOutbox()` 於每次 spawn 把該 session 的落點
**整個刪掉再重建**（清掉上一輪的殘留），而落點的監看是在 app 啟動時一次掛上的 ——
它綁定的是**那一個目錄**，不是那個路徑。刪掉再重建之後，路徑同名而對象已換，監看者
留在一個不再有任何動靜的舊對象上，**該 session 的落點從此不再被監看，直到下次重啟**。

實測（chokidar 5，`depth: 1`，對照組）：

| 落點的準備方式 | 其後寫入的投遞 |
|---|---|
| 現況：刪掉落點再重建 | **收不到任何事件** |
| 保留落點本身、只清掉其中的項目 | `add` 正常 |

現場亦已驗證：同一份投遞檔放進**啟動後才新建的** session 落點，3 秒內被處理；放進**被還原的**
session 落點，5 秒後原封不動。

**觸發條件是「落點在被監看之後又被重新準備」，而它最常見的形式就是 session 被還原** ——
啟動時監看先掛上上一輪留下的落點，接著還原逐一把它們刪掉重建，於是**每一個被還原的 session
都失效**。（它不限於還原：任何會讓 session 重新 spawn 的路徑都算，例如 renderer 重新載入。）
這個缺陷一路躲過驗收：既有的單元測試與探針都在「**落點是新建的**」那一側驗，
而那正是唯一不受影響的情形。

## What Changes

- **落點的準備不再移除任何東西**：不存在時建立，已存在時就讓它保持原樣。被監看的對象因此
  不可能被換掉。**清除殘留這個動作整個移除** —— 它清得到的只有「同一個 session 上一輪的殘留」，
  而那正是啟動掃描本來就會讀到的東西；它碰不到真正沒人清的孤兒落點（見 design D2）。
  移除它同時關掉一個既有的資料損失：一則**尚未被消費**的待處理交接不再會在下次 spawn 時被銷毀。
- **補一條 requirement**：session 的落點在**它被重新準備之後**仍 SHALL 被偵測 —— 現行規格只說
  落點「每個 session 各一、隨 session 結束而清除」，對「重建之後還算不算數」完全沉默，
  於是實作可以合乎規格而失效。
- **補上載體**，且載體 SHALL 在「落點曾被重新準備」的情境下驗（新建落點的情境驗不出這件事）：
  主行程的單元測試、`probe-intake.mjs` 的**新增段落**，以及一條直接釘住「落點沒有被換掉」的
  結構判準（見 design D5）。
- 更新 `docs/lessons/handoff.md`：「清除落點殘留的作法會決定監看還在不在」。

**現場那兩份投遞已經自行結清**：使用者重新啟動應用程式之後，啟動掃描把它們撿起來並各建立了
一個 session。它們不需要任何一次性處置 —— 那正是掃描存在的理由。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `agent-handoff-source` — 新增一條 requirement「落點的偵測不因它被重新準備而失效」。
  **以 ADDED 而非 MODIFIED 既有的「投遞落點為每個 session 各一…」那一條** —— 它是一個新的
  關切（落點被重新準備之後還算不算數），不是既有行為的改變，且獨立成條才在 scenario 對照表上
  追得到。

## Impact

- `src/main/handoff-outbox.ts` — `prepareOutbox()` 的清除作法。
- `src/main/handoff-service.test.ts`（或 `handoff-outbox` 的單元測試）— 還原情境的載體。
- `scripts/probe-intake.mjs` — **新增一個段落**（既有的 `runHandoff` 其來源 session 是啟動之後
  才建立的，屬於不受影響的那一側，塞不進去），並登記進段落清單。
- `scripts/intake-control-groups.mjs` — 對應的 mutation（把清除改回「刪掉再重建」必須變紅）。
- `scripts/scenario-coverage.test.mjs` — 新 scenario 登記與 `COVERED_CHANGES`。
- `docs/lessons/handoff.md` — 新增一節。

**不受影響**：`agent-events.ts` 有同樣的「刪掉再重建」寫法，但它的讀取走 `readdirSync` 輪詢
而非監看，不具備這個失效方式。
