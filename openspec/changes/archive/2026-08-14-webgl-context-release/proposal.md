## Why

`terminal-sessions` 已有一條 requirement：「程式化繪製的渲染資源僅供當下顯示的終端」——
**由顯示轉為隱藏時 SHALL 釋放之**。它的理由段落把機制寫得很完整：該資源有並存數上限，
「超出上限時最早取得的會被靜默回收 —— 不觸發任何可觀察的事件」，於是較舊的終端會**無聲地
變成空白**，而自癒的降級路徑救不了它（那條自癒倚賴一個失效通知，這裡沒有通知）。

**問題是「釋放」沒有真的發生。** 實作呼叫 `WebglAddon.dispose()`，而該套件的原始碼裡
`loseContext` 與 `WEBGL_lose_context` 各出現 **0 次** —— `dispose()` 只解除掛載，context 的
回收交給 GC，而瀏覽器的額度檢查是**即時**的。已 dispose 但尚未被 GC 的 context 仍佔著額度。

實測（Electron 43，含對照組）：建滿 16 個並保留參照，釋放前 8 個，再建 8 個新的，
檢查**仍持有參照**的那 8 個是否存活：

| 釋放方式 | 保留中的 8 個 |
|---|---|
| 僅解除參照（＝現況 `dispose()`） | **0 個存活** |
| `loseContext()` | **8 個全部存活** |

**而現有的驗收判準看不見這個差別。** 該 requirement 的「持有」判準取自「隨路徑切換而建立與
移除的**產物**」（DOM 上的 canvas）—— 產物確實被移除了，斷言因此全綠。**DOM 產物消失不等於
額度歸還**，這正是缺陷得以通過整輪驗收的原因。

**為什麼是現在**：追 #19／#21 的 dev 模式失敗時，`probe:terminal` 段落結束的 console 環形緩衝
裡**只有這一種訊息**在反覆出現（`Too many active WebGL contexts. Oldest context will be lost.`）。

## What Changes

- **終端於切換渲染路徑或銷毀時，主動釋放其 WebGL context**（`loseContext()`），而不只是解除
  addon 的掛載。
- **`terminal-sessions` 那條 requirement 的「釋放」判準補強** —— 現行判準取自 DOM 產物，
  而那看不見額度是否歸還。判準要能區分「產物移除」與「資源歸還」。
- **驗收要能重現「使用中的終端被擠掉」**，而不只是數 canvas。

**不做**：不改渲染路徑的選擇邏輯、不動自動降級、不碰 `terminal-preferences` 的 GPU 開關語意。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `terminal-sessions`: 修改「程式化繪製的渲染資源僅供當下顯示的終端」這條 requirement ——
  明確「釋放」是**歸還並存額度**而非移除 DOM 產物，並據此調整驗收判準。現行條文已要求釋放，
  但它的判準段落把「持有」定義成產物的存在與否，於是一個不歸還額度的實作能夠全綠通過。

## Impact

- `src/renderer/src/shell/terminal/xterm.ts` —— `setGpuRenderer(false)` 與 `dispose()` 兩條路徑。
- `scripts/probe-terminal.mjs` —— 既有的「渲染資源只給顯示中的終端」斷言需補強或增補。
- **一個關鍵未知，留給 design 以 spike 解決**：`WebglAddon` 的公開介面**不暴露** GL context 或
  渲染 canvas（`textureAtlas` 是字形圖集，不是渲染面）。取回它得靠終端的 DOM 結構，而那是對
  套件內部的依賴 —— 且 `dispose()` 之後那個 canvas 是否仍在 DOM 中尚未實測。取得的時機
  （dispose 前或後）會決定實作形狀。
- **驗收的形狀有一個反直覺處**：要驗「額度是否歸還」，被丟棄的那批 context 必須**比保留的那批
  更新**。否則 LRU 本來就會先淘汰被丟棄的那批，兩種實作的結果完全相同 —— 追 #24 時前兩版實驗
  正是這樣連續得到無鑑別力的結果，差點據此推翻一個正確的假說。
