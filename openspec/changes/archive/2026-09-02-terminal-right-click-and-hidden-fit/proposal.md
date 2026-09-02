## Why

一輪 dogfood 抓到終端**滑鼠與尺寸**兩個缺陷。它們的成因無關，但住在同一塊模組
（`shell/terminal/` 的 `TerminalView.tsx` 與 `xterm.ts`）、改的是同一個 capability、由同一支探針
回歸，因此併為一個 change。

### 一、隱藏中的 session 被縮成 2 欄 × 1 列（嚴重）

**每切換一次 session，被切走的那個終端就被 resize 成 `cols=2, rows=1`。** 實測（同一個 pty，
直接讀 TIOCGWINSZ）：

```
顯示中          36 68
切到另一個分頁   1  2      ← 隱藏即被縮成最小值
切回來          36 68
```

`xterm.ts` 的防護建立在一個**已經不成立的假設**上 —— 註解寫著「容器為 `display:none` 時
`proposeDimensions` 會給出無效值」，但這個版本的 `FitAddon` 不會：它以
`parseInt(computedStyle.width) || 0` 把 `NaN` 吞成 `0`，算出負的可用空間，再夾到
`MINIMUM_COLS = 2` / `MINIMUM_ROWS = 1`。於是三道防護（`!proposed`、`Number.isFinite`、`< 1`）
**全部放行一個看起來合法的 `{cols: 2, rows: 1}`**。

兩個後果，都已實測：

- **終端歷史被永久破壞。** `fitAddon.fit()` 會 `term.resize(2, 1)`，xterm 把整個 buffer **重排成
  2 欄** —— 行數暴增、撞上 5000 行的 scrollback 上限，最舊的內容被擠掉，切回來也回不來。
  對照實驗（同一條指令、同一個終端）：全程停留看得到 `MARK_1`；**中間切走一次再切回，只剩
  `MARK_27`** —— 200 行的輸出，一次切換就毀掉 26 行，而真實工作量下的損失只會更大，且**每切換
  一次就再擠掉一批**。這正是 dogfood 回報的「切到其他 session 再切回來，有部分 output 消失」。
- **agent 在隱藏期間以 2 欄排版。** 送給 pty 的 `resize` 是真的 —— `claude` 於是把
  `SIGWINCH` 後的畫面依 2 欄重畫，那段輸出被印進 scrollback 就**永久是壞的**。dogfood 的徵狀是
  「Write tool 的預覽每一行只剩開頭一個字」。
- **而損害會跨重啟存活。** shell session 的畫面快照（pty 靜下來 2 秒後序列化落盤）在切走之後
  序列化的是**已經被重排成 2 欄的內容**，下次開 app 再被重播出來。這是三個後果中唯一寫進磁碟的
  一個，而它緊鄰的那道「不覆寫休眠 session 快照」的防護，其註解裡寫的理由（「隱藏中的終端是以
  80 欄重新序列化的」）**正是被這個缺陷推翻的那一句**。

**這個缺陷撐過了九支探針每一輪全綠** —— 沒有任何一條斷言在 session 被隱藏時去讀 pty 的尺寸。

### 二、claude session 裡右鍵完全沒有作用

右鍵目前**依 mouse reporting 決定歸屬**：pty 內的程式啟用了 mouse reporting 時，右鍵讓位給該
程式。理由寫在 `terminal-clipboard` 的 design D1：「讓位給程式，使 claude 的右鍵貼上等慣例生效」。
**那個前提是錯的，兩端都已實測否證：**

- `claude` 一啟動就送 `?1000h ?1002h ?1003h ?1006h`（以 node-pty spawn 實測抓序列）—— 於是
  **claude session 裡右鍵永遠被讓出去**，而 agent session 正是這個 app 的主場。
- **今天沒有任何程式讀得到系統剪貼簿**：唯一的管道是 OSC 52，而 xterm.js 未實作它
  （`InputHandler.ts` 明列 52 為未支援），本 change 也不打算加（見 Non-Goals）。於是「讓位」
  讓出去的，是一顆什麼都不做的鍵。
  > **這是一個選擇，不是結構性事實** —— `registerOscHandler` 是 xterm 的公開 API，要加隨時加得上。
  > 右鍵歸屬真正的依據因此是 design D5（**今天沒有程式在這個終端裡用右鍵做出有用的事**），
  > 不是「不可能支援 OSC 52」。把它寫成後者會讓這條 requirement 的理由比它實際上更硬。

中鍵之所以還活著，正是因為 `terminal-clipboard` 的第二次 dogfood 已把中鍵**無條件**接管。
而**觸控板沒有中鍵** —— 使用者於是完全失去滑鼠貼上這條路徑。

## What Changes

**尺寸**

- **容器沒有被排版出來時，一律不 fit、不打擾 pty。** 判準改為量**容器自身的盒子**（0 就退出），
  不再倚賴 `proposeDimensions()` 回傳值的大小 —— 那個值永遠會被夾到最小值，看起來像合法答案。
- 連帶：pty 誕生時推送尺寸的那條路徑（`handle.size()`）SHALL NOT 送出一個從未被真實量測過的
  尺寸，否則同一個壞值會由另一個入口再進去一次。

**滑鼠**

- **右鍵一律由終端擁有**：無論 pty 是否啟用 mouse reporting，右鍵 SHALL 開啟終端自己的複製／
  貼上選單。移除「gate 在 mouse reporting」這條分支，與**中鍵**收斂為同一條歸屬規則。
- **右鍵不再轉發給 pty 內的程式** —— 選單既然一律開啟，把同一次事件也送過去就是雙重作用
  （中鍵當年踩過同型的問題）。抑制方式與中鍵同源（capture 階段接管）。

**不變**：鍵盤路徑（`Ctrl+Shift+C`／`V`）、中鍵、`Ctrl+C` 仍為中斷訊號、左鍵（選取與轉發）、捲動。
**非目標**：不引入 OSC 52 支援；不改變 scrollback 上限（5000 行是另一個題目，不在本 change）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `terminal-sessions`：
  - **尺寸同步**的 requirement 增訂「容器不可見／尺寸為零時 SHALL NOT 推送尺寸」，並明確
    **終端 SHALL NOT 因為不可見而改變自己的行列數**（buffer 重排會破壞既有內容）。
  - 「終端支援複製與貼上」的**右鍵**條款改為「一律由終端擁有」，移除隨之失效的 scenario
    「啟用 mouse reporting 時右鍵讓位給程式」，並新增其反面（mouse reporting 啟用時右鍵仍開啟
    選單、且該事件不轉發給程式）。

## Impact

- **程式碼**：`src/renderer/src/shell/terminal/xterm.ts`（`fit()` 的防護）、
  `TerminalView.tsx`（`onContextMenu` 的 gate、滑鼠事件接管、pty 誕生時的尺寸推送）。
  `mouseTrackingActive()` 若在本 change 之後失去所有呼叫端則一併移除 —— 一個沒有人用的把手，
  下一個人會誤以為它仍是某條規則的載體。
- **驗收**：`scripts/probe-terminal.mjs`。
  - 新增載體：**session 被隱藏時，其 pty 的尺寸不變**（讀 pty 的 winsize，不看畫面）＋
    **切走再切回之後，先前的輸出仍完整**（對照組＝全程停留）。這個缺陷此前完全沒有載體。
  - 既有的「讓位給程式」斷言改成**它的反面**，不是刪掉。
- **無 IPC／持久化／主行程改動**，無新依賴。
- **既有使用者的損失無法回溯** —— 已經被擠掉的 scrollback 救不回來，**已經落盤的 2 欄快照也是**
  （下次開 app 仍會重播它，直到該 session 被關閉或快照被覆寫）。本 change 只讓它不再發生。
