# Claude Code 的 session transcript —— 讀它之前必讀

> **觸發條件**：要動 `src/main/transcript-*`、`src/main/insights*`、`scripts/probe-insights.mjs`，
> 或任何會去讀 `~/.claude/projects` 的東西。
>
> 這一整份的失效方式幾乎都是同一種：**兩種算法都算得出數字，而錯的那一個看起來完全正常。**
> 沒有一條會拋錯，沒有一條會讓型別檢查變紅。

## 這份資料是什麼

Claude Code 把每個 session 的對話寫成 NDJSON，落在
`<設定目錄>/projects/<cwd 編碼後的目錄名>/<session-id>.jsonl`，逐輪追加。設定目錄預設 `~/.claude`，
以 `CLAUDE_CONFIG_DIR` 覆寫（**實測 2026-09-05：`projects/` 與其中的 transcript 確實一併搬走**，
即使那一趟認證失敗也照樣寫出來）。

**它預設只留 30 天。** 實測（2026-09-04）：本機 44 個專案目錄、488 個檔、31 萬行、1.5 GB，
而最舊的一筆剛好是 30 天前 —— 更早的已經不存在。這是 `conversation-archive` 存在的全部理由。

## 一、判定一律看結構欄位，不看內文長什麼樣

來源裡有一整類記錄其角色是 `user` 但**使用者從未輸入**：skill 與 slash command 被展開的內文、
其他 agent session 送來的訊息、圖片佔位、harness 的追問。它們帶著頂層的 **`isMeta`**。

| 判定方式 | 抓到 |
|---|---|
| 文字樣式比對（`<task-notification>` / `<local-command-caveat>` / 中斷標記三個 pattern） | **53** 筆 |
| `isMeta: true` | **965** 筆 |

漏掉的 912 筆讓每一個數字都偏掉：

| | 文字比對 | `isMeta` |
|---|---|---|
| 使用者訊息數 | 4,777 | **3,839**（高估 24%） |
| 長度中位數 | 33 | **23** |
| 長度平均 | 1,119 | **53** |
| 最長 | 922,812 | **3,784** |

那個「最長 92 萬字元的 prompt」不存在 —— 它是一份 skill 的內文。

**中斷同理**：判定看頂層的 **`interruptedMessageId`**，不要比對內文的
`[Request interrupted by user…]`。那是英文文案，改版即失效 —— 屆時「我什麼時候踩煞車」
會變成一條漂亮的零線。

> **fixture 要放一筆「內文與一般訊息完全無法區分」的 `isMeta`。**
> 實作時的對照組第一次是綠的：fixture 那三筆 `isMeta` 的內文剛好都有明顯特徵
> （`Base directory` / `Another Claude session` / `[Image:`），於是它對「看旗標」與「比對內文開頭」
> 兩種實作給出相同結果。**真實資料裡 skill 的內文可以長成任何樣子，而看起來正常的那一筆
> 才是會被漏掉的那一筆。**

## 二、記錄類型是白名單，不是黑名單

實測本機資料有 **21 種**頂層 `type`：

```
assistant / user / attachment / bridge-session / last-prompt / mode / permission-mode /
ai-title / atis-latch / system / queue-operation / file-history-snapshot / file-history-delta /
worktree-state / relocated / frame-link / agent-name / artifact-autoreact-ledger /
cost-state / pr-link / artifact-comment-monitor
```

多數是隨版本陸續長出來的（參考實作的註解只列了 8 種）。**只認 `user` 與 `assistant`，
其餘一律忽略且不報錯** —— 黑名單式的排除會在下一次更新時把新類型當成資料處理。

## 三、`cwd` 在一支 session 之內會變

實測本 repo 自己的一份 transcript：同一個 session 裡出現過**四個**不同的 `cwd`，
包含 `/tmp/…/scratchpad`。直覺作法 `basename(最後一個 cwd)` 會把那個專案標成 **「scratchpad」**，
而畫面上看起來完全正常。

正解利用目錄名的生成規則反查：在該 session 出現過的 `cwd` 之中，取**編碼後等於目錄名**的那一個。
編碼非單射（`/a/foo-bar` 與 `/a/foo/bar` 編碼後相同），兩者都出現時取**最早出現**的 ——
目錄名由起始 cwd 生成，而起始 cwd 必然最早出現。

反查不到時回傳 `null` 而非猜一個。比照 `SpecInfo.path`：少一個名字，好過給一個錯的。

## 四、`input_tokens` 幾乎恆為 0

有 prompt cache 的時候，真正的輸入量在 **`cache_read_input_tokens`**。實測本機 32 天：

| 欄位 | 量 |
|---|---|
| `input_tokens` | 0.4 M |
| `cache_read_input_tokens` | **26.4 B** |

**差七萬倍。** 照欄位名畫「輸入 token」會顯示成幾乎沒花錢。

## 五、時間戳是 UTC

`"timestamp": "2026-08-06T10:48:10.009Z"`。直接拿它算「星期 × 小時」，對 UTC+8 的使用者
整張熱圖偏移 8 小時 —— 「半夜十一點還在工作」會顯示成下午三點。逐日分組與跨午夜的切段同理。

> **驗收要造一筆「本機日期與 UTC 日期不同」的記錄，而取哪個鐘點取決於時區的方向。**
> 固定取當地 23:30 對東半球無效：UTC+8 的 23:30 是**同一天**的 UTC 15:30，
> 那筆記錄於是沒有鑑別力。東半球取當地 00:30，西半球取 23:30；UTC+0 造不出對比，
> 該條驗收應當**略過而非通過**。

## 六、subagent 有自己的檔案，而兩類資料的歸屬方向相反

subagent 的 transcript 在 `<project>/<session-id>/subagents/*.jsonl`（本機 251 個，
多於主 session 的 237 個）。

- **使用者訊息**：subagent 的 `role: user` 是 orchestrator 寫給它的指令，**不是使用者打的**。排除。
- **工具呼叫與用量**：subagent 跑掉的 Bash 就是這次工作真的跑掉的 Bash，花掉的 token 也是真的
  花掉了。**計入。**

兩種選擇都算得出數字，而「Bash 佔 75%」在兩種定義下是不同的量。**必須寫下來，並讓使用者看得到
用的是哪一個。**

## 七、slash command 在來源裡是展開的 XML

```
<command-message>opsx:continue</command-message>
<command-name>/opsx:continue</command-name>
<command-args>my-change</command-args>
```

不還原的話，「我最常說的那幾句」會列出一堆 XML，而 slash 的使用量會被**低估**：
以訊息開頭找斜線只抓到約 34 次，實際打出來的有 376 次（其中 342 次是展開形式）。

同族的還有 `!` 前綴的 bash：`<bash-input>` **是**使用者打的，`<bash-stdout>` / `<bash-stderr>`
**不是**。

## 八、`<task-notification>` 在真實資料裡只有一種形態

實測 40 個 transcript：非 `isMeta` 的通知記錄 **130 筆全部是「通篇只有通知」**，
夾在真實訊息裡的 **0 筆**。

規格若只寫「移除通知、保留其餘內文」，照字面實作會產出 130 列**空內文的使用者訊息** ——
訊息數灌水、長度中位數被拉低，而數字看起來完全正常。**兩種形態都要寫，而高頻的是前者。**

## 九、資料量會讓「展開運算子」炸掉

```js
Math.min(...times)   // times 有六十幾萬筆 → RangeError: Maximum call stack size exceeded
```

展開運算子把每一筆變成一個函式參數，而參數個數有上限。**fixture 只有二十列，單元測試與探針
都看不到** —— 這是 dogfood 抓到的。任何對「一列一筆」的陣列做 `Math.min/max(...)` 的地方都要改成迴圈。

## 十、掃描的體積與時間

| | |
|---|---|
| 全掃 490 檔 / 31 萬行 | **約 24 秒**（Node 與 Python 同數量級） |
| 存檔（含訊息內文與用量） | 一年約 **145 MB**，其中用量列佔 65%、訊息內文只佔 3% |

24 秒放在主行程上就是 24 秒的 IPC 停擺。**跑在 `utilityProcess`，而決定性的理由是崩潰隔離
不是效能** —— 這個模組解析的是會隨版本改變的內部格式，它出事時使用者正在跑的 agent 不該跟著死。

## 十一、`claude -p` 會寫進 transcript，而那則記錄**沒有** `isMeta`

實測 2026-09-05（`claude` 2.1.261）：非互動模式下，`-p` 的指令與標準輸入**被串成同一則**
`type: "user"` 記錄，`isMeta` 欄位不存在，`cwd` 是委派的工作目錄。

```
$ printf 'ALPHA BRAVO\nCHARLIE DELTA\n' | claude -p '回覆第二個字' --output-format json
$ # → ~/.claude/projects/<cwd 編碼>/<session-id>.jsonl
$ #   {"type":"user","message":{"role":"user","content":"回覆第二個字\nALPHA BRAVO\nCHARLIE DELTA\n"}}
```

意思是：**任何「委派 `claude` 去分析這份資料」的功能，都會逐次污染它自己分析的資料。**
一趟讀後感的語料是 200 KB，那就是一則 200 KB 的「使用者訊息」——
正是本文件 §一 記錄的「最長 92 萬字元的 prompt 其實不存在」，只是這次是我們自己製造的。

處置有三層，缺一不可（見 `conversation-archive` 的規格）：

1. 委派跑在 userData 之下一個**專屬空目錄**（順帶擋掉 repo 的 `CLAUDE.md` 與 skill 滲進分析）。
2. **掃描與呈現都排除它** —— 只擋來源迴圈救不了已經落地的存檔，因為呈現走 `readArchive()`
   而孤兒政策是原地保留。掃描要**主動刪除**符合排除條件的既有存檔。
3. 排除的判定是「編碼形態**以固定 basename 結尾**」，**不綁單一絕對路徑** ——
   dev 與打包產物的 userData 分家（`spekterm-dev` 對 `Spekterm`）而來源根共用，
   綁路徑的話在 dev 按一次讀後感就會弄髒正式產物的數字，而以「同一個安裝內」為前提的驗收必綠。

**不能用 `CLAUDE_CONFIG_DIR` 把它整個導去別處**（那才是最徹底的隔離）—— 見 §「這份資料是什麼」：
換掉設定目錄會連認證一起換掉。

> **順帶一個獨立的坑**：`content` 可以是**字串**而不是 block 陣列，而真實的 `claude -p`
> 寫出來的正是字串型。產品的 `transcript-extract.ts` 有處理，但
> `transcript-fixture.test.ts` 那份「獨立重算」原本只認陣列 —— 於是任何字串型的使用者記錄
> 都會被它靜默漏掉。**一份漏算的獨立重算比沒有更糟**，它會讓 fixture 的宣告值看起來被驗證過。

## 十二、委派的回覆只依賴少數幾個 JSON 欄位

`--output-format json` 實測有這些可用（同上版本）：`result`（回覆本體）、`is_error` /
`subtype`（成敗）、`session_id`（算出要刪除的紀錄路徑）、`total_cost_usd`、
`permission_denials`（**工具有沒有真的被關掉唯一的偵測訊號**）。

**模型不在清單裡** —— 報告記錄的是「本應用程式請求的模型」，那是我們自己傳出去的值。
實際生效的可能因回退而不同，把推測寫成事實正是要避免的。

**不要依賴 stderr 的文字**：它會隨版本與語言環境改變，而且可能含絕對路徑或帳號資訊 ——
那些會被畫到畫面上。



---

## 讀 transcript 有兩條路，它們不共用生命週期，也不共用投影

`agent-transcript-view` 之後，這個 repo 有兩條讀同一份來源的路徑。**分清楚它們，否則會想把其中
一條改成另一條的樣子。**

| | `transcript-archive`（存檔） | `transcript-follow`（跟進） |
|---|---|---|
| 觸發 | 應用程式啟動、使用者手動 | session 的生命週期 |
| 範圍 | 全部專案 | **單一 session** |
| 增量單位 | **整個來源檔案**（size/mtime 變了就重讀重寫） | **位元組偏移**（只讀追加的那一段） |
| 行程 | 獨立的 utility process（崩潰隔離） | 主行程 |
| 投影 | 計量用的列 | 要**呈現**的內容 |

共用的是「來源格式的知識」與「白名單處理記錄類型」的紀律。**不共用投影。**

### 位元組偏移，不是字元偏移

檔案大小是位元組數。以字元數當偏移，遇到任何非 ASCII 內容就錯位，而錯位之後解析出來的是
**看起來像壞掉的 JSON** —— 徵狀與「來源被改寫」無法區分。未終止的尾段因此以 `Buffer` 保留：
一次讀取的邊界可能落在一個多位元組字元的中間。

### 對話識別碼會變，而自癒不是唯一的原因

實測（2026-09-06、CLI 2.1.263）：**`/clear` 會直接指派一個新的 session id**，於是紀錄換檔；
`/resume`、`--fork-session` 同理。而這些**全部發生在 pty 之內** —— pty 沒死，
`SessionHealed` 不觸發，spekterm 收不到任何自己發出的訊號。

漏掉它的失效**特別惡劣**：跟進器停在舊檔，落進「檔案不存在 ⇒ 等它出現」，於是**永遠等下去**，
而「跟進失敗」也不會觸發（沒有失敗）。畫面就是一份安靜停住的對話。

**正解是不要只靠算**：hook 事件的基底 payload **每一個都帶 `transcript_path`**，而 statusLine
的 payload 也帶它。算出來的路徑是初始值與後備，**事件帶來的才是權威**。

### `SessionEnd` 這個 hook 不代表 session 結束

同一個實測：`/clear` 會發 `SessionEnd`，**而 pty 還活著**（59ms 後緊接著一個帶新路徑的
`SessionStart`）。

把它接上拆除，使用者按一次清空，跟進就此停住 —— 而 session 正常、終端正常、沒有任何錯誤。
**它的正確語意是「這一段對話結束了，接下來可能換一份紀錄」，因此接到「重新定位」。**
拆除只由 pty 的結束觸發。

> **一般形式：一個由可消費串流推導出來的狀態，其生命週期必須綁在被描述的對象上，
> 不能綁在觀察者上。** 等待狀態一度放在「訂閱物件」裡，於是使用者切走再切回時它重設為未知，
> **而重建它所需的事件早已被前一次訂閱讀走並刪掉**（讀完即刪正是去重的機制）——
> agent 那時閒著不再產生事件，狀態就永遠停在未知、輸入框永遠送不出去。

### hooks 的實測結論（2026-09-06、CLI 2.1.263）

- **注入的 hooks 與使用者 `settings.json` 的 hooks 是「合併」不是覆寫**（兩邊都定義
  `SessionStart`，兩個標記檔都出現）。因此**不需要**像 `statusLine` 那樣自己去讀使用者的設定
  來串接 —— 那是單一值才有的問題。
- **`Notification` 不是 idle 的同義詞。** `permission_prompt` 與 `idle_prompt` **都走它**，
  必須依 `notification_type` 分派。不分派的實作會把許可提示讀成「就緒」。
- **許可的 `Notification` 延遲 6 秒才送**（實測 6002ms / 6026ms 兩次），且可被
  `CLAUDE_CODE_DISABLE_PERMISSION_PROMPT_NOTIFY_HOOKS` 關掉。那六秒內狀態仍是上一個值＝忙碌，
  **而忙碌是允許送出的** —— 同一個災難換一條路走進來，且不需要任何實作錯誤。
- **`PermissionRequest` 是權威訊號**：實測早於畫面上的提示 22ms，且**與工具無關**
  （`ExitPlanMode` 走同一個 hook 並帶 `tool_name`）⇒ 不需要維護一張工具清單。
- **`PermissionRequest` 的 payload 不含它呈現給使用者的選項** —— `permission_suggestions` 是
  「要不要改變權限規則」的建議（例如 `{type:"setMode",mode:"acceptEdits"}`）。因此在對話 view
  裡作答只能靠猜終端畫面上的編號，而那正是被禁止的依賴。**規格因此改成「只說正在被問什麼，
  作答回終端 view」。**
- **基底 payload 帶四個以上的絕對路徑**（`transcript_path` / `cwd` / `scratchpad_dir`，
  工具類再加參數裡的檔案路徑）⇒ 送往 renderer 之前的剝除**必須是白名單**，黑名單會在 agent
  新增一個帶路徑的欄位時靜默失效。
- **`Stop` 帶 `last_assistant_message`**，是「剛講完話」的即時訊號。

### 送出的編碼（以讀回紀錄驗證 agent 實際收到什麼）

- **`\n`（0x0A）是訊息內的換行，`\r`（0x0D）才是送出。** 送「多行本文 + `\r`」得到**恰好一則**
  訊息且換行完整保留；**bracketed paste 包與不包結果相同，因此不需要它**。
- **原始控制位元組會讓整則訊息無聲消失** —— 送含 `\x01` / `\x07` / `\t` 的本文再送 `\r`，
  紀錄檔**根本沒有被建立**。失效方向比「訊息被誤解」更難察覺：使用者只會以為自己沒按到送出。
  因此除 `\n` 外的控制位元組一律過濾。

### 注入的 shell 命令：整個 `if…fi` 必須在同一個字串元素裡

把它拆成陣列的多個元素再以 `'; '` 相接，`then` 後面會被塞進一個分號（`then; f=…`）——
**shell 語法錯誤，hook 每一次都失敗**。

而 agent 不會抱怨一個寫壞的 hook：我們只看到一個空的事件目錄、一個永遠「未知」的等待狀態、
一個永遠停用的輸入框，**沒有任何訊息指向真正的原因**。

**一條只斷言「命令字串包含某些片段」的測試擋不住它。唯一擋得住的是執行它**
（`agent-events.test.ts` 以 `sh -c` 真的跑一次，斷言檔案出現、內容正確、`.tmp` 沒殘留）。
