## Context

動機見 proposal.md。這裡只列會左右作法的現況：

- **交接建立 session 的路徑**：交接到達 → 主行程簽發單次憑證（`handoff-ticket.ts`）→ renderer 以
  `sessions.create(folderId, 'claude', { ticket })` 建立 → 主行程在 **spawn 之前**把 `lineage`
  寫進暫定紀錄（`session-create.ts`）→ renderer 回報 `attach` → 主行程寫 context 檔、
  `schedulePrefill` 於等待狀態**首次就緒**時以 `encodePrefill`（不附 `\r`）寫進 pty
  （`ipc/intake.ts`）。已就緒時 `schedulePrefill` **立刻寫**（`intake-prefill.ts`）。
- **「送出」的編碼已存在**：對話 view 的輸入走 `encodeInput`（附 `\r`）。它的送出實測是在
  **已經在跑的輸入狀態**下做的；「首次就緒」那個時點的實測只量過**不附 `\r`** 的填入
  （`docs/lessons/transcript.md`，5/5 落入輸入框）。**兩者合起來不等於「首次就緒時送出是安全的」**
  —— 見 D0。
- **等待狀態**每 400ms 輪詢一次，一次輪詢把期間的事件摺成一個值；**每一次輪詢都通知訂閱者**，
  不論值有沒有變（`agent-wait.ts` 的 `tick`）。沒有訂閱者的 session 不被求值。
- **主行程擁有的 session 欄位**有白名單（`session-store.ts` 的 `MainOwnedField`），renderer 的持久化
  覆寫不了它們。`sessions.json` 是**每次整份同步重寫**的小檔 —— 畫面快照因此刻意另存為
  `<id>.scrollback`（`session-store.ts` 的類別註解），並隨 `deleteScrollback` / `pruneScrollback` 清除。
- **關係檔**每個 claude session 一份，只在 session store 或 pty 集合變動時重算（`refreshRelations`）。
- **自我介紹**在 spawn 時寫出，且在 workspace 的 folder 清單變動時由 `refreshIntros` 對每個 session
  重寫（`handoff-injection.ts`）—— 重寫時傳入的資訊不含「這個 session 有沒有母 session」。
- **session 標籤的優先序**：`customTitle` > `title`（pty 宣告）> 本地標籤，在三處計算：renderer、
  `handoff-relations.ts` 的 `labelOf`、`index.ts` 的 `sourceOf`（交接攝入時記下母 session 的標籤快照）。
- **投遞落點**：每個 session 一個目錄，一個 watcher 監看整個 `outbox/`，來源由目錄名推導；
  「先監看再掃描」可能讓同一個檔被讀兩次（`docs/lessons/handoff.md` 第四節）。

## Goals / Non-Goals

**Goals:**

- 交接到達之後，使用者**不必回到 spekterm** 那件事就開始做。
- 交接單（標題、來源、時間、本文）與結果**跟著 session 存在**，不依附收件匣的呈現規則。
- 完成狀態的權威在**主行程**，renderer 與 agent（關係檔）看到同一份。

**Non-Goals:**

- **spekterm 不傳遞訊息。** 結果回送母 session 由子 agent 以 Claude Code 的本機訊息自己送；
  spekterm 只保存與呈現結果。不在母 session 的 pty 寫入任何東西。
- **不自動結束任何 pty。** 「已完成」只是一個標示。
- 第三方 intake（Slack）的接受與送出行為完全不變。
- 不做投遞成敗的回程 —— 「交接寫出去了沒被收到」仍然只有使用者看得到。完成回報是另一件事。
- **完成報告不是一道安全邊界。** 落點的位置 agent 算得出來（第三節），任何 agent 都能替別的
  session 寫報告。本設計約束的是「報告的歸屬不由內容自稱」，不是防禦惡意的 agent（見 Risks）。
- 不做跨 repo 的交接總覽頁；狀態呈現在既有的 rail 與母子標示上。

## Decisions

### D0. 先實測「首次就緒時寫入 `prompt\r`」，再依賴它

整個「到達即送出」押在一個**沒有量過**的前提上：`SessionStart` 觸發（＝首次就緒）的那一刻，TUI
的焦點在輸入框、而不是在某個啟動對話框上。不附 `\r` 的填入落在對話框上大致無害；**附了 `\r`
就可能替使用者選了對話框的預設選項** —— 那正是 `agent-events.ts` 檔頭點名的災難形狀。

以真實 CLI（當下版本）在三種目標上量：一般 repo、含 `.mcp.json` 的 repo（MCP 核准對話框）、
從未被信任過的資料夾（信任對話框）。記錄 `SessionStart` 與各對話框的先後，以及「一次寫入
`prompt\r`」是否恰好送出一則。結論與版本寫進 `docs/lessons/handoff.md`。

**若任一情境下 `SessionStart` 早於對話框被關閉**：停下實作，回到 design 重新決定送出的時機
（候選：等第一則 `UserPromptSubmit` 以外的另一個訊號、或在對話框情境下退回只填入）。**不在未量過的
前提上實作。**

**結果（2.1.283，`docs/lessons/handoff.md` 第十三節）**：信任與 MCP 核准對話框在時 `SessionStart`
**始終不觸發**，關掉之後才觸發 —— 前提成立。但送出字元偶爾會掉（關掉 MCP 對話框之後 1/13：文字留在
輸入框、`
` 沒生效）。失效方向溫和（退化成填入），由 D1 的「送出未見開始工作即退回待送出標示」承接。

**dogfood 推翻了一半（第十三節 13.1）**：上面的量測用的是 50 字元的短 prompt；真實的 prompt 約 300 字元，
與 `\r` 一次寫入時被 agent 當成貼上，**一次都沒送出**。改為文字與送出字元分開寫、間隔 500ms
（門檻實測在 100–150ms 之間）。

### D1. 到達即送出：沿用預填的時機，新建的 session 才送出

first-party 交接的 `attach` 仍於等待狀態首次就緒時寫入。**寫入目標是本次為它新建的 session 時**，
先以 `encodePrefill(prompt)` 寫文字、**隔 `SUBMIT_KEY_DELAY_MS`（500ms）再單獨寫 `\r`**；否則只寫文字
（第一版是 `encodeInput(prompt)` 一次寫入 —— 長文字被當成貼上、`\r` 被併進去，見 D0）。判定依
`record.content.verified.firstPartyBody === true`（與 `buildPrompt` 選措辭同一個欄位）**且**
本次 `attach` 的 session 是新建的。

**「沿用既有 session」的那條路徑維持只填入。** 預填逾時退回待處理之後，使用者面對的是一個空的
session，很可能已經在裡面打字或交辦了別的事；同一個 folder 再次接受會沿用那一個，而
`schedulePrefill` 在已就緒時立刻寫 —— `prompt\r` 會接在他打到一半的內容後面**一起送出**。
填入時代這無害（送出之前他看得到），送出時代不行。

**否決：以啟動參數帶入第一則 prompt（`claude --session-id X "<prompt>"`）。** (1) context 檔在
spawn **之後**才寫，要把整條接受路徑倒過來；(2) argv 只在第一次 spawn 生效，續接與自癒兩條路徑都要
記得不再帶，兩個新的靜默失效點；(3) 送出時機落在 CLI 內部，自我介紹與第一則 prompt 的先後不再由
我們保證。**它也不解決 D0 的對話框問題** —— CLI 會把初始 prompt 排在對話框之後，而那正是要量的事。

**事件回報關閉時仍不建立 session**（既有條款）—— 送出與預填需要同一個「首次就緒」訊號。

**送出之後的退路**：寫入 `prompt\r` 之後，若在 `SUBMIT_CONFIRM_MS`（10 秒）內等待狀態沒有一次結算為
busy 或 awaiting-choice，即發出 `pending`（呈現「待送出」標示），其後的了結判定照舊。**不自動補送
`\r`** —— 那段時間使用者可能已經在那個 session 裡打字。

連帶：

- 「待送出」標示對送出的那一條路徑不立即發 `pending`，只在上一段的退路觸發時發。
- 自我介紹移除「the first prompt typed in but NOT submitted. The user sends it.」與「Do not message
  a session you just handed work to until the user has sent its first prompt.」。
- `docs/lessons/handoff.md` 12.5 的第一個缺口（peer 訊息被誤判為已送出）對交接不再成立。

### D2. 移除全域上限，以及它的每一個下游

刪除 `handoff-throttle.ts`（含測試）與 `handoff-service.ts` 的呼叫。**上限是「交接到達即建立 session」
唯一的對照組所在**（`intake-control-groups.mjs` 的 `handoff-stays-pending`，它的 `from` 正是
`this.#throttle.take()`）—— 刪掉上限會讓 `control-groups-source.test.mjs` 紅，而更要緊的是那條
斷言從此沒有鑑別力。替代的對照組改在「到達即接受」本身下手（讓交接到達後不發 auto-accept）。

其餘下游：scenario 對照表中以上限為載體的四列（已封存的 `agent-initiated-handoff` 的兩條上限
scenario、`handoff-lineage` 的「降級為待處理後接受」前提），`session-lineage` 與
`agent-handoff-source` 兩份主 spec 中仍以上限為前提的句子（列為 MODIFIED），`docs/lessons/handoff.md`
第三節的結論，`handoff-outbox.ts` 檔頭的引用。

### D3. 交接單：標題掛在 `lineage`，本文另存一個檔

`SessionLineage` 加 optional 的 `brief: { title: string; receivedAt: number }`；**本文另存**為
`<sessions dir>/<id>.handoff.json`，與畫面快照同一個模式：

- **為什麼本文不放 `sessions.json`**：那個檔每次整份同步重寫，觸發點包括 renderer 每次持久化、
  每次 `update()`。一份本文最多 20,000 字元（中文約 60 KB），上限又已移除 —— 檔案大小隨交接數
  線性成長，全部落在主執行緒上。這正是畫面快照當初被搬出去的理由。
- **為什麼標題留在 `lineage`**：renderer 每一個分頁與 rail 列的標籤都要它；它至多 200 字元。
- **寫入時機**：`lineageFromTicket` 解析憑證、取得 record 的同一處，於 spawn **之前**寫出。取值自
  record **攝入時正規化過的內容**（與 context 檔、收件匣呈現同一個值）。
- **壽命**：隨 `deleteScrollback` 同一條路徑刪除、隨 `pruneScrollback` 清掉孤兒。**prune 的
  「已知 session」必須含暫定紀錄**：現行的 prune 只看 `#sessions`，而交接單在 spawn 之前、renderer
  還沒把新 session 送來持久化的那 ~500ms 裡就已寫出（第 12.2 節同一個形狀）。**實作時查證：prune
  目前只在 `load()` 時跑**，那時沒有暫定紀錄 —— 這條是讓日後在別處呼叫 prune 的人不會踩到，不是在修
  一個今天就會發生的刪除。
- **為什麼存快照而不存 intake 主鍵**：intake 的內容有保留期限（`expireContent`）。**但產品程式碼
  目前沒有呼叫它**，於是「以主鍵回查」這個錯誤實作在任何經過 UI 的載體上都是綠的 —— 對照組只能
  由直接呼叫 `expireContent` 的單元測試承擔（見 tasks）。
- **renderer 取本文走一條以 session 識別碼查詢的 IPC**，只在打開交接單時取；不隨 restore 投影送出。
  `probe:shell` 的 preload 白名單要登記這個方法。
- **只有 first-party 交接有 `brief`**。`parseLineage` 對 `brief` 逐欄位驗證，壞掉的丟棄而保留其餘；
  本文檔損毀或遺失 ⇒ 交接單只呈現標題與來源，並說明本文無法取得。

### D4. 標籤：`customTitle` > 交接標題 > pty 標題 > 本地標籤

優先序抽成 `src/shared/` 的一個函式，**三個計算點**（renderer、`labelOf`、`sourceOf`）都用它。
**交接標題為空或只有空白時不參與優先序**（`parseHandoffPayload` 在沒有 title 時給 `''`，而 codebase
慣用的 `??` 不會跳過空字串 —— 標籤會變空白）。

**不把交接標題寫進 `customTitle`**：那會讓「清空＝交還命名權」回到 pty 標題（對 peer-named session
就是那個名字），使用者從此回不到交接標題。

`terminal-sessions` 既有的兩條「清空名稱後回到 pty 標題」scenario 限縮為「非由交接建立的」session。

### D5. 完成報告沿用同一個落點，以 `kind` 區分

```json
{ "kind": "report", "summary": "<結果摘要>" }
```

- 沒有 `kind` ⇒ 交接（既有格式不變）；`kind` 為其他值 ⇒ 拒絕並可見。
- 歸屬由目錄名推導。**以 `view()` 查該 session**（含暫定紀錄 —— 第 12.2 節）。
- **採納條件是「該 session 由交接建立」（有 `lineage`），不論母 session 此刻是否存在。** 母 session
  已關閉的子 session 照樣可以宣告完成；它只是沒有對象可以送訊息。
- 落點所屬的 session **已不存在**（例如關閉時 `endSession` 對落點的最後一次掃描）⇒ **靜默丟棄**，
  不呈現為拒絕 —— 沒有 session 可以掛上去，而那不是 agent 的錯。存在但沒有 `lineage` ⇒ 拒絕並可見。
- `summary` 走與其他 first-party 欄位**相同的攝入正規化**（它會呈現在畫面上，也會寫進另一個 agent
  讀的關係檔）；正規化後為空 ⇒ 拒絕；超過 **4,000 字元**（`MAX_REPORT_LENGTH`）⇒ 拒絕，不截斷。
- 報告**不進收件匣**，採納後消費投遞檔。**同一個投遞檔（路徑＋修改時間）只採納一次** ——
  「先監看再掃描」會讓它被讀兩次，而第二次採納會把已落定的狀態重設回未落定（D6）。
- 摘要存進 D3 的 `<id>.handoff.json`（`report: { summary, reportedAt }`），理由同本文。

**否決：另開一個 `report/` 落點。** 多一個 watcher、多一次落點準備（第十節那一整類問題重演一次）。
**否決：以 `Stop` hook 推定完成。** 停下來可能是在問問題 —— 使用者已否決。

### D6. 生命週期：落定依「採納之後的輪詢值」，不依「狀態的轉變」

session 上新增主行程擁有的小欄位（`sessions.json`，加入 `MainOwnedField`）：

```ts
completion?: { reportedAt: number; settled: boolean; reopenedAt?: number }
```

呈現的狀態：

| 狀態 | 條件 |
|---|---|
| **已完成** | 有 `completion` 且沒有 `reopenedAt` |
| **進行中** | 沒有 `completion` 或已重新開始，且等待狀態為 busy |
| **等你** | 沒有 `completion` 或已重新開始，且等待狀態為 ready / awaiting-choice |
| （不呈現狀態） | 沒有 `completion` 或已重新開始，且等待狀態為 unknown |

沒有 pty 的 session（休眠、已結束）等待狀態為 unknown ⇒ 依上表，已完成仍呈現、其餘不呈現；既有的
休眠／結束呈現照舊。

**轉移規則**，每一次輪詢（`tick`，每次都通知）結算一次：

1. 報告被採納 ⇒ `completion = { reportedAt, settled: false }`（覆蓋先前的，含 `reopenedAt`）。
2. **採納之後**的任一次輪詢，其值為 ready ⇒ `settled = true`。
3. `settled` 之後的任一次輪詢，其值為 busy 或 awaiting-choice ⇒ `reopenedAt = now`。
4. unknown 不觸發任何轉移。

**為什麼是「採納之後的輪詢值」而不是「報告之後狀態成為 ready」**：報告經檔案監看送達，等待狀態經
400ms 輪詢送達，兩條通道互不排序。常見序列「寫報告 → 送訊息 → Stop」若 Stop 先被輪詢到、報告才被
讀到，採納那一刻狀態已經是 ready，之後不會再「成為」ready —— 永遠不落定，其後的追問整段都顯示
「已完成」。依值判定就沒有這個洞；而第 2 步要求「採納之後」的輪詢，是因為**寫報告必經的工具呼叫
事件（PreToolUse）一定在報告檔之前落盤**，採納之後的下一次輪詢一定看得到它 —— 一個採納當下殘留的、
報告之前的 ready 不會被誤當成這一輪的結束。

**為什麼要等落定才允許重新開始**：子 agent 寫完報告通常還會用 `SendMessage` 回送母 session（一次
工具呼叫 ⇒ busy）；若報告之後第一次 busy 就算重新開始，每一份報告都會被自己的收尾推翻。

**接線**：每個帶 `lineage` 的 session 在 pty 存在期間持有一份等待狀態訂閱（spawn、喚醒時建立；pty
結束時 `clearWait` 一併清掉）；`SessionStore` 增加一個寫 `completion` 並通知的方法（現有的 `update()`
只允許 `claudeSessionId | cwd`，暫定紀錄那條路徑也不通知）；狀態投影經新的 IPC 推給 renderer（preload
與 `probe:shell` 白名單一併登記）。

**已知的誤判（二）：採納之後的第一次輪詢就已經是忙碌。** 報告被採納之後不到一次輪詢（400ms）使用者或母
session 就送來新的交辦，那一次輪詢摺出來的值是忙碌 —— 狀態機分不出它是報告的收尾還是新的交辦，依規則
不算重新開始；等那一輪做完（就緒）才落定，而那時它仍顯示已完成。窗口是一次輪詢，方向與上一條相反
（把做了事的標成已完成），但子 agent 做完那件事會再寫一份報告。探針因此在送忙碌之前先等 `settled`
落盤（`runCompletion` 的 `awaitSettled`）—— 少了那一步，實測就是這個形狀。

**已知的誤判**：落定之後母 session 回一則客套話，子 agent 因此忙碌 ⇒ 被判為重新開始，其後停下 ⇒
「等你」。方向是保守的（不會把沒做完的標成做完）。

### D7. 結果回送母 session 由子 agent 自己做

子 session 的自我介紹（**只有帶 `lineage` 的**才有這一段）：做完一件事就寫報告；寫完讀關係檔，母
session `running: true` 就以 `SendMessage` 送同一份摘要，否則不送；每完成一件後續要求重複一次。

**自我介紹的兩個寫出點都要帶這一段**：spawn 時，以及 `refreshIntros`（folder 清單變動時的重寫）。
後者目前只拿得到 folders、落點、名字、關係檔 —— 與既有對照組 `intro-refresh-drops-name` 同一類
bug：folder 一變，自我介紹被重寫成缺一段的版本，下一次 `/compact`、`/clear` 或續接之後子 agent 就
不再知道要寫報告，session 永遠停在「等你」，而沒有任何東西會紅。`refreshIntros` 以 `view()`
查每個 session 的 `lineage`。

**關係檔**的子／兄弟加 `state`（`done` / `working` / `waiting` / `idle`，`idle` ＝ 不呈現狀態的那一格，
含休眠）與 `summary`（有的話）。**生命週期狀態的變動成為 `refreshRelations` 的一個觸發點**（只在
呈現的狀態改變時，不是每次輪詢）。母 session 因此即使錯過訊息也讀得到結果 —— 「spekterm 只保存、
不傳遞」下唯一的補償。

**否決：spekterm 往母 session 的 pty 寫入結果。** 既有規格明文禁止寫入來源 session 的終端。

### D8. 呈現

- **狀態標記**：rail 子列、分頁、母 session「→ N」清單的每一項。「→ N」在所有子 session 都已完成時
  換樣式。
- **交接單對話框**（`role="dialog"`）：標題、來源、到達時間（`locale.ts`）、本文（純文字，經 D3 的
  IPC 取得）、最新結果與時間。入口：「← 來源」標示旁的按鈕（**照 12.3 停下 `mousedown`、`keydown`、
  `click` 的冒泡**）、分頁右鍵選單的一項。
- **收掉已完成**：母 session 清單底部「Close completed (k)」（只收這個母 session 的），以及 rail
  全域區塊中只在存在任何已完成交接 session 時出現的入口（收全部）。兩者皆開確認對話框，列出將關閉的
  session **與各自的最新結果**（見 Risks 的偽造報告）。
  - **確認時關閉的集合 ＝ 對話框列出的 ∩ 確認當下仍為已完成的。** 只取後者會關掉對話框開著期間才
    變成已完成、使用者根本沒看到的 session；只取前者會關掉期間重新開始的。關閉 pty 不可逆，兩邊都
    要擋。

### D9. 完成的那一刻發通知（dogfood 的追加）

報告被存下來、查得到，但**使用者不會被告知** —— 四個呈現位置（交接單、✓ 的提示、母 session 的清單、
收掉已完成的確認框）都要他主動去點。dogfood 第一輪就沒看到。

通知走收件匣既有的管線（`IntakeNotifier`），新增一種項目 `completion`：**同一個合併窗、同一組上界**
（兩條通道各自有界等於兩倍）。只有它一則時說出交接標題與摘要（經 `reduceForNotification` 縮減 —— 摘要
是 agent 寫的）；與其他項目合併時走既有的合併文案、觸發時打開收件匣。主鍵以
`COMPLETION_ADAPTER`（`handoff-completion`）＋ session 識別碼表示 —— 它不是任何 intake；觸發時據此分流：
主行程送一個 session 識別碼給 renderer，由它選中那個子 session 並打開交接單（「還在不在」由 renderer 判定）。

**通知綁定於採納，不綁定於狀態**：`HandoffCompletion.acceptReport` 回 `accepted` 的那一刻呼叫一次；
重複讀到的同一份檔（`duplicate`）、等待狀態的推進、重新啟動都不會再通知。

## Risks / Trade-offs

- **[沒有上限，失控的 agent 可以開出任意數量的執行中 session]** → 使用者明知接受。每一個仍出現在
  rail、仍發通知。日後若踩到，加回上限是局部的修改。
- **[第三方內容經 agent 轉手，變成自動送出且不限量的工作]** → 一個讀過 Slack 訊息或第三方 intake
  的 agent，現在可以寫出「到達即執行」的交接；先前那條路上的人類閘門是使用者按下送出（`agent-intake`
  已承認非第三方本文「仍可能被來源 agent 讀過的東西塑形」）。使用者裁決的直接後果，不另做防護；
  界線與 nonce 仍保留。
- **[完成報告可被偽造]** → 任何 agent 都能把別的交接 session 標成已完成，再誘導使用者「收掉已完成」
  （不可逆）。確認對話框列出每一個的最新結果，使用者在關閉之前看得到那份報告說了什麼。
- **[權限模式]** → 讀 context 檔與寫報告都需要工具許可。使用者的預設模式（auto）下不詢問
  （第十一節實測）；**其他模式未測**，在那些模式下子 session 會一開起來就停在等待選擇，「不必回到
  spekterm」不成立。記載，不處理。
- **[D0 不成立]** → 回到 design；見 D0。
- **[子 agent 不寫報告]** → 停在「等你」，不會誤標為完成。
- **[重新開始的誤判（D6 最後一段）]** → 方向是保守的。
- **[CLI 行為前提]** → 結果回送依賴 Claude Code 本機訊息（第十一節，2.1.282）；失效時母 session
  收不到訊息，但關係檔與 spekterm 的呈現不受影響。

## Migration Plan

- **本 change 之前建立的交接 session** 已有 `lineage`、沒有 `brief` 與 `completion`：
  - 標籤照舊（沒有交接標題可用），沒有交接單入口 —— 不回填，intake 的內容可能已過期。
  - **狀態標記照常呈現**（它們由交接建立）；下一次 spawn 或自我介紹重寫時，它們的 agent 會收到
    完成報告的說明。
- 落盤只加 optional 欄位與新的 `<id>.handoff.json`，不遞增版本。**回滾**：舊版的 `parseLineage` 與
  白名單會丟掉 `brief` 與 `completion`；`.handoff.json` 會被舊版的 `pruneScrollback` 忽略而殘留
  （它只認 `.scrollback`）。升回來之後孤兒由新版清掉。
- 移除上限沒有落盤狀態需要處理。
