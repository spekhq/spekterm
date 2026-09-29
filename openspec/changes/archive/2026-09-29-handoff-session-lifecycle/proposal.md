## Why

agent 發起的交接在 dogfood 中暴露了三個摩擦，而三者都是現行規格**刻意**或**從未處理**的結果，
不是實作錯誤：

1. **要回 spekterm 按送出。** `agent-handoff-source` 保留了「prompt 填好而不送出」，理由是
   「不會有 agent 在使用者沒看著的時候自己跑起來」。但交接是使用者在自己的 session 裡交辦的，
   本文由他自己的 agent 撰寫 —— 那道閘沒有擋下任何他沒同意過的事，只讓每一次交接都多一趟切換。
   它還附帶兩個已知缺口：peer 訊息會被誤判為「已送出」（`docs/lessons/handoff.md` 12.5），
   以及自我介紹必須要求來源 agent「在使用者送出之前不要聯絡子 session」。
2. **交接過去之後就忘了它是什麼。** 子 session 的分頁標籤是固定的通訊名字（`--name` 把終端標題
   釘成 `<rail 項目>-<短碼>`），交接的 `title` 從未被用在任何地方；本文唯一的呈現位置是收件匣
   「已開好」那一段，而 prompt 一送出它就被了結、**從畫面上永久移除**。使用者只能回頭問 agent。
3. **交接出來的 session 沒有生命週期。** 它只有「pty 在／不在」，沒有「做完了」這個狀態，也沒有
   回程（`agent-initiated-handoff` 的 Non-Goal「不做回程」）。母 session 不知道子 session 完成
   了沒，使用者得逐一去翻；做完的子 session 會一直堆在 rail 上。

## What Changes

- **agent 發起的交接到達即送出。** 建立 session 之後，第一則 prompt 於 agent 首次就緒時**填入並
  送出**，不再等使用者。**前提待實測**：首次就緒的那一刻畫面上沒有啟動對話框（MCP 核准、資料夾信任）
  —— 不成立就回到 design。逾時退回、沿用既有 session 再次接受時**只填入不送出**（使用者可能已在裡面
  打字）。僅限 first-party 的交接；**第三方來源（Slack 等）維持「看過本文、接受、
  由使用者送出」**，那道閘的前提（本文為第三方逐字撰寫）沒有改變。
  - 自我介紹同步改寫：不再說「The user sends it」，並移除「使用者送出之前不要聯絡子 session」的
    限制。
  - **BREAKING（行為）移除交接的全域上限。** 現行為 60 秒內 8 則，超過者退回收件匣待接受。
    使用者裁決不設上限：每一則合法的交接都直接建立 session 並送出。**明知的代價**：一個失控的
    agent 可以在短時間內開出任意數量、各自在執行且在花費的 session，而系統不會攔。
- **交接單跟著 session 走。**
  - 由交接建立的 session，其**分頁／rail 標籤預設為交接的 `title`**；使用者仍可重新命名，
    清空命名即回到預設。
  - session 上有一個入口可隨時打開**原始交接單**（來源 session、到達時間、`title`、本文全文），
    **只要該 session 還存在就可取得**，不受收件匣了結與內容保留期限影響。
- **交接 session 的生命週期：進行中 → 等你 → 已完成 → 收掉。**
  - 「進行中」「等你」由既有的等待狀態推導；「已完成」由**子 agent 自己宣告**：它寫一份結果
    （摘要）到自己的落點，spekterm 將該 session 標為已完成並保存結果。
  - 自我介紹告知子 agent：做完時寫結果、**並以 Claude Code 的本機訊息把結果送給母 session**。
    訊息仍由 Claude Code 傳遞，spekterm 不經手；母 session 未在執行時，結果只呈現在 spekterm。
  - 母端的「→ N」標示與子端的標示呈現各子 session 的狀態；已完成者可展開看結果。
  - **已完成的 session 由使用者關閉**：提供「收掉所有已完成的交接 session」的一次性動作。
    系統 SHALL NOT 自動結束任何 pty。
  - 已完成之後使用者又對該 session 送出新的 prompt（繼續追問）時，狀態回到進行中。

## Capabilities

### New Capabilities

- `handoff-brief`：由交接建立的 session 攜帶它的交接單 —— 預設標籤取自交接標題、隨時可打開的
  原始交接單、以及交接單的保留期限綁定於 session 的存在。
- `handoff-completion`：交接 session 的生命週期狀態、子 agent 宣告完成與結果的投遞契約、結果的
  呈現與（由 agent 經 Claude Code 訊息）回送母 session、以及收掉已完成者的動作。

### Modified Capabilities

- `agent-handoff-source`：「交接於到達時直接建立 session，不經使用者接受」以移除＋新增改為
  「……並送出第一則 prompt」（原條款的「prompt 填入而不送出」scenario 與新行為矛盾，無法以修改
  帶過）；**移除**「直接建立 session 的交接其總數有上限，且上限為全域」；「交接的失敗對使用者可見」
  更新對改名條款的引用；「agent 得不到投遞結果的回饋」拿掉「被上限降級」並說明完成報告不是它的解法。
- `agent-intake`：「第一則 prompt 預先填入而不送出，且不早於 agent 就緒」改名為「第一則 prompt
  不早於 agent 就緒寫入，第三方本文不代為送出」—— 依本文來源決定是否送出，**沿用既有 session 時一律
  只填入**；「prompt 完全由系統組成……」更新「人類閘門」的論證；「已開好的項目只在它的本文仍需要被看時
  呈現於收件匣」更新理由（交接的本文改由 `handoff-brief` 承擔）。
- `session-lineage`：「由交接建立的 session 於建立當下記住它的來源 session」拿掉以上限為前提的敘述；
  「agent 隨時查得到它當下的母、子、兄弟 session」加上子／兄弟的生命週期狀態與最新結果。
- `terminal-sessions`：session 標籤的優先序多一個來源（交接標題：低於使用者命名、高於 pty 標題），
  既有兩條「清空後回到 pty 標題」的 scenario 限縮為非交接 session。
- `ui-localization`：「寫給 agent 的指令」例外涵蓋被代為送出的第一則 prompt。
- `session-persistence`：持久化的事實加上交接單與完成狀態。

## Impact

- **主行程**：`handoff-delivery.ts` / `handoff-service.ts`（到達即送出）、`intake-prefill.ts`
  （送出的編碼路徑）、`handoff-intro.ts` 與 `agent-protocol-copy.ts`（自我介紹與完成回報的說明）、
  `handoff-outbox.ts`（落點多一種投遞：完成結果）、`handoff-relations.ts`（狀態）、
  `intake-store.ts`（交接單的保留）、`handoff-throttle.ts`（移除）。
- **renderer**：`shell/terminal/sessions.tsx`（預設標籤）、`WorkspaceRail.tsx` /
  `session-forest.ts`（狀態標示、結果入口、收掉已完成）、交接單的呈現元件。
- **字典**：新增狀態、交接單、收掉動作的文案（`en.json` / `zh-TW.json`）。
- **驗收**：`scripts/probe-intake.mjs` 的交接段落（到達即送出、完成宣告、收掉已完成）、
  `scripts/lib/stub-agent.mjs`（替身要能寫完成結果）、`scripts/scenario-coverage.test.mjs` 登記。
- **agent CLI 的前提**：送出的方式（pty 寫入送出字元 vs. 以啟動參數帶入第一則 prompt）需實測；
  結果回送依賴 Claude Code 本機訊息（已於 `docs/lessons/handoff.md` 第十一節實測可跨目錄送達）。
- **不新增任何依賴。**
