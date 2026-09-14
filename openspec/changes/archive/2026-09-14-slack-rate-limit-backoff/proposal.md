# 對端說「等一下再來」時，要真的等

## Why

Slack 以 **HTTP 429 ＋ `Retry-After`** 告訴我們何時可以再來。這個標頭**目前被解析了，
但全 repo 沒有任何消費點**（`src/main/slack-api.ts:164` 寫進 `retryAfterSeconds`，
`grep -rn retryAfterSeconds src/` 只命中型別宣告與那個產生處）。於是被限流時，系統的行為是
**照原節奏繼續敲一個正在說「等一下」的服務**。

而追這件事時發現它比 issue #46 寫的更嚴重：`runBackfill` 的逐頻道迴圈在某個頻道失敗時
**只記下第一個 failure 就 `continue`**（`slack-backfill.ts:129-132`）。被限流的因此不只是
「下一輪」—— **這一輪剩下的每個頻道都會照樣打，而每一個都會再被 429**。一個 30 個頻道的
使用者在第 5 個頻道被限流，我們還會再送 25 次註定失敗的請求。

**為什麼是現在**：五分鐘的輪詢間隔讓這件事目前不痛（每分鐘最多一輪），而那正好讓它成為一個
**沒有人會踩到、但擋住下一步**的缺陷 —— `ROUND_INTERVAL_MS` 一旦要縮短（dogfood 當天使用者
就問了「五分鐘超久」），它立刻變成主動加劇問題的來源。**先補這條，縮短間隔才是安全的操作。**

## What Changes

- **`SlackApi` 的 429 回應保留現狀**（解析正確、已有測試），改動全在消費端。
- **一輪之內：被限流即停止該輪的其餘頻道**，不再逐一送出註定失敗的請求。該輪以既有的
  `transient` 失效回報，水位與已交付的部分不受影響（既有語意：水位只前進到已處理完的位置）。
- **跨輪之間：在 `Retry-After` 指定的時間之前不開始新的一輪。** 週期輪詢到期時若仍在該時間
  之內，這一輪**跳過**而不是排隊補做 —— 補做會在解禁的那一刻形成尖峰，正是限流要避免的事。
- **使用者明確操作的那次觸發不被靜默吞掉。** 存下憑證會觸發一次取回；若當下正在退避期內，
  系統 SHALL 讓使用者看得出「已收到你的操作，但要等到某個時間才會去試」——
  **靜默不動與「功能壞了」在畫面上完全相同**，而那正是這個能力花了一整條 requirement 在防的事。
- `Retry-After` 缺席或不是有效秒數時（實測 Slack 不保證一定帶），退避時間 SHALL 有一個保守的
  預設值，而非視為零。

## Capabilities

**New Capabilities**: 無。

**Modified Capabilities**:
- `slack-intake-source` —— 「應用程式未執行期間的提及不遺失」那條目前只說取回 SHALL 週期性
  重複；要加上「對端要求延後時 SHALL 尊重它」這一維，以及使用者觸發與退避相遇時的可見性。
  「連線與授權的失效對使用者可見」那條可能也要一句話區分「正在退避」與「失效」。

## Impact

- `src/main/slack-backfill.ts` —— 逐頻道迴圈的早退條件（**這是一個「替既有操作加上第二個
  狀態」的改動**，CLAUDE.md 記著這一類要把路徑上所有早退條件 grep 一遍）。
- `src/main/slack-service.ts` —— `SlackRuntime` 持有退避截止時間；`runRound()` 的閘；
  `ROUND_INTERVAL_MS` 那段註解指向的前置條件可以解除。
- `src/renderer/src/shell/intake/SlackSettings.tsx` ＋ `src/shared/i18n/en.json` ——
  「正在退避」的呈現（若裁決為要呈現）。
- `scripts/probe-slack.mjs`、`scripts/lib/stub-slack.mjs` —— 替身要能**回 429 並帶
  `Retry-After`**（目前不會）。
- 不動：`slack-api.ts` 的解析、收件匣的任何判斷、即時路徑（Socket Mode 不走這條速率上限）。
- 關閉 issue #46。
