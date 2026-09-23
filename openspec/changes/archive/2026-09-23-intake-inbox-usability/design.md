## Context

動機見 proposal.md 的 Why。這裡只列會影響作法的現況：

- **接受是兩段式**：renderer 呼叫 `accept(id, adapter)`，主行程以 `resolveRouting` 解出
  `folderId` 並回傳一個**指示**；renderer 走既有的 `sessions.create()` 建 session，再以
  `attach` 回報 sessionId，主行程才寫 context 檔、排定預填。session 清單的權威在 renderer
  （主行程自建的 session 會在下一次 `replace` 時被抹掉，而 pty 還活著）。接受成功後 overlay
  **關閉**（`IntakeOverlay` 的 `close()`）。
- **overlay 的三個分頁是互斥掛載的**：切到 Rules 或 Slack 分頁時，收件匣的卡片全部卸載。
  規則唯一的編輯入口就在 Rules 分頁。
- **「已開好」那一段的篩選是 `state === 'accepted' && sessionId`**，沒有任何離開條件。
  它是到達即建立 session 的交接**唯一**呈現本文的位置，而 `agent-intake` 規定那裡的本文
  不得截斷 —— 「按下送出」是那條路徑上唯一的閘。
- **「已送出」的訊號已經存在但不落盤**：`attach` 排定預填後以 `subscribeWait` 等 agent 的
  等待狀態**不再是 `ready`**，見到就推 `prefill: 'sent'` 給 renderer，只用來撤掉「待送出」
  標示。**注入的 hooks 不含 `UserPromptSubmit`**（`agent-events.ts` 的 `HOOKED_EVENTS`），
  所以「使用者按了 Enter」本身沒有事件；現行判定實際上是「之後有任何非 ready 的事件」——
  包括落回 `unknown` 的那些（不認得種類的 `Notification`、`SessionEnd`、不認得的事件）。
- **已接受項目的 folder 名是在列出時重算 routing 得到的**（`project()` 對每一則都跑
  `resolveRouting`）。那報的是「現在的規則會解到哪」，不是「它當時開在哪」—— 今天因為使用者
  沒有改過規則而碰巧相同。
- **落盤格式**：`parseIntakeFile` 對 `state` 做白名單（`pending` / `accepted` / `dismissed`），
  不在其中的整筆**丟棄**；`INTAKE_VERSION` 不得遞增（遞增＝丟掉使用者整個收件匣）。
- 清單順序是 `Map` 的插入順序（最舊的在上）；`receivedAt` 已在投影裡，但畫面沒用。
- **`npm test` 的 glob 不含 `src/main/ipc/`**（`src/main/*.test.ts` 只有一層）。
  `src/main/ipc/intake-projection.test.ts` 因此**從未被執行過**，而它現在有一條是紅的
  （「注入設定的頂層欄位未因本能力而增加」：期望 `['hooks']`、實得 `[]`）。對照表有三列的
  載體住在這個檔案裡。`project()` 住在 import electron 的 `ipc/intake.ts`，那個檔案裡的
  「投影」是手抄的複本。

## Goals / Non-Goals

**Goals:**

- 使用者在接受的那一刻決定 folder，且**系統在任何情況下都不替他補一個預設值**。
- 「已開好」那一段只呈現**仍然需要被看**的項目，而判準從「為什麼要呈現它」推導，
  不是一個任意的時間窗。
- 所有新增的落盤內容對舊版與回滾都是無害的。
- 這個 change 動到的每一條規則，都有一個**會被執行、而且會變紅**的載體。

**Non-Goals:**

- 不把使用者的選擇回寫成 routing 規則，也不因此調整規則的比對邏輯。
- 不注入 `UserPromptSubmit` hook 來取得真正的「已送出」訊號（見 D4 的替代方案）。
- 不重做預填在應用程式重啟後遺失的既有缺口（見 Risks）。
- 不動拒絕痕跡（notices）的內容與上界；只有它的相對時間順帶隨時鐘更新（D6）。
- 不回填已經收進來的項目的發生時間（D6）。

## Decisions

### D1. 使用者的選擇是 `accept` 的參數，不落盤

`accept(id, adapter, folderId)`：renderer 送出**使用者在卡片上確認的** `folderId`，主行程
**查表**確認它在當下 workspace 的 folder 集合之中。主行程**不再**以 routing 的結果作為接受
的依據 —— routing 退為「預選哪一個」的來源（D2）。

判定順序（與現況相同的部分不動）：record 不存在 ⇒ `unknown`；事件回報關閉 ⇒
`prefillUnavailable`；`folderId` 缺漏、非字串或為空字串 ⇒ `unknown`；不在 folder 集合 ⇒
`FOLDER_GONE`。

- **缺了 `folderId` 一律拒絕**，SHALL NOT 在主行程退回 routing 的結果。兩條路並存的話，
  「使用者沒選」與「使用者選了 routing 的那個」在主行程裡分不出來，而解析不出 folder 的項目
  就有了一條不經使用者的預設路徑 —— 正是 `intake-routing` 禁止的事。
- **這條保證的載體必須打到主行程的 handler。** UI 永遠送出呈現值、停用的按鈕點不到主行程
  （瀏覽器不對 disabled 控制項派送 click，React 也依 `props.disabled` 壓掉 onClick），所以
  任何經畫面的斷言對主行程的實作都是綠的。探針直接呼叫 `window.workspace.intake.accept`，
  不帶第三參數、帶 `''`、帶一個不存在的識別碼，三者皆須被拒絕、仍為待處理、session 數不變。
  「退回 routing」的 mutation 放在 handler 裡。
- 判定本身抽成不 import electron 的純函式，單元測試覆蓋四條分支；它的輸入**不含**解析結果，
  於是「退回」在它裡面寫不出來 —— 那是結構，而 handler 那一層由上一點的探針守。
- **邊界沒有被放寬**：`folderId` 本來就是 renderer 的合法詞彙，renderer 本來就能在任何
  folder 建 session。圍堵性來自查表，而查表還在。
- **適用於所有待處理項目，包括預填逾時退回待處理的交接。** `intake-routing`「已解析目標者
  不比對規則」講的是**規則**不得改寫它；使用者親手改選不在那條的作用域內。
- 主行程回 `FOLDER_GONE` 時的文案要新增一條：現有的「這條規則指向的 folder 已不在 workspace」
  講的是規則，對「你選的 folder」是錯的。

**否決：把選擇落盤在 record 上**（例如 `overrideFolderId`）。決定發生在按下接受的那一刻，
落盤只換來一個會過期的狀態：folder 被移除之後它指向不存在的東西，還得定義它與 routing
變動的優先序。

### D2. 預選：住在 overlay，而不是卡片

改選存在 **`IntakeOverlay`** 的一個 `Map<adapter + id, folderId>`，**不是** `IntakeCard` 的
state。卡片在切到 Rules 分頁時會卸載，而規則只能在那個分頁改 —— 放在卡片裡的話，「改選之後
規則的變動不覆蓋使用者的選擇」在真實操作中**必然不成立**（使用者一定是先切走、改規則、再切
回來）。overlay 關閉時 Map 隨之消失；那是 D1「不落盤」的直接後果。

卡片呈現的值由一個純函式決定，依序取第一個**仍在 workspace 中**的：

1. 使用者在這次打開收件匣之後的改選；
2. **該則已建立過、而且仍存在的 session 所在的 folder**；
3. routing 的解析結果；
4. 都沒有 ⇒ 空字串（渲染佔位項，接受鈕停用）。

第 2 條是為了預填逾時的項目：第一次接受時使用者把 A 改成 B，session 開在 B，逾時後退回
待處理 —— 接受成功時 overlay 已經關閉，改選隨之消失。少了第 2 條，重開後預選回到 A，使用者
沒注意就按下接受，本文送進他剛剛明確拒絕的 repo。有了它，「未改選即再次處理」自然落在同一個
folder，D3 沿用既有 session。

- 值為空字串時**一律**渲染佔位項（不只「解析不出」的項目）—— 否則一個不在選項中的值會讓
  `<select>` 顯示第一個選項、送出的卻是那個不存在的值（`RulesEditor` 的規則選單已經是這個形狀）。
- 改選指向的 folder 已不在 workspace ⇒ 回到佔位項，並說明他選的 folder 已不在（與 D1 的
  `FOLDER_GONE` 同一句）。只清空選單的話，使用者看到的是「我剛剛選的東西不見了」而沒有原因。
- **原生 `<select>`**，與 `RulesEditor` 同一種元件 —— 全鍵盤操作是瀏覽器給的。`aria-label`
  取自字典（它同時是探針的選擇器）。

### D3. 沿用舊 session 的判斷把 folder 納入

`sessionToReuse` 目前只問「那個 session 還在不在」。改選 folder 之後，那個 session 在**舊的**
folder —— 沿用它等於把本文送進使用者剛剛明確拒絕的 repo。改為「存在，且 folder 等於確認的
folder 才沿用」。仍是 renderer 端的純函式（清單權威在 renderer）。

**舊 session 不自動關閉。** 它的預填已經逾時，但使用者可能已經在裡面打過字；關閉 pty 是
救不回來的動作。`attach` 以新的 sessionId 覆寫 record 上的關聯。

有了 D2 的第 2 條，走到「不沿用」的唯一路徑是使用者**在這次打開收件匣之後親手改選**，
於是 spec 那句「每一次這樣的再次處理都出自使用者的明確改選」是成立的。

### D4. 「已開好」的離開條件

那一段存在的理由是「按下送出之前看得到本文全文」。理由消失的時刻：

| 條件 | 在哪裡判定 | 落盤？ |
|---|---|---|
| 預填的 prompt 已送出 | 主行程，`subscribeWait` 回呼 | **是**（`settledAt`） |
| 使用者手動清除 | 新的 IPC `settle(id, adapter)` | **是**（`settledAt`） |
| 該 session 已不存在，或它的 folder 已不在 workspace | renderer，對照 live session 與 folder 清單 | 否 |
| **應用程式重新啟動** | 主行程，啟動時載入收件匣之後、任何來源開始投遞之前 | **是**（`settledAt`） |

**第四列是 dogfood 之後補的。** 第一版只有前三列，於是改版前接受的項目（session 被還原、沒有
「已送出」的紀錄）只能手動清除 —— 使用者看到的是「Opened in 還是沒消失」。而它背後的理由比
「清舊資料」更一般：**預填的 prompt 住在 pty 的輸入處，pty 活不過應用程式**。重新啟動之後，
那一段存在的理由（送出之前看得到本文）對啟動之前接受的每一則都已不成立。

- **時機是承重的**：必須在載入之後、交接與投遞來源啟動之前。晚了的話，一則在啟動瞬間到達即
  接受的交接會被一起了結，它的本文在使用者看到之前就消失了。
- **代價**：沒送出就關掉 app 的交接，重開後不在收件匣裡（session 仍在目標 repo，context 檔也在）。
  那一則 prompt 本來就已經不在了，留著它只是指向一個按不下去的送出。

- **`list` 直接排除已了結的項目**（`accepted` 且帶 `settledAt`），`IntakeView` 不新增欄位。
  那些項目的本文不再隨每次 broadcast 整批送往 renderer，而「已了結但仍呈現」的錯誤實作只剩
  主行程一個地方可以犯。
- `settledAt?: number` 放在 record 的**去重鍵那一半**（它是狀態，不是內容；內容可以過期，
  狀態不行）。`parseIntakeFile` 的逐欄位白名單加一條，**`INTAKE_VERSION` 不動**。
- **`attach` 清除 `settledAt`。** 路徑：預填還沒發生時手動清除 → 逾時退回待處理（仍帶著
  `settledAt`）→ 再次接受 → 它會立刻從已開好那一段消失，使用者連本文都看不到。
- **「已送出」收窄為等待狀態成為 `busy` 或 `awaiting-choice`**，`unknown` 不算。現行判定
  把任何非 ready 都當成送出，那在過去只撤掉一個暫時的標示；落盤之後，一次誤判會把交接的本文
  從它唯一的呈現位置**永久**移除，而且沒有「取消清除」。收件匣的 prompt 必然要求 agent 先讀
  context 檔，所以真正的送出一定會經過一次 `PreToolUse`（⇒ `busy`）。「待送出」標示改用
  **同一個判定** —— 兩處各自判斷「送出了沒」會讓標示消失而項目還在（或反之）。
- session 條件**每次渲染時計算，不落盤**：session 識別碼是 UUID，不會被重用；在 renderer 算是
  因為清單權威在那裡。folder 那一半是因為移除 folder 未必會關閉它的 session（實作時查證），
  那樣的 session 沒有 rail 入口，呈現它只會讓那一則永遠留著。
- 手動清除也處理**既有的**已接受項目 —— 它們沒有 `settledAt`，而 session 可能還開著。

**否決：新增一個 `IntakeState` 值（例如 `'settled'`）。** 舊版的 loader 對 `state` 做白名單，
不認得的**整筆丟棄** —— 回滾一次，所有已了結項目的去重鍵跟著消失，Slack 的回補就會把那些
提及當成新的再送進來。另外 CLAUDE.md 記過兩次「加一個列舉值，`===` 的二分判斷靜默落進
`else`」；`state === 'accepted'` 在主行程與 renderer 都有。

**否決：以時間窗清除（例如 24 小時）。** 交接到達時使用者可能不在電腦前；週末過後它的本文
已經從唯一的呈現位置消失，而 prompt 還沒送出。

**否決：沿用 `dismissed`。** 它的語意是「沒有建立 session」（`agent-intake`「忽略不建立
session」），而已開好的項目確實建了一個。

**替代方案（不採用）：注入 `UserPromptSubmit`。** 那是真正的「使用者送出了」，但它動到
`agent-event-bridge` 的 hook 白名單與等待狀態機，而收件匣的 prompt 已經保證會經過
`PreToolUse`。等到出現一條不經工具的收件匣路徑再做。

### D5. 投影抽出 electron 之外，已開好項目的 folder 取自 session

- `project()`、`list` 的篩選與排序搬到**不 import electron 的模組**（`src/main/intake-projection.ts`），
  `ipc/intake.ts` 只做接線。`src/main/ipc/intake-projection.test.ts` 裡的手抄投影換成 import
  真的那一份。
- **`npm test` 的 glob 擴大到 `src/main/*/*.test.ts`**，並先把那條一直沒被執行的紅燈修到綠
  （找出根因，不放寬斷言）。對照表那三列的載體從此才真的有在跑。
- 投影只對**待處理**項目求 routing；已接受者不帶 `folderId`。renderer 以該則的 `sessionId`
  在 live 清單中找到 session，用它的 `folderId` 查名字。D4 保證被呈現的已開好項目，其 session
  與 folder 都存在。今天重算 routing 是碰巧正確；有了 D1，接受時選的 folder 與 routing 不同
  就是常態，重算會把名字標錯。

### D6. 排序與時間：顯示「發生」的時間，而且是完整的日期時刻

第一版顯示相對的**到達**時間，dogfood 當場踩到兩件事：昨天的 Slack 提及寫著「剛剛」（它們是
應用程式啟動時一次回補進來的），而使用者要的是直接看到完整的時間。兩件事的解法不同：

- **格式**：完整的日期與時刻（`formatDateTime`，`dateStyle: 'medium'`、`timeStyle: 'short'`），
  經 `src/shared/i18n/locale.ts`。不再用相對時間，於是也不需要每分鐘重算（`useNow` 仍留給
  拒絕痕跡的相對時間）。`<time dateTime={ISO}>` 包住它。
- **哪一個時間**：投遞格式新增選填的 `occurredAt`（ISO 8601 字串），**歸在第三方撰寫的那一組**
  （`IntakeAuthored`）—— Slack adapter 是經共用落點投遞的 producer，它寫的東西與外部 producer
  同樣不受信任。解析成毫秒存放；宣告了而不可解析 ⇒ `FIELD_TYPE`（與其他欄位型別不符同一個
  處置、同一條永久性拒絕）。
- **有效時間 ＝ `min(occurredAt ?? receivedAt, receivedAt)`**，投影時算好（`IntakeView.occurredAt`），
  呈現與排序都用它。**上限是結構性的防護**：那個欄位是投遞者撰寫的，不夾住的話任何一份投遞都能
  宣告一個未來的時刻，把自己釘在收件匣的最上面。
- **`list` 依有效時間由新到舊排序**（D5 的模組內，單元測試）。放在主行程是讓所有消費者看到同一個
  順序；它不影響計數。內容已過期者沒有時間，排最後。
- **不進去重的摘要**（`digestOf`）：同一則訊息重送時它不變，放進去沒有鑑別力；而一個 producer
  若改了時間格式（例如小數位），同一則就會被判成「識別碼搶佔」。
- **Slack**：`buildDelivery` 以被提及那一則訊息的 `ts`（epoch 秒，帶小數）換算。

**否決：從 Slack 的識別碼（`slack:<team>:<channel>:<ts>`）反推時間。** 那會讓收件匣依賴一個
單一來源的識別碼格式（`agent-intake` 明文禁止以單一來源的詞彙定義通用欄位），而識別碼是 producer
挑的 —— 與 `occurredAt` 一樣不受信任，卻少了型別與上限。代價是**已經收進來的項目**仍顯示到達時間。

### D6b. 卡片版面：資訊列在前，重複的標題不呈現（dogfood 回饋）

長標題與「誰、在哪、何時」放在同一列時，後者被擠成好幾行；而 Slack 的標題就是本文裡那一則的
第一行，同一段話在卡片上出現兩次。改為第一列放資訊（不折行），**標題只在本文不包含它時呈現**。
判準對任何 producer 相同（不以來源種類分支）；標題仍在那一列的無障礙標籤裡，交給 agent 的內容
一個字元都沒變。

### D7. 探針斷言：釘使用者讀到的東西

- **選單讓整列的 `textContent` 含每一個選項的名字**。`runRouting` 現有的「Opens in」斷言與
  「不是 fallback」的否定斷言，真假會變成取決於選項順序。一律改讀**被選中的那一個選項**的文字。
  `intake-routing`「不可解析者不呈現任何 folder 名稱」照字面對選單恆為假，spec delta 已改寫成
  「沒有被選定的 folder」。
- **時間斷言釘文字，不是屬性**。`dateTime` 屬性使用者看不到；`<time dateTime={iso}>` 裡放一個
  錯的字串照樣綠。期望字串在頁面內以同一組 `Intl.DateTimeFormat` 設定算出，斷言 `<time>` 的
  textContent。**種入的項目要讓發生時間與到達時間不同** —— 否則「顯示到達時間」的錯誤實作照樣綠。
- **排序的種入要是回補的形狀**：到達時間相同（或與發生時間的順序相反）、發生時間各不相同，且落盤
  順序打亂 —— 否則「依到達時間排」「反轉插入序」都會綠。另種一則宣告未來時刻的，斷言它依到達
  時間排、顯示到達時間。
- **session 開在哪個 folder 以 pty 行程的 `/proc/<pid>/cwd` 判定**，不讀 renderer 狀態。
  「於解析出的 folder 建立」的既有載體只看畫面上的文字，從來沒有驗到 session 真的開在哪裡。
- 同一條教訓在 `docs/lessons/intake.md` 第六節：斷言釘的東西要與使用者讀到的東西是同一個。

## Risks / Trade-offs

- **[「已送出」仍是推論]** 判定是「等待狀態成為 busy 或 awaiting-choice」，不是「使用者按了
  Enter」。使用者送出之前 agent 就自己開始工作（例如某個 hook 觸發的動作）時，該則會提早離開
  收件匣 → 收窄到 busy／awaiting-choice 之後，已知的誤判來源（`unknown`）被排除；本文仍在
  context 檔中。後果是持久的，因此這條寫在這裡而不是當作小事。
- **[真正的送出而 agent 沒用任何工具]** 就不會被判定為送出，該則停在已開好 → 收件匣的 prompt
  必然要求讀檔，這條路徑在本能力內不會發生；發生時手動清除是出口。
- **[重啟後預填遺失]** 應用程式重啟時 pty 死亡，輸入處裡未送出的 prompt 消失 → 啟動時一併了結
  （D4 第四列）。**預填本身不在重啟後重做**，那是既有缺口，不在本 change。
- **[關閉收件匣就丟掉改選]** D2 的 Map 隨 overlay 消失 → 已建立過 session 的項目由 D2 第 2 條
  接住；其餘的回到 routing 結果，接受之前看得到。
- **[改選 folder 後，舊 session 留在原處]** 預填逾時留下的那個空 session 不會被關閉 →
  由使用者自己關；自動關閉 pty 是破壞性動作（D3）。
- **[既有的已接受項目]** 升級後第一次啟動即全部了結（D4 第四列）。
- **[啟動瞬間已開好那一段是空的]** renderer 的 session 清單還原完成之前，D4 的 session 條件
  判定為「不存在」→ 還原後即出現；不落盤所以不會誤清。
- **[已經收進來的項目沒有發生時間]** 它們仍顯示到達時間（dev 那批回補的提及會停在啟動的
  那一刻）→ 只有之後的投遞帶著它；不從識別碼反推（見 D6）。
- **[發生時間是投遞者寫的]** 它可以說謊（把一件事說得比較早）→ 上限只擋「未來」；說得比較早
  只會讓自己排得比較後面，那不是投遞者想要的方向。它不作任何判斷依據。
- **[同名 folder]** 選單只顯示名字（renderer 沒有路徑詞彙）→ 與 rail、`RulesEditor` 相同的
  既有限制，不在本 change 處理。
- **[`useNow` 的抽出]** 收件匣的項目改為絕對時間之後，它只剩拒絕痕跡在用；FilesPanel 的抽出
  仍然成立（同一個 hook 不該有兩份）。
- **[擴大 `npm test` 的 glob]** 那個檔案從未被執行，現在有一條紅 → 修到綠是本 change 的一項
  task；修的時候要找根因，不能為了讓它綠而放寬斷言。

## Migration Plan

- 落盤只加 optional 的 `settledAt`，**不遞增 `INTAKE_VERSION`**。
- **回滾會永久遺失已了結的標記**：舊版以逐欄位白名單重建紀錄，其後任何一次存檔都寫回不帶
  `settledAt` 的紀錄。那些項目在舊版重新出現在已開好那一段（即今天的行為），**升回新版之後
  也一樣會出現**，要再清一次。`entries` 一則不少、去重鍵完整 —— 遺失的只是呈現用的標記。
