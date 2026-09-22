## Context

動機見 `proposal.md` 的〈Why〉。這裡只記四件決定形狀的現況，**每一條都實測過**：

1. **淡化靠繼承。** `ChangeView.tsx:403-405` 把 `text-ink-faint line-through` 掛在 task 的 `<li>` 上，
   內文的顏色由繼承而來。逃脫繼承的有兩類：`MarkdownView.tsx:70-74` 的 `strong`（`text-ink`，
   BDD 關鍵字另有 `text-blue` / `text-green` / `text-danger`）與 `:78,:83` 的連結。
   行內 `code` 沒事 —— `.markdown code`（`index.css:244-250`）只設背景，顏色是繼承的。

2. **`index.css` 裡還有三條同樣逃脫繼承的宣告**，第一版 design 漏了它們：
   `.markdown h1..h4`（`:199-207`，`--color-ink`）、`.markdown blockquote`（`:238-242`）、
   `.markdown th`（`:279-281`）。**這不是補充清單，是 D1 的證據** —— 一份「列舉要修哪些元素」的
   清單，第一次寫就已經漏了三條。

3. **`MarkdownView` 是唯一的 markdown 渲染路徑。** `openspec-panel` 的 spec 明文要求 task 文字走
   同一條路徑（安全性來自一組必須維持的預設值，第二條路徑就是第二處必須記得維持它們的地方）。
   `dense` 有三個呼叫點：`ChangeView.tsx:417` 一處、`ConversationView.tsx:53,:60` 兩處。

4. **載體幾乎已經就位。** `probe-openspec.mjs:547-553` 的 `TASK_ITEMS` 已經取出每一列的
   `strongMarks`，而 fixture 的 task 1.1（`:123-133`）正好是「已完成 ＋ 多行 ＋ 含 `**務必**`」。
   同一支探針也已有讀 computed color 的先例（`BDD_COLORS`，`:560-568`）。

**雛型對此沉默。** `workspace-mockup.html:639-660` 的九個 task item 全是「勾選符號 ＋ 一段純文字」，
沒有任何 `<strong>` / `<code>` / 子項。依 `rail-pinned-repos` 的先例（**權威僅及於雛型講過的事**），
本 change 不構成偏離雛型。但雛型對**完成標記**講過話，見 D3。

## Goals / Non-Goals

**Goals:**

- 一條已完成的 task，其**文字**（含 markdown 渲染出來的行內元素）以單一顏色呈現。
- 這件事由**結構**保證：日後在 `MarkdownView` 加一個自帶顏色的行內元件時，它**表達不出**
  在已完成 task 裡保留自己的顏色。
- 不觸及任何其他 surface。

**Non-Goals:**

- 不改散文的渲染（proposal／design／spec deltas／檔案檢視）。
- 不改 `ConversationView`。
- 不改未完成 task 的呈現 —— **含它的 BDD 上色**（上游 spek 的 tasks 分頁明文不做 BDD 上色，
  見 D6；本 change 不跟進）。
- 不改刪除線 —— `text-decoration` 本來就會傳播給後代，它從一開始就是對的那一半（已實測：
  已完成列的 `strong` 與巢狀 `<li>` 的 `-webkit-text-decorations-in-effect` 皆為 `line-through`）。
- 不改完成標記的綠色，見 D3。

## Decisions

### D1：由呼叫端以一條涵蓋整棵子樹的規則強制繼承，而不是把 `MarkdownView` 的顏色拿掉

選定：在已完成的 `<li>` 上掛一個 class，並以

```css
.task-done .markdown * { color: inherit; }
```

讓該列之內的任何元素都無法宣告自己的顏色。

**為何不動 `MarkdownView` 的 `strong`。** 上游 spek 是把 tasks 拆成第二個元件 `TaskText`
（`strong` 只有 `font-bold`），我們不能照抄 —— spekterm 刻意只有一條渲染路徑。而真正會被改到的
surface **不是 `ConversationView`**（第一版 design 在這裡推理錯了）：那條祖先鏈
（`MainStage.tsx:406 → :460 → :513 → ConversationView.tsx:169 → Row wrapper`）**沒有任何一層設
顏色**，繼承到的就是 `body { color: var(--color-ink) }`（`index.css:153`），所以 `strong` 的
`text-ink` 在那裡與繼承值同值，**拿掉是視覺上的 no-op**。

會被改到的是**散文**：非 `dense` 的容器是 `text-ink-dim`（`MarkdownView.tsx:64`），`strong` 的
`text-ink` 在那裡才是承重的層級差。**而散文的一般 `strong` 沒有任何載體**
（`probe-openspec.mjs:1997-2002` 只驗 BDD 關鍵字與內文不同色，不驗一般 `strong`）——
在一個沒有載體的地方改一個承重的值，正是這個 repo 記過最多次的失效形狀。

**為何不加第二個 prop（例如 `inheritColor`）。** 它解得掉範圍問題，但保證是**靠約定的**：
日後在 `MarkdownView` 多加一個自帶顏色的元件（`em`、`del`、GFM 的 `mark`…），它就再次逃脫，
而且同樣沒有紅燈 —— 與今天這個缺陷一模一樣的形狀。這正是 repo 記過的那條：
**「不接受某個東西」要由結構保證，不是由「沒有人再送它」保證。** Context #2 是它的現成證據：
一份列舉清單第一次寫就漏了三條。

**代價**：規則與元件分處兩地。以 class 名 `task-done` 串接，兩處各留一句註解指向對方；
`index.css:181-186` 的註解已宣告 `.markdown-dense` 就是「tasks 分頁的項目文字」，把規則放在
那附近是既有落點，不是新開一處。

### D2：規則寫在 `index.css`，不用 Tailwind 的 arbitrary variant —— 而勝負的機制是 **cascade layer**，不是 specificity

**第一版 design 在這裡也推理錯了。** 實測產物 CSS（`out/renderer/assets/index-*.css`，brace
matching）：`.text-ink` 產在 **`@layer utilities` 之內**（offset 33017，layer 範圍 16143–38761），
而 `.markdown` 那些自訂規則**在任何 layer 之外**（45030 起）。**未進 layer 的宣告贏過任何 layer
內的宣告，與 specificity 無關** —— 所以 `.task-done .markdown *` 即使只有 (0,1,0) 也照樣贏。

這不是學術差異：把**同一條規則**包進 `@layer components`，實測全部復原（`strong.text-ink` 由
`rgb(91,102,117)` 變回 `rgb(226,232,240)`，`a.text-accent`、`h3`、`th` 亦然）。

**因此真正的脆弱點要記下來**：**日後有人把 `index.css` 的自訂規則收進 `@layer`、或改寫成
Tailwind v4 的 `@utility`，這條規則會靜默失效。** D5 的斷言抓得到它，但這個 design 的論證
預測不到 —— 寫在這裡讓下一個人看得到。

specificity 仍然要算，只是對手不是 `.text-ink`，是 Context #2 那三條同樣 unlayered 的規則
（皆 (0,1,1)）。`.task-done .markdown *` 是 (0,2,0)，實測全數打贏。至於
`[&_*]:text-inherit`：它產出的選擇器是 (0,1,0)、與 `.text-ink` 同層同 specificity，勝負由產出
順序決定 —— 那是一個沒有被寫下來的前提。CSS 檔另有一個好處：容得下解釋「為什麼是 `*` 而不是
列舉 `strong, a`」的那段註解。

### D3：作用域是**文字**，完成標記不在其中

完成標記 `TaskMark` 是 `text-green`（`ChangeView.tsx:353`），它是 `<li>` 的**直接子節點、不在
`.markdown` 之內**，新規則碰不到它 —— 而這是對的，不是漏網：雛型明文豁免它，
`workspace-mockup.html:374`

```css
.os-task-item.done .chk { color: var(--green); text-decoration: none; }
```

**spec 的措辭因此是「該項目的*文字*通篇只有一種前景色」，不是「該項目」。** 第一版寫成後者，
而那會讓一個照字面實作的人去把勾勾也弄暗 —— 牴觸雛型這個 UI 權威。

### D4：淡化用顏色，不用 `opacity`；而**對比度是一個被知情裁決的缺口，不是一個被閃過的問題**

**第一版 design 在這裡只做了相對比較（「從不產生比該列內文更低的對比」），從沒量過絕對值。
那是在用一個為真但不相干的陳述迴避問題。** 量出來（`--color-ink-faint` #5b6675 對側欄背景
`--color-panel` #14181d，`index.css:9,14`；側欄容器 `MainStage.tsx:546` 的 `bg-panel`）：

| | 現況 | 本 change 之後 |
|---|---|---|
| 已完成 task 的內文 | **3.06:1** | 3.06:1（不變） |
| 粗體 `text-ink` | 14.46:1 | **3.06:1** |
| 連結 `text-accent` | 8.30:1 | **3.06:1** |
| BDD `text-blue` / `text-danger` | 7.01 / 6.44:1 | **3.06:1** |

**3.06:1 低於 WCAG 2 AA 的 4.5:1，也低於上游 spek 判定不可接受而 revert 的 3.24:1**
（`spek/packages/web/src/styles/contrast.test.ts:572-591`，那次 revert 是 `f1851c1`）。
上游另有一條明文下限（`spek/openspec/specs/theme-toggle/spec.md:58`，4.5:1）與一條專門的
scenario（`change-browsing/spec.md:170-175`「A completed task stays readable」）要求已完成
task 的連結與行內 code 仍要過那個下限 —— **本 change 的方向與上游的明文裁決相反。**

**裁決**：採用，知情。理由有三：

1. 那 3.06:1 的內文**今天就已經在出貨**（`ChangeView.tsx:404`），本 change 擴大的是處於該值的
   面積，不是把一個合規的東西弄壞。
2. **使用者看過四種變體的實際渲染之後選了這一個。** 提高到 `--color-ink-dim`（6.95:1，過 AA、
   且接近 spek 實際的 6.08–6.41:1）的方案被明確評估並否決 —— 淡化不夠，而「已完成的東西不該搶
   注意力」是這個缺陷一開始的訴求。
3. 已完成的 task 是**已經不必再讀**的內容；能不能一眼看出「它已完成」比「能不能舒服地讀完它」
   更重要，而前者由刪除線與綠色勾勾（兩個非顏色的維度）承擔。

**spekterm 至此沒有可辨讀性下限，而且是有意識的** —— `scripts/` 下沒有任何對比度守衛，
`openspec/specs/` 裡也沒有任何可辨讀性條款。**這是一個被追蹤的缺口，不是一個沒人發現的事實。**

> **此結論有前提。** 若日後 spekterm 引入可辨讀性下限（例如跟進上游的 4.5:1），本條即失效：
> 已完成 task 的顏色必須重新裁決，而 `--color-ink-dim`（6.95:1）是現成的答案。

`opacity` 則**不在選項之內**，理由與上游相同且獨立於上面的裁決：它在顏色決定之後才套用、一次
作用於每一個後代，於是連「整列同一個顏色」這個性質都保不住，也無法以任何 palette 值補償。

### D5：驗收載體

加在 `probe:openspec` 既有的那一段（`:1929-1963`）。fixture 的 task 1.1 要**補一個外部連結與一個
`**SHALL**`** —— 第一版只驗了粗體，而 requirement 正文列的是「強調、行內程式碼、連結、關鍵字
標示」：

- **行內程式碼那一項恆綠**（`.markdown code` 今天就在繼承，任何實作都通過）—— 零鑑別力。
- **鑑別力最高的恰好是沒被驗的兩個**：連結是 `text-accent`、BDD 是 `text-danger` / `text-blue`，
  與內文的差距都大於 `text-ink`。

| 斷言 | 防什麼 |
|---|---|
| 已完成 task 的 `<strong>`、`<a>`、BDD 標示的 computed color **皆等於**該 `<li>` 的 computed color | 本 change 的缺陷本身 |
| 該顏色**不等於**未完成 task 的內文顏色 | 「整份清單都畫成同一個淡色」也會讓上一條變綠 |
| 已完成 task 的完成標記 computed color **仍為** `--color-green` | D3 —— 防止淡化溢出到狀態標記 |

- **看 computed color，不看 class** —— 與既有的「已完成與未完成的 task 可區分」同一條紀律。
- **mutation**：刪掉 `.task-done .markdown *` 那條規則 ⇒ 第一條紅；把未完成的列也改成
  `text-ink-faint` ⇒ 第二條紅；把規則的作用域從 `.markdown *` 放寬到 `.task-done *` ⇒ 第三條紅。
- **兩個實作陷阱**（實測）：`li.querySelector('strong')` 對未完成的 task 是 `null`
  （fixture 的 1.2／2.1 都沒有 `strong`），不 guard 會讓整個 `evaluate` throw；而新斷言**必須插在
  `probe-openspec.mjs:2006` 之前** —— 那一行寫入 `TASKS_DONE` 把 1.2 也勾掉，之後就沒有未完成的
  列可以當參照物了。

### D6：不跟進上游「tasks 分頁不做 BDD 上色」

spek 的 spec 明文要求 Tasks 分頁只吃標準 CommonMark+GFM、**不做 BDD 關鍵字高亮**
（`change-browsing/spec.md:155-159`）—— 所以在 spek 裡，task 的 `**SHALL**` 永遠只是粗體。

本 change **不跟進**：那是一個獨立的產品決定（它會改變**未完成** task 的呈現，而缺陷只在已完成
那一側），且會動到 `MarkdownView` 的 `dense` 分支。本 change 的作用域止於「已完成的列不讓顏色
逃脫」。已完成列的 BDD 標示會跟著整列淡化，未完成列維持現狀。

## Risks / Trade-offs

- **已完成 task 的內文、連結與關鍵字全部落在 3.06:1** → 見 D4：知情裁決，且已登記為缺口。
- **已完成 task 裡的連結不再是 accent 色** → 底線（`underline decoration-dotted`）保留。
  但要誠實記一筆：`text-decoration-color` 預設跟 `currentColor`，於是底線、刪除線與文字同色，
  **這個「非顏色的區分維度」在視覺上很薄**。
- **`*` 會蓋掉未來想在 task 內刻意保留的顏色** → 那是刻意的。真要例外時必須顯式提高
  specificity，而那會是一個看得見的決定，不是一次遺漏。
- **規則與元件分處兩地** → 見 D1 的代價段。
- **`index.css` 日後被收進 `@layer` 或改寫成 `@utility`** → 見 D2。探針抓得到。

## Migration Plan

單一 renderer 的呈現變更：無資料格式、無 IPC、無持久化、無新依賴。rollback＝還原
`ChangeView.tsx` 與 `index.css` 兩處。
