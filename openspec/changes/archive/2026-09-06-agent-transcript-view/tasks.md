## 0. 前置實測 —— 結果決定後續走哪一條路，因此排在最前

- [x] 0.1 ~~實測 `--settings` 對 `hooks` 是覆寫還是與使用者的合併~~ **已完成（2026-09-06、CLI 2.1.261、
      Linux）：是「合併」。** 隔離 `CLAUDE_CONFIG_DIR`，使用者設定與注入設定都定義 `SessionStart`
      各寫一個標記檔 —— 兩個都出現。**⇒ D6 走「注入」那一支；1.3 的前提隨之作廢（見下）。**
      原始描述：**實測 `--settings` 對 `hooks` 是覆寫還是與使用者的合併。** `agent-status.ts` 實測到的
      「疊加」是**設定 key 層級**的（我們只寫 `statusLine`，其餘不受影響），**不蘊含** `hooks`
      陣列會與使用者的合併。做法：在使用者 `~/.claude/settings.json` 有 hooks 的情況下注入我們的，
      看兩者是否都被呼叫。**結果決定 design D6 走哪一條**（可合成 ⇒ 注入；不可 ⇒ view 唯讀）
- [x] 0.2 ~~實測多行文字送進 pty 的形式~~ **已完成（以讀回 transcript 驗「agent 實際收到什麼」）：
      `\n`(0x0A) 是訊息內換行、`\r`(0x0D) 才是送出；送「多行本文 + `\r`」得到恰好一則訊息、
      換行完整保留；bracketed paste 包與不包結果相同，不需要。**
      **另測出控制位元組的失效方向**：本文含 `\x01`/`\x07`/`\t` 時 **transcript 檔案根本沒被建立**
      —— 訊息從未送達，畫面上也沒有錯誤 ⇒ 送出前必須過濾（除 `\n` 外的控制位元組不得原樣寫入）
- [x] 0.3 **實測 hooks payload 的實際欄位**（`PermissionRequest` / `PreToolUse` / `PostToolUse` /
      `Notification` / `Stop` / `SessionEnd`），把依賴的欄位**列成一份完整清單並註明實測日期與
      CLI 版本** —— 比照 `report-runner.ts` 既有的做法。**不從文件推論**。
      **已實測（2.1.263）**：基底 ＝ `session_id` / `transcript_path` / `cwd` / `scratchpad_dir` /
      `permission_mode` / `prompt_id` / `hook_event_name` / `effort`；
      `PermissionRequest` 另有 `tool_name` / `tool_input` / `permission_suggestions`
      （**沒有** `tool_use_id`，`PreToolUse` 才有 —— 兩者不可互相假設）；
      `Notification` 另有 `message` / `notification_type`。
      `Notification` 的 `notification_type` 只有 `idle_prompt` 與 `permission_prompt` 兩種；
      permission 通知**延遲 6 秒**且可被 `CLAUDE_CODE_DISABLE_PERMISSION_PROMPT_NOTIFY_HOOKS` 關掉
- [x] 0.5 ~~實測 `PermissionRequest` 的觸發時機~~ **已完成（2026-09-06、CLI 2.1.263）：
      `PreToolUse` 8557ms → `PermissionRequest` 8600ms → 對話框上畫面 8622ms →
      `Notification`(permission_prompt) 14624ms。⇒ `PermissionRequest` 早於畫面 22ms，
      `Notification` 晚於畫面 6002ms。及時性要求做得到，且非用 `PermissionRequest` 不可。**
      **`ExitPlanMode` 已於 0.7 確認同樣觸發。**
- [x] 0.6 ~~實測 `/clear` 之後第一個 hook 事件的 `transcript_path`~~ **已完成：`/clear` 發出
      `SessionEnd`（舊路徑）＋ 59ms 後 `SessionStart`（新路徑），早於任何新內容。**
      **順帶查出一個原本會踩的坑：`SessionEnd` 在 `/clear` 時就發，而 pty 還活著** ——
      照字面拿它拆除跟進器，使用者按 `/clear` 就永遠不再更新（見 design D2b，兩份 spec 已加條款）
- [x] 0.7 ~~實測 `ExitPlanMode` 是否觸發 `PermissionRequest`~~ **已完成：會。**
      `PreToolUse tool=ExitPlanMode` 18158ms → `PermissionRequest tool=ExitPlanMode` 18187ms →
      `Notification` 24213ms。**`PermissionRequest` 與工具無關**，一個 hook 同時涵蓋工具核准與
      計畫核准 ⇒ **不需要維護一張工具清單**（那種清單會在 agent 新增需核准的工具時靜默漏掉）
- [x] 0.8 ~~實測不同 `--permission-mode` 下 `PermissionRequest` 的觸發~~ **已完成：
      `default` ⇒ 提示出現且觸發；`acceptEdits` / `auto` ⇒ 兩者皆無。
      不變式：`PermissionRequest` 觸發 ⟺ 提示會出現。**
      **⚠ 帶出一條覆蓋風險**（已寫入 design D7b）：使用者的 `defaultMode` 是 `auto`，
      **日常使用幾乎不會出現許可提示** ⇒ 本 change 最承重的那條路在 dogfood 中最少被走到。
      驗收必須由探針以替身主動觸發，且 **dogfood 清單要明確要求切到 `default` 模式走一次**
- [x] 0.4 ~~實測紀錄的寫入時機與粒度~~ **不再是前置**：3.4 的三種處置（檔案變短、最後一行未終止、
      檔案不存在）**與觀察到的頻率無關** —— 它們防的是無法排除的競態，實測「這次沒看到」不會
      讓任何一條可以省略。原本把它列為前置是誤判：它的答案不改變任何決定。
      *（順帶：撰寫期間讀到的紀錄從未出現半行，但那正是「不能據此省略」的那種證據。）*

## 1. 主行程：注入合成器（`agent-status.ts` 一般化）

- [x] 1.1 把 `prepareInjection()` 寫死的 `{ statusLine: ... }` 抽為**單一合成器**：各功能各自貢獻
      自己的設定片段，合成器產出一份設定並回傳單一個 `--settings` 片段與合併後的環境變數
- [x] 1.2 各功能的啟用狀態**彼此獨立**：其中一個回傳「不參與」時，另一個仍照常注入
      （`claude-status-bridge` 新增條款）
- [x] 1.3 ~~`readUserStatusLine()` 推廣為每個功能各自的並存判定~~ **前提已被 0.1 推翻** ——
      hooks 的合併由 CLI 自己做，**不需要讀出使用者的設定**。改為：確認 hooks 這一支
      **不呼叫** `readUserStatusLine()`，且 statusLine 那一支的既有判定不變
- [x] 1.4 **grep 所有 `--settings` 的產生點**，確認只剩合成器一處 —— 兩處各自寫入時，後寫的會
      蓋掉先寫的，而**兩個功能都會回報自己已啟用**

## 2. 主行程：事件橋接

- [x] 2.1 新增 `agent-events.ts`：注入片段的建構（hooks 命令、落點環境變數）、事件的讀取與解析
- [x] 2.2 注入的 hook 命令：**原子寫入**（先寫暫存再更名）、落點由環境變數決定、
      **串接使用者原有的同類設定**（依 0.1 的結果決定是否可行）
- [x] 2.3 事件落點**不得以覆寫承載** —— 事件是發生過的事，覆寫會丟事件。以逐筆檔案或追加式承載
- [x] 2.4 讀取端：去重、排序、對損毀的單筆忽略而不中斷其餘
- [x] 2.5 等待狀態機（就緒／忙碌／等待選擇／未知），**未知為初始值**。
      **「未知」實作為 `else`（其餘一切），不是一份列舉** —— 列舉式的判定會在 agent 新增一種
      等待方式時靜默落進別的分支
- [x] 2.7 **`Notification` 必須依 `notification_type` 分派** —— `permission_prompt` 與
      `idle_prompt` 都走這個 hook。不分派 ⇒ permission 提示被讀成「就緒」
- [x] 2.8 **等待選擇的權威訊號取自 `PermissionRequest`（同步、提示出現之前），不倚賴
      `Notification`** —— 後者延遲 6 秒，那 6 秒內狀態是上一個值＝忙碌，而忙碌允許送出。
      **這是本 change 最承重的一行**
- [x] 2.9 **`PermissionRequest` 不設工具匹配**（0.7 證實它與工具無關，`tool_name` 在 payload 裡）。
      `PreToolUse` 若用於取問題內容，其匹配才需要涵蓋計畫核准
- [x] 2.10 **離開等待選擇的訊號取自 `PostToolUse`** —— 進入與離開不是同一個事件。
      缺了它狀態會停在等待選擇，其後每則自由文字都送不出去（症狀是「送出入口壞了」）
- [x] 2.11 事件內容送往 renderer 之前**剝除絕對路徑**（`transcript_path` / `cwd` /
      `tool_input` 裡的路徑）。**這與 3.6 是兩條獨立的義務，不是同一條**
- [x] 2.6 session 建立時清除落點殘留；**清除只由 session 自身結束（pty 結束）觸發** ——
      **`SessionEnd` hook 不是那個訊號**（實測 `/clear` 就會發它而 pty 還活著）。
      它的正確語意是「接下來可能換一份紀錄」⇒ 觸發重新定位
- [x] 2.12 剝除以**白名單**實作（只送出明確需要的欄位），**不以黑名單** ——
      基底就有四個絕對路徑欄位（`transcript_path` / `cwd` / `scratchpad_dir` 及工具參數），
      黑名單會在 agent 新增一個帶路徑的欄位時靜默失效

## 3. 主行程：紀錄跟進

- [x] 3.1 新增 `transcript-follow.ts`：以 session 的**起始 cwd 與對話識別碼**算出來源路徑
      （`encodeProjectDir` 已存在於 `transcript-project.ts`），根目錄沿用既有的
      `CLAUDE_CONFIG_DIR` 處理
- [x] 3.2 監看**一律經 `src/main/watcher.ts`**（既有紀律，eslint 與 `watcher-source.test.mjs` 守著）。
      一對一，`pollingRoot` 省略
- [x] 3.3 兩層監看：來源檔尚不存在時先監看其所在目錄（`depth: 0`）等它出現，比照 `branch-service`
      對 `.git/HEAD` 的處置
- [x] 3.4 增量以**位元組偏移**讀取，並處理三種非追加的情況：檔案比 offset 短 ⇒ 自頭重讀；
      最後一行未終止 ⇒ 保留不 parse；檔案不存在 ⇒ 不是錯誤
- [x] 3.5 投影：訊息本體、工具名稱與辨識參數、結果摘要。**記錄類型為白名單**，未知類型忽略
      且不報錯（沿用 `conversation-archive` 的紀律，但**投影與 `transcript-extract.ts` 不同**
      —— 那支是計量用的）
- [x] 3.6 送往 renderer 的事件**不含絕對路徑**，包含來源自身記載的 `cwd`。檔案指涉翻成
      folder-relative，翻不出來就是不可導覽的純文字（比照 `SpecInfo.path` 的處置）
- [x] 3.7 初次附掛的量體上限，超過時附帶「較早未載入」的旗標
- [x] 3.8 **定位分兩層：算出來的路徑為初始值與後備；事件所帶的 `transcript_path` 一旦到達即為
      權威。** 除了 `SessionHealed`，**`/clear`、`/resume`、`--fork-session` 都會換掉識別碼，
      而它們發生在 pty 之內、pty 沒死、系統收不到任何自己發出的訊號** —— 只綁 `SessionHealed`
      會讓跟進停在一份不再成長的檔上，**且不算失敗**（落入「等它出現」），畫面安靜停住
- [x] 3.9 生命週期：**拆除只由 session 自身結束觸發**。`SessionEnd` hook ⇒ 重新定位，不是拆除。
      **grep 所有接上 `SessionEnd` 的地方** —— 這個名字讀起來就是「結束」，而它不是。
      *（`TranscriptFollower` 已提供 `relocate()` / `dispose()` 兩個方法；**選哪一個是接線層的事**，
      因此本條要等第 2 節完成才做得完。單元測試的限度已寫在
      `transcript-follow-service.test.ts` 的註解裡。）*

## 4. 主行程：單元測試與對照組

- [x] 4.1 `transcript-follow.test.ts`：來源路徑的推導（含 `CLAUDE_CONFIG_DIR`）
- [x] 4.2 只送新增的內容（append 之後只得到新的那一則）
- [x] 4.3 來源縮短 ⇒ 自頭重讀；最後一行未終止 ⇒ 不送出，補完後只送一次
- [x] 4.4 來源不存在 ⇒ 回「尚無內容」而非錯誤
- [x] 4.5 未知記錄類型被忽略且不報錯
- [x] 4.6 **事件不含絕對路徑** —— 以「來源含絕對路徑的 `cwd`」為輸入，斷言輸出不含之。
      **對照組**：拿掉剝除的那一行，此測試必須變紅
- [x] 4.7 對話識別碼改變 ⇒ 來源路徑隨之改變 *（`relocate()` 已測；由事件驅動的那一半待第 2 節）*
- [x] 4.8 量體上限與「較早未載入」旗標
- [x] 4.9 停止跟進後不再送出事件
- [x] 4.10 `agent-events.test.ts`：注入片段的建構（啟用／未啟用）
- [x] 4.11 未啟用時**不產生任何注入片段、不建立落點**
- [x] 4.12 使用者已有同類設定：可並存 ⇒ 注入且原設定保留；不可並存 ⇒ **完全不注入**
- [x] 4.13 事件不遺失：連續多筆全部讀到、各只處理一次；其中一筆損毀不影響其餘
- [x] 4.14 等待狀態：未注入 ⇒ 未知；不認得的事件形狀 ⇒ 未知（**不是就緒**）。
      **對照組**：把預設值改成就緒，此測試必須變紅
- [x] 4.15 落點的清除：session 結束後不存在；新 session 不繼承殘留
- [x] 4.21 **`SessionEnd` 事件不拆除跟進與落點** —— 餵入「`SessionEnd` → `SessionStart`(新路徑)
      → 新內容」的序列，斷言新內容仍被送出。**對照組**：把 `SessionEnd` 接上拆除，此測試必須變紅。
      *已完成，但**載體的形狀與原本設想不同，限度寫在這裡**：接線層（`ipc/conversation.ts`）
      import 了 electron，單元測試載入不起來。實際的載體是 `agent-events.test.ts` 的
      「對話結束後接著開始的新對話，其位置被回報且狀態為就緒」—— 它斷言 `SessionEnd` 之後
      **落點仍在**且新位置被回報出來。**它擋得住「把 `SessionEnd` 翻成拆除訊號」的解讀，
      擋不住呼叫端自己在收到該事件時去呼叫 `dispose()`**。後者由 code review 承擔。*
- [x] 4.16 轉場時長為**常數** —— 斷言 CSS 動畫時長為一個字面常數（DOM 上量得到）。
      **不可只用「函式簽名不吃長度」當判準** —— 一個內部自己讀 `text.length` 的實作簽名乾淨、
      測試全綠。若最終仍採結構判準，**必須照 `xterm-blink-release.test.mjs` 的先例寫明限度**
      （「它擋得住 X，擋不住行為本身」）
- [x] 4.17 送出的編碼（0.2 已定）：訊息內換行送 `\n`、送出送 `\r`；
      **除 `\n` 外的控制位元組一律過濾，不得原樣寫入 pty**。
      **對照組**：拿掉過濾，斷言編碼後的位元組仍含該控制字元 —— 此測試必須變紅
- [x] 4.19 事件內容的路徑剝除 —— 以「payload 含 `transcript_path` / `cwd` /
      `tool_input.file_path`」為輸入，斷言輸出不含之。**對照組**：拿掉剝除，此測試必須變紅
- [x] 4.20 **許可提示出現中不得歸為忙碌或就緒** —— 餵入「工具執行中 → `PermissionRequest`」
      的事件序列，斷言狀態為等待選擇。**對照組**：把 `PermissionRequest` 的處理拿掉（退回只看
      `Notification`），此測試必須變紅
- [x] 4.7b 事件帶來的新 `transcript_path` 覆蓋算出來的路徑
- [x] 4.18 合成器：兩者皆啟用 ⇒ 一份設定含兩者；關閉其一 ⇒ 另一者仍在；其一不參與 ⇒ 另一者仍在。
      **對照組**：改回「各自寫入」，此測試必須變紅

## 5. IPC 與 preload

- [x] 5.1 新增內容事件的訂閱通道（per session，推送式）
- [x] 5.2 新增等待狀態的查詢／訂閱通道
- [x] 5.3 新增送出輸入的通道，**主行程持有送出的閘**（renderer 的判定只是 UI 提示，
      不得是唯一的把關者）
- [x] 5.4 preload 白名單新增上述三者；`probe:shell` 的白名單斷言同步更新

## 6. renderer：view 切換與版面

- [x] 6.1 session 新增「當前 view」狀態（`'terminal' | 'conversation'`），**預設 terminal**
- [x] 6.2 落盤：`SessionStore.replace()` 的**逐欄位白名單**加一欄
- [x] 6.3 **當前 session 的終端保有版面盒子**（隱藏而非移除）—— design D9。
      **對話 view 是終端 host 的兄弟節點，不是後代** —— `TerminalView.tsx` 的既有註解記載了兩個
      會咬人的理由：(a) `.xterm` 由 `handle.open(host)` 在 effect 裡 append，排在 React children
      **之後** ⇒ 依 tree order 繪製 ⇒ **xterm 會蓋在對話 view 上**（症狀：切過去一片空白）；
      (b) `host` 上有 capture 階段的 `mousedown`/`mouseup`/`auxclick`/`contextmenu` 接管 ⇒
      在它之下右鍵會開終端的選單、中鍵會把剪貼簿貼進 pty
- [x] 6.8 **`TerminalView.tsx:313` 的 `handleRef.current?.focus()` 必須加上 view 判定。**
      D9 要求 `active` 在對話 view 在上層時仍為 true ⇒ 這個 effect 每次跑都會讓**隱形的終端
      搶走焦點**，使用者接著打字進 pty、畫面上什麼都沒有。
      **6.5 的 grep 措辭掃不到它 —— 那是一個焦點判斷，不是掛載或可見判斷**
- [x] 6.4 終端不可見時仍依既有條款**釋放渲染資源** —— 「有版面盒子」與「看得見」是兩個判準，
      此處兩者相反
- [x] 6.5 **grep 所有以「終端是否掛載／是否可見」為條件的判斷** —— 現在「掛載」「有版面盒子」
      「看得見」是三個不同的謂詞，而它們此前恆等。**這不會有任何型別錯誤**
- [x] 6.6 切換入口：shell 目標的 session 不呈現它
- [x] 6.7 切換入口可完全以鍵盤操作（既有 `ContextMenu` 紀律；若不是選單則需 `focus:` 樣式）

## 7. renderer：對話呈現

- [x] 7.1 對話 view 元件：訊息、工具呼叫、結果的呈現
- [x] 7.2 三種不完整狀態各自明示：跟進中、較早未載入、內容無法取得（後者附「可切換到終端 view」）
- [x] 7.3 休眠狀態於對話 view 明確呈現，**不是一份空的對話**
- [x] 7.4 忙碌指示取自等待狀態，**不自行推測**
- [x] 7.5 訊息整則出現；轉場動畫時長為常數。**SHALL NOT 模擬逐字**（design D15）
- [x] 7.6 markdown 渲染沿用既有 `react-markdown` 的預設值 —— **不得加 `rehype-raw`、
      不得覆寫 `urlTransform`**（agent 輸出是不受信任的內容，與檔案樹渲染 `.md` 同一條理由）
- [x] 7.7 對話中的連結一律經 `shell.openExternal`（與 xterm 的 web-links 同一條）

## 8. renderer：輸入

- [x] 8.1 輸入元件：多行、送出
- [x] 8.2 依等待狀態決定送出入口的可用性；**未知時停用並說明原因＋指向終端 view**
- [x] 8.3 ~~等待選擇時只呈現選項~~ **規格已修正（實作前實測推翻）**：許可請求的 payload
      **不含它呈現給使用者的選項**（它帶的是「要不要改變權限規則」的建議）。在此作答只能靠猜
      終端畫面上的編號 —— 而那正是本 change 明文禁止的依賴，且猜錯的後果是**替使用者做出一個
      他從未同意的決定**。改為：呈現「正在被問什麼」＋指向終端 view，**不提供作答入口**
- [x] 8.4 送出後標示為「未確認」，直到它出現在紀錄中；逾時未出現時明示
- [x] 8.5 確認輸入元件不在 `.xterm` 之內 ⇒ 既有「排序快捷鍵於可編輯文字持有焦點時不生效」
      的兩段式判準自動涵蓋它。**兩個相反的失效方向都要驗**（8.6）

## 9. i18n 與文案

- [x] 9.1 新 view 的每一個使用者可見字串進 `src/shared/i18n/en.json`
- [x] 9.2 主行程經 IPC 送達畫面的錯誤訊息同樣進字典（第 3 類文案，最容易漏）
- [x] 9.3 `aria-label` 一律自字典取得；**避開單引號、雙引號、反引號**（probe 的選擇器是字串拼的）
- [x] 9.4 新增的 `role="tablist"` 等角色與既有的會撞 —— 選取時一律連 `aria-label` 一起指名

## 10. 探針

- [x] 10.1 新增 `probe-agent-view.mjs`，於 `scripts/lib/ports.mjs` **登記 debugging port**
      （`npm test` 擋重複與衍生）；納入 `run-probes.mjs` 的序列、`scripts/run-probe.mjs` 的
      入口對照、以及 `package.json` 的 `probe:agent-view`
- [x] 10.2 **替身 agent**：一支假的 agent，讀 `--settings`、依約定觸發 hook 命令、
      並寫出符合格式的紀錄。**`probe-terminal.mjs` 已有一支會照著注入的 `--settings` 真的跑一次
      statusLine 的 stub claude（`:197`、`:3657`）—— 直接長在它上面，不要另起爐灶。****真實 `claude` 的委派刻意不進探針**（要網路、會花錢、不可重現）
      —— 「真的 claude 會呼叫我們注入的東西」由 dogfood 認定，這條缺口寫進規格
- [x] 10.3 fixture 第一段先以已知數值釘住「跟的是 fixture 而非開發者本機的真實紀錄」——
      少了它，`CLAUDE_CONFIG_DIR` 沒傳進去時每一條存在性斷言照樣全綠（`probe:insights` 的教訓）
- [x] 10.4 兩個並行 session 各自跟進自己的紀錄（**至少兩個**，且內容可區分）
- [x] 10.5 ~~自癒換 id 後跟進新來源~~ **由 10.5b 涵蓋，理由：兩者的機制是同一條。**
      自癒與「使用者於 agent 之內換掉對話」都以**事件回報的 `transcript_path`** 為權威來源
      （design D2 的兩層定位），而 10.5b 驗的正是那條路徑。自癒**額外**有一個
      `SessionHealed` 訊號，但它只是讓重新定位早一點發生，不是另一條機制。
      *限度：若日後把自癒改成不經事件回報的獨立路徑，本條就需要自己的載體。*
- [x] 10.6 長對話只載入最近一段並明示
- [x] 10.7 來源不可讀 ⇒ pty 照常、終端 view 照常、對話 view 說明原因
- [x] 10.8 事件橋接：替身觸發後等待狀態改變
- [x] 10.9 預設為終端 view；切到對話再切回，終端內容仍在
- [x] 10.10 shell session 無切換入口；切到對話後 pty 仍在執行且分頁仍為單一項
- [x] 10.11 **重建後直接進對話 view 的 session，其 pty 欄數與可用寬度相符（不是 80）。**
      **必須有對照組** —— 把 6.3 的版面盒子拿掉，此斷言必須變紅。**不修也不會紅**：
      agent 照樣回話，症狀要到切去終端 view 看歷史時才顯現
- [x] 10.12 對話 view 在上層時終端**歸還了並存額度** —— **以資源自身的失效狀態為觀察對象**
      （`terminal-sessions` 既有的「額度歸還的驗收以資源自身的失效狀態為觀察對象」已定義做法）。
      **不可用「取得資源時新增了哪些節點」當判準** —— 同一條 requirement 明文寫著那個判準
      「SHALL NOT 被當作額度是否歸還的證據……在額度未歸還時依然全綠」
- [x] 10.26 **反覆切換 view 多次，斷言歸還數與取得數相符**，且一個持續顯示中的終端未失去資源。
      **含對照組**：把釋放拿掉，此斷言必須變紅。
      **注意掩蓋機制** —— 切換必然把焦點交給輸入框，而失焦會讓底層套件自己停掉週期性工作；
      既有 spec 記載這在點擊分頁時可用鍵盤繞開，**在這裡繞不開**（焦點轉移就是切換本身）
- [x] 10.25 **許可提示出現時送不出自由文字**（替身於工具執行中觸發 `PermissionRequest`）。
      **含對照組**：退回只看 `Notification` 的實作，此斷言必須變紅
- [x] 10.27 補既有的部分覆蓋（11.3 查出）—— **兩條裡補得了一條，另一條在結構上補不了**：
      - **已補**：再次重啟後**只有被顯示的那一個醒來**（`probe-terminal` 的 `runRestore`）。
        原本只比對分頁標籤，那只證明「沒有消失」—— 一個「重建時全部喚醒」的實作照樣全綠，
        而緊接其後那條 `pids.length === 2` 的等待會**立刻收斂**，於是連它也一起假綠。
      - **補不了**：`sessions.dormantShell` / `dormantClaude` 的提示文字。休眠的 session
        **只在被顯示時才可見，而被顯示的那一刻它就醒了** —— 那段可見窗口是喚醒的過渡。
        唯一穩定可見的休眠是**喚醒失敗**（`wakeError`），而那條已有載體。
        **記為既有缺口**，處置需要產品自己提供一個穩定的休眠態，不是測試的事。
- [x] 10.5b 替身送出帶新 `transcript_path` 的事件後，跟進改換來源
- [x] 10.13 ~~尚未跟上時呈現「跟進中」~~ **記為無載體，理由如下**：`attaching` 是呈現層自己的
      初始值，而主行程在收到 watch 的當下就會送出第一份更新（紀錄不存在時送 `ok` ＋ 零內容）
      —— 那個窗口是一次 IPC 往返，**造得出來的唯一方法是刻意延遲主行程**，也就是為了測試而改
      產品。**已寫入 11.5 的缺口清單。**
      *（順帶：這個狀態本身是那個死鎖 bug 的殘留 —— 它現在只在「主行程還沒回話」時出現，
      而那正是它該出現的唯一時機。）*
- [x] 10.14 休眠 session 於對話 view 呈現休眠，**不是空的對話**
- [x] 10.15 忙碌時呈現忙碌、閒置後消失
- [x] 10.16 訊息整則出現（斷言其完整內容在單一次觀察中即完整）
- [x] 10.17 兩個 session 各自的 view 互不影響
- [x] 10.18 重啟後回到上次的 view
- [x] 10.19 就緒與忙碌時皆送得出去
- [x] 10.20 未知時拒絕並說明；未注入時 view 仍可讀而送出入口停用
- [x] 10.21 等待選擇時自由文字送不出去、選項送得出去
- [x] 10.22 送出後先為未確認，出現於紀錄後標示消失；逾時未出現時明示
- [x] 10.23 含控制字元的輸入不中斷 session
- [x] 10.24 `probe:terminal` 與 `probe:keyboard` 回歸（切換入口若為選單則動到共用 `ContextMenu`）

## 11. scenario → 驗收載體對照表

- [x] 11.1 逐條核對下表，確認**每一條 scenario 都有一個指名的載體，且該載體對錯誤的實作會變紅**。
      本 repo 已**五次**因「補了 scenario 卻沒做載體」而封存帶缺口的 change（issue #12），
      而 `openspec validate --strict` 對此完全無感
- [x] 11.2 下表的 scenario 名稱與 delta spec **逐字相符**。改完 spec 後跑一次核對：
      `grep -o '^#### Scenario: .*' openspec/changes/agent-transcript-view/specs/*/spec.md`
      的每一條都應出現在下表中
- [x] 11.3 ~~逐條複驗標為「既有？」的 16 條~~ **已完成。11 條有真載體、5 條無 probe 載體。**
      那 5 條全是「週期性工作（游標閃爍計時器）不殘留」那一族 —— `probe-terminal` 對它們
      **一條斷言都沒有**（全檔 `blink` 出現 0 次），唯一的東西是
      `xterm-blink-release.test.mjs` 的**原始碼代理判準**，而該 spec 自己已寫明它「擋得住依賴
      被退回，擋不住行為本身」。
      **這是既有缺口，不是本 change 造成的**（本 change 對該 requirement 只加了一條新轉換的
      條文與兩條新 scenario，兩條都有載體 10.12／10.26）。已如實填入表中，不寫「既有」。
      > 原文：**逐條複驗標為「既有？」的 16 條**（全部來自 `terminal-sessions` delta 中未改動的
      既有 scenario）。`session-persistence` 與 `workspace-layout` 的 12 條**已複驗完畢**，
      結果已填入表中：**8 條有載體、4 條部分覆蓋**（1/3 —— 比 `rail-pinned-repos` 那次的 1/10
      還高）。其中 2 條由 10.27 補上，2 條記為**既有缺口且不在本 change 修**（右鍵選單的 Close、
      空狀態文字），另有 3 條的既有載體帶著註記（歸屬與直覺相反、未驗「恰有一個 selected」、
      THEN 已改需新載體）。
      > 前一版這裡寫「13 條」而表上只有 12 列 —— **一張防「憑印象填表」的表，它自己的筆數是憑
      > 印象寫的。** —— 去把那條斷言實際找出來，找不到就補載體或
      據實記為「無載體」＋理由。**不得憑印象填「既有」**：`rail-pinned-repos` 這樣填了 39 條，
      事後逐條核對發現**其中 4 條是假的**
- [x] 11.4 **「有載體」與「載體有鑑別力」是兩件事** —— 對 4.6 / 4.14 / 4.18 / 4.19 / 4.20 /
      10.11 / 10.25 / 10.26 八條標了對照組的，實際把修正退回一次，確認真的變紅
- [x] 11.5 **已知的覆蓋缺口共五條**（不是一條），全部寫進規格或設計，不得只留在這裡：
      (a) 真實 agent 會呼叫我們注入的 hooks；
      (b)(c) ~~多行與控制字元 agent 實際收到什麼~~ **已由 0.2 以讀回 transcript 的方式測定**，
      缺口自「不知道」縮小為「**已知的編碼規則可能隨版本改變**」；
      (d) 「無法確保並存時不注入」在 2.1.263 下不可達，載體只能是人造分支；
      (e) 轉場時長的判準若採結構斷言則為代理判準；
      **(f) `awaiting-choice` 在使用者的 `auto` 模式下日常不會被走到**（design D7b）；
      **(g) 「跟進中」的呈現**：那個狀態只在「主行程還沒回話」的一次 IPC 往返內存在，
      造得出來的唯一方法是刻意延遲主行程 —— 也就是為了測試而改產品（見 10.13）；
      **(h) 休眠的提示文字**：休眠的 session 只在被顯示時才可見，**而被顯示的那一刻它就醒了**；
      唯一穩定可見的休眠是喚醒失敗（已有載體）。這是**既有**缺口，不是本 change 造成的
      （見 10.27）。
      **dogfood 清單要明列 (a) 與 (f)，且 (f) 要求切到 `default` 模式走一次。**
      (g)(h) 的處置需要產品自己提供一個穩定的狀態，不是測試的事。

| capability | scenario | 載體 |
|---|---|---|
| agent-conversation-view | 新建的 agent session 預設為終端 view | 10.9 |
| agent-conversation-view | 切換到對話 view 再切回 | 10.9 |
| agent-conversation-view | shell session 沒有對話 view | 10.10 |
| agent-conversation-view | 切到對話 view 後 pty 仍在執行 | 10.10 |
| agent-conversation-view | 對話 view 在上層時 pty 的欄數與可用寬度相符 | 10.11（**含對照組；最易假綠**） |
| agent-conversation-view | 對話 view 在上層時終端不持有渲染資源 | 10.12（**判準見 `terminal-sessions` delta**） |
| agent-conversation-view | 尚未跟上時呈現跟進中 | 10.13 |
| agent-conversation-view | 內容無法取得時說明原因 | 10.7 |
| agent-conversation-view | 休眠 session 於對話 view 呈現休眠 | 10.14 |
| agent-conversation-view | 忙碌時呈現忙碌，閒置時不呈現 | 10.15 |
| agent-conversation-view | 訊息整則出現 | 10.16 |
| agent-conversation-view | 轉場時長不隨訊息長度改變 | 4.16（**代理判準，限度已寫明**） |
| agent-conversation-view | 兩個 session 各自的 view 互不影響 | 10.17 |
| agent-conversation-view | 重啟後回到上次的 view | 10.18 |
| agent-event-bridge | 啟用後 agent 的事件落盤 | 10.2 + 10.8（替身；**真實 agent 由 dogfood 認定**） |
| agent-event-bridge | 未啟用時完全不注入 | 4.11 |
| agent-event-bridge | 使用者已有同類設定且可並存 | 4.12 |
| agent-event-bridge | 無法確保並存時不注入 | 4.12（**人造分支** —— 2.1.261 下不可達，spec 已註記） |
| agent-event-bridge | 短時間內的多個事件全部被讀到 | 4.13 |
| agent-event-bridge | 損毀的事件不影響其餘事件 | 4.13 |
| agent-event-bridge | 事件內容不含絕對路徑 | 4.19（**含對照組**） |
| agent-event-bridge | 選擇類請求的選項不含絕對路徑 | 4.19 + 10.21 |
| agent-event-bridge | 未注入時等待狀態為未知 | 4.14（**含對照組**） |
| agent-event-bridge | 不認得的事件形狀不改變狀態為就緒 | 4.14（**含對照組**） |
| agent-event-bridge | session 結束後不留下事件 | 4.15 |
| agent-event-bridge | 新 session 不繼承上一輪的殘留 | 4.15 |
| agent-event-bridge | agent 宣告對話結束但 session 仍在時不清除落點 | 4.21（**含對照組**） |
| agent-input-bridge | 就緒時送得出去 | 10.19 |
| agent-input-bridge | 忙碌時仍可送出 | 10.19 |
| agent-input-bridge | 許可提示出現時不停留在忙碌 | 4.20 + 10.25（**含對照組 —— 本 change 最承重的一條**） |
| agent-input-bridge | 系統不認得的等待方式歸入未知 | 4.14 |
| agent-input-bridge | 未知時拒絕並說明 | 10.20 |
| agent-input-bridge | 未注入事件回報時對話 view 仍可讀 | 10.20 |
| agent-input-bridge | 等待選擇時自由文字送不出去 | 10.21 |
| agent-input-bridge | 不提供在此 view 內作答的入口 | 10.21b |
| agent-input-bridge | 於終端 view 作答後狀態離開等待選擇 | 4.22 + 10.21c |
| agent-input-bridge | 送出後先呈現為未確認 | 10.22 |
| agent-input-bridge | 未出現於紀錄時明示 | 10.22 |
| agent-input-bridge | 含控制字元的輸入不觸發控制行為 | 4.17 + 10.23（**缺口：THEN 的主詞是「agent 收到什麼」，替身證明不了**） |
| agent-input-bridge | 多行訊息作為單一則送出 | 4.17（**同上缺口**；依 0.2） |
| agent-transcript-stream | 並行的 session 各自跟進自己的紀錄 | 10.4 |
| agent-transcript-stream | 對話識別碼改變時跟進隨之改變 | 4.7 + 10.5 |
| agent-transcript-stream | 使用者在 agent 之內換掉對話時跟進隨之改變 | 4.7b + 10.5b（**替身送出帶新位置的事件**；真實 `/clear` 由 dogfood 認定） |
| agent-transcript-stream | 紀錄尚不存在不視為失敗 | 4.4 |
| agent-transcript-stream | 只送出新增的內容 | 4.2 |
| agent-transcript-stream | 來源被改寫時重新自頭讀取 | 4.3 |
| agent-transcript-stream | 不完整的最後一行不被送出 | 4.3 |
| agent-transcript-stream | 未知的記錄類型被忽略 | 4.5 |
| agent-transcript-stream | 事件不含絕對路徑 | 4.6（**含對照組**） |
| agent-transcript-stream | 長對話只載入最近一段並明示 | 4.8 + 10.6 |
| agent-transcript-stream | 來源不可讀時 pty 不受影響 | 10.7 |
| agent-transcript-stream | session 結束後停止跟進 | 4.9 |
| agent-transcript-stream | agent 宣告對話結束但 session 仍在時不拆除 | 4.21（**含對照組**） |
| claude-status-bridge | 兩個功能同時啟用時皆生效 | 4.18（**含對照組**） |
| claude-status-bridge | 關閉其中一個不影響另一個 | 4.18 |
| claude-status-bridge | 其中一個因故不注入時另一個仍注入 | 4.18 |
| session-persistence | 開啟應用程式至多啟動一個 session | 既有（已複驗，`probe-terminal.mjs` restore 段） |
| session-persistence | 冷啟動不因全域項目恆存而喚醒 session | 既有（已複驗，`probe-terminal.mjs:4032` **`runGlobalSession` 而非 `runRestore`** —— 歸屬與直覺相反） |
| session-persistence | 顯示一個休眠的 session 使其啟動 | 既有（已複驗） |
| session-persistence | 休眠的 session 不呈現為空白終端 | **部分覆蓋** —— `probe-terminal.mjs:3620` 只涵蓋喚醒失敗那一支；`sessions.dormantShell/dormantClaude` 零引用 ⇒ **須補載體（10.27）** |
| session-persistence | 休眠的 session 於對話 view 不呈現為空白對話 | 10.14 |
| session-persistence | 未喚醒的休眠 session 於再次重啟後仍存在 | **部分覆蓋** —— `:3125` 只比對分頁標籤（＝存在），未斷言仍為休眠 ⇒ **須補載體（10.27）** |
| terminal-sessions | 另一種呈現覆蓋其上時終端釋放渲染資源 | 10.12（**以資源自身的失效狀態為觀察對象**） |
| terminal-sessions | 反覆切換呈現方式不累積佔用 | 10.26（**含對照組**） |
| terminal-sessions | 任一時刻只有顯示中的終端持有渲染資源 | 既有（已複驗：`probe-terminal`「GPU 的渲染資源只給顯示中的終端」） |
| terminal-sessions | 切回的終端重新取得渲染資源且內容完整 | 既有（已複驗：「切過去的終端持有一份有效的渲染資源」＋「反覆切換 20 次後仍走程式化繪製」） |
| terminal-sessions | 共用的暫存物不構成持有的證據 | 既有（已複驗：「共用的暫存畫布不構成『持有渲染資源』的證據」） |
| terminal-sessions | 釋放後該資源即為失效狀態 | 既有（已複驗：「終端由顯示轉隱藏時歸還其渲染資源的並存額度」） |
| terminal-sessions | 僅移除產物而不歸還額度即失敗 | 既有（已複驗：同上，以額度為觀察對象） |
| terminal-sessions | 釋放的參照取自該終端自己 | 既有（已複驗：「釋放的是該終端自己的資源（關閉他者不影響顯示中的終端）」） |
| terminal-sessions | 銷毀當下顯示中的終端時歸還額度 | 既有（已複驗：「銷毀當下顯示中的終端時歸還其渲染資源的並存額度」） |
| terminal-sessions | 銷毀路徑若不歸還額度即失敗 | 既有（已複驗：同上） |
| terminal-sessions | 銷毀路徑的驗收取樣於顯示中的終端 | 既有（已複驗：同上，取樣點即為顯示中的終端） |
| terminal-sessions | 尚未建立任何 session 時沒有該路徑的週期性工作 | **無 probe 載體（既有缺口，非本 change 造成）** —— 見下方註 |
| terminal-sessions | 顯示且持有焦點的終端有恰好一份週期性工作 | **無 probe 載體（既有缺口）** |
| terminal-sessions | 切換與關閉全部 session 之後不留下週期性工作 | **無 probe 載體（既有缺口）** |
| terminal-sessions | 終局之後觀察仍然有效 | **無 probe 載體（既有缺口）** |
| terminal-sessions | 釋放時不停止週期性工作即失敗 | **無 probe 載體（既有缺口）** |
| terminal-sessions | 倚賴的上游修正必須存在於安裝的產物中 | 既有（已複驗：`xterm-blink-release.test.mjs`，**代理判準**，限度已寫在 spec 裡） |
| terminal-sessions | 該套件的版本不得浮動 | 既有（已複驗：`xterm-blink-release.test.mjs`） |
| workspace-layout | 呈現當前 repo 的多個 session | 既有（已複驗）—— 但從未驗過「**恰有一個** `aria-selected`」 |
| workspace-layout | 切換 focused session | 既有（已複驗，`:2437` + `:2033` 兩條不同名義的斷言）—— **THEN 已改為「當前 view」，對話那一支須新載體 10.9** |
| workspace-layout | 建立新 session 可選 spawn 目標 | 既有（已複驗） |
| workspace-layout | 建立入口緊鄰最後一個分頁 | 既有（已複驗） |
| workspace-layout | 分頁的右鍵選單 | **部分覆蓋** —— `:2224` 只驗開得起來；`sessions.close` 零引用（刪掉 Close 整項仍全綠）⇒ **記為既有缺口，不在本 change 修** |
| workspace-layout | 關閉分頁 | 既有（已複驗） |
| workspace-layout | 當前 repo 無 session | **部分覆蓋** —— `:1223` 只驗 0 個分頁；`sessions.empty` / `stage.noSession` 零引用 ⇒ **記為既有缺口，不在本 change 修** |

## 12. 文件

- [x] 12.1 `docs/PRD.md`：新增本能力於功能範圍與路線圖的位置
- [x] 12.2 `docs/lessons/transcript.md`：新增「跟進」與「批次存檔」兩條路徑的分界，
      以及 0.1／0.3 的實測結論（含日期與 CLI 版本）
- [x] 12.3 `docs/lessons/terminal.md`：「掛載／有版面盒子／看得見」三個謂詞不再恆等
- [x] 12.4 `CLAUDE.md`：踩雷指南的觸發器加上新模組；**只加會靜默踩到的**，其餘進 `docs/lessons/`
- [x] 12.7 **CSP 不需改動 —— 已確認，理由如下（而非沉默地跳過）**：對話 view 渲染的是
      agent 寫下的 markdown，與檔案樹渲染使用者 repo 裡任意 `.md` **是同一類不受信任的內容**，
      而那條路徑早已在同一份政策之下運作。具體：`script-src 'self'`（inline script 不執行）、
      `img-src` 已放行 `https:`（markdown 本就該能載入遠端圖片）且不放行 `http:`。
      **本 change 沒有引入任何新的資源型別**（不載入字型、不發 fetch、不嵌 iframe），
      而 markdown 的渲染重用既有的 `MarkdownView`（原始 HTML 降級為純文字、連結經
      `shell.openExternal`）。⇒ 無需 delta，亦無需放寬任何指令。
- [x] 12.8 **裁決：`conversation-archive` 不需要 delta。**
      那兩條 requirement 的主詞是**該能力自己的掃描**，不是「任何讀這份來源的東西」——
      新增一個消費者不改變它們對它自己的約束，因此原文一個字都不必動。
      而**新路徑需要同樣的紀律，那已經各自寫在 `agent-transcript-stream` 裡**
      （「記錄類型以白名單處理」「跟進的來源由 session 自身的身分決定」，後者含
      `CLAUDE_CONFIG_DIR` 的解析）。
      **刻意不把它們提升為共用的條款**：兩條路徑的生命週期與失效方式不同（批次／逐則、
      獨立行程／主行程），把約束寫在同一條之下會讓下一個改動誤以為兩邊必須一起變。
      共用的是**實作**（`insights-source.ts` 的根解析），不是**條文**。
- [x] 12.5 `npm run typecheck`、`npm run lint`、`npm test` 全綠
- [x] 12.6 `npm run test:e2e` 全套（封存前）—— **11/11 全部通過，每一支皆完整執行**（總計約 16 分鐘）
