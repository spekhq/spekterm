## 1. 主行程：per-folder 座標的 store

- [x] 1.1 新增 `src/main/panel-store.ts`：`PanelCoordinate = { sourceFolderId?, worktreeKey?,
      anchoredChange? }`，落盤為 `panel.json`（`{ version, coordinates: Record<string,
      PanelCoordinate> }`），版本欄位 + 原子寫（先寫暫存檔再更名）+ 損毀改名保留，比照
      `workspace-store` / `session-store` / `preferences-store`
- [x] 1.2 **驗證發生在寫入的入口，不只在讀取時**（design D10）—— `replace()`／`persist` 進來就
      套用與讀取端同一份判定，不合法的維度直接丟棄。**不要照抄 `session-store.replace()` 的姿態**：
      它是 `...entry` 原樣展開、只檢查 `isUuid(entry.id)`（`session-store.ts:307-322`），驗證全在
      `parseSessionEntry`（讀）那一側 —— 照抄的話，「落盤不含路徑」這條 SHALL 就沒有人負責，而
      任何「寫一份合法值再讀回來」的測試都會通過，不論實作對錯
- [x] 1.3 **解析為兩層容忍**：整份無法解析或版本不符 → 隔離原檔、以空 map 啟動；**單一維度的值
      不合法 → 只丟棄該維度**，同筆的其他維度與其他 folder 的座標照常還原（照抄
      `parseSessionEntry` 的姿態 —— 它對 `worktreeKey` 與 `panelWorktreeKey` 已是各自獨立驗證）
- [x] 1.4 `worktreeKey` 以 `isWorktreeKey()`（`/^[0-9a-f]{8}$/`）驗證 —— 自 `session-store.ts`
      提出為共用（目前是該檔的 module-private 函式），**不要平行實作一份**
- [x] 1.5 `remove(folderId)`：folder 自 workspace 移除時刪掉該筆，**以「屬於該 folder 的全部鍵」
      表達而非單一鍵精確比對**（今日等價，但鍵是不透明字串且 #5 會擴充它 —— design D11）。
      **載入時不主動修剪孤兒條目**，註解寫明理由 —— 某次 `workspace.json` 讀取失敗而以空 workspace
      啟動時，一次主動修剪會把**所有**座標刪光，把一個可復原的失敗變成不可復原的
- [x] 1.6 單元測試（`panel-store.test.ts`）：版本不符／無法解析 → 空 map + 原檔改名保留；
      **單一維度不合法時同筆其餘維度仍還原**（對照組：改成整筆丟棄必須變紅）；原子寫；
      `remove` 後該筆消失
- [x] 1.7 **「落盤不含路徑」寫成負向斷言**：餵一筆 `worktreeKey` 為路徑形狀的座標進 `replace()`，
      斷言寫出的檔案裡**沒有**那個值、而同筆的其他維度照常保存。**對照組：拿掉 1.2 的 ingress
      驗證必須變紅** —— 正向寫法（寫一份合法座標再斷言檔案裡沒有 `/`）是教科書級的假綠

## 2. 主行程：IPC、debounce 與 folder 生命週期

- [x] 2.1 新增 `src/main/ipc/panel.ts`：`workspace:panel:get`（invoke）與 `workspace:panel:persist`
      （fire-and-forget），形狀比照 `terminal.restore` / `terminal.persist`
- [x] 2.2 落盤 **500ms debounce**（錨定 change 是點一下就發生的高頻動作），並於**關窗與 reload
      時 flush** —— flush 點比照 `ipc/terminal.ts:122,134`。少了 flush，使用者最後一次選擇會丟掉，
      而那個失敗與「持久化整個沒做」長得一模一樣（`files-in-worktree` 的探針踩過）
- [x] 2.3 `src/preload/index.ts` 新增 `panel` namespace 白名單。**不掛在 `folders.*` 之下** ——
      座標的鍵在 issue #5 之後就不再是 folder id（design D3）
- [x] 2.4 **`scripts/probe-shell.mjs` 補一條頂層 namespace 守衛（`surplusApiKeys`），再加上
      `panel` 的 method 清單。** 該檔目前只有五條 `surplus*Keys`（fs／openspec／folders／terminal
      ／settings），**沒有任何一條檢查 `Object.keys(api)` 本身** —— 也就是說加一個全新的 namespace
      它一聲都不會響。那正是 CLAUDE.md 記著咬過兩次的那個洞（當年 `folders.*` 與 `terminal.*`
      整個 namespace 沒有守衛）。**只加 `panel` 的清單是把同一個模式再複製一次；補頂層守衛才是
      結構性地關掉它**，成本幾行
- [x] 2.5 `src/main/ipc/folders.ts` 的 remove handler 一併呼叫 `panelStore.remove(id)`
      （`registerFolderHandlers` 的簽名要多收 panelStore）
- [x] 2.6 `src/main/index.ts`：建立 store、`load()`、註冊 handler —— 比照 `WorkspaceStore` 與
      `SessionStore` 的既有接線

## 3. renderer：`PanelCoordinateProvider`

- [x] 3.1 新增 provider，形狀比照 `SessionsProvider`：`coordinateOf(folderId)`、`setSource`、
      `setWorktree`、`setAnchor`
- [x] 3.2 **三道閘一個都不能少**（design D4，全部是 `SessionsProvider` 已踩過的坑）：
      (a) 落盤 effect 的 **restored 閘** —— 少了它會在磁碟資料讀回來之前送出空 map，**靜默抹掉
      上次的座標**；(b) restore 的 setState 是**合併不是覆蓋**（使用者已動過的鍵保留使用者的）；
      (c) **StrictMode 的 ref 閘**，否則 restore 跑兩次、合併規則被套兩次
- [x] 3.3 `setSource` 一併重置 `worktreeKey` 與 `anchoredChange`（`side-panel-source` 與
      `side-panel-worktree` 的兩條「切換來源時重置」）—— 兩者的識別碼都隸屬於某個 repo
- [x] 3.4 還原時的降級：`sourceFolderId` 指向的 folder 不在 workspace → 退回該 folder 自身；
      `worktreeKey` 不在該 repo 的工作目錄清單中 → 退回 folder 自身。**皆不得使啟動失敗**

## 4. renderer：切換消費者到 per-folder（**行為自此改變**）

- [x] 4.1 `MainStage`：`panelFolder` 改自 `coordinateOf(focusedFolder.id).sourceFolderId` 解析；
      `changePanelSource` / `changePanelWorktree` / `anchorChange` 改寫為對 provider 操作。
      **`openFileFromOpenSpec` 內的 `sessions.setPanelWorktree` 呼叫（`MainStage.tsx:286`）也在
      這一批** —— 它目前包在 `if (focusedId)` 裡，於是 `side-panel-worktree` 那條**無條件**的
      「自 OpenSpec 跳往檔案時工作目錄一併切換」**今天在無 session 時根本沒有兌現**（零覆蓋，因為
      探針一律先建 session）。改基順手修好它，並補上驗收（task 7.10）
- [x] 4.2 `PanelCoordinateProvider` 掛在 `SessionsProvider` 同一層（`AppShell`）—— 它必須同時
      涵蓋 `MainStage` 與 `StatusBar` 兩個消費者
- [x] 4.3 **刪除 `viewing` map**（`MainStage.tsx:41`）—— 它正是本 change 要消滅的那個分歧的具體化
      （註解自己寫著「錨定無處可去，改由 folder 持有」）。`anchorChange` 的二分隨之收斂為單一路徑
- [x] 4.4 **移除兩處 `canSelect` gate**：`MainStage.tsx:411` 的 `canSelectSource={focusedId !== null}`
      與 `SidePanel` 傳給 `FilesPanel` 的 `canSelectWorktree`；`PanelSourceBar` 與 `WorktreePicker`
      的 `canSelect` prop、`disabled`、`cursor-default` 分支一併刪除（不是傳 `true`，是**整條移除**）
- [x] 4.5 `PanelSourceBar` 的 `ownerId` 改為非 nullable。**值一行都不用改**（本來就是
      `focusedFolder?.id`）—— 改的是它的論證：由「碰巧等於 session 所屬 folder」變成「定義本身」
      （design D6）。`panelFolder` 非 null ⟺ `focusedFolder` 非 null，`isForeign` 的 null 分支消失
- [x] 4.6 `StatusBar`：側欄來源與錨定 change 改自 provider 讀取（目前是
      `sessions.panelSourceOf(focusedId)` / `anchoredChangeOf(focusedId)`）
- [x] 4.7 **`openSessionInChangeWorktree` 把該 change 寫進 `panelFolder` 的座標**（design D8）——
      側欄來源即 focused folder 時那是同一筆、等於不變；指向另一個 repo 時，使用者切過去讀到的
      正是那一筆。少了這步，`artifact-continuation` 的「新建的 session 錨定該 change」失效
- [x] 4.8 **移除 `soleActiveChangeForCreate` 與 `create` 的 `anchoredChange` 參數**（design D9）
      —— 衍生預設統一為動態，不再於建立 session 時固化
- [x] 4.9 **`create` 的尾參改為 options 物件**：`create(folderId, spawnTarget, { worktreeKey })`。
      現況是 `create(folderId, spawnTarget, anchoredChange?, worktreeKey?)` —— 移除**中間**那個
      同型參數之後，`MainStage.tsx:234` 若漏改，**slug 會靜默地被當成 worktreeKey 傳下去**
      （兩者都是 `string | undefined`，型別檢查一聲不響），而主行程對查無的識別碼是**拒絕建立**
      ⇒「於該工作目錄開啟 session」變成一顆沒反應的按鈕。**4.6／4.7／4.8 是同一步，不可分開做**
      （preload 的 `terminal.create` 不受影響 —— `anchoredChange` 從未經它送出）

## 5. 拆掉 per-session 的三個欄位

- [x] 5.1 `terminal/sessions.tsx`：移除 `panelFolderId` / `panelWorktreeKey` / `anchoredChange`
      三個欄位、`setPanelSource` / `setPanelWorktree` / `anchorChange` 三個 setter、
      `panelSourceOf` / `panelWorktreeOf` / `anchoredChangeOf` 三個讀取器，以及 restore／persist
      payload 中的三個欄位
- [x] 5.2 **讀取器整個移除，不保留「相容用」的舊介面**（design 的 Risks）—— 那樣漏改的地方才會
      編譯失敗。這次要讓型別系統站在我們這邊
- [x] 5.3 `src/main/session-store.ts`：`PersistedSession` 移除三個欄位、`parseSessionEntry` 移除
      對應解析。舊 `sessions.json` 裡的那些鍵在下次 `replace()` 時自然消失，**不做遷移**
      （design D5）
- [x] 5.4 `session-store.test.ts`：移除三個欄位的既有測試（`panelFolderId` 保留／清洗、
      `panelWorktreeKey` 與 `worktreeKey` 各自獨立、跨 replace 保留、`anchoredChange` 跨 replace
      保留），並新增一條**負向守衛**：renderer 送來的 payload 含這三個鍵時不進入落盤結果
      （`session-persistence` 的「側欄座標不隨 session 落盤」）
- [x] 5.5 `npm run typecheck` 全綠 —— 它是這一組的驗收：任何漏改的讀取點都會在此現形

## 6. 文案

- [x] 6.1 刪除 `src/shared/i18n/en.json` 的 `files.worktree.needSession`（"Start a session in this
      repo to switch working directory"）—— 它唯一的消費者是即將消失的那道 gate
- [x] 6.2 確認其餘 key 的文案在新語意下仍然誠實：`panelSource.foreign` / `panelSource.backToOwn`
      的「自身」現在指 rail 上選中的 folder；**`openspec.continueBlocked.foreignSource`**
      （`en.json:167`，"…Switch it back to **the session repo** to continue."）—— 那個「session
      repo」在新模型下應為 rail 上選中的 folder。改文案是安全的：6 處 probe 選擇器全部走 `copy()`
      自字典取字串（已確認）

## 7. 驗收

> **7.13／7.14／7.16 的未竟部分已轉為 [issue #10](https://github.com/spekhq/spekterm/issues/10)。**
> 一個帶著未打勾方框的已封存 change，等於宣稱自己完成了卻沒有 —— 而那些缺口從此不在任何工作
> 清單上。**封存時 tasks 必須全部 done：做完、或明確轉出去。**

- [x] 7.1 **`probe:openspec` 新增核心段落：尚無任何 session 的 folder，兩個選擇器皆可用。**
      開來源指示器選另一個 repo → 斷言**側欄內容真的換成該 repo 的**（不是只斷言選單關掉了）；
      於有多個工作目錄的 folder 重複一次工作目錄選擇器。互動用 `Input.dispatchMouseEvent` 真事件，
      並斷言選單 rect 完整落在 viewport 內
- [x] 7.2 **這段有一個排序約束**：探針**無法**經 UI 加 folder（`folders.add` 開的是原生
      `showOpenDialog`），既有做法是預先寫 `workspace.json`（`probe-openspec.mjs:260`）。而座標
      現在**跨段落存活**，所以這一段必須排在「任何一段於該 folder 建 session」**之前**，否則
      「尚無任何 session」這個前置條件不成立
- [x] 7.3 `probe:openspec`：**尚無 session 時仍可於 Changes 樹建立錨定** —— 開瀏覽視圖 → 點一個
      change → 斷言視圖切到本 change **且呈現該 change**。這條看著的正是 task 4.2 刪掉的
      `viewing` map（今天無 session 時錨定唯一的存放處），刪一條路徑而不留斷言看著它，是最容易
      產生靜默回歸的組合
- [x] 7.4 **上一條必須有對照組** —— 把 `canSelect` gate 加回去重跑，該段落必須變紅。那是一條
      **先前恆為停用**的路徑，「按了沒反應」與「按了有反應」在畫面上很接近（design 的 Risks）
- [x] 7.5 `probe:openspec`：**座標跨 session 共用** —— 同一個 folder 內切換 focused session，
      側欄仍呈現同一個來源、工作目錄與 change。**三個維度都必須先設成非預設值**（把來源指到
      另一個 repo、明確點選一個 change、選定一個 linked worktree）**才切 session** —— 座標皆為
      預設時，「切 session 前後一樣」在**per-session 的舊實作上也必定成立**，那條斷言的鑑別力
      是零（同 7.5 的紀律，初版漏在這裡）
- [x] 7.6 **既有的假綠一併修掉**：`probe-openspec.mjs:1782` 的「側欄來源跨重建還原」斷言的是
      `ANCHORED_SLUG === 'solo-change'`，而 `solo-change` 正是 `repo-single` 的**衍生預設** ——
      那條今天就沒有鑑別力。改基時換成明確錨定的值，不要照抄
- [x] 7.7 `probe:openspec`：**衍生預設的動態性**（design D9）—— 靠衍生預設呈現唯一的 active
      change 時，於磁碟新增第二個 active change → 本 change 視圖轉為空狀態；而**已明確錨定**時
      不受影響（成對，否則「衍生預設整個壞掉」也會過）
- [x] 7.8 **這一段污染的是磁碟，走 UI 的還原助手救不回來。** `repo-single` 的 `solo-change` 是
      其前後數十條斷言的前提（`ANCHORED_SLUG === 'solo-change'`、tasks 進度…），在它底下多開一個
      change 會波及一整片。**用一個專屬的 fixture repo**（或於段落結束時把新增的目錄刪掉）——
      這與 7.7 的 UI 狀態污染是**不同種**的問題，兩者都要處理
- [x] 7.9 `probe:openspec`：座標跨重啟還原 —— 三個維度各一條，**且 reload 前必須先把狀態改成
      非預設值**（預設就是 folder 自身，只驗預設值的話功能全死也是綠的）。persist 有 500ms
      debounce，reload 前要等或輪詢
- [x] 7.10 **既有 probe 段落改基 —— 是「反轉或刪除」，不是機械替換主詞。** 逐條盤點
      `probe-openspec.mjs:1626-1790`，至少這幾條在新模型下**必然為假**：
      `:1734`「每個 session 各自保有側欄來源」→ **新規格要求相反**；
      `:1738`「側欄來源跟隨 focused session」→ 改為「切 session **不**改變側欄來源」；
      `:1727-1730`（建第二個 session 再改它的來源）在新模型下會**改掉整個 folder 的來源**，
      其後 `:1733` 的斷言基礎整個崩掉；`:1775-1789`（跨重建還原）落盤路徑已換成 `panel.json`。
      **照字面做機械替換會被一片紅燈淹沒。** `probe:files` / `probe:workspace` 亦逐一掃過
- [x] 7.11 **處理段落互相污染** —— 座標跨 session 共用之後，某段把側欄指向別的 repo，**其後每一段
      站在同一個 folder 上的測試都會看到它**（此前換個 session 就回到預設）。加一個走產品自身路徑
      的 `resetPanelSourceToSelf()` 助手並於受影響段落前呼叫；**新段落自建前置條件，不假設前面
      每一段都還原了**（`files-in-worktree` 踩過：一次紅 15 條，其中兩條反而變成假綠）
- [x] 7.12 `probe:shell`：頂層 namespace 守衛與 `panel` 的 method 清單皆生效（task 2.4 的驗收）；
      **頂層守衛要有對照組** —— 往 preload 塞一個未列入的 namespace，它必須變紅
- [x] 7.13 **本 change 不做，已轉為 issue #10。** `probe:openspec`：側欄來源指向**另一個 repo** 時，開 session
      的入口把錨定寫進該來源 folder。**常見情形（來源即 focused folder）已由既有的 worktree
      段落涵蓋** —— 那時兩者是同一筆，寫入等於不變，而「觸發後…並錨定該 change」與「建立後續寫
      入口可用」兩條斷言都在跑。**未涵蓋的是跨 repo 那一支**：它需要把側欄指向 `repo-worktree`
      再觸發入口，而那會動到 worktree 段落所依賴的狀態。失效是靜默的（使用者切過去才看到空狀態）
      —— 缺口寫在這裡，不假裝驗過
- [x] 7.14 **本 change 不做，已轉為 issue #10。** `probe:openspec`：無 session 的 folder，自 worktree 的 change
      跳到檔案 → 樹根切到該 worktree。實作已移除 `MainStage.tsx` 的 `if (focusedId)` gate
      （task 4.1），而**有 session 的那一支由既有的反向導覽段落涵蓋**；無 session 的那一支未加
      斷言。它是「一條 requirement 在無 session 時零覆蓋」的同一個形狀 —— 只是範圍縮小了
- [x] 7.15 `probe:openspec`：**`status-bar` 改基後「無 session 時整條列呈現空狀態、不單獨呈現
      change」**（task 4.6）。放在無 session 段落，而該 repo 恰好**有**一個由衍生預設呈現的
      change ⇒ 斷言有鑑別力。**起初誤放在 `probe:workspace` 的狀態列段落，那裡已經有 session
      （文字中的 `2/2 sessions` 戳破了它）** —— 前置不成立的斷言不是驗收，是噪音。
      「有 session 時呈現座標所錨定的 change」**未新增斷言** —— 既有的狀態列段落已涵蓋「呈現
      當前 repo 與 session 脈絡」，而改基不改變那個外觀
- [x] 7.16 **未竟的部分已轉為 issue #10。** 座標的兩條降級路徑（task 3.4）。**工作目錄已消失**那條由既有的
      `files-in-worktree` 驗收涵蓋（查表落空 → 退回 folder 自身）。**來源指向的 folder 已被移除**
      那條未加斷言：探針無法經 UI 加回 folder（`folders.add` 開的是原生對話框），移除一個
      folder 會讓 rail 少一項而波及其後每一段。實作為 `folders.find(...) ?? focusedFolder`
      一行，且 `panel-store` 的 `remove` 已有單元測試
- [x] 7.17 `npm run typecheck` 與 `npm test` 全綠 —— 0 錯、370/370、`npm run lint` 亦乾淨

## 8. 收尾

- [x] 8.0 **`/opsx:verify` 的自我稽核與其修正**（本組其餘項目之前先做）：
      - **C1（已修）** 「錨定的 change 跨重啟還原」這條 scenario **無任何驗收** —— 而它正是
        spec 稽核階段發現缺漏、親手補進 `side-panel-source` 的那一條。task 7.9 寫著「三個維度
        各一條」，實際只做了來源與工作目錄。**補一條 scenario 與覆蓋一條 scenario 是兩個動作，
        前者不蘊含後者。** 已於既有 reload 段落補上，並刻意錨定 `repo-many` 的 change
        （該 repo 有兩個 active ⇒ 無衍生預設 ⇒ 還原的值只可能來自落盤）。
      - **S1（已修）** `ipc/panel.ts` 的 `flushPanel` 匯出後從未被呼叫。關窗與 reload 的 flush
        由 `hookLifecycle` 的 `destroyed`／`did-navigate` 涵蓋，該匯出是多餘的，已改回
        module-private（比照 `ipc/terminal.ts` 的同名者）。
      - **W1（如實記錄，不補測）** 「側欄的工作目錄與 session 開啟的工作目錄各自保存」失去覆蓋：
        該 scenario 自 `session-persistence` 搬到 `side-panel-source` 時，task 5.4 一併刪掉了
        覆蓋其前身的單元測試，未補替代品。**不硬補的理由**：兩個維度現在住在**不同的檔案、由
        不同的 store 管**，沒有任何程式碼把它們接在一起 —— 結構上的保證比原本那條單元測試更強，
        而跨兩個 store 的獨立性用單元測試表達會很勉強。**這是論證不是驗收，寫在這裡讓它可被反駁。**

- [x] 8.1 把 `openspec/specs/side-panel-source/spec.md` 的 Purpose 由
      `TBD - created by archiving change side-panel-repo-anchor` 這句 stub 寫成真的 —— 本 change
      把它升格為**側欄座標**的 umbrella（delta spec 不承載 Purpose，只能直接改）
- [x] 8.2 **`openspec/specs/terminal-sessions/spec.md` 的 Purpose 拿掉「錨定的 change」**
      （`spec.md:13-14`：「它有完整的身分（名字、順序、**錨定的 change**）與畫面」）。同一句話在
      `session-persistence` 的 delta 裡**已經**改成「（名字、順序）」—— 而 delta 不承載 Purpose，
      不改的話 archive 之後 `terminal-sessions` 的 Purpose 會單獨留著一個已被移除的關係，且與
      `session-persistence` 的 requirement 直接對立
- [x] 8.3 `npm run test:all`（封存前的完整回歸，探針跑在虛擬螢幕上）—— **8/9**：
      native／core／identity／shell／workspace／files／keyboard／openspec 全通過；
      `probe:terminal` 199 ✓ / 1 ✗，而那一條是 **issue #8 的既有偶發**（「持久化檔案損毀時
      應用程式照常啟動」，症狀字串與模式 build 紅／dev 綠皆完全一致 —— `quitGracefully` 送出
      訊號就返回，損毀內容被前一個 app 實例的最後一次 save 覆蓋）。**與本 change 無關，但仍
      單獨重跑該段落確認**，不以「看起來像既有的」結案 —— `PROBE_ONLY=runRestore` 兩個模式
      全綠（該條顯示 `分頁=0 隔離檔=sessions.json.corrupt-…`，正是它該有的樣子）。
      （`test:all` 那一輪 `probe:terminal` 另有一次 CDP 連線失敗，單獨重跑即正常。）
- [x] 8.4 dogfood：**在一個沒有 session 的 repo 上**切換側欄來源與工作目錄（那正是本 change 的
      痛點），並確認關掉 app 再開後座標還原 —— 使用者於 dev 模式初步測試通過
- [x] 8.5 更新 `CLAUDE.md`：本 change 的段落、與 issue #5 的關係，以及實測踩雷 —— 尤其
      「`terminal-sessions` 與 `session-persistence` 對錨定持久化的既有矛盾」、「一個唯讀的
      fallback 會長成一道 gate」、「per-folder 使 probe 段落互相污染」三條
- [x] 8.6 於 issue #5 補一則 comment：per-folder 之後鍵是「rail 項目識別碼」，#5 是擴充鍵空間而非
      重做；並記下本 change 順帶回答的那半 —— **rail 選中 worktree ＝ 設定工作目錄維度，不是 repo
      維度**（OpenSpec 維持聚合、Files 以該 worktree 為根）
