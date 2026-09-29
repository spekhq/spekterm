## 0. 前提實測（不成立即停下，回到 design）

- [x] 0.1 以真實 claude CLI（記下版本）量「首次就緒時寫入 `prompt\r`」：一般 repo、含 `.mcp.json` 的 repo、從未信任過的資料夾三種目標各數次，記錄 `SessionStart` 與啟動對話框的先後、以及是否恰好送出一則（剝掉巢狀標記，見 `docs/lessons/handoff.md` 第十一節的量測陷阱）。結論與版本寫進 `docs/lessons/handoff.md`；任一情境下 `SessionStart` 早於對話框關閉 ⇒ 停下實作並回報

## 1. 到達即送出與移除上限

- [x] 1.1 `ipc/intake.ts` 的 `attach`：first-party 且本次為新建的 session ⇒ `encodeInput`；沿用既有 session 或第三方 ⇒ `encodePrefill`；送出那條路徑不發 `pending`。把「選哪個編碼」抽成純函式並補單元測試：first-party 新 session 以 `\r` 結尾、第三方不含 `\r` 與 `\n`、first-party 沿用既有 session 不含 `\r`、改選 folder 新建的 first-party 附 `\r`。送出後 `SUBMIT_CONFIRM_MS`（10 秒）內未見 busy／awaiting-choice 即發 `pending`、不補送 `\r`（以假時鐘的單元測試驗：逾時發 `pending`、期間見 busy 則不發、送出字元只寫一次）
- [x] 1.2 `handoff-intro.ts`：移除「NOT submitted. The user sends it.」與「Do not message a session you just handed work to until the user has sent its first prompt.」，改述 spekterm 會開 session 並送出第一則 prompt；`handoff-intro.test.ts` 斷言兩句舊文字不再出現
- [x] 1.3 移除上限：刪除 `handoff-throttle.ts` 與其測試、`handoff-service.ts` 的呼叫與「超過上限退回待處理」的路徑及 `handoff-service.test.ts` 中以上限為前提的測試；更新 `handoff-outbox.ts` 檔頭對 `handoff-throttle` 的引用。`npm test` 全綠
- [x] 1.4 上限的驗收下游：`intake-control-groups.mjs` 的 `handoff-stays-pending` 改寫為不依賴上限的 mutation（交接到達後不發 auto-accept），實跑確認「交接於到達時直接建立 session」那條斷言變紅；`scenario-coverage.test.mjs` 中以上限為載體或前提的列（`agent-initiated-handoff` 的「超過上限者成為待處理」「換一個來源落點不會重置上限」、`handoff-lineage` 的「降級為待處理後接受的交接，快照是攝入當下的」等）改寫載體或標為本 change 移除；`npm test` 全綠
- [x] 1.5 稽核 `probe-intake.mjs` 的 `runHandoff` / `runHandoffRestored` / `runLineage*` 中以「尚未送出」為前提的每一條斷言（待送出標示、`stub.input() === ''`、「已建立 session 的交接在收件匣中看得見」、`pressKey('Enter')` 手動送出與其後的了結斷言），逐條改寫為送出後的形狀：以 per-session 訊號斷言「第一則 prompt 被送出」（該則交接自已開好那一段離開、替身的該 session 收到一整行），**不用共用的位元組收據**（5.1）；替身設 `busySeconds` 且大於 400ms 的輪詢間隔。同步更新指向被改名／刪除斷言的對照組 `expectRed`（含 `settle-not-on-submit`）與對照表列。`PROBE_ONLY` 逐段通過

## 2. 交接單

- [x] 2.1 `SessionLineage` 加 optional `brief: { title, receivedAt }`；本文寫入 `<sessions dir>/<id>.handoff.json`（spawn 之前、由主行程、取 record 攝入時正規化過的內容）；`parseLineage` 逐欄位驗證 brief。單元測試：本文逐字元等於 `buildContext` 界線之內的內容；損毀的 brief 或 `.handoff.json` 不使 lineage 消失；**直接呼叫 `expireContent` 之後**交接單不變（唯一有鑑別力的載體，見 design D3）
- [x] 2.2 `.handoff.json` 的壽命：session 關閉時隨 `deleteScrollback` 同一條路徑刪除；`pruneScrollback` 一併處理 `.handoff.json`，且其「已知 session」**含暫定紀錄**。單元測試：暫定紀錄期間觸發 `replace()` 不刪掉它、關閉後檔案不存在、孤兒被清掉
- [x] 2.3 以 session 識別碼查詢本文的 IPC（只對存在且有 brief 的 session 回應、不收路徑）；restore 投影不含本文。preload 加方法並登記 `probe-shell.mjs` 的白名單；單元測試：不存在的識別碼不回本文、restore 的結果不含本文
- [x] 2.4 標籤優先序抽成 `src/shared/` 的函式（`customTitle` > 非空白的 `brief.title` > `title` > 本地標籤），renderer、`handoff-relations.ts` 的 `labelOf`、`index.ts` 的 `sourceOf` 三處都改用它。單元測試：交接標題為預設、pty 標題蓋不過它、清空 customTitle 立即回到它、空白標題退回 pty 標題、關係檔與來源快照用同一個規則
- [x] 2.5 交接單對話框（`role="dialog"`）：標題、來源、到達時間（`locale.ts`）、本文純文字（經 2.3 取得；取不到時說明）、最新結果與時間。入口在「← 來源」標示旁（停下 `mousedown` / `keydown` / `click` 冒泡，`docs/lessons/handoff.md` 12.3）與分頁右鍵選單，可全鍵盤操作；沒有 brief 的 session 沒有入口。字典補 key，i18n 守衛全綠
- [x] 2.6 `probe-intake.mjs` 新增 `runBrief`：分頁與 rail 標籤為交接標題；送出後打開交接單，本文與 context 檔界線之內的內容逐字元相同（fixture 含會被正規化改動的字元）；markdown／HTML 以原文呈現；從 rail 觸發入口不改變選取；重啟後內容不變；使用者自建的 session 沒有入口。`PROBE_ONLY=runBrief` 通過

## 3. 完成報告與生命週期

- [x] 3.1 投遞解析加 `kind`：無 ⇒ 交接；`report` ⇒ 完成報告；其他 ⇒ 拒絕可見。報告以 `view()` 查落點所屬 session：由交接建立 ⇒ 採納（不論母 session 是否存在）；存在但非交接 ⇒ 拒絕可見；不存在 ⇒ 靜默丟棄。`summary` 走攝入正規化，空 ⇒ 拒絕、超過 `MAX_REPORT_LENGTH`（4000）⇒ 拒絕不截斷；不進收件匣；採納後消費；同一投遞檔（路徑＋修改時間）只採納一次。摘要存入 `.handoff.json`。單元測試逐條覆蓋 `handoff-completion` 的投遞 scenario（含「讀兩次只採納一次」「關閉時殘留的報告不產生拒絕痕跡」）
- [x] 3.2 `completion: { reportedAt, settled, reopenedAt? }` 加入 `MainOwnedField`、解析與逐欄位白名單；`SessionStore` 增加寫入 `completion` 並發出變更通知的方法（涵蓋暫定紀錄）。單元測試：renderer 的持久化覆寫不了它、跨 load 保留、損毀時丟棄而 session 仍在
- [x] 3.3 生命週期純函式（`src/shared/lineage/`）：輸入「是否已採納報告、落定、重新開始」與一次輪詢的值，輸出新狀態與呈現；落定＝採納之後某次輪詢值為 ready；重新開始＝落定之後某次輪詢值為 busy / awaiting-choice；unknown 不動。單元測試逐條對應狀態 scenario，**含「報告於 agent 已停下之後才被採納」**
- [x] 3.4 主行程接線：每個帶 lineage 的 session 在 pty 存在期間持有一份等待狀態訂閱（spawn 與喚醒時建立、pty 結束隨 `clearWait` 清除），每次 tick 餵給 3.3 並落盤；狀態投影經新 IPC 推給 renderer（preload 與 `probe:shell` 白名單登記）。單元測試：報告到達時母 session 的 write 呼叫數為零（對照表標 `greenIfAbsent: true`，鑑別力由 4.3 的探針承擔）
- [x] 3.5 子 session 的自我介紹（帶 lineage 者）：報告的格式與位置、摘要上限與不得為空（由常數推導）、寫完後讀關係檔、母 session 在執行中才送訊息、每完成一件後續要求重複。**spawn 與 `refreshIntros` 兩個寫出點都帶這一段**（後者以 `view()` 查 lineage）；更新 `intro-refresh-drops-name` 對照組的 `from` 並新增「重寫時丟掉報告段」的對照組。`handoff-intro-source` 守衛擋得住以字面值寫入的上限；單元測試：無 lineage 的 session 沒有這一段、folder 變動後重寫的內容仍有
- [x] 3.6 關係檔的子／兄弟加 `state`（done / working / waiting / idle）與 `summary`；生命週期的**呈現狀態改變**成為 `refreshRelations` 的觸發點。單元測試：已完成者附摘要、未完成者只有狀態、休眠者為 idle、無路徑或識別碼欄位
- [x] 3.7 `scripts/lib/stub-agent.mjs`：替身能依指示往自己的落點原子寫入完成報告（落點由 `SPEKTERM_*` 推得），能造出「Stop 先於報告被讀到」的順序（先宣告 ready、之後才寫報告），並讓位元組收據**依對話 id 分開記錄**（供「母 session 未收到任何內容」使用）

## 4. 呈現與收掉已完成

- [x] 4.1 狀態標記：rail 子列、分頁、母 session「→ N」清單每項；全部完成時「→ N」換樣式；文案進字典
- [x] 4.2 收掉已完成：母 session 清單底部「Close completed (k)」與全域入口（僅在存在已完成者時呈現），確認對話框列出標籤、rail 項目與最新結果；確認時關閉「列出的 ∩ 當下仍為已完成的」，走既有的逐一關閉路徑。挑選邏輯抽純函式並補單元測試（期間重新開始者排除、期間才完成而未列出者排除、跨 folder、只限該母 session）
- [x] 4.3 `probe-intake.mjs` 新增 `runCompletion`（**至少三個子 session**，跨兩個 folder）：替身寫報告後以 `pollFor` 等到畫面呈現已完成，**之後**才讓替身宣告 busy→ready，斷言仍為已完成；再 busy ⇒ 重新開始；「Stop 先於報告」的順序下其後的 busy ⇒ 進行中；母 session 清單附狀態、全部完成時換樣式；母 session 的關係檔附摘要、母 session 的收據（per-session）為空；子 session 的 hook stdout 含報告說明；非交接 session 的報告被拒時通知與收件匣痕跡兩者皆可見；收件匣沒有因報告而生的項目；重啟後已完成保留；母 session 收掉已完成只關兩個；全域入口有已完成者時呈現、收掉跨 folder 的、之後不呈現；對話框開啟期間重新開始者經 UI 確認後不被關閉；取消不關閉任何 session。`PROBE_ONLY=runCompletion` 通過

## 5. 驗收登記、對照組與文件

- [x] 5.1 `scenario-coverage.test.mjs`：`COVERED_CHANGES` 加入 `handoff-session-lifecycle`；新 scenario 逐條填載體、`greenIfAbsent` 與 `mutation`；**與既有 change 同名的 scenario 共用對照表的同一列**，逐條重新稽核那些語意已改變的既有列（例如「就緒之後填入且未送出」「預填未能發生時說明並回到可重新處理」）。填「既有」時把斷言找出來，找不到寫「無載體」＋理由。`npm test` 全綠
- [x] 5.2 `intake-control-groups.mjs` 補對照組並逐一實跑確認變紅：first-party 新 session 改回 `encodePrefill`；沿用既有 session 也送出；落定改為依「轉變為 ready」；落定前的第一次 busy 即重新開始；標籤優先序把 pty 標題排在交接標題之前；交接單以 intake 主鍵回查；報告超長時截斷採納；關閉時以「當下已完成」取代交集（已實跑：`handoff-not-submitted`、`fallback-resubmits`、`reuse-also-submits`、`settle-by-transition`、`reopen-before-settle`、`label-pty-first`、`report-truncated`、`close-without-recheck`、`close-all-current`。「交接單以主鍵回查」不是一條可切換的程式碼路徑，載體是直接呼叫 `expireContent` 的單元測試，不另做自動對照組）
- [x] 5.3 文件：`docs/lessons/handoff.md`（D0 的實測結論、第三節「上限必須是全域」改寫為已移除與其理由、12.5 的缺口對交接不再成立、完成報告共用落點與 `kind`、落定依輪詢值而非轉變的理由、`.handoff.json` 的 prune 必須含暫定紀錄）、`CLAUDE.md` 的「交接」段落（prompt 改為送出、生命週期與收掉已完成、上限已移除）、`docs/PRD.md` §11 的交接敘述
- [x] 5.4 `npm run typecheck`、`npm run lint`、`npm test` 全綠；`npm run probe:intake`、`probe:shell`、`probe:terminal`、`probe:keyboard` 完整執行且全綠（標籤優先序與分頁右鍵選單影響後兩者）

## 6. dogfood 之後的追加

- [x] 6.1 送出字元與文字分開寫、間隔 `SUBMIT_KEY_DELAY_MS`（500ms）：真實長度的 prompt 與 `\r` 一次寫入時被 agent 當成貼上而沒有送出（實測門檻 100–150ms，見 `docs/lessons/handoff.md` 13.1）。單元測試斷言「分兩次寫且間隔足夠」，對照組 `submit-joined` 實跑為紅
- [x] 6.2 完成報告被採納時發出作業系統通知（與收件匣通知共用窗與上界，交接標題與摘要經縮減），觸發它選中子 session 並打開交接單。單元測試（`intake-notify.test.ts`、`handoff-completion.test.ts`）與 `runCompletion` 的四條探針斷言；對照組 `completion-note-unreduced`、`completion-reveal-as-intake` 實跑為紅

