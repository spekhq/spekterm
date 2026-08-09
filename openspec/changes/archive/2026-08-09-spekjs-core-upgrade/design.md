## Context

升級只有一行（`^1.3.0` → `^1.6.0`），工作全在吸收 1.4.0 對 `TaskItem.text` 的語意改變。

**實測（core 1.6.0，對本 repo 自己的 `openspec/changes/artifact-order-resilience/tasks.md`）**：

```
多行 task：29 / 40（72%）
"1.1 新增 `src/renderer/src/shell/openspec/order.ts`，把 `ChangeView.tsx` 的私有函式
    `orderArtifacts` 搬過去並導出（…design D7）"
```

續行帶著 **4 個空格**的縮排 —— 原始碼裡是 6 空格，core 減去 `- ` 的 CommonMark content offset（2）。
core 的 CHANGELOG 說明了這個減法的目的：**讓折出來的文字獨立渲染時，看起來與原地渲染相同**。

現行渲染是 `ChangeView.tsx:369` 的 `<span className="min-w-0">{task.text}</span>`。HTML 會把換行摺成
一個空格，縮排消失 —— 於是 72% 的 task 變成一長串黏在一起的字。

三個既有約束限定了可行解：

- **`task.text` 是不受信任的輸入。** 它來自使用者 repo 的 `tasks.md`，與 `MarkdownView` 渲染的
  `.md` 同源。那個元件的安全性**來自 react-markdown 的預設值，且那些預設值必須被明確保護**
  （不加 `rehype-raw`、不覆寫 `urlTransform`、連結一律不在 app 內導航）。
- **側欄寬度上限 620px**，遠窄於 spek web 的瀏覽器全寬。
- tasks 分頁是側欄的**主要閱讀內容**（CLAUDE.md 對它的定位），不是輔助文字。

## Goals / Non-Goals

**Goals:**

- 依賴升到 `^1.6.0`，且升級後側欄的 tasks 分頁**不比升級前差**。
- 多行 task 的文字以作者寫下時的語意呈現。
- 讓 `artifact-order-resilience` 得以開始實作（`sortArtifacts` 可用）。

**Non-Goals:**

- **不使用 `sortArtifacts`** —— 那是 `artifact-order-resilience` 的工作。本 change 只讓它可用。
- **不動 `@spekjs/ui`** —— peer 為 `>=1.3.0`，1.6.0 仍滿足（已驗）。
- 不改 tasks 分頁的分組、進度條、完成狀態呈現 —— 只改文字怎麼被畫出來。
- 不為多行文字新增摺疊／展開。上游 spek 對 **spec** 內容做了折疊（1.11.0），那是另一件事：
  spec 的 scenario 佔 59% 字元量，而 task 的續行是它自己的說明，藏起來就等於回到 1.3.0 的行為。

## Decisions

### D1 — 以 markdown 渲染 `task.text`，而不是 `whitespace-pre-wrap`

`whitespace-pre-wrap` 看似最小改動（保留換行與縮排），**但它保留的是錯的東西**：本 repo 的續行折在
100 字元處，那是**原始碼的排版**，不是內容的語意。把它原樣搬進 620px 的側欄，會產生一堆與側欄寬度
無關的短行，而且縮排會在窄欄裡變成明顯的鋸齒。

markdown 渲染則讓 **CommonMark 的規則決定哪些換行有意義**：lazy continuation（本 repo 的形狀）摺成
一個段落、兩空格硬換行保留為 `<br>`、`- ` 子項成為巢狀清單、縮排足夠者成為程式碼區塊。這正是 core
做那個 dedent 的目的，也是上游 spek web 的選擇（1.10.0「Task text renders as Markdown」）。

**附帶而非次要的好處**：`` `code` `` 與 `**bold**` 目前是原樣顯示反引號與星號的。本 repo 的 tasks
密集使用它們，所以升級後那 29 條同時會變得更好讀，而不只是「沒有變糟」。

### D2 — 重用 `MarkdownView`，**絕不**在 `TaskList` 另起一個 `react-markdown`

這是本 change 唯一的安全性判斷。`task.text` 與 `MarkdownView` 已在渲染的 `.md` 是**同一類不受信任
的輸入**，而那個元件的防護是一組「必須沒有被加上／覆寫的東西」（`rehype-raw`、`urlTransform`）——
**一個第二呼叫點就是一個第二個必須記得保護的地方，而漏掉它不會有任何紅燈**：畫面照常渲染，只是
`.md` 裡的 `<script>` 變成真的 script。

因此渲染路徑只有一條。連結行為（外部交給主行程、其餘不可點）也一併免費繼承。

### D3 — `MarkdownView` 需要一個緊湊變體，而它是 prop 不是第二個元件

`MarkdownView` 現在的容器帶 `px-1 py-1 text-base leading-relaxed text-ink-dim`，是為「一整份文件」
設計的。塞進 `<li className="flex gap-2">` 會多出內距、且顏色會蓋掉 task 自己的完成／未完成配色。

作法是給它一個 `dense`（或同義的）prop 控制容器類名，**不是複製一個 `TaskMarkdown` 元件** —— 理由
與 D2 同源：兩個元件就是兩份安全預設要維護。

同時要處理 `<p>` 是 block 元素：在 flex item 裡它會自成一行，需要讓段落不帶外距（首段尤然）。
**已完成 task 的 `line-through` 要能穿透到渲染出來的元素** —— `text-decoration` 會被子元素繼承，
但 `<p>`／`<code>` 的自有樣式要確認不會截斷它。

### D4 — `key={task.text}` 換成穩定的組合鍵

現行 `key` 是整段文字。text 變成多行之後這個鍵變得又長又易變（改一個字就換 key，整個 `<li>` 重建），
而它原本要解的問題是「同一 section 內兩條 task 文字相同」。改為 `${section.title}:${index}` 之類的
組合，或維持 text 但明確承認它的代價。**這不是升級造成的 bug，是升級把它放大了**。

### D5 — 升級後必須實測 dedupe，而不是假設

`@spekjs/ui@1.2.0` 對 core 是 **peer** 依賴。升 core 之後要確認 npm 把樹上的 core dedupe 成同一份 ——
兩份 core 意味著套件眼中的 `ChangeInfo` 與我們的是兩個不同型別，而失效方式是型別錯誤或執行期行為
不一致，兩者都不會指向根因。

### D6 — CLAUDE.md 那句「兩者必須同時升」改寫為條件式

現行文字讀起來像「每次升 core 都要一起升 ui」。真正的規則是**檢查 peer 是否仍被滿足** —— 而本次
正是不必動 ui 的反例（`>=1.3.0` 涵蓋 1.6.0）。留著原句，下一個人會做一次沒有必要的升級，或者更糟：
以為升不了 core 而放棄。

## Risks / Trade-offs

- **[1.5.0 的 `parseTasks` 邊界改變一併吃進來]** → lone `\r` 現在算行尾；只有空白與 tab 算空行。
  對使用一般 `\n` 的檔案輸出**逐位元組相同**（core 的 CHANGELOG 明載），而本 repo 的 `tasks.md` 全是
  `\n`。風險落在使用者的其他 repo，且方向是「更正確」。
- **[每條 task 各渲染一次 markdown]** → 本 repo 最大的 tasks 有 40 條。react-markdown 的解析成本與
  proposal 那類整份文件相比小得多，且 spek web 已在生產中這樣做。若日後成為問題，記憶化的位置是
  `TaskList`，不是共用元件。
- **[markdown 渲染會讓「一行」變成「一段」，行高與間距改變]** → tasks 分頁的版面會變。CLAUDE.md 有
  一條實測教訓：**版面一動，以真滑鼠座標點擊的 probe 就開始點空，症狀是時綠時紅**。因此驗收要涵蓋
  `probe:openspec`，且若出現 flaky，第一嫌疑是版面而不是時序。
- **[升級解鎖的 `sortArtifacts` 在本 change 不被使用]** → 有意為之。若日後有人問「為什麼升了卻沒用」，
  答案在 `artifact-order-resilience`。
