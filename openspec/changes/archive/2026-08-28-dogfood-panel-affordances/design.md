## Context

見 `proposal.md` 的「Why」。此處只記與作法有關的現狀，**每一條都經實測或讀碼確認**：

- **活動列今日是 `<Panel defaultSize="56px" minSize="48px" maxSize="120px">`**，與 rail 之間隔著
  一條 `Separator`。react-resizable-panels v4 的 `groupResizeBehavior` 預設為
  `preserve-relative-size`（`react-resizable-panels.d.ts`），沒有任何 panel 宣告
  `preserve-pixel-size` 時，group 尺寸改變後原樣回傳百分比版面，隨後才以**當下寬度重新換算**的
  min/max 夾制。⇒ 成長是**有上限**的（`120px` 要到 group 寬約 2730px 才觸頂），但 56px → 120px
  已經是兩倍多。
- **`MainStage` 與 `StatusBar` 各自解析一次錨定**。`StatusBar.tsx:70` 是
  `(focused ? coordinate.anchoredChange : null) ?? soleActive`，其上方的註解明寫「解析方式與側欄
  一致」—— 那句話今日成立，只在一處加驗證就會讓它變成假的。
- **兩處的解析都沒有任何驗證**：slug 直接送去 `getChange`，主行程 `#findChange` 查表失敗就拋
  `unknown change slug: <slug>`，`ChangeView` 把該訊息原樣畫出來。
- **主行程與 renderer 的查表定義域相同**：`getChanges` 回的 `active`/`archived` 與 `#findChange`
  查的 `[...activeChanges, ...archivedChanges]` 是同一份掃描結果，`#summary` 不動 `slug`。
  ⇒ 「renderer 認為有效、主行程說沒有」表達不出來。worktree 聚合下 `ChangeInfo.slug` 亦為乾淨的
  slug（複合識別碼只活在 Graph 的節點 id 上）。
- **`panel.json` 的錨定跨重啟存活，而 slug 不是穩定識別碼** —— `openspec archive` 會把
  `add-list-unsubscribe-header` 改名為 `2026-08-03-add-list-unsubscribe-header`。實測使用者的
  `panel.json`：14 筆座標中多筆的 slug 已不存在於對應 repo。
- **`Emulation.setDeviceMetricsOverride` 在本 repo 已有實測前例**：`probe-workspace.mjs:1469` 一帶
  （狀態列的窄視窗驗收）與 `probe-keyboard.mjs` 的 5 處。該處註解記著
  `Browser.setWindowBounds` 在 Electron **無效且不報錯**（量到 1280 → 1280），故一律用前者。
- **`probe-workspace` 沒有段落隔離**（`scripts/lib/sections.mjs` 只有 terminal / keyboard /
  openspec 三支使用）—— 該支探針裡任何一次未捕捉的 throw 會帶走其後**全部**的斷言。
- **探針以字典取字串作為選擇器**，而 `scripts/lib/copy.mjs` 的 `raw()` 對缺鍵**直接拋錯** ——
  移除字典 key 之後，仍在引用它的探針會明確失敗，不會靜默選不到元素。

## Goals / Non-Goals

**Goals:**

- 活動列的寬度成為一個**版面契約**（一個固定數字），而不是一個會隨視窗尺寸漂移的比例。
- 錨定的解析成為**唯讀**的一步：解析不出來就當作沒有錨定，不寫回、不報錯。
- **解析只有一份**：側欄與狀態列不可能對同一個問題給出兩個答案。
- 「有沒有 This change 視圖」的裁定在**啟動的載入窗口**中不會把使用者困在 Browse。

**Non-Goals:**

- **不動 rail 與主舞台的分界行為**（使用者裁決：這次只修活動列）。rail 同樣會隨視窗放大而等比
  變寬，那是已知且被接受的現狀。
- **不做「封存後錨定自動跟上」**（以 `<日期>-<slug>` 反查）。使用者裁決不做；本 change 只保證
  它不再呈現為錯誤。
- **不把主行程的 `unknown change slug: <slug>` 訊息搬進字典。** 正常路徑不再抵達它，競態下
  仍會顯示 —— 既有缺口，見 proposal 的 Impact。

## Decisions

### D1 活動列**移出 `Group`**，而不是把它的 `Panel` 夾成 min=max

版面改為：一個橫向 flex 容器，內含固定寬度的活動列與一個 `Group`（rail │ 分界 │ 主舞台）。

**為什麼不用 min=max 的 `Panel`**：它仍然渲染一條 `Separator`（一個調不出差異的控制項，規格
明文禁止），仍然參與百分比換算與夾制（`Panel` 的尺寸約束在該套件中是「盡力而為」，文件對
`groupResizeBehavior` 就寫著「min/max 可能影響此行為」）。**移出去之後，「活動列被拖動」與
「活動列隨視窗長大」兩件事在結構上表達不出來** —— 這比用參數把它們夾住強。

**為什麼不用 `groupResizeBehavior="preserve-pixel-size"`**：它只解決「長大」，不解決「可拖動」，
而規格要的是後者。

**寬度取 52px**：內容恰為 `w-9`(36px) 的按鈕加上 `px-2`(2×8px)。此前的 `minSize="48px"` 比內容
還窄，是一個從未被兌現的下限。寬度寫在活動列容器上，讓「這一欄有多寬」只有一個來源。

**新外層 flex row 的高度是承重的**：現況是 `<div class="flex h-full w-full flex-col">` 內含
`<Group class="min-h-0 w-full flex-1">`。插進一層橫向 row 之後，該 row 需要 `min-h-0 flex-1`、
`Group` 需要 `min-w-0 flex-1` 且撐滿高度 —— `ActivityBar` 的 `<nav>` 是 `h-full`，它只在父層有
確定高度時才成立。CLAUDE.md 已記過同族的坑（`flex-1` 的區段在兄弟一長時直接變成零高度）。

### D2 錨定的解析抽成**純函式模組**，`MainStage` 與 `StatusBar` 共用

輸入是「座標中的明確錨定」與「該來源 repo 的 change 清單（可能為 `null` ＝ 尚未載入）」，輸出是
`string | null`：

1. 明確的錨定存在於 `active ∪ archived` ⇒ 用它。
2. 否則 `active` 恰有一個 ⇒ 用它（衍生預設，原本就有）。
3. 否則 ⇒ `null`。**清單為 `null`（尚未載入、或該 folder 沒有 `openspec/`）時亦為 `null`**。

**為什麼是模組而不是各自寫一次**：兩個消費者今日已經各自實作過一次同一條規則，而
`StatusBar.tsx` 的註解正是靠「兩邊碰巧一樣」在維持。一條規則兩份實作，下一次只會有一份被改到 ——
而那個分歧的徵狀是「側欄與狀態列各說各話」，型別檢查與探針都不會有一句話。

**順帶拿到單元測試**：這是兩個輸入的純函式，四個邊界情形（清單未載入、slug 落在 `archived`、
恰一個 active 的退路、多個 active 的讓位）在 `npm test` 裡是毫秒級的，不必押在十幾分鐘的探針上。
比照 `rail-rows.test.ts` / `continuation.test.ts` / `nav.test.ts` 的既有作法（純邏輯模組，
不引進 React 測試設施）。

**側欄的介面不變**（仍只有一個 `anchoredChange` prop）。多加一個「錨定失效了」的 prop 會誘使
側欄去呈現它 —— 而規格明文要求不呈現為錯誤。**能表達的東西越少，錯的方式越少。**

**清單尚未載入時回 `null`，不沿用未驗證的 slug。** 沿用的話，啟動當下就會先閃一次
`unknown change slug`，而那正是要修的東西。代價見 D3 與 R1。

**解析是唯讀的**：這條路上不呼叫任何 setter。落盤的座標只由使用者的動作改寫（規格：無法解析的
錨定 SHALL NOT 被自動清除）。

### D3 視圖的裁定用**純衍生**，不在渲染期間把 tab state 壓成 `browse`

`OpenSpecPanel` 內：`const activeTab = anchoredChange === null ? 'browse' : tab`，`tab` 這個
state 一個字都不改。

**替代方案「渲染期間 `setTab('browse')`」已被否決，而理由是承重的**：啟動時 change 清單尚未
載入 ⇒ `anchoredChange` 暫為 `null` ⇒ 壓成 `browse` ⇒ 清單到達後 `tab` 已經是 `browse`，
This change **不會自己回來**。於是「每次啟動都停在 Browse」——一個把暫態寫進持久狀態的經典。
純衍生沒有這個入口：暫態過去，畫面自己回到 `tab` 說的那個視圖。

副作用（可接受）：使用者停在 This change 時該 change 消失（被封存／worktree 移除），畫面轉為
Browse，而 `tab` 仍記著 `change` —— 之後切到一個有錨定的 repo 會直接回到 This change。那正是
「記住上次看的視圖」該有的行為。

視圖清單（`TABS`）與麵包屑（`Crumb`）一律吃 `activeTab`，不是 `tab`。**既有的跨身分導航
（`request` / `nonce` 的渲染期間 state 調整）不受影響**：它寫的是 `tab` 與 `openSpec`，而
`activeTab` 只是在最後一步遮蔽它 —— 目標是 `spec` 時本來就走 `browse`；目標是 `change` 時，
送出請求的那個 handler 會先完成錨定，於是 `anchoredChange` 非 `null`，遮蔽不生效。

### D4 `ChangeView` 的 `slug` 收窄為 `string`

空狀態分支與 `onGoToChanges` prop 一併移除，字典的 `openspec.noAnchoredChange`／
`openspec.goToChanges` 一併移除。

**收窄型別是這裡唯一的結構性保證**：`slug: string | null` 留著的話，日後有人把 `null` 傳回來
只會靜默地又長出一個空狀態（而它已無 UI 可去）。收窄之後那是編譯錯誤。

**注意 TypeScript 不會替你收窄**：`activeTab === 'change'` 不會讓編譯器知道 `anchoredChange`
非 `null`，渲染條件必須寫成 `activeTab === 'change' && anchoredChange !== null &&`。

### D5 探針：`probe-workspace` 的分界斷言由「3 個、以索引取用」改為「2 個」

- **6 個站點**（`108` 的 `MOUNTED` 閘、`479/480` 的計數、`482`、`488`、`494` 的**裸字串**、`503`）。
  `182` 的收集器不必改。**`108` 若漏改，`awaitMounted` 永遠不 settle，整支探針在啟動就死**；
  它離其餘五處三百多行遠，且形式不同（grep `separators[` 找不到它，`494` 同樣找不到）。
- 新增「視窗尺寸改變後活動列寬度不變」的載體：沿用 `probe-workspace.mjs:1469` 一帶的既有作法
  （`Emulation.setDeviceMetricsOverride` 放大 viewport → 量測 → `clearDeviceMetricsOverride`），
  **對照組沿用同一處的形式：`window.innerWidth` 的前後值必須真的改變**，自成一條斷言。
  不自己發明「rail 必須變寬」——同一支探針已經有一個被實測過的對照組形式。
- **`before` 必須在初始 viewport（1280）量。** 若在放大後的視窗量，活動列可能已被夾在
  `maxSize` 的 120px，「寬度不變」在**未修的程式碼上照樣全綠** —— 這個 repo 最常見的假綠形狀。
- **CDP 呼叫必須包 try/catch**（沿用既有寫法）：`probe-workspace` 沒有段落隔離，一次未捕捉的
  throw 會帶走其後全部斷言。前置斷言負責說話，不在 catch 裡吞掉事實。
- 「活動列不可拖動」那條的對照組**就在同一段**：`485` 的 `'拖動分界改變兩側寬度'` 已證明
  `dragMouse` 有效。要寫下來 ——「有載體」與「載體有鑑別力」是兩個動作。

### D6 探針：`probe-openspec` 的 `CHANGE_EMPTY_TEXT` 換成「This change 入口不呈現」

`CHANGE_EMPTY_TEXT` 有**5 個使用站點**（`1649`、`2035`、`2178`、`2359`、`2429`）。
**`2429` 沒有 `check`** —— 它是一道同步屏障（等空狀態出現，再去驗 per-folder 的來源）。
`pollUntil` 逾時不 throw，只印一行警告後回傳最後一次取樣 ⇒ 漏改它不會紅，只會**燒掉 10 秒、
屏障消失**，其後四條斷言開始 flaky。字典 key 另有 7 處引用（`475` 的定義、`1650`、`1656`、
`2039`、`2045`、`2182`、`2363`），移除 key 後它們會明確拋錯 —— 那一組是安全的。

**另有一條既有斷言會變成啟動競態**：`1485` 的
`pollUntil(VIEW_TABS, (list) => list.length > 0)` 在**只有 Browse 一個 tab 的那一刻就 settle**，
而 D2 規定清單未載入時解析為 `null` ⇒ 那一刻 This change 的入口確實不在。settle 條件要改成
「等到兩個 tab」。**它的名字逐字就是那條 MODIFIED requirement 的標題，是該條的主載體。**

兩條新 scenario 的載體：

- **封存改名後不報錯**：以 `seedProfile` 種一份 `panel.json`，錨定一個 fixture 中不存在的 slug。
  **種在 `repo-single`**（恰一個 active change）—— 它兩個半邊都有鑑別力：解析失敗要退到那唯一的
  active change。種在只有 archived 的 repo 則無法區分「入口不呈現」與「根本沒讀到那份
  `panel.json`」。錯誤訊息的偵測以字面的 `unknown change slug:` 比對（`ErrorNote` 沒有 `role`
  也沒有 `aria-label`，沒有別的抓手；該字串刻意不在字典裡，見 proposal 的 Impact）。
- **不自動清除落盤**：同上種子，切走再切回後**讀回 `panel.json`**，斷言那筆錨定還在。
  **這條是回歸護欄，不是本 change 的證明** —— 今日的程式碼也沒有任何地方會清它。它的對照組因此
  更重要：同段落內做一次真實的座標改動並確認檔案跟著變。而且要給程式**寫檔的窗口**：
  `panel-coordinate.tsx` 的落盤 effect 在 restore 那次 `setCoordinates` 就會觸發一次，一個
  「遇到不可解析就清掉」的實作會在一兩個 frame 內改檔 —— 讀太早的話「還在」只是因為它還沒寫。

### D7 「資料未到達時呈現載入狀態」不牴觸，但要明寫

`openspec-panel` 主 spec 有一條：資料尚未送達時 SHALL 呈現載入狀態，**SHALL NOT 呈現空白或
空狀態**。D2 的載入窗口落在它的管轄範圍內。

**判定為不牴觸**：該窗口內使用者拿到的是**瀏覽視圖**（它自己有載入狀態），不是空白也不是空狀態。
明寫這個判斷，是因為 D6 已經證明那個窗口是**真的會被觀察到**的（`1485` 那條既有斷言就在它裡面）
—— 下一個人不該以為沒人想過。

## Risks / Trade-offs

- **[R1] 啟動時 This change 的入口會晚一步出現**（要等 change 清單載入）→ 那個窗口就是側欄本來
  就在載入的窗口；純衍生（D3）保證清單到達後它自己回來。**已知它會打到 `probe-openspec:1485`**，
  由 D6 一併修正。不以「沿用未驗證的 slug」換取它。
- **[R2] 一次索引位移（D5）漏改一處** → `108` 漏改是**大聲**失敗（`awaitMounted` 逾時），其餘
  漏改則可能改去驗另一條分界。改完必須整支跑 `probe:workspace` —— 該支**沒有段落隔離**，本來
  就只能整支跑。
- **[R3] 抽出共用解析模組時，兩個消費者的既有行為有細微差異** → `StatusBar` 多一層
  `focused &&`（沒有 focused session 時整條脈絡為空狀態，`status-bar` 的既有 requirement）。
  那一層屬於**呼叫端**，不進解析模組；模組只回答「這個座標＋這份清單解析出什麼」。
- **[R4] 活動列改為 52px 後若日後加入更大的圖示會裁切** → 寬度與按鈕尺寸都寫在同一個元件裡，
  且 `probe:workspace` 會量到它；這是可接受的耦合（版面契約本來就該是一個明確的數字）。
- **[R5] 使用者的既有 `panel.json` 中那些失效的錨定會一直留著** → 這是刻意的（規格）。它們不
  影響呈現，且隨時可能因 worktree 掛回而再度有效；使用者下一次錨定就會覆蓋它。
