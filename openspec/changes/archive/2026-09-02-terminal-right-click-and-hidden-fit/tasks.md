## 1. 尺寸：量不到就不動（先做，嚴重度較高）

- [x] 1.1 `src/renderer/src/shell/terminal/xterm.ts` 的 `fit()`：在呼叫 `fitAddon.fit()` 之前先量容器自身的盒子（`term.element.parentElement` 的 `clientWidth` / `clientHeight`），任一為 0 即回 `null`；改寫那段以「回傳值是否有效」為判準的註解與防護（design D1／D2）。驗證：`npm run typecheck` 與 `npm run lint` 通過
- [x] 1.2 在 `fit()` 留下註解記載**為什麼判準是容器而不是回傳值**（`proposeDimensions()` 的 `parseInt(...) || 0` 會把「沒有盒子」變成一個被夾到 `MINIMUM_COLS/ROWS` 的合法數字），並註明兩點：`MINIMUM_COLS` 是上游的內部常數不可拿來當判準；`clientWidth` 與 computed `width` 是**同一個盒子但不同的度量**（padding box／content box、整數／小數），目前一致是因為 host 沒有 padding。驗證：註解指名該行為，不只是「這裡要小心」
- [x] 1.3 `xterm.ts` 的 `Terminal` 建構參數明寫 `windowOptions: {}`，註明理由：`CSI ?3h`（DECCOLM）與 `CSI 8;r;c t`（XTWINOPS）讓 **pty 的輸出**得以自行改變行列數，兩者都 gate 在這個選項上，而我們此前靠的是上游預設全 false（design D3 第 3 點）。驗證：`npm run typecheck` 通過，且該註解說明「把一個預設值變成一個宣告」
- [x] 1.4 新增 `scripts/terminal-resize-source.test.mjs`（比照 `scripts/watcher-source.test.mjs`，`npm test` 的 glob 已涵蓋 `scripts/*.test.mjs`）：`@xterm/*` 的靜態／動態 import 與值的 re-export 只准在 `xterm.ts`，對終端／pty 的 `.resize()` 只准在 `xterm.ts` 與 `TerminalView.tsx`。**咽喉點是套件的 import，不是 `fit()` 的呼叫** —— 後者會把 `TerminalView` 三處 `handleRef.current?.fit()`（匯流點被正確使用的樣子）判成違規（design D8）。**須自帶對照組**。驗證：`npm test` 全綠，且四種繞道與四種合法用法各自實測

## 2. 右鍵：一律由終端擁有

- [x] 2.1 `TerminalView.tsx` **整個移除 `onContextMenu` prop**（不是只保留 `preventDefault()`）—— React 19 的委派 listener 掛在 `#root`，host 的 capture 一 `stopPropagation` 它就永遠不會執行，留著即死碼（design D4）。驗證：`git grep -n --no-color onContextMenu src/` 在 `TerminalView.tsx` 無殘留，`npm run typecheck` 通過
- [x] 2.2 在 host 的 **capture 階段**接管 button 2 的 `mousedown` / `mouseup` / `auxclick` / `contextmenu`（一律 `preventDefault` + `stopPropagation`），並在 `mousedown` 開啟選單（座標取自該事件）。沿用中鍵那段既有 effect 的形狀，註解說明四個事件都要列的理由（`mousedown` 的 `preventDefault` 不會取消 `contextmenu`）與不依賴 `contextmenu` 派送時機的理由。驗證：3.3 的兩條斷言
- [x] 2.3 `mouseTrackingActive()` 若已無呼叫端，從 `XtermHandle` 介面與 `xterm.ts` 一併移除（含其註解）。驗證：`git grep -n --no-color mouseTrackingActive` 無殘留且 `npm run typecheck` 通過
- [x] 2.5 `ContextMenu`（`files/dialogs.tsx`）的 dismiss 增掛 **window capture 階段的 `mousedown`**，落在選單自身的按下放行 —— 讓「同時只有一個選單」成立（dogfood 否決了原本「接受並存」的裁決，design D4）。驗證：分頁選單開著時對終端右鍵，舊的當場消失；按在選單項目上仍觸發該項目
- [x] 2.4 選單關閉時把焦點交還終端（`ContextMenu` 的 `onClose` 補 `handleRef.current?.focus()`）—— 右鍵 mousedown 被攔下之後 xterm 不再取得焦點，Escape 關掉選單時焦點會落在 `document.body`。驗證：自右鍵選單關閉後直接打字，字元進得了 pty

## 3. 驗收載體（`scripts/probe-terminal.mjs`，落在 `runMode` 段落）

- [x] 3.1 新增「session 被切走時其 pty 的尺寸不變」的斷言：**前置是該終端必須先真的顯示過**（未排版過的終端走的是另一條路徑，見 design Context）。取值以 `terminal.write` 對該 session 送一行 `stty size > <file>`，判準走既有的 `waitForFile`；**不從外部讀 `/dev/pts`**（`stty -F` 不帶 `O_NOCTTY`）。於**顯示中／切走後／切回後**各取樣一次，**三次都要有斷言**：切走後 == 切走前，切回後 == 切走前（後者是 delta 新增的「切回顯示時尺寸仍然正確」唯一的載體）
- [x] 3.2 新增「切走再切回後最舊的輸出仍在」的斷言。**觀測管道改為 app 自己落盤的那份快照**（`<profile>/sessions/<id>.scrollback`，就是 `serialize()` 出來的 buffer）而不是「把畫面捲到頂再複製」—— 後者要送數百個滾輪事件，且「捲到底但沒到頂」會給出假紅；快照這條順帶覆蓋了本缺陷唯一跨重啟存活的後果。行寬取自 3.1 量到的欄數（不折行），行數 900（快照上限 1000 列）⇒ 重排成 2 欄約 14400 列 vs 上限 5000（實測 2.9 倍餘裕）。**對照組是「切走之前 `MARK_1` 就在快照裡」**（證明這條觀測管道本身有力氣）。驗證：兩條皆綠，detail 印出實際讀到的最舊標記與餘裕
- [x] 3.3 改寫既有的「mouse reporting 開啟時右鍵讓位給程式」斷言為**它的反面**，共四條：(a) 開啟時右鍵**仍開啟選單**；(b) 該事件**不送達 pty**（判準是 `cat -v > <file>` 的檔案內容，不得出現 SGR 的 `^[[<`）；(c) **通道對照組**：同樣狀態下**左鍵**必須抵達 pty；(d) 關閉 mouse reporting 時右鍵同樣開選單。**三個實測踩到的陷阱都要處理**：stub 必須連 `?1006h` 一起送（只送 `?1000h` 是 legacy 編碼，xterm 走 `onBinary`，而 wrapper 只訂閱 `onData` ⇒ 一個位元組都不會到 pty，(b) 恆綠）；`cat` 要以 Enter ＋ `Ctrl+D` 收（tty 是行緩衝、stdout 是檔案為全緩衝，`Ctrl+C` 會把證據丟掉）；讀檔前必須確認選單真的關掉（沒有選取時焦點落在「貼上」，Enter 會把剪貼簿灌進 pty）
- [x] 3.4 **對照組，每個獨立缺陷各一次**：分別退回 1.1、**2.1**、2.2，確認對應斷言真的變紅。**2.1 不可省略** —— 只退回 2.2 時選單照樣開得起來（gate 已經沒了，事件走 bubble 進 React 的委派 listener），3.3(a) 會是一盞假綠。**實測結果**：退回產品程式碼後 3 條變紅 ——「切走時尺寸不變」顯示中 `36 44`／隱藏中 **`1 2`**、「最舊的一行仍在」最舊只剩 **`MARK_568`**（900 行被毀掉 567 行）、「右鍵仍開啟選單」選單未開；(b) 則以 `^[[<2;36;19M` 證明舊碼確實把右鍵轉發給了 pty
- [x] 3.5 步驟之間確實把選單關掉：`MENU_IN_VIEWPORT` 以 `querySelector` 只取第一個，而本 change 之後兩個 `[role="menu"]` 可能並存（design D4 的已知取捨）。收尾的 `Escape` 改為輪詢到真的關閉；讀 pty 位元組之前那一次改走 `retryAction`（關不掉就拋，不靜默往下走）。驗證：`PROBE_ONLY=runMode npm run probe:terminal` 162/162

## 4. 文件

- [x] 4.1 `docs/lessons/terminal.md` 改寫「右鍵 gate 在 mouse reporting」該條（約 238–239 行）為新規則，記下否證舊前提的兩項實測（claude 啟動即送 `?1000h/?1002h/?1003h/?1006h`；xterm.js 未實作 OSC 52），並註明**那是選擇而非不可能**。**不要動到 243–251 行**（左鍵轉發與 `Ctrl+click` 開連結那段仍然正確且仍然重要）。驗證：該檔不再宣稱「讓位給程式使 claude 的右鍵貼上生效」
- [x] 4.2 `docs/lessons/terminal.md` 新增一條教訓：**一道讀上游函式回傳值形狀的守衛，其正確性不在我們的版控之內** —— 附 `@xterm/addon-fit` 0.11.0（回 `NaN`，守衛成立）與 0.12.0-beta.299（回 `{2, 1}`，守衛失效）的逐版比對，指出該升級（`d7d85fe`）一行 `.ts` 都沒改而九支探針全綠；並寫明擋住它的是什麼（3.1 的 winsize 斷言擋「上游又變了」，1.4 的守衛擋「我們自己多開一條路」）。驗證：該條寫得出「怎麼擋住它」，不只是「要小心」
- [x] 4.3 同一份文件記下**已經損失的內容無法回溯**，且明列**兩種**：被擠掉的 scrollback，以及**已經落盤的 2 欄快照**（下次開 app 仍會重播，直到該 session 被關閉或快照被覆寫）。驗證：兩種都寫在「隱藏的終端絕不可被 fit」那一節
- [x] 4.4 修正 `TerminalView.tsx` 約 103 行的註解 —— 「隱藏中的終端從未 `fit()` 過，它是以 **80 欄**重新序列化的」今天是 2 欄、修完是「保留最後一次真實量測」。**這句是「不覆寫休眠 session 快照」那道防護的理由**，理由寫錯下一個人就可以據此拆掉它。驗證：註解與修正後的行為一致
- [x] 4.5 修正 `docs/lessons/terminal.md` 約 50 行「代價是隱藏時 `FitAddon` 量到 0」—— 那是本缺陷的舊心智模型，留著會與 4.2 新增的那條互相矛盾。驗證：兩處敘述一致
- [x] 4.6 確認 CLAUDE.md 不需更動（右鍵與 fit 的敘述都住在 `docs/lessons/terminal.md`）。驗證：`git grep -n -I --no-color '右鍵\|proposeDimensions\|FitAddon' CLAUDE.md` 僅命中 `ContextMenu` 那條共用元件的敘述

## 5. spec 的落位

- [x] 5.1 archive 把新的「終端支援複製與貼上，且滑鼠路徑一律由終端擁有」寫進主 spec 之後（archive 會把它 append 到檔尾），把它搬到**原本那條所在的位置** —— 緊接在「session 的標籤反映 pty 設定的終端標題」之後、「讀取系統剪貼簿的能力僅在使用者明確要求貼上時使用」之前，使相關條款仍相鄰。**已完成**：archive 把它 append 到檔尾（第 731 行），已搬回原位 —— 現在緊接在「session 的標籤反映 pty 設定的終端標題」之後、「讀取系統剪貼簿的能力…」之前。`openspec validate --specs --strict` 33/33 通過

## 6. 回歸

- [x] 6.1 `npm test` 全綠（含 1.4 新增的守衛）—— 688/688
- [x] 6.2 `npm run probe:terminal` 全段綠（迭代時用 `PROBE_ONLY=runMode`）—— 282/282，十個段落全部「完整執行」
- [x] 6.3 `npm run test:e2e` 全套跑一輪 —— **9/9 全部通過、零紅燈**，確認九支的結果與改動前一致（本 change 動到共用的 `ContextMenu` 觸發路徑與焦點交還，`probe:files` 與 `probe:keyboard` 是必要的回歸）
- [x] 6.4 使用者實際 dogfood（走 `npm run dev`）確認：claude session 裡右鍵開得出選單且貼得上 ✓；切走再切回之後終端歷史完整、Write 的預覽不再逐行只剩開頭 ✓；**第三項當場被否決** —— 原本要確認「兩個選單並存時仍可操作」，使用者裁決「一般來說只能留最新一個才對」，於是改為 2.5 的修正並重測通過 ✓
