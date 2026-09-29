# Tasks

## 1. 失效的第五種：`rate_limited`

- [x] 1.1 `src/main/slack-api.ts`：429 的回傳由 `{ kind: 'transient', error: 'rate_limited' }`
      改為 `{ kind: 'rate_limited', error, retryAfterSeconds? }`；`SlackFailure` 的聯集加這一支
- [x] 1.2 **把五個對 `kind` 的比較逐一走過**（design D2 的表；TypeScript 一條都不會攔）：
      - [x] 1.2.1 `slack-service.ts` 的即時連線早退 —— **不加入** `rate_limited`（速率上限與
            即時連線無關，加了會把一個自癒的情形升級成「連線也不要開了」）
      - [x] 1.2.2 `slack-service.ts` 的 `#merge` —— 同 kind 同 error 才合併，自動涵蓋，確認無需改
      - [x] 1.2.3 `slack-service.ts` 的 `needed` 取值 —— 只有 `scope` 有，確認無需改
      - [x] 1.2.4 `slack-backfill.ts` 的 `NameCache` —— `auth` 時整份放棄，**`rate_limited` 也要**
            （否則被限流之後還會繼續打 `users.info`）
      - [x] 1.2.5 `SlackSettings.tsx` 的 `statusCopy` —— 見第 4 組
- [x] 1.3 `slack-api.test.ts`：429 判為 `rate_limited`（不是 `transient`）且帶 `Retry-After`；
      **無 `Retry-After` 的 429 仍為 `rate_limited`**（缺席不是「不是速率上限」）

## 2. 一輪之內：被拒絕即停止其餘目標

- [x] 2.1 `slack-backfill.ts`：逐頻道迴圈在 `scanned.failure?.kind === 'rate_limited'` 時**中止**，
      不是 `continue`
- [x] 2.2 **把這條路徑上所有早退 grep 一遍**（CLAUDE.md 記載重演過的形狀）：新的中止必須排在
      `delivered >= deps.maxPerRound` 與既有的 `failure ??= … continue` **之前**判斷 ——
      否則「上限已滿」會先把它吞掉
- [x] 2.3 `BackfillOutcome` 新增 `retryAfterSeconds?: number`（design D1：**不寄生在 `failure`
      上**，那個欄位是「先到的贏」，早一步的網路錯誤會讓 429 永遠讀不到）
- [x] 2.4 **水位語意不得被中止動到**：已掃完的頻道照常前進、未掃的下一輪重來
- [x] 2.5 `slack-backfill.test.ts`：中止之後 `api` 收到的 `conversations.history` 次數等於
      「到被拒絕的那一個為止」**且不等於頻道總數**（後半句是承重的 —— 少了它，一個
      「一個頻道都沒掃」的實作照樣綠）
- [x] 2.6 `slack-backfill.test.ts`：中止那一輪已交付的部分與其水位不回退

## 3. 跨輪：退避期內不開始新的一輪

- [x] 3.1 `slack-service.ts`：`SlackRuntime` 持有退避截止時間，**時間一律取自 `deps.now()`**
      （直接呼叫 `Date.now()` 會讓假時鐘測不到，而症狀是測試通過但行為錯）
- [x] 3.2 `runRound()` 在截止時間之前直接返回；**被跳過的那一輪不排隊補做**（design D5）
- [x] 3.3 退避秒數的夾制：缺席或非有效值 ⇒ 60 秒；下界 1 秒；**上界 15 分鐘**
      （design D4 —— 端點是使用者可設定的，一個回極長值的端點會讓這個能力永久停擺）
- [x] 3.4 `SlackStatus` 帶得出「正在退避，下次嘗試時間」給呈現層用
- [x] 3.5 `slack-service.test.ts`（假時鐘）：退避期內的週期不跑、**期滿後的週期會跑**
      （後半句少了就永久停擺也是綠的）
- [x] 3.6 `slack-service.test.ts`：極長的 `Retry-After` 在上限之後恢復
- [x] 3.7 `slack-service.test.ts`：跳過一輪之後，該期間發生的提及在下一輪仍被交付
      （**「跳過」與「漏掉」是兩件事**的唯一載體）

## 4. 呈現

- [x] 4.1 `SlackSettings.tsx` 的 `statusCopy` 新增 `rate_limited` 分支，帶「下次嘗試時間」
- [x] 4.2 `src/shared/i18n/en.json` 新增對應 key（**文案為英文且只能來自字典**）
- [x] 4.3 **使用者觸發撞上退避期時畫面要變**（design D6）：存下憑證之後的呈現不得停留在操作
      之前的樣子 —— 靜默跳過會讓「失效與閒置必須可區分」在這條路徑上作廢

## 5. 替身與探針

- [x] 5.1 `scripts/lib/stub-slack.mjs`：支援「第 N 次 `conversations.history` 回 429 +
      `Retry-After`」。`respond()` 已能回 `status`，但 `writeHead` 目前寫死 header ——
      要讓它帶得出 `retry-after`
- [x] 5.2 `scripts/probe-slack.mjs` 新增一段：被拒絕之後該輪對 `conversations.history` 的呼叫數
      **等於 N 而非頻道總數**（design D7 —— 這件事在收件匣上看不見，可觀察面在替身端）
- [x] 5.3 該段要有**足夠多的頻道**（至少 3 個，且 N < 頻道數），否則「中止」與「跑完」結果相同
      （比照拖曳排序那條紀律：兩個項目時兩種語意看不出差別）

## 6. 對照組（`scripts/slack-control-groups.mjs`）

- [x] 6.1 把中止改回 `continue` ⇒ 5.2 那條變紅
- [x] 6.2 拿掉跨輪的閘 ⇒ 3.5 變紅
- [x] 6.3 把 `rate_limited` 併回 `transient` ⇒ 1.3 變紅
- [x] 6.4 拿掉上界夾制 ⇒ 3.6 變紅
- [x] 6.5 **原訂的「跳過時順手推進水位」在這一層表達不出來** —— 退避的閘在 `SlackRuntime`，
      而它根本不碰水位（水位在 `runBackfill` 之內）。改為兩個實際可表達的：
      「期滿後不清退避時間」（永久停擺）⇒ 3.5 的後半句變紅；
      而水位不回退那一半由 2.6 的 `**中止不使已完成的工作回退**` 承擔
- [x] 6.7 **`rate-limit-keeps-scanning` 指名的斷言要是「恰為 2 次」那一條** —— 實測：
      該 mutation 只拿掉迴圈內的中止，底部那個還在，呼叫數是 3，「≠ 頻道總數」紅不起來。
      「≠ 頻道總數」的對照組是另一個 mutation（`rate-limit-never-aborts`，中止整個不發生）
- [x] 6.8 **順帶修掉兩個已經對不上原始碼的既有 mutation**（`auth-merged-into-transient`、
      `failure-not-merged`）—— 上一個 change 改了那兩處而沒有更新對照組腳本，
      **而那支腳本沒有人跑，所以沒有紅燈**
- [x] 6.6 **每一個都要真的跑過並確認指名的那條斷言變紅**（不是只寫下來）
- [x] 6.9 16 個對照組全部跑過，**全部如預期變紅**
- [x] 6.10 加一道**真的守衛**：`scripts/control-groups-source.test.mjs`（進 `npm test`）——
      每個 mutation 的 `from` 在原始碼中**恰有一處命中**、`from !== to`、且指名了斷言。
      兩支對照組腳本改為只在被直接執行時才跑，好讓守衛 import 得到 `MUTATIONS`。
      對照組驗過：把一個 `from` 改成對不上 ⇒ 該守衛變紅

## 7. scenario → 載體對照表

- [x] 7.1 `scripts/intake-coverage.test.mjs`：`COVERED_CHANGES` 加入 `slack-rate-limit-backoff`
- [x] 7.2 新增 **7 列**（本 change 新增的 scenario；另外 8 條是既有原文照抄，已有列）
- [x] 7.3 `greenIfAbsent` 與 `mutation` 兩欄逐條填**實際查證過的**內容 ——
      不是憑印象（上一次填 57 列時守衛抓到 5 個憑印象填的標籤）

## 8. 文件與收尾

- [x] 8.1 `slack-service.ts` 的 `ROUND_INTERVAL_MS` 註解：解除「縮短之前先看 issue #46」那句
      前置條件，改為指向本 change 交付的退避機制
- [x] 8.2 `docs/lessons/slack.md` 新增一節：對端要求延後時要真的等，以及**「先到的贏」的失效
      欄位會讓後到的 429 靜默消失**這個形狀
- [x] 8.3 關閉 issue #46（指向本 change）—— 已於 `74daa7d` 關閉

## 9. 驗收

- [x] 9.1 `npm test` 全綠 —— **1189/1189**
- [x] 9.2 `npm run probe:slack` 全綠 —— **29/29**（新段落 4 條）
- [x] 9.3 `npm run typecheck` 與 `npm run lint` 乾淨
- [x] 9.4 `npm run test:all` 全綠（封存前）—— **13/13**
- [x] 9.5 **本 change 不做 dogfood**，使用者裁決（2026-09-14）。理由：本 change 唯一改變的
      行為只在「被限流時」發生，而**真實的 429 在 dogfood 中造不出來**（要真的去撞 Slack 的
      速率上限）。「沒被限流時行為不變」由既有的 29 條 `probe:slack` 斷言涵蓋 —— 它們走的
      就是同一條回補路徑。強迫一次換版換不到額外的資訊。
      退避本身的載體是替身（`conversations.history` 的第 N 次回 429）與假時鐘，
      而**「真實服務的驗證載明為未涵蓋」這條缺口本來就寫在規格裡**，本 change 未擴大它
