> **每一條新增的 scenario 都在下面有一個指認**（issue #12 的精神，手工版）。
> **沒有變紅過的斷言不算交付** —— 每一組機制都配一條「把它拿掉會怎樣」。
>
> **§1 必須先做，而且必須在 §2 之前。** 它要實測的那個狀態，按本 change 的假說會被 §2 的處置
> 消除；順序反了就再也量不到（design D2）。

## 1. spike：決定 frame 診斷的讀取手段（**在旗標交付之前**）

- [x] 1.1 造出一個 rAF 確實停擺的 renderer。優先：CDP `Page.setWebLifecycleState('frozen')`；
      不可行時退回「連跑數輪 `PROBE_ONLY=runPanelBasics:dev npm run probe:openspec`，撞到
      `vis=hidden` 那一輪立刻取樣」（前置調查的 `watch-visibility.mjs` 是現成的觀測器）
- [x] 1.2 在該狀態下量 **A 案**：`document.timeline.currentTime` 在兩次取樣之間會不會前進。
      **這是實測，不是推論** —— 本 repo 已兩次栽在「從語意推論 API 行為」上
- [x] 1.3 A 案不成立（時鐘照樣前進）時改用 **B 案**：一次性
      `requestAnimationFrame(() => { window.__rafSeen = true })`（**不 await**），下一次求值讀旗標。
      同樣在 1.1 的狀態下實測一次
- [x] 1.4 把選定的手段與**實測結果**寫進 design D2 的表格（哪一案、量到什麼）。
      spec 只描述能力，因此不需要改

## 2. 執行環境：停用背景節流（#21 / #19 / #17）

- [x] 2.1 `scripts/lib/display.mjs`：把旗標拆成**一律傳的**與**虛擬螢幕才傳的**兩組。前者放
      `--disable-backgrounding-occluded-windows` 與 `--disable-renderer-backgrounding`，後者維持
      現有的兩個 swiftshader 旗標。`electronExtraArgs()` 回傳兩組的合併
      → **不新增第二個匯出的函式名給呼叫端**：九處呼叫（`identity` / `package` / `files` / `core` /
        `workspace` / `openspec` / `terminal` / `shell` / `keyboard`）多一個入口就會有人只呼叫其中一個
- [x] 2.2 於該函式的 doc comment 寫明三件事：這組旗標補的是「視窗不可見時不要節流」（與螢幕
      來源無關，故不受 `useVirtualDisplay()` 約束）；**`hidden` 的成因未確立**，兩個旗標涵蓋
      兩條可能的路徑；以及由此產生的**作用域限制**（探針不覆蓋背景節流下的行為）
- [x] 2.3 新增 `scripts/display.test.mjs`：斷言虛擬螢幕模式的引數含背景節流旗標
      → 指認 scenario：「啟動被測 app 時停用背景節流」
- [x] 2.4 同檔斷言 `PROBE_DISPLAY=physical` 時**仍含**背景節流旗標，且**不含** swiftshader 旗標
      （後者是這條的鑑別力自檢 —— 少了它，一個「一律回傳全部旗標」的實作也會通過）
      → 指認 scenario：「實體螢幕模式同樣停用」
- [x] 2.5 **對照組**：把 2.1 的兩個旗標移除，2.3 與 2.4 必須變紅；加回必須全綠
      → 這只證明**引數組出來了**。處置**有效**與否由 8.4 建立，兩者不可混為一談

## 3. frame 診斷：讓根因下次還查得出來（#19）

- [x] 3.1 `scripts/lib/mounted.mjs` 的 `DIAGNOSTICS` 加入 §1 選定的讀取（同步、純讀取；B 案則
      為「讀旗標並補種下一次」——**不得 await**、**不得留常駐迴圈**）
- [x] 3.2 同檔新增純函式 `describeFrameStall(before, after)`：判斷為「沒有 frame」時回傳一句
      說明及其後果（依賴動畫框的呈現不會更新，一切以呈現為判準的等待都會落空）；否則回傳空字串。
      **維持與 `describeMounted` 同樣的性質：拿不到 client**
- [x] 3.3 同檔新增 `awaitMounted(client, { expression, timeoutMs })`：以 `pollFor` 等待判定成立；
      **等不到時**取樣兩次 frame 診斷（中間隔一段時間）並輸出 `describeFrameStall` 的結果。
      回傳值 SHALL 與現況一致（最後一次的判定物件）
      → **診斷取樣一律包 try/catch**：等不到掛載最常見的原因就是 renderer 不在了，而此時
        `evaluate` 會拋 —— 讓那個例外往外送，等於把十一處呼叫端的回傳語意從「最後的判定值」
        改成「例外」，而 `describeMounted` 正是為前者準備的
      → `mounted.mjs` 只 import `instrument.mjs` 的 `pollFor`，**不得 import `cdp.mjs`**
- [x] 3.4 把 `pollUntil(client, MOUNTED, (v) => v?.ok === true)` 的**十一處**改為 `awaitMounted`
      （`files` 2、`workspace` 1、`openspec` 4、`keyboard` 1、`terminal` 2、`package` 1）
      → 需要參數化的是**求值的 expression**（`probe-package.mjs:61` 把
        `MOUNTED_WITHOUT_VISIBILITY` 別名成 `MOUNTED`），**判定式不必參數化** —— 十一處
        一字不差都是 `(v) => v?.ok === true`
      → 機械替換，**斷言的數量、順序與判定式一律不動**
- [x] 3.5 `scripts/cdp.test.mjs` 補：求值結果的診斷欄位含 frame 診斷（沿用該檔既有的
      `runInNewContext` 手法）
      → 指認 scenario：「判定結果帶回 frame 診斷」
- [x] 3.6 同檔補：frame 診斷為任意值而子條件全部成立時，判定仍然成立
      → 指認 scenario：「frame 診斷不參與判定」
- [x] 3.7 同檔補 `describeFrameStall` 的兩個方向（無 frame → 有說明且含後果；有 frame → 空字串）
      → 指認 scenario：「無 frame 時說明文字載明其後果」、「有 frame 時不產生該說明」
- [x] 3.8 **接線的載體**（純函式測到了、接線沒有，正是本 repo 犯過四次的形狀）：以一個
      `{ evaluate }` 的假 client 測 `awaitMounted` —— 判定恆不成立且 frame 診斷不變時，輸出含
      「沒有 frame」；診斷前進時不含
      → 指認 scenario：「等不到掛載時呼叫端確實取樣並輸出」
- [x] 3.9 同上，假 client 的**診斷取樣拋錯**時，`awaitMounted` 仍回傳最後一次的判定值（不 throw）
      → 指認 scenario：「診斷取樣失敗不改變回傳值」
- [x] 3.10 **對照組**：3.1 的欄位移除 → 3.5 變紅；3.2 的判斷反向 → 3.7 兩條變紅；
      3.3 的輸出拿掉 → 3.8 變紅；3.3 的 try/catch 拿掉 → 3.9 變紅

## 4. CDP：每一次求值都在有限時間內返回（#22）

- [x] 4.1 `scripts/lib/cdp.mjs` 的 `send()`：每次往返給時限（預設 30 秒，具名常數），逾時 reject
      且**訊息載明方法名**；逾時只移除該次 pending，**不判死連線**
- [x] 4.2 同檔：以 Map 保存 pending，`close` / `error` 事件時把它們**全部 reject**
- [x] 4.3 同檔：記一個已關閉旗標，關閉後發起的 `send` **立即** reject（不等時限）
- [x] 4.4 同檔：`connect()` 的 WebSocket `open` 等待加時限
- [x] 4.5 同檔：`waitForPageTarget` 的 `fetch` 加逾時（`AbortSignal.timeout`，**3 秒**）——
      它打的是 loopback 的 `/json/list`，而包住它的窗口是 30 秒；時限取得太大等於沒取
- [x] 4.6 `connect(target, { createSocket, callTimeoutMs, connectTimeoutMs })`：三者皆可選，
      預設取具名常數。**存在的理由是可驗收性** —— 不可注入的話，每條逾時測試都得真的跑 30 秒，
      而 `npm test` 的定位是秒級。既有八處 `connect(target)` 的呼叫姿態不變
- [x] 4.7 新增 `scripts/cdp-transport.test.mjs`（假 socket，毫秒級時限）：
      - 回應永不抵達 → 逾時且訊息含方法名 → 指認：「回應永不抵達時該次呼叫逾時」
      - 有 pending 時關閉 → 那些 promise 立即 reject → 指認：「連線關閉使尚未完成的呼叫失敗」
      - 關閉後發起 → 立即 reject 且**耗時明顯小於時限**（少了這個量測，一個「等滿時限才拋」的
        實作也會通過）→ 指認：「連線關閉後的呼叫立即失敗」
      - 一次逾時後，下一次正常回應仍然成功 → 指認：「逾時不影響連線的後續使用」
      - 握手不完成 → `connect()` 逾時 → 指認：「連線建立本身有時限」
      - 未注入時採用預設常數（以匯出的常數比對，不重寫數字）→ 指認：「時限可由呼叫端注入」
- [x] 4.8 **對照組**：4.1／4.2／4.3 各自還原，對應的測試必須變紅。**還原 4.1 時測試會「掛住」
      而不是「變紅」** —— 那正是這條要修的失效形狀，因此**每條測試都要有自己的 timeout**，
      讓掛住呈現為失敗而不是讓整輪 `npm test` 停住
- [x] 4.9 於 `send()` 的註解寫明：**一次逾時會使該段落中斷**（`pollUntil` 未開 `tolerateErrors`，
      `pollFor` 會把例外直接往外拋），這是刻意接受的代價 —— 有邊界的中斷優於無邊界的 hang，
      而**不順手把 `pollUntil` 改成容忍**（那會改變數百條既有斷言的語意）

## 5. 關閉被測 app 要等它真的結束（#8）

- [x] 5.1 新增 `scripts/lib/quit.mjs`，匯出 `quitAndWait(child, { signal, timeoutMs, onEscalate })`：
      送出訊號 → 等 `exit` 事件 → 逾時（預設 **10 秒**）則 SIGKILL 並呼叫 `onEscalate`。
      **不用 `pollFor`**（等的是事件；`wait-source.test.mjs` 的判準是「迴圈中的 `Date.now()`
      比較」，事件 ＋ `Promise.race` 不落入，也不該為了通過守衛改寫成輪詢）
      → 10 秒的理由：`probe-terminal.mjs` 有 13 處呼叫，而「面板留有未存變更時關閉會觸發原生
        對話框、擋住 SIGTERM」是已記載的路徑（`docs/lessons/probes.md:328`）；13 次全部吃滿
        也只有 130 秒，遠小於段落時限
- [x] 5.2 `scripts/probe-terminal.mjs` 的 `quitGracefully` 改用它；`destroy()` 不動（連根拔除，
      本來就不等）
- [x] 5.3 `scripts/probe-workspace.mjs` 的 `close()`（:129）改用它。**這是原提案漏掉的站點**：
      它只有 `SIGTERM` ＋ `sleep(600)`、連 `pkill` 都沒有，而 `:1093` 關閉後隨即以**同一個
      profile** 重啟，緊接著就是「清單順序跨重啟還原」與「字型偏好跨重啟還原」——
      **被斷言的正是舊行程收尾時寫的那份檔案**
- [x] 5.4 於 5.3 補註解：`:1101` 那條「列還沒渲染」的既有歸因，**關閉端的寫檔競態是它未曾排除
      的替代解釋**；本次改動若讓該條不再偶發變紅，要回頭更新那段註解
- [x] 5.5 **（實作時擴大，見 design D4 的第二次修正）** 這條 scenario 需要一個**會變紅**的載體，
      而一份稽核紀錄不會變紅。「這個站點之後會不會以同一個 profile 重啟」**靜態判定不出來**，
      唯一可執行的判準是「一律經單一入口」——於是**七個 graceful 站點全部收斂**
      （`terminal` / `workspace` / `files` / `openspec` / `core` / `shell` / `identity` 的 win32
      分支；`SIGKILL` 的連根拔除路徑不在此列），並新增守衛 `scripts/quit-source.test.mjs`
      → 指認 scenario：「同一資料目錄重啟前一律等待」
      → **收斂的必要性有現成證據**：`probe-core` 原本自己手寫了一份「SIGTERM → 等 exit →
        5 秒後 SIGKILL」，與 `quitAndWait` 逐字同一件事 —— 需求本來就存在於別處，而紀律沒有
        擋住第二份實作（同 `wait-source.test.mjs` 擋手寫等待迴圈的理由）
      → **對照組**：把任一處改回直接送 SIGTERM，守衛必須指出檔案:行號（已實測）
- [x] 5.6 新增 `scripts/quit.test.mjs`（假 child，EventEmitter）：
      - 行程在時限內結束 → 在 `exit` 之後才返回（以順序旗標斷言，不以耗時斷言）
        → 指認 scenario：「等到行程結束才返回」
      - 行程不回應 → 送出 SIGKILL 且 `onEscalate` 被呼叫一次
        → 指認 scenario：「逾時升級為強制終止並出聲」
- [x] 5.7 **對照組**：5.1 的等待改回「送出訊號即返回」→ 第一條變紅；時限拿掉 → 第二條掛住
      （同 4.8，測試自帶 timeout）
- [x] 5.8 於 `quitGracefully` 補註解：它順帶修正了「關閉視窗終止其所有 pty」那條斷言的前提
      （此前是在主行程**可能還活著**時開始數 pty 的）

## 6. 破壞性前提的兩條不變式（#8）

- [x] 6.1 `scripts/probe-terminal.mjs` 的 `runRestore`：寫入 `'{ 損毀的內容'` 之後、`launch()`
      **之前**，讀回該檔並以 `check()` 斷言其內容確實仍是損毀的（detail 帶回實際讀到的前綴）
      → 指認 scenario：「啟動前確認破壞的內容仍在磁碟上」
- [x] 6.2 **對照組**：在 6.1 的斷言**之前**故意把檔案寫回合法 JSON，該條必須變紅（證明它讀的
      是磁碟上那一份，而不是它自己剛寫的變數）
- [x] 6.3 同段落 `:2913` 的隔離斷言：現況只數 `quarantined.length === 1`，**加上內容比對** ——
      被隔離那一份的內容即先前寫入的那一份
      → 指認 scenario：「確認被隔離的正是寫入的那一份」
      → **這條在任何時序下都成立**，而 6.1 只覆蓋一半（覆蓋若發生在哨兵之後、啟動之前，
        哨兵照樣綠）
- [x] 6.4 **對照組**：由 6.2 那一輪**同時建立** —— 覆蓋成 `[]` 之後，6.3 也變紅（隔離檔內容
      是 `[]` 而非寫入的那份）。**不另跑一輪改期望值的版本**：那證明的是同一件事
      （這條斷言會因為內容不同而變紅），而該輪的輸出已經逐字印出兩者

## 7. 文件

- [x] 7.1 `docs/lessons/probes.md` 新增一節：現場（`vis=hidden focus=true raf=0`，**並註明它採自
      一輪全綠的執行**）、失敗的形狀（CDP 往返 5ms／次卻等滿 18.2 秒 ⇒ 畫面不更新，不是連線變慢）、
      慢的形狀（少數區間各卡數秒；≥2s 的區間數 11／4 → 0）、以及判讀規則
- [x] 7.2 同檔：更正「等待窗口在負載下不夠」那條教訓的**實例**（教訓本身正確，變因被誤診為負載）。
      並把 `:336` 那條「對已 `close()` 的 client 求值會無限等待」標為**已由結構修掉**，保留敘述
      作為「為什麼要有那道結構」
- [x] 7.3 同檔：記入本輪自己犯的兩個判讀錯誤 —— 「用平均往返耗時揉合『少數區間卡住』與『每次都慢』
      兩個病」（而既有 spec 設這個尺度的唯一理由正是要分開它們），以及「以單輪的一紅一綠當作
      偶發現象的對照組」
- [x] 7.4 `CLAUDE.md` 的「探針跑在虛擬螢幕上 —— 而那限定了驗收的效力」補上第二條限制：
      **不覆蓋背景節流下的行為**

## 8. 驗收

- [x] 8.1 `npm test`（四個新測試檔全綠，既有守衛不變紅 —— 特別是 `wait-source.test.mjs`、
      `check-detail.test.mjs`、`ports.test.mjs`）
- [x] 8.2 `npm run typecheck` 與 `npm run lint`
- [x] 8.3 `PROBE_ONLY=runRestore npm run probe:terminal`（build + dev）—— §6 的兩條不變式與
      §5 的關閉路徑走一遍
- [x] 8.4 **處置的鑑別力觀測（本 change 唯一不可省的驗收）**：加旗標後連跑 **N ≥ 8** 輪
      `PROBE_ONLY=runPanelBasics:dev npm run probe:openspec`，每輪**同時**以
      `watch-visibility.mjs` 連 port 9229 記錄 `vis=` 與 frame 狀態。記錄每輪的：紅燈數、
      **≥2s 的往返區間數**（判準取這個，不取總耗時 —— 前者是該病的直接指紋，後者會被段落長度
      稀釋）、以及是否觀測到 `hidden`
      → 指認 scenario：「處置的有效性以多輪觀測建立」
      → **旗標側的 `vis=` 資料是必須的**：前置調查只採到無旗標側（`watch-openspec-flag.log`
        是 0 bytes，因為那一輪 12.5 秒就跑完而觀測者晚了 25 秒才連）。**沒有它就無法區分
        「處置有效」與「這 N 輪剛好沒撞到」**
      → 觀測者要在探針啟動後**立即**連線，不要固定 sleep
      → **結果見 `observation.md`**：8 輪全部 `hidden=0`（每輪 12–13 次持續取樣）、
        紅燈 0、≥2s 區間 0；該檔同時載明這份證據的四條邊界
- [x] 8.5 若 8.4 仍觀測到 `hidden`：**照實記錄，不得修飾**。旗標無效的話 §2 要重新論證，
      而 §1 的診斷成為下一輪調查的器材；**§4／§5／§6 不受影響**（它們與該假說無關）
      → 本輪未觀測到 `hidden`，故無此情形；邊界仍記入 `observation.md`
- [x] 8.6 `npm run test:e2e` 一輪 —— **8/8 全部通過，三支有段落機制的都「完整執行」**
      → **本輪以 `PROBE_LIST` 排除 `identity`**：使用者當下正在跑 Spekterm AppImage，而該支
        刻意不傳 `--user-data-dir`（要驗的正是 `app.getPath('userData')` 實際解析出來的路徑），
        會與 `~/.config/Spekterm` 共用、後寫的贏 —— **弄壞使用者手上那份分頁而它們的 pty 還活著**。
        `run-probes.mjs` 的總結已標示「這不是一輪完整驗收」
      → **`probe:package` 同樣未跑**（它自成第三個成本層級，換版前才跑）。它受本 change 影響
        兩處：掛載等待改用 `awaitMounted`、以及 `electronExtraArgs()` 的新旗標。**列為換版前
        必須確認的項目**
- [x] 8.7 新的耗時基準（**與舊數字不可比** —— 舊的那些輪次有一部分跑在節流狀態下，而那件事
      在當時看不見；且舊的 25.6 分鐘裡有兩支中途 throw、其後段落根本沒執行）

      | 探針 | 本輪 |
      |---|---|
      | native / core / shell | 1s / 6s / 2s |
      | workspace / files | 21s / 34s |
      | keyboard / openspec / terminal | 204s / 121s / **312s** |
      | **合計** | **701s（11.7 分鐘）**，8 支 |

      **最有說服力的一組**：`probe:terminal` 的 dev 與 build 現在幾乎一樣 ——
      `runMode` 50.7s（build）vs 53.1s（dev），比值 **1.05**；`runRestore` 27.8 vs 29.2；
      `runHealAndCrash` 35.5 vs 37.3。而 issue #21 記載的是 `dev:runMode` **逾時 480 秒**
      （觀測 771 秒），build 全 10 段才 166 秒 —— **dev/build 從 4.6 倍降到 1.05**。
      「全部是 `dev：` 前綴」正是 #19 那七條共同的形狀

## 9. 票

- [x] 9.1 #8、#22：貼上修法與對照組結論後**關閉**
- [x] 9.2 #17、#19、#21：貼上採證（現場、失敗與慢的形狀、8.4 的多輪觀測）與**定調的更正**，
      **保持 open** —— #21 與 #19 的五條在本輪**未重現**，而一個未重現的現象不能用一個未完全
      驗證的機制結案。票上要寫明「重新開票的判準」：再次觀測到 `hidden`，或那些斷言再次變紅
- [x] 9.3 #17 的四點建議逐點交代：
      - 第 1 點（`createSession` 失敗前 dump 選單狀態）—— **本輪那次中斷仍然沒有現場**
        （console 收到的是 xterm 的 disposable 警告，與選單無關）。標為**仍待辦**
      - 第 2 點（「重量再點 3 次」換成有 deadline 的重試）—— 這是**本輪唯一造成段落中斷的站點**，
        固定次數在任何慢環境下都會重演。標為**本 change 不做**；**不另開票** —— #17 保持 open
        本身就是它的追蹤位置，多開一張只會讓同一件事散在兩處
      - 第 3 點（探針之間留冷卻）—— **不做**：根因不是負載，且序列執行與逐支收屍已由既有機制承擔
      - 第 4 點（判讀紀律）—— 由 7.2／7.3 承擔
