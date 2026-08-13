# 驗收與探針

本 repo 最貴的一份教訓集。**幾乎每一條都是「它曾經是綠的，而它測的不是它自稱在測的東西」。**

> 這份文件是 `CLAUDE.md` 的延伸。**它與 CLAUDE.md 同一個定位：**
> 幾乎每一條都是「不知道就會踩、而且失敗是靜默的」的實測結論。
> 觸發條件（什麼時候該讀它）寫在 CLAUDE.md 的「踩雷指南」。

## 探針預設跑在虛擬螢幕上

`scripts/run-probe.mjs` 把它們包進 `xvfb-run`（需 `sudo apt install xvfb`；缺了它會**明確失敗並說明
怎麼裝**，不會靜默改用你的螢幕）。CDP 的 `Input.dispatchMouseEvent` 注入的是 Chromium 的輸入管線、
與 X server 無關，換螢幕對探針而言是透明的。

**逃生口不是可有可無的。** 虛擬螢幕沒有 GPU，探針以**軟體 GL** 執行（`--enable-unsafe-swiftshader`
`--use-angle=swiftshader`，由 `scripts/lib/display.mjs` 統一供應）。**它證明得了渲染資源的生命週期，
證明不了畫素** —— 框線相不相接、粗細一不一致只有真實驅動看得出來。`terminal-sessions` 已把這條寫成
規格：**自動化驗收通過 SHALL NOT 被詮釋為「程式化繪製的呈現是正確的」**。那一類問題由 dogfood 認定。

> 少了那兩個旗標，整條 GPU 路徑會**靜默地不被驗到**：context 取不到 → app 正確地降級為 DOM
> renderer → GPU 斷言全紅。那個紅是環境造成的，而「為此把斷言放寬」等於把交付從驗收中移除。

## 探針的幾個環境事實

- **`probe:identity` 不傳 `--user-data-dir`** —— 它要驗的正是 `app.getPath('userData')` 實際解析出來
  的路徑，那個旗標會覆寫掉待驗的對象。它啟動真正的 `electron .` 再從**子行程的 argv** 讀（寫成
  Electron 主行程腳本的話，`electron <script>` 不讀 repo 的 `package.json`，只會量到預設值 `Electron`）。
- **`probe:files` 自己起 renderer dev server（`--rendererOnly`）再自己 spawn electron** ——
  `electron-vite dev` 產生的 electron 是孫行程，殺 `npx` 殺不到（留下佔 port 的殭屍），且它轉發 CLI
  參數的 `ELECTRON_CLI_ARGS` 實測未生效，探針會讀到你真實的 workspace 設定。
- **`probe:workspace` 以 `--user-data-dir` 指向暫存 profile**，因此可反覆重啟、餵它損毀的設定檔。
- **`scripts/probe-*.mjs` 一律透過 CDP 或真 Electron 主行程驗收，不在產品程式碼裡塞測試分支** ——
  要驗的正是被出貨的那份。撰寫 Electron ESM 主行程時**不可 top-level `await app.whenReady()`**
  （ready 要等主 script 評估完才觸發，會死鎖）。

## 假綠的來源與唯一的解藥

**對照組是唯一擋得住假綠的東西** —— 把修正退回、確認測試真的變紅。這個 repo 每一條重要的守衛都
這樣驗過，而幾次沒這樣驗的，全部是假綠。

已經實際發生過的假綠（每一條都全綠過一輪以上）：

- **Enter 併進 `Input.insertText` 的文字裡送出** —— 字元確實抵達 pty（**終端上看得到回顯**），但
  shell **從未執行那一行**。xterm 的換行是在 keydown 上判讀的。**Enter 必須是一次真的 keyEvent。**
- **斷言不能區分「回顯」與「執行」** —— tty 會回顯輸入行，`echo COLS=$(stty size)` 在執行**之前**
  畫面上就已經有 `COLS=` 了。要用「回顯不含答案」的形式：`echo OUT_$((6*7))`、`echo CWD=$(pwd)`。
- **`.xterm-rows` 讀不到時回空字串、不丟錯** ⇒ **否定式**斷言（「被攔下的按鍵沒有流進 pty」）
  在瞎掉的情況下**繼續發綠燈**。
- **`cat -v` 不 escape Tab** ⇒ 檢查 `^I` 的那條**從來沒有生效過**，而它守的正是 `Ctrl+Tab`。
  用 **`cat -A`**（＝ `-vET`）。
- **`count >= 1` 驗不到「下拉列出系統字型」** —— 只有「系統預設」一個選項時 count 就是 1，
  `listMonospaceFonts` 整個壞掉回空陣列它照樣過。
- **反面測試看起來像壞情況，不代表它擋得住壞實作。** 誘餌 `docs/openspec/notes.md` 對正確版與鬆綁版
  **同解**（`openspec` 之後只剩一段，兩者都回 `null`）—— 誘餌**必須帶 `changes/` 或 `specs/` 那一
  層**。而 `<root>-suffix` 擋得住鬆綁版卻擋不住 `startsWith` 版，擋得住後者的是**正面**案例（清單
  同時有 `…/wt` 與 `…/wt-a`，開後者底下的檔案）。**一個反面案例的價值不在於它看起來是個壞情況，
  而在於它能不能區分正確與錯誤的實作。**
- **「重建後新 shell 的輸出看得見」驗不到 alt buffer 的 bug** —— 卡在 alt buffer 裡的 shell，它的
  輸出照樣看得見。有鑑別力的判準是「**normal buffer 裡的歷史看得見**」。
- **`replayed.includes('MARK_42')` 驗不到畫面被弄壞** —— `MARK_42` 確實還「在」（雖然變成 `RK_42`
  且跑到分隔線後面去了）。**順序也要驗。**
- **「複製出來比對文字」對字元寬度零鑑別力** —— 一個字元少佔一格時**字元序列完全不變**。判準必須
  取自 cell 佔用的可觀察後果（游標前進的格數、或同排版各行的右緣）。**這條寫進了 spec 的規範性
  段落** —— 它是這條要求永久的驗收陷阱。
- **「關掉 GPU 加速不遺失內容」判準「複製回來的文字非空」幾乎沒有鑑別力** —— 它其實只是在確認
  非同步抵達的 shell prompt 畫出來了沒。改成切換前自己寫入一段標記。
- **`worktree ≤ 1 時 core 靜默退回非聚合`** ⇒ fixture 若 `git worktree add` 失敗，每一條斷言仍會
  通過。關鍵是成對的**反向**斷言（「那些 change 確實不在主工作目錄底下」）。同型的還有「來自
  worktree 的 change 標示分支」要配「**來自主工作目錄的不標示**」、「邊界外的不提供入口」要配
  「邊界內的**有**」。
- **「恰好 1 個工作目錄的 git repo」這條路徑一次都沒被走到**（`probe:files` 的 fixture 非 git，
  `probe:openspec` 的有 3 個）—— 上一條的變體，**分歧點落在 0 與 1 之間**。
- **`nodeIntegration: true` 的量測 harness 得出了與產品相反的結論**（見「量測 harness」）。
- **驗收數字要連分母一起看。** `runContinuation 3/3` 曾被寫進紀錄，而那一段每個模式有 3 條、
  **兩個模式共 6 條** —— 3/3 表示當時**只跑了一個模式**。`N/N` 只說「跑到的都過了」。

## 探針證明不了的事 —— 寫明，不要留假綠

| 驗不到 | 為什麼 |
|---|---|
| 真實鍵盤抵達得了 renderer | CDP 注入 Chromium 的輸入管線，**繞過**作業系統與瀏覽器的 accelerator 層。（X11 的 XTEST 合成注入在本機也被環境擋掉了：送一顆 `a`，收到 0 個 KeyPress。） |
| OSC 8 連結的激活 | 注入式滑鼠事件驅動不了 DOM renderer 的 hit-test 與 Linkifier2 的 hover 追蹤。**對照組證明了那條斷言是假綠**（把 `linkHandler` 整個移除，仍然全綠）。 |
| 中鍵只貼一次 | CDP 的合成滑鼠事件**不觸發** Chromium 的原生中鍵貼上。 |
| 原生 `<input>` 的文字選取 | `rawKeyDown` 跳過預設動作，`keyDown` 的編輯命令來自平台的 key-binding 層。兩種送法選取長度**都恆為 0**，與 app 有沒有攔截無關。 |
| 主行程有無 uncaught exception | 不傳到 renderer，且 headless 下拋了也不整個崩潰。 |
| session 重建後仍在該 worktree | 那一段的 session 是**繞過 renderer** 以 IPC 建的，而持久化靠 renderer 推送 —— 它們從不進 `sessions.json`。 |
| preload 的簽名改變 | `probe:shell` 比的是 key 的集合差。**contextBridge 複製函式時把 `Function.length` 抹成 0**，`create.length` 釘不住參數個數。 |
| 程式化繪製的呈現是否正確 | 虛擬螢幕是軟體 GL。已寫進 `terminal-sessions` 的規格。 |

**這些缺口由 code review + design 承擔，並在原處寫明理由。** 移除假綠斷言好過留一盞測不到自己宣稱
在測的東西的綠燈。

## 用真事件，不要用 `dispatchEvent(new MouseEvent(...))`

合成事件不走完整的 pointer/mouse/contextmenu 序列，也不觸發 React 19 對 trusted discrete 事件的同步
effect flush。實測踩過：右鍵選單用合成 `contextmenu` 測「全綠」，但真右鍵完全開不起來 —— 開啟選單的
那次事件冒泡到 window，被選單自己的 dismiss listener 當場關掉。而「用選擇器 `.click()` 選單項」會
跳過定位，選單溢出 viewport 也照樣通過。

**右鍵／點擊要用 `Input.dispatchMouseEvent`，並斷言選單的 `getBoundingClientRect()` 完整落在
viewport 內。**

- **`Enter` 必須用 `keyDown` + `text`，不能用 `rawKeyDown`** —— `<button>` 是靠 Enter 的**預設
  動作**被觸發的。其餘帶修飾鍵的按鍵則相反，要用 `rawKeyDown`，否則 `keyDown` 附帶的 `text` 會在
  終端上多打一個字。
- **送真滑鼠事件，就得自己面對座標會過期。** pty 宣告的 OSC 標題比 session 晚到**很多**（實測一秒
  以上），標題一到分頁標籤寬度暴增，把「+」往右推 **150px** —— 探針量到的座標在幾毫秒內過期，
  **症狀看起來卻像「產品的選單壞了」**。兩道防護要一起上：`stableRect`（連續數次量到同一位置才算數，
  **取樣窗口必須跨過標題的延遲** —— 只量兩次、間隔 150ms 會落在抵達前的**假平靜期**裡），以及
  **點完確認選單真的開了，沒開就重量再點**。
- **終端的左緣正好是 resizable panel 的分界器。** 從 `.xterm-screen` 的左上角起拖，抓到的是分界器：
  選取是空的，**而且側欄被拉開、版面永久損毀** —— **一次錯誤的拖曳讓後面六個對照變體全部誤報失敗**。
  **正解：反向拖曳**（右下角元素內 → 左上角第 0 格內）。
  > **抓出它的是「把已知成功的變體排到已知失敗的之後 —— 它也失敗了」** ⇒ 座標不會因執行順序而改變，
  > 那一定是污染。
- **xterm 把座標四捨五入到最近的 cell 邊界**（cellW ≈ 9.6，過半進位）。終點要 `+2` 才落在第 0 格。
- **CDP 的 Escape 在「以 `evaluate` 點過 overlay 內的元素」之後送不進去**（產品沒問題，dogfood 確認
  真鍵盤關得掉）。要在探針裡收掉 overlay，用它的關閉按鈕。**而這個坑會偽裝成別的東西**：後續的
  真滑鼠操作點不到，然後 **throw 而不是回報紅燈** —— 整支探針從那裡中斷，看起來像「選單壞了」。

## 觀測管道必須是 renderer-agnostic 的

`.xterm-rows` 只存在於 DOM renderer。三條替代管道，**而且都比它強**：

| 測什麼 | 管道 | 為什麼更強 |
|---|---|---|
| pty 行為（輸入、cwd、cols、貼上） | **讀檔**（`echo X > f` → 讀檔） | 能**區分回顯與執行** |
| 畫面內容（scrollback、重播、alt buffer） | **產品自己的複製路徑**（拖曳選取 → 複製 → 讀剪貼簿） | 跨 renderer 不變；且**把折行接回邏輯行** |
| 字級 | **pty 的 `cols`**（固定寬度下字級 ↑ → cols ↓） | 證明字級真的改變了 **pty 的幾何** |

- **DOM 上沒有任何可用的字級訊號。** `.xterm` 的 computed `fontSize` **恆為 `16px`**、
  `.xterm-helper-textarea` **恆為 `13.3333px`** —— 而它們**剛好接近正確值**，換上去就是一條永遠通過
  的假綠。
- **加新的觀測點時，順序是承重的：先改觀測點、在舊 renderer 上驗到全綠，再換 renderer。** 這樣
  「改寫弄壞了什麼」與「換 renderer 弄壞了什麼」才分得開；反過來做的話，任何一條紅燈都有兩個嫌疑犯。
- **驗偏好不能直接打 `settings.*` IPC** —— 偏好的權威在主行程的 store，但 renderer 是靠
  `PreferencesProvider` 的 state 驅動 effect 的，而那個 state 只在走使用者路徑時更新。直接打 IPC →
  store 變了、renderer 沒變 → 一度被當成產品 bug。**偏好沒有推送通道，而那是對的**（單視窗、唯一
  的寫入者就是設定對話框）。
- **`pollUntil` 只吃 `evaluate` 的字串表達式**，讀終端內容是一連串真滑鼠動作 —— 要輪詢它得用
  `pollUntilText()`（吃一個取值函式）。

## 別拿方便取得的量當代理判準

**一般形式：一個方便取得、看起來相關的量，不等於規格真正在乎的那個量。** 已經咬過四次
（最近一次是**量測腳本自己**：把每個呼叫的**最後一個引數**當成時限來加總等待預算，於是
`waitForPtyCount(marker, 1)` 的 `1` 被算成 1 毫秒、多行呼叫又被切錯而誤用預設值 —— 兩個方向的
錯誤剛好把總和推到「超過段落時限」那一側，而結論看起來成立。**依參數位置取值，不要依位置順序猜。**）：

- **「隱藏的終端底下有沒有 `<canvas>`」** —— 其中一顆是 `TextureAtlas._tmpCanvas`（glyph 光柵化的
  暫存畫布，**不帶 GPU context**），而 **atlas 由 `charAtlasCache` 跨終端共享**，那唯一的一顆會被
  搬到「最近一次光柵化 glyph 的那個終端」底下。**DOM 節點只有一個 parent，所以總數恆為 3：它從來
  沒有多出來過，只是換了個 parent。** 紅或綠只取決於「切換之後顯示中的終端有沒有再光柵化過新字元」
  —— 一個**穩定**的狀態，輪詢等不掉。**失效方式是兩個方向都錯**：真的洩漏時可能沉默，一切正常時
  卻間歇報錯 —— **而後者誘使人把它當成 flaky 而忽略它**（我先判成「時序 flaky」、再判成「穩定的
  資源殘留」，兩次都錯，還把它寫進了這份文件）。
  - **正解是問「這個終端當下走哪一條渲染路徑」**：程式化繪製 ＝ 有 `canvas.xterm-link-layer` 且無
    `.xterm-rows`；倚賴 glyph ＝ 反之。**不要改成「數 canvas 但排除 `_tmpCanvas`」** —— 那是把判準
    綁在 xterm 的內部實作細節上。**判準寫進了 spec 而不只是 probe**：規格說「持有渲染資源」，就得
    說清楚那在外部如何觀察。
  - **驗收要兩個方向都有**：不只「隱藏的沒有」，也要「顯示中的有」。先前那條之所以能長期紅著而沒人
    發現是判準的問題，正是因為它只看隱藏的那一半。
  - **「共用暫存物不構成證據」那條 scenario 以注入構造，不等它自然發生** —— 等待版沒有鑑別力。
- **「版本字串在不在清單裡」** 是「字元寬度對不對」的代理。
- **「同步 API 未被呼叫」** 是「不阻塞主行程」的代理 —— 而 ESM 的具名匯入不經屬性查找，
  `mock.method` **攔不到它**，那條斷言在同步實作下照樣是綠的。改為驗**性質**：讓出一個完整的
  event loop tick，斷言它**還沒完成**。

> **追到底的方法是攔截 DOM 的插入 API 取建立堆疊**（`MutationObserver` 給不了：它的 callback 是
> 非同步的，堆疊只會指向 observer 自己）。而 `appendChild` 只是插入路徑之一 —— `_tmpCanvas` 走的是
> `append()`，只包 `appendChild` 會什麼都抓不到。
> **一個「沒有 class 的 canvas」不等於「我以為的那顆沒有 class 的 canvas」。**

## 儀器：等待落空是靜默的，而那是耗時的主要去向

**動 `scripts/lib/instrument.mjs`、加一種等待、或想知道「這一段為什麼跑那麼久」之前，先讀這一節。**

一支探針花掉的時間有兩種去向，**它們要修的東西完全不同**：

| 去向 | 徵狀 | 器材 |
|---|---|---|
| 幾個等待**落空**，各自燒滿自己的窗口 | 少數幾條紅燈，其餘正常 | `pollFor` 在窗口耗盡時印的那一行 |
| **每一步**都變慢 | 每一區都稍微久一點，沒有明顯的兇手 | `check()` 行首的耗時與 **CDP 往返次數／總耗時** |

實測基準（`probe:terminal` 的 `runMode`，issue #21）：最壞等待預算（各次等待時限的總和，**含它
呼叫的輔助函式**）約 575 秒，固定 `sleep` 只佔約 4%；而該段在 dev 觀測到 **771 秒**。**兩者的
差距證明「等待落空」解釋不了全部** —— 至少一百多秒是真實的每步延遲，而那正是往返計時要抓的東西。

四條實作紀律：

- **所有等待走 `pollFor`，由 `scripts/wait-source.test.mjs` 擋住手寫的迴圈。** 判準涵蓋兩種形狀
  （時限寫在迴圈條件、寫在迴圈體內），**因為兩種在這個 codebase 都真的存在過** —— 只擋第一種的
  守衛會在對照組上如期變紅，卻放過現況裡的那一份。
- **`pollFor` 逾時不拋錯，回傳最後一次讀到的值。** 既有斷言倚賴這一點才能把該值印進 detail
  （`cols 68 → 68` 就是這樣得到的）。要「等不到就不該繼續」的呼叫端（`waitForPageTarget`）
  **自己在返回後拋**。
- **`tolerateErrors` 的語意是「只有最後一次讀取仍失敗才拋」**（成功讀取即清掉上一個例外）。
  寫成「窗口內出現過例外就拋」會把一條紅燈換成一次段落中斷 —— 兩者在程式碼上只差一行。
  **`lastError` 因此不給初值**：給了會被靜態分析判為無用賦值，而「清理」掉它就等於改掉語意。
- **累計以段落 token 歸屬。** 逾時的段落**不會被中止**（JS 中止不了執行中的 Promise），它會繼續
  呼叫 `check()` 與 `pollFor()`；少了歸屬，殘留活動會切碎**下一個**段落的數字，而下一個段落是
  無辜的。丟棄的只有耗時歸屬，`results` 照舊寫入 —— 動它就動到了斷言本身。

## 複合條件的斷言：detail 不是裝飾，而 `MOUNTED` 是那個教訓的本人

一條沒有 detail 的複合斷言，失敗時等於什麼都沒說。`Ctrl+Tab` 為無操作的那兩條之中，一條印出
`shell 1 → shell 1`（於是可推得紅的是另一個子條件），另一條**完全沒有 detail**，三個條件哪個
不成立無從得知（issue #19）。守衛在 `scripts/check-detail.test.mjs`。

- **判準是「條件裡有 `&&`／`||`」，且下鑽巢狀函式與 IIFE。** 它會漏掉等價的寫法
  （`Boolean(a) === Boolean(b)`），但**不會誤判** —— 一個會誤判的守衛遲早會被加上例外開關，
  而例外開關會被用在不該用的地方。
- **守衛連「自訂的斷言函式」一起擋，那是它的前提而不是順手的整理。** 曾有兩支探針各自定義三引數的
  `check(name, passed, detail)`，於是「第三引數是條件」在它們身上指到的是 detail —— 守衛因此
  **同時誤判與漏判**（把一個 detail 裡含 `||` 的合格斷言報成違規，卻放過兩條真正的違規）。
  **一個判準會因為呼叫端的簽名而指錯位置，那不是誤差，是這道守衛沒有定義域。**
- **`MOUNTED` 求值為子條件的物件（`{ ok, rail, root, visible }`），detail 由 `describeMounted()`
  從同一個值算出。** 「renderer 不見了」與「視窗被判定為不可見」是兩個完全不同的病。
- **detail 必須與判定同源。** 事後補一次求值讀到的是**下一刻**的狀態，而它完全可能已經恢復；
  一個指向「沒有失敗的現場」的 detail 比沒有 detail 更糟。`describeMounted` 因此**只吃已求值的
  物件、拿不到 client** —— 讓那件事在結構上不可能。
- **改判定的型別時，`grep MOUNTED` 找不到全部。** `launch()` 把輪詢結果存成欄位回傳，於是有九處
  寫的是 `app.mounted === true` / `remounted === true`，**完全不含那個字**。其中三處的 detail 是
  `app.mounted ? '' : app.stderr()` —— 換成物件後**恆為 truthy**，啟動失敗時的 stderr 診斷會靜默
  變成空字串。**一個以「讓失敗說話」為目的的改動，第一個副作用差點是把啟動失敗的現場弄丟。**

## 一支永遠紅的探針等於沒有探針

`probe:shell` 的「fs 介面只暴露已定義邊界要求的能力」曾自 **Phase 3 起紅了很久** —— 它還在斷言
「不得有 `writeFile`」，而 Phase 3 正是加入寫入能力的那個 change。**探針的斷言會隨規格過期**：
加能力到 preload 白名單時，記得那裡有一道守衛在等著（那份白名單本身是刻意的 —— 每加一個名字，
都得先有一條 requirement 定義它的邊界）。

> **同一件事後來又發生了一次，且是 `test:e2e` 的第一次跑抓到的。** 某個 change 往 preload 加了三個
> method，**沒動 `probe-shell.mjs`，而它從頭到尾沒跑過 `probe:shell`** —— 於是白名單守衛帶著兩條
> 紅燈被封存了。**「這次沒改到那塊」不是不跑的理由**：白名單守衛守的正是「你加了東西卻沒告訴它」。
> **這是 `test:e2e` 存在的理由** —— 單支入口讓人只跑自己改到的那幾支，而漏掉的那幾支正是會抓到你
> 的那幾支。

同源的還有三種：

- **`probe:workspace` 曾以那顆 `◈` 指示鈕識別 rail 的每一列** —— `◈` 一移除，rail 的列數就變成 0，
  五條斷言連帶全紅，看起來像「rail 壞了」。
- **探針的內容斷言也會過期，不只選擇器。** 比對 UI 上**文字**的那些（`/尚未選擇 repo/`、`/過大/`、
  選單項名稱、模式名稱、重播分隔線的字樣）換文案就全紅。**但要區分文案與 fixture**：探針自己寫進
  markdown 檔的內容改了才是錯的。
- **一個新行為會讓既有段落靜默過期。** `openFileFromOpenSpec` 開始把樹根切到目標所在的工作目錄之後，
  **任何「先跨身分跳去看 worktree 的檔案、再以 folder 根座標展開別的路徑」的既有段落，第二步會靜默
  落空** —— 實測一次紅 15 條，而其中兩條「不提供入口」反而**變成假綠**（檔案根本沒開）。
  修法是加一個走產品自己選擇器路徑的重置助手，並在受影響的段落前呼叫。

## 追 flaky：它往往是**問錯了問題**，不是機器太慢

加重試或延長逾時是錯的處置 —— 那只會把「斷言問錯了問題」偽裝成「機器比較慢」。

**方法**：先問「它是不是每次都在同一個地方失敗」，再**把懷疑的中間狀態變成獨立的斷言**（「按下前
pty 已存在」「切換前終端裡確實有已知內容」「檔案到底寫出去了嗎」）。那些斷言不是用完就丟的鷹架 ——
留著它們，下次同一個前提被破壞時會**直接指出是前提壞了**。

實例：
- **stub claude 的 `logInput` 分支以 `exec sh -c 'tee -a log | "$SHELL" -i'` 收尾** —— 那個 `sh` 的
  stdin 是**管線而不是 tty**，session 數秒內就變成「已結束」，於是整段一直是一場**競態**。加上
  「pty 已存在」的斷言之後，才看見 session 其實**自己結束了**。改成 `exec cat >> <log>`。
- **「順序於重啟後一致」在重啟後只量一次** —— `app.mounted` 只保證 rail 的 `<aside>` 掛上了，
  **列本身來自一次非同步的 `folders.list()`**。讀到空陣列 → 比對失敗 → 而 detail 也是空的，
  **看起來像「順序錯了」，其實是還沒畫出來**。同一支探針第一次啟動時本來就是輪詢的，**只有重啟那條
  路徑漏了**。
- **`pollUntil` 的條件必須是「要的那個值出現了」，不能是「有東西了」** —— Timeline 的分組在關係圖
  抵達之前是 `["(no topic)"]`，長度 1 也滿足 `list.length > 0`。

> **flaky 的驗證要連跑，不能只跑一輪。** 第一輪 9/9 全綠時我已經準備收工了。

**已知未解的偶發有兩條，撞到時先單獨重跑確認，不要當成自己剛改壞的**：`probe:terminal` 的
「持久化檔案損毀」（**#8**，單獨連跑為 1 紅 1 綠）、`test:all` 於 app relaunch 時 CDP WebSocket
連線失敗（**#7**）。**它們記在這裡就是為了不再被重新調查一次** —— 一條沒有被追蹤的已知紅燈，
下一個人只能從頭查起。

> 原本還有第三條（`probe:terminal` 一次拖曳失手就整支中斷，**#6**）—— 已於
> `probe-failure-attribution` 修掉：重試收進 `readTerminalText` 自己，六個呼叫站點都不必記得。

**而診斷要往下走一層，不要在最貴的那一層重試。** `panel-coordinate-per-folder` 的一條驗收紅了
四輪，我連續提出三個言之成理又有旁證的假設（chokidar 的初次掃描窗口、新目錄看不見、inotify
instance 耗盡），三輪探針約 30 分鐘全花在懷疑產品 —— 而真因是探針自己 `runMode` 裡一個同名的
`const derived` **遮蔽**了 fixture 路徑，檔案被寫進了 repo 的工作目錄，**答案在探針行程裡一行
`existsSync` 就有**。**「把中間狀態變成獨立斷言」這條要回頭套用到最上游的前置條件。**

## 有些東西驗收工具本身量不到 —— 換工具，不要換斷言

- **驗 CSP 的 inline-script 阻擋，不能用 CDP 動態插入 script。** `Runtime.evaluate` 注入的程式碼
  **繞過頁面 CSP 的 script-src**（DevTools 的設計，否則無法在嚴格 CSP 頁面除錯），那段 inline script
  **會**執行 —— 不管政策對不對都給假結果。改從 `securitypolicyviolation` 事件的 `originalPolicy`
  端到端讀出**實際施加的政策**。**擷取它需要一個一定被擋的請求去觸發違規** —— 圖片放行後不再是
  觸發源，改用 `fetch` 一個遠端主機（`connect-src 'self'` 擋下）。遠端圖片則反過來驗「**不**引發
  `img-src` violation」—— 這條也擋得住「又改回封鎖圖片」的回歸。
- **`document.elementFromPoint()` 會跳過 `pointer-events: none` 的元素**（它回的是「**會收到指標
  事件**的最上層元素」）。拿它去量一個 `pointer-events-none` 的提示，永遠只會拿到底下的東西，
  **不管修沒修**。
  > **順著這個坑反而問出一個對的產品決定**：「這個 session 恢復不了」的提示不該是
  > `pointer-events-none` —— 讓它接住指標事件，`elementFromPoint` 也就成了真正的 hit-test。
- **`node:test` 進不去「載入時就 `import { ipcMain } from 'electron'`」的模組。** 行為住在 IPC
  handler 裡時，**把 `strict: true` 改成 `false` 不會有任何紅燈** —— 因為那條測試根本不存在。
  **修法不是改標籤，是把載體做出來**：解析抽成純函式（於是測得到），並斷言**列舉未被呼叫**
  —— 那是「空集合短路」與「列舉後沒命中」唯一的差別。

## 插入新斷言：三件事都會靜默毀掉既有測試

探針是一串按時序流動的狀態機，每段對狀態有明確的假設。

- **寫死絕對數字必死。** 「repo-a 有 3 個 session」實測是 4 —— 中間某段為了驗 Enter 而**多建了一個**。
  改為相對數字（`nBefore` 存下來），前面段落淨變化多少都自我修復。
- **位置是承重的。** 插在中間會弄壞依賴 `shell 1` 存在的後續段落（`nextOrdinal` 單調遞增，關掉不
  重用）。**插在 runMode 最後、finally 之前。**
- **插入的段落要把狀態還原**（身分、視圖、工作目錄）—— 不還原的話下一段既有驗收會整段紅，看起來
  像那一段壞了。**而新段落也不該假設前面每一段都還原了** —— 它自己建一個 session 當前置。

## 探針自身的坑

- **`pkill -f` / `pgrep -f` 會匹配到你自己那條命令。** pattern 寫在 command line 上，而 `-f` 比對
  的是整條 command line —— 它會把執行它的那個 shell 一起殺掉。**症狀是背景命令的輸出檔是空的、
  exit 1** —— 看起來像「probe 失敗了」，其實 probe 一秒都沒跑。把 `-` 或 `/` 包成字元類別即可自我
  豁免：`pkill -9 -f 'spekterm[-]files-profile'`。同理計數要用
  `ps -eo cmd | grep -c '[e]lectron/dist/electron'`。
- **收尾殺行程時，殺 wrapper 殺不到它 spawn 的真行程。** `node_modules/.bin/electron` 是 node
  wrapper，`npx electron-vite dev` 的 vite 也是孫行程 —— 對 wrapper 送 SIGTERM，底下的真行程會變
  孤兒，繼續佔著自己那個 debugging port（配置見 `scripts/lib/ports.mjs`），讓下一輪 probe 連到殭屍而讀到空樹（實測：一連串失敗看起來
  像 regression，其實是殭屍）。**兩種收法**：electron 以獨一無二的 `--user-data-dir=<profile>` 用
  `pkill -9 -f <profile>` 連根拔除；dev server 以 `detached: true` spawn 成 group leader 再
  `process.kill(-pid)`。**另外，面板留有未存變更時關閉會觸發原生對話框，它會擋住主行程訊息迴圈使
  SIGTERM 失效** —— 這也是必須連根拔除的理由。
  **`probe:files` 的每次失敗若伴隨「樹是空的」，先 `pgrep -f spekterm[-]files-profile` 檢查殭屍。**
- **環境串擾**：剛跑過 `npm run dev` 的 shell 會繼承 `ELECTRON_RENDERER_URL` 等變數，之後起的
  electron 一律讀到它 —— **CSP 的 build 模式會拿到 dev 政策**，看起來像產品 bug。
  `env -u ELECTRON_RENDERER_URL -u NODE_ENV_ELECTRON_VITE -u ELECTRON_MAJOR_VER -u ELECTRON_CLI_ARGS
  -u ELECTRON_EXEC_PATH -u npm_lifecycle_script npm run probe:files`。
  **這是跨 change 的紀律**：dogfood 中途要跑 probe，先確認 dev 是否還在跑並清 env。
- **對已 `close()` 的 CDP client 呼叫 `evaluate`，會無限等待。** `send` 是靠 message id 配對 resolve
  的 —— WebSocket 關掉之後那個 Promise **永遠不會 resolve：不拋錯、不逾時**。而**症狀看起來像
  「Electron 啟動很慢」**。量測要併進 `PROBE_EXPRESSION`。
- **在模板字串裡寫註解，反引號會把字串提前結束。** 這條在 `global-session` 咬了五次，而 `node --check`
  **只抓到其中三次** —— 另外兩次外層恰好仍是合法的 JS，要到執行時才炸成 `SyntaxError` 或一句看不懂
  的 `Invalid parameters`。**可靠的做法不是「記得別用反引號」，是把說明寫在模板字串外面。**
  同一條也適用於 `*/`。
- **一個 Tailwind class 名稱是另一個的子字串。** 以 `className.includes('bg-hover')` 判斷 rail 上
  選中的項目 —— **未選中的列帶著 `hover:bg-hover/60`，那個字串也包含 `bg-hover`** ⇒ 判準恆回第一列，
  而以它為期望值的三條斷言（期望值恰好就是第一列）**不論實作對錯都通過**。
  **正解是讓產品標示選中狀態（`aria-current`）** —— 那首先是無障礙的正確標記，順帶給探針一個精確的
  判準。**而加上它立刻炸出另一件事**：`probe:keyboard` 既有的 `SELECTED_FOLDER` 有一條
  「`aria-current` → 否則讀主舞台 header」的退路，產品此前沒有它，於是那條退路**一直走的是 header**；
  加上之後它第一次走進前半段，而前半段讀的是 `innerText` 的第一行 —— 該列展開時那是一顆 `▾` 展開鈕。
  **替一個從未被滿足的條件補上滿足它的東西，會喚醒一段從未執行過的程式碼。**
- **探針取識別碼要向產品要，不自己算**（例如 sha1 的 worktree key）—— 平行實作在 core 換演算法時會
  靜默分歧，而斷言照樣全綠（兩邊各用各的 key）。
- **對照組跑到一半還原原始碼，dev 模式會驗到還原後的版本** —— **build 用的是編譯進 `out/` 的產物，
  dev 是 vite 即時讀原始碼**。**對照組要嘛跑完再還原，要嘛只採信 build 模式那一半。**
- **一條沒有 `detail` 的 `check()`，失敗時等於什麼都沒說。** 兩個不同的病擠在同一份紅色輸出裡，
  會看起來像同一個根因。
- **`probe:terminal` 是最貴的一支** —— 迭代時用 `PROBE_ONLY=<段落>[:<模式>]`（`probe:keyboard`
  與 `probe:openspec` 也支援）。**耗時不寫在這裡**：`run-probes.mjs` 每一輪都會印出每支的秒數，
  而寫死的數字會過期得比人記得更新它更快 —— 這一行原本寫著「一輪約 4 分鐘」，實測時已是
  15.6 分鐘，**而那 15.6 分鐘還是沒跑完的**（見下一條）。

## 探針之內的失敗會吞掉其後的段落 —— 而總結上看不出來

`run-probes.mjs` 的檔頭寫著「付了十幾分鐘就該拿到完整的一張圖，而不是第一支紅了就停」。
**那條紀律曾經只存在於探針之間，沒有落到探針之內。**

實測的代價：某一輪 `test:e2e` 中，`probe:terminal` 的 dev 段耗時 **771 秒卻只跑了 10 個段落中的
1 個** —— 第一段 `runMode` 在 `openSessionViaMenu` throw，其餘 9 段一次都沒執行過。同一輪
`probe:openspec` 的 dev 段也在 `createSession` throw，只跑完 43%。**輸出裡沒有任何一行說明這件事**：
看到的是一長串綠燈加一個 Error。

它真正的代價不只是「有些段落沒驗到」：

> **那 771 秒後來被當成「21 次 launch 的總和」，用來推導一份最佳化方案** —— 每次冷啟動 35 秒、
> 砍掉多數 dev 段落可省 47%。實測反證：771 秒幾乎全部由**一次** launch 花掉，而那一段正是方案
> 要保留的。**成本跟著互動次數走，不跟著 launch 次數走**，整份推算與事實相反。
>
> 這是「**一個方便取得、看起來相關的量，不等於規格真正在乎的那個量**」的第四次重演。而它最難堪
> 的地方在於：同一份文件已經對 `probe:openspec` 標註了「中途 throw 中斷，其實沒跑完」——
> **同一個檢查沒有套用到 terminal 身上。同一個坑只補了一半。**

現在的機制（`scripts/lib/sections.mjs`）：段落逐一隔離、例外完整輸出後繼續下一段，並且

- **依賴以宣告表達**。前置失敗時，依賴它的段落標記為「未執行（前置失敗）」而**不執行** ——
  共用累積狀態的探針（`probe:openspec` 全程只有一次 `launch()`）少了這個區分，前段一失敗就會
  連鎖出一整片指向同一個根因的紅燈。**一片紅燈與一次中斷同樣無法閱讀**，只是換了一種形式。
- **`run-probes.mjs` 的總結標示每一支是否完整執行**，不完整時明講「這一輪的耗時不得作為最佳化
  判斷的依據」。**這條規則若當初就在輸出上，上面那份推算在寫下的當下就會被擋住。**

**連帶的一條**：`PROBE_ONLY` 單獨指定一個具有依賴的段落時，執行器會自動帶上它的前置。少了這個，
段落篩選就是一個會騙人的工具 —— 缺前置的段落「紅得莫名其妙」，而那與產品缺陷長得一樣。

## 隔離擋得住 throw，擋不住 hang —— 而 hang 比中斷更糟

段落逐一 `try`／`catch` 之後仍然踩到：`runRestore` 的 dev 段卡在 `app.quitGracefully()`
**1 小時 30 分**，`test:e2e` 永遠不會結束，該段落的五個 electron 一直活著。
**一個永遠不 resolve 的 Promise 不會 throw**，`catch` 對它毫無作用。

中斷至少會結束、會印堆疊、會讓下一輪有機會跑；hang 什麼都不給，而且**看起來像「還在跑」**。
段落因此包一層時限。三個實作上的坑：

- **時限的計時器不可 `unref()`。** 段落 hang 住時它可能是**唯一**撐住事件迴圈的東西 —— unref
  之後 Node 判定無事可做而直接結束，計時器永遠不觸發，逾時形同不存在。（單元測試會以
  `Promise resolution is still pending but the event loop has already resolved` 抓到。）
- **逾時之後那個工作還在跑。** JS 沒有辦法中止執行中的 Promise，所以逾時的段落**不會走到自己的
  `finally`** —— 它建立的 app 沒有人收。每支探針要另外提供逾時收屍（以 profile 前綴 `pkill`，
  pattern 記得用字元類別自我豁免）。
- **時限是癱瘓的防線，不是效能的閘門。** 訂寬鬆一點：段落真的變慢時該讓它跑完並在耗時輸出裡
  現形，被一個緊繃的數字誤殺的代價是一條看起來像產品缺陷的紅燈。

## 一個改不到東西的 mutation，是最典型的假對照組

驗時限機制時，第一版對照組在 `Promise.race` 裡多加了一個永不 settle 的 promise —— **那根本
不影響結果**（race 是最先 settle 的贏），於是「拿掉機制卻沒有變紅」。當下看起來像機制失效，
其實是 mutation 沒改到東西。

**對照組腳本要先斷言「mutation 後的內容與原始檔不同」**，再跑測試。這比事後盯著紅綠猜可靠 ——
而它與「對照組是唯一擋得住假綠的東西」是同一條紀律的下一層：**假的對照組與有效的對照組，
在輸出上長得一模一樣。**

## 「無操作」的斷言：相對判定在整個機制死掉時**照樣是綠的**

驗「按下某鍵之後什麼都不該發生」時，最自然的寫法是**相對判定** —— 記下按之前的狀態、按完再比一次
「有沒有變」。**那個寫法在該快捷鍵完全失效時通過。**

實例（`checkEmptyWorkspace` 的 `Ctrl+↓`）：快捷鍵在 `[role="dialog"]` 或 `[role="menu"]` 存在時
一律被抑制。注入一個 dialog 之後，選中項在按鍵前後都是 `null` —— `after === before` **成立**。
於是「規格要求的無操作」與「這顆鍵根本沒接上」在斷言上完全相同。

**寫成絕對狀態就分得開**：`after === 全域項目`。被抑制時根本沒有東西被選中（`null`），當場變紅。

- **判準**：對每一條「什麼都不該發生」的斷言問一次 ——「如果這個機制**整個不存在**，這條會不會
  照樣綠？」會的話，它測的是「兩次觀察相同」，不是規格說的那件事。
- **另外仍要先按一次「應當有作用」的鍵並斷言其效果**。它不是防假綠的主力（絕對判定才是），
  而是**診斷力＋防退化**：失敗時區分得出「鍵死了」與「行為不對」，也讓日後有人把判定式改回相對
  比較時仍有一條擋著。
- 同源的還有本文的「一個改不到東西的 mutation」——**兩者都是「對照組與斷言在輸出上長得一樣，
  而其中一個什麼也沒證明」。**

> 附帶一條工作流：**跑對照組時，還原之後必須重新建置才算還原完成。** `PROBE_SKIP_BUILD=1` 驗到的
> 是既有產物 —— 原始碼改回去了、`git diff` 乾淨，而 `out/` 裡還是動過手腳的那一份，症狀是「還原後
> 那條斷言仍然紅」。它會印警告與產物時間，但那行在輸出開頭，`grep` 濾斷言時正好看不到。

## `baseline` 對照排除不了環境因素

`baseline` 對照（stash 掉改動跑一輪）能回答「這是不是我剛加的東西弄的」，**不能回答「這是不是
環境弄的」** —— 因為 baseline 跑在同一個污染環境裡。

實例：issue #19 的標題寫著「有 baseline 對照，不是 #17 的負載型」，而取得那組數據時機器上有兩組
孤兒 electron 佔著 CPU。清掉之後重測，其中 `probe:openspec` 那兩條**完全沒有重現**（450/450 全綠）。

**判定「確定性 vs 負載型」要換的是環境，不是改動。** 跑之前先確認：沒有殘留的 electron／
`electron-vite dev` 孫行程／`Xvfb`／`dconf` 抓著 debugging port。

## 前置條件：兩種完全不同的病，長得一模一樣

`out/` 不存在（忘了建置）與 debugging port 被殘留行程抓著，**在輸出上曾經無法區分** —— 兩者都是
每支探針各等滿 30 秒，然後回報：

```
probe 失敗：等待 CDP target 逾時（30000ms，port 9223）
0/0 通過
```

實測一輪這樣的執行花了約 20 分鐘、一條斷言都沒驗到；追查時**先誤判成 port 佔用、查完才發現是
產物不存在**。兩者的處置完全相反（一個重新建置、一個清行程）。

`scripts/lib/preflight.mjs` 現在在啟動 app **之前**就判定，各自帶可執行的處置。三件事值得記住：

- **判定與歸因分離。** 判定只用 Node 內建的 `net.connect`；找出持有者才用 `ss -tlnp`，**取不到就
  降級為「查不出持有者」，不影響判定**。歸因需要外部程式與權限，兩者都可能不在 —— 讓一個加分項
  決定判定的成敗，就是把穩固的檢查換成一個會在別的機器上失靈的檢查。
- **`net.connect` 唯一的壞失效方向是「listener 在但 accept queue 滿」⇒ 一直不返回。** socket 因此
  必須設 timeout 並在每條路徑上 `destroy()`；少了它，一個為了取代 30 秒神秘逾時的檢查會自己變成
  無界的 hang（`pollFor` 攔不住 —— 它等的是 `read()` 返回）。
- **檢查通過之後 port 仍可能被搶走**（TOCTOU）。這個缺口補不掉，但 `waitForPageTarget` 的逾時訊息
  會**再查一次持有者**，那涵蓋了前置檢查結構上涵蓋不到的每一種情形。

**觸發它需要走旁路。** `run-probe.mjs` 預設會建置，所以「把 `out/` 移走再跑」測不到這道檢查 ——
它會直接重建。要驗證得用 `PROBE_SKIP_BUILD=1` 或 `SPEKTERM_PROBE_BUILT=1`，而**那兩個旁路正是
產物可能不存在的來源**。

## debugging port：一份表，加一道看得見「衍生」的守衛

port 全部宣告於 `scripts/lib/ports.mjs`（**探針名 → 一組具名的 port**），`scripts/ports.test.mjs`
守著三條判準。形狀與判準都不是隨手決定的：

- **表是「一支對應一組」，因為現況就有一支用兩個。** `probe-identity` 啟動兩次，此前寫成
  `DEBUG_PORT` 與 `DEBUG_PORT + 1`。一對一的表**放不下第二個**，於是那個 port 不會出現在表上 ——
  守衛看不見它、前置檢查也不檢查它。**一份漏掉一半的表比沒有表更糟**：它讓人以為問題已經被結構
  擋住了。
- **守衛不能只找「`const *PORT* = 數字`」。** 那條規則對 `DEBUG_PORT + 1` 一個字都看不到，
  而那正是當時撞號的來源（9226 ＝ `probe-terminal` 的 build port）。第三條判準因此是「**不得對表
  的成員做算術**」。
- **兩條判準是接力的。** 對照組（改動前的八支原始碼）上判準二報 12 處、判準三報 0 處 —— 當時的
  算術是對本地常數做的，而那個常數已被判準二抓住。只有二，改寫成表的成員之後就沒人擋；只有三，
  本地常數的世界一片綠。
- **號碼刻意不相鄰**（9221／9231）。取 9221/9222 的話，下一個順手寫 `+1` 的人會直接撞進
  `probe:shell`。
- **`core` 與 `native` 不得補進表裡。** `probe-core` 的驗收內容之一就是「主行程不開任何 TCP 埠」，
  給它一個 debugging port 會讓它**依設計失敗**。

## renderer 的 console：探針此前一個字都收不到

`lib/cdp.mjs` 的 `send()` 只認得帶 `id` 的回應，**事件訊息（沒有 `id`）被直接忽略**。於是 dev 模式
那七條穩定失敗（issue #19）至今沒有任何現場證據 —— 子條件的 detail 能說出是 `rail` / `root` /
`visible` 哪一個不成立，卻說不出**為什麼**，而 dev 與 build 唯一的結構差異（多一層開發伺服器）
的失敗正是留在 console 而不在 DOM 上。

- **捕捉窗口涵蓋 `enable` 之前 —— 這是實測，不是推論。** 直覺會認為「enable 之後才開始收」，
  那樣的話 renderer 在 attach 之前寫的東西全部拿不到。**實測（Electron 43）推翻了它**：
  `Runtime.consoleAPICalled` 與 `Log.entryAdded` 都會被緩衝並在 `enable` 時重播。
  **這個性質是承重的** —— 日後升版若改掉它，症狀是「採不到早期訊息」，不是任何一條紅燈。
- **只在該段落確實失敗時才印**（紅燈斷言、例外、或逾時），沒有訊息就完全不輸出。與窗口耗盡累計
  同一條紀律：一個恆常出現的欄位掛在每個正常段落上，只會讓人學會不看它。
- **「只在段落 throw 時印」是不夠的** —— #19 那七條是**斷言紅、不是例外**，只接 throw 正好採不到
  它們。
- **緩衝住在 `instrument.mjs`，由 `cdp.mjs` 推入。** 讀它的是 `sections.mjs`，而那個模組不該為了
  一則訊息把 CDP 拉進來（`probe-native` 沒有 CDP 也要用 `check()`）。

## 為什麼不平行化 `run-probes.mjs`

九支序列跑很誘人拿來平行化，但目前不做，理由是具體的：

- **issue #17 記載的正是「連續跑多支之後負載尖峰超出等待窗口」** —— 平行只會放大它。
- ~~**debugging port 會撞**~~ —— **這條已經不成立**（`probe-failure-attribution`）。port 收斂到
  `scripts/lib/ports.mjs`，`probe:identity` 的兩個號碼改為 9221／9231 且各自明寫，
  `scripts/ports.test.mjs` 擋住重複與衍生。**但這只解決了三條理由裡的一條**，另外兩條仍然成立。

先修 #17、再處理**負載**，才談得上平行化。
- **一支新的 CPU 密集測試會逼出既有的競態。** `copy-language.test.mjs` 用 TypeScript 解析整個
  `src/`，平行跑時把 `terminal.test.ts` 兩處 `stub.calls()` 斷言擠爆了 —— 產品在 spawn 的**當下**就
  回報了 conversationId，但 stub 是在自己的行程裡 `echo "$@" >> log`，中間隔著一次 fork/exec。
  其餘的 `stub.calls()` 本來就都先 `waitFor` 過，那兩處漏了。

## stub `claude`：驗 OSC 標題與續接的載體

OSC 標題只對 `claude` 目標生效，但我們**叫不動真的 `claude` 去宣告一個指定的標題**，也不該讓探針
真的啟動一個 Claude Code session。產品的 claude 模式是 `$SHELL -l -c claude`（**從 PATH 解析**），
於是把一個放著 stub 的目錄前置到 `PATH` 就走的是**產品原本那條路徑**：動的是環境，不是被出貨的
程式碼。

- **`HOME` 也必須換掉，否則 stub 會被真的 claude 蓋過去。** `-l` 是 login shell，它 source
  `~/.profile`，而 Ubuntu 預設的那份有 `PATH="$HOME/.local/bin:$PATH"` —— 那一行把**真** claude 搶到
  我們前面（實測：探針真的把一個 Claude Code session 跑了起來）。把 `HOME` 指向暫存目錄後，那裡沒有
  `~/.profile` 可 source，而且 stub 就放在該 HOME 的 `.local/bin` 裡。
- **`SHELL` 要釘成 `/bin/sh`** —— zsh 會自己送 OSC 標題。
- **stub 的旗標比對不可用位置。** `claude-status-bridge` 起，命令前面多了一段 `--settings <路徑>`
  —— 以 `[ "$1" = "--resume" ]` 判斷的 stub **`$1` 從此恆為 `--settings`**，於是它**完全不再模擬
  失敗**，只是退化成一個普通的互動 shell。**失效方向是最壞的那種**：stub 看起來一切正常，紅的卻是
  產品那側的斷言 —— 一路追下去會先懷疑產品的自癒壞了。JS 那側的 `.split(' ')[1]` 是同一個病。
  **判準一律在整串裡找旗標。**
- **「stub 真的跑起來了」要以磁碟上的憑據斷言，不要看終端畫面** —— 「終端上有沒有出現某行字」對
  掛載時機、backlog flush 與捲動都很敏感（dev 的 StrictMode 還會把元件重掛一次）。

## 其他驗收紀律

- **驗 reload 要用 `Page.reload`，不能用頁面裡的 `location.reload()`** —— 後者是**頁面發起**的導航，
  會觸發 `will-navigate`，而導航防護正是無條件擋它。於是 **reload 被 app 自己的防護擋掉，探針會在
  一個從未 reload 過的頁面上把整段驗收跑完**。
  **而且要斷言 reload 真的發生了** —— 先把狀態改成非預設值，reload 之後看它有沒有回到預設。
- **驗收有前置條件時，前置沒成立會紅得莫名其妙。** 驗一個排在後面的停用原因，得先讓前面的條件全部
  成立；驗 reload 的還原要先切回同一個 session、先選 folder 再判定身分（沒選中時側欄是空狀態，
  那個 section 的 `aria-label` 是身分切換器的字串）。另外 persist 有 **500ms 的 debounce**，reload
  太快會把這次選擇丟掉 —— **而那個失敗與「持久化整個沒做」長得一模一樣**。
- **在 Files 身分導航檔案樹的五個坑**：檔案樹與檢視器**互斥渲染**（開著檔案時樹根本不在 DOM 裡，
  而**先前開著的檔案還在畫面上**，於是其後的斷言驗的是上一個檔案）；**不可用「切走身分再切回來」
  重置**；**點目錄是 toggle 不是「展開」**（判 `aria-expanded`）；**`CLICK_OPEN_FILE` 的 needle 不能
  用檔名**（artifact 一多，預設分頁就不是 proposal 了）—— 用 slug；**麵包屑裡的第一個 `button` 不
  保證是「回到樹」**（工作目錄選擇器排在它之前），修法是給那顆按鈕一個字典來源的 `aria-label`
  （順帶改善無障礙），**不是**改用位置。
- **驗捲動要自己構造溢出，而且載體選錯就是一盞假綠。** `probe:workspace` 送不進 `Ctrl+↓`（診斷顯示
  選中狀態不動而 `scrollTop` 卻變了 —— 那是**未被 preventDefault 時瀏覽器的原生捲動**），該段因此
  **整段移除而非留著**：留著就是假綠（「捲回 `scrollTop 0`」在原生捲動下照樣通過）。載體是
  `probe:keyboard`，以 `Emulation.setDeviceMetricsOverride` 壓矮 viewport 讓既有 fixture 就溢出。
  - **分頁列的橫向捲動一度零覆蓋** —— 刪掉那行 `scrollIntoView`，探針照樣全綠。補法：壓窄視窗，
    **不夠就以鍵盤補 session**（`Ctrl+T` → ↓ → Enter，與視窗寬度無關 —— 窄視窗下那顆「+」可能已被
    推出畫面）；判準是「走到第一個分頁 → 強制 `scrollLeft = 0` → 循環到最後一個」，於是「最後一個
    必然在視野外」是**溢出的定義**保證的，不是碰運氣。
  - **滑鼠的例外，半截的列要「算」出來，不能「捲到底再找找看」** —— 捲到底時被裁掉的是 session
    **子列**，而選取的單位是**標題列**，整排恰好都完整可見（第一版因此恆回 `null`）。改為主動把
    `scrollTop` 設到讓某一列剛好被邊緣切一半。
- **`aria-label` 是選擇器**，見 `CLAUDE.md`「UI 文案與 i18n」。
- **腳本裡比對 git 的輸出，一律加 `--no-color`** —— 見 `CLAUDE.md`「工具鏈與環境的陷阱」。
- **驗證「某段邏輯沒有 spawn 外部程式」時不要用行程樹取樣** —— 開發模式的掃描摘要本來就會 spawn 一次
  `git log`，會混淆歸屬；而 `git` 是毫秒級行程，取樣容易漏抓。改在單元測試裡攔截
  `node:child_process` 的全部入口，並加一個對照組證明攔截確實生效。
- **驗證「app 沒有開 TCP 埠」時不能只讀主行程的 `/proc/<pid>/net/tcp`** —— Chromium 的 zygote 與
  renderer 跑在各自的 network namespace。`probe:core` 用兩道互補判準：逐 pid 取「該 pid 的 socket
  inode ∩ 該 pid 所屬 netns 的 LISTEN 表」，外加「app 存活期間本 netns 是否新增 LISTEN socket」。
- **驗證編輯器 worker 是否存活，不能靠「看到語法高亮」** —— tokenization 在主執行緒完成。用 Monaco
  內建的 link provider（為 `language: '*'` 註冊，呼叫 worker 端的 `$computeLinks`，命中的 URL 會被
  畫上 `.detected-link`）—— 零 bundle 成本、零測試鉤子。
- **驗證編輯能力必須讓內容真的改變並回讀磁碟**，不能只看某個 textarea 的 `readOnly`。
- **量測 harness 的 `webPreferences` 必須比照產品。** `terminal-unicode-width` 最小重現開了
  `nodeIntegration: true`（純粹為了方便回報結果），於是 `Buffer` 存在 → 撞上 addon 解碼 Unicode trie
  時 `new DataView(data.buffer)` **漏了 `byteOffset`** 的 upstream bug → **整個星形平面被判成一格**。
  獨立稽核據此得出「選型是錯的」，而我用**同一種環境**去「獨立驗證」，得到同一個結果就接受了它。
  > **兩次獨立測試若共用同一個環境假設，得到同一個錯誤結果並不構成佐證 —— 那只是同一個錯誤被執行
  > 了兩次。** 救回這件事的不是第三次測試，是去讀那個 issue 的最後一段。
  > *連帶*：任何在 **Node 環境**驗證寬度的嘗試（`@xterm/headless`、CI 腳本）**會**踩到它，且失效
  > 方式是靜默的錯誤寬度。本 repo 因此**不在 node:test 裡驗字元寬度**。
- **案例集要涵蓋類別，不是實例。** 字元寬度的對照表原本只有兩格，而那兩格恰好是新方案佔優的地方。
  兩個具體的反例都在擴充後的表裡：內建 v6 對膚色修飾「碰巧」正確（**只用它驗會給現況發綠燈**）、
  對星形平面 CJK 本來就正確。**即使結論碰巧正確，一張兩格的表也撐不起「嚴格較優」這個宣稱。**
  這條紀律已寫進 spec 本身。
- **`baseline` 對照組**：撞到怪現象時，先 stash 掉自己的改動跑一輪。實測救過兩次 —— 一次逼我承認
  SIGWINCH 是自己的新程式碼弄的（我原本準備怪 `lineHeight`），一次戳破「這是既有 flaky」的藉口。
  **撞到怪現象時，先問「這是不是我剛加的東西弄的」，而不是先怪一個看起來相關的舊常數。**
- **探針撞到怪現象時，先問「這是不是產品的 bug」，不要先調整探針去閃避它。** 我寫
  `probe:workspace` 時撞見了「repo 飛到最後」，處置卻是把準心移到區塊頂端 3px 去遷就它（註解裡還
  留著「實測踩過」）—— 驗收於是永遠是綠的，而使用者的拖曳是錯的。
