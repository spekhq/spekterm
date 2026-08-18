## 1. 查明機制與上游狀態

- [x] 1.1 定位缺陷：`WebglRenderer._cursorBlinkStateManager` 是該類別中唯一未交給 disposable store 的 `MutableDisposable`
- [x] 1.2 確認上游已修（xtermjs/xterm.js#5818，2026-04-21）且修正只在 beta channel
- [x] 1.3 回報上游：所倚賴的版本在虛擬螢幕環境下游標閃爍不啟動（xtermjs/xterm.js#6113）

## 2. 量測基礎（完整程式碼保存於 issue #29 的留言，未進 repo）

- [x] 2.1 攔截 `setInterval` / `clearInterval` 的計數輔助
- [x] 2.2 機制中立的交叉檢查：暫時攔截 `requestAnimationFrame` 取樣後還原
- [x] 2.3 探針段落 `runBlinkTimerRelease`
- [x] 2.4 **不併入 repo** —— 所倚賴的版本上無法武裝（見 design R2），留著即是死程式碼

## 3. 對照組 —— 已實測

- [x] 3.1 退回 `@xterm/addon-webgl@0.19.0` 並 `npm ci`，確認缺陷確實在產物中
- [x] 3.2 以**點擊**操作跑段落：七條全綠 —— **發現操作方式會掩蓋缺陷**（design R1）
- [x] 3.3 改為**鍵盤**操作跑段落：承重斷言正確變紅（殘留一個 600ms 計時器）
- [x] 3.4 確認代理守衛的對照組：退回 `0.19.0` 時 `xterm-blink-release.test.mjs` 變紅

## 4. 出貨的守衛

- [x] 4.1 新增 `scripts/xterm-blink-release.test.mjs`：安裝的產物必須含該修正
- [x] 4.2 同檔第二條：`@xterm/*` 版本一律釘死，不得浮動（它們在每日發版的 channel 上）
- [x] 4.3 該守衛自帶一條防失準的斷言（欄位名不存在時變紅，而非誤判為「修正還在」）

## 5. 規格

- [x] 5.1 `terminal-sessions` 以 MODIFIED 擴充「釋放」的定義，涵蓋週期性工作
- [x] 5.2 寫入「驗收 SHALL 以鍵盤操作進行」—— 點擊會掩蓋缺陷，這是任何未來實作的前提
- [x] 5.3 寫入「自動化驗收全綠 SHALL NOT 被詮釋為本條成立」，並逐條標示 scenario 的驗收指認

## 6. 缺口登記

- [x] 6.1 開 issue 追蹤行為層級的驗收缺口，含重現條件（鍵盤操作）、現成段落的位置、上游 #6113 的連結
- [x] 6.2 於 issue #28 更新：機制已由依賴升級解決，行為層級驗收缺口另案追蹤

## 7. 文件

- [x] 7.1 `docs/lessons/terminal.md`：渲染路徑持有的第三種資源、`@xterm/*` 釘在 beta channel 的理由與解除條件
- [x] 7.2 `docs/lessons/probes.md`：**操作方式會決定缺陷出不出現** —— 點擊與鍵盤在焦點語意上不同，而失焦會清掉待驗的狀態；以及「門檻不得寬於它要偵測的訊號」

## 8. 驗收

- [x] 8.1 `npm test`、`npm run lint`、`npm run typecheck` 全綠（取 exit code）
- [x] 8.2 `npm run test:e2e` 全綠（確認移除段落後既有探針未受影響）
