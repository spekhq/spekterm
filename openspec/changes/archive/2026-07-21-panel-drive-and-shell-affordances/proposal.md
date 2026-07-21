## Why

**第七次 dogfooding 的回饋。** 最重的一條是：**側欄與 session 之間的線目前是單向的。**

側欄已經會跟隨 session（`side-panel-repo-anchor` 的側欄來源、`openspec-panel` 的錨定 change），
但反向不通 —— 側欄只能**讀** OpenSpec，不能**驅動**產生它的那個 agent。而 OpenSpec 的 artifact
是一個一個產生的：proposal 寫完停下來給人看，人讀完，要**切回終端手打「繼續寫 design」**，
接著 specs、tasks 各再來一次。使用者原話：「這樣太累人了」。

這條打在這個 app 的立論上 —— PRD 說它是「一邊駕駛 agent、一邊看著 spec 上下文」，
而「駕駛」目前完全發生在終端裡，側欄對它一無所能。**讀完 artifact 的下一個動作，就發生在
使用者的視線正在看的那塊面板上**，卻得繞回鍵盤重打一次。

另外三條是同一輪 dogfood 撞到的殼層小毛病，各自獨立、都便宜，一起收（比照
`shell-affordance-tweaks`）。

> **本輪回饋有兩條經調查後不做，記在這裡以擋住重複調查：**
>
> - **「終端裡 claude 的連結要 Ctrl+click 才開得了」不是 bug。** 已實測：login shell 中純文字
>   URL 與 OSC 8 超連結**兩套都正常**（hover 有底線、左鍵直接開）。差別只在 claude 開了
>   mouse reporting —— xterm 因此把游標釘成 `default`（`.enable-mouse-events`）並把左鍵轉發給
>   程式，**那次點擊是 claude 自己處理的**。Shift+左鍵反而沒反應，因為它被 xterm 攔去做「強制
>   選取」（`shouldForceSelection`）而根本沒送進 claude。這是 claude 的操作慣例，不是我們的缺陷。
> - **「點檔案路徑應開在側欄而非另開 app」在 claude session 裡做不到。** 承上，那次左鍵點擊
>   以跳脫序列進了 pty，spekterm 收不到；「另開 app」也是 claude 自己去 `xdg-open` 的。唯一的
>   攔法是在 capture 階段搶下**左鍵**，但左鍵是 claude 整個 UI 的主要互動面（選單、選項、輸入框），
>   代價與當初搶右鍵不是同一個量級。真正的解是**讓 spekterm 被 claude 認成 IDE**（claude 在
>   VS Code／JetBrains 裡就是這樣把檔案開進編輯器），那要獨立論證，不屬於這包。

## What Changes

- **側欄可請 agent 續寫下一個 artifact。** 當側欄呈現的 change 尚有未產生的 artifact 時，
  本 change 視圖提供入口；觸發後把對應的指示**送進該 session 的 pty**，使用者不必切回終端打字。
  這是側欄第一次對 session **發話**（此前只有「跟隨」）。
- **新增 statusbar。** `docs/workspace-mockup.html` 早已定義它（`.statusbar`：26px、底部、等寬、
  分段、faint 色），但**從未實作**。雛型裡的內容是佔位（`UTF-8`、`spek ws 0.1`），本 change
  改為呈現真正有用的脈絡：repo · git 分支（含 dirty 與 worktree 名）· pty 當下的 cwd ·
  session 標籤與狀態 · session 計數 · 錨定的 change 與進度 · 未存檔的緩衝區數 ·
  該 repo 的 specs／active changes 數 · 側欄來源（僅當指向他處）。
- **新增與 claude 的狀態橋接。** 上面那些是 spekterm 的第一手事實，但使用者最在意的幾項
  （**context 用量百分比**、花費、rate limit、模型顯示名）**只有 agent 自己算得出來**。
  取得它們的正確管道是 claude 的 **`--settings` CLI 旗標**（公開介面）：spawn 時注入一個
  `statusLine` 命令，把 claude 已經算好的 payload 落盤，spekterm 監看並呈現。
  - **實測確認**（見 design D9）：`--settings` 吃 inline JSON、是**疊加**而非取代（其餘設定不受
    影響）、注入的命令**看得到我們設給 pty 的環境變數**，而 payload 裡含
    `context_window.context_window_size` —— 於是**百分比的分母由 claude 提供，不需要我們維護一張
    會過期的「model → context window」對照表**。
  - **仍然明確不做**：不解析終端畫面來還原那一行，也**不解析 claude 的 transcript**
    （`~/.claude/projects/*.jsonl`）—— 那是內部檔案格式，且實測**根本沒有** cost、rate limit
    與 context window 大小（見 design D9 的「為什麼不是讀 transcript」）。
  - **預設關閉**：接管 `statusLine` 會讓沒有自訂那條的使用者失去 claude 內建的狀態列 ——
    對不需要這個功能的人是淨損失。啟用時**串接**使用者原有的 statusline 命令。
- **選單在選取後自行關閉。** 目前 `ContextMenu` 的選項按鈕不呼叫 `onClose`，關閉倚賴「點擊冒泡到
  window → dismiss listener」這條**環境路徑**；父層若在同一次事件中同步 re-render，該 listener
  會被抽換掉（React 19 對 trusted discrete 事件同步 flush effect），選單就留在畫面上 ——
  側欄的來源下拉正是如此。修正後，四個呼叫端（來源下拉、spawn 選單、分頁右鍵、檔案樹右鍵）
  同時受惠，且不再倚賴那條路徑。
- **tasks 的完成打勾改為內嵌 SVG**（完成＝淡綠底圓＋勾、未完成＝空心圓框，取自 spek web 既有的
  樣式），取代目前的 `☑` / `☐` 兩個 Unicode 字 —— 那兩個字的長相隨字型而變。
  **這條是純呈現，沒有任何 requirement 在描述打勾長什麼樣**，因此不產生 spec delta，只進 tasks。

## Capabilities

### New Capabilities

- `artifact-continuation`: 側欄在 change 尚有未產生的 artifact 時提供續寫入口，並把指示送進
  該 session 的 pty。涵蓋：入口何時出現與出現哪些、送給哪一個 session、送出的語意（填入 vs 直接執行）、
  以及 session 不可用時的行為。
- `status-bar`: 主視窗底部的狀態列，呈現當前 focused session 的脈絡資訊。涵蓋：呈現哪些欄位、
  無 session／無 repo 時的狀態、資訊過長時的處置，以及 agent 狀態缺席時的退化。
- `claude-status-bridge`: 以 claude 的 `--settings` 旗標注入 statusLine 命令，把它算好的狀態
  payload 落盤供 spekterm 讀取。涵蓋：注入時機與對象、落盤的原子性、與使用者原有 statusline 的
  串接、預設關閉、以及 payload 缺席時的行為。

### Modified Capabilities

- `workspace-layout`: 兩條 —— **主視窗的區域構成**新增 statusbar（既有 requirement 只列了活動列、
  rail、主舞台三個區域）；以及新增一條**選單以滑鼠選取後 SHALL 關閉**（現有規格對此完全沉默，
  `keyboard-navigation` 只管 `Esc` 與鍵盤操作）。
- `terminal-preferences`: 新增一個偏好 —— 是否啟用與 claude 的狀態橋接（預設關閉），
  與既有的終端字型偏好同存於 `preferences.json`、同一個設定對話框。

## Impact

- **renderer**：`openspec/ChangeView.tsx`（續寫入口、打勾樣式）、`files/dialogs.tsx`（`ContextMenu`
  —— 共用元件，動它要跑 `probe:terminal` 與 `probe:files` 回歸）、新的 statusbar 元件與 `App` 的版面。
- **IPC**：續寫**可能不需要新的 IPC**（`terminal:write` 已存在）。statusbar 視最終欄位而定 ——
  若要呈現 pty 當下的 cwd，主行程已有讀 `/proc/<pid>/cwd` 的作法（`session-restore`），但那是
  一次性讀取，持續呈現需另行論證。
- **i18n**：新的 UI 文案進字典（英文），`aria-label` 一律自字典取（它同時是 6 支 probe 的選擇器）。
  **但送進 pty 的那段指示不是 UI 文案** —— 它是給 agent 讀的，語言該跟使用者平常打字的習慣走，
  不是跟 UI 走。而產品原始碼有一道**字串字面值不得含 CJK** 的守衛，這使「該用什麼語言、由誰決定、
  存在哪」成為必須裁決的問題，不能含混帶過。
- **驗收**：`probe:openspec`（續寫入口的出現條件與觸發結果）、`probe:workspace`（statusbar 的呈現）、
  `probe:files` / `probe:terminal`（選單關閉的回歸）。
- **不影響**：主行程的 OpenSpec 資料層、fs 邊界、terminal 的生命週期。
