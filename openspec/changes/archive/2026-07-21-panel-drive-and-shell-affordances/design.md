## Context

側欄與 session 之間，目前只有**一個方向**通：側欄跟隨 focused session（`side-panel-repo-anchor`
的側欄來源、`openspec-panel` 的錨定 change）。反向從未打通 —— 側欄對 session **無法發話**。
本 change 第一次打開那個方向，其餘三條是同一輪 dogfood 的殼層小毛病。

現況中與本設計相關的既有事實（皆已查證）：

- `window.workspace.terminal.write(sessionId, data)` **已存在**，是 renderer → pty 的單向
  fire-and-forget 注入；`TerminalView` 就是用它把使用者的每一個按鍵送進 pty。
- `SessionState` 帶有 `spawnTarget`（`claude` / `shell`）與 `status`（`running` / `dormant` /
  `exited`）；`SessionsApi` 已能取得 focused session、其錨定 change 與側欄來源。
- 側欄手上的 `ChangeInfo` 已含 `hasProposal` / `hasDesign` / `hasSpecs` / `hasTasks`
  —— **判斷「還缺哪些 artifact」不需要任何新的 IPC 或掃描**。
- `docs/workspace-mockup.html` 已定義 `.statusbar`（26px、底部、等寬、分段、faint 色，
  首段 accent），但**從未實作**；雛型裡的內容是佔位（`UTF-8`、`spek ws 0.1`）。
- 兩道會咬人的既有守衛：**產品原始碼的字串字面值不得含 CJK**（`copy-language.test.mjs`）、
  **`aria-label` 不得硬編**（它同時是 6 支 probe 的選擇器）。

外部事實（讀 `~/.claude/skills/openspec-continue-change/SKILL.md` 查證）：`/opsx:continue`
會讀 `openspec status --change`、挑**第一個 `ready`** 的 artifact、產生**恰好一個**、然後停；
**未指定 change 名稱時，它必須反問使用者**（skill 明文：「Do NOT guess or auto-select」）。

## Goals / Non-Goals

**Goals:**

- 讀完一個 artifact 之後的下一個動作，**留在使用者視線所在的那塊面板上**，不必切回終端重打。
- 補上雛型早已定義、卻從未實作的 statusbar，並讓它**取回被終端寬度截斷的那些脈絡** ——
  spekterm 第一手知道的欄位由自己供應，只有 agent 算得出來的（context 用量、花費、rate limit）
  由 agent 自己交出來（D9）。
- 讓選單的關閉不再倚賴一條對「父層有沒有同步 re-render」敏感的環境路徑。

**Non-Goals:**

- **不解析終端畫面來還原 claude 的 statusline**，也**不解析它的 transcript**（見 D9）。
- **不搶終端的左鍵、不做 claude 的 IDE 整合** —— 那是本輪 #4 的出路，需獨立論證（見 proposal）。
- **不做一個通用的「側欄送任意 prompt 給 agent」機制**。本 change 只交付一個具體動作；
  通用化要等第二個真實用例出現。

## Decisions

### D1 — 送出的是 slash command `/opsx:continue <slug>`，不是自然語言

使用者原話是按鈕按下去輸入「繼續寫 design」。**改送 slash command，三個理由：**

1. **它的行為已經精確吻合那個需求。** `/opsx:continue` 產生**恰好一個** artifact 然後停 ——
   正是「proposal 寫完停下來給人看」的節奏。自然語言要靠 agent 去理解出同一件事。
2. **帶上 slug 省掉一次往返。** 不帶 change 名稱時該 skill **必須反問**「要哪一個 change」——
   那正是我們要消滅的來回。側欄手上就有錨定的 slug，直接給它。
3. **它繞開了語言問題。** 那串是 ASCII 命令，不是文案：不撞 CJK 守衛，也不該進英文 UI 字典
   （字典是**使用者介面**的文案，而這串是**給 agent 讀的**）。

**替代方案與否決理由：**

- **自然語言（「繼續寫 design」／`Continue with design`）** —— 撞 CJK 守衛，且逼出一個沒有好答案
  的問題：該用哪種語言？UI 是英文，但使用者對 agent 打字用中文。**這個問題之所以難，是因為它
  問錯了** —— 送出的根本不需要是自然語言。
- **把指示放進 `en.json`** —— 它不是 UI 文案。放進去等於宣告「使用者的 agent 該讀英文」，
  而字典的既有語意是「app 介面的語言」，兩者混在一起會讓字典失去單一意義。
- **做成使用者可設定的模板** —— v1 不做。D2 的「填入不送出」已經是逃生口，再加一個設定面
  是為一個尚未出現的需求付款。

**風險：這綁定了 `opsx` 這組 skill 存在。** 緩解正是 D2。

### D2 — 直接送出（文字 + `\r`），並把焦點交給終端

按下入口後，把那串文字**連同 `\r`** 寫進 pty，然後聚焦終端。一次點擊完成整件事。

**這一條推翻了本設計的第一版（原本是「填入、不自動送出」），因為那個版本的理由站不住腳。**
當時的論證是「填入避免把**錯的 change／錯的 session／opsx 不存在**三種失敗變成不可撤回」——
但逐條檢查後，前兩種**根本不存在**：

- **錯的 session**：D3 已經把目標釘死在 focused session 上。
- **錯的 change**：slug 就是側欄當下呈現的那一個，也就是使用者正在看的那一個。

只剩「`opsx` 不存在」，而它的爆炸半徑是 **claude 回一句看不懂的話** —— 沒有檔案被改、沒有狀態被
破壞。**「不可撤回」這個說法要成立，得先問撤不回來的是什麼**；為了一則無害訊息而向使用者多收
一次 Enter，是把謹慎用在錯的地方（這與 `session-title-authority` 移除確認對話框是同一種錯誤的
兩個面向：那次是問了不該問的問題，這次是為不值得的風險加了一道手續）。

- **焦點仍必須交還終端** —— 既有教訓：`terminal-clipboard` 實測過「自選單貼上後按 Enter 不會執行，
  因為焦點還在選單上」。送出後使用者要能立刻接著跟 agent 對話，不必再點一次終端。
- **payload 是單行文字 + `\r`，不需要 bracketed paste**（那是多行貼上才需要的，避免第一個換行就
  提前送出）。直接寫進 pty 即可。

**D1 的綁定風險不再由這一條承擔。** 若 `opsx` 日後不在，改動是**一行常數**，而且失敗是**可見的**
（claude 當場回報不認得該命令，不是靜默失效）。**不為此預先做一個設定面** —— 等它真的痛了再說。

### D3 — 入口只在「側欄來源 ＝ focused session 自身 folder」且該 session 是 running 的 claude 時可用

**這不是語意潔癖，是它真的會出錯。** 側欄來源可以指向別的 repo（`side-panel-repo-anchor`），
而 claude 的 cwd 是它自己那個 repo：把 repo B 的 slug 送進 repo A 的 claude，
`openspec status --change <slug>` 直接找不到；**更糟的是兩個 repo 恰有同名 change 時，
它會在錯的 repo 動手**。

同理，`spawnTarget` 必須是 `claude`（shell 收到 `/opsx:continue` 只是一個 command not found），
`status` 必須是 `running`（`dormant` 沒有 pty 可寫，`exited` 更不用說）。

**不可用時停用入口並說明原因，而不是讓它消失。** 消失會讓人以為功能壞了或不存在；停用＋說明
才讓使用者知道「怎樣它才會亮」。（先例：活動列以停用狀態呈現尚未實作的入口。）

**同一個 repo 有多個 running 的 claude 時，不構成歧義 —— 而且不需要任何新規則。**
因為**錨定的 change 是 per-session 的**（`openspec-panel`：側欄跟隨 focused session 的錨定
change），側欄當下呈現的那個 change，正是 focused session 錨定的那一個。於是：

- 目標**恆為 focused session** —— 也就是**畫面上那個終端**。兩個 claude 都在跑也沒有歧義：
  畫面上只有一個，而它就是錨定了畫面上這個 change 的那一個。
- **送出的結果在視覺上自明** —— 那行字會出現在旁邊那個終端裡。因此**不需要任何「送給了誰」的
  提示或確認**：使用者當場就看得到。
- **若 focused 的是 shell，而同 repo 另有 running 的 claude：入口仍然停用，不改送給那個 claude。**
  對一個使用者沒在看的終端靜默發話，比停用更糟 —— 他會不知道那句話跑去哪了，而 agent 已經開始動手。

### D4 — 一顆按鈕，不是每個缺的 artifact 一顆

使用者原話是「多**幾個**按鈕」。**但 `/opsx:continue` 一次只產生一個，且由它自己挑** ——
排四顆按鈕會承諾一個它給不出的選擇：按下「specs」那顆，實際寫出來的可能是 design。
**一個按鈕承諾了它做不到的事，比少一個按鈕更糟。**

- 「還缺哪些」由 `ChangeInfo` 的 `has*` 四個旗標判定（側欄已有這份資料，零新增 IPC），
  以次要文字列在按鈕旁。
- **但「下一個會是哪一個」不由我們算。** readiness 取決於 schema 的依賴規則（`specs` / `design`
  依賴 `proposal`、`tasks` 依賴兩者），而那份權威在 openspec 的 schema 裡。側欄複製它，
  就是複製一份**會過期**的規則。標籤只誠實說「還缺哪些」，挑選交給 opsx。

### D5 — 不新增 IPC，但新增一個薄的 renderer 介面

`terminal.write` 已存在且語意正好。但目前**只有 `TerminalView` 直接呼叫
`window.workspace.terminal.write`**，側欄若也直接呼叫，等於多開一個繞過 sessions provider 的
入口。改為在 `SessionsApi` 上加一個薄包裝（送文字 + 聚焦），讓「誰可以對 pty 寫入」仍然只有
一個彙集點。

### D6 — statusbar 呈現 focused session 的脈絡，且不照抄雛型的佔位內容

**欄位**：repo · git 分支（含 dirty 標記與 worktree 名）· **pty 當下的 cwd** · session 標籤與狀態 ·
session 計數 · 錨定的 change 與進度 · **未存檔的緩衝區數** · 該 repo 的 specs／active changes 數 ·
側欄來源（**僅當它不等於 session 自身的 folder**）。

- **cwd 走 `/proc/<pid>/cwd` 輪詢，而不取自 agent 的 payload。** 本設計的第一版以「要輪詢」為由
  否決了 cwd —— **那個理由太薄**：一次 `readlink` 是微秒級，而且只對**當前 focused 的那一個**
  session 做。改採之後還多一個好處：**shell session 也有 cwd**，而 payload 只有 claude session 有；
  同一個欄位由兩個來源供應，會讓「它什麼時候是準的」變成一個要解釋的問題。
- **dirty 標記要 spawn `git status --porcelain`** —— 這是本 change 唯一觸碰 `repo-branch`
  「偵測 SHALL NOT 呼叫任何外部程式」那條精神的地方。**那條規範的對象是「每個 folder、每次載入」
  都要做的判定**；dirty 只對**當前 focused 的那一個** repo 求值，量級完全不同。
  **不得擴大到 rail 的每一列** —— 那會讓 workspace 一大就開始卡。
- **不照抄雛型的 `UTF-8` 與 `spek ws 0.1`。** 那是零資訊量的常數。與移除 `◈` 假按鈕、
  把「每列都喊一次的 `OpenSpec`」換成分支同源：**一個永遠顯示同一個值的欄位，等於沒有欄位。**
- **這條列的價值不是新資訊，是「一個不會被終端寬度截斷的固定位置」。** 使用者的 claude
  statusline 之所以被截斷，正是因為它與終端內容**共用同一個寬度**；把位置資訊搬到殼層之後，
  他可以把 claude 那行縮短成只剩我們拿不到的東西（模型、用量）。
- 寬度不足時**由右往左省略**，優先保留 repo · branch。

### D7 — `ContextMenu` 在項目被觸發後自行關閉

現況：選項的 `onClick` 只呼叫 `item.onSelect`，關閉倚賴「點擊冒泡到 window → dismiss listener」。
**React 19 對 trusted discrete 事件會同步 flush effect**（`dialogs.tsx` 自己的註解就是為此而寫），
於是父層若在同一次事件中 re-render，`[onClose]` 的身分改變會使該 effect 重掛 —— 舊 listener 被
移除、新的排到下一個 tick —— **那次點擊冒到 window 時沒有人在聽**。側欄的來源下拉正是如此
（選擇 folder → 父層 `setPanelSource` → 同步 re-render）。

修法是 `onClick` 先 `item.onSelect()` 再 `onClose()`，**window 的 dismiss 保留**（點選單以外的
地方仍需要它）。這同時消滅了「每個呼叫端各自記得關」這個容易漏的義務 —— 目前有四個呼叫端。

### D8 — 打勾改為內嵌 SVG（純實作，不產生 spec）

完成＝淡綠底圓＋勾、未完成＝空心圓框，取自 spek web `ChangeDetail` 既有的樣式。
`☑` / `☐` 是字型字元，長相隨字型而變 —— 與 box-drawing 在終端裡的問題同源。
**不引入任何 icon 套件**（兩個 16×16 的 `<svg>`）。

### D9 — agent 的狀態經 `--settings` 注入的 statusLine 取得，**不解析 transcript**

context 用量的**百分比**、花費、rate limit、模型顯示名，只有 agent 自己算得出來。三條管道，
實測之後只有一條成立：

| 管道 | 結論 |
|---|---|
| 解析終端畫面 | 否決 —— 脆弱，而且那一行本來就被截斷，**我們要的正是被切掉的部分** |
| 解析 transcript（`~/.claude/projects/*.jsonl`） | **實測否決**（見下） |
| **`--settings` 注入 `statusLine`** | **採用** —— CLI 的公開旗標，不是內部檔案格式 |

**為什麼不是讀 transcript（實測，不是推論）：** 裡面有 model id、`effort`、token usage、`cwd`、
`gitBranch`，但**沒有 cost、沒有 rate limit、也沒有 context window 大小**；而 `message.model` 是
`claude-opus-4-8` —— **`[1m]` 後綴被拿掉了**，1M 與 200k 兩種變體在 transcript 裡**長得一模一樣**，
於是**百分比的分母算不出來**。（過程中還踩了一個假陽性：`grep rate_limits` 命中 8 次，但那全是
「把 statusline 腳本 `cat` 出來」的 tool result —— 命中的是**腳本原始碼裡的字串**。）

**`--settings` 這條路的實測結論：**

- 它**吃 inline JSON**，且是**疊加**：我們只指定 `statusLine`，其餘設定不受影響。
- 注入的命令**看得到我們設給 pty 的環境變數** —— 於是 payload 的落點可以是 per-session 的路徑，
  不必寫死，命令本身也不必去猜自己屬於哪個 session。
- payload 內含 **`context_window.context_window_size`**（實測 `1000000`）與 `model.id`
  （**保留 `[1m]` 後綴**）—— **那張「model → context window」對照表整個不需要了。** 這一點是承重的：
  那張表會隨新模型過期，而它失效的樣子是**一個看起來很正常的錯誤百分比**。
- `session_id` 對得上我們已經持久化的 `claudeSessionId`（`session-restore` 存的）。
- `rate_limits` 在全新 session 的 payload 中**缺席**（訂閱制才有、且要打過 API）——
  因此**每個欄位都必須能單獨缺席**，不可假設 payload 的形狀固定。

**這推翻了 `session-restore` 的「別綁 claude 的內部佈局」嗎？沒有，而那個區別是承重的**：
那條教訓的情境是「猜錯 → 撞號 → session 死掉」，**降級方向是災難性的**；這裡猜錯的下場是
**狀態列少幾個欄位**。而且我們綁的是一個 CLI 旗標與它自己的輸出，不是猜它把檔案放在哪、
用什麼格式寫。**同一條紀律不該無差別套用 —— 要問的是「失效時會怎樣」。**

### D10 — 預設啟用；串接使用者原有的 statusline，串不上就不注入

**本條的第一版是「預設關閉」，理由是「沒有自訂 statusline 的使用者，我們一接管就拿掉了 claude
內建的那條」。實測證明那個理由是錯的 —— 那條內建的東西不是 statusLine。**

實測兩種設定下的終端畫面：

| | 底部呈現 |
|---|---|
| 未設定 `statusLine` | 只有 `⏵⏵ auto mode on (shift+tab to cycle) · ← for agents` |
| 已設定 `statusLine` | **自訂那行**，其下**仍有**同一條 `⏵⏵ auto mode …` |

`⏵⏵ auto mode` 兩種情況都在 —— **它不是 statusLine 的位置**。自訂的 statusline 是額外多出來的
一行，沒設定就單純不存在。**於是接管一個空位，損失為零。**

- **預設啟用。** 零損失之後，預設關閉只會讓使用者得自己找到那個開關，否則狀態列永遠只有一半欄位。
- **保險：偵測到使用者已有自訂 statusline、卻讀不出它的命令時，SHALL NOT 注入。** 這時「注入」
  會讓他失去自己那條，而「不注入」只是少一個他還不知道存在的功能 —— **兩種失敗的代價不對等，
  就往代價小的那邊倒。**
- **仍保留開關**（`terminal-preferences`），讓不希望 spekterm 動到 claude 呼叫方式的人關掉它。
- **啟用時串接**使用者原有的 statusline 命令（自 `~/.claude/settings.json` 盡力讀出）—— 否則
  這個功能等於把他自己那條弄不見。

> **順帶，實測第一次拍到了使用者回報的那個 bug 本身**：在該終端寬度下，他的 statusline 只剩
> `…/-home-me-git-spekterm/8934b279-…/scratchpad …` —— **模型、context、花費、rate limit
> 全部被截斷掉了**。這條列要取回的就是那些。
- **注入發生在 spawn 當下**，因此切換偏好只影響其後建立或重建的 session。這是誠實的限制，
  要在設定介面上說明 —— 不說的話，使用者會以為這個開關壞了。
- **payload 落盤必須原子**（先寫暫存再 rename）：我們一邊監看一邊 parse，非原子的寫入會讓我們
  讀到半個 JSON。與 `workspace.json` / `sessions.json` / `preferences.json` 同一個作法。
- **payload 缺席、過期或解析失敗時，狀態列退回第一手欄位** —— 不呈現錯誤、不留空白格。
  這一條同時涵蓋「偏好關閉」「session 是 shell」「claude 版本不吐這些欄位」三種情況：
  它們在呈現上本來就是同一件事。

## Risks / Trade-offs

- **[綁定 `opsx` skill 存在]** → 失敗是**可見且無害**的（claude 當場回報不認得該命令，沒有檔案
  被改）；改動是一行常數。入口本身只是一次文字注入，沒有任何狀態綁在命令內容上。
- **[送進 pty 的文字可能落在 claude 正忙的時候]** → claude 的輸入框本來就接受在忙碌時鍵入；
  且送出後焦點在終端上，使用者立刻看得到發生了什麼。
- **[statusbar 佔掉 26px 垂直空間]** → 雛型已如此設計；終端高度隨之減少。
- **[新增一列會改變整個版面的量測]** → `probe:terminal` 是以**真滑鼠座標**點擊的，版面一動，
  那組對時序敏感的斷言就可能點空（`typography-scale` 收斂字級時的實測教訓：徵狀是時綠時紅、
  每次紅的還不同條，極易誤判為既有 flaky）。**上 statusbar 之後必須跑 `probe:terminal` 回歸，
  且若出現紅燈，先做 baseline 對照組再懷疑產品。**
- **[`ContextMenu` 是四個呼叫端共用的元件]** → 動它要跑 `probe:terminal` 與 `probe:files` 回歸。
- **[接管 `statusLine` 會動到使用者的 claude 體驗]** → 預設關閉 + 串接原有命令（D10）。
  **這是本 change 唯一會改變 spekterm 之外行為的東西**，因此它的預設值是承重的。
- **[payload 的欄位可能隨 claude 版本增減]**（實測 `rate_limits` 就會缺席）→ 每個欄位獨立判斷
  存在與否，缺席即不呈現該段；**不得因為少一個欄位就讓整條列空白或報錯**。
- **[statusbar 的資料來源從 1 個變成 4 個]**（session 狀態、git、`/proc`、agent payload）→
  四者各自可能缺席或延遲，呈現層必須把「還沒有」與「沒有」當成同一件事：不佔位置。

## Open Questions

- statusbar 的欄位在真實使用下夠不夠、順序對不對 —— 交給 dogfood 裁決，不預先加欄位。
- 若日後 `opsx` 支援指定要產生哪一個 artifact，D4 的「一顆按鈕」可以回頭重議。
