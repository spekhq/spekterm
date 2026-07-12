## Context

這個 app 的宿主是**終端**，而終端幾乎永遠持有焦點。任何「全域快捷鍵」的設計因此不是自由選鍵，而是
**從 pty 手上搶鍵**：xterm 會把按鍵直接寫進 pty，Monaco 也會吃掉按鍵（既有的 `Ctrl+S` 正是**被迫註冊
於 Monaco 內部**才攔得到 —— 見 `editor/index.tsx:70`）。

既有的按鍵佔用：`Ctrl+C`（SIGINT，明文不可挪用）、`Ctrl+Shift+C`／`Ctrl+Shift+V`（終端複製貼上）、
`Ctrl+S`（存檔）、`Esc`（關 overlay）。pty 內的 agent 需要：`Tab`（補完）、**`Shift+Tab`（Claude Code
用它切 permission mode）**、`Ctrl+←/→`（readline 的 word jump）、以及 `Ctrl+R/L/D/A/E/U/K/W` 那一排。

另一半是 session 標籤：login shell 以 OSC 宣告 `使用者@主機:/路徑`，它**比 session 晚一秒多才到**
（shell 要載完 rc、畫出第一個 prompt），抵達時分頁從約 60px 暴增到約 210px，把緊鄰其後的建立入口
往右推 150px。

## Goals / Non-Goals

**Goals:**

- 以鍵盤在 session 與 repo 之間移動，**在終端持有焦點時仍然生效**，且被攔下的按鍵**不得抵達 pty**。
- login shell 的 session 標籤穩定為 `shell N`，消除分頁的寬度突變。
- 既有的「pty 自己宣告身分」能力（`claude` 的分頁自動改名）**完整保留**，且仍有真實的自動化驗收。

**Non-Goals:**

- **不做鍵位設定 UI。** 綁定先寫死；有人真的撞到再談（見 D2 的風險）。
- **不限制分頁寬度**（使用者已決定）。跳動的根因是標籤內容突變，不是缺少寬度上限 —— 拿掉 shell 的
  OSC 標題即從源頭解決。
- **不做 `Ctrl+1..9` 直達 repo。** 循環已足夠，且多一組綁定就多一組要從 pty 手上搶的鍵。

## Decisions

### D1：攔截點 —— renderer 的 `window` **capture 階段** keydown，單一接縫

三個候選：

| 方案 | 評估 |
|---|---|
| **window capture 階段的 keydown**（採用） | capture 由 window 往下傳，**早於** xterm 綁在 helper textarea 上的 listener，也早於 Monaco 綁在自己 DOM 節點上的 listener。`stopPropagation()` + `preventDefault()` 即可讓兩者都收不到。所有狀態（folders、sessions、對話框）都在 renderer，零 IPC。 |
| xterm 的 `attachCustomKeyEventHandler` 回傳 `false` | 只覆蓋「終端持有焦點」的情形，側欄／編輯器持有焦點時還要另一套 —— 邏輯裂成兩處。 |
| 主行程的 `before-input-event` | 確實最早，但主行程**不知道**對話框開著沒、focused 是誰、rail 的順序 —— 那些狀態全在 renderer。要嘛把狀態同步到主行程，要嘛每次按鍵往返一次 IPC。為了一個純 renderer 的動作引入跨行程狀態，不划算。 |

**關鍵洞察：既有的 `Ctrl+S` 之所以被迫寫進 Monaco，是因為它註冊在 window 的 _bubble_ 階段** ——
Monaco 攔下 `Ctrl+S` 並 `preventDefault` + 停止傳播，於是它永遠冒不到 window。**capture 階段沒有這個
問題**（它在 Monaco 之前就跑了）。這條約束不是「window listener 不管用」，而是「**階段選錯了**」。

### D2：`Ctrl+↑/↓` 會從 pty 內的程式手上**永久沒收**這個按鍵 —— 接受，並記錄代價

`Ctrl+Tab` 與 `Ctrl+↑/↓` 的性質**不同**，這點必須寫清楚，否則日後會被誤當成同一類：

- **`Ctrl+Tab` 在標準終端編碼下根本送不出去**（`Tab` 就是 `Ctrl+I`＝`0x09`；`Ctrl+Tab` 除非開
  kitty／`modifyOtherKeys` 協定否則無法編碼）。因此**沒有任何 shell 或 agent 綁得了它** ——
  我們拿走它，pty 內**零損失**。這正是 GNOME Terminal、iTerm2 敢拿它切分頁的原因。
- **`Ctrl+↑/↓` 送得出去**（`CSI 1;5A` / `CSI 1;5B`）。攔截它 ＝ 從所有跑在終端裡的程式手上沒收它，
  **而且沒有逃生口**。

代價的實測（本機）：

| | 是否綁定 `Ctrl+Up/Down` |
|---|---|
| zsh（預設） | 無 |
| bash readline（預設） | 無 |
| **tmux** | **有** —— `prefix + C-Up/C-Down` 是 pane resize；copy-mode 裡是捲動 |
| GNOME（視窗管理員） | 無（被 WM 拿走的是 `Ctrl+**Alt**+方向鍵`，不是 `Ctrl+方向鍵`） |

唯一真正的犧牲者是 **tmux**。但 **spekterm 存在的目的本身就是取代那個用途**（它就是使用者的
multiplexer），在它裡面再開一層 tmux 是罕見的。**接受這個代價。**

替代方案 `Ctrl+Alt+↑/↓` 被排除：Linux 上被 GNOME 拿去切工作區，按鍵到不了我們。

### D3：`Ctrl+Tab` 依**分頁位置序**，不是 MRU

VS Code 的 `Ctrl+Tab` 是 MRU，但 **VS Code 的分頁順序不是使用者排的**。我們的是 ——
`session-rename-and-reorder` 讓使用者可以拖曳排序，那個順序是他自己的心智模型。位置序才可預測。

spec 有一條 scenario 專門把兩者區分開（先聚焦第三個、再聚焦第一個，然後 `Ctrl+Tab` 應到**第二個**）
—— 少了它，MRU 的實作也會全綠。

### D4：OSC 標題的忽略點在 `sessions.tsx` 的 `setTitle()`，**不是**顯示層

`setTitle(sessionId, title)` 是 OSC 標題進入 session 狀態的**唯一入口**，而且它手上就有那個 session
（因此知道 `spawnTarget`）。在那裡對 `shell` 目標直接 return：

- `session.title` 永遠是 `undefined` → `sessionTitle()` 自然退回本地標籤，**不必改顯示層**。
- `pendingTitle` 永遠不會被設 → **標題衝突的確認對話框對 shell session 不再有觸發條件**，
  這正是 spec 要求的。

**若改在顯示層（`session-badge.tsx`）擋，會漏掉後者** —— 標籤不變，但使用者仍會被一個「pty 想把這個
session 改名為 `kewang@host:/tmp/...`，要採用嗎？」的對話框打斷，而那個名字他根本永遠看不到。
**一個入口擋掉，全鏈路一致。**

### D5：「對話框開著」以 `role="dialog"` 的存在判定

按鍵處理時檢查 `document.querySelector('[role="dialog"]')`。理由是**自我維護**：任何日後新增的對話框
只要遵守這個 a11y 慣例就自動被尊重，不必記得去某個清單註冊。

代價：`files/dialogs.tsx` 的幾個對話框**目前沒有 `role="dialog"`**（只有 `SessionNameDialog`、
`TitleConflictDialog`、`VizOverlay` 有）。本 change 要補上 —— 那本來就是個無障礙缺口，不是為了測試
而加的鉤子。

替代方案「modal 計數的 context」被排除：它的失效模式是**靜默的**（新對話框忘了註冊 → 快捷鍵在它開著時
照樣生效），而且比 DOM 判定更囉嗦。兩者都有靜默失效的可能，但 `role="dialog"` 至少對齊了一個 reviewer
本來就認得的慣例。

### D6：per-repo 的焦點記憶**已經存在** —— 本 change 只補 spec 與驗收，不寫新程式

`SessionsProvider` 的 `focused` 本來就是 `Map<folderId, sessionId>`，而 `focusedIdFor()` 的行為正好
就是 spec 要求的三條：記住該 folder 的焦點、焦點的 session 已關閉時退回第一個、從未聚焦過時退回第一個。
`MainStage` 也已經以它推導 `focusedId`，所以**滑鼠與鍵盤天然走同一條路**。

**這是「行為已存在但從未被寫進 spec」的情形。** 補上要求與驗收是有價值的（把它釘住，日後改動會被
探針擋下），但**不需要新的狀態**。proposal 原先寫「需新增 per-repo 狀態」，是我在讀程式碼之前的誤判，
已更正。

### D7：`probe:terminal` 的標題測試以 **PATH 上的一支 stub `claude`** 承載

現有的「pty 宣告標題」「命名權衝突」三條測試，全部以 **login shell session** 送 `printf '\033]0;…\007'`
來驅動。本 change 生效後，那些 session 不再採用 OSC 標題 —— **那些測試會繼續「通過」，但通過的是
「標籤沒變」這個新行為，而不是它們自稱在測的東西**。88/88 依然是 88/88，你看不出它們已經空轉。
（實測確認：改動後這四條立刻轉紅，正是它們在測 OSC 標題的證明。）

**載體是 `claude` 目標的 session —— 但用一支我們自己控制的 `claude`。**

產品的 claude 模式是 `$SHELL -l -c claude`：它從 **PATH** 解析 `claude`，而 pty 的 env 是整份繼承
Electron 行程的 `process.env`（`terminal.ts` 的 `create()`）。探針本來就自己 spawn Electron，因此只要
把一個暫存目錄前置到 `PATH`，裡面放一支會送出指定 OSC 標題的 `claude`，就能用**完全真實的產品路徑**
驅動這個能力。

**已實測**（`-l` 是 login shell，profile 有可能把 PATH 重建掉 —— 這是必須先回答的未知數）：

```
假 claude 真的被 login shell 執行到 → ✓（PATH 前置有存活）
claude 目標採用了它宣告的 OSC 標題   → ✓  分頁標籤：["fake-claude-title"]
```

這比原先設想的「用真的 claude、沒裝就跳過」好得多，而且**取消了那個妥協**：

- 標題是**確定的**（真 claude 宣告什麼、何時宣告，我們控制不了）。
- **任何環境都能跑** —— 不需要本機裝 claude，不需要「跳過」的分支，探針不會在任何機器上說謊。
- 它**不是**產品裡的測試分支：產品只是從 PATH spawn `claude`，那正是它的正常行為。探針動的是
  **環境**，不是被出貨的那份程式碼。

同時**新增**兩條 shell 側的正向斷言：shell session 送出 OSC 序列之後標籤**維持** `shell N`；
已命名的 shell session 其 pty 送出標題時**不跳確認對話框**。這才是本 change 真正要保證的行為。

### D8：`Ctrl+T` 開新 session —— 代價比 `Ctrl+↑/↓` 更貴，但使用者裁決要付

**實測（本機）**：

| | `Ctrl+T` |
|---|---|
| zsh | **有綁** —— `"^T" transpose-chars` |
| bash readline | **有綁** —— `"\C-t": transpose-chars` |
| GNOME Terminal（使用者的終端） | **它自己拿走了** —— `new-tab = <Primary>t`（即 `Ctrl+T`） |

兩個觀察決定了這個裁決：

1. **使用者在 GNOME Terminal 裡本來就沒有 `transpose-chars`** —— 終端模擬器在 shell 之前就把
   `Ctrl+T` 攔走了。所以「沒收它」對他不是新的損失，而且**符合既有的肌肉記憶**。
2. **`claude` 沒有使用 `Ctrl+T`**（使用者確認 —— 他是 Claude Code 的日常使用者）。這是本裁決的
   **關鍵前提**：claude session 是這個 app 的主場，若 claude 用了 `Ctrl+T`，那個成本會是每天在付
   的，結論就會反過來。

**替代方案 `Ctrl+Shift+T` 的成本是零**（`Ctrl+Shift+字母`在標準終端協定裡編碼不出來 —— 這正是本
app 已經拿 `Ctrl+Shift+C/V` 當複製貼上的理由），但既然 claude 不用 `Ctrl+T`，肌肉記憶勝出。

> **這個結論有前提。** 若日後 `claude`（或其他常駐於 pty 的 agent）開始使用 `Ctrl+T`，本裁決即失效
> —— 屆時該回來看的是這一段，而不是重新推導一次。退路是 `Ctrl+Shift+T`。

### D9：`Ctrl+T` 跳選單 —— 於是選單**必須**能以鍵盤操作

使用者選擇「跳出 spawn 選單」而非「直接開某一種 session」。這帶來一個**不可分割的連帶工作**：
現有的 `ContextMenu` 只處理 `Esc`，**沒有方向鍵導覽**。

**用快捷鍵叫出一個只能用滑鼠點的選單，等於沒做這個快捷鍵。** 因此 `ContextMenu` 必須加上：
開啟時焦點落在第一項、`↑/↓` 循環移動、`Enter` 觸發（`<button>` 原生就會，不必自己接）。

**觸發點走「啟動既有的建立入口」，不另闢路徑。** `KeyboardNavigation` 找到
`[aria-label="新增 session"]` 並觸發它 —— 於是選單的**錨定位置與滑鼠點擊完全一致**（`useSpawnMenu`
的 `open` 是從 `event.currentTarget` 的 rect 算出來的），也不必把 spawn 選單的狀態從 `SessionTabs`
搬出來。**鍵盤的接縫仍然只有一處**（D1 不變）。

**抑制範圍要跟著擴大**：選單開著時，導航快捷鍵 SHALL 讓位 —— 否則 `Ctrl+Tab` 會在使用者正用方向鍵
選項目時把畫面切走。判定從 `[role="dialog"]` 擴為 `[role="dialog"], [role="menu"]`。

## Risks / Trade-offs

- **[`Ctrl+Tab` 可能根本到不了 renderer]** → Chromium 在瀏覽器裡把 `Ctrl+Tab` 保留給分頁切換、不送給頁面；
  Electron 的 `BrowserWindow` 沒有分頁列，理應會送達（**VS Code 就是 Electron，它的 `Ctrl+Tab` 是有效的**）。
  **但這必須實測**，而且是實作的第一件事 —— 若它到不了，整個 D1 要改走主行程的 `before-input-event`。

- **[探針證明不了「真實鍵盤」]** → CDP 的 `Input.dispatchKeyEvent` 是把事件注入輸入管線，它**繞過了**
  作業系統與瀏覽器的 accelerator 層。因此探針能證明「handler 正確」與「按鍵沒進 pty」，**但不能證明
  一顆真實的 `Ctrl+Tab` 會抵達 renderer**。這道缺口只能由使用者以真鍵盤確認一次 —— 明確寫在 tasks 裡，
  不假裝探針涵蓋了它。

- **[沒收 tmux 的 `Ctrl+↑/↓`]** → 接受（見 D2）。沒有逃生口，因為本 change 不做鍵位設定。若日後真的
  有人撞到，補救方向是鍵位設定，而不是換鍵（換鍵會破壞已經養成的肌肉記憶）。

- **[`role="dialog"` 判定的靜默失效]** → 日後新增的對話框若忘了 `role="dialog"`，快捷鍵會在它開著時
  照樣生效。緩解：本 change 把 `files/dialogs.tsx` 補齊，並在探針中對**每一種**對話框各驗一次抑制
  （不是只驗一種就宣稱涵蓋）。

- **[`Ctrl+↑/↓` 與未來的側欄樹狀導覽衝突]** → 側欄的檔案樹／spec 樹日後若要支援方向鍵導覽，
  `Ctrl+↑/↓` 不衝突（那會是裸的 `↑/↓`），但值得記住這一格已經被佔走。

## Open Questions

- 無。`Ctrl+Tab` 是否抵達 renderer 是**待實測的事實**，不是待裁決的設計 —— 已列為 tasks 的第一項，
  且若結果為否，D1 的退路（主行程 `before-input-event`）已在上面寫明。
