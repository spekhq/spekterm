## 1. 實作

- [x] 1.1 `AppShell.tsx`：活動列移出 `Group`，改為固定寬度的容器（外層橫向 flex：活動列 ＋
      `Group`(rail │ 分界 │ 主舞台)），移除活動列與 rail 之間的 `Separator`。
      **新的橫向 row 需 `min-h-0 flex-1`、`Group` 需 `min-w-0 flex-1` 且撐滿高度**
      （`ActivityBar` 的 `<nav>` 是 `h-full`，父層沒有確定高度時它會塌）。
- [x] 1.2 `ActivityBar.tsx`：`<nav>` 上明寫固定寬度 52px（`w-9` 按鈕 ＋ `px-2`）與 `shrink-0`。
- [x] 1.3 `PanelSourceBar.tsx`：下拉候選改為依 `folder.name` 的 `localeCompare`（不分大小寫）
      排序。**排 `items`（`folders.map` 產生的新陣列），不得就地排序 `folders`** —— 那是 rail
      的清單。
- [x] 1.4 **新增純函式模組**：錨定的解析（design D2）。輸入＝明確錨定 ＋ change 清單
      （`null` ＝ 尚未載入）；輸出＝`string | null`。規則：明確錨定 ∈ `active ∪ archived` →
      `active` 恰一個 → `null`。
- [x] 1.5 該模組的單元測試（`npm test`）：四個邊界情形 —— 清單為 `null`、slug 落在 `archived`、
      明確錨定失效而恰有一個 active（退到衍生預設）、明確錨定失效且多個 active（回 `null`）。
- [x] 1.6 `MainStage.tsx`：改用 1.4 的模組推導 `anchoredChange`。解析路徑上不呼叫任何 setter。
- [x] 1.7 `StatusBar.tsx`：改用同一個模組（保留呼叫端既有的 `focused &&` 那一層 —— 它屬於
      `status-bar` 的既有 requirement，不進解析模組）。同時修正 `:56` 那段宣稱「解析方式與側欄
      一致」的註解，讓它指向共用模組。
- [x] 1.8 `OpenSpecPanel.tsx`：視圖清單依 `anchoredChange` 決定（`null` 時只有 Browse）；
      `const activeTab = anchoredChange === null ? 'browse' : tab`，**不改 `tab` state**；
      `TABS` 的渲染與 `Crumb` 一律吃 `activeTab`。渲染 `ChangeView` 的條件要寫成
      `activeTab === 'change' && anchoredChange !== null &&`（TypeScript 不會替你收窄）。
- [x] 1.9 `ChangeView.tsx`：`slug` 型別收窄為 `string`，移除 `slug === null` 的空狀態分支與
      `onGoToChanges` prop（連同 `OpenSpecPanel` 傳入的那個 callback）。
- [x] 1.10 `src/shared/i18n/en.json`：移除 `openspec.noAnchoredChange` 與 `openspec.goToChanges`。

## 2. 驗收載體

- [x] 2.1 `probe-workspace.mjs` 分界計數與索引，**共 6 處**：
      `108`（`MOUNTED` 閘裡的 `=== 3`，**漏改會讓 `awaitMounted` 永遠不 settle**）、
      `479/480`（`length === 3` 與其 detail 字串）、`482`、`488`、
      `494`（**裸字串** `querySelectorAll(...)[1]`，grep `separators[` 找不到它）、`503`。
      `182` 的收集器不必改。`479` 那條的**名字**（「三處分界…」）也要改。
      **不必改、別順手動**：`scripts/cdp.test.mjs:530` 的 `separators: 'x === 3'` 是
      `mountedExpression` 的樣本字串；`probe-terminal.mjs:740` 的 `SEPARATOR_RECT` 限定在
      `main[aria-label=…]` 之內，是作用域選取、不吃索引。
- [x] 2.2 `probe-workspace.mjs` 新增「視窗尺寸改變後活動列寬度不變」：沿用 `1469` 一帶的既有
      作法（`Emulation.setDeviceMetricsOverride` → 量測 → `clearDeviceMetricsOverride`，CDP 呼叫
      包 try/catch，**該支探針沒有段落隔離**）。**對照組沿用同一處的形式：`window.innerWidth`
      前後值必須真的改變，自成一條前置斷言。** **`before` 必須在初始 viewport（1280）量** ——
      在放大後的視窗量會落在 `maxSize` 的 120px 上，未修的程式碼照樣全綠。
- [x] 2.3 `probe-workspace.mjs` 新增「活動列的寬度不可由使用者調整」：於活動列右緣送一次真拖曳，
      斷言寬度不變。**對照組寫下來**：同段 `485` 的 `'拖動分界改變兩側寬度'` 已證明 `dragMouse`
      有效（少了這句，「拖曳根本沒打中任何東西」也會通過）。
- [x] 2.4 `probe-openspec.mjs`：`CHANGE_EMPTY_TEXT` 改為 `CHANGE_VIEW_ABSENT`（視圖 tablist 中
      只有 Browse），**5 個使用站點全部換掉**：`1649`、`2035`、`2178`、`2359`、
      **`2429`（沒有 `check`，是一道同步屏障 —— 漏改不會紅，只會靜默燒掉 10 秒並讓其後四條
      斷言失去同步）**。
- [x] 2.5 `probe-openspec.mjs`：字典 key 的 7 處引用一併處理（`475` 的定義、`1650`、`1656`、
      `2039`、`2045`、`2182`、`2363`）。移除 key 後 `copy()` 會拋錯，這一組不會靜默漏掉。
- [x] 2.6 `probe-openspec.mjs:1485`：settle 條件由 `(list) => list.length > 0` 改為「等到兩個
      tab」。**啟動時只有 Browse 的窗口是規格的一部分（D2）**，舊條件會在那一刻 settle，
      使 `1488` 的斷言紅。
- [x] 2.7 `probe-openspec.mjs` 新增「錨定的 change 不存在於來源 repo 時不呈現錯誤」：以
      `seedProfile` 種一份 `panel.json`，錨定一個不存在的 slug，**種在 `repo-single`**
      （恰一個 active change ⇒ 必須退到 `solo-change`，兩個半邊都有鑑別力）。錯誤的偵測以字面
      `unknown change slug:` 比對（`ErrorNote` 沒有 `role`／`aria-label`）。
- [x] 2.8 同段落新增 `status-bar` 的兩條：狀態列不含那個不存在的 slug；且狀態列呈現的 change
      與側欄呈現的相同（`STATUS_BAR_TEXT` 已存在於 `probe-openspec.mjs:945`）。
- [x] 2.9 `probe-openspec.mjs` 新增「無法解析的錨定不被自落盤內容清除」：切走再切回後讀回
      `panel.json`。**兩個對照組**：(a) 同段落做一次真實的座標改動並確認檔案跟著變；(b) 讀檔前
      要給程式**寫檔的窗口**（restore 那次 `setCoordinates` 就會觸發落盤 effect，讀太早的話
      「還在」只是因為它還沒寫）。**這條是回歸護欄，修改前也是綠的 —— 對照組是它唯一的價值來源。**
- [x] 2.10 下拉排序的兩條 scenario 放在 **`probe-openspec.mjs`**（`PANEL_SOURCE_RECT` 與
      `MENU_ITEM_RECT` 都在那裡）。fixture 不必改：既有 rail 順序是 `repo-many, repo-single,
      repo-archived-only, repo-derived, repo-plain, repo-worktree, wt-inside`，字母序與它不同。
- [x] 2.11 **逐條核對下表**（不得憑印象填「既有」—— 要真的把那條斷言找出來；找不到就補載體或
      明寫「無載體 ＋ 理由」）。

| scenario | 載體（**行號經逐條 grep 核對**，非憑印象） |
|---|---|
| `workspace-layout` 拖動分界改變兩側寬度 | 既有：`probe-workspace:494` `'拖動分界改變兩側寬度'` |
| `workspace-layout` 拖動不得使區域寬度歸零 | 既有：`probe-workspace:499` `'拖過最小寬度時被夾制而不歸零'` |
| `workspace-layout` 分界可由鍵盤操作 | 既有：`probe-workspace:505` `'分界可取得鍵盤焦點'` ＋ `:508` `'方向鍵可調整寬度'` |
| `workspace-layout` 活動列與 rail 之間不存在分界 | **改**：`probe-workspace:487` `'兩處分界皆存在且具 separator 角色（活動列與 rail 之間沒有）'` |
| `workspace-layout` 視窗尺寸改變後活動列寬度不變 | **新**：`probe-workspace:584`，前置兩條 `:573`（viewport 變寬）與 `:580`（版面確實重算 —— rail 隨之變寬） |
| `workspace-layout` 活動列的寬度不可由使用者調整 | **新**：`probe-workspace:601`；對照組為同段的 `:494`（證明 `dragMouse` 有效） |
| `side-panel-source` 下拉的候選為字母序 | **新**：`probe-openspec:1673`；對照組 `:1680`（rail 的順序本來就不是字母序） |
| `side-panel-source` 下拉的排序不影響 rail | **新**：`probe-openspec:1700` |
| `side-panel-source` 切換側欄來源後本 change 重置 | 既有＋改：`probe-openspec:2509` `'切換側欄來源後錨定被重置（repo-many 無自動錨定 → 本 change 入口不呈現）'` |
| `status-bar` 錨定的 change 已不存在時不呈現該欄位 | **新**：`probe-openspec:1540`；前置 `:1536`（狀態列已有 repo-many 的 session 脈絡 —— 少了它會綠在「整條列都是空的」） |
| `status-bar` 側欄與狀態列呈現同一個答案 | **新**：`probe-openspec:1523` |
| `openspec-panel` 呈現本 change 與瀏覽兩個視圖 | 既有：`probe-openspec:1609` ＋ `:1617` `'預設視圖為「本 change」'`（settle 條件已改為「等到兩個 tab」） |
| `openspec-panel` 切換至瀏覽視圖 | 既有：`probe-openspec:1975` `'可切換至瀏覽視圖'` |
| `openspec-panel` 一次只顯示一個視圖 | 既有：`probe-openspec:1977` `'一次只顯示一個視圖'` |
| `openspec-panel` 沒有可解析的 change 時不呈現本 change 的入口 | **改**：`probe-openspec:2183` `'多個 active change 時不自動錨定，本 change 的入口不呈現'`、`:2328` `'沒有 active change 時無錨定，本 change 的入口不呈現'`、`:2337`／`:2345`（兩棵樹仍可用） |
| `openspec-panel` 錨定之後本 change 的入口出現 | **新**：`probe-openspec:2222`（緊接同一個 repo 上「入口不呈現」那條之後）＋ 既有 `:2217` |
| `openspec-panel` 切換 rail 項目後本 change 視圖跟隨 | 既有：`probe-openspec:2268` ＋ `:2273` |
| `openspec-panel` 尚未建立 session 時仍呈現唯一的 active change | 既有：`probe-openspec:1719` ＋ `:1756` |
| `openspec-panel` 側欄來源指向另一個 repo 時呈現該 repo 的 change | 既有：`probe-openspec:2528` |
| `openspec-panel` 衍生預設隨 active change 數量重新解析 | 既有＋改：`probe-openspec:1800` `'active 由 1 變 2 後衍生預設讓位，本 change 的入口不再呈現'` |
| `openspec-panel` 明確的錨定不受 active change 數量影響 | 既有：`probe-openspec:1818` |
| `openspec-panel` 錨定的 change 不存在於來源 repo 時不呈現錯誤 | **新**：`probe-openspec:1494`（入口不呈現）＋ `:1502`（不含 `unknown change slug`）＋ `:1509`（另一條退路：退到衍生預設） |
| `openspec-panel` 無法解析的錨定不被自落盤內容清除 | **新**：`probe-openspec:1565`；對照組 `:1562`（同一份檔案裡使用者的錨定確實被寫進去） |
| （REMOVED）無錨定時呈現空狀態的兩條 | 載體已刪除：原 `2039`／`2045` 兩條 check 移除，字典 key 的 7 處引用一併清空（`grep noAnchoredChange scripts/` 為空） |

**對照組實測紀錄**（把修正退回，確認斷言真的變紅）：

- 解析模組：拿掉查表 ⇒ `anchor.test.ts` 8 條中 2 條紅。
- 側欄與狀態列：同一個退回 ⇒ `probe-openspec` 的 `runPanelRestoreDegradation` 18 條中 4 條紅
  （含狀態列印出 `2026-05-01-add-oauth`）。
- 活動列：把固定寬度換成相對寬度（`w-[4%]`）⇒ `'視窗放大後活動列寬度不變'` 紅（51px → 88px）。

## 3. 文件

- [x] 3.1 `docs/PRD.md:191`：`分界（活動列｜rail、rail｜主舞台、terminal｜side panel）皆可拖動`
      改為只列後兩處。**理由寫「一列固定尺寸的圖示按鈕，拖動它調不出任何差異」，不要寫「與雛型
      不符」** —— 雛型的 rail 同樣是 `flex: 0 0 210px` 且沒有 resizer，那個理由會一路推到 rail
      上，而使用者已裁決這次不動 rail。
- [x] 3.2 `CLAUDE.md`「字級、版面與 React」新增一條版面陷阱：**react-resizable-panels 的 px
      尺寸是掛載時換算成容器百分比的**（`groupResizeBehavior` 預設 `preserve-relative-size`），
      視窗放大後每個 panel 等比長大（受 `maxSize` 夾制而有上限）—— 固定寬度的區域不該是 `Panel`。

## 4. 收尾

- [x] 4.1 `npm run typecheck` 與 `npm run lint`
- [x] 4.2 `npm test`（含新的解析模組測試與 `copy-language` / `aria-label-source` /
      `i18n-key-safety` 三道守衛）
- [x] 4.3 `npm run probe:workspace` 與 `npm run probe:openspec` 全段落通過
      （`probe:workspace` 沒有段落隔離，只能整支跑）
- [x] 4.4 使用者實機操作確認三個現象都消失
