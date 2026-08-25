## 1. 主行程：資料模型與不變式

- [x] 1.1 `PersistedFolder` 新增 `pinned?: boolean`；`parseWorkspace` 對它做型別驗證（缺少 ⇒ 視為
      未置頂；存在但非 boolean ⇒ 比照其他欄位判定為不可信任）
- [x] 1.2 `WorkspaceStore.load()` 以**穩定分割**正規化「置頂者佔前綴」的不變式（順序不符 ⇒ 正規化，
      **不**判定為損毀、**不**隔離設定檔）
- [x] 1.3 新增私有 `place(id, folderIndex, pinned)` 作為**唯一**會改變位置或置頂旗標的地方；
      `reorder(id, toIndex, pinned)` 的 `pinned` 為**必填**（不設「省略即維持現狀」的預設）；
      新增 `setPinned(id, pinned)`（落點：置頂 → 前綴末端、取消 → 後綴首端）
- [x] 1.4 **改掉 `WorkspaceStore.reorder` 的早退條件**：現況是 `if (Number.isNaN(to) || to === from) return`，
      而跨界的移動其 `to === from`（序位前後同值、只有置頂狀態改變）⇒ **旗標不寫入、`save()`
      不發生**。改為「位置與置頂狀態**皆**未改變才早退」
- [x] 1.5 確認 `add`（附加於末端 ⇒ 未置頂）與 `remove` 在新不變式下**一行都不必改**；若需要改，
      表示 1.3 的不變式沒有集中在 `place()`

## 2. 主行程：單元測試與對照組

- [x] 2.1 `workspace-store.test.ts` 補：前綴不變式、載入正規化、`pinned` 型別不符的處置、
      `setPinned` 的兩個落點、`reorder` 跨界改變旗標、`remove` 後不變式仍成立
- [x] 2.2 `workspace-store.test.ts` 補**「只改置頂狀態的重排仍落盤」** —— 以 `to === from` 但
      `pinned` 相反的參數呼叫，斷言旗標改變**且檔案被寫出**（1.4 的載體）
- [x] 2.3 「舊設定檔全數載入」的斷言要落在**folder 數量與未被隔離**上，**不要**落在「皆為未置頂」
      —— 後者就是預設值，任何實作都會通過
- [x] 2.4 **對照組**：逐一把 1.2／1.3／1.4 退回，確認 2.1–2.3 對應的測試**真的變紅**。
      「載入正規化」那條的 fixture 必須本來就違反不變式，否則它對任何實作都綠

## 3. IPC 與 renderer 的資料流

- [x] 3.1 `src/main/ipc/folders.ts` 新增 `workspace:folders:setPinned` 頻道，`reorder` 的處理器接第三個參數
- [x] 3.2 `src/preload/index.ts` 與 `index.d.ts` 的白名單同步
- [x] 3.3 `useWorkspaceFolders`：新增 `setPinned`、`reorderFolders` 帶上 `pinned`；兩者都比照既有
      的「先樂觀套用、再以主行程回覆對帳」
- [x] 3.4 **改掉樂觀更新的早退條件**：`useWorkspaceFolders` 內 `if (to === from) return current`
      是 1.4 那道閘門的**第二份**，同樣會吞掉跨界的移動。改為「位置與置頂狀態皆未改變才早退」
      （`WorkspaceFolder` 的型別不必手寫 —— 它自 `Awaited<ReturnType<…list>>` 推導，`pinned`
      會自動流過來）

## 4. rail 的分段呈現

- [x] 4.1 `<aside>` 底下改為兩個並列的 `<ul>`：置頂段與其餘段（`flex-1 min-h-0 overflow-y-auto`，
      即今日那個捲動容器）
- [x] 4.2 置頂段給 `min-h-0 overflow-y-auto` —— 它在極端高度下自己內部捲動，內容不會變成不可達
- [x] 4.3 **`<h2>` 與底部的加入入口加 `shrink-0`**。實測：它們同為 flex item、收縮因子 1，而
      `<h2>` 帶 `truncate`（`overflow: hidden`）⇒ 自動最小尺寸 0 ⇒ **從 35px 被壓到 22px，
      標題文字被裁掉**
- [x] 4.4 **其餘段給最小高度**（約三到四列）。其餘段是 `flex: 1 1 0%`，拿不到剩餘空間就是
      `clientHeight: 0` —— **一個 repo 都沒置頂時，光是全域項目展開十來個 session 就到得了**
- [x] 4.5 兩個 `<ul>` 各自帶 `aria-label`（自 `en.json` 取得）—— 驗收要據此指名捲動容器，
      不得再以 `aside > ul` 的位置取得
- [x] 4.6 **分隔線移到兩個 `<ul>` 之間，當它們的 sibling**（不放在置頂段之內 —— 那會使它在置頂段
      內部捲動時第一個離開視野，而 spec 要求它恆常可見）。它仍需一個 ref 供 `rectOf` 取得
- [x] 4.7 決定 `rail.empty` 那一列的歸屬（其餘段），並確認它不含 `div[role="button"]`
      —— `probe-keyboard` 的 `checkEmptyWorkspace` 依賴 `RAIL_ITEMS.length === 1`

## 5. pin 的兩個入口

- [x] 5.1 folder 標題列新增圖釘按鈕：**置頂時恆常呈現、未置頂時只在 hover 呈現**。
      **不可直接沿用 `ICON_BUTTON_CLASS`** —— 它含 `opacity-0` 與 `cursor-pointer`
- [x] 5.2 全域項目的圖釘為 `disabled` + `aria-disabled` + 置灰 + 游標非 `pointer` + 說明其恆置頂的
      tooltip；該列**不**提供右鍵選單
- [x] 5.3 folder 標題列新增右鍵選單（Pin to top／Unpin、Remove…），沿用共用的 `ContextMenu`
- [x] 5.4 `en.json` 新增文案。**具體約束**：(a) 不得含單引號、雙引號、反引號 —— 停用圖釘的
      tooltip 最自然的英文寫法會帶所有格撇號，而那個字元曾讓整個 `evaluate` 靜默 throw；
      (b) 兩個 `<ul>` 的 `aria-label` **不得以 `Sessions in ` 開頭**（`probe-terminal` 有四處
      `ul[aria-label^="Sessions in "]`）；(c) 不得與 `en.json` 既有標籤同值
- [x] 5.5 停用圖釘的 `title` 也要進字典 —— `aria-label-source.test.mjs` **不檢查 `title`**，
      硬編一句英文不會有任何守衛擋下

## 6. 跨界的移動

- [x] 6.1 folder 拖曳改為在**含分隔線的列空間**上進行：`useDragReorder(folders.length + 1, …)`。
      `useDragReorder` 這個**檔案**不改（`commitIndex` 是模組私有的，**不要為此 export 它** ——
      `onCommit` 交來的 `toIndex` 就是列空間的 `toRow`）
- [x] 6.2 **`rectOf` 回傳「該列 rect 與其所屬容器可視區的交集」，完全被裁掉時回 `null`**。
      兩個獨立裁切的容器使 DOM 順序不再等於螢幕順序：置頂段一內部捲動，被裁掉的置頂列其 rect
      會落在其餘段**下方**，於是游標停在看得見的未置頂列上卻命中看不見的置頂列 ⇒
      **把使用者沒碰過的 repo 置頂到任意位置**
- [x] 6.3 提交時把落點翻譯成 `(folderIndex, pinned)`（design D3 的算式）。**把它抽成純函式**放在
      可單元測試的位置
- [x] 6.4 **列空間要貫徹到底**：`onMouseDown(index)`、`isDropTarget(index)`、
      `dragged={drag?.fromIndex === index}` 全部改傳列索引；`dropAtEnd` 的條件改為「列空間的
      最後一列」（全部置頂時那是**分隔線**）。漏掉第一項的後果：`S = 0` 時拖曳 folder 0 到自己
      下半部會畫出幽靈指示線並送出一次被 store 吞掉的提交，而既有探針只驗「順序不變」⇒ 假綠
- [x] 6.5 兩條插入指示線要彼此可辨、且可與分隔線本身區別（兩個落點相距不到 10px，其中一條畫在
      既有的 hairline 上）
- [x] 6.6 `KeyboardNavigation` 的 `Shift+↑↓` 同樣走列空間，跨界時一併送出新的 `pinned`；
      「選中全域項目時為無操作」不變；**「只有一個 folder 時為無操作」收窄為「該次移動不跨界時」**

## 7. 單元測試：列空間的換算

- [x] 7.1 為 6.3 的純函式寫單元測試，涵蓋：`S = 0`、`S = N`、跨界往上、跨界往下、
      **只改置頂不改序位**、拖到末端、拖到自己原位、`N = 1` 兩個方向
- [x] 7.2 涵蓋 **≥2 置頂且 ≥2 未置頂**、往下拖、段內與跨段各一次 —— `workspace-layout` 已明訂
      「驗收拖曳排序必須用至少三個項目且往下拖」，置頂版的對應條件是這個
- [x] 7.3 **對照組**：把換算式改成「不管分界、直接用 folder 索引」，確認 7.1／7.2 變紅

## 8. 驗收：既有探針的必要修正

- [x] 8.1 `probe-keyboard.mjs` 中 5 處以 `aside > ul` 取得捲動容器的程式碼，改為以 4.5 的
      `aria-label` 指名其餘段（`RAIL_SCROLLER`／`SELECTED_FULLY_VISIBLE`／`FORCE_RAIL_BOTTOM`／
      `CUT_A_RAIL_ROW`／`RAIL_UL`）
- [x] 8.2 **`SELECTED_FULLY_VISIBLE`／`SELECTED_HEADER`／`FOCUSED_ROW` 還要修列與容器的配對**：
      它們以 `aria-current` 跨**兩個** `<ul>` 找列，卻拿**一個**容器的 rect 去量。選中的是置頂
      repo（或恆為置頂的全域項目）時，必然量出「不可見」⇒ **對正確的實作亮紅燈**
- [x] 8.3 重新量測既有的 `overflows`／`hidden` 前置 —— 捲動容器剛失去全域項目與它展開的子列，
      原本的視窗壓縮量未必還夠。**印出實際的 `scrollHeight/clientHeight` 再決定**，不要沿用
- [x] 8.4 `probe-keyboard.mjs:1852` 那條「`Ctrl+↑` 確實把容器捲了回去」：若按鍵序列會落在全域
      項目或置頂 repo 上，依新規則**不得捲動** ⇒ 該斷言會反轉。確認落點或改寫
- [x] 8.5 **對照組**：先只做 4.1 而不做 8.1，分別確認**兩種**徵狀 ——「大聲失敗」的那半
      （`scrollHeight > clientHeight + 10` 的前置 check）與「安靜變綠」的那半（SHALL NOT 捲動
      的斷言）。只看到紅燈就收工會漏掉安靜的一半
- [x] 8.6 確認 `FOLDER_LIS` 與各 `aside > ul > li …` 選擇器在兩個 `<ul>` 之下仍以顯示順序命中

## 9. 驗收：新增的斷言（每一條對應下表的一列）

- [x] 9.1 `probe-workspace.mjs`：以**圖釘按鈕**置頂／取消置頂、落點為跨界最小移動、重啟後仍為置頂
- [x] 9.2 `probe-workspace.mjs`：以**右鍵選單**置頂／取消置頂（**與 9.1 不共用斷言**）、
      選單可完全以鍵盤操作（焦點落第一項／方向鍵循環／`Enter` 觸發）、於標題列按右鍵不啟動拖曳
- [x] 9.3 `probe-workspace.mjs`：置頂列**未 hover 時仍呈現**圖釘、未置頂列**未 hover 時不呈現**
- [x] 9.4 `probe-workspace.mjs`：全域項目呈現**停用**的圖釘（`:disabled` 命中、`.focus()` 後
      `activeElement` 仍為 body、`.click()` 無效果）、不提供右鍵選單、持久化設定中無其置頂欄位。
      **不得以 `tabIndex` 判定停用**（disabled 按鈕的 `tabIndex` 仍回報 0），**也不得用
      `dispatchEvent(new MouseEvent('click'))`**（它**會**觸發 listener）—— 用 `.click()` 或
      真實的 CDP 滑鼠事件
- [x] 9.5 `probe-workspace.mjs`：分隔線位置 —— 有置頂 folder 時劃在置頂段之後、無置頂 folder 時
      緊接於全域項目之後（後者是**既有行為的回歸守衛**）
- [x] 9.6 `probe-workspace.mjs`：跨界拖曳兩個方向（含「置頂段最後一個拖到分界之下」這個
      **序位不變**的案例，斷言它**不被當作無操作**）、跨界拖曳後**重啟仍保持**
- [x] 9.7 `probe-workspace.mjs`：分界不使 folder 的拖曳落點偏移（2 置頂 + 3 未置頂，往下拖）
- [x] 9.8 `probe-workspace.mjs`：**插入指示線**的存在與位置 —— 分界兩側各一次，以及「拖到自己
      原本的位置時不呈現指示線」。**全 repo 目前沒有任何探針在驗指示線**（`grep border-t-accent
      scripts/*.mjs` 零命中），而本 change 讓它變成承重的
- [x] 9.9 `probe-keyboard.mjs`：`Shift+↓`／`Shift+↑` 跨界改變置頂狀態並持久化；端點不循環時
      **一併斷言置頂狀態未變**；只有一個 folder 時「不跨界為無操作」與「跨界仍生效」各一條
- [x] 9.10 `probe-keyboard.mjs`：置頂段在其餘段捲到底之後仍完整可見（含其 session 子列），
      **且同一時刻斷言最前面的未置頂 folder 已不在視野內** —— 後者才是這條的鑑別力來源
- [x] 9.11 `probe-keyboard.mjs`：遮擋以**幾何關係**斷言（緊接分界之下那個 repo 的標題列上緣不低於
      分界的下緣）；另補「切換至置頂 repo 時其餘段捲動位置不變」與「切換至全域項目時其餘段捲動
      位置不變」
- [x] 9.12 `probe-keyboard.mjs`：置頂段撐滿時其餘段仍可用 —— 全域項目展開十來個 session，斷言
      其餘段 `clientHeight > 0` 且捲得動（4.4 的載體）
- [x] 9.13 `probe-workspace.mjs`：置頂段內部捲動時，拖曳的落點不會命中被裁切的列（6.2 的載體）

## 10. 驗收：環境與對照組

- [x] 10.1 rail 溢出**以壓矮 viewport 達成，不以多塞 folder** —— `probe-keyboard.mjs:1780` 已記錄
      這個決策（fixture 是全域的，多塞 folder 會讓前面每一條絕對斷言跟著壞）
- [x] 10.2 訂出具體的視窗高度與置頂數，使**其餘段確實有非零高度且確實可捲動**，並在段落開頭
      斷言它。零高度容器的 `scrollHeight > clientHeight` 恆為真 —— 那時 9.10／9.11 什麼都沒量到
- [x] 10.3 **對照組（遮擋）**：把置頂段改回捲動容器內的 `position: sticky` **並加上
      `scroll-padding-top`**，確認 9.11 變紅。**只改成 sticky 是不夠的** —— sticky 元素本來就在
      視口頂端，對它 `scrollIntoView` 是 no-op，斷言會保持綠燈
- [x] 10.4 **對照組（裁切）**：把 6.2 的交集退回成未裁切的 rect，確認 9.13 變紅
- [x] 10.5 **對照組（早退）**：把 1.4／3.4 退回，確認 2.2 與 9.6 變紅

## 11. scenario → 驗收載體對照表

- [x] 11.1 逐條核對下表，確認**每一條 scenario 都有一個指名的載體**，且該載體對錯誤的實作會變紅。
      本 repo 已四次因「補了 scenario 卻沒做載體」而封存帶缺口的 change（issue #12），
      `openspec validate --strict` 對此**完全無感**
- [x] 11.3 逐條複驗 39 條標為「既有」的載體（`/openspec-verify-change` 的產出）：35 條確認有實際
      載體；**4 條的「既有」是假的** —— 「目標已完整可見時不捲動」（實際由 9.11 覆蓋，歸屬寫錯）、
      「切換 session 時其 rail 子列亦捲入視野」與「點選 rail 子列時分頁列仍捲動」（**零覆蓋，已補
      載體**）、「自 rail 加入 folder」（原生對話框驅動不了，記錄為無載體）
- [x] 11.2 下表的 scenario 名稱與 delta spec **逐字相符**，因此可用一行腳本核對兩邊有無漂移
      （spec 改了名字而表沒跟上 ⇒ 該條就從清單上消失了）。改完 spec 後跑一次：
      `grep -o '^#### Scenario: .*' openspec/changes/rail-pinned-repos/specs/*/spec.md` 的每一條
      都應出現在下表中

| capability | scenario | 載體 |
|---|---|---|
| global-session | 呈現停用的置頂指示 | 9.4 |
| global-session | 不提供取消置頂的入口 | 9.4 |
| global-session | 置頂狀態不進入持久化設定 | 9.4 |
| global-session | 不提供右鍵選單 | 9.4 |
| global-session | 不提供移除入口 | 既有（`probe-workspace` 全域項目段） |
| global-session | 不可被拖曳排序 | 既有（`probe-workspace` 拖曳段） |
| global-session | 全域項目不使 folder 的拖曳落點偏移 | 既有 —— **但 fixture 須確保皆未置頂**（WHEN 已加此前提） |
| global-session | 分界不使 folder 的拖曳落點偏移 | 9.7 |
| global-session | 不進入 workspace 的持久化設定 | 既有 |
| global-session | 全域項目位於所有 folder 之前 | 既有（`probe-workspace` RAIL_ORDER） |
| global-session | 分隔線劃在置頂段與其餘 folder 之間 | 9.5 |
| global-session | 尚無置頂的 folder 時分隔線緊接於全域項目之後 | 9.5（**既有行為的回歸守衛**） |
| global-session | 尚無任何 folder 時仍呈現 | 既有（`probe-keyboard` checkEmptyWorkspace） |
| global-session | 不呈現 git 分支 | 既有 |
| global-session | 冷啟動不預設選中全域項目 | 既有 |
| keyboard-navigation | 將選中的 repo 往下移動一格 | 既有 —— **但 fixture 須確保皆未置頂**（WHEN 已加此前提） |
| keyboard-navigation | 到達端點時不循環 | 9.9（端點改指「置頂段的第一個」，並一併斷言置頂狀態未變） |
| keyboard-navigation | 移動後仍為選中的 repo | 既有 |
| keyboard-navigation | 只有一個 folder 且不跨界時為無操作 | 9.9（`checkSingleFolder`） |
| keyboard-navigation | 只有一個 folder 時仍可跨界 | 9.9（`checkSingleFolder`） |
| keyboard-navigation | 選中全域項目時為無操作 | 既有 |
| keyboard-navigation | 第一個 folder 仍可往下移動一格 | 既有 |
| keyboard-navigation | 第二個 folder 仍可往上移動一格 | 既有 |
| keyboard-navigation | 往下跨越分界即取消置頂 | 9.9 |
| keyboard-navigation | 往上跨越分界即置頂 | 9.9 |
| keyboard-navigation | 切換至視野外的 rail 項目時捲入視野 | 既有（8.1–8.3 修正後） |
| keyboard-navigation | 捲入視野的目標不被置頂段遮擋 | 9.11 ＋ 10.3 |
| keyboard-navigation | 置頂段內的目標不觸發捲動 | 9.11 ＋ 10.3 |
| keyboard-navigation | 切換至全域項目時其餘段不被捲動 | 9.11 |
| keyboard-navigation | 切換至視野外的 session 時分頁列橫向捲動 | 既有 |
| keyboard-navigation | 切換 session 時其 rail 子列亦捲入視野 | **11.3 新建**（此前只有「不捲動」那條的前置在用 `FOCUSED_ROW`，沒有任何正向斷言） |
| keyboard-navigation | 移動 rail 項目後它仍可見 | 既有（8.1–8.3 修正後） |
| keyboard-navigation | 移動 session 後它仍可見 | 既有 |
| keyboard-navigation | 目標已完整可見時不捲動 | 9.11（切換至置頂的 repo —— 它恆常完整可見）。**此前寫「既有」是錯的：probe-keyboard 沒有這條既有斷言** |
| keyboard-navigation | 以滑鼠選取部分可見的項目時不捲動 | 既有 |
| keyboard-navigation | 點選 rail 子列時分頁列仍捲動 | **11.3 新建**（此前零覆蓋 —— 那條「以滑鼠操作時不捲動」的例外只驗了 rail 一側） |
| keyboard-navigation | 背景 session 的狀態更新不搶走 rail 的捲動位置 | 既有（8.1 修正後） |
| keyboard-navigation | 背景 session 的狀態更新不搶走分頁列的捲動位置 | 既有 |
| rail-pinning | 置頂一個位於清單中段的 folder | 9.1 |
| rail-pinning | 兩段之間有視覺分隔 | 9.5 |
| rail-pinning | 未置頂的 folder 無法被排到置頂的 folder 之前 | 9.6 |
| rail-pinning | 置頂狀態跨重啟存活 | 9.1 |
| rail-pinning | 捲到底部後置頂段仍完整可見 | 9.10 |
| rail-pinning | 置頂 repo 的 session 子列一併留在視野 | 9.10 |
| rail-pinning | 置頂段撐滿時其餘段仍可用 | 9.12 |
| rail-pinning | 未置頂的 folder 會被捲出視野 | 9.10（同一時刻的反向斷言 —— 這一條才是 9.10 的鑑別力來源） |
| rail-pinning | 落點不會命中被裁切的列 | 9.13 ＋ 10.4 |
| rail-pinning | 分界兩側的指示線可辨 | 9.8 |
| rail-pinning | 把未置頂的 repo 拖到分界之上 | 9.6 |
| rail-pinning | 把置頂段最後一個 repo 拖到分界之下 | 9.6 ＋ 2.2 ＋ 10.5 |
| rail-pinning | 跨界拖曳後順序與置頂狀態一併落盤 | 9.6 |
| rail-pinning | 以控制項切換置頂 | 9.1 |
| rail-pinning | 以右鍵選單切換置頂 | 9.2 |
| rail-pinning | 右鍵選單可完全以鍵盤操作 | 9.2 |
| rail-pinning | 右鍵不啟動拖曳 | 9.2 |
| rail-pinning | 置頂落在置頂段末端 | 9.1 |
| rail-pinning | 取消置頂落在其餘段首端 | 9.1 |
| rail-pinning | 置頂的列在未懸停時仍呈現指示 | 9.3 |
| rail-pinning | 未置頂的列在未懸停時不呈現控制項 | 9.3 |
| workspace-folders | 置頂狀態跨重啟還原 | 2.1 ＋ 9.1 |
| workspace-folders | 讀取尚無置頂欄位的既有設定檔 | 2.3 |
| workspace-folders | 重排改變清單順序 | 既有 |
| workspace-folders | 清單不含 rail 的固定項目 | 既有 |
| workspace-folders | 重排後的順序立即落盤 | 既有 |
| workspace-folders | 未知的識別碼為無操作 | 既有 |
| workspace-folders | 越界的目標位置被夾制 | 既有 |
| workspace-folders | 只改變置頂狀態的重排仍會落盤 | 2.2 ＋ 10.5 |
| workspace-folders | 置頂的 folder 恆佔清單前綴 | 2.1 |
| workspace-folders | 順序不符不變式的設定檔被正規化 | 2.1 ＋ 2.4 |
| workspace-layout | 拖曳 repo 改變 rail 的順序 | 既有 |
| workspace-layout | 展開中的 repo 連同其 session 子列一起移動 | 既有 |
| workspace-layout | 於 session 子列上拖曳只移動 session | 既有 |
| workspace-layout | 未位移的按下視為點擊 | 既有 |
| workspace-layout | 被移動的 repo 維持選中 | 既有 |
| workspace-layout | 拖曳同時決定置頂狀態 | 9.6 |
| workspace-layout | 含 openspec 的 folder | 既有 |
| workspace-layout | 不含 openspec 的 folder | 既有 |
| workspace-layout | 路徑失效的 folder | 既有 |
| workspace-layout | folder 的分支 | 既有 |
| workspace-layout | rail 不呈現不可操作的控制項 | 既有 |
| workspace-layout | 停用的控制項宣告自身的停用狀態 | 9.4 |
| workspace-layout | 自 rail 加入 folder | **無載體**：原生目錄對話框會阻塞探針，驅動不了。既有缺口，本 change 未改變其狀態 |

## 12. 守衛與回歸

- [x] 12.1 `npm test`（含 `copy-language` / `aria-label-source` / `i18n-key-safety` / `typography` 四道守衛）
- [x] 12.2 `npm run typecheck` 與 `npm run lint`
- [x] 12.3 `npm run probe:terminal` 與 `npm run probe:files` 回歸 —— `ContextMenu` 是共用元件
- [x] 12.4 `npm run test:e2e` 全套

## 13. 文件

- [x] 13.1 CLAUDE.md：快捷鍵表補上 `Shift+↑↓` 跨界即改變置頂狀態；依「不知道就會踩、且失敗是
      靜默的」與「隨時會踩 vs 動某類檔案才會踩」兩條判準，決定新教訓寫進 CLAUDE.md 還是
      `docs/lessons/`（候選：rail 有兩個 `<ul>` 且只有一個是捲動容器、捲動容器要以 `aria-label`
      指名、`flex-basis: 0` 的區段拿不到剩餘空間就是 0、為何不是 sticky）
- [x] 13.2 `docs/PRD.md`：§6 的 rail 描述若與置頂行為不符則更新
- [x] 13.3 `README.md`：第 29／34 行列舉了 rail 的功能，補上置頂
- [x] 13.4 `docs/workspace-mockup.html`：它是 rail 版面與行為的權威雛型。更新它，**或**明確記錄
      「本 change 刻意不更新雛型」及理由 —— 兩者皆可，但不可是沉默的遺漏
