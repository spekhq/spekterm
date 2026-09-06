## Context

動機見 `proposal.md`。這裡只記實作要面對的現況與夾制。

- **agent session 的身分已經齊了。** `terminal.ts` 自己產生或續接對話識別碼（`#conversation`），
  cwd 也是它決定的 —— 所以 transcript 的路徑 spekterm **算得出來**，不必用搜尋的。
- **已經有一條讀 transcript 的路徑，但形狀不對。** `transcript-archive.ts` 的增量單位是
  **整個來源檔案**（size/mtime 變了就重讀重寫），跑在獨立的 utility process，掃全部專案。
  它萃取的是計量用的列（`msg` / `int` / `cmp` / `tool`），不是要呈現的內容。
- **`--settings` 注入的接縫已經驗證過。** `agent-status.ts` 實測過它吃 inline 路徑、是疊加、
  注入的命令看得到 pty 的環境變數。**但它目前只寫 `statusLine` 一個 key。**
- **pty 的尺寸目前沒有 session 層級的來源。** `terminal.ts:62` 的註解逐字寫著「renderer 掛載後會
  fit 並 resize 校正，這只是 spawn 當下的暫定值」（80×24）。**沒有掛載，就沒有校正。**
- **邊界語彙不變。** renderer 以識別碼定址，不持有路徑。transcript 在 `~/.claude` 之下、不在任何
  workspace folder 內 —— 那是主行程自己的檔案存取，與 `repo-branch` 讀 worktree 的 gitdir 同一條
  理由，**不是白名單的擴大**。

## Goals / Non-Goals

**Goals:**

- 讓 agent session 的內容以結構化事件抵達 renderer，且**與終端 view 並存**。
- 讓「現在能不能送輸入」有一個**來自 agent 自己**的判準。
- 讓上述兩者的每一種失效都**明示**，而不是呈現一個看起來完整的錯畫面。

**Non-Goals:**

- **逐字串流。** transcript 是整則寫入，本設計呈現為「一則一則出現」。
- **模擬的逐字串流。** 見 D15 —— 這一條與上一條是分開的，因為它是**做得到但不該做**的那種。
- **取代終端 view。** 終端 view 在本 change 之後仍是**預設**（見 D14）。
- **解析終端畫面。** 見 proposal。這是規格層的禁令，不是實作偏好。
- **重現 agent TUI 的全部互動。** 本設計不處理 `/login`、`/switch`、更新提示等流程 ——
  它們一律落入「無法判定」，處置是指向終端 view。
- **subagent 的內容。** 實測（本機 23 個含 subagent 的對話逐一確認）：**subagent 的內容一個
  位元組都不在主 transcript 裡**，主檔的 `isSidechain: true` 記錄數全部為 0；它們住在
  `<project>/<conversationId>/subagents/*.jsonl`。本設計只讀主檔，因此 subagent 的呼叫在對話
  view 上會是**一則沒有內容的工具呼叫**。這是刻意的範圍決定，但**必須寫下來** —— 否則會被
  誤讀為「做完就看得到 subagent」。

## Decisions

### D1. 內容走一條**獨立於 archive** 的 per-session 讀取路徑

不擴充 `transcript-archive` 的掃描。兩者的生命週期與失效模式完全不同：archive 綁在
「應用程式啟動」與使用者的手動觸發上、跑在獨立行程（**崩潰隔離的理由是格式解析**）、
以整檔為增量單位；live tail 綁在 **session 的生命週期**上、要低延遲、以位元組偏移為單位。

塞在一起的代價是兩者共用一組狀態 —— 「掃描進行中」與「這個 session 落後了」會變成同一個旗標。

> **兩者共用的是格式知識與白名單紀律，不是投影。** archive 產出計量用的列；live view 需要的是
> 訊息本體、工具的名稱與參數、結果摘要。同一份來源的兩種投影。`transcript-extract.ts` 是純函式
> 且只認 `user` / `assistant`，本路徑另立投影並沿用同一條「白名單、未知類型忽略且不報錯」的紀律。

**代價（已知且有界）**：同一個來源檔案會被讀兩次。live tail 只讀 append 的部分，archive 每次
啟動掃一輪 —— 兩者都不寫來源，沒有互斥問題。

### D2. transcript 檔案由 spekterm **算出來**，不搜尋

`<root>/projects/<encodeProjectDir(session 起始 cwd)>/<conversationId>.jsonl`。

`root` 沿用 `conversation-archive` 既有的「尊重使用者 shell 的 `CLAUDE_CONFIG_DIR`」。
`encodeProjectDir` 已存在於 `transcript-project.ts`。

**否決的替代方案**：監看整個 `projects/` 挑最新的檔。多個 session 並行時它會抓錯，而且那讓
「這是哪個 session 的內容」與 session 身分脫鉤 —— 失效方式是**把 A 的對話畫在 B 的畫面上**。

**承重的細節一：對話識別碼會變，而自癒不是唯一的觸發者。** 實測（2026-09-06、CLI 2.1.261）
**`/clear` 會直接指派一個新的 session id**，於是 transcript 換檔；`/resume`、`--fork-session`
同理。而這些**全部發生在 pty 之內** —— pty 沒死、`SessionHealed` 不觸發，spekterm 收不到任何訊號。

漏掉它的失效**特別惡劣**：跟進器停在舊檔，落進 D3 的「檔案不存在 ⇒ 不是錯誤，等它出現」，
於是**永遠等下去**，而「跟進的失敗只影響它自己」也不會觸發（沒有失敗）。畫面就是一份安靜停住的
對話 —— 正是 Risks 那條「安靜落後的 view 比沒有 view 更糟」。

**承重的細節二：權威來源已經在手上，不必只靠算。** 實測 hooks 的**基底 payload 每一個事件都帶
`transcript_path`**，而 spekterm **已經在收的 statusLine payload 也帶它**（`~/.config/Spekterm/
agent-status/<sessionId>.json`）。

因此定位分兩層：**算出來的路徑是初始值與 fallback；`transcript_path` 一旦到達即為權威**，
以它為準重新定位。

**實測 `/clear` 的訊號比預期更明確**（2026-09-06、CLI 2.1.263）：

```
25251ms  /clear 送出
26488ms  SessionEnd    session_id=f42667f4…  transcript_path=f42667f4….jsonl   ← 舊
26547ms  SessionStart  session_id=4bc036bb…  transcript_path=4bc036bb….jsonl   ← 新（59ms 後）
```

⇒ 重新定位不必等下一則內容，`SessionStart` 就帶著新路徑，且早於任何新內容。

> **而這帶出一個本設計原本會踩到的陷阱，見 D2b。**

### D2b. **hooks 的 `SessionEnd` 不等於 spekterm 的 session 結束**

實測：`/clear` 會發出 `SessionEnd`，**而 pty 還活著**。

第一版的兩份規格都寫著「session 結束時清除落點／停止跟進」。照字面把 `SessionEnd` 接上去，
使用者按下 `/clear` 的那一刻跟進器就被拆掉，其後**永遠不再更新** —— 而 pty 正常、終端正常、
沒有任何錯誤。**這正是本 change 反覆在防的那一族失效。**

**spekterm 的 session 由 pty 定義，不由 agent 的對話定義。** 兩者是不同的生命週期：

| | 何時結束 | 誰知道 |
|---|---|---|
| spekterm 的 session | pty 結束 | 主行程（`onExit`） |
| agent 的一段對話 | `/clear`、`/resume`、自癒、pty 結束 | hooks 的 `SessionEnd` |

⇒ `SessionEnd` 的正確語意是「**這一段對話結束了，接下來可能換一份紀錄**」，
它 SHALL 觸發**重新定位**，SHALL NOT 觸發拆除。拆除只由 pty 的結束觸發。

> 這正是 CLAUDE.md 那條「optional 欄位要實測它何時被填，不要從語意推論」的同族，只是來源不是
> core。第一版 design 花了一整條論證「算得出來」，而那個論證是對的、卻不完整。

### D3. 增量以**位元組偏移**讀取，並處理三種不是 append 的情況

來源是 append-only 的 NDJSON，正常路徑是「從上次的 offset 讀到檔尾」。三個例外必須顯式處理：

1. **檔案比 offset 短** —— 被改寫或換過。處置：重讀整檔、重設 offset。
2. **最後一行不完整** —— 我們讀在寫入的中間。處置：保留未終止的尾段不 parse，等下一次。
   （這與 `agent-status` 的原子寫入是同一族問題，但這裡**沒有原子寫入可用** —— 來源不是我們寫的。）
3. **檔案尚不存在** —— agent 還沒寫出第一則。處置：不是錯誤，等它出現。

### D4. 監看一律經 `src/main/watcher.ts`

repo 既有紀律（eslint 擋靜態 import、`watcher-source.test.mjs` 擋動態 import）。
一個 watcher 對一個目標，`pollingRoot` **省略**（預設等於監看目標，而這是一對一的情況 ——
與 `branch-service` 同）。

**監看的是檔案不是目錄**：`repo-branch` 已實測 chokidar 對「rename 上去」的單檔監看撐得住。
但 transcript 是 append 寫入，不是 rename，比那個情境更單純。

**檔案尚不存在時的兩層**：與 `repo-branch` 監看 `.git/HEAD` 同一個問題 —— 監看一個不存在的檔
收不到事件。第一層監看該專案目錄（恆常存在，`depth: 0`），等目標檔出現後建立第二層。

### D5. hooks 與 statusLine **合成同一份 `--settings`**，且合成器只有一個

`prepareInjection()` 目前寫死 `{ statusLine: ... }`。改為由一個合成器產出
`{ statusLine?: ..., hooks?: ... }`，兩個功能各自決定要不要參與。

**兩者的啟用狀態獨立**：關掉狀態橋接不該連帶關掉對話 view 的輸入能力，反之亦然。

> **已實測（2026-09-06、CLI 2.1.261、Linux）：`--settings` 的 hooks 與使用者的 hooks 是「合併」，
> 不是覆寫。** 方法：隔離的 `CLAUDE_CONFIG_DIR`，使用者設定與注入設定**都**定義 `SessionStart`
> （matcher 皆為 `""`）各自寫一個標記檔 —— 兩個標記檔都出現。
>
> 這個實測是必要的：`agent-status.ts` 既有的「疊加」結論是**設定 key 層級**的（我們只指定
> `statusLine`，其餘不受影響），**不蘊含** `hooks` 陣列會合併。
>
> **⇒ D6 走「注入」那一支。** 連帶：`readUserStatusLine()` 那套「讀出使用者的設定才能串接」
> 對 hooks **完全不需要** —— 合併由 CLI 自己做。

### D6. 注入不成立時，view **降為唯讀**而不是失敗

statusLine 那條的不對稱代價論證（「不注入只是少一個他還不知道存在的功能」）**在這裡不成立**
—— 不注入 hooks，輸入端就整個不能用。所以退路必須是別的東西：

| 情況 | 處置 |
|---|---|
| 使用者沒有自訂 hooks | 注入 |
| 有自訂（**實測 2.1.261 為合併**） | 注入 |
| 未來版本改為覆寫、或注入本身失敗 | **不注入。view 仍呈現內容（那條路不依賴 hooks），但送出入口停用並說明原因** |

> **第三列在 2.1.261 之下不可達** —— 保留它是為了防版本改變，而**它的載體只能是人造分支**。
> 這一點要寫進規格：否則下一個人會以為那條有真實覆蓋（比照 `terminal-sessions` 對代理判準
> 明寫限度的作法）。

**這仍是本設計最重要的降級路徑**：內容與輸入是兩條獨立的路，前者不依賴 hooks。少了 hooks，
使用者失去的是「在新畫面打字」，不是「看不到內容」。0.1 的結果讓它從**主線風險**降為
**版本防護**，但不該因此拆掉。

### D7. hooks 取哪幾個，以及 payload 為什麼不能沿用 statusLine 的形狀

**第一版的清單建立在「`Notification` ＝ idle」這個前提上，而實測證明它不成立。** 更正後：

| hook | 用途 | 為什麼需要它 |
|---|---|---|
| `PermissionRequest` | **等待選擇的權威訊號** | 在 permission 提示出現**之前**同步觸發。這是唯一及時的來源 |
| `PreToolUse` 匹配選擇類工具 | 拿到完整的問題集 | 匹配 SHALL 涵蓋 plan mode 的核准（它是一個工具），不只問答類 |
| `PostToolUse` | **離開等待選擇** | 少了它，「選了之後狀態不再是等待選擇」沒有任何事件可以成立 |
| `Notification` | 次要訊號 | **必須依 `notification_type` 分派**，見下 |
| `Stop` | 就緒 | payload 帶 `last_assistant_message`，是「剛講完話」的即時訊號 |
| `SessionStart` | **重新定位** | `/clear` 之後 59ms 內即帶新的 `transcript_path`（見 D2） |
| `SessionEnd` | **重新定位的前導，不是拆除** | 見 D2b |

**實測的時序（2026-09-06、CLI 2.1.263，Write 工具於 `--permission-mode default` 下）：**

| 事件 | 時間 |
|---|---|
| `PreToolUse` | 8557ms |
| **`PermissionRequest`** | **8600ms** |
| **許可對話框出現在畫面上** | **8622ms** |
| `Notification`（`notification_type=permission_prompt`） | 14624ms |

⇒ **`PermissionRequest` 早於畫面 22ms；`Notification` 晚於畫面 6002ms。**
及時性要求做得到，而且**非用 `PermissionRequest` 不可** —— 靠 `Notification` 會留下整整六秒
「對話框在畫面上、狀態仍是忙碌（允許送出）」的窗口。

**實測的 payload 欄位**（每一個都要列，不從文件推論）：

- 基底（每個事件都有）：`session_id` / `transcript_path` / `cwd` / `scratchpad_dir` /
  `permission_mode` / `prompt_id` / `hook_event_name` / `effort`
- `PermissionRequest` 另有：`tool_name` / `tool_input` / `permission_suggestions`
  （**沒有** `tool_use_id` —— `PreToolUse` 有，這兩者不可互相假設）
- `Notification` 另有：`message` / `notification_type`
- `PreToolUse` 另有：`tool_name` / `tool_input` / `tool_use_id`

> **`scratchpad_dir` 也是絕對路徑** —— 剝除清單不只 `transcript_path` 與 `cwd`。

**`PermissionRequest` 與工具無關，計畫核准走同一條**（實測）：

```
18158ms  PreToolUse        tool=ExitPlanMode
18187ms  PermissionRequest tool=ExitPlanMode      ← 29ms 後
24213ms  Notification      type=permission_prompt  ← 6026ms 後（與工具核准那次的 6002ms 一致）
```

⇒ 一個不分工具的 `PermissionRequest` 同時涵蓋工具核准與計畫核准，**不需要維護一張工具清單**
（而那種清單的失效方式是「agent 新增一種需要核准的工具時靜默漏掉」）。

### D7b. **`PermissionRequest` 觸發 ⟺ 提示會出現** —— 以及它帶來的覆蓋風險

實測 `--permission-mode` 的三種值：

| 模式 | 提示 | `PermissionRequest` |
|---|---|---|
| `default` | 出現 | **觸發** |
| `acceptEdits` | 不出現 | 不觸發 |
| `auto` | 不出現 | 不觸發 |

這個等價關係正是我們要的：**需要它的時候它就在，不需要的時候它不製造噪音。**

> **但它帶來一個承重的覆蓋風險，必須寫下來**：agent 的預設模式由**使用者**決定，而實測本機的
> `defaultMode` 是 `auto` —— 也就是說，**日常使用幾乎不會出現許可提示**。
>
> 於是 `awaiting-choice` 這條路 —— **本 change 最承重、失效後果最嚴重的一條** —— 在 dogfood 中
> **最少被走到**。這是「最危險的路徑最少被驗」的典型形狀，不能倚賴自然使用去發現它的缺陷：
> 它的驗收必須由探針以替身主動觸發，且 dogfood 清單要**明確要求切到 `default` 模式走一次**。

### D11b. 送出的編碼：實測結論

原本列為「實作期的實測項」，已完成（2026-09-06、CLI 2.1.263，以**讀回 transcript** 驗證 agent
實際收到什麼，而非斷言我們送出什麼）：

- **`\n`（0x0A）是訊息內的換行，`\r`（0x0D）才是送出。** 兩者在 TUI 裡語意不同。
- 送 `多行本文 + \r` ⇒ transcript 中**恰好一則**使用者訊息，換行完整保留。
  **bracketed paste 不需要** —— 包與不包結果相同。
- **原始控制位元組會讓整則訊息無聲消失。** 送含 `\x01` / `\x07` / `\t` 的本文再送 `\r` ⇒
  **transcript 檔案根本沒有被建立**，也就是說訊息從未送達，而畫面上沒有任何錯誤。

⇒ 送出前 SHALL 過濾：除了 `\n` 之外的控制位元組不得原樣寫入 pty。
**失效方向是「訊息消失」而不是「訊息被誤解」** —— 前者更難察覺，因為使用者會以為自己沒按到 Enter。

**兩個實測出來的陷阱，兩個都會靜默地把狀態算成可以送出：**

1. **`Notification` 不是 idle 的同義詞。** 它帶 `notification_type`，而 `permission_prompt` 與
   `idle_prompt` **都走它**。不看那個欄位的實作，會把 permission 提示讀成「就緒」。
2. **permission 的通知延遲 6 秒才送**（實測 binary 內為固定的 6000ms），且可被
   `CLAUDE_CODE_DISABLE_PERMISSION_PROMPT_NOTIFY_HOOKS` 整個關掉。**那 6 秒內狀態仍是上一個值
   ＝忙碌**，而忙碌是允許送出的。**同一個災難換一條路走進來，而且這條路不需要任何實作錯誤** ——
   這正是採用 `PermissionRequest`（同步、提示出現之前）而非依賴 `Notification` 的理由。

**statusLine 的 payload 是「當下狀態的快照」，可以一個檔案反覆覆寫；hooks 是「事件」，
覆寫會丟事件。** 兩者不能共用落點形狀。事件以 append 或 per-event 檔承載，讀取端負責去重與排序。

落點仍沿用同一個機制：環境變數指定 per-session 的位置、命令本身不必知道自己屬於哪個 session。

### D8. 送出的閘：四態，而**未知是預設值**

`ready` / `busy` / `awaiting-choice` / `unknown`。

`unknown` 涵蓋：尚未收到任何事件、注入未成立、事件過期、收到不認得的事件形狀，
**以及任何無法明確歸入其餘三態的情況**。**`unknown` 時拒絕送出，並指向終端 view。**

**「permission 提示出現中」SHALL 歸入 `awaiting-choice`，SHALL NOT 停留在 `busy`。** 這一條是
本設計最容易被實作繞過的地方（見 D7 的兩個陷阱）—— 它不是狀態機的一個角落，**它就是 proposal
立論要防的那個災難本身**。

**`unknown` 是「其餘一切」，不是一份清單。** 寫成清單的實作會在 agent 新增一種等待方式時
靜默落回 `else`（本 repo 已因「加一個列舉值卻沒 grep 所有 `===`」踩過兩次）。

這條的方向是刻意的：一個「不確定就送送看」的實作，其失效是把答案打進錯的地方
（proposal 引的那 220 條偽造訊息就是這麼來的）；一個「不確定就不送」的實作，其失效是
使用者多按一下切去終端。**兩種代價不對等。**

> `awaiting-choice` 時 SHALL NOT 把自由文字當成答案送出 —— 選擇類請求只接受選項。

### D9. 當前 session 的終端**保有版面盒子**，於是尺寸問題不必新增任何條款

原本的方案是「session 持有最後已知尺寸並落盤」。**讀 `terminal-sessions` 的原文之後否決** ——
那條 requirement 已經把這件事論證完了，而且結論相反：

> 一個從未被真實量測過的值會讓 agent 以錯誤的寬度輸出，而那些輸出一旦印出就**永久留在終端
> 歷史裡**，其後把尺寸改回來也救不回。

它因此明文禁止在沒有版面盒子時推導或推送尺寸。**落盤一個尺寸正是它禁止的那件事**（那個值
不是當下量到的）。

正解是不要製造「沒有版面盒子」的情況：**session 為當前 session 時，其終端保有版面盒子，
與哪一個 view 在上層無關**（隱藏而非移除）。於是：

| 既有條款 | 判準 | 對話 view 在上層時 |
|---|---|---|
| 「終端尺寸變化時 pty 尺寸同步」 | **有沒有版面盒子** | 有 → 尺寸照常同步 ✅ |
| 「程式化繪製的渲染資源僅供當下顯示的終端」 | 顯示↔隱藏、以及**銷毀** | **不適用 —— 這是第四種轉換** |

**第一欄成立，第二欄不成立。** 前一版把第二條簡化成「以可見性為判準」，於是宣稱
`terminal-sessions` 一個字都不必改。**那是錯的**，而那條 requirement 自己就寫下了反證：

> **銷毀是獨立於顯示↔隱藏之外的第三種轉換，因此需要各自的條文與各自的驗收。**……上述
> 「由顯示轉為隱藏時釋放」對這條路徑**一個字都沒說到**。

**切換 view 是第四種轉換**：保有版面盒子、失去可見、**不**銷毀、**不**失去掛載。照那條
requirement 自己的邏輯，它需要自己的條文與自己的驗收 —— 因此 `terminal-sessions` **需要一條
delta**（把釋放的觸發一般化為涵蓋本轉換，並要求該路徑各自的額度驗收）。

**而驗收不可沿用「取得資源時新增了哪些節點」那個判準** —— 同一條 requirement 明文禁止：

> **上述判定依據涵蓋「路徑是否切換」，SHALL NOT 被當作「額度是否歸還」的證據** ——
> 產物的移除由套件自己完成，因此依它判定的斷言**在額度未歸還時依然全綠**。

必須以**資源自身的失效狀態**為觀察對象（既有的「額度歸還的驗收以資源自身的失效狀態為觀察對象」
已把做法定義好）。

> **還有一層掩蓋要避開**：既有 spec 記載「點擊會把輸入焦點移到分頁元件上……失焦會使底層套件
> 暫停其週期性工作並清掉計時器 —— **缺陷因此被掩蓋**」。切到對話 view **必然**把焦點交給輸入框，
> 於是同一個掩蓋機制生效，而這次連「改用鍵盤」都繞不開（切換本身就是焦點轉移）。

**失效長相**：反覆切 view，每切一次洩漏一個並存額度；到達上限時**一個正在顯示的終端當場變空白**，
不觸發任何事件，而整輪探針全綠。

> **這條仍然需要對照組**，只是斷言的對象變了：驗收 SHALL 造出「重建後直接進對話 view」的
> session，斷言其 pty 的欄數與可用寬度相符（而非 80）。**不修也不會紅** —— agent 照樣回話，
> 只是它以為畫面很窄，而症狀要到使用者切去終端 view 看歷史時才顯現。

### D10. 「被顯示」＝ 任一 view 成為當前顯示

`session-persistence` 的「重建的 session 為休眠態，於首次被顯示時才啟動 pty」，其判準
（「顯示中的 session」）本來就是**以 session 為對象**，不以終端為對象 —— 加上 D9 之後
喚醒的路徑不變。

**但同一條 requirement 的另一句需要一般化**：「休眠狀態 SHALL 被明確地呈現，SHALL NOT 呈現為
一個空白的**終端**」—— 對話 view 之下，一個空白的**對話**是同一個錯誤的另一種長相。

**照字面沿用會讓休眠的 session 在對話 view 下永遠不醒**，而畫面上只是一片空白 —— 與
`global-session` 那次 `folderId: null` 完全同構（一個新的列舉值靜默落進 `else`）。

**推論**：凡是以「終端是否掛載／是否可見」為條件的判斷都要 grep 一遍 —— 現在「掛載」、
「有版面盒子」、「看得見」是**三個不同的謂詞**，而它們此前恆等。這不會有任何型別錯誤。

### D11. 輸入送進 pty 的形式 —— **已實測，見 D11b**

### D12. 兩條路徑**各自**都要剝除檔案系統位置

- 一律以 `sessionId` 定址，本體**不含任何絕對路徑**。

**兩條路徑都會挾帶路徑，而第一版只處理了 transcript 那條。** 實測 hooks 的**基底 payload 每個
事件都帶 `transcript_path` 與 `cwd`**，`PreToolUse` 再多一個 `tool_input`（檔案路徑就在裡面）
—— 而 `agent-input-bridge` 的「呈現的選項 SHALL 來自事件所帶的內容」正是把事件內容送進 renderer
的路徑。**兩條路各自需要剝除與各自的對照組**，不是一條。

漏掉事件那條的失效與 `SpecInfo.path` 那次完全同構：renderer 拿到 workspace 之外的絕對路徑，
邊界語彙就此破功。
- **逐則送，不整批送。** `conversation-archive` 那條「內文不整批送往 renderer」的理由是量體；
  live 路徑天然是逐則的，不衝突。但**初次附掛**（切到對話 view 時，該 session 已經聊了很久）
  是一次批次 —— 需要一個明確的上限，並在超過時明示「較早的內容未載入」。

### D13. 兩個 view 是同一個 session 的兩種呈現，切換狀態 per-session 且落盤

不是兩個 session、不是兩個分頁。分頁列不變（`workspace-layout` 既有條款不動），
切換入口在分頁之內。

### D14. 終端 view 維持預設

本 change 不改變既有使用者第一眼看到的東西。對話 view 是**切過去**的。

理由有二：其一，風險有界 —— 新路徑的任何缺陷都不會讓人開不了工。其二，D9 的尺寸問題在
「終端先掛載過」的路徑上不會發生，於是那條修正的**唯一觸發情境**被縮小到「重建後直接進對話
view」，可以獨立驗收。

換預設是 dogfood 之後的裁決，不在本 change。

### D15. 「agent 在動」由 hooks 宣告，訊息出現用**轉場**動畫 —— SHALL NOT 模擬逐字

真的逐字這條路拿不到（見 Non-Goals）。而**模擬一個是容易的，所以它會被順手加上去** ——
這一條存在的目的就是擋住那個順手。

分成兩件事，各自有誠實的作法：

| 使用者想知道的 | 誠實的來源 |
|---|---|
| 「agent 現在在動嗎」 | **hooks**。使用者送出到 `Notification` 說它 idle 為止即為忙碌，這是 agent 自己講的 |
| 「這裡多了一則」 | **轉場動畫**（淡入／位移）。它只宣稱「這是新的」，不宣稱任何關於進度的事 |

**為什麼模擬的打字機不可接受**（三條，都是實際會發生的）：

1. **它宣稱了一個假的進度。** 訊息早就整則到達了。動畫還在播的時候 agent 可能已經在跑下一個
   工具 —— 畫面說「還在講話」，事實是「已經在改檔了」。
2. **它是在拖慢使用者。** 真串流是「內容還沒到」；模擬是「內容到了但不給你看」。
3. **它讓動畫狀態與 session 狀態分家。** 播到一半使用者送出下一則時，兩套狀態要對齊。

第 1 條是承重的：本 change 的整個立論就是「呈現的東西要有來源」，而一個模擬的進度條
**沒有來源**。它與「解析終端畫面」是同一種錯誤的兩個方向 —— 前者猜過去發生了什麼，
後者演出一件沒有發生的事。

> 轉場動畫的時長 SHALL 不隨訊息長度改變 —— 一旦隨長度變化，它就開始宣稱進度了。

## Risks / Trade-offs

- ~~**`--settings` 的 hooks 會覆寫使用者自己的 hooks**~~ → **已實測排除**（2.1.261 為合併，見 D5）。
  D6 的降級路徑保留為版本防護。
- **permission 提示被算成可以送出** → D7 的 `PermissionRequest` + D8 的「permission 提示中歸入
  `awaiting-choice`」。**這是本 change 最承重的一條** —— 它就是 proposal 立論要防的災難本身，
  而它有兩條互相獨立的進入路徑（`Notification` 不分派、以及 6 秒延遲窗口內的 `busy`）。
- **`/clear` 等 pty 內的換 id 讓跟進停住** → D2 的 `transcript_path` 為權威。失效是**安靜的**：
  不報錯、不落後、就是不再更新。
- **transcript 格式隨版本改變** → 白名單處理記錄類型（沿用 `conversation-archive` 既有紀律），
  未知類型忽略且不報錯。失效方向是「少呈現一種東西」，不是「畫錯」。
- **送出時機誤判** → D8 的未知即拒絕。代價是使用者偶爾要切去終端。
- **pty 停在 80×24 且靜默** → D9 的對照組。**這是本 change 最容易假綠的一條**：不修也不會紅。
- **對話 view 落後於終端** → 必須明示（例如「跟進中」而非假裝完整）。一個安靜落後的 view 比
  沒有 view 更糟，因為使用者會據此判斷 agent 沒在動。
- **兩條讀取路徑讀同一個檔** → 兩者都不寫來源，無互斥問題；代價是重複的 I/O，有界。
- **自癒換 id 時跟丟** → D2 綁 `SessionHealed`。漏掉這條的症狀是「view 停住而終端在跑」。

## Migration Plan

無資料遷移。落盤格式新增一個欄位（session 的當前 view），
沿用 `SessionStore.replace()` 的**逐欄位白名單**（既有機制）。終端尺寸**不落盤**（見 D9）。

回退：對話 view 是切過去的、終端 view 為預設 —— 移除本 change 的 renderer 部分不影響既有行為。
注入部分的回退等同「hooks 未注入」，已由 D6 涵蓋。
