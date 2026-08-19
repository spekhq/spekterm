## Context

`keyboard-navigation` 的 requirement 以**不變式**表述：「**以鍵盤改變選取、焦點或順序時**，目標
SHALL 於其所在的每一個捲動容器內可見」。而三個實作點把這個不變式編碼成 effect 的依賴陣列 ——
**依賴陣列就是這條 requirement 在程式碼裡唯一的載體**，寫錯它不會有型別錯誤，也不會有紅燈。

現況（`useScrollIntoView` 的三個消費點）：

| 位置 | 目標 | 依賴 | 實際觸發條件 |
|---|---|---|---|
| `WorkspaceRail.tsx:492` `railScroll` | 選中的 rail 項目標題列 | `[selection, railScroll]` | 選取物件的**身分**改變（**順序改變時不觸發**） |
| `WorkspaceRail.tsx:171` `rowScroll` | 選中項目的 focused session 子列 | `[selected, focusedSessionId, sessions, rowScroll]` | **任何重繪** |
| `SessionTabs.tsx:67` `tabScroll` | focused session 的分頁 | `[focusedId, sessions, tabScroll]` | **任何重繪** |

`sessions` 來自 `forFolder()` 的 `filter()`（`sessions.tsx:538`），每次渲染都是新身分；而
`setTitle` 在 `claude` 每次宣告新標題時都會產生新的 `sessions` state。兩者相乘＝**只要有 session
在跑，rail 就持續被捲回 focused 子列**。

**`QuickOpen.tsx:96` 有第四個 `scrollIntoView`，但它不是這個 hook 的消費點** —— 它直接呼叫 DOM
API（`quick-open/QuickOpen.tsx:1-5` 沒有 import 這個 hook），因此也沒有 pointer guard。它的依賴
是純量 `active`，形狀正確，**本 change 不動它**；但不要把它當成「這個 hook 已經有一個正確用法」
的例證 —— 它證明不了 hook 的介面。

### 一個被寫下來卻沒有擋住的教訓

`useScrollIntoView` 的回傳值刻意以 `useMemo` 穩定，註解明白寫著理由：「一個每次渲染都重建的物件
會讓那個 effect **每渲染一次就跑一次**」。**那個防護只及於 hook 自己交出去的東西，管不到呼叫端
自己塞進依賴陣列的值** —— 於是同一個失效方式從另一個入口原封不動地重演。這正是「一個由紀律維持
的不變式，遲早會從紀律照顧不到的那一側被違反」。

## Goals / Non-Goals

**Goals:**

- 捲動的觸發條件與 requirement 一致：**選取、焦點或順序改變**時捲動，其餘時候不捲。
- 三個消費點都不再有機會把「每次渲染都變的值」寫進觸發條件 —— 由**介面**擋住，不由註解擋住。
- 補上 `Shift+↑↓` 移動 rail 項目時的捲動 —— 它現在**是靠這個缺陷順帶成立的**（見 D4）。
- 新增與修復的行為都有**具備鑑別力**的驗收載體。

**Non-Goals:**

- **不引入 React 元件測試設施**（jsdom / testing-library）。這個 repo 的 renderer 行為一律由探針
  承擔，為單一缺陷引入第二套測試典範的成本遠大於收益。
- **不動 pointer guard 的語意** —— 它解的是「以指標點半可見目標時它在游標底下跳走」，與本缺陷
  正交（proposal 已述）。
- **不 memo 化 `forFolder()`** —— 見 D2。
- **不動 `QuickOpen`** —— 它的觸發條件已是純量，且它與 rail／分頁列不是同一個容器語意。
- **不倚賴瀏覽器的 scroll anchoring** —— 它管的是「內容變動時視覺不跳」，管不到「有人主動把容器
  捲到別處」。它擋不住本缺陷。

## Decisions

### D1：觸發條件由「目標的位置」表述，而不是「集合的身分」

三個 effect 的觸發條件一律改為一個**純量 key**，內容是「目標的身分 ＋ 它的位置」：

| 位置 | key |
|---|---|
| `railScroll` | `` `${選中項目的識別碼（全域為 'global'）}:${railIndex}` `` |
| `rowScroll` | `` `${selected}:${focusedSessionId}:${rowIndex}` `` |
| `tabScroll` | `` `${focusedId}:${tabIndex}` `` |

「位置」正是 requirement 表格裡「順序改變」那一列所指的東西，而它對「標題更新」免疫（同一個
session 換了名字，序位不變）。

**key 取的是選取的「值」，不是 `selection` 物件的身分。** `folderSelection()` 每次呼叫都造一個新
物件（`types.ts:58-60`），而 `AppShell.tsx:73` 每次點擊都送一個新的 —— 以物件身分為觸發條件的話，
「把選取重設成同一個值」仍會捲動，與新增的 requirement「選取…未改變時 SHALL NOT 捲動」直接抵觸。
現況看不出來，是因為那條路徑上 pointer guard 剛好也擋著；**兩道機制遮同一個洞，其中一道失效時
不會有人發現。**

**索引必須在 effect 之外算完**，effect 內只讀那個純量 —— 否則 `exhaustive-deps` 會（正確地）要求
把 `sessions` 加回依賴，缺陷原樣回歸。這條紀律不靠記憶維持，由 D3 的介面擋住。

考慮過而不採用的替代：

- **以 `useRef` 記住上一次的 `(focusedId, index)`，在 effect 內比對後才捲。** 行為等價，但它把
  觸發條件從「宣告式的依賴陣列」搬進「命令式的比較」——「這條 requirement 的載體是哪一行」變得
  更難看出來，而這正是缺陷當初躲過所有審查的原因。
- **依賴 `sessions.length`。** 擋得住標題更新，但擋不住重排（長度不變、位置變），會讓 `Shift+←→`
  的 requirement 靜默失效 —— **一個把已知缺陷換成另一個已知缺陷的修法**。
- **以「導航意圖」的 nonce 當觸發**（每個改變選取／焦點／順序的動作各自 bump 一次）。它最貼
  requirement 的字面，但要求**每一條**導航路徑都記得 bump，而漏掉一條的失效是靜默的 —— 與位置
  推導出來的 key 相比，它把「正確性」從結構搬回紀律。

### D2：不 memo 化 `forFolder()`，因為那修不好任何東西

`forFolder()` 每次呼叫都 `filter()` 出新陣列，看起來像根因，但它不是：`setTitle` 走的是
`previous.map(...)`，**陣列與那個 session 物件本來就都是新的**。memo 化之後 effect 照樣重跑，
唯一的變化是這個缺陷更難重現、也更難解釋。

**同一個判斷的另一面**：memo 化不是錯的（它有自己的效能理由），但它**不得被記成本缺陷的修法** ——
否則日後有人以「已經 memo 了」為由把依賴陣列放寬回去。

### D3：介面上不得存在任何「每次渲染都變」的參數

`useScrollIntoView` 本身改為接收觸發條件，effect 收進 hook 內，回傳只剩掛在容器上的 guard：

```ts
useScrollIntoView(
  key: string | null,
  resolve: () => Element | null | undefined,
  axis: 'block' | 'both',
): { onMouseDownCapture: () => void }
```

**它不能是 hook 回傳物件上的一個方法**（本設計的第一版是 `scrollTargetIntoView(...)`）——
那個形狀在 `react-hooks/rules-of-hooks` 下是 **error**：hook 不得於 callback 內呼叫（實測：
`React Hook "useEffect" cannot be called inside a callback`）。參數形式同時更貼合現況：三個
消費點都是「一個容器 ＋ 一個目標 ＋ 一個觸發條件」。

**三個參數各自為什麼是這個型別**：

- **`key: string | null`** —— 純量。「把整個集合當成觸發條件」在這個介面上寫不出來；呼叫端要傳
  的話得先自己把它壓成一個值，而那個動作本身就是在回答「這條 requirement 的觸發條件是什麼」。
- **`axis: 'block' | 'both'`** —— **刻意不是 `ScrollIntoViewOptions`**。三個呼叫點傳的都是
  inline object literal（`WorkspaceRail.tsx:171`、`:492`、`SessionTabs.tsx:67`），每次渲染都是新
  身分；它一旦是參數，就會被 effect 讀到，而 `exhaustive-deps` 會**要求把它加進依賴** ——
  **本 change 要修的缺陷，就從這個新入口原地復活**（實測：該規則對此發出 missing dependency
  警告）。字面量聯集沒有身分可言，這條路因此堵死。實際的 `ScrollIntoViewOptions` 是 hook 內部的
  模組層級常數。
- **`resolve`** —— 一個 closure，每次渲染都是新身分，因此**不進依賴**，由 hook 以 latest-ref 吞掉。
  **ref 必須在 effect 內更新，不可在渲染期間指派**：`react-hooks/refs` 對後者是 **error**（實測；
  `eslint.config.js:30` 開了 recommended），而 `WorkspaceRail.tsx:449-453` 的註解正記載這個 repo
  已經為「渲染期間寫 ref」付過一次學費。

**既有的 `scrollIntoView(target, options)` 匯出一併移除。** 三個消費點改用新原語之後它零呼叫端
（`QuickOpen` 從來就不是它的消費點），而它正是這個介面想關掉的逃生口 —— 留著一個沒人用、卻能
原封不動重現本缺陷的公開方法，「由介面擋住」就沒有兌現。`guard` 與 pointer 判定收為內部實作，
`guard` 仍照舊由容器掛載（語意一字不改）。

**「首次執行不捲」是這個 hook 的一部分，而它是承重的。** 掛載不是「選取、焦點或順序改變」——
而 rail 的 `<ul>` 裡有**兩個**捲動來源（選中項目的標題列、focused session 的子列）搶同一個容器：
`Shift+↑↓` 移動選中的 folder 時，重排會讓子列那一份重新掛載，於是它在標題列剛被捲進視野之後
**又捲了一次**，把畫面帶到別的地方（實測 dev：298 → 106 → 238，最後停在目標看不見的位置；
build 因無 StrictMode 而未重現 —— **又一次「一邊過一邊不過」**）。判定首次用獨立的 sentinel
（`undefined`），**不可用 `null`** —— `null` 是「當下沒有目標」這個合法的 key 值，混用會讓
「從無目標變成有目標」被當成首次而漏捲。

**這個介面擋的是「不小心」，不是「刻意」** —— 呼叫端仍可以刻意組出一個每次渲染都不同的 key
（tasks 的對照組正是這樣做的）。**沒有介面擋得住刻意**；能擋掉「順手把手上的陣列丟進去」已經是
這個缺陷的全部成因。

考慮過而不採用：**只修三個依賴陣列，不動 hook。** 改動最小（把三個 options 提成模組常數即可
避開 B 類問題），但把「不變式由紀律維持」原封不動地留在原地 —— 而本文開頭那一段已經證明這個
repo 在**同一個 hook 上**吃過這一記。

### D4：`Shift+↑↓` 的捲動現在是靠缺陷成立的，修正必須連它一起補

`railScroll` 依賴 `[selection]`。**`Shift+↑↓` 移動選中的 folder 時 `selection` 一個位元都沒變**
（`useWorkspaceFolders.ts:61-75` 只動 `folders`）—— 它從來不會觸發。

那 spec 的 `Scenario: 移動 rail 項目後它仍可見` 為什麼沒紅？**因為它根本沒有載體**（`probe:keyboard`
的捲動段落只驗 `Ctrl+↓`、`Ctrl+↑`、滑鼠例外與分頁列的 `Ctrl+Shift+Tab`），而畫面上它「看起來對」
是 `rowScroll` 順帶做到的 —— 重排讓 rail 重繪，`rowScroll` 把 focused 子列捲進視野，順手把它所屬的
folder 也帶了進來。

**於是 D1 若只照字面做，會把一條 spec 明載的行為改成靜默失效**，而現有驗收一條紅燈都不會有。
因此本 change 一併：

- `railIndex` 進 `railScroll` 的 key —— 移動選中的 folder 時位置改變 ⇒ 捲。
- 補上 `Scenario: 移動 rail 項目後它仍可見` 與 `Scenario: 移動 session 後它仍可見` 的驗收載體
  （兩條都是既有 scenario 的**缺口清償**，不是新行為）。

requirement 表格的其餘五種觸發（`Ctrl+↑↓`、`Ctrl+Tab`、`Ctrl+Shift+W`、`Ctrl+T`、`Shift+←→`）
修正後都仍由 `focusedId` 或位置觸發，逐一查證過，**沒有第二個同類的情況**。

### D5：驗收載體 —— 以「session 結束」觸發一次與導航無關的狀態更新

新斷言要的是：**selection、focus、順序都不變，而 `sessions` state 確實更新了一次**。

選 `onExit`（`sessions.tsx:217-225`）：pty 結束 → 主行程回報 → `setSessions` 把該 session 的
`status` 改為 `'exited'`。**它不改 focus、不改 selection、不改順序、不改清單長度** —— 正是所需的
那一次「純粹的重繪」。它同時也貼近使用者回報的情境（背景 session 的狀態變動）。

**載體自成一個段落（`checkScrollAnchoring`），不併進 `runMode`**：它要結束 session（破壞性）、
要八個 session，而 `runMode` 的絕對斷言全部以三個 fixture repo 的既有狀態為前提；`runMode`
又是這支探針最重的段落、build 與 dev 各跑一次，再加料會逼近段落窗口，而**逾時的段落不走
finally，其後的斷言會整批消失**。獨立一段也讓它能單獨迭代（實測耗時 15–16 秒）。

流程（**rail 與分頁列各用一組已驗證過的視窗尺寸**）：

1. 前提：該容器確實溢出（沿用既有的 `RAIL_SCROLLER` / `TAB_SCROLLER` 判定）。
2. 直接指派 `scrollTop` / `scrollLeft`，把目標捲出視野。直接指派不送滑鼠事件 —— 於是它不會誤觸
   pointer guard 的例外（既有段落已依賴這個性質）。
3. **前提斷言：此刻目標確實不完整可見**，且**確實找得到那個元素**（找不到要回 `null` 讓前提變紅，
   不可落進「不可見」—— rail 子列只在該項目展開時渲染，`WorkspaceRail.tsx:338`）。少了這條前提，
   `block: 'nearest'` 的「已完整可見就不捲」會讓斷言在缺陷仍在時**照樣通過**。
4. 讓一個 session 結束。
5. **斷言那次狀態更新確實發生了**：該 session 的 `title` 屬性（`${標題} — ${statusTitle}`，
   `WorkspaceRail.tsx:365`／`SessionTabs.tsx:161`）由 Running 轉為 Exited。
6. 斷言容器的捲動位置與步驟 2 相同。

**第 5 步不是禮貌性的檢查，它是這條斷言唯一的活性證明。** 第 6 步是相對判定（「位置沒變」），
**整個觸發機制死掉時它照樣是綠的** —— 而這支探針裡有一條具體的死法：五個地方以
`typeLine(..., 'cat -A > file')` 把 shell 留在 `cat` 裡（`probe-keyboard.mjs:643`、`:784`、
`:978`、`:1285`、`:1547`）。**一個停在 `cat` 裡的 session，打 `exit` 只是把四個字寫進檔案** ——
pty 不結束、`onExit` 不觸發、React 一次都不重繪，於是捲動位置當然不變。因此除了第 5 步，還要
**先確保該 session 停在 shell prompt**（新開一個 session 來結束它，或先送 `Ctrl+C`／`Ctrl+D`），
並把這個前提也寫成斷言。

**打字這個動作本身確保了 guard 不是綠燈的來源**：任何一顆按鍵都會把 `byPointer` 翻回 `false`
（`useScrollIntoView` 的設計），所以這條斷言綠，只可能是因為 effect 沒有觸發。

**對照組（必做，列入 tasks）**：把 key 換回「每次渲染都變的值」，這幾條斷言必須變紅。
**沒有跑過對照組的載體不算載體** —— 這個 repo 在同一份 spec 上已經吃過三次。

### D5a：移動方向是被 scroll anchoring 逼出來的

「`Shift+↓` 移動 rail 項目後它仍可見」的第一版是「選第一個 repo、把 rail 捲到底、往下移動」。
它**在正確與錯誤的實作上都通過** —— 對照組把序位自 key 拿掉之後，斷言照樣是綠的。

原因是瀏覽器的 **scroll anchoring**：被移動的那一塊位於視野**上方**，內容一變動瀏覽器就自動
補償捲動位置，恰好把目標帶進視野。**那是一個看起來像實作做到了的假綠**，而 anchoring 是
環境行為，關掉它就不是在驗被出貨的東西。

改為「選**最後**一個 repo、把 rail 捲到**頂**、`Shift+↑` 往上移動」：變動發生在視野**下方**，
anchoring 不介入，目標唯有被程式捲動才會可見（對照組實測轉紅）。requirement 的表格寫的是
`Shift+↑↓`，兩個方向同屬一條，因此 scenario 的措辭一併改為不指定方向。

**一般形式**：驗收「某個東西被捲進視野」時，要先問**除了待測的實作之外，還有誰會捲它**。

### D6：兩個必須避開的假載體

- **在 shell session 裡送 OSC 標題（`printf '\033]0;x\007'`）恆為綠。** `setTitle` 對
  `spawnTarget === 'shell'` **直接 `return previous`**（`sessions.tsx:442`）—— state 不變、不重繪，
  於是缺陷在與不在都不捲。而探針起的正是 `/bin/sh`。這是最直覺、也最沒有鑑別力的一條路。
- **以 rename 對話框觸發** 亦不宜：它會在 rail 列上產生 `mousedown`（`rowScroll.guard` 掛在
  `WorkspaceRail.tsx:196` 的 `<li>` 上），`byPointer` 被設為 `true`，於是斷言可能是**被 guard
  擋綠的**，而不是被修正擋綠的。

## Risks / Trade-offs

- **[段落窗口]** → 已量測：新段落自成一段、耗時 15–16 秒，`runMode` 未加料（50 秒），
  距 8 分鐘的預設窗口（`scripts/lib/sections.mjs:44`）沒有風險。
- **[`Shift+↑↓` 修好之後，`rowScroll` 不再跟著捲]** → 被移動的 folder 的 focused 子列可能仍在
  視野外。**這符合 spec**（該觸發的目標是標題列，`WorkspaceRail.tsx:122-129` 有論證：整塊可能比
  容器還高，以它為目標時判準永遠為假），但與今天的觀感不同 —— **dogfood 時容易被誤判為回歸**，
  先寫在這裡。
- **[以位置當觸發，會把「使用者移動了它」與「清單在它周圍變動了」混為一談]** → 新增或移除
  folder 會改變選中項的序位而觸發一次捲動。與 requirement 的字面不衝突（順序確實變了），且該
  情境下捲動幾乎總是使用者要的；記在這裡是因為**沒有任何 scenario 描述它**。
- **[`exited` 的呈現改變版面，污染捲動位置的量測]** → 已查證**不成立**：結束只改 `StatusDot` 的
  顏色與 `title` 屬性（`session-badge.tsx:36-66`），列高與寬度都不變。**此結論有前提** —— 日後若
  把已結束的 session 改成帶佔位徽章或額外一行，本段的量測就要重新論證。
- **[`key` 由呼叫端以字串拼接組出，拼錯不會有型別錯誤]** → 三個呼叫點各自有驗收斷言覆蓋；且拼錯
  的失效方向是「捲得太多」或「完全不捲」，兩者都在既有斷言的偵測範圍內。

## Open Questions

（無）
