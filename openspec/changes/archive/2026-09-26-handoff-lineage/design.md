## Context

動機見 proposal.md；行為契約見 `specs/`。這裡只記下決定實作形狀的既有事實與實測。

**既有程式：**

- **來源 session 只在一個地方被算出來**：`handoff-service.ts` 的 `deliverFile()` 由落點目錄名取得
  `sessionId`（`sourceSessionOf` 回傳任何目錄名，不驗格式），然後 `sourceOf()` 把它縮成
  `{ folderId, label }`（`index.ts:464-471`；全域的 label 是寫死的 `'Global'`，已結束的是字面的
  `(ended)`）。之後那個識別碼只殘存在 intake 的 `id` 字首。
- **兩條建立路徑**：
  - 到達即建立：`requestAutoAccept` → renderer 的 `IntakeAutoAccept.tsx:52-58` **直接**
    `sessions.create()` → `attach`，**不經過 `accept`**；推送的酬載只有 `(adapter, id, folderId)`。
  - 手動接受：`accept` → `create()` → `attach`。
  - 兩者都是 renderer 先建 session（pty spawn、自我介紹寫出），才 `attach`。
- **`attach` 的 `sessionId` 由 renderer 提供**，handler 不檢查 record 的狀態（`ipc/intake.ts:313-332`）；
  record 在了結之後狀態仍是 accepted、且永不刪除（`intake-store.ts:332-336`）。
- **主行程專屬欄位的模式**：`claudeSessionId`／`cwd` 不在 `RendererSession` 型別裡，由 `update()`
  寫入、`replace()` 以 `kept` 保留，renderer 尚未送來該筆時先暫存於 `#pendingMainFields`
  （`session-store.ts:241,307-377`）。**暫存只有主行程欄位**（沒有 `folderId`／`spawnTarget`），
  **`list()`/`get()` 看不到它**，而且只有 `replace()`／`remove()` 會刪它 —— renderer 在送來之前
  重新載入，那筆暫存就永遠留著。renderer 送來新 session 要等約 500ms 的 debounce。
- **restore 以解構排除主行程欄位**（`ipc/terminal.ts:303`）；pty 自行結束時 session 被移出 store
  （`ipc/terminal.ts:118`），但 `reason === 'disposed'`（renderer 重新載入）時提早 return。
- **claude 以字串命令啟動**：`spawnArgs()` 回 `['-l', '-c', 'claude … --resume <id>']`
  （`terminal.ts:151-167`）。每個 session 各自的環境變數由注入的 `env` 交付，而 `composeInjection`
  在所有注入功能都關閉、或設定檔寫不出來時回 `null`（`agent-injection.ts:96-98,132`）—— 那時
  **沒有任何 env**。`ptyEnv()` 展開 `process.env`，只剝除 `NESTED_CLAUDE_ENV` 列舉的那幾個
  （`terminal.ts:110-139`）。
- **自我介紹只在 `SessionStart` 進入 agent 脈絡**；spawn 時寫出，folder 清單變動時由
  `refreshIntros(liveSessions(), store.list())` 重寫（`index.ts:492-494`），**重寫時只帶 folder 清單
  與落點**。
- **`clearOutbox` 只經 `kill()` 呼叫**；pty 自行結束與 dispose 都不經過它。
- **「已送出」的判定是「agent 開始工作」**（`ipc/intake.ts:340-355`）—— 沒有真正的送出事件。
- **被移出 workspace 的 folder**，其 session 仍在跑但沒有 rail 入口（issue #51）。
- **`useDragReorder` 的 `count`／`rectOf` 在按下之前就固定**（`useDragReorder.ts:59-158`）；
  rail 的 `rowRefs` 與捲動 key 用扁平序位（`WorkspaceRail.tsx:186-212, 471-482`）。
- **`terminal.test.ts:634-646`** 斷言「兩個 claude session 的 argv 去除 UUID 之後完全相同」—— 各自
  不同的 `--name` 值會讓它變紅。

**agent CLI 的實測**（Claude Code 2.1.282，2026-09-25）：

| 問題 | 結果 |
|---|---|
| 本機 session 名冊在哪 | `~/.claude/sessions/<pid>.json`，含 `sessionId`（對話 id）、`name`、`nameSource`、`messagingSocketPath` |
| 未指定名字時 | `nameSource: "derived"`，名字由工作目錄加兩碼產生（`spekterm-3c`），**每個行程不同**；名稱全為非 ASCII 的目錄（`簡報`）得到 `claude-01` |
| `claude --name X` | 名冊中 `name: "X"`、`nameSource: "user"`，且有自己的訊息 socket |
| 指定名字對終端標題的影響 | 未指定：`✳ Claude Code` → 送出 prompt 後變成 `✳ Git rebase 說明`。指定：**從頭到尾是 `✳ X`** |

D0 的補測（同日）見 `docs/lessons/handoff.md` 第十一節：**以名字跨工作目錄送達成立**；名字的字元
CLI 全部原樣接受；`--resume` 並用 `--name` 以後者為準；**兩個同名行程同時執行時都保留同名**（歧義，
不是改名）；收件的 agent 收到訊息即自行開始工作；auto 模式下讀 userData 的檔案不詢問權限。

## Goals / Non-Goals

**Goals:**

- 關係與名字的**權威在主行程**，renderer 只持有它們的投影，且沒有任何途徑寫入。
- 子 session 的 agent **第一次**被注入時就知道自己的母 session。
- agent 取得關係的方式**不依賴它的脈絡被重建**。

**Non-Goals:**

- 不經手訊息本身，不讀取 agent CLI 的名冊（內部格式；本 change 只依賴 `--name` 這個公開參數）。
- 不改變交接自身的定址、上限與自動建立的語意。
- 不做跨 repo 的關係總覽。

## Decisions

### D0. 先補完實測，再動程式（已完成，結論見 `docs/lessons/handoff.md` 第十一節）

以真實的 agent CLI 補測，結論寫進 `docs/lessons/handoff.md` 並註明版本：

1. **以名字送達，而且跨工作目錄**：一個 `--name` 指定、位於另一個 repo 的 session，能否以名字收到
   另一個 session 送出的訊息。**這是整個「互相聯絡」的前提** —— 不成立時停下來，與使用者重新討論
   第三部分，不繼續實作那一塊。
2. `--name` 可接受的字元與長度（驗證 D5 的正規化夠不夠嚴）。
3. `--name` 與 `--resume` 並用時名冊中的名字。
4. 同名的行程**仍在執行**時新的那個會怎樣（D5「等前一個 pty 結束」的依據）；名冊殘留同名而行程
   已死時會怎樣；「沒有輸出」能否重現。
5. **agent 讀關係檔會不會觸發權限詢問**（檔案在 userData，工作目錄之外）。會的話，回頭改
   `session-lineage` 的 spec，加上「關係改變後，於使用者下一次送出時注入」的途徑（以
   `UserPromptSubmit` hook 注入差異），再實作。

任何一條與預期相反時，先改 spec 與 design，再繼續 —— 不讓實作與 spec 各自為政。

### D1. 來源與快照於攝入時寫進 intake 的「可驗證」欄位

`DeliveryProvenance`／`IntakeVerified` 多一個選填的 `source`：

```
source?: {
  sessionId: string                                   // isUuid
  origin: { kind: 'folder'; folderId: string; folderName: string }
        | { kind: 'global' }
        | { kind: 'unknown' }                         // 攝入時來源已結束
  title?: string                                      // 正規化 ＋ 截斷
}
```

- **歸屬是顯式的三態聯集**，不以 `null`／`undefined` 表達 —— 後者讓「已結束」被 `=== null` 或 falsy
  判斷呈現成「來自全域」，而型別檢查對此無感（`CLAUDE.md`「加列舉值時 grep 所有 `===`」）。
  消費端以窮舉 `switch` 處理，新增一種時編譯器會紅。
- **放在可驗證的這一組**：不是 `actor`／`originLabel`（投遞者撰寫），那一組受 `MAX_FIELD_LENGTH`
  約束且進入 `digestOf`。但**標題本身是 agent 可控的文字**（pty 宣告，或使用者輸入），所以它仍
  經 `normalizeAuthored` 並以 code point 截斷。
- **快照在攝入時取**（spec 要求「交接當下」）。全域不存字面值，名稱於呈現時取自字典。
- `sessionId` 於 `deliverFile()` 與**載入收件匣時**各以 `isUuid` 驗一次；不合法只丟 `source`。

### D2. 關係於建立 session 的當下寫入，以單次憑證授權

**憑證**：主行程在「決定要為某則交接建立 session」的兩個時刻簽發 —— 送出自動接受的推送時、
`accept` 成功時 —— 綁定 `{ record 主鍵, folderId, spawnTarget: 'claude' }`，存在記憶體中，
用過即刪、逾時（例如 60 秒）即失效。renderer 把它原樣交給 `create()`。

**建立**（`ipc/terminal.ts` 的 create handler）：

1. 憑證存在且與這次的 folder、spawn 目標相符 ⇒ 消費它；否則忽略（照常建立，沒有來源）。
2. **在 spawn 之前**寫一筆**暫定紀錄**：`folderId`、`spawnTarget`、`lineage`（取自 record 的
   `source`）、`peerName`（D5）。
3. spawn —— 自我介紹與關係檔此時都已看得到母 session 與自己的名字。
4. 回傳值帶上 `lineage`，renderer 據此放置新分頁（D3）並唯讀持有它。

**重建既有 session（帶 `sessionId` 的那條路）一律忽略憑證。** 對既有 session 寫入關係，在介面上
表達不出來。

**暫定紀錄**取代 `#pendingMainFields` 在本 change 中的角色：它帶有 `folderId`／`spawnTarget`，於是
算得出新子 session 的 repo；它只在自己的 pty 活著時算「存在」（D7）；renderer dispose 時清除所有
尚未被 `replace()` 認領的暫定紀錄（那些 session 永遠不會被持久化了）。`replace()` 認領時合併進正式
紀錄。

`PersistedSession` 多兩個主行程專屬欄位 `lineage`、`peerName`：`RendererSession` 排除兩者、
`replace()` 保留、`parseSessionEntry` 逐欄驗證（`parentId` 以 `isUuid`、`origin` 的三態逐一驗形狀、
`peerName` 以 D5 的字元集；不合法只丟該欄位）。restore 送給 renderer 的帶 `lineage`、**不帶
`peerName`**（renderer 用不到它）。

被否決：
- **在 `attach` 寫入**：`attach` 的 `sessionId` 是 renderer 給的、不檢查狀態，等於讓 renderer 能把任何
  既有 session 掛成某則交接的子節點；而且那時 spawn 已完成，第一次注入看不到母 session。
- **憑證以 record 主鍵本身充當**：record 永不刪除、了結後仍是 accepted，任何一則歷史交接都能被無限
  次引用。

### D3. 放置：由 `create()` 回傳的關係決定

renderer 拿到 `lineage` 後，若母 session 在同一個 rail 項目，把新 session 放在「母 session 與它所有
子孫」裡**位置最後的那一個**之後（分頁列的拖曳可能已把子孫移到母之前）；否則照舊放最後。
不必另外在推送或接受結果中帶放置提示。

### D4. rail 的樹是「順序 ＋ 關係」的純投影

新純函式模組 `session-forest.ts`（比照 `rail-rows.ts`，可單元測試）：

- **建樹**：節點的母節點 ＝ `lineage.parentId`，**但只在母 session 存在（D7）且屬於同一個 rail 項目
  時**；否則為根。**環上的節點一律為根**（先偵測環，再建樹）。兄弟之間的次序取自單一順序中的
  相對位置。
- **呈現**：DFS；縮排深度上限 **3**，超過者以第 3 層呈現。
- **rail 拖曳**：每個兄弟群組（同一個母節點之下、或頂層）各用一個 `useDragReorder` 實例 ——
  它的 `count`／`rectOf` 在按下之前就固定，而「兄弟整塊」的群組只有按下哪一列才知道；每群一個
  實例讓那兩個值在按下之前就已確定。`rectOf(i)` 量的是第 i 個兄弟**連同其子孫**的整塊範圍（比照
  `folderRectOf`）。提交時把整塊從單一順序中取出，插到目標兄弟整塊之前，或最後一個兄弟整塊之後。
- **`rowRefs` 與捲動 key 改以 session 識別碼為鍵**，不以扁平序位 —— 樹狀呈現後畫面的列序與扁平
  序位不同。
- **需要新的 session API** `setOrder(folderId, ids)`（`reorder(folderId, from, to)` 只能移一個項目），
  並把路徑上的早退條件逐一檢查（`CLAUDE.md`「替既有操作加上第二個狀態時，把早退 grep 一遍」）。
- **分頁列拖曳不變**，rail 自動重新投影。

整塊移動會把差一格的偏移放大成整塊的長度：**單元測試與探針一律用至少三個兄弟、帶子樹、往下拖**。

### D5. 固定名字

- **組成**：前綴 ＋ `-` ＋ 短碼。前綴由 rail 項目名稱正規化：非 `[\p{L}\p{N}_-]` 換成 `-`、收斂連續
  `-`、去首尾 `-`；全域為 `global`；為空時為 `session`。短碼為 session 識別碼的前 4 個十六進位
  字元，與既有名字（**不分大小寫**比較）相撞時延長為 6、8…。總長上限 64，超過時截短前綴。名字恆以
  字母或數字開頭（前綴為空時用 `session` 就是為此 —— 否則會是 `-c463`，被 CLI 當成旗標）。
- **決定的時刻**：`create()` 的步驟 2（同步，於是兩個並行的 create 不會在 await 之間撞名）；既有而
  尚無名字的 session 於 `SessionStore` 載入時。**不延後到第一次 spawn** —— 休眠的母 session 在被
  喚醒之前也要有名字可以告訴它的子 session。
- **交付**：在 `spawnArgs()` 同一處**成對**產生 —— env 帶 `SPEKTERM_PEER_NAME`、命令字串加上固定
  片段 `--name="$SPEKTERM_PEER_NAME"`。**不經 `composeInjection`**：它在注入功能全關時回 `null`，
  名字會跟著消失（spec 明文要求那時仍要交付）。`#heal()` 走同一個 `spawnArgs()`，自然帶上
  （`docs/lessons/terminal.md`「pty 誕生時要做的事，自癒那條路上都要自己再做一次」）。
- **`ptyEnv()` 剝除所有 `SPEKTERM_*`** 之後再合併本 session 的專屬變數 —— 比照 `NESTED_CLAUDE_ENV`。
  開發時 spekterm 常在另一個 spekterm 的 session 裡被啟動，外層的 `SPEKTERM_PEER_NAME` 會被繼承；
  內層只要有一條路沒帶自己的值，就拿到外層仍在執行的那個名字。既有的 `SPEKTERM_HANDOFF_*`、
  `SPEKTERM_EVENT_DIR` 有同樣的外洩，一併修正。
- **同一個 session 的前一個 pty 未結束時，不 spawn 新的**：TerminalService 在 spawn 之前等同一個
  sessionId 前一顆 pty 的 exit（有上限；逾時仍 spawn 並記錄）。renderer 重新載入時舊的 pty 是非同步
  被殺的，而新頁面會立刻喚醒 focused 的 session。實測 CLI 允許兩個同名行程並存（不改名），於是
  那段窗口裡名字是歧義的 —— 訊息可能送進即將被終止的那一個。
- **重新命名不碰它**：spekterm 的重新命名只改 renderer 的 `customTitle`（`sessions.tsx:461-470`）。
- **`terminal.test.ts:634-646`** 的正規化改為同時替換 `--name=` 的值；並加一條對照組確認「多一個
  旗標」仍然變紅。

### D6. 關係檔：主行程維護，以 pty 集合為範圍，單一觸發點

每個執行中的 claude session 有一份 `<userData>/handoff/relations/<sessionId>.json`：

```
{ "self":     { "name" },
  "parent":   { "name", "repo", "title", "running" } | { "closed": true, "repo"?, "title"? } | null,
  "children": [ { "name", "repo", "title", "running" } ],
  "siblings": [ { "name", "repo", "title", "running" } ] }
```

- **不含 spekterm 的識別碼與任何路徑欄位**。`repo` 是 folder 名稱（全域為 `global`，已關閉而歸屬
  未知時缺席）。
- **兄弟以 `lineage.parentId` 相同判定，不以母 session 是否存在判定**：母 session 關閉之後，它交接
  出來的 session 之間仍然互為兄弟。
- **範圍**：所有 TerminalService 目前持有 pty 的 claude session。**生命週期以 pty 為準**，不掛在
  `clearOutbox` 上（它只經 `kill()`）：pty 誕生（含喚醒與自癒）時寫、pty 結束（含自行結束與
  dispose）時刪。
- **單一觸發點** `refreshRelations()`：重算範圍內所有 session、只寫內容有變的檔。呼叫它的地方：
  `SessionStore` 的任何變動（含暫定紀錄、`replace()` 帶來的標籤改變）、pty 的誕生與結束、folder
  清單的變動、交接偏好的變動（關閉時刪除全部）。**pty 結束的掛點要在 `reason === 'disposed'` 提早
  return 之前** —— 否則重新載入不會刷新「是否在執行」。
- 原子寫入（tmp ＋ rename）；位置在 `outbox/` 之外；環境變數 `SPEKTERM_HANDOFF_RELATIONS`（它屬於
  交接的注入，交接關閉時不帶）。
- 被否決：**把關係寫進自我介紹、關係改變時重寫** —— 重寫進不了正在跑的 agent。**逐一列舉觸發點** ——
  第一版列了五個，而漏掉任何一個都是靜默的。

### D7. 「存在」：一個純函式，兩端各寫一層轉接

`src/shared/session-existence.ts`：輸入是正規化過的 `{ inList, exited, folderInWorkspace, provisional,
ptyAlive }`，輸出存不存在。規則：`inList ∧ ¬exited ∧ folderInWorkspace`，而暫定紀錄另需 `ptyAlive`。
主行程與 renderer 各把自己的資料轉成那個輸入 —— 規則只有一份，兩端不可能分歧。`src/shared/` 已在
`test:unit` 的 glob 內。

### D8. 自我介紹

- 新段落（仍不進字典、恆為英文）：自己的名字、關係檔的位置、「由交接開出的 session 有 parent，可能
  還有 siblings」、「聯絡對方用 Claude Code 的本機訊息功能，以名字定址」、「`running: false` 的對方
  收不到訊息，spekterm 不會替你喚醒它」、「**使用者還沒送出你的第一則 prompt 之前，不要傳訊息給剛
  交接出去的 session**」（見 Risks 的「已送出」判定）。
- `IntroInput` 納入 `name` 與關係檔路徑；**`refreshIntros()` 改由 store 取每個 session 的名字** ——
  否則 folder 清單一變動，自我介紹就被重寫成不含名字的版本，下次續接、壓縮、清除時 agent 就不知道
  自己叫什麼。

### D9. 呈現

- 分頁與 rail 子列各有兩個小標示（有才佔位）：來源（←）、子 session（→ N）。畫面上是圖示 ＋ 數字，
  完整文字在 `aria-label`／tooltip（字典）。**圖示字元要確認在系統等寬字型裡有**，必要時以 CSS／SVG
  繪製。
- 觸發子 session 標示**一律**以既有的 `ContextMenu` 列出（只有一個也列 —— spec 如此要求，且行為一致）。
  動 `ContextMenu` 要跑 `probe:terminal` 與 `probe:files` 回歸。
- 分頁上放兩個標示是否太擠，使用者要求「做了再看」—— 由 dogfood 決定是否改成只放在 rail 與右鍵選單。

## Risks / Trade-offs

- **[分頁不再顯示任務名稱]** 指定名字會固定 agent 的標題（實測）。使用者已知情接受，以手動重新命名
  代之。所有 claude session 都會如此，不只交接出來的。
- **[依賴 agent CLI 的行為]** `--name` 是訊息地址且可跨目錄送達、它會固定標題、同名行程並存。
  CLI 換版後任何一個改變，本能力都可能靜默失效（agent 送出的訊息找不到人，而它不會抱怨）。→ D0 的
  實測寫進 `docs/lessons/handoff.md`，列為換版時的重測項。
- **[peer 訊息會被誤判為「使用者已送出預填的 prompt」]** 「已送出」的判定是「agent 開始工作」，
  而 peer 訊息會讓收件的 agent 開始工作。母 session 若在使用者送出子 session 的預填 prompt 之前就
  傳訊息過去，那則交接會被了結、「待送出」的標示消失，而預填的文字仍在輸入處。→ 自我介紹要求 agent
  不這樣做（D8）；根本的修正（以 `UserPromptSubmit` 作為真正的送出事件）不在本 change 內，記進
  `docs/lessons/handoff.md`。
- **[與本應用程式之外的同名行程相撞]** 對方的 CLI 行為決定誰被改名。名字含短碼，機率低；不防禦。
- **[在 claude 裡用 `/rename` 會改掉名字]** 直到下一次 spawn 才被改回。記進 `docs/lessons/handoff.md`。
- **[關係檔中的標籤是 agent 可控的文字，被另一個 agent 讀進脈絡]** 經正規化、截斷，以 JSON 字串出現；
  agent 讀它是為了挑對象。風險與 agent 讀任何 repo 檔案同級。
- **[休眠的 session 收不到訊息]** → 關係檔以 `running` 標明；spec 明文不喚醒。
- **[被移出 workspace 的 folder 中仍在執行的母 session 被標為已關閉]** 它其實收得到訊息。spec 寫明
  這是刻意的（與畫面一致），issue #51 修掉之後可重新檢視。
- **[回滾]** 舊版的 `parseSessionEntry` 白名單丟掉 `lineage` 與 `peerName`，intake 的 `source` 被忽略 ——
  都是安全的損失。

## Migration Plan

- `sessions.json`：兩個新欄位皆為選填；既有 session 沒有來源（不回填），名字於載入時決定並寫回。
- intake store：新欄位選填，舊 record 沒有來源 —— 之前就在待處理中的交接被接受時不建立關係。
- 不需要遷移腳本。
