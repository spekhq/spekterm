## Context

見 `proposal.md` 的 Why。這裡只補實作要用到的現況與約束。

**尺寸這一側的關鍵事實：缺陷是被一次純依賴升級「靜默帶進來」的。** `xterm.ts` 的
`Number.isFinite` 防護在寫下的當時**是對的**，而它的正確性倚賴 `FitAddon.proposeDimensions()`
的**回傳值形狀** —— 那是上游的實作細節，不是它的契約。逐版比對（兩份都在本機驗過）：

| | 容器 `display:none` 時 `proposeDimensions()` 回傳 |
|---|---|
| `@xterm/addon-fit@0.11.0`（`^0.11.0`，本 repo 至 2026-08-18） | `parseInt('auto')` → `NaN`（`Math.max(0, NaN)` 仍是 `NaN`）一路傳到底 ⇒ **`{cols: NaN, rows: NaN}`** ⇒ 防護攔下 |
| `@xterm/addon-fit@0.12.0-beta.299`（`40943b2` 起） | 上游加了 `parseInt(...) \|\| 0` ⇒ 可用空間為負 ⇒ 夾到 `MINIMUM_COLS/ROWS` ⇒ **`{cols: 2, rows: 1}`** ⇒ **三道防護全部放行** |

那次升級（`40943b2`，2026-08-18，為了修游標閃爍計時器的外洩）**一行 `.ts` 都沒改**，
`npm test` 與九支探針全綠。**沒有任何載體在看「session 被隱藏時 pty 的尺寸」** —— 於是這個
缺陷在 master 上活了 14 個 commit，直到 dogfood 從畫面症狀反推出來。

**精確的觸發條件是「切走一個曾經顯示過的終端」。** `proposeDimensions()` 的第一道檢查是
`dims.css.cell.width === 0 → return undefined`，而一個**從未被排版過**的終端量不到 cell 尺寸，
於是走的是舊防護的第一道（`!proposed`）而非落進 `{2, 1}`。實務上兩者等價（session 顯示過才會被
切走），但**這使驗收的前置成為承重的**：載體必須先讓該終端真的顯示過，否則它驗到的是另一條路徑。

**滑鼠這一側的關鍵事實**：中鍵已有先例。`terminal-clipboard` 的第二次 dogfood 把中鍵改為在
**host 的 capture 階段**整顆接管（`mousedown` / `mouseup` / `auxclick` 一律
`preventDefault` + `stopPropagation`，並在 `mousedown` 做唯一一次貼上），理由是 bubble 階段
既晚於 xterm 自己的 listener、又打不到掛在 `auxclick` 上的瀏覽器原生貼上。右鍵的處境同型。

## Goals / Non-Goals

**Goals:**

- 終端的行列數與 pty 的 winsize，**只由一次真實的量測決定**；量不到就什麼都不做。
- 右鍵的歸屬**不再依 pty 的狀態而變**，與中鍵收斂為同一條規則。
- 兩者都留下**在缺陷回來時會變紅**的載體 —— 這次的根因就是沒有載體。

**Non-Goals:**

- 不處理「容器可見但極窄」。那是使用者主動要求的尺寸，與「不可見」是兩件事。**注意它是可達的**
  （見 Risks），只是不在本 change 範圍。
- 不動 `scrollback: 5000`。它放大了損失但不是成因，兩件事一起改會讓「修好了沒」無法判定。
- 不引入 OSC 52。這是**選擇**（`registerOscHandler` 是 xterm 的公開 API），不是能力上的限制。

## Decisions

### D1：fit 的判準改成「容器有沒有被排版出來」，而不是「回傳的數字合不合理」

`fit()` 在呼叫 `fitAddon.fit()` 之前，先量**容器自身的盒子**（`term.element.parentElement` ——
即 `handle.open(host)` 的那個 host，也正是 `proposeDimensions()` 讀 computed style 的那一個）：
`clientWidth` 或 `clientHeight` 為 0 就直接回 `null`。

**為什麼是這個判準**：`display:none` 的元素沒有 box，`clientWidth`／`clientHeight` **依定義為 0**
—— 這是 DOM 的契約，不是某個套件的實作細節。而「`proposeDimensions()` 會回什麼」不是契約
（上游已經改過一次，見 Context）。

**承重的細節：量的必須是同一個元素 —— 但不是同一個度量。** `proposeDimensions()` 讀的是
computed `width`／`height`（content box、可為小數、`parseInt` 無條件捨去），我們讀的是
`clientWidth`／`clientHeight`（padding box、**四捨五入成整數**）。host 目前沒有 padding，兩者
一致；但**它們不是嚴格等價**，日後若給 host 加上 padding，或在 0 < w < 1.5px 的窄縫裡，兩者會
分歧。**不要把這條寫成「等價」** —— 它成立的理由是「同一個盒子且目前沒有 padding」。

**替代方案與否決理由**：

- `offsetParent === null` —— 對 `position: fixed` 的元素也為 null；host 目前不是 fixed，但這條
  性質不在任何規格裡，日後改版面就會靜默失效。
- `IntersectionObserver` —— 非同步交付，而 `fit()` 是同步呼叫；且它回答的是「有沒有進入視窗」，
  不是「有沒有盒子」。
- 在 `ResizeObserver` 的回呼裡看 `contentRect` —— 只涵蓋 RO 那一條路徑；`fit()` 還有另外三個
  呼叫端（掛載、由隱藏轉為顯示、字型偏好變更）。**判準要放在唯一的那個匯流點。**

### D2：不採「把 `< 1` 放寬成 `<= MINIMUM_COLS`」

一行就能改完，而且這次會生效。否決它有兩個理由：

1. **那是黑名單，而且綁在上游的常數上。** `MINIMUM_COLS` 是 `FitAddon` 的內部 `const enum`，
   不在它的公開介面裡 —— 上游把 2 改成別的值，我們的防護就再次靜默失效。**這正是本缺陷的
   成因本身，換一個位置重演。**
2. **它會誤傷真實的窄終端。** 一個真的只有 2 欄的容器與「沒有盒子」在數字上完全相同，而正確的
   處置相反（前者該告訴 pty，後者不該）。判準必須問得出這兩者的差別，而**只有容器的尺寸問得出來**。

### D3：防護只施加在 `fit()` 一處，但那個結論倚賴三件事

`size()`（pty 誕生時把當下尺寸告訴它的那條路）不另設判準。理由是**結構性的**：D1 之後，
`term.cols/rows` 只可能是兩個來源之一 —— xterm 的初始預設（80×24，恰等於主行程
`INITIAL_COLS/ROWS`），或一次真實量測的結果。**壞值表達不出來**，於是 `size()` 不必自己再問一次。

**為什麼不「兩道都加比較保險」**：那會變成兩個必須保持一致的判準，而 CLAUDE.md 已經記著同型的
教訓（`#initialCwd` 與 `cwdOf()` 只放寬一道等於沒放寬）—— 兩道各自為政時，**分歧不會有紅燈**。

這個結論倚賴三件事，前兩件已查證、第三件要在本 change 補上：

1. **renderer 內只有一個匯流點**：`fitAddon.fit()` 全 repo 只有 `xterm.ts` 一處，
   `window.workspace.terminal.resize` 的呼叫端只有 `TerminalView.tsx` 的四處，renderer 內沒有
   任何直接的 `term.resize()`。**這是一個會被日後的改動打破的性質，因此由 D8 的守衛釘住。**
2. **主行程那一側不是防線，也不該是**：它只夾 `Math.max(1, …)` —— 2 與 1 都 ≥ 1，**它擋不住
   `2×1`**。這是對的（主行程看不到容器，沒有資訊可以判斷），但要寫下來，免得有人以為那裡有第二道。
3. **pty 的輸出不能自己改行列數** —— `CSI ?3h/l`（DECCOLM）與 `CSI 8;r;c t`（XTWINOPS）都
   gate 在 xterm 的 `windowOptions`，而 `grep -rn windowOptions src/` **一個都沒有**：我們靠的是
   上游的預設全 false。**這與 D7 的教訓是同一族**（守衛的正確性不在我們的版控之內），因此
   `xterm.ts` 要**明寫 `windowOptions: {}`** 並註明理由 —— 把一個預設值變成一個宣告。

### D4：右鍵由終端整顆接管，選單自 `mousedown` 開啟

移除 `onContextMenu` **整個 prop**（不是「只保留 `preventDefault`」—— 見下），並在 host 的
**capture 階段**接管右鍵（button 2）的 `mousedown` / `mouseup` / `auxclick` / `contextmenu`：
一律 `preventDefault` + `stopPropagation`，並在 `mousedown` 開啟選單。

**為什麼 `onContextMenu` 必須整個移除**：React 19 的委派 listener 掛在 root container（`#root`），
那是 host 的**祖先**。host 的 capture 一 `stopPropagation`，事件既不再往下、也不再冒泡 ⇒
**`onContextMenu` 永遠不會執行**。留著它裡面那句 `event.preventDefault()`（註解寫著「原生選單
一律擋掉」）就是留一段**會誤導人的死碼** —— 真正擋住原生選單的是新的 capture handler。

**為什麼不是「只把 gate 拿掉、繼續讓 xterm 轉發」**：選單既然一律開啟，同一次按鍵再送給程式就是
雙重作用 —— 中鍵當年踩過的正是這個（原生貼上 ＋ 我們的貼上 ＝ 貼兩次）。

**為什麼選單自 `mousedown` 開，而不是繼續依賴 `contextmenu` 事件**：`contextmenu` 由平台決定在
`mousedown` 還是 `mouseup` 上派送（Linux/GTK 與 Windows 不同）。依賴它，就等於讓「選單會不會被
自己開啟的那次事件關掉」取決於平台 —— 而 `ContextMenu` 現行的「延一個 tick 才掛 dismiss」正是
在賭這個時序。自 `mousedown` 開啟並把整顆按鍵的四個事件都攔在 host 之下，這個時序問題**表達
不出來**。（另外實測語意：`mousedown` 上的 `preventDefault()` **不會**取消 `contextmenu`，
所以四個事件都要列。）

**這也順帶修掉觸控板的路徑** —— 兩指輕點在 X11 上就是 button 2 的一組 press/release，與實體
滑鼠右鍵走同一條。

**三件會被這個接管改變的既有行為（都查證過）：**

- **xterm 的選取不受影響。** `SelectionService.handleMouseDown` 對 button 2 一律早退，
  **右鍵 mousedown 從來沒參與過選取** —— 攔掉零損失。（寫下來，否則下一個人會擔心這件事。）
- **會關掉 xterm 綁在 `contextmenu` 上的 `rightClickHandler`**（它做
  `moveTextAreaUnderMouseCursor`，目的是讓瀏覽器原生選單的貼上落在隱形 textarea 上）。我們本來
  就擋掉原生選單、貼上走 `term.paste()`，因此無損 —— 但這是一個確實被關掉的既有行為。
- **會讓兩個選單並存 —— 因此 `ContextMenu` 要一起改。** 先在分頁上右鍵開選單、再到終端右鍵，
  以前終端的 `contextmenu` 會冒到 window 把分頁那個關掉，攔在 host 的 capture 之後就不會了。
  **本 change 原本裁決「接受它」，dogfood 當場否決**：同時只能有一個選單，那是使用者對選單的
  基本預期，不是可以拿來換取實作簡潔的東西。
  **修法：`ContextMenu` 的 dismiss 增掛在 window 的 capture 階段 `mousedown`。** capture 由
  window 往下傳、**早於 host 的攔截**，因此那次右鍵一定收得到；落在選單自己身上的按下要放行
  （否則按在項目上時選單會先被卸載，那次 `click` 就沒有對象可觸發）。
  **不採「不攔 `contextmenu`、讓它冒上去關掉別人」** —— 那會把「選單會不會被自己開啟的事件關掉」
  重新交還給平台時序（Linux 派送在 down、Windows 在 up），而那正是本決策要消除的東西。

### D5：右鍵歸屬的依據是「今天沒有程式能用它做出有用的事」，不是「不可能支援 OSC 52」

`claude` 一啟動就開 mouse reporting，而它（以及任何 pty 內的程式）**讀不到系統剪貼簿**：xterm.js
未實作 OSC 52，本 change 也不打算加。於是「讓位給程式」讓出去的是一顆什麼都不做的鍵。

**不要把它寫成結構性不可能** —— `registerOscHandler` 是公開 API，加得上。這條 requirement 的
理由因此是**當下的能力事實 + 一個明說的選擇**，兩者都可被推翻，而推翻它的條件必須寫下來：

> **此裁決有前提。** 若日後 (a) 我們實作 OSC 52 的讀取，或 (b) `claude`／其他 TUI 開始以右鍵做
> **與剪貼簿無關**的事（選單、標記），本裁決即失效。屆時的退路是 `Shift+右鍵` 轉發給程式 ——
> 成本侷限於 `TerminalView` 的一個判斷 ＋ spec ＋ probe。**在那之前不預留這條路**：一條沒有人走、
> 也沒有人驗的路徑，是負債而不是彈性。

### D6：載體要覆蓋到每一條新增的 scenario，且觀測管道不得是本探針已經廢除的那一種

- **pty 的尺寸**：三次取樣（顯示中／切走後／切回後），**三次都要有斷言** —— 「切回顯示時尺寸
  仍然正確」是本 change 新增的 scenario，只斷言前兩次就是「補了 scenario、沒有覆蓋它」。
  前置**承重**：該終端必須先真的顯示過（見 Context 的觸發條件）。
  - **取值走 pty 自己**：對該 session `terminal.write` 一行 `stty size > <file>`，判準走既有的
    `waitForFile`。**不從外部讀 `/dev/pts`** —— `stty -F` 開檔不帶 `O_NOCTTY`（有把該 pts 變成
    探針行程控制終端的風險），且 `ps -o tty=` 的輸出還要自己補 `/dev/`。走 pty 是這支探針既有的
    型態，不引入新的外部指令。
- **輸出不遺失**：判準是 **app 自己落盤的那份快照**（`serialize()` 出來的 buffer），不是「把畫面
  捲到頂再複製」—— 後者要送數百個滾輪事件，而「捲到底但沒到頂」會給出**假紅**。這條管道順帶
  覆蓋了本缺陷唯一跨重啟存活的後果（被重排成 2 欄的內容會被寫進磁碟）。
  **劑量要有餘裕**：終端幾何會隨字級偏好與分界拖曳浮動，1.2 倍餘裕下「缺陷還在但這一輪剛好沒
  溢出」是可能的，而這是「行列數 SHALL NOT 改變」唯一的載體。行寬取自 winsize 那條量到的欄數、
  行數取 900（快照上限 1000 列），實測餘裕 2.9 倍。detail 要印出實際讀到的最舊標記。
  **對照組是「切走之前它就在快照裡」** —— 證明這條觀測管道本身有力氣。
- **右鍵不送達 pty**：判準是**檔案內容**（右鍵前讓 shell 跑 `cat -v > <file>`，檢查檔案裡沒有
  SGR 的 `^[[<`）。**不可以讀畫面上的 shell 輸入行** —— 那是「否定式斷言 ＋ 讀畫面」，正是本探針
  整段廢除 `TERMINAL_TEXT` 時記載的假綠形狀。
  **這條斷言實測連續踩了三個坑，每一個都讓它在缺陷還在時照樣綠 —— 三個都要寫進實作：**
  1. **stub 必須連 `?1006h` 一起送。** 只送 `?1000h` 是 legacy 編碼，而 xterm 把那種滑鼠回報送到
     **`onBinary`**（它可能不是 UTF-8 安全的），**而我們的 wrapper 只訂閱 `onData`** —— 於是一個
     位元組都不會進 pty。`claude` 實際送的是 `?1000h ?1002h ?1003h ?1006h`。
     > **順帶發現的產品缺口（不在本 change 範圍）**：只用 legacy 編碼的程式，其滑鼠回報**永遠到
     > 不了 pty**，因為 wrapper 沒有接 `onBinary` —— 而修它需要一條「保持位元組原樣」的
     > renderer → pty 管道，本專案目前沒有。**已開為 issue #34。**
  2. **`cat` 要以 Enter ＋ `Ctrl+D` 收尾。** tty 是行緩衝的（滑鼠序列不含換行，停在 line discipline
     裡），而 `cat` 的 stdout 是檔案 ⇒ stdio 全緩衝，`Ctrl+C` 會連緩衝一起丟掉。
  3. **讀檔前要確認選單真的關掉。** 沒有選取內容時「複製」是停用的，焦點因此落在**「貼上」**上
     —— 那次 Enter 會把剪貼簿的內容灌進 pty（實測抓到 770 位元組的畫面逐字稿，而斷言照樣綠）。
- **通道對照組**：同樣狀態下**左鍵**必須抵達 pty。沒有它，上面那條可能只是在驗「什麼都不會抵達」
  —— 而上述三個坑每一個都會製造那個假象。
- **對照組要涵蓋每一個獨立的缺陷。** 右鍵有兩個（拿掉 gate、capture 接管）：**只退回接管，
  選單照樣開得起來**（gate 已經沒了，事件走 bubble 進 React 的委派 listener）—— 那條斷言就沒有
  鑑別力。**兩個都要各退回一次。**

右鍵那側，既有的「啟用 mouse reporting 時右鍵讓位給程式」斷言**改寫成它的反面**，不是刪掉。

### D7：文件要記的是「守衛倚賴上游回傳值形狀」這一類，不是這一次的數字

`docs/lessons/terminal.md` 增訂：**一道讀上游函式回傳值的守衛，其正確性不在我們的版控之內**；
純依賴升級不會改任何 `.ts`，於是型別、單元測試與既有探針**全部照樣綠**。能結構性擋住它的不是
「升級時記得小心」，是 D6 的那條 winsize 斷言 —— 它會在同一件事再次發生時變紅。

### D8：把 D3 第 1 點從「一次性的 grep」變成一支守衛

D3 的結論倚賴「renderer 內只有一個匯流點」，而那是一個**日後會被打破的性質**。用一次性的
`git grep` 確認它，等於把整條論證交給「下一個人記得再 grep 一次」。

依本 repo 的既有慣例（`watcher-source.test.mjs` / `naming.test.mjs` / `typography.test.mjs`）加一支
`scripts/terminal-resize-source.test.mjs`。

**咽喉點是「套件的 import」，不是「`fit()` 的呼叫」**（實作時修正的：第一版擋「`xterm.ts` 之外
不得呼叫 `.fit()`」，它把 `TerminalView` 三處 `handleRef.current?.fit()` 判成違規 —— 而**那正是
匯流點被正確使用的樣子**）。真正要防的是「有人繞過 wrapper 自己拿到 `FitAddon`／`Terminal`」，
而那唯一的入口是 import；擋住它，`fitAddon.fit()` 出現在別處就**表達不出來**。比照
`watcher-source.test.mjs`：守的是建立入口，不是每一個呼叫點。

因此規則有四條：`@xterm/*` 的靜態 import、動態 import、wrapper 把它的**值**再導出（三者只准在
`xterm.ts`），以及對終端／pty 的 `.resize()`（只准在 `xterm.ts` 與 `TerminalView.tsx`）。

**順帶釘住一條沒有東西在守的既有慣例**：CLAUDE.md 記載「renderer 的其他模組一律不直接 import
`@xterm/*`，退守替代終端時改動侷限於此」，而 eslint 的 `no-restricted-imports` **只列了 monaco
與 chokidar**。那條慣例此前完全靠自律。

**它與 D6 的 winsize 斷言互補**：那條擋的是「上游又變了」，這支擋的是「**我們自己多開了一條
繞過 `fit()` 的路**」。兩者都不做的話，D3 的「壞值表達不出來」只是一句當下為真的描述。

## Risks / Trade-offs

- **[使用者已經損失的內容無法回溯]** → 本 change 只讓它不再發生。**這包含已經落盤的 2 欄快照**
  （下次開 app 仍會重播它）。要寫進文件，避免日後有人以為「修好之後歷史會回來」。
- **[「容器可見但極窄」是可達的，不是不可達]** → 實查版面（不是從設計推論）：`BrowserWindow`
  **沒有 `minWidth`／`minHeight`**；MainStage 內層兩個 `240px` ＋ separator 合計約 483px，
  **大於外層宣告的 360px**（內外兩層的 `minSize` 本來就對不起來）。視窗縮到總和以下時，終端 host
  會落到 240px 以下 ⇒ 十幾欄的 reflow ⇒ 一樣擠掉 scrollback。高度那條更近：MainStage 的
  `Group` 是 `flex-1`，CLAUDE.md 記著它拿不到剩餘空間時 `clientHeight` 直接是 0 —— **0 會被 D1
  擋住，3px 不會**（送 `rows=1` 給 pty，欄數不變故不重排，但 agent 以 1 列排版）。
  **這是一個已知且可達的缺口，本 change 不修**（Non-Goals），但它的理由不是「不可達」。
- **[選單並存]** → 已於 D4 修掉（`ContextMenu` 增掛 window capture 的 `mousedown`），不再是取捨。
  代價是**動到共用元件**：`ContextMenu` 是分頁右鍵、檔案樹右鍵與 spawn 選單共用的，因此
  `probe:files` 與 `probe:keyboard` 是必要的回歸。探針側仍保留「步驟之間確實關掉選單」的紀律
  —— `MENU_IN_VIEWPORT` 以 `querySelector` 只取第一個，那條脆弱性與並存與否無關。
- **[右鍵接管之後，pty 內的程式再也收不到右鍵]** → 見 D5 的推翻條件。
- **[上游再次改變 `proposeDimensions()` 的形狀]** → D1 的判準不再讀它的回傳值，且 D6 的 winsize
  斷言會在任何一次「隱藏即改尺寸」的回歸上變紅。
- **[`windowOptions` 日後被打開]** → D3 第 3 點的明寫宣告會讓那個改動是有意識的；但**沒有載體**
  盯著它（要盯得靠一條「pty 送 DECCOLM 之後行列數不變」的斷言，成本與收益不成比例）。
  **這是一個被寫下來、但不覆蓋的缺口。**
- **[`clientWidth` 觸發同步 layout]** → `proposeDimensions()` 本來就在讀 computed style，
  成本同級；且 `fit()` 已由 `ResizeObserver` 的 60ms debounce 節流。

## Migration Plan

無資料遷移、無持久化格式改動、無 IPC 改動。使用者重開 app 即生效；跑到一半的 session 不受影響
（pty 尺寸會在下一次顯示時被 `fit()` 修正）。回退＝還原這幾個檔案的改動，不留任何殘留狀態。

**唯一的例外是已經落盤的快照**：它會在下次開 app 時被重播，直到該 session 被關閉或其快照被一次
新的（正確寬度的）序列化覆寫。這不需要遷移程式碼，但需要寫進文件。
