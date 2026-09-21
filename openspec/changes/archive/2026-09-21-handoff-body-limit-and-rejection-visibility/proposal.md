## Why

2026-09-21 11:19，`billing-service` 的 agent 寫出一則交接（target 解析無誤、原子寫入無誤），
spekterm 在一秒內讀到它、**拒絕、刪檔**，然後什麼也沒發生。使用者是因為「目標 repo 沒有開出
新 session」才發現，而來源 agent 至今仍認為自己交接出去了。

成因是 `body` 5,719 字元超過 `MAX_BODY_LENGTH`（4,000）。這個上限的依據是**收件匣的人類
閘門** —— `intake-schema.ts:36` 的註解寫著「訂在『一個人會實際讀完』的量級，不是技術極限」，
`agent-intake-inbox` 的 proposal 寫著「在上限之內，投遞者仍決定使用者要掃過多少字 ——
人類閘門的有效性隨長度單調下降」。

**交接把那個前提拿掉了。** `firstPartyBody: true` 的投遞不經接受閘、到達即建立 session，
使用者不必逐字審查一份他自己交辦的工作。於是一個為「保護閱讀預算」而訂的數字，落在一條沒有
閱讀預算要保護的路徑上 —— 而交接的本文天然就是一份工作包（背景、查證數字、要讀的檔案、
紀律），5,719 字元不是異常值。

> **現況是一個有名字的裁決，不是疏漏。** `handoff-service.test.ts:287` 那條測試就叫
> 「本文超過長度上限的交接被拒絕 —— **不因投遞者是自己的 agent 而放寬**」。本 change 推翻它，
> 因此論證責任是「為何那個裁決錯了」，而不是「補一個被忘記的分流」。答案在上一段：
> 那條測試保護的是一道**在這條路徑上不存在**的閘門。

三個獨立的缺口疊起來才讓它靜默：

1. **上限的依據沒有隨 `firstPartyBody` 更換。**
2. **自我介紹沒有講出這個約束。** `handoff-intro.ts` 講了 target 的規矩與原子寫入的規矩，
   唯獨漏了長度。投遞者沒有回饋管道，**任何它無從得知的約束都是一條死路**。
3. **失敗對使用者不可見。** 見下。

> **「交接的失敗對使用者可見」這條既有 requirement，兩半都不成立 —— 而驗收全綠。**
>
> **通知那一半沒有實作。** `DeliverOutcome.notify` 只被寫入、從未被讀取；OS 通知唯一的觸發點
> 是 `onArrival`，而 `#emitArrival` 唯一的觸發點在 `deliver()` **成功新增紀錄之後**。
> `probe-intake.mjs:1539`「目標查無時發出通知」為綠，是因為它的 `before` 量在通知的固定合併窗
> （4 秒）還沒到期的時刻：把量測往後推 9 秒之後，它量到的那一則是 `"New handoff"`（該段稍早
> 接受的 intake），而 `miss.json` 讓通知數 **1→1**，斷言變紅。
> **連 `intake-schema.ts:102` 的型別註解都寫著「交接專屬的三種拒絕……因此它們會發通知」**
> —— 那句話描述的是一個從未存在的實作。
>
> **收件匣那一半不足以識別發生了什麼。** 拒絕的呈現只有一行「N 則投遞被拒絕」＋一顆清除鈕：
> 沒有類別、沒有時刻、沒有來源、沒有目標。而說明原因的文案（`intake.rejectReason`，11 條，
> 含 `TOO_LONG: 'too long to review'`）**在整個 repo 裡沒有任何消費者** —— 字典有、呈現沒接上，
> 而字典完整性的守衛只驗 key 對齊，不驗 key 有沒有被用到。
>
> 使用者實際的回報是：「收件匣沒看到剛剛的那份交接資料」。

## What Changes

- **本文長度上限依「本文是否為第三方逐字撰寫」分流，而 first-party 的依據換成
  「接手的 agent 要能一次讀完整份 context 檔」。**

  > **不是「不設上限」。** 依據換了，不是消失了。預填的 prompt 是 `Read <contextPath>`，
  > 本文大到讓接手的 agent 一次讀不完時，**收尾界線永遠不進脈絡**，「界線之外的不算數」
  > 靜默失效，它拿到的是半份工作包 —— 本 change 要消滅的失效形狀換一個位置重現。
  > **取值 20,000 字元，由實測得出**（Claude Code 2.1.278，見 `docs/lessons/handoff.md` 第八節）。
  > 門檻有三道：檔案 256 KB（硬失敗）、單次讀取 25,000 token（**靜默截斷**，最常先咬到）、
  > 行數 2,000。取的是實測中**完整讀取成功**的那一格，不是任何換算值 —— 三道門檻裡有兩道
  > 不以字元計。對照：今天那則被擋的交接是 5,719 字元。
  >
  > **效能不作為依據。** 已量測：真實量級（5,719 字元 × 50 則，0.45 MB）落盤 1.6 ms、
  > IPC 快照 0.7 ms；極端（250,000 字元 × 10 則，3.61 MB）13.2 ms / 6.8 ms。

- **`title` 的 200 字元上限不分流** —— 它是清單裡的一行，那**是**呈現預算。但它同樣產生
  `TOO_LONG`，因此它也必須被告知。
- **自我介紹列出所有會導致拒絕的約束，且該清單與實際生效的判定同源**（從常數推導，
  不手寫數字），並說明失敗是可達的結果。
- **交接路徑上的永久性拒絕納入「失敗對使用者可見」。** 判準改以「同一份投遞、在使用者不改變
  任何設定的情況下重送，會不會有不同結果」分流，取代目前按失敗**發生在哪一層**分流的實作。
- **失敗的呈現要能識別是哪一件事**：逐則說明類別、時刻、來源、目標原字串（接上既有的
  `intake.rejectReason` 文案），且**可逐則清除**（目前是一次清光）。
- **永久性拒絕的痕跡跨重啟保留。** 目前它只活在行程記憶體裡。
- **對照組先行。** 上面每一條都要有一個指名的 mutation 進 `intake-control-groups.mjs`
  （本 change 之前有 19 個），包含用來釘住通知缺口的那一個。

**BREAKING**：無。上限放寬與拒絕可見性都是單向擴大。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `agent-handoff-source`：
  - 「agent 於 session 啟動時被告知……」—— 告知的內容 SHALL 涵蓋所有會導致拒絕的約束，
    且 SHALL 與實際生效的判定同源。
  - 「交接的失敗對使用者可見」—— 適用範圍由**列舉五種失敗**改為**以永久／暫時分流**；
    加上「痕跡跨重啟保留」與「呈現要能識別是哪一件事」；
    並把 `PREFILL_UNAVAILABLE` 由可見失敗改列為暫時性（它取決於一個使用者可以打開的偏好）。
- `agent-intake`：
  - 「使用者在接受之前看得到本文全文，且本文以純文字呈現」—— 本文的長度上限 SHALL 依
    「本文是否為第三方逐字撰寫」分流，且 first-party 的上限依據 SHALL 為「接手的 agent
    要能一次讀完」。**全文不得截斷**（含已接受的項目），呈現的長度訊號涵蓋該路徑。
  - 「新項目到達時發出作業系統通知，且合併與總量皆有界」—— 自身 agent session 的拒絕發出
    通知這條既有例外，其作用域 SHALL 由「重送是否會有不同結果」判定；其內文 SHALL 只由系統
    文案與拒絕的類別構成；含失敗的合併通知其效果 SHALL 為打開收件匣。
  - **新增**「永久性拒絕於收件匣中的痕跡跨重啟保留，且可識別、可逐則清除」。

## Impact

**產品程式碼**

- `src/main/intake-schema.ts` —— 上限的作用域與分流
- **`src/main/intake-rejection.ts`（新檔）** —— 永久／暫時的分類函式。**它沒有留在
  `intake-schema.ts`**：定義域是一次投遞的結果而非拒絕的代碼（`DUPLICATE` 一個代碼兩種行為，
  見 design D2），而 schema 不該認得 service 的型別
- `src/main/intake-source.ts` —— 失敗通知的接線（**它才看得到 adapter，且兩條拒絕路徑都經過它**）
- `src/main/intake-service.ts` —— 痕跡的欄位、合併規則、落盤
- `src/main/handoff-service.ts` —— 把目標原字串交給痕跡
- `src/main/intake-notify.ts`、`src/main/index.ts` —— 失敗的通知內文與觸發目的地
- `src/main/intake-store.ts` —— 痕跡的落盤（**不 bump 版本**）
- `src/main/handoff-intro.ts` —— 自我介紹（英文，不進字典）
- `src/renderer/src/shell/intake/IntakeOverlay.tsx` —— `opened` 段落補長度與捲動；
  痕跡逐則呈現與逐則清除
- `src/shared/i18n/{en,zh-TW}.json` —— 痕跡的新文案（`rejectReason` 已存在，接上即可）

**驗收**

- `scripts/intake-control-groups.mjs` —— 四個新 mutation，並新增 `section` 欄位
  （對照組只跑需要的那一段，鑑別力不變而時間是八分之一）
- `scripts/probe-intake.mjs` —— `runHandoff` / `runHandoffFailure` 的斷言與 `settledNotifications`
- `scripts/scenario-coverage.test.mjs` —— 24 條新 scenario 的載體對照，含既有兩列的重填
- **`scripts/rejection-exhaustive.test.mjs`（新檔）** —— 擋分類的 `switch` 出現 `default`
- **`scripts/handoff-intro-source.test.mjs`（新檔）** —— 擋自我介紹寫死上限的數字
- `src/main/handoff-service.test.ts` —— 反轉「不因投遞者是自己的 agent 而放寬」那條
- **`src/main/intake-service.test.ts`（新檔）** —— 痕跡的額度、合併、正規化
- `src/main/intake-rejection.test.ts`（新檔）、`src/main/handoff-intro.test.ts`、
  `src/main/intake-schema.test.ts`、`src/main/intake-store.test.ts`、
  `src/main/intake-source.test.ts`、`src/main/intake-notify.test.ts`

**文件**：`docs/lessons/handoff.md`、`docs/lessons/intake.md`、`docs/lessons/probes.md`

**不在範圍內**

- 交接的回程與以 MCP 工具投遞 —— 既有缺口，與本 change 正交。
- `expireContent()` 沒有 production 呼叫端（內容永不過期）—— 既有缺口；spec 只承諾
  「內容 SHALL **可**過期」，本 change 記錄它與新上限的交互但不實作。
- `src/main/index.ts` 中 `app.on('activate')` 回呼內重複的 service 建立 —— **已於 `cd7290b` 修正**。
