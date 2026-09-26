## Why

交接開出來的 session 不知道自己是誰交接出來的。同時有幾個交接在跑的時候，使用者分不清哪個
session 接的是哪件事，也回不去發起的那個 session；重開 spekterm 之後更難找。

而且關係斷掉的不只是人。**Claude Code 本身已經能讓本機的 session 互傳訊息**（以對方的名字
定址），但兩件事讓母子 session 用不上它：

- **名字每次啟動都會變。** 名字由 claude 依工作目錄自動產生（例如 `spekterm-3c`），行程重啟就
  換一個 —— 而 spekterm 重開、session 續接、自癒成新對話，每一次都是新的行程。子 session 記住的
  母 session 名字，下一次重開就失效了。
- **agent 不知道誰是它的母 session、誰是它的子 session。** 本機的 session 清單裡有幾十個名字，
  沒有任何一個告訴它「那個就是交接給你的人」。

**來源其實一直都知道，只是沒有留下來。** 一則交接落在哪一個 session 的投遞目錄，接收端就知道
它確切來自哪一個 session（`agent-handoff-source` 的來源身分由落點推導）。但這份資訊只被縮成
「來源 repo 的名稱」交給收件匣，新建的 session 本身沒有任何欄位記住它。

**跨重啟不是障礙。** spekterm 自己的 session 識別碼（`PersistedSession.id`）依既有設計**永不
改變**。把關係、以及傳訊息用的名字都掛在它上面，重開之後照樣成立。

## What Changes

### 一、記住關係

- **session 記住它的交接來源。** 由交接建立的 session 帶一筆「來源」：來源 session 的 spekterm
  識別碼，加上**交接當下**來源的呈現快照（所屬的 rail 項目、session 當時的標籤）。它隨 session
  一起落盤，跨重啟與 renderer 重新載入存活。
  - **來源由主行程在建立 session 的當下寫入**，推導自落點 —— SHALL NOT 取自投遞內容。renderer 只能
    出示一張由主行程簽發、用一次就失效的憑證，說「這個新 session 是為哪一則交接開的」；它無法替任何
    session（包括既有的 session）宣告或更改來源，也無法拿歷史上的交接重複產生子 session。
  - 涵蓋兩條建立路徑：到達即建立，以及超過上限後降級成待處理、再由使用者接受的那一條。
    同一則交接因重新處理而建出第二個 session 時，兩個都是它的子 session。

### 二、讓人看得到關係

- **同一個 repo 裡，rail 以樹狀呈現交接關係。** 接手的 session 縮排在來源之下；連續交接
  （A → B → C）逐層往下，縮排深度有上限。
- **兩端各有一個可點的標示**，不分同 repo、跨 repo 或來源是全域 session：子 session 標示
  「來自 〈repo〉 › 〈來源標題〉」，點下去聚焦母 session；母 session 標示「已交接 N 個」，
  展開後可逐一跳到子 session。
- **母 session 已不存在**（已關閉、已結束、或所屬的 repo 已被移出 workspace）：子 session 在 rail
  上回到頂層，標示改用快照並註明「已關閉」，不可點擊。**SHALL NOT 重建母 session**。
- **樹狀只改變 rail 的呈現，不改變分頁列。** 分頁列維持扁平，兩者仍由同一個順序導出：同 repo 的
  子 session 建立時放在母 session 的子孫之後；rail 上拖曳只在同一層的兄弟之間移動、子孫跟著走；
  **拖曳永遠不改變母子關係**。

### 三、讓母子 agent 找得到彼此

- **每個 claude session 有一個固定的名字**，由 spekterm 在建立 session 時決定、啟動 claude 時指定：
  `<rail 項目名稱>-<短碼>`（例如 `spekterm-c463`），短碼取自 spekterm 的 session 識別碼；名字只含
  各種文字的字母與數字、`_`、`-`（空白、引號等換成 `-`；`簡報` 會是 `簡報-c463`）。重開、續接、自癒成新對話都沿用同一個
  名字，於是它在 Claude Code 的訊息機制裡是一個**穩定的地址**。**一律啟用，不設開關，也不受交接
  開關影響。**
  - **代價（已實測）：指定了名字的 claude 會把終端標題固定為那個名字**，不再依任務改寫
    （`✳ Git rebase 說明` 變成 `✳ spekterm-c463`）。分頁上想看到任務名稱，就用 spekterm 既有的
    重新命名 —— **那只改 spekterm 的標籤，不會改到這個名字**。
  - 在 claude 裡面用它自己的重新命名會改掉名字，直到該 session 下一次被啟動時 spekterm 再指定回來。
- **agent 被告知自己的名字，並且隨時查得到母、子、兄弟 session 當下的名字與狀態**（這部分跟著既有的
  交接開關走 —— 關係只會由交接產生）。 啟動時的
  自我介紹告訴它自己的名字與一份**即時更新的關係檔**的位置；關係檔列出母 session、仍存在的子
  session，以及**兄弟**（同一個母 session 交接出來的其他 session）的名字、repo、標籤、是否在執行。
  兄弟讓「母 session 把工作拆給 server 與 web 兩個 repo」這類情境可以直接協調，不必繞回母 session。子 session 是在母 session 啟動**之後**才長出來的，所以這一塊不能只寫在
  自我介紹裡。
- **訊息本身由 Claude Code 傳送，spekterm 不經手。** spekterm 交付的是「地址穩定」與「知道誰是誰」。

**不在本 change 內：**

- **spekterm 自己的訊息通道**（投遞、待收、填入）—— Claude Code 已經有了。
- **喚醒休眠的 session 來收訊息。** spekterm 重開之後，session 在第一次被顯示之前沒有行程，
  送給它的訊息收不到；關係檔會標明它不在執行中。
- **既有 session 的回填**（關係）—— 只處理之後新建的交接。既有的 claude session 會在它下一次被
  啟動時帶上固定名字。
- **shell 目標的 session** —— 它們沒有 agent，不需要名字。
- **母、子、兄弟以外的關係**（祖孫、叔姪、整棵樹）—— 名字是穩定的，agent 可以自行查清單或經由
  中間那一層轉達，但關係檔只列這三種。

## Capabilities

### New Capabilities

- `session-lineage`：session 的交接關係。涵蓋：來源由誰、在何時寫入、記住哪些東西、「存在」的
  定義、母 session 存在與不存在時的呈現、兩端的跳轉標示、以及給 agent 讀的即時關係檔。
- `agent-peer-name`：claude session 的固定名字。涵蓋：名字的組成與唯一性、跨重啟／續接／自癒
  不變、不受使用者在 spekterm 中重新命名影響、安全地交給 agent CLI、以及對終端標題的影響。

### Modified Capabilities

- `agent-handoff-source`：自我介紹多出「你的名字、你的關係檔在哪、怎麼用 Claude Code 的訊息
  功能聯絡母、子、兄弟 session」；交接進來時把來源的識別碼與快照一併記下。
- `session-persistence`：持久化的 session 多兩個由主行程寫入、renderer 不能改的欄位（來源、固定名字），
  兩者讀回時都要驗證。
- `agent-intake`：由 intake 建立 session 的路徑多接受一張單次憑證；「啟動參數與手動建立者等價」的
  例外多一項「固定名字的值」；「系統不得代使用者指定 session 名稱」寫明它與固定名字的分別。
- `terminal-sessions`：建立 session 的介面多一個選填的單次憑證，且重建既有 session 時忽略它。
- `workspace-layout`：rail 的 session 子列呈現巢狀結構與標示；「session 的順序由使用者拖曳調整，
  且兩個視圖共用同一順序」這條要寫明它與樹狀之間的關係。

## Impact

- **主行程**：
  - `handoff-service.ts`：攝入時記下來源 session 的識別碼與快照。
  - `terminal.ts` 與 `ipc/terminal.ts`：啟動 claude 時帶上名字、同一個 session 的前一個 pty 結束之後
    才啟動新的；pty 環境剝除外層的 spekterm 專屬變數；建立 session 時收單次憑證並寫入關係。
  - `session-store.ts`：新的主行程專屬欄位與它的驗證。
  - `handoff-intro.ts` / `handoff-outbox.ts`：自我介紹的新段落、關係檔與它的生命週期。
  - `ipc/intake.ts` / `intake-accept.ts`：自動接受的推送與接受的結果帶上單次憑證。
- **preload**：建立 session 的參數、restore 與自動接受的酬載。
- **renderer**：session 的 state、rail 的樹狀與拖曳、分頁與 rail 上的標示、跳轉。
- **字典**：`en.json` / `zh-TW.json` 新增標示文案（含複數）。給 agent 看的自我介紹不進字典。
- **驗收**：`probe:intake` 的交接段落新增關係與名字的斷言；替身 agent 要回報它收到的名字；
  `terminal.test.ts` 的「啟動參數等價」測試改寫正規化；
  `scripts/scenario-coverage.test.mjs` 登記本 change；`docs/lessons/` 記下 `--name` 的實測。
- **不需要任何新依賴。**
