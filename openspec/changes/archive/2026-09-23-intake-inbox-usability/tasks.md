## 1. 先把驗收的地基補好

- [x] 1.1 `package.json` 的 `test:unit` glob 加上 `src/main/*/*.test.ts`；找出 `src/main/ipc/intake-projection.test.ts`「注入設定的頂層欄位未因本能力而增加」為何紅（期望 `['hooks']`、實得 `[]`）並修正**根因**，不放寬斷言。驗證：`npm test` 的輸出含該檔案的測試名且全綠
- [x] 1.2 新增守衛 `scripts/test-glob.test.mjs`：列舉 repo 內（排除 `node_modules`、`out`）所有 `*.test.ts` / `*.test.mjs`，斷言每一個都被 `test:unit` 的某個 glob 涵蓋。驗證：對照組 —— 把 1.1 的 glob 改回去，這道守衛必須紅
- [x] 1.3 `scripts/probe-shell.mjs` 的 intake 逐成員白名單補登 `dismissNotice`（09-21 加入 preload 時漏登）。驗證：`npm run probe:shell` 的「intake 介面只暴露已定義邊界要求的能力」為綠，作為本 change 的基線

## 2. 主行程

- [x] 2.1 `intake-store.ts`：去重鍵那一半加 optional 的 `settledAt: number`，`parseIntakeFile` 的逐欄位白名單加一條（非數字即丟棄）；新增 `settle(adapter, id)`（只對 `accepted` 生效、已設過不覆寫）；`setState(..., 'accepted', sessionId)` 清除 `settledAt`；`INTAKE_VERSION` 不動。驗證：`intake-store.test.ts` 新增「已了結的項目狀態仍為已接受」（settle → 重新載入 → 仍為 accepted 且帶 `settledAt`）、非數字的 `settledAt` 被丟棄而該筆保留、對 pending／dismissed 呼叫 `settle` 無作用、再次 accepted 時 `settledAt` 被清除；`intake-source.test.ts`（既有去重測試的所在）新增「清除之後去重仍然有效」（settle 後以同一識別碼重送 ⇒ `DUPLICATE`）
- [x] 2.2 新模組 `src/main/intake-projection.ts`（不 import electron）：搬入 `project()`，並加上 `listView(records, routing, knownFolderIds)` —— 排除 `dismissed` 與帶 `settledAt` 的 `accepted`、只對 `pending` 求 routing（失敗時**不帶** `folderId`）、依 `receivedAt` 由新到舊排序（內容已過期者最後）。`ipc/intake.ts` 改用它；`src/main/ipc/intake-projection.test.ts` 的手抄投影換成 import。驗證：該檔新增 —— 已接受者沒有 `folderId`（規則改指別處也一樣）、帶 `settledAt` 者不在清單中、以**打亂的**插入順序種入三則的輸出為新到舊、NO_MATCH 與 FOLDER_GONE 的投影不含 `folderId`
- [x] 2.3 接受的判定抽成純函式（輸入**不含**解析結果）：record 不存在 ⇒ `unknown`；事件回報關閉 ⇒ `prefillUnavailable`；`folderId` 缺漏、非字串或為 `''` ⇒ `unknown`；不在 folder 集合 ⇒ `FOLDER_GONE`；否則回傳該 folder 與既有 sessionId。驗證：單元測試逐一覆蓋上述分支，外加「帶著已解析目標者以使用者確認的 folder 為準」
- [x] 2.4 「已送出」的判定抽成 `isSubmitted(state)`（`busy` / `awaiting-choice` 為真；`ready` / `unknown` 為假）。`ipc/intake.ts` 的 `subscribeWait` 回呼改用它：為真時推 `prefill: 'sent'` **並**呼叫 `store.settle` 與 broadcast；為假時維持訂閱。驗證：單元測試「等待狀態落回未知不視為已送出」（四種狀態逐一）
- [x] 2.5 `ipc/intake.ts` 接線：`accept` 收第三個參數並改走 2.3；新增 `settle` 通道（型別 guard、只對 accepted 生效、broadcast）。preload：`intake.accept(id, adapter, folderId)`、`intake.settle(id, adapter)`；`probe-shell.mjs` 白名單登記 `settle`（附引入它的 change 與理由，同既有註解）。驗證：`npm run typecheck` 通過、`npm run probe:shell` 該條為綠

## 3. renderer

- [x] 3.1 `reuse-session.ts`：`sessionToReuse(existingSessionId, liveSessions: {id, folderId}[], chosenFolderId)`，只在 session 存在**且**在同一個 folder 時沿用。驗證：`reuse-session.test.ts` 新增「同 folder 沿用」「不同 folder 回 null」「已不存在回 null」
- [x] 3.2 預選的純函式（renderer 端）：依序取第一個**仍在 workspace 中**的 —— 本次打開收件匣後的改選、該則既有且仍存在的 session 所在的 folder、解析結果 —— 都沒有則為 `''`；另回報「改選指向的 folder 已不在」。驗證：單元測試覆蓋四層優先序與「不在 workspace 就跳過」，含「預填逾時退回者預選既有 session 所在的 folder」
- [x] 3.3 `IntakeOverlay`：改選存成 overlay 層的 `Map<adapter + id, folderId>`（**不放在卡片裡** —— 切到 Rules 分頁時卡片會卸載）；`IntakeCard` 的「Opens in」改為原生 `<select>`（`aria-label` 取自字典），值來自 3.2；值為 `''` 時**一律**渲染佔位項並停用接受鈕；改選指向已移除的 folder 時說明（`intake.chosenFolderGone`）；解析不出者照舊呈現原因；接受時把值送給 `accept`，`FOLDER_GONE` 的失敗訊息改用 `intake.chosenFolderGone`；沿用舊 session 改用 3.1。驗證：4.1 的探針段落
- [x] 3.4 已開好那一段：篩選改為「主行程列出的 accepted ＋ 該 session 在 live 清單中 ＋ 它的 folder 在 workspace 中」；folder 名取自該 session 的 `folderId`；每一則加逐則清除（`aria-label` 取自字典，呼叫 `intake.settle`）；本文全文、捲動與長度的呈現不動。先查證移除 folder 時其 session 的去向，把結論寫進該處註解。驗證：4.2 的探針段落
- [x] 3.5 把 `FilesPanel.tsx` 的 `useNow` 搬成共用 hook（`src/renderer/src/shell/useNow.ts`），FilesPanel 改用它；兩段的每一則以 `<time dateTime={ISO}>` 包住 `relativeTime(receivedAt)`，`title` 為 `formatDateTime`（皆經 `@shared/i18n/locale`），overlay 以 `useNow()` 每分鐘重算。驗證：`npm test` 的 `locale-source` 守衛通過、4.2 的時間斷言
- [x] 3.6 字典 `en.json` / `zh-TW.json`：選單標籤與佔位項、`chosenFolderGone`、清除鈕。驗證：`npm test` 的 `dictionary-completeness`、`aria-label-source`、`copy-language`、`i18n-key-safety` 全部通過

## 4. 探針

session 開在哪個 folder 一律以 **pty 行程的 `/proc/<pid>/cwd`** 判定，不讀 renderer 狀態。

- [x] 4.1 `probe-intake.mjs` 新段落 `runChooseFolder`。fixture：無 fallback；一條以來源識別碼命中、指向 folder 甲的規則；**三則**可解析（R1–R3）、一則 NO_MATCH、一則命中「指向已不存在 folder 的規則」（FOLDER_GONE）；另以種入 `intake.json` 的方式加一則目標已不存在的待處理交接。斷言：
  - R1 **被選中那一項**的文字等於甲的名稱（不是整列 `textContent`）；三則解析不出者呈現原因、且被選中的值為 `''`
  - 對 R1 直接呼叫 `window.workspace.intake.accept`：不帶第三參數、帶 `''`、帶不存在的識別碼 ⇒ 三者皆被拒絕、R1 仍為待處理、session 數不變
  - R1 改選乙 ⇒ **尚未接受時** R2 仍預選甲
  - R3 改選丙；切到 Rules 分頁、把規則改指乙、切回收件匣 ⇒ R3 仍為丙（改選活過分頁切換），**R2 變成乙**（沒改選的跟著規則走 —— 正反兩向缺一，「永遠不跟」與「永遠跟」分不出來）
  - 接受 R1 ⇒ 新 pty 的 cwd 為乙、甲沒有新 session；`intake-routing.json` 與改規則之後的內容逐位元組相同（改選沒有寫回規則）
  - NO_MATCH 那一則的接受鈕停用；選定丙並接受 ⇒ 新 pty 的 cwd 為丙
- [x] 4.2 `probe-intake.mjs` 新段落 `runOpenedLifecycle`：種 `intake.json` 與 `sessions.json`。斷言：
  - 帶 `settledAt` 的 accepted 不呈現（載入側的跨重啟）
  - routing 會解到甲、而 session 在乙的 accepted 呈現乙的名稱
  - 清除兩則中的一則 ⇒ 只剩另一則、被清除者的 pty 仍在、`intake.json` 中該則帶 `settledAt`
  - 關閉一則的 session ⇒ 它不再呈現；把一則 session 所在的 folder 移出 workspace ⇒ 它不再呈現
  - 一則**待處理**、帶著仍存在於乙的 sessionId、routing 解到甲 ⇒ 預選乙
  - 待處理與已開好兩段都以**打亂的**順序種入 ⇒ 畫面上新到舊
  - 種入相對現在 −3 小時與 −2 天的兩則 ⇒ `<time>` 的 **textContent** 等於頁面內以同一個 `Intl.RelativeTimeFormat` 算出的字串
- [x] 4.3 `runHandoff`：替身加上 `busySeconds`（確認既有斷言不受影響 —— 它只在收到一行時才作用）；既有斷言之後，於交接建立的 session 終端送出一次 Enter ⇒ 該則離開已開好那一段、`intake.json` 中該則帶 `settledAt`，**而同段由接受路徑建立的那一則仍在**（反向對照）
- [x] 4.4 `runRouting` 的「Opens in」三條改讀被選中那一項；`intake-control-groups.mjs` 裡 `routing-uses-fallback` 的 `expectRed` 同步改名；`acceptExpression` 系列不改（接受送的是預選值）。驗證：`npm run probe:intake` 全部段落綠**且完整執行**
- [x] 4.5 `intake-control-groups.mjs` 新增 mutation，每一條帶 `command: 'test'` 或 `section`，並指名必須變紅的斷言：`accept-falls-back-to-routing`（handler 缺參數時退回 routing ⇒ 4.1 直接呼叫那條）、`override-in-card`（改選放回卡片 ⇒ 4.1 分頁切換那條）、`preselect-ignores-session`、`reuse-ignores-folder`、`unknown-counts-as-sent`、`accept-keeps-settled`、`settled-dropped-on-load`、`settled-still-listed`、`opened-folder-from-routing`、`sort-by-insertion`、`time-text-now`（`<time>` 內改放 `relativeTime(Date.now())`）。驗證：`node scripts/intake-control-groups.mjs` 每一條如預期變紅，`control-groups-source.test.mjs` 為綠

## 5. 對照表與文件

- [x] 5.1 `scripts/scenario-coverage.test.mjs`：`COVERED_CHANGES` 加 `intake-inbox-usability`；新 scenario 各一列（逐條把載體找出來，不憑印象；「收件匣開著時相對時間隨時間推移更新」列為無載體並寫明理由）；既有列更新 ——「可解析與不可解析的兩則同時呈現」「解析失敗時嘗試接受不建立任何 session」「無規則亦無 fallback 時拒絕」「指向的 folder 已被移出 workspace 時拒絕，即使 fallback 可用」「已解析的目標已被移出 workspace 時拒絕，即使 fallback 可用」改以 4.1 為載體，「於解析出的 folder 建立…」改以 cwd 斷言為載體，「逾時之後再次處理不建立第二個 session」「預填等不到就緒時該則交接回到可重新處理的狀態」依改寫後的條件核對。驗證：`npm test` 通過
- [x] 5.2 `docs/lessons/intake.md`：第六節補「清單型控制項讓整列 `textContent` 含每一個選項」；補「『已送出』沒有真正的事件（`UserPromptSubmit` 未注入），`unknown` 不可推定為送出」。`CLAUDE.md`：「測試分兩層」補一句 `test:unit` 的 glob 由 1.2 的守衛釘住（子目錄的測試曾經從未被執行）；`probe:intake` 的說明更新 mutation 數與新段落。驗證：文件與 `intake-control-groups.mjs` 的實際數目一致
- [x] 5.3 `npm run typecheck`、`npm run lint`、`npm test` 全綠

## 6. 追加（dogfood 回饋）：顯示發生的時間，完整的日期時刻

- [x] 6.1 `intake-schema.ts`：`IntakeAuthored` 加選填的 `occurredAt: number`（毫秒）；`parseIntake` 讀 payload 的 `occurredAt`（ISO 8601 字串）—— 缺席即不帶、不是字串或不可解析即 `FIELD_TYPE`；長度檢查只看字串欄位；`digestOf` 不納入它。驗證：`intake-schema.test.ts` 新增「宣告了不可解析的發生時間的投遞被拒絕」（非字串、亂字串兩種）、「未宣告發生時間的投遞照常進入收件匣」、可解析者存成對應的毫秒值
- [x] 6.2 `slack-mention.ts`：`buildDelivery` 以被提及訊息的 `ts`（epoch 秒，帶小數）填入 `occurredAt`。驗證：`slack-mention.test.ts` 新增「回補取回的提及宣告訊息本身的時間」（`ts` 換算後等於期望的 ISO 字串，且經 `parseIntake` 得到同一個毫秒值）；`npm run probe:slack` 全綠
- [x] 6.3 投影：`IntakeView.occurredAt` ＝ `min(authored.occurredAt ?? receivedAt, receivedAt)`；`listView` 依它由新到舊排序。驗證：`intake-projection.test.ts` 新增 —— 回補形狀（到達時間相同、發生時間各異、落盤順序打亂）依發生時間排序；宣告未來時刻者的有效時間為到達時間
- [x] 6.4 `IntakeOverlay` 的 `ArrivedAt`：顯示 `formatDateTime(new Date(item.occurredAt), { dateStyle: 'medium', timeStyle: 'short' })`，`dateTime` 為它的 ISO；兩段都改用 `occurredAt`，不再用相對時間。驗證：`npm test` 的 `locale-source` 守衛通過
- [x] 6.5 `runOpenedLifecycle`：種入的項目讓發生時間與到達時間不同（回補形狀：到達時間接近、發生時間分散），另加一則宣告未來時刻的；斷言排序依發生時間、`<time>` 的文字等於頁面內以同一組 `Intl.DateTimeFormat` 設定算出的字串、未來那一則顯示到達時間。另在 `runIngest` 或新段落投遞一份帶 `occurredAt` 的檔案，斷言它顯示該時間（走真的解析路徑）。對照組：`time-text-now` 改為「顯示到達時間而非發生時間」、新增「排序依到達時間」與「不夾住未來時刻」。驗證：`npm run probe:intake` 全綠且完整執行、`node scripts/intake-control-groups.mjs <新的 mutation>` 如預期變紅
- [x] 6.6 對照表：移除「收件匣開著時相對時間隨時間推移更新」、依新的 scenario 名稱更新與新增各列（含 `slack-intake-source` 的兩條、欄位分類的兩條）；`docs/lessons/intake.md` 補「到達時間不是發生時間」。驗證：`npm test` 通過

## 7. 追加（dogfood 回饋）：重新啟動時了結尚未送出的已開好項目

- [x] 7.1 `intake-store.ts`：新增 `settleOpened(at)`，把所有 `accepted` 且無 `settledAt` 的一次了結並落盤（只寫一次）。驗證：`intake-store.test.ts` 新增 —— 已接受未了結者被了結、已了結者保留原本的時刻、待處理與已忽略不動、沒有東西可了結時不寫檔
- [x] 7.2 主行程啟動：收件匣載入之後、交接服務與投遞來源啟動之前呼叫它（附理由註解）。驗證：7.3 的探針段落
- [x] 7.3 `runOpenedLifecycle` 改寫：已開好的項目改為**在這一次執行中接受**產生（啟動之前就是已接受的，照新規則會在啟動時被了結）；種入一則「上一次執行接受、session 仍在、未送出」的項目，斷言它啟動後不呈現、`intake.json` 帶 `settledAt`、session 仍在；關閉 session 改以 `Ctrl+Shift+W` 關掉該 folder 聚焦的那一個；段落最後以同一個 profile 重新啟動，斷言本次接受而未送出的都不再呈現、session 仍被還原。對照組新增「啟動時不了結」。驗證：`npm run probe:intake` 全綠且完整執行、新 mutation 如預期變紅
- [x] 7.4 對照表新增「應用程式重新啟動後，尚未送出的項目不再呈現」一列，並依 7.3 更新受影響各列的載體說明；`docs/lessons/intake.md` 補一句。驗證：`npm test` 通過

## 8. 追加（dogfood 回饋）：卡片版面

- [x] 8.1 卡片與已開好的列改為「誰、在哪、何時」在第一列且不折行；標題已包含在本文中時不另外呈現（`title-redundancy.ts`，標題以「…」結尾時比對去掉它的部分）；已開好的列補上取自字典的無障礙標籤。驗證：`title-redundancy.test.ts`、`probe:intake` 的「標題已在本文中時不另外呈現，不在本文中時照常呈現」（兩個方向各一則）
