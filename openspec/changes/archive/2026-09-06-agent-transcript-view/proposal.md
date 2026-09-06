## Why

**這個 app 的增量價值宣稱是「一邊駕駛 agent、一邊看著 spec 上下文」，但那句話目前只兌現了一半。**
spec 那一半有一整塊懂 OpenSpec 結構的側欄；agent 那一半仍然是一個 80×24 的字格矩陣 —— 與
「開四個終端機分頁」沒有差別，因為 agent session 與 login shell session 現在的唯一差異，
就是誰打了 `claude` 這行指令。

呈現層被綁死在終端上，代價是**版面無法為 agent 的工作而組成**：工具呼叫、檔案改動、subagent、
plan 與 permission 請求，全部只能以「被終端寬度截斷的字元」呈現，且一捲出 scrollback 就消失。

而這件事**不必**靠解析終端畫面達成。agent 自己會把每一則訊息與每一次工具呼叫寫成結構化紀錄
（`~/.claude/projects/**/*.jsonl`），這個 repo 也**已經在讀它**（`conversation-archive`）——
只是現在是「事後、跨專案、整批掃描」，不是「當下、單一 session、逐則跟進」。

## What Changes

- **pty 不再是唯一的呈現路徑。** agent session 的**內容**改以結構化紀錄為權威來源，pty 繼續
  持有真正的 agent 行程與互動。兩者是同一個 session 的兩種 view。
- **新增 per-session 的紀錄增量跟進**：一個 agent session 建立或喚醒時，spekterm 開始跟進它
  自己那一份紀錄，把新出現的訊息、工具呼叫、結果以結構化事件送給 renderer。
- **新增 agent 事件注入**：以與 `claude-status-bridge` 相同的 CLI 旗標接縫注入 hooks，取得
  「agent 現在在等什麼」——**這是輸入端唯一可靠的閘**（見下）。
- **主舞台上每個 agent session 有兩個可切換的 view**：結構化對話 view 與既有的終端 view。
  終端 view **不得被移除**，它是逃生口。
- **結構化 view 可以送出輸入**（使用者的訊息、以及對 permission／選擇類請求的回覆），經由
  pty 送達 agent。
- **明文的非目標**：SHALL NOT 解析終端畫面以還原語意。這不是實作偏好，是**承重的紀律**
  —— 見下方「為什麼不刮畫面」。
- **不含 subagent 的內容**（實測：它一個位元組都不在主紀錄裡）。subagent 的呼叫在對話 view 上
  會是一則沒有內容的工具呼叫。見 design 的 Non-Goals。

### 為什麼不刮畫面（這條要寫進 spec，不只寫在這裡）

終端 buffer 是「第 3 行第 12 格是個 `●`，顏色是綠的」，不是「這是一則 assistant 訊息」。
生態系有三個專案真的走過這條路：一個必須在自己的 app 裡再養一個 VT100 模擬器、換來 20 餘條
「畫面說 X、事實是 Y」的 issue 與一條至今未關的資料遺失；一個關在 feature flag 後面從未成為
預設，且因為 agent 把回應標記從 `⏺` 改成 `●` 而已經失效；一個公開宣告「與 Claude Code 的
持續更新為敵不可行」後刪除全部程式碼。

**失效方式全部是靜默的**，且與本 repo 既有的教訓同族：ANSI 色碼讓排除規則在有色輸出上靜默
失效（純文字 fixture 照樣全綠）、spinner glyph 少認一個字元讓活著的 frame 對所有偵測器隱形。
沒有一條會有型別錯誤或紅燈。

### 為什麼不走 Agent SDK 或 `-p`

兩者都會**取代**而非增強既有的 pty，代價是把 slash 指令選單、`@` 補全、`/login`、中斷、
貼圖、`--resume` 與 session 自癒全部變成本專案的責任 —— 那是重做一個 TUI，不是這個 app 的
價值命題。另有兩條期限型風險：`--bare` 將成為 `-p` 的預設（屆時不再讀訂閱憑證），以及
Agent SDK 的訂閱額度分池方案目前為「暫停」而非「取消」。

### 輸入端是這個 change 的風險所在

送字進 pty 是容易的；**知道「現在能不能送」不是**。agent 的介面不是只有一個輸入框
——slash 指令選單、`@` 補全、permission 提示、選擇類請求、`/login` 流程都會佔用同一個輸入焦點。
在錯的時機送出，後果不是「沒有反應」而是「答案被打進錯的地方」（已知的真實案例：把
提示文字誤判為人類輸入，兩日內產生 220 餘條偽造訊息，其中包含偽造的批准）。

因此「能不能送」SHALL 由 agent 自己回報的事件決定，SHALL NOT 由畫面推測，而**無法判定時
SHALL 拒絕送出並要求使用者切到終端 view** —— 兩種失敗的代價不對等。

## Capabilities

### New Capabilities

- `agent-transcript-stream`: 單一 agent session 的結構化紀錄跟進 —— 來源定位、增量讀取、
  推送給 renderer 的事件形狀、以及邊界（renderer 不取得檔案系統位置）。與
  `conversation-archive` 的跨專案批次掃描是**兩條獨立的讀取路徑**，共用萃取邏輯但不共用生命週期。
- `agent-event-bridge`: 以 CLI 旗標注入 agent 的 hooks，取得「agent 正在等待什麼」的結構化
  事件；含未啟用、注入失敗、事件遺失時的退回行為。
- `agent-conversation-view`: 主舞台上的結構化對話呈現 —— 呈現什麼、如何與終端 view 切換、
  以及跟不上紀錄時如何**明示**而非假裝完整。
- `agent-input-bridge`: 從結構化 view 送出輸入至 pty —— 送出的閘、無法判定時的拒絕、
  以及對 permission／選擇類請求的回覆。

### Modified Capabilities

- `claude-status-bridge`: 現在有**兩個**功能經由同一個 CLI 旗標接縫注入設定。既有條款只描述
  單一注入，需要加上「多個注入合成為同一份設定、各自的啟用狀態獨立、任一注入不得使另一個失效」
  —— 以及既有的「不得取代使用者原有設定」保證必須同樣涵蓋 hooks。
- `session-persistence`: 「休眠狀態 SHALL 被明確地呈現，SHALL NOT 呈現為一個空白的**終端**」
  —— 對話 view 之下，一個空白的**對話**是同一個錯誤的另一種長相。
- `workspace-layout`: 「切換 focused session」的既有 scenario 斷言「終端顯示其內容」——
  該 session 的當前 view 為對話時，那句不再成立。

- `terminal-sessions`: 「程式化繪製的渲染資源僅供當下顯示的終端」目前只涵蓋顯示↔隱藏與銷毀
  三種轉換。**切換 view 是第四種**（保有版面盒子、失去可見、不銷毀、不失去掛載），而該條款
  自己就寫著「銷毀是獨立於顯示↔隱藏之外的第三種轉換，因此需要各自的條文與各自的驗收」——
  同一個理由在此適用。理由見 design D9。

> **尺寸那一條反而不必改** —— 「終端尺寸變化時 pty 尺寸同步」以「有沒有版面盒子」為判準，
> 而對話 view 在上層時終端仍保有盒子。**同一條 capability，一條要改一條不要改**，判準不同。

## Impact

- **主行程**：新增紀錄跟進服務（`src/main/transcript-*` 之外的另一條路徑，共用萃取）、hooks
  注入與事件接收（`src/main/agent-status.ts` 的 `--settings` 接縫需一般化）、
  `src/main/terminal.ts` 的 spawn 與尺寸來源。
- **renderer**：主舞台新增一個 view 與其切換入口（`MainStage.tsx`、`terminal/sessions.tsx`）；
  結構化對話的呈現元件；輸入元件。
- **既有邊界**：`conversation-archive` 的「內文不整批送往 renderer」與「renderer 不取得來源的
  檔案系統位置」兩條**必須在新路徑上同樣成立** —— 新路徑是 per-session 且是 live 的，
  作用域不同，但邊界語彙不變。
- **文案與 i18n**：新 view 的每一個字串進 `src/shared/i18n/en.json`；`aria-label` 同時是探針的
  選擇器。
- **快捷鍵**：新 view 帶來一個不在 `.xterm` 之內的輸入元件 —— 既有「排序快捷鍵於可編輯文字
  持有焦點時不生效」的兩段式判準已涵蓋它，預期無需 delta，由 design 確認。
- **驗收**：需要一支新探針或既有探針的新段落；紀錄跟進與 hooks 皆需可注入的替身
  （真實 agent 委派刻意不進探針的既有理由同樣適用）。
- **相依**：無新增 npm 相依。
