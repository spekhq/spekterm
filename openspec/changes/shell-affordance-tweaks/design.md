## Context

三個獨立的殼層微調，來自第五次 dogfooding。彼此無耦合，合成一個 change 只是為了不各開三個
幾乎沒有內容的 change。既有的攔截基礎設施（`KeyboardNavigation` 的 window capture 階段）與
文案紀律（`aria-label` 同時是選擇器）都已到位 —— 這裡只是往上加。

## Goals / Non-Goals

**Goals:**

- `Alt` 不再叫出任何 menu。
- 建立入口的可見文字精簡為「+」。
- `Ctrl+Shift+W` 關閉當前 session。

**Non-Goals:**

- 不為這個 app 設計任何真正的 menu 內容（那是另一件事，也未必要做 —— 這個 app 的操作都在
  介面裡）。
- 不改 `Ctrl+T`／複製貼上等既有快捷鍵。
- 不動建立入口的 `aria-label`（它是選擇器）。

## Decisions

### D1. `Ctrl+Shift+W` 而非 `Ctrl+W` —— 鍵位的代價不同種

關閉快捷鍵選 `Ctrl+Shift+W`，不選直覺的 `Ctrl+W`。實測（於使用者的機器）：`Ctrl+W` 在 zsh 是
`backward-kill-word`、bash 是 `unix-word-rubout` —— 都是終端裡**高頻的刪字鍵**（打錯路徑時人人
在按）。而它沒有 `Ctrl+T` 賴以成立的那個豁免：`Ctrl+T` 能拿，是因為使用者的 GNOME Terminal
早就把它綁成開新分頁、那個 `transpose-chars` 他本來就沒有；`Ctrl+W` 沒有這種「早就被拿走」的
情況。

`Ctrl+Shift+W` 的代價為零：`Ctrl+Shift+<字母>` 在終端協定裡**編碼不出來**，pty 內沒有任何程式
收得到它（這正是複製貼上用 `Ctrl+Shift+C/V` 的理由）。而且它就是 GNOME Terminal 關分頁的鍵 ——
與使用者的肌肉記憶一致。開／關不對稱（`Ctrl+T` 開、`Ctrl+Shift+W` 關）反映的是真實的代價差：
`Ctrl+T` 是白撿的，`Ctrl+W` 不是。

- **替代方案**：硬拿 `Ctrl+W`。否決 —— 換來的是每天都在用的刪字鍵失靈，代價遠大於「開／關對稱」
  的美觀。

### D2. menu **完全移除**，不是隱藏 —— `autoHideMenuBar` 不夠

目前的 `autoHideMenuBar: true` 只是「平時隱藏、按 `Alt` 浮出」—— 它保留了 menu，只是藏起來。
使用者要的是**按 `Alt` 什麼都不發生**，所以必須真正移除 menu（`Menu.setApplicationMenu(null)`
或等效），而不是續用 `autoHideMenuBar`。

- **平台差異**：macOS 的應用程式 menu 是系統層的（不在視窗內），`setApplicationMenu(null)` 在
  macOS 上的效果與 Linux/Windows 不同。本 repo 目前只在 Linux 實測；macOS 的 menu 行為列為
  Phase 6 打包驗收前要確認的項目之一（比照既有的 Windows `O_NOFOLLOW` 待確認項）。

### D3. `Ctrl+Shift+W` 的攔截點與抑制沿用既有紀律

攔截於 window 的 **capture 階段**（早於 xterm 與 Monaco 綁在各自 DOM 節點上的 listener）——
與所有既有快捷鍵同一個接縫，於是被攔下的 `Ctrl+Shift+W` 不會流進 pty。關閉目標是**當前 focused
的 session**（`sessions.focusedIdFor(selectedId)`）；沒有選中的 repo 或該 repo 沒有 session 時
為無操作。

對話框／overlay 開啟時 SHALL 不生效 —— 沿用既有的 `[role="dialog"]` 存在判定（未存變更對話框
開著時按 `Ctrl+Shift+W`，不該把 session 關掉）。這與導航快捷鍵同一條抑制規則。

## Risks / Trade-offs

- **[關 session 是破壞性動作，快捷鍵誤觸會丟掉一個 session]** → 關閉本身沿用既有的 `close`
  路徑（Phase 4 的生命週期，不留孤兒 pty）；且 session 的持久化狀態在關閉時本就會移除，這與
  點 ✕ 關閉無異。`Ctrl+Shift+W` 難以誤觸（三鍵組合）。不加確認對話框 —— 那會與「快捷鍵要快」
  相矛盾，且點 ✕ 關閉也沒有確認。
- **[macOS 的 menu 行為未實測]** → D2 已列為打包前確認項。

## Migration Plan

無資料遷移、無相容性問題。三條皆為純行為調整，可直接出貨。

## Open Questions

無。
