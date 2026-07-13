## Context

session 狀態目前是**純記憶體**的：`SessionsProvider`（`src/renderer/src/shell/terminal/sessions.tsx`）
以 `useState` 持有 `SessionState[]`，`workspace.json` 只存 folder 清單。關掉 app、或 renderer
reload（`did-navigate` → `TerminalService.dispose()`），pty 被殺、狀態一併蒸發。

pty 死掉是**物理必然**：master fd 由主行程持有，app 一死，slave 收到 SIGHUP，底下的行程跟著死。
但「使用者建立了哪些 session」是**使用者親手做的事實**，沒有理由跟著 pty 一起消失。本 change
把那些事實存下來，並在重開時把 session **重建**（不是重連 —— 重連需要常駐，見 proposal）。

### 四項實測（全部左右了下面的決策）

1. `claude --session-id <uuid>` 可由我們指定對話 id；`claude --resume <uuid>` **沿用**原 id
   （`--fork-session` 才換新）。
2. `claude --resume <不存在的 id>` → 印 `No conversation found with session ID: …`、**exit 1**，
   **不會**默默開一個空對話。
3. **`claude --session-id <已存在的 id>` → `Error: Session ID … is already in use.`**
   —— 於是 `claude --resume X || claude --session-id X` 這種自癒寫法**是個陷阱**：claude 若因其他
   原因非零退出（使用者 Ctrl+C、API 錯誤），`||` 會觸發第二條並撞號，換來一則看不懂的錯誤。
4. **開了 claude session、還沒跟它講話就關掉 → claude 根本不寫 transcript**（實測：互動啟動、
   4 秒後殺掉，`~/.claude/projects/` 下沒有任何檔案），因此 `--resume` 必定失敗。
   **這不是邊角，是主線情境**（開個分頁準備等一下用）。續接失敗的處理不能當成例外路徑草草了事。

## Goals / Non-Goals

**Goals**

- session 跨「關閉並重新開啟 app」與「renderer reload」存活：分頁、使用者取的名字、順序、
  錨定的 change 全部原樣回來。
- claude 目標**真的續上對話**；續不上時**自癒**成一個全新的 claude，而不是留下一個死掉的分頁。
- shell 目標於**最後已知的工作目錄**重生，並以終端畫面快照還原「上次做到哪」。
- 重開時**只自動 spawn 一個** session（上次選中的 folder 的 focused session），其餘**休眠待喚醒**
  —— 見 D11。
- 持久化檔案自身的損毀不得讓 app 開不起來。

**Non-Goals**

- **不讓 pty 活過 app 的生命**（常駐）。理由與代價見 proposal；`terminal-sessions` 的
  「三路徑皆不留孤兒」不變式**原封不動**。
- 不救 shell 的行程狀態（環境變數、跑到一半的 build）—— 那是重生，不是續接，本 change 明確接受。
- 不做多視窗。持久化是 app 層的，而 `TerminalService` 是 per-`webContents` —— 見 D13。

## Decisions

### D1：spekterm 的 session id 與 claude 的對話 id **解耦**（兩個欄位）

直覺會想把兩者綁死（主行程本來就用 `randomUUID()` 產 sessionId，直接拿去當 `--session-id` 很美）。
**但實測 3 + 4 讓「換號」變成必要能力**：續接失敗時我們必須以一個**全新的** uuid 開一個新對話
（沿用舊 id 會撞上 `already in use`），而如果兩者是同一個欄位，換號就等於換掉 spekterm 的 session
identity —— renderer 的分頁 key、focused、順序、錨定全部要跟著搬。

所以持久化的每個 session 有兩個識別碼：

- `id` —— spekterm 的 session identity，**永不改變**（分頁、focus、順序、錨定都掛在它身上）。
- `claudeSessionId` —— 交給 claude 的對話 id，**可被替換**（僅 claude 目標有）。

換號時 renderer **完全無感**。放棄「一對一綁死」的美感，換來可換號的自由。

### D2：續接策略 —— 一律 `--resume`，快速非零失敗就以**全新 uuid** 重試一次

```
新建（claude）：$SHELL -l -c "claude --session-id <新 uuid>"
重建（claude）：$SHELL -l -c "claude --resume <claudeSessionId>"
    └─ 若 pty 在 T 秒內以非零碼結束 → 判定為續接失敗
       → 產生全新 uuid → $SHELL -l -c "claude --session-id <新 uuid>" → 更新持久化
       → 只重試一次
```

**為什麼不改成「先檢查 transcript 檔在不在」？** 那需要複製 claude 的內部佈局規則
（`~/.claude/projects/<cwd 的 / 換成 ->/<id>.jsonl` —— 實測 `/tmp` → `-tmp`）。它會隨 claude 版本
變，而且**降級方向是壞的**：佈局一旦改動，我們會誤判「transcript 不存在」→ 用 `--session-id <舊 id>`
→ 撞上 `already in use` → session 死掉。

重試法**零 layout 依賴**，且降級方向是安全的：resume 失敗 → 用**全新** uuid → 永遠不可能撞號。
代價是終端上會先出現一行 `No conversation found with session ID: …`，然後才起一個新的 claude。
**這行字是誠實的**（確實沒有對話可續），留著。

判準用「時間 + 非零結束碼」而不是解析輸出 —— 不去 parse 別人的錯誤訊息。若 claude 根本沒安裝，
第一次與重試都會快速失敗，第二次不再重試，session 依既有 requirement 呈現為已結束、訊息留在終端上。

### D3：claude session **不存** scrollback，shell session 才存

使用者確認 `claude --resume` 在互動模式下**會自己把過去的對話重畫在終端上**。若我們再重播一次
自己的快照，使用者會看到**兩份**歷史。所以：

| spawn 目標 | 續接手段 | scrollback 快照 |
|---|---|---|
| `claude` | `--resume`（真的續對話） | **不存、不重播** |
| shell | 於最後 cwd 重生（狀態救不回來） | **存、重播** |

順帶省下絕大部分的快照 IO —— 一直在吐字的正是 agent。

### D4：快照走「滾動 debounce」，不倚賴關窗時的同步往返

xterm 的 buffer 活在 renderer，主行程拿不到。若只在關窗時才向 renderer 要快照，就得在 `close`
事件裡 preventDefault + 等一次 IPC 往返 —— renderer 一卡，關窗就卡住；而且 **crash 或斷電時
什麼都留不下**。

改為：**renderer 在 pty 有新輸出後 debounce 2 秒，主動 serialize 並送出快照**（`@xterm/addon-serialize`
的 `serialize({ scrollback: N })`）。關窗時再做一次 best-effort 的 flush（有 timeout；即使拿不到，
最多也只丟失 2 秒的畫面）。**同步往返因此不在必要路徑上。**

- 快照**不進 `sessions.json`**（那會讓 metadata 檔漲到 MB 級且每次都要整份重寫）——
  每個 session 一個檔：`<userData>/sessions/<id>.scrollback`。
- 上限：`serialize` 只取最後 **1000 行**；若結果仍超過位元組上限（**256 KB**），保留**尾端**，
  且切點落在**換行之後**（從位元組中間切開會把一段 escape sequence 攔腰斬斷）。被切掉的 SGR 狀態
  不再有效，但重播完的模式重置會把它收乾淨（D6）。
- 清理：關閉 session 時刪掉對應快照；啟動時刪掉**沒有對應 session 的孤兒快照檔**。

### D5：重播的內容必須被標示為「歷史」

重播進 xterm 的字**不是**那個 pty 產生的 —— 新 shell 對它一無所知。若不標示，使用者會以為那個
shell 還活著（去找背景 job、以為 `cd` 過的狀態還在）。因此重播的畫面與 live 之間插入一條**視覺上
可辨識的分隔**（意義為「以上是上次的內容，app 已重新啟動」）。**這是誠實性，不是裝飾。**

### D6：重播由終端自己處理，且**必須在接上 live 之前完成**

> **實作時修正**：原本設計是「把快照當成一段文字塞進既有的 backlog 最前面」，靠 Phase 4 的
> 「pty 輸出先進 backlog、xterm 掛載時先 flush 再接 live」機制天然保證順序。**那個設計是錯的** ——
> 重播不是「寫一段文字」那麼簡單：快照裡帶著終端**模式**與**游標定位**，直接寫進去會把畫面弄壞
> （見 Risks 的第一條）。它必須由 xterm 的 wrapper 自己處理。

重播是 `XtermHandle.replay(history, separator, done)`：寫入歷史 → 依當下的緩衝區狀態決定要不要離開
alternate screen → 重設模式 → **把游標挪到內容之後**（只用相對移動）→ 寫入分隔 → 才呼叫 `done`。

**呼叫端在 `done` 之後才 `attach()`**，於是「歷史 → 分隔 → pty 的第一個輸出」的順序仍然由既有的
backlog 機制保證（pty 的輸出一直在 backlog 裡等著）—— 改變的只是「誰負責寫歷史」，不是排序的原理。

### D7：cwd 由**主行程**追蹤，且**夾制在 folder 邊界內**（renderer 的邊界語彙不動）

shell 重生要回到最後的工作目錄（使用者 `cd` 過），不是初始的 folder 根目錄。

- **取得**：主行程 `readlink /proc/<pty.pid>/cwd`（Linux，零外部行程 —— 與 `repo-branch` 讀
  `.git/HEAD` 同一條紀律）。macOS／Windows 沒有 `/proc`：**優雅降級為 folder 根目錄**
  （**不 spawn `lsof`**）。跨平台缺的只是便利，不會壞。
- **夾制**：重建時的 cwd 必須落在該 folder 的邊界內（沿用 `isWithin` 的既有判定）。使用者若
  `cd /etc` 之後關掉 app，重開回到 folder 根目錄。
- **renderer 從頭到尾沒有 cwd 的詞彙**：它送去持久化的 payload **不含 cwd**，主行程自己補、自己
  讀、自己夾制。`terminal-sessions` 的「renderer SHALL 僅以 `folderId` 指定位置、SHALL NOT 傳遞
  任何路徑」**完好無損** —— 若接受 renderer 送來的 cwd，等於把一個路徑詞彙交還給它，整個邊界論證
  就破了。

> **這一條使 `terminal-sessions` 需要一則 MODIFIED delta**：「初始工作目錄 SHALL 為該 folder 的
> **根目錄**」的字面約束，要放寬為「SHALL 落在該 folder 的**邊界內** —— 新建為根目錄，重建為其
> 最後已知的工作目錄（取不到或越界則退回根目錄）」。**proposal 原本寫「Modified Capabilities：無」
> 是錯的**，已回頭修正。

### D8：磁碟上的識別碼是**不受信任的輸入** —— 拼進 shell 命令前必須驗證

claude 目標的 spawn 是 `$SHELL -l -c "claude --resume <id>"` —— 一個**字串拼接**。新建時的 id 來自
`randomUUID()`（安全），但**重建時的 id 來自磁碟上的 `sessions.json`**。一個被竄改或損毀的檔案就
能把任意命令送進 `-c`。

因此：`claudeSessionId` 在被拼進命令前 SHALL 以嚴格的 UUID 格式驗證，不符即**丟棄該 session 的
續接資訊**（以全新 id 重建）。這與 Phase 5 的「`slug`／`topic` 是不受信任的輸入 —— 查表，不要過濾
字元」同源：**識別碼的信任不因為它來自我們自己寫的檔案而自動成立。**

`id`（作為快照檔名 `<userData>/sessions/<id>.scrollback` 的一段）同樣以 UUID 格式驗證 —— 否則它就是
一個 path traversal 的入口。

### D9：誰寫檔 —— renderer 供事實、主行程補 cwd 並落盤

session 的真相在 renderer（名字、順序、錨定都由使用者在 renderer 上建立）。

- renderer 於狀態變更時，經 IPC 送出整份 session 清單（**不含 cwd、不含任何路徑**），主行程
  debounce ~500ms 寫入 `sessions.json`（metadata 很小，整份重寫很便宜）。
- 主行程在落盤前**驗證**每一項（`folderId` 必須對應已加入的 folder、`id` / `claudeSessionId` 必須
  是 UUID、`spawnTarget` 必須是兩個列舉值之一），並**自行補上 cwd**（D7）。
- renderer 啟動時呼叫一次 restore，取回 metadata + 各 session 的 scrollback。

### D10：`sessions.json` 的損毀韌性 —— 兩層

比照 `workspace-store.ts`：版本欄位 + 原子寫入（`.tmp` → `rename`）+ 損毀隔離。

- **整份**解析失敗／版本不符 → `quarantine` 成 `sessions.json.corrupt-<ISO>`（保留不刪），
  以空清單啟動。**任何讀取失敗都不得讓 app 開不起來。**
- **個別項目**欄位不符 → 丟棄**該項**並記錄，其餘照常重建。一個壞掉的 session 不該讓所有 session
  一起消失。

### D11：**休眠**是一個一等的 session 狀態；spawn 發生在「首次被顯示」時

重開時若把每個 session 都 spawn 起來，就是同時啟動 N 個 claude —— 每個要數秒、吃記憶體，
session 一多，重開 app 會有一段明顯的忙碌期。而那些 session **本來就是死的**（app 關掉時 pty 就沒了），
喚醒它們只是讓一堆 claude 閒置在那裡。**懶惰嚴格地更好。**

規則只有一條：**休眠的 session 於首次被顯示時 spawn。**

一個 session 只有在「它所屬的 folder 被選中 **且** 它是該 folder 的 focused session」時才會顯示。
於是**至多只有一個** session 被顯示 ——「只自動 spawn 一個」不是另一條特例規則，是這條規則的自然結果。
使用者切到哪個 repo、點到哪個分頁，那個 session 才醒過來。

> **驗收時修正**：這裡原本寫的是「啟動當下**恰好**只有一個 session 被顯示（**上次選中的 folder** 的
> focused session）」—— **那個前提不成立**：選中的 folder 從來沒有被持久化（`useWorkspaceFolders` 的
> `selectedId` 初始為 `null`），所以冷啟動當下**一個 session 都不會醒**，要等使用者先點一個 repo。
> 不變式（「至多一個，且只有被顯示的那個」）是對的，是那句話**過度宣稱**了。
>
> **持久化「上次選中的 folder」是一個合理的後續項目**（重開 app 直接回到上次待的地方），但它屬於
> workspace 的狀態、不屬於 session 的持久化 —— 不在本 change 硬塞。

因此 session 的狀態多一個值：**`dormant`**（已重建、有身分與畫面，但**沒有 pty**）。它與 `running`
／`exited` 並列。既有的 `terminal-sessions` 從未要求「每個 session 恆有一個 pty」（那只是 Purpose
的敘述），故此狀態不與其任何 requirement 衝突 —— 但 sync 時該段 Purpose 的措辭要一併校正。

**休眠的 claude 分頁必須有東西可看。** D3 決定 claude 不存 scrollback（`--resume` 會自己重畫對話），
於是一個休眠的 claude 分頁**沒有任何歷史畫面可重播** —— 絕不能就丟給使用者一塊空白終端（那看起來
像壞掉）。休眠態因此是一個**明確的呈現狀態**，而非「一個還沒有輸出的終端」：

| spawn 目標 | 休眠時看到什麼 |
|---|---|
| shell | 重播的歷史畫面（見 D5 的分隔線）+ 可喚醒的明確提示 |
| `claude` | 「休眠中 —— 顯示即恢復對話」的明確提示（沒有歷史可播，也不假裝有） |

**休眠的 session 仍然完整地被持久化**：使用者一路沒喚醒它就再次關掉 app，下次它照樣在
（metadata 與快照都不因未喚醒而失效）。

folder 已被移出 workspace → 該 session 從持久化移除；folder 路徑失效（`status !== 'ok'`）→
**保留 metadata 但不可喚醒**（使用者修好路徑後重開，session 會回來）。

### D12：reload 的快照必然略舊 —— 而且這幾乎不會發生

`did-navigate` 是**導航之後**才觸發，那時舊 renderer 的 xterm buffer 已經沒了，來不及序列化 ——
reload 後重播的是最近一次 debounce 的快照（最多舊 2 秒）。可接受。

而且真實使用中 reload 幾乎不會發生：**頁面發起的導航（含 `location.reload()`）會觸發 `will-navigate`，
而導航防護無條件 `preventDefault()` 它**。reload 主要出現在探針（CDP 的 `Page.reload`，瀏覽器層發起，
不走 `will-navigate`）。metadata 走的是同一條 debounce 寫入，因此 reload 後分頁、名字、順序、錨定
照樣完整回來。

### D14：pty 的環境必須抹掉「巢狀 Claude Code」的標記 —— 否則整個續接功能靜默失效

**這是 dogfooding 第一次重開 app 時抓到的，而且它偽裝成「功能正常」。**

spekterm 若由一個 agent 啟動（`npm run dev` 是 agent 幫忙跑的 —— dogfooding 時的常態），Electron 會
繼承那個 Claude Code session 的環境變數，pty 再整份繼承下去。於是裡面每一個 `claude` 都認為自己是
**巢狀的子 session**，而**巢狀的 claude 不寫 transcript**（實測：對話真的發生了、claude 也回覆了，
但 `~/.claude/projects/` 底下什麼都沒有）。

後果：`--resume` **必然失敗** → 自癒接手 → 使用者拿到一個**能用的** claude，只是對話永遠是全新的。
**沒有錯誤訊息、沒有紅燈、探針也抓不到**（探針用的是 stub claude，它不管 env）。**最糟的那種 bug ——
它看起來像正常運作。**

- **元兇是單一一個變數**（二分實測）：**`CLAUDE_CODE_CHILD_SESSION`**。單獨拿掉 `CLAUDECODE` 或
  `CLAUDE_CODE_ENTRYPOINT` 都**無效**。其餘一併移除，是因為它們表達的是同一件事（「這個行程隸屬於
  某個 Claude Code session」），而那對 spekterm 的 pty 一律不成立。
- **絕不以 `CLAUDE*` 前綴一概剝除** —— `CLAUDE_CODE_OAUTH_TOKEN` 是認證用的。名單明確列舉，且不含
  任何帶 KEY／TOKEN 的名字。
- **副作用很小**：使用者自己在 `~/.zshrc` 設定的變數不受影響 —— 我們 spawn 的是 **login shell**，
  它會重新 source 那些檔案。這裡拿掉的只有「啟動 spekterm 的那個行程注入的」。
- **兩種 spawn 目標都適用**：使用者在 login shell session 裡手動打 `claude`，踩的是同一個坑。

> **原則上這也是對的，不只是為了修 bug**：spekterm 裡的終端是一個**頂層**終端，不是啟動它的那個
> 行程的延伸。把「你正跑在一個 Claude Code session 裡」洩漏進去，本來就是錯的。

### D15：pty 誕生的那一刻要把終端當下的尺寸告訴它（喚醒倒轉了順序）

**dogfooding 抓到的**：resume 之後 claude 的畫面「縮成一小塊」，手動拖動視窗才恢復。

`fit()` 在「尺寸沒變」時回 `null`。喚醒時：終端由隱藏轉為顯示 → `active` 的 effect 先跑（子層的
effect 早於父層的 `wake`）→ `fit()` 成功量到真實尺寸 → 送出 resize → **pty 還不存在，主行程丟掉** →
而 `lastCols` 已記成該尺寸，之後 ResizeObserver 的 `fit()` 一律回 `null` → **pty 一輩子停在 80×24**。

新建的 session 不會踩到（pty **先**誕生、終端**後**掛載 `fit()`）。**喚醒把這個順序倒了過來。**

修法：`status` 轉為 `running` 時，以 `XtermHandle.size()`（不做變化偵測 —— `fit()` 回答不了這個問題）
把當下尺寸推給 pty。

> **探針證明不了它（對照組確認）**：走不走到上面那條路取決於 xterm 何時量到字元尺寸，而探針一直走
> 另一條（`fit()` 當下回 `null` → ResizeObserver 事後補救成功）。留下的斷言只擋「完全沒有人告訴 pty
> 尺寸」的回歸。比照 OSC 8 `linkHandler` 的先例，此缺口由 code review + 本決策承擔。

### D13：已知限制（明確接受，不假裝解決）

- **已結束（`exited`）的 session 不持久化**（使用者裁決）。重開時它們不會回來。
- **`/clear` 之後的對話 id 會失準**：使用者在 claude 裡 `/clear`，claude 內部換一個新的 session id，
  我們存的 `claudeSessionId` 仍指向清空**前**的對話 —— 重開會把已清空的對話 resume 回來。
  **明確接受。** 要偵測它，唯一的路是安裝 claude 的 `SessionStart` hook 去讀 `session_id` ——
  那要**寫進使用者自己的 `~/.claude/settings.json`**，對一個桌面 app 來說是不成比例的侵入。
  代價（偶爾 resume 到一份你以為已經清掉的對話，`/clear` 一次即可）遠小於那個侵入。
- **單視窗**：持久化是 app 層的，`TerminalService` 是 per-`webContents`。多視窗會讓兩個視窗互相
  覆寫 `sessions.json`。本 app 目前只開一個視窗；日後要做多視窗時，這裡必須重新設計。

## Risks / Trade-offs

- **懶惰喚醒把成本從「重開 app」挪到「切換 repo」**。切到一個沒喚醒過的 repo 時，那個 claude 要
  數秒才起得來 —— 使用者會感覺到。但那個等待本來就躲不掉（他正要用它），而且它取代的是「重開
  app 時所有 repo 的 claude 一起搶 CPU」。**把延遲移到使用者真的需要那個 session 的時刻，是對的
  取捨。**
- **「首次被顯示就 spawn」使得瀏覽變得有副作用**：使用者只是切過去看一眼某個 repo，就會啟動一個
  claude。這是刻意的（切過去通常就是要用），但若 dogfooding 發現「路過」很常見，退路是把喚醒
  改為需要一次明確的互動（點終端／按鍵）—— **純呈現層的改動**，不影響持久化與續接的設計。
- ~~**serialize 的輸出可能讓終端進入奇怪狀態**~~ —— **已實測，而且它真的會**（見下）。`SerializeAddon`
  **會把終端模式一起序列化**：使用者關 app 時正開著 vim，快照裡就有 `\x1b[?1049h` 與 `\x1b[?1003h`。
  重播完之後我們**就站在 alternate buffer 裡**，新的 shell 於是跑在 vim 的畫面上（歷史全部看不見、
  沒有 scrollback）。

  **緩解不是「重播前 reset」**（`?1049h` 在歷史的**中間**，事前 reset 毫無作用），**也不是「重播後
  無條件 reset」**（`?1049l` 會還原「進入 alt screen 當下所存的游標」—— 沒進去過時那是 (0,0)，游標
  被拉回左上角，分隔線與 live 的 prompt 於是蓋掉歷史）。正解是**條件式**：重播完之後，只有
  `term.buffer.active.type === 'alternate'` 時才送 `?1049l`。不動游標的重置（滑鼠追蹤、SGR）則無條件送。
- **依賴 `claude` CLI 的旗標語意**（`--session-id` / `--resume` / 非零結束碼）。claude 若改變這些
  語意，續接會壞。緩解：只用公開旗標、不解析輸出、且**失敗路徑是安全的**（永遠退到「開一個全新的
  claude」，不會撞號、不會留下死掉的分頁）。
- **shell 的狀態是真的救不回來的**。畫面還原會讓它「看起來像還在」—— 這正是 D5 那條分隔線存在的
  理由。若分隔線做得不夠明確，這個功能會變成一個誤導使用者的陷阱。
- **`/proc` 是 Linux-only**：macOS／Windows 上 shell 一律重生於 folder 根目錄。本 repo 目前只有
  Linux 實測，這與 Phase 6 打包驗收前要確認的既有項目（`O_NOFOLLOW` 的 Windows 退路）同一類。

## Open Questions

- ~~**重播前的終端 reset 要多強**~~ —— 已解決，但答案與問題的預設不同：**reset 不能寫在重播「之前」**
  （`?1049h` 在歷史的中間），而且**不能無條件送**（`?1049l` 會把游標拉回 (0,0)）。見 Risks 的第一條與 D6。
- **快照的位元組上限**取 **256 KB**（`serialize` 先以 1000 行為上限；仍超過位元組上限時保留尾端，
  且切點落在換行之後）。這是個保守的猜測值 —— dogfooding 後再調。
- **`RESUME_FAILURE_WINDOW_MS` 取 3 秒**（D2）。一個「續接成功後在 3 秒內崩潰」的 claude 會被誤判為
  續接失敗，於是自癒成一個全新的對話，舊對話的指標就此遺失（那份對話仍在磁碟上，使用者仍可在 shell
  裡 `claude --resume` 用選單找回來）。窗口取得短是為了壓低誤判的機率，但**它消不掉**。
