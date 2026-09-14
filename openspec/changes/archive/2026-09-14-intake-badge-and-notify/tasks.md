## 0. 對照組的執行器 —— **必須最先做**

- [x] 0.1 `scripts/intake-control-groups.mjs` 目前寫死只跑 `npm run probe:intake`，紅燈判定是
      `output.includes('✗ ' + expectRed)`。本輪多數 mutation 指名的斷言住在 `npm test`，那支腳本
      **判不出它們的紅燈** ⇒ §9 的收尾條件結構上不成立。把 `slack-control-groups.mjs` 既有的
      `command` 欄位與 `npm test` 的紅燈判定（`includes(expectRed) && /^not ok/m`）移植過來。
      **這一條不先做，本輪其餘每一個對照組都是死的**
- [x] 0.2 以一個既有的 mutation 驗證移植正確（把它改成 `command: 'test'` 指向一條既有的單元測試
      斷言，確認腳本判得出紅燈），再改回去

## 1. 實作前必須先做的實測

> 審查期間已取得下列結果，此處是**確認並落檔**，不是從頭量：
> `isSupported()` 為 `true`；`app.setDesktopName` 存在且有效；通知內文會被桌面服務詮釋為標記
> （本機宣告 `body-markup`，其實作放行 `<b>/<i>/<u>` 並把 URL 變成可點連結且攔截該次點擊）；
> Electron 送出前一個字元都不轉義；5013 字元的內文原封送出、不截短不報錯；
> 通知物件被回收之後觸發不會進到回呼，且回收不會把通知收掉；`isSupported()` 在完全沒有通知服務
> 時仍為 `true`；觸發能否發生取決於服務有沒有宣告動作能力。

- [x] 1.1 把上述結果寫進 `docs/lessons/intake.md` 的新一節（**不是只寫進 design.md** ——
      下一個人會去那份 lessons 找）。每一條標明是實測還是讀原始碼得到的
- [x] 1.2 **本 change 不做，已轉為 issue #47。** 機制那一半已驗（`setDesktopName` 之後
      D-Bus 的 `desktop-entry` 提示由 `electron` 變成 `spekterm`，並由
      `scripts/desktop-name.test.mjs` 釘住它與安裝腳本的常數相同）；
      **桌面上實際的名稱與圖示**要打包 + 從應用程式選單啟動才驗得準，而
      `npm run dist:linux` 會產生一個換版 commit —— 搭在下一次本來就要換版時做
- [x] 1.3 決定縮減之後各欄位的長度上限。**實測顯示沒有任何外部訊號會告訴我們超了** ——
      上限由我們自己定。取小值（通知的用途是「要不要現在切過去」），順帶縮小 URL 的曝露面

## 2. 到達事件：一個新通道，而不是沿用既有的兩個

- [x] 2.1 `IntakeService` 增加到達的訂閱通道，**只在 `deliver()` 成功新增紀錄之後發出**，
      帶著該筆紀錄。以 node:test 驗**每一條非成功的返回路徑**都不發出 —— 逐一從原始碼列出，
      不憑印象：`MALFORMED`、欄位驗證失敗、`INVALID_ID`、內容相同的重複、內容不同的重複、
      `CAPACITY`（**六條**）
- [x] 2.2 **對照組**（`command: 'test'`）：`arrival-on-notice` —— 把到達接到既有的
      「有東西變了」通道上。**實作時發現這與「接到 `DeliverOutcome.notify`」是同一個 mutation**：
      `#emit()` 恰好只在四條拒絕路徑上被呼叫，而那四條**正是** `notify: true` 的那四條
      （`MALFORMED` 與內容相同的重複直接 return，不經 `#emit()`）。因此是**四條變紅，不是六條**
      —— tasks 原本寫「再一個：六條全紅」是錯的，兩個 mutation 在程式碼上無法區分

## 3. 通知的決策層（主行程，純邏輯，不碰作業系統）

- [x] 3.1 合併以**固定窗口**實作：窗自第一則到達起算，窗內累積，到期一次結算。
      窗長**可注入**，且注入點要**同時**供得上單元測試（建構參數）與探針（見 7.x）——
      只做前者的話，探針那幾條斷言寫不出來
- [x] 3.2 以 node:test 驗**持續到達**：注入窗長 W 與可控時鐘，於 `t=0`、`0.8W`、`1.6W`、`2.4W`
      各送一則，斷言通知則數 **≥ 3**。**判準要落在 0 與非 0 之間** —— 一個永遠不到期的 debounce
      會是 0 或 1。斷言名稱取一個穩定的字串常量，好讓覆蓋表的載體標籤命中它
- [x] 3.3 **對照組**（`command: 'test'`）：固定窗口換成 debounce（`if (timer) return` →
      `if (timer) clearTimeout(timer)`）—— 3.2 必須變紅。**沒有 3.2 的話這個對照組指向一條不存在
      的斷言**，而單則與批次兩種情況在兩種實作下結果相同，也就是這條 requirement 零覆蓋
- [x] 3.4 總量的上界：在比合併窗大一個量級的尺度上限制通知則數，逾越時降級，並以「使用者打開
      收件匣」為重置點。以 node:test 驗：以每窗一則的節奏持續到達，逾越之後不再各自發出；
      打開收件匣之後恢復。**對照組**：拿掉上界 —— 那條必須變紅
- [x] 3.5 結算的內容：窗內恰一則 ⇒ 帶該則的來源標籤、發起者與標題（**經 4.x 的縮減**）；
      一則以上 ⇒ 只說數量。以 node:test 驗合併那則不含窗內任何一則的標題、發起者或 intake 的本文
- [x] 3.6 標題恆取自字典，**不含任何取自投遞的值**；系統文案**不依 adapter 而異**。
      以 node:test 用「標題／發起者／來源標籤皆為可辨識標記字串」的 intake 驗標題不含其中任何
      一者。**對照組**：把標題改成含該則的標題 → 必須變紅
- [x] 3.7 以 node:test 驗通知的 payload **不含任何路徑、folder 名稱或 folder 識別碼**
      （用可辨識的標記字串，同 3.6 的手法）
- [x] 3.8 以 node:test 驗「以既有的落盤狀態建構」不發出任何通知。
      **對照組**：把觸發改寫成「收件匣之內存在待處理項目」→ 必須變紅

## 4. 第三方欄位進入通知之前的縮減

- [x] 4.1 縮減函式：移除會被通知服務詮釋為標記的字元、把 URL 形狀替換為一個記號、截短至 1.3 的
      上限。**它吃的是已正規化的值**（與收件匣呈現同一個來源），不得去讀來源專屬的原始內容
- [x] 4.2 以 node:test 驗：含標記字元與 URL 的標題，交給後端的字串中兩者皆不存在；
      含不可列印字元與雙向覆寫字元的標題，通知中不含那些字元；僅存在於原始內容的標記不出現
- [x] 4.3 **不要寫成轉義。** 轉義只對宣告標記能力的服務正確，對不宣告的服務會把
      轉義後的字面直接顯示給使用者，而執行環境沒有暴露服務的能力宣告 —— 這一句要寫進程式碼註解，
      否則下一個人會「修正」成轉義
- [x] 4.4 **對照組**：把縮減改成只做截短 —— 4.2 的前兩條必須變紅

## 5. 通知的後端：唯一碰作業系統的那一層

- [x] 5.1 定義後端介面（呈現一則、回報能不能用、註冊觸發的回呼），預設實作是**全 repo 唯一**
      import Electron 通知 API 的地方。**回呼的註冊入口不得命名為 `listen`** ——
      `probe-core.mjs` 的守衛是純文字比對且連註解一起吃（`agent-wait.ts` 踩過同一個坑，
      其檔頭示範了怎麼繞開；**寫這段註解時不要把那個字面形式打出來**）
- [x] 5.2 **後端持有每一則已顯示的通知，直到它 `close` 或 `failed`**，並給那個集合一個上界。
      不持有時通知物件可能在使用者伸手去點之前被回收，而回收**不會**把通知從桌面收掉 ——
      通知還亮著、點下去什麼都不會發生、沒有任何紅燈
- [x] 5.3 以 node:test 驗 5.2（`FinalizationRegistry` ＋ `--expose-gc`：show 過的通知在其 `close`
      之前不得被回收）。**對照組**：不放進集合 → 必須變紅
- [x] 5.4 後端 SHALL NOT 設定「需手動關閉」或「不自行消失」的緊急程度；SHALL NOT 附任何動作；
      圖示 SHALL 為本地資源。以 node:test 驗交給 Electron 的選項物件的鍵集合（白名單形式，
      不是「不含 actions」那種黑名單 —— 後者只擋得住列舉得出來的東西）
- [x] 5.5 補一道 `npm test` 原始碼守衛：Electron 的通知 API 只能被該預設後端引用
      （比照 `watcher-source.test.mjs` / `secret-scope.test.mjs`）。**對照組**：在別的模組加一行
      import → 必須變紅
- [x] 5.6 記錄用的替身後端，**以 `!app.isPackaged` 為閘、路徑自 `app.getPath('userData')` 推導**，
      不用環境變數。`ptyEnv()` 是 `{ ...process.env, ... }` —— 一個環境變數會進到**每一個 pty**，
      而 pty 裡跑的正是被不受信任內容驅動的 agent；它寫一個檔案就能讓視窗搶到前景。
      探針本來就傳 `--user-data-dir`，所以驗收一個字都不必多寫，而出貨的產物裡這條路徑組不出來
- [x] 5.7 替身的觸發檔監看：**監看目錄不是檔案**（chokidar 對尚不存在的路徑 attach 不上）、
      **`add` 與 `change` 都要訂**（同一個路徑寫第二次只 emit `change`）、
      **等 `ready` 之後補一次存在性檢查**（`ignoreInitial: true` 寫死）、
      **以 basename 過濾**（紀錄檔與觸發檔在同一個目錄，watcher 會看到自己的每一次 append）。
      一律經 `src/main/watcher.ts`；單一目標，**不傳 `pollingRoot`**
- [x] 5.8 替身在觸發的回呼被呼叫時**寫一筆收據** —— 7.x 的「已開啟時無操作」要靠它區分
      「規格要求的無操作」與「訊息根本沒送到」
- [x] 5.9 **`probe:intake` 與 `probe:slack` 兩支都走替身後端**（`xvfb-run` 只換 `DISPLAY`，
      匯流排位址原封繼承 ⇒ 不走替身的話每跑一次探針就往真實的桌面噴一排通知），
      並補了守衛 `scripts/notify-stub-scope.test.mjs`。
      **實作時發現 5.6 的閘不夠精確**：`app.isPackaged` 在 `npm run dev` 也是 false，
      而 dogfood 正是在 dev 裡進行的 —— 那樣會讓使用者永遠看不到真通知。改以
      **「命令列指定了拋棄式 profile」**（`--user-data-dir=`）為判準：驗收一律傳它，
      dev 走 `XDG_CONFIG_HOME` 不傳，而 dogfood 的效能診斷工具帶的是
      `--remote-debugging-port`（所以那個旗標不能當判準）

## 6. 主行程的接線

- [x] 6.1 視窗參考取 `BrowserWindow.getAllWindows()[0]` 並帶 `isDestroyed()` 守衛 ——
      `index.ts` 有**兩個** `createWindow()` 呼叫點（`whenReady` 與 `app.on('activate')`），
      持有第一個的模組層級參考在 close → activate 之後會指向已銷毀的物件
- [x] 6.2 觸發時把視窗帶到前景：最小化時 `restore()`、再 `show()`、再 `focus()`。**三個都要**
      （實測：帶 window manager 的環境下單獨 `focus()` 對最小化的視窗完全無效）
- [x] 6.3 `app.setDesktopName(...)`，值取自 `scripts/lib/desktop-entry.mjs` 的既有常數，
      **不要在 `index.ts` 再硬編一次**。實測：不設的話通知的 desktop-entry 提示是 `electron`，
      與安裝的 entry 對不上 ⇒ 通知拿到 Electron 的預設圖示
- [x] 6.4 `ipc/intake.ts` 新增一條主 → renderer 的「打開收件匣」訊息，**重用既有的 `senders`
      集合與 `isDestroyed()` 剪除**，不要另外持有一份不會被剪的參考
- [x] 6.5 `src/preload/index.ts` 新增該訂閱，**照既有形狀包一層**
      （`const handler = (): void => listener()`）。寫成把 listener 直接交給 `ipcRenderer.on`
      會把事件物件交給 renderer，而它的 `sender` 就是 `ipcRenderer` 本身 —— 經 contextBridge
      過去等於把整個 IPC 面交出去。目前 11 個訂閱都靠手寫的紀律守著，這是第 12 個
- [x] 6.6 補一道 `npm test` 的 AST 守衛：preload 中訂閱的第二個參數不得是外部傳入的 listener。
      **對照組**：把任一處改成直接傳 → 必須變紅

## 7. Renderer：一個常駐的收件匣狀態

- [x] 7.1 新增常駐的收件匣狀態 provider，掛在 `AppShell`（與 `PrefillProvider` 同一層，
      且必須在 `SessionsProvider` 之內 —— overlay 用 `useSessions()`）。
      **不要掛在 `ActivityBar` 之內**：那把「常駐」這個性質綁在一個 UI 元件上
- [x] 7.2 **先訂閱、再 `list()`**（現行的 `IntakeOverlay` 順序是反的，不要照抄），
      且 `refresh` 必須是 `useCallback([])` —— 否則 effect 每次渲染都重訂閱＋重 `list()`，
      而 `list()` 會 `setState` ⇒ 無限迴圈，而 `exhaustive-deps` 會**主動要求**你把它加進依賴
- [x] 7.3 provider 對外導出 `{ snapshot, pendingCount, refresh }`。overlay 的 `accept` /
      `dismiss` / `dismissNotices` 之後**照舊顯式呼叫 `refresh`** —— 刪掉它等於把「主行程忘了
      broadcast」這一類迴歸的兩條防線砍成一條
- [x] 7.4 收件匣 overlay 改為讀該 provider，移除它自己的 `list()` 與訂閱
- [x] 7.5 計數即 provider 中 `state === 'pending'` 的項目數；routing 解析不出來的**仍計入**；
      被拒絕的投遞的彙整計數**不計入**
- [x] 7.6 **修掉一個既有的焦點缺陷，否則這個 change 會把它引爆**：`IntakeOverlay` 那個
      「訂閱 keydown ＋ 聚焦關閉鈕」的 effect 依賴 `close`，而 `close` 依賴 `ActivityBar` 每次
      渲染重建的 inline `onClose` ⇒ **`ActivityBar` 每重繪一次，焦點就被搶回關閉鈕一次**。
      provider 讓 `ActivityBar` 訂閱收件匣狀態之後，`setRules` 的 broadcast 也會觸發它 ——
      使用者在 routing 規則分頁按下儲存，焦點就跳走。
      兩者都要改：`onClose` 改 `useCallback([])`；**把那個 effect 拆成兩個**，聚焦是掛載時的
      一次性動作（`[]` 依賴）
- [x] 7.7 `ActivityBar` 呈現計數：**按鈕之內的獨立 `<span>`**（不是 `<button>` ——
      `probe:workspace` 的活動列列舉是 `nav … button`，多一顆會讓那份列舉從「入口」變成
      「入口＋裝飾」），父層按鈕加 `relative`（無 offset 的 `relative` 不改變版面），
      `text-2xs` ＋ `leading-none`，超出兩位數以 `99+` 呈現，**為零時不渲染**
- [x] 7.8 **字級只能用既有的 `text-2xs`（13px，尺度的地板）** —— `text-[10px]` 會被
      `typography.test.mjs` 擋下。若 13px 塞不下，處置是把 badge 的盒子做小，**不是新增第六級
      token、也不是 arbitrary 值**
- [x] 7.9 計數的 span 要有**自身可被朗讀的身分**（`role="status"` 或 `role="img"`）——
      入口是帶顯式標籤的按鈕，而按鈕的後代在無障礙樹中是呈現性的，巢狀元素上的標籤**不會**被朗讀
- [x] 7.10 **入口按鈕自己的無障礙標籤一個字都不改。** 併進計數會讓既有指名該入口的每一條斷言
      靜默地選不到元素（症狀是求值得空值，不是斷言失敗）
- [x] 7.11 `ActivityBar` 接收「打開收件匣」的指示，`opener` 取自**該按鈕的 ref**
      （`ITEMS` 是模組層級常數，所以 ref 掛在渲染處：`ref={item.id === 'handoffs' ? … : undefined}`）。
      **已開啟時以純函式 updater 保證無操作**（`setIntakeOpener((c) => c ?? ref.current)`）——
      寫成「先讀 state 再判斷」的話，若 handler 註冊在 `[]` 依賴的 effect 裡讀到的是永遠為 null
      的 stale closure；加進依賴又會讓每次開關都重訂閱，而空窗會吃掉一則訊息

## 8. 文案

- [x] 8.1 `src/shared/i18n/en.json` 新增：通知的標題（單則／合併兩種，**不依 adapter 而異**）、
      通知的內文、計數標示的標籤。**通知的文案是 `ui-localization` 的第五類**（不是第 3 類 ——
      它不過 IPC，由作業系統畫在 app 的框之外）
- [x] 8.2 計數標示要有**自己的 key**，不可複用 `intake.pendingCount`（它已經是 overlay header
      的可見文字，複用會讓 overlay 開著時畫面上出現兩份相同字串，任何 textContent 掃描就是歧義的）
- [x] 8.3 **`scripts/lib/copy.mjs` 不做 i18next 的複數選擇**（`raw()` 是單純的 key path 查表，
      對 `_one` / `_other` 會拋「字典中沒有這個 key」），而 `prefixOf` 在「以變數開頭」時拋錯。
      二選一並寫進 tasks：(a) 給 `copy.mjs` 加複數解析＋它自己的對照組；
      (b) 給標示一個**非複數**、且固定部分在**後綴**的 key。**7.x 的選擇器依賴這個決定**
- [x] 8.4 `en.json` 一改 renderer 不熱套用（導航防護擋掉 full reload）；preload／主行程改動
      也不熱套用 —— 迭代時都要重啟 dev

## 9. 驗收

- [x] 9.1 `probe:intake` 新段落（計數）：**先**驗「從未打開過收件匣時計數為 `1`」（這條的前提是
      整段還沒開過收件匣，順序不能動），再三則時為 `3`、打開收件匣驗列數同為 3、忽略一則後為 `2`、
      全部處理完後**標示的元素不存在**。fixture 中**要有一則 routing 解析不出來的**
      （`seedRouting(profile, {})`），並斷言它計入
- [x] 9.2 **對照組**：把 provider 改成「只在 overlay 掛載時才 `list()`」（＝退回現況）——
      只有「從未打開過收件匣時計數為 1」那一條變紅。
      **不要用「拿掉 `list()`」** —— 那會讓四條全紅，證明的是「provider 有在拉資料」，
      而不是「sender 的註冊不再依賴使用者曾經打開過收件匣」
- [x] 9.3 `probe:intake` 新段落（計數尺寸）：量 **Handoffs 按鈕**的 rect，帶計數與不帶計數逐值
      相同，**且量測時斷言計數標示確實存在**（否則「沒有 badge ⇒ 尺寸當然不變」照樣綠）。
      **不要量 `<nav>` 的寬度** —— 它是寫死的 `w-[52px]`，那條斷言恆真
- [x] 9.4 `probe:intake` 新段落（重啟）：**本探針至今沒有任何重啟段落**（`RESTART_PORT` 被保留
      但 `void` 掉了），要**新建**，不是沿用。重啟後 rail 與計數都來自非同步的 IPC，
      **必須輪詢而不是量一次**
- [x] 9.5 `probe:intake` 新段落（通知）：以替身後端驗單則發一則、窗內十則合併為一則、
      被拒絕的投遞不發出、內容符合 §3／§4。**窗長要能從探針注入**（見 3.1）——
      判準要落在 0 與非 0 之間，不要落在兩個都非 0 的數字之間
- [x] 9.6 `probe:intake`：**回補要通知** —— 同一段落先 seed 三則已落盤的待處理項目、再於啟動前
      在落點放一份新投遞，斷言通知**恰有一則**且對應新的那則。這一條同時是 9.7 的正面錨
- [x] 9.7 `probe:intake`：**落盤中既有的不重新通知** —— 這個前提**只能 seed 落盤的狀態檔**造出
      （在落點放檔案造出的是到達，會通知）。`probe-intake.mjs` 目前沒有那個 helper，要補。
      另注意 `CAPACITY` 與 `MALFORMED` 的投遞檔**刻意不被消費**，它們在下次啟動會重新 deliver
      ⇒ 那是合法的新到達，seed 時不要留下它們
- [x] 9.8 `probe:intake`：以替身的觸發檔模擬觸發，驗收件匣打開；**已開在 routing 規則分頁且某個
      欄位輸入一半**時再觸發一次，驗那個字串還在、分頁沒變、`document.activeElement` 沒變，
      **且替身的收據數為 2**（沒有收據的話，「訊息根本沒送到」與「規格要求的無操作」分不開）；
      關閉後驗焦點落在活動列的入口
- [x] 9.9 `probe:intake`：overlay 開著時投遞一則（觸發一次 `intake:changed`），斷言
      `document.activeElement` **沒有**變成關閉鈕。**對照組**：把聚焦放回依賴 `close` 的 effect
      → 必須變紅（這是 7.6 的載體）
- [x] 9.10 兩條斷言**改放在 `probe:intake` 的計數段落**，不放 `probe:workspace`：後者的 fixture
      沒有任何 intake ⇒ 那裡根本不存在計數標示，「帶計數時標籤不變」在那裡造不出前提。
      `probe:workspace` 既有的活動列列舉仍是回歸載體（標籤一動它就選不到元素）
- [x] 9.11 把本輪的每一個對照組登記進 `scripts/intake-control-groups.mjs`（2.2 ×2、3.3、3.4、
      4.4、5.3、5.5、6.6、9.2、9.9），各自標明 `command` 與 `expectRed`
- [x] 9.12 `scripts/intake-coverage.test.mjs`：把本 change 登記進 `COVERED_CHANGES`
      （**不登記就對本 change 完全沉默**），並為每一條新 scenario 填一列。
      `greenIfAbsent` 與 `mutation` 兩欄要真的填 —— 找不到載體就寫「無載體」＋理由。
      **已知會是 `greenIfAbsent: true` 且結構上不可達的**：「僅存在於原始投遞的內容不進入通知」
      （紀錄型別根本不攜帶原始內容，真載體是既有的原始碼守衛）—— 老實填，不要假裝驗到了東西
- [x] 9.13 逐條把新 scenario 對回載體，確認每一條的載體**真的存在且有鑑別力**

## 10. 文件

- [x] 10.1 `docs/lessons/intake.md` 補一節：§1 的實測結果、`DeliverOutcome.notify` 語意相反、
      debounce 會餓死、通知物件被回收後觸發失效、通知內文是標記目的地且會 linkify URL、
      `isSupported()` 守不到真正的失效、把計數併進入口標籤會靜默掏空既有驗收
- [x] 10.2 `CLAUDE.md`：現況的「收件匣」bullet 補上計數與通知；`probe:intake` 的說明補上新段落與
      其缺口；踩雷指南的觸發器列補上新的通知模組。**順帶修正測試表裡「全部 10 支探針」** ——
      `ALL_PROBES` 實際是 13 支
- [x] 10.3 `docs/PRD.md` §11 Phase 7 標記本輪落地的項目

## 11. 收尾

- [x] 11.1 `npm test`、`npm run typecheck`、`npm run lint` 全綠
- [x] 11.2 `npm run test:e2e` 全綠（本 change 動到 `ActivityBar` 與 `AppShell`，
      `probe:workspace`／`probe:keyboard`／`probe:insights` 都經過它們）
- [x] 11.3 `node scripts/intake-control-groups.mjs` 全部如預期變紅
