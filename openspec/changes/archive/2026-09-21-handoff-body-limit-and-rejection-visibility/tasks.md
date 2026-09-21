## 1. 對照組先行 —— 讓現況變紅

**這一節必須在任何實作之前完成。** 本 change 的起點是一盞撐過完整驗收的假綠；
先讓它紅，後面每一條才有意義（design D6）。

- [x] 1.1 修 `probe-intake.mjs` `runHandoffFailure` 的 `before` 量測：以 `pollFor` 等到通知數
      **穩定**（連續兩次讀到相同值）再量。驗證：不改產品程式碼的情況下「目標查無時發出通知」
      變紅（已預先實測為 `前=1 後=1`）
- [x] 1.2 該斷言改為**比對通知的內容**：查無的那一則必須指向拒絕的**類別**
      （`intake.rejectReason.TARGET_NOT_FOUND`）。**不得比對目標原字串** —— 既有 requirement
      禁止通知內文含 folder 名稱（design D3）。驗證：把產品改成「任何拒絕都發一則無關的
      通知」時該斷言仍為紅
- [x] 1.3 `docs/lessons/probes.md` 新增一節：**任何「事件數增加了」的斷言，其 `before` 必須
      量在靜止點**；附本次的實測輸出與「數量是方便取得的量、內容才是規格在乎的」

## 2. 本文長度上限依 `firstPartyBody` 分流

- [x] 2.1 **實測 first-party 上限的值**：造不同長度的 context 檔，測到「接手的 agent 一次讀不完
      因而收尾界線不進脈絡」的門檻，取保守值。**記載所用的 agent CLI 版本**（design D1）。
      驗證：實測紀錄寫進 `docs/lessons/handoff.md`，含重測時機
- [x] 2.2 `intake-schema.ts`：`MAX_BODY_LENGTH` 的套用改以 `provenance.firstPartyBody` 為條件，
      first-party 套 2.1 的新常數，`MAX_FIELD_LENGTH` **不**分流。驗證：單元測試涵蓋六格
      （first-party／第三方 × 未超過／超過各自上限／超過另一方上限），且第三方那幾格與現況
      逐字相同 —— 對應 scenario「本文過長的投遞在投遞階段被拒絕」「本文非第三方撰寫者不受本文
      長度上限約束」「first-party 本文超過其依據所定的上限時被拒絕」
- [x] 2.3 **反轉** `handoff-service.test.ts:287`「本文超過長度上限的交接被拒絕 —— 不因投遞者是
      自己的 agent 而放寬」。**必須與 2.2 在同一個 commit**，否則 `npm test` 當場紅。
      驗證：改寫後的測試斷言新的分流行為，且測試名稱反映新裁決
- [x] 2.4 `MAX_DELIVERY_BYTES` 的載體走**檔案**（`intake-source.test.ts:144` 是現成的形狀），
      並在測試旁註明它作用於檔案、發生在 provenance 之前，**對 `firstPartyBody` 沒有鑑別力**
      —— 對應 scenario「不經接受者其本文仍以純文字呈現且仍受長度上限約束」的 AND 那半

## 3. 呈現：`opened` 那一段要補，不是要截

- [x] 3.1 `IntakeOverlay.tsx` 的 `opened` 段落（`:287`）加上本文長度，並以可捲動容器呈現長本文。
      **不截斷。** `IntakeCard` 一個字不改。驗證：probe 以一則遠長於一畫面的已接受交接斷言
      「全文未截斷且附有長度」—— 對應 scenario「已接受項目的長本文全文不截斷」
- [x] 3.2 為 `opened` 那一段補一條**跨行程逐字元斷言**（既有那條只蓋到 `IntakeCard`，
      以 `intake.itemLabel` 定位）。驗證：把截斷加進 `opened` 的渲染時該斷言**變紅**

## 4. 拒絕的分流判準與通知的接線

- [x] 4.1 新增判定「同一份投遞、在使用者不改變任何設定的情況下重送是否會有不同結果」的純函式。
      **定義域是 `DeliverOutcome`（code ＋ notify 語意），不是 `IntakeRejection`** ——
      `DUPLICATE` 承載兩種行為（design D2）。以 exhaustive switch 實作，涵蓋全部 **11** 個
      `IntakeRejection` 值（含 `MISSING_ID`）。驗證：單元測試逐一釘住分類
- [x] 4.2 補一道原始碼守衛擋該 switch 出現 `default:`。驗證：對照組 —— 加上 `default:` 時守衛變紅
- [x] 4.3 確認該函式**不決定 `consume`**。驗證：單元測試斷言 `handoff-service.ts:105-107`
      那條路（放錯位置的檔案）仍為 `consume: true` —— 對應 scenario「一份放錯位置的投遞雖為
      暫時性失敗仍被消費」
- [x] 4.4 失敗通知的接線放在 **`IntakeSource`**（它持有 `#adapter`，且 `rejectOversize` 與
      `#deliver` 兩條路都經過它）。驗證：scenario「共用攝入路徑上的永久性失敗同樣可見」
      （投遞過大）與「本文過長的交接其失敗可見」各一條 probe 斷言轉綠 —— 同一組斷言一併
      承擔 `agent-intake` 側的「來源為自身 agent session 的永久性拒絕發出通知」
- [x] 4.5 `IntakeNotifier` 新增失敗的入口，內文**只由系統文案與拒絕的類別構成**，
      共用既有的合併窗與總量上界。驗證：單元測試斷言內文不含投遞者寫下的任何字串
      —— 對應 scenario「失敗的通知內文不含投遞者寫下的字串」
- [x] 4.6 通知的觸發目的地：批次中含任何失敗時打開收件匣；同時修 `index.ts:380-384` 的註解
      （它的前提「失敗的項目（那些仍是待處理）」已被 D4 拿掉）。驗證：probe 以「一則成功交接
      ＋一則失敗落在同一窗」斷言觸發後打開收件匣 —— 對應 scenario「含失敗的合併通知其效果為
      打開收件匣」
- [x] 4.7 `PREFILL_UNAVAILABLE` 改列暫時性，不發通知。驗證：probe 斷言關閉事件回報時該交接
      不發通知 —— 對應 scenario「預填不可能發生時不發出通知」「因功能被關閉而失敗者為暫時性」
- [x] 4.8 確認暫時性拒絕與非交接 producer 的拒絕仍不發通知。驗證：probe 既有的「寫到一半的
      投遞不發通知」與「被拒絕的投遞不發出作業系統通知」仍綠 —— 對應 scenario「暫時性失敗
      不發出通知」「來源為自身 agent session 的暫時性拒絕不發出通知」

## 5. 痕跡：可識別、跨重啟、可逐則清除

- [x] 5.1 `IntakeNotice` 擴充欄位：發生時刻、來源座標、投遞者寫下的目標原字串。
      **該字串由 adapter 在呼叫端交進來**，不讓共用攝入路徑去讀 `raw.target`（design D4）。
      驗證：單元測試斷言三者皆進入痕跡，且 `TOO_LONG` 這條路也拿得到目標字串
- [x] 5.2 該字串**於進入痕跡時正規化**（與 authored 欄位同一套白名單）。驗證：單元測試以含
      控制字元與雙向覆寫字元的目標字串斷言輸出已被正規化
- [x] 5.3 合併規則：保留**最近一次**的時刻；溢位桶的 key 由字面的 `'…'` 改為可翻譯的呈現。
      驗證：單元測試各一條
- [x] 5.4 痕跡的上界**以來源分配額度**，高頻來源不把其他來源擠出。驗證：單元測試以超過上界的
      單一來源失敗斷言其他來源的痕跡仍在 —— 對應 scenario「高頻來源的失敗不把其他來源擠出」
- [x] 5.5 落盤至 `intake.json` 的**新 optional 區段**，**不 bump `INTAKE_VERSION`**。
      驗證：以不含該區段的既有檔案載入，`entries` 一則不少（**對照組：bump 版本時該測試必須
      變紅**）—— 對應 scenario「升級不影響既有的收件匣內容」
- [x] 5.6 降級安全：含痕跡的檔案被不認得它的版本載入時 `entries` 一則不少。驗證：單元測試
      以逐欄位白名單的載入路徑斷言 —— 對應 scenario「降級不影響既有的收件匣內容」
- [x] 5.7 只落盤永久性拒絕。驗證：單元測試以兩類各一則斷言落盤內容 —— 對應 scenario
      「永久性拒絕的痕跡在重新啟動之後仍然存在」「暫時性拒絕不留下跨重啟的痕跡」
- [x] 5.8 `IntakeOverlay.tsx` 逐則呈現痕跡（類別、時刻、來源、目標），**接上既有的
      `intake.rejectReason`**（11 條文案目前沒有任何消費者）。驗證：probe 斷言畫面上出現該
      類別的說明文字 —— 對應 scenario「呈現使使用者認得出是哪一件事失敗」
- [x] 5.9 逐則清除，取代目前一次清光的 `clearNotices()`。驗證：probe 以兩則失敗斷言清除其一
      後另一則仍在，且重啟後仍如此 —— 對應 scenario「痕跡可被逐則清除」
- [x] 5.10 probe 新增「失敗的呈現活過重新啟動」：失敗 → 重啟 app → 痕跡仍在。
      驗證：對應 scenario「失敗的呈現活過重新啟動」
- [x] 5.11 痕跡的新文案進 `en.json` / `zh-TW.json`。驗證：`dictionary-completeness.test.mjs`
      與 `copy-language.test.mjs` 通過

## 6. 自我介紹告知所有會導致拒絕的約束

- [x] 6.1 `handoff-intro.ts` 的三個數字（first-party 本文上限、`MAX_FIELD_LENGTH`、
      `MAX_DELIVERY_BYTES`）**由常數推導**。注意 `MAX_DELIVERY_BYTES` 在
      **`intake-source.ts`**，不在 `intake-schema`。驗證：`introText()` 的輸出含由常數推導的值
- [x] 6.2 補一道**原始碼守衛**：那三個數字不得以字面值出現在 `handoff-intro.ts`。
      驗證：對照組 —— 把其中一個寫死時守衛變紅（「改動常數看輸出變不變」對 `export const`
      做不到，這才是常駐載體）—— 對應 scenario「告知的約束與實際生效的判定同源」
- [x] 6.3 新增內容：三個上限，以及「一則交接可能被拒絕、你不會被告知、該次失敗呈現於收件匣」。
      驗證：`handoff-intro.test.ts` 逐句斷言 —— 對應 scenario「告知的內容涵蓋所有會導致拒絕的
      長度與大小約束」「告知的內容說明失敗是可達的結果」
- [x] 6.4 確認新增內容仍為英文且不進字典。驗證：`copy-language.test.mjs` 通過

## 7. 驗收覆蓋與收尾

- [x] 7.1 `scenario-coverage.test.mjs`：登記本 change 進 `COVERED_CHANGES`，為每一條新增或修改
      的 scenario 填上載體、`greenIfAbsent`、`mutation`。
      **順序是「先登記 `COVERED_CHANGES`，再填列」** —— `specRoots()` 掃的是**登記在那份清單裡的
      change 其 delta specs**（`openspec/changes/<name>/specs`，封存後是 `archive/*<name>/specs`），
      **不是 `openspec/specs/`**。還沒登記就先填列，守衛會說「對照表上有不存在的 scenario」
      （實作期間踩到過，而我當時把成因誤判為「要等它進主 spec」）。
      **並重填既有的兩列**：
      `'本文過長的投遞在投遞階段被拒絕'`（語意已收窄為第三方）與 `:551` 那一列
      （note 寫著「已開好的那一段刻意不呈現本文」，已與 `IntakeOverlay.tsx:287` 的現況不符）
- [x] 7.2 逐條核對第 1 節之外的每一條新斷言其**鑑別力**：把實作退回，確認它真的變紅。
      「有載體」與「載體有鑑別力」是兩個動作。
      **實跑過的七個**：四個 mutation（7.3）／把截斷加進 `opened` 的渲染（3.2，兩條變紅且
      `頭=true 尾=false` 正好證明只驗頭會假綠）／bump `INTAKE_VERSION`（5.5）／臨時新增一個
      `IntakeRejection` 值（4.1，`TS2366`）。
      **兩道新守衛的對照組寫在守衛自己的測試裡**（`rejection-exhaustive`、`handoff-intro-source`）
      —— 後者的第一版**抓不到它唯一要抓的東西**（只看 `NumericLiteral`，而寫死的自然形式是
      模板字串的文字段），對照組當場紅了。
      其餘單元測試的鑑別力由**成對的正反斷言**保證（六格的長度分流、永久／暫時兩側、
      提供／不提供主鍵）
- [x] 7.3 `intake-control-groups.mjs`（目前 19 個）新增四個 mutation，各自指名必須變紅的斷言：
      查無時只寫診斷輸出／本文過長時只寫診斷輸出／投遞過大時只寫診斷輸出／痕跡不落盤。
      **它排在這裡而不是第 1 節**：這四個 mutation 都是「把實作退回」，而實作在第 4、5 節才存在。
      驗證：跑對照組腳本，四者皆如預期變紅
- [x] 7.4 `docs/lessons/handoff.md`：自我介紹漏掉一個約束的代價、它為何必須與判定同源、
      2.1 的實測值與 agent 版本、重測時機
- [x] 7.5 `docs/lessons/intake.md`：拒絕的永久／暫時分類與那條「不改變設定」的限定、
      痕跡為何不做成 `IntakeRecord`、`expireContent()` 沒有呼叫端這個既有缺口與新上限的交互
- [x] 7.6 `npm run typecheck`、`npm run lint`、`npm test` 全數通過
- [x] 7.7 `npm run probe:intake` 全段通過
- [x] 7.8 ~~`npm run test:e2e` 全數通過~~ —— **使用者裁決本 change 不跑**（2026-09-21）。
      本 change 只動收件匣與交接這一塊，`probe:intake` 已全段通過（7.7）；
      其餘十二支探針與本 change 的改動面沒有交集
