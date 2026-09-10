## 1. 偏好這一側（主行程）—— **三處，不是一處**

- [x] 1.1 `src/main/preferences-store.ts` 的 `TerminalPreferences` 新增
      `agentView?: 'terminal' | 'conversation'`，並註明它為何住在這個區塊、以及**為何不順手
      改名**（`version` 不符會隔離整檔）。驗證 `npm run typecheck` 通過
- [x] 1.2 **`parsePreferences:112` 的解構清單也要加 `agentView`** —— 那是**第二處白名單**，
      而**型別檢查對它零感知**。實測：`agentStatus` / `agentEvents` 就是因為漏在這裡，
      寫得進磁碟卻**不跨重啟**。少了這一條，spec 的「重啟後回到上次的選擇」直接失效
- [x] 1.3 **`setTerminalFont:202` 必須保留 `agentView`** —— 那是**第三處**。該方法從一個空物件
      重建 `terminal`，只顯式保留 `gpuAcceleration`（`:214–216` 的註解正是在警告這個坑）。
      少了它：使用者切到對話 view → 開 Settings 調字型 → **靜默跳回終端**
- [x] 1.4 `sanitizeAgentView(value)`：**恰為那兩個字面值之一才採用**，其餘（`null`／數字／
      任意字串）回 `undefined`。位置與形狀比照 `sanitizeFamily` / `clampSize`，
      也比照 `gpuAcceleration` 那條「只認真正的布林」
- [x] 1.5 `src/main/preferences-store.test.ts` 補四條：
      **(a) 跨一次 `load()` 的往返** —— `new PreferencesStore(同一路徑).load().get()`，
      **不能只驗 setter 的回傳值**（只驗回傳值的話 1.2 那個 bug 照樣全綠）；
      (b) 不合法值視為未設定（字串／數字／`null` 各一）；
      (c) **改字型不動 `agentView`**（比照既有的「改字型不該動到 GPU 偏好」那條）；
      (d) 舊檔（無此欄位）仍解析得出來且其他欄位不受影響。驗證 `npm test` 通過
- [x] 1.6 **已開為 issue #39**：`agentStatus` / `agentEvents` 漏在 `parsePreferences` 的解構清單與
      `setTerminalFont` 的保留之外 —— 兩個開關**都不跨重啟、且改字型會被抹掉**，
      且 `preferences-store.test.ts` 對它們零覆蓋。**既有缺陷，本 change 不修**
      （它們是別的能力的偏好）

## 2. IPC、preload 與 renderer 的偏好管線

- [x] 2.1 `src/main/ipc/settings.ts` 增加 `setAgentView(view)` 的 handler，回傳**套用後的**
      整份偏好（比照 `setGpuAcceleration` / `setAgentStatus`）
- [x] 2.2 `src/preload/index.ts` 的 `settings` namespace 同步暴露它
- [x] 2.3 **`scripts/probe-shell.mjs:162–167` 的硬編白名單加上 `setAgentView`**，並比照
      `:160–161` 為 `setAgentStatus` 寫的那兩行，補一句它為何符合該白名單的邊界論證
      （偏好的值由主行程的 store 承接，介面上沒有路徑詞彙）。
      **不做這條，`probe:shell` 必紅** —— 而 `docs/lessons/probes.md` 記著這件事已發生過兩次
- [x] 2.4 `PreferencesProvider` 增加 `updateAgentView(view): Promise<void>`（以主行程回傳的偏好
      更新本地 state）與衍生值 `agentView`（＝`terminal.agentView ?? 'terminal'`）。
      **「未設定＝終端」只寫在這一處**。IPC reject 時至少 `console.error` ——
      切換從「本地 state、不可能失敗」變成一次 IPC 往返，靜默不動是新增的失效方式

## 3. 移除 per-session 的那一份 —— **四個站點**

- [x] 3.1 `src/main/session-store.ts`：`PersistedSession.view` **從型別上移除**，連同讀取端
      （`:166`）與寫入端（`:336`）。`replace()` 是逐欄位白名單，移除欄位即等於它不會再被寫進
      磁碟 —— 確認白名單裡真的沒有它了
- [x] 3.2 `src/main/session-store.test.ts`：既有與 `view` 有關的斷言改為**斷言它不被寫出**；
      補一條「既有 `sessions.json` 帶著 `view` 時，讀取後不保留、也不寫回」
- [x] 3.3 `src/renderer/src/shell/terminal/sessions.tsx`：移除 `SessionState.view`（`:77`）、
      `SessionsApi.setView` 的宣告（`:134`）與實作（`:493`）、restore 映射（`:293`）、
      **以及 persist 映射的解構與輸出（`:328` / `:336`）** —— 後者是 `session-store.ts:163`
      註解所說「三處逐欄位白名單」的第三處
- [x] 3.4 **`src/renderer/src/shell/terminal/SessionTabs.tsx`：切換入口本體。**
      prop 型別（`:21`）與**四處讀 `focused.view`**（`:219` aria-label／`:221` aria-pressed／
      `:223` onClick 送出的值／`:226` 按鈕文字）全部改讀全域值。
      **這四處不經 `sessionViewOf`** —— 留一個恆為 `undefined` 的欄位在那裡，按鈕標籤會永遠停在
      「顯示對話」、**點它永遠只送 `'conversation'`、切不回終端**，而探針正是以 `aria-label`
      找那顆按鈕
- [x] 3.5 `src/renderer/src/shell/MainStage.tsx`：`sessionViewOf`（`:48`）改為讀
      `usePreferences().agentView`（**非 claude 目標一律回終端這一條不動**）；
      `onSetView`（`:442`）改接 `updateAgentView`。同時改寫 `:45–47` 的 docstring
- [x] 3.6 **改寫兩段逐字重述了那個被推翻理由的註解**：`session-store.ts:69–70` 與
      `sessions.tsx:72–73`（都寫著「per-session，不是全域偏好 —— 使用者完全可能一邊以
      對話 view 看 agent、一邊以終端 view 用 shell」）。驗證 `npm run typecheck` 與
      `npm run lint` 通過

## 4. 驗收（`scripts/probe-agent-view.mjs`）

- [x] 4.1 落盤斷言（`:405–422`）改讀 `<profile>/preferences.json`，**並補齊否定式斷言的前置**：
      `sessions.json` 存在、`sessions.length >= 1`、且那一筆的 `spawnTarget === 'claude'`，
      **然後**才斷言它不含 `view`。**檔案讀不到或空陣列時 `every(…)` 恆真** —— 那是
      `probes.md` 記過的同一型假綠
- [x] 4.2 同時改寫 `:395–404` 那段註解 —— 它解釋的是 `sessions.json` 的 500ms debounce，
      而偏好**沒有 debounce**（每個 setter 直接原子寫檔）。等待仍要，但理由換了；
      順帶註明此前那次等待隱含保證的「`sessions.json` 已 flush」不再成立
- [x] 4.3 `runParallelSessions`（`:698–707`）那條反轉為「新建的第二個 session **採用當前的
      全域選擇**」，**但不可沿用 `hasComposer` 當 settled 條件** —— `VIEW_STATE`（`:242–254`）
      是 document-wide，而 DOM 裡**只有 focused session 那一份**；`createAgentSession`
      點完選單就回來，此刻第一個 session 的 composer 還在 ⇒ `hasComposer` 立刻為真 ⇒
      **產品維持 per-session 也照樣綠**。要錨在**身分**上：等分頁數變成 2，
      且 `state.text` 出現**第二個** session 的 `STUB-HELLO-<sid2>`（`:689` / `:712` 已有這個技巧）
- [x] 4.4 **刪掉 `:709` 那次 `TOGGLE_VIEW`** —— 反轉之後第二個 session 建立時就是對話 view，
      這次 toggle 會把全部切回終端 ⇒ `:710–715` 的 `pollFor` 燒滿 25 秒 ⇒
      `:716` 的 `exec(...)[1]` 對 `null` 取值 **throw** ⇒ 整段中斷 ⇒ `context.parallel` 沒設 ⇒
      `runDormantConversation` 被標「**未執行**」。**連紅燈都沒有**
- [x] 4.5 新增「切回終端時其他 session 亦回到終端」：把**第二個**切回終端，
      再 `focusTabExpression(0)`（`:652–661`）切回第一個，斷言它也回到終端
      （`!hasComposer` ＋ `toggleLabel === copy('conversation.showConversation')`）。
      **方向不可反** —— 兩個都已在對話 view 時，往對話方向切「另一個也是對話」與
      「它一直都是」在觀察上完全相同
- [x] 4.6 **`runParallelSessions` 結束時把全域偏好還原為對話 view** ——
      `runDormantConversation`（`:757`）重啟後期待畫面出現 `conversation.dormant`，
      而決定那件事的現在是 profile-wide 的偏好，也就是上一段最後一次 toggle 的結果。
      不還原的話那條會紅，而訊息看起來像「休眠的呈現壞了」，離根因隔了兩層
- [x] 4.7 `runRebuiltWidth` 的新時序前提 **文件化，刻意不做載體**。偏好與 `restore()` 是兩條
      互不相干的非同步，偏好晚到時終端會先以未覆蓋狀態被 fit 過，欄數在那一瞬間就已正確 ——
      於是該段即使在錯誤實作下也可能通過。**但那是一個競賽窗口，抽樣式的觀察做不出穩定的
      判別**，而一條時綠時紅、證明不了什麼的斷言比沒有更糟。已寫進該段的 docstring 與
      design D5，並註明此前沒有這個窗口（`session.view` 與 session 來自同一次 `restore()`）
- [x] 4.8 **改掉兩條會過期的斷言名稱與一段 docstring**：`:704`（「view 的選擇是 per-session」）、
      `:740`（「切換 session 後內容與 view 都跟著它自己」—— **它的條件只比對 text marker，
      改完仍是綠的，但名字錯了**）、`:663–668` 的段落 docstring（「各自的 view 互不影響」）
- [x] 4.9 **對照組（三組）已全部跑過，結果如下 —— 三組都精準命中，沒有一組是「功能被拆掉」的紅**：
      **(a)** 在 `MainStage` 加一份 per-session 覆寫（全域預設 ＋ 覆寫）→
      **4.5「切回終端時其他 session 亦回到終端」紅**，而 4.3「新建的第二個 session 採用當前的
      全域選擇」**仍綠**（新 session 尚無覆寫，落回全域）—— 正是要區分的那條界線，3/4 通過；
      **(b)** renderer 額外送出 `view` 且 `replace()` 白名單收下它 →
      **4.1 後半「SHALL NOT 落在 session 的持久化紀錄裡」紅**，前半「落盤於偏好檔」仍綠，8/9 通過；
      **(c)** 拿掉 1.2 的解構 → `runRebuiltWidth` 段落失敗（等待「重建的 session 以對話 view
      呈現」耗盡並拋出），同時證明了 1.2 是必要的。
      原始的設計理由：
      **(a)** 把 `sessionViewOf` 改成 `session.view ?? preferences.agentView`（＝保留 per-session
      覆寫的語意），4.5 必須紅、4.1 仍綠。**不可用「改回讀 `session.view`」當對照組** ——
      那時沒有任何人在寫它 ⇒ 恆為終端 ⇒ 整段一起紅，那是「功能被拆掉」的紅，
      區分不了正確與錯誤的實作；
      **(b)** 讓 renderer 額外送出 `view` 並在 `replace()` 白名單收下它，4.1 的後半必須紅。
      **不可用「只把 `replace()` 的欄位加回去」** —— renderer 已不送，`entry.view` 恆為
      `undefined`，`JSON.stringify` 直接丟掉該鍵，對照組全綠；
      **(c)** 把 1.2 的解構拿掉，`:456–461`「重建後回到上次的 view」必須紅
      （那同時證明了 1.2 是必要的）
- [x] 4.10 逐條核對下表（**四列標「既有」的都已開檔案讀到那一行的字串**：
      `:314`「agent session 預設為終端 view，且提供切換入口」、`:381`「切回終端 view 後對話
      輸入框消失，切換入口仍在」、`:500`「重建後回到上次的 view（對話）」、
      `runDormantConversation`（`:865`）） —— 標「既有」的每一列都要**開檔案讀到那一行的字串**，
      且要問「它驗的是不是這條 scenario 說的事」

| Scenario | 載體 | 狀態 |
|---|---|---|
| 切換一個 session 的 view，其他 session 一起改變 | `runParallelSessions`（4.3） | 新增 |
| 切回終端時其他 session 亦回到終端 | `runParallelSessions`（4.5）＋對照組 4.9a | 新增 |
| 選擇不落在 session 的持久化紀錄裡 | 落盤段落（4.1 後半）＋對照組 4.9b | 新增 |
| 重啟後回到上次的選擇 | `probe-agent-view.mjs:456–461`「重建後回到上次的 view（對話）」＋落盤段改讀偏好檔（4.1 前半）＋對照組 4.9c | 既有（已讀），落盤位置改 |
| 持久化的值不合法時回到終端 | `preferences-store.test.ts`（1.5b） | 新增 |
| 新建的 agent session 預設為終端 view | `probe-agent-view.mjs:312–317`「agent session 預設為終端 view，且提供切換入口」—— 該段用全新 profile 且發生在任何 toggle 之前，**MODIFIED 新增的前提「尚未切換過」成立** | 既有（已讀） |
| 已選擇對話 view 時，新建的 session 採用該選擇 | `runParallelSessions` 第二個 session（4.3） | 新增 |
| 切換到對話 view 再切回 | `probe-agent-view.mjs:379–384`「切回終端 view 後對話輸入框消失，切換入口仍在」 | 既有（已讀） |
| shell session 沒有對話 view | **無載體** —— `probe-agent-view` 不建立 shell 目標的 session，其他探針也沒有斷言切換入口的缺席（已 grep）。**既有缺口，非本 change 引入**，轉為 **issue #40**（見 4.12） | 無載體 |
| （MODIFIED 的 SHALL NOT：不得以「該 session 自動退回終端」化解） | **無載體，且不打算做** —— 要驗它得先注入一個「對話 view 讀不到內容」的失敗，再證明系統**沒有**做某件它從未被實作的事。由 spec 條文與 code review 承擔，比照 `conversation-report` 的「真實委派無自動化驗收載體」 | 無載體 |
| 休眠的 session 於對話 view 呈現休眠（**既有 requirement，本 change 會弄壞它的載體**） | `runDormantConversation`（`:757`）—— 由 4.6 的狀態還原保住 | 既有，本 change 須維護 |

- [x] 4.11 **已跑**：`probe:agent-view` 41/41（原 38，新增 3 條）、`test:e2e` **11/11 全部通過**
      （五支帶段落資訊的皆「完整執行」）、單元 902/902。
      **注意**：第一次 `test:all` 的單元段踩到 issue #41 那個偶發假紅（`cdp-transport.test.mjs`
      被 node:test runner 的 IPC 反序列化打掉），而 `test:all` 是 `test:unit && test:e2e` ——
      **它一紅就短路，十一支探針一支都沒跑，而輸出看起來像跑完了**。e2e 是之後單獨補跑的
- [x] 4.12 **已開為 issue #40**：「shell session 沒有對話 view」這條 scenario 自 `agent-transcript-view`
      封存以來沒有任何驗收載體。**本 change 不做** —— 它與作用域無關，而補它要讓
      `probe-agent-view` 學會建立 shell 目標的 session
- [x] 4.13 **dogfood 已由使用者實際操作確認**（2026-09-10，dev）：開兩個 agent session 切換
      view、往兩個方向各驗一次、重開 app 確認保留、調字型確認 view 沒有跳回，皆無問題。
      （dev profile 裡先前帶著舊 `view` 欄位的 2 個 session 於首次啟動回到終端 —— 預期行為。）

## 5. 文件

- [x] 5.1 CLAUDE.md「現況」的 agent 對話 view 段落 —— 已確認**只寫「終端為預設」、沒有提到
      作用域**，因此不需要動。在此註明已核對
- [x] 5.2 `docs/PRD.md` 與 `docs/lessons/transcript.md` —— 已 grep，兩者皆未描述 view 的作用域，
      不需要動。在此註明已核對
