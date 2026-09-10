## Context

動機與那個「純全域 vs 三種覆寫」的裁決見 `proposal.md`。這裡只記把它做出來需要知道的現況。

**選擇目前住在四個地方，而它們是同一份資料的四段：**

| | |
|---|---|
| `PersistedSession.view`（`session-store.ts:73`／讀 `:166`／寫 `:336`） | 落盤於 `sessions.json` |
| `SessionState.view`（`sessions.tsx:77`）、`setView`（`:134`／`:493`）、restore 映射（`:293`）、**persist 映射（`:328`／`:336`）** | renderer 的 state 與唯一的寫入點 |
| **`SessionTabs.tsx:21`／`:219`／`:221`／`:223`／`:226`** | **切換入口本體。四處直接讀 `focused.view`，不經 `sessionViewOf`** |
| `sessionViewOf`（`MainStage.tsx:48`） | 讀出點。**對非 claude 目標一律回終端** —— 這一條不動 |

> **型別名稱**：主行程是 `PersistedSession`，renderer 是 `SessionState`。
> codebase 裡**沒有** `SessionEntry` 這個型別（只有 `parseSessionEntry` 這個函式名）。

**偏好那一側的管線已經齊備**：`preferences-store.ts` ↔ `ipc/settings.ts` ↔ `preload` ↔
`PreferencesProvider`（`AppShell` 最外層）↔ `usePreferences()`。

**三個承重的既有性質：**

- **`parsePreferences` 對結構嚴格、對值寬容**：`version` 不符或 `terminal` 不是物件 → 回 `null`，
  整檔隔離並以預設啟動；個別欄位不合法只是清理成「未設定」。
- **`SessionStore.replace()` 是逐欄位白名單**（不是 `{...entry}` 原樣展開）—— 於是「把 `view`
  從型別上移除」**同時就等於**「它不會再被寫進磁碟」。`session-store.ts:163` 的註解記著
  「三處逐欄位白名單」，那三處都要動。
- **偏好的寫入沒有 debounce**（每個 setter 直接原子寫檔），與 `sessions.json` 的 500ms debounce
  不同 —— 這對驗收是好消息（見 D6）。

## Goals / Non-Goals

**Goals:**

- 「兩個 agent session 的 view 不一樣」在結構上**表達不出來**。
- 切換的入口不動（仍在分頁列上），只有作用域改變。
- 「未設定＝終端」這個判斷**只存在一處**。

**Non-Goals:**

- **不改預設值**（仍是終端，仍不可移除）。
- **不搬進 Settings 對話框** —— toggle 留在原地（張力見 Risks）。
- **不寫遷移**。既有 `sessions.json` 的 `view` 讀取時忽略。
- 不動 `sessionViewOf` 對非 claude 目標的判定。
- **不修 `agentStatus` / `agentEvents` 的既有缺陷**（見 D1 的警語）—— 轉為 issue。

## Decisions

### D1：偏好放進既有的 `TerminalPreferences`，但**不可照抄它的先例**

新欄位 `agentView?: 'terminal' | 'conversation'`，放在 `PersistedPreferences.terminal` 之下。

**名字上它不是「終端」偏好，這個張力是真的。** 但同一個區塊裡已經住著 `agentStatus` 與
`agentEvents`，那兩個同樣不是終端外觀 —— 先例已經在那裡，而另開一個 `agent` 頂層區塊要付
一條新的 parse 分支、一個新的 IPC 通道、`PreferencesProvider` 的第二份 state 及其測試。

> **而「順手把區塊改名」是不能做的**：`parsePreferences` 在 `version` 不符時**隔離整檔**，
> 一次版本遞增等於每個使用者的字型設定歸零。
>
> **`PREFERENCES_VERSION` 維持 1。** 加一個 optional 欄位對舊檔向後相容（缺席＝未設定）。
> **但「對舊版產物向前相容」要講精確**：舊版讀新檔不只是忽略那個鍵 —— 它 `load()` 之後
> 記憶體裡沒有它，**下一次任何 setter 的 `save()` 會整份重寫而把它從磁碟抹掉**。降版一次
> 再改任何偏好，選擇就沒了。無害，但「忽略」與「抹除」是兩件事。

**⚠ 這個先例是壞的，照抄會讓「重啟後回到上次的選擇」靜默失效。** 實測（2026-09-07）：

- **`parsePreferences:112` 只解構四個鍵** —— `const { fontFamily, fontSize, lineHeight,
  gpuAcceleration } = terminal`。`agentStatus` 與 `agentEvents` **在讀取時被丟掉**，
  於是那兩個開關寫得進磁碟卻不跨重啟。
- **`setTerminalFont:202` 從一個空物件重建 `terminal`**，只顯式保留 `gpuAcceleration`
  （`:214–216`，那段註解正是在警告這個坑）—— 於是改一次字型也會把它們抹掉。
- `preferences-store.test.ts` 對這兩個欄位**零覆蓋**，所以沒有任何東西擋著。

**因此 `agentView` 必須改三處，不是一處**：型別、**`parsePreferences` 的解構清單**、
**`setTerminalFont` 的保留**。少了第二處，重啟就回不來；少了第三處，
使用者切到對話 view 之後**開 Settings 調一次字型，它就靜默跳回終端**。

**那兩個既有欄位的缺陷不在本 change 的範圍**（它們是別的能力的偏好），轉為 issue。

### D2：值的清理是白名單，不是「不是 conversation 就當 terminal」

`sanitizeAgentView(value)`：**恰為那兩個字面值之一才採用**，其餘（含 `null`、數字、任意字串）
一律回 `undefined`（＝未設定）。比照 `sanitizeFamily` / `clampSize` 的位置與形狀，
也比照 `gpuAcceleration` 那條「只認真正的布林」的既有判斷。

**寫成 `value === 'conversation' ? … : 'terminal'` 會把「檔案壞了」與「使用者選了終端」變成
同一件事** —— 而前者的正確處置是回到未設定，讓「未設定＝終端」那條規則去決定。

### D3：「未設定＝終端」收在 `PreferencesApi` 的一個衍生值裡

`PreferencesApi` 增加 `agentView: 'terminal' | 'conversation'`，等於 `terminal.agentView ?? 'terminal'`。

理由與既有的 `gpuEnabled` / `agentStatusEnabled` 一字不差：**把「undefined 代表什麼」收在一處，
呼叫端就不會各自寫一次 `?? 'terminal'`** —— 漏掉一處的症狀是「偏好設了對話 view，但某個地方
還是終端」，而那不會有任何型別錯誤。

寫入端 `updateAgentView(view)` 回傳 Promise、呼叫端 await，並以主行程回傳的「套用後的偏好」
更新本地 state（比照 `updateGpuAcceleration`）。

> **這條改變了切換的性質，要寫下來**：此前 `setView` 是 renderer 的本地 state 更新
> —— 同步、不可能失敗。現在是一次 IPC 往返 ＋ 主行程的同步原子寫檔。功能上可接受
> （每次 toggle 之後探針都有 `pollFor`），但**新增了一種失效：IPC reject 時畫面靜默地不動**。
> 至少要 `console.error`，不要讓它連紀錄都沒有。

### D4：`setView` 的簽名要拿掉 `sessionId`，`SessionTabs` 的四處讀取要一起換

`SessionsApi.setView(sessionId, view)` 整個移除；`SessionTabs` 的 `onSetView` prop 改為
`(view) => void`（或直接由 `MainStage` 傳一個已綁好的 handler）。

**不要保留簽名只是忽略第一個參數，也不要保留 `SessionState.view` 只是不再有人寫。**
後者的症狀特別惡劣：`SessionTabs:219/221/223/226` **不經 `sessionViewOf`**，直接讀
`focused.view` 決定 `aria-label`、`aria-pressed`、`onClick` 送出的值與按鈕文字 ——
留著一個恆為 `undefined` 的欄位，按鈕標籤會永遠停在「顯示對話」、**點它永遠只送
`'conversation'`，切不回終端**，而探針正是以 `aria-label` 找那顆按鈕。

### D5：偏好是非同步載入的，而它的代價比原本寫的大

`PreferencesProvider` 是 `useState({})` → IPC → `setState`。而 `restore()`（session 清單）
是另一條互不相干的非同步。**兩者的先後沒有保證。**

> **前一版 design 說「閃動只是哪一層在上面，不是掛載／卸載」—— 那是錯的。**
> `MainStage.tsx:500` 是 `folderSessions.filter(…).map(…)`：**對話 view 在終端 view 之下
> 根本不在樹上**。一直掛著的是終端，不是對話。偏好晚到 ⇒ `ConversationView` 一次真正的
> **掛載**（連同它自己的訂閱與內容抓取）。
>
> 而此前**沒有這個窗口**：`session.view` 與 session 本身來自同一次 `restore()`，是原子的。

**這個窗口有兩個看不見的副作用**：`TerminalView` 以 `covered` 決定 GPU renderer 與焦點
（`:331` `if (!covered) …focus()`、`:354` `setGpuRenderer(active && !covered && gpuEnabled)`）。
未覆蓋的那一瞬間，終端會取得一次 webgl context 並搶走焦點，然後才被蓋掉。

**它還會削弱 `runRebuiltWidth` 的鑑別力** —— 那是 `probe:agent-view` 自稱最容易假綠的一段
（要證明「對話 view 在上層時終端仍保有版面盒子」，判準是替身回報的 `stty size` 不是 80）。
若重建時終端先以未覆蓋狀態出現並被 fit 過，欄數在那一瞬間就已經正確。
**這是一個沒有被寫下來的時序前提**，tasks §4 要補一條前置。

處置：`PreferencesProvider` 留在樹的最外層（已經是），並接受這個窗口 —— 但**不再宣稱它無害**。

### D6：驗收的落點換了，而新落點比舊的可靠

落盤斷言從 `sessions.json` 改讀 `<profile>/preferences.json`。探針的 `--user-data-dir`
就是 `context.profile`，而主行程用 `join(app.getPath('userData'), 'preferences.json')` ——
路徑對得上。

**偏好沒有 debounce**（`sessions.json` 有 500ms），所以只需要等一次 IPC 往返。
`pollFor` 仍然要用，但 `probe-agent-view.mjs:395–404` 那段解釋 debounce 的長註解**必須改寫**
—— 否則它會描述一個在新路徑上不存在的機制。順帶：那次等待此前也隱含保證了
「`sessions.json` 已 flush」，換掉之後就沒有了。

## Risks / Trade-offs

- **逃生口的作用域變成全部，而它的用途比「壞掉」廣**（`agent-input-bridge` 的三條 requirement
  把 permission 提示制度性地推回終端 view）。這是這個裁決真正的代價，四個選項的比較見 proposal。
- **一個全域偏好卻沒有全域入口。** `TerminalPreferences` 裡其他使用者可控的欄位都在 Settings
  對話框裡，只有 `agentView` 不在；它唯一的入口是**只在 focused session 是 agent 時才出現**的
  那顆按鈕。**workspace 裡當下沒有 agent session 時，這個全域偏好完全不可達。**
  `terminal-preferences` 的設定介面條款是下限清單，所以不違規 —— 但這個張力要承認，
  日後若要加進 Settings，那是一條 delta。
- **升級後第一次啟動，先前切到對話 view 的 session 回到終端。** 實測目前出貨 profile
  （`~/.config/Spekterm/sessions.json`）**14 筆 agent session 一筆都沒有 `view` 欄位**，
  dev profile 只有 2 筆 —— 代價比原本估計的更小。但**它看起來像 bug**，dogfood 時要預期。
- **`TerminalPreferences` 這個名字繼續變得更不準確。** 已知、刻意、有清償路徑（D1）。
  **下一個要往裡面加東西的人應該先問是不是該整理了** —— 而且要先修 D1 那兩個漏洞，
  否則新欄位會重蹈 `agentStatus` 的覆轍。
