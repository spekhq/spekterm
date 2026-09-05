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
