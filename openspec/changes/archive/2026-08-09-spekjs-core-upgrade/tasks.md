## 1. 升級依賴

- [x] 1.1 `package.json`：`@spekjs/core` 由 `^1.3.0` 改為 `^1.6.0`，執行安裝。**`@spekjs/ui` 不動**
      —— 其 peer 為 `>=1.3.0`，1.6.0 仍滿足（design D6 已驗）
- [x] 1.2 **實測 dedupe**：確認 `node_modules` 樹上只有一份 core（`npm ls @spekjs/core`）。兩份的話
      `@spekjs/ui` 眼中的 `ChangeInfo` 與我們的就是兩個不同型別（design D5）。**要看輸出，不要因為
      沒有 ERESOLVE 就認定沒事**
- [x] 1.3 `npm run typecheck` —— 這是「core 是否新增了 required 欄位」的第一道回答。已預先 grep 過
      主行程沒有自建 core 型別（`Omit<ChangeInfo, 'source'>` 原封流穿），所以預期為綠；**若這裡紅了，
      表示那個前提被打破了，要回頭改 design 而不是就地修補**

## 2. markdown 渲染路徑（spec: openspec-panel）

- [x] 2.1 `src/renderer/src/shell/files/MarkdownView.tsx` 新增緊湊變體（prop，例如 `dense`）：
      去掉容器的內距與 `text-ink-dim`，讓顏色由呼叫端決定。**不新增第二個元件** —— 兩個元件就是
      兩份安全預設要維護（design D2/D3）
- [x] 2.2 段落樣式：`<p>` 在 flex item 內會自成一行且帶外距。緊湊變體要讓首段無上外距、末段無下外距
- [x] 2.3 `ChangeView.tsx` 的 `TaskList`：`<span>{task.text}</span>` 改為緊湊的 `MarkdownView`。
      **`TaskList` 內不得出現 `react-markdown` 的 import** —— 這是 spec 明文要求的「同一條渲染路徑」
- [x] 2.4 確認 `line-through` 仍穿透到渲染出的元素（`<p>` / `<code>` / `<li>`）。`text-decoration`
      會被子元素繼承，但子元素自己的樣式可能截斷它〔scenario「多行項目仍可區分完成狀態」〕
- [x] 2.5 `key={task.text}` 改為 `${section.title}:${index}` 之類的穩定組合（design D4）。
      多行之後 text 又長又易變，改一個字就整個 `<li>` 重建

## 3. 驗收 —— probe fixture 與選擇器

- [x] 3.1 **先修 `TASK_ITEMS` 的選擇器，再改 fixture。順序不能反。** 它現在是
      `section[aria-label="Tasks"] li` —— 一旦 task 文字裡的子項被渲染成巢狀 `<li>`，那些也會被選中，
      於是既有斷言 `items.length === 3` 變成 4 以上。**症狀是「數字不對」，看起來像 flaky 而不是像
      選擇器選錯了**。改為直接子代鏈（`section[...] > div > ul > li`）或等效寫法，只取 task 那一層
- [x] 3.2 確認 3.1 修改後，**未動 fixture 的情況下**既有三條斷言（進度、分組、已完成可區分）仍然全綠
      —— 這一步是為了讓 3.3 之後的任何紅燈都能歸因於 fixture 而非選擇器
- [x] 3.3 `TASKS` fixture 加入一條**多行** task：第一行 + 一個子項 + 一段含行內程式碼與強調的續行。
      **`TASKS_DONE` / `TASKS_ALL_DONE` 是以 `replace()` 從 `TASKS` 推導的**，改動 `TASKS` 時要確認
      那兩個 replace 的目標字串仍然命中（否則會靜默地得到與原本相同的字串，而「勾完」那幾條斷言
      會以「沒有變化」的方式失敗）
- [x] 3.4 進度斷言 `progress?.max === 3` 隨 fixture 的 task 總數更新

## 4. 驗收 —— 新的呈現行為（spec: openspec-panel）

- [x] 4.1 斷言多行 task 的子項呈現為清單項目：該 task 的節點內存在巢狀 `<li>`
      〔scenario「項目的續行不被摺成單一行」〕
- [x] 4.2 斷言行內標記被渲染：該 task 的節點內存在 `<code>` 與 `<strong>`，且其文字**不含**反引號或
      星號〔scenario「項目文字中的行內標記被渲染」〕
- [x] 4.3 斷言已完成的多行 task 其刪除線涵蓋整段（含渲染出的子元素）
      〔scenario「多行項目仍可區分完成狀態」〕
- [x] 4.4 **對照組**：把 2.3 退回 `<span>{task.text}</span>`，確認 4.1 與 4.2 變紅，再還原。
      這是唯一能證明這幾條斷言真的在看渲染結果的方法
- [x] 4.5 新增或調整的斷言一律以 `role` / `aria-label` 定位，**不得為驗收在產品 UI 上掛 `data-*`**

## 5. 文件

- [x] 5.1 CLAUDE.md 第 151 行「**兩者必須同時升**」改寫為條件式：規則是**升級時檢查 peer 是否仍被
      滿足**。原句的成因是 `ui@1.2.0` 的 peer 要 `core >=1.3.0` 而當時 core 是 1.2.0；本次
      core 1.3.0 → 1.6.0 而 ui 不動，正是不必同升的反例。**照字面留著，下一個人會做一次沒必要的
      升級，或以為升不了 core 而放棄**
- [x] 5.2 CLAUDE.md 第 523 行的「（兩者必須同時升，檢查清單在那裡）」同步改寫 —— 它是 5.1 那句的
      轉述，兩處分歧的話等於沒改
- [x] 5.3 CLAUDE.md 中 core 版本宣告的敘述（`^1.3.0`）更新為 `^1.6.0`
- [x] 5.4 `docs/lessons/side-panel.md` 補一條：`TaskItem.text` **可能是多行 markdown**（core 1.4.0
      起），以及它為什麼必須走 `MarkdownView` 而不是自己渲染。這條的觸發器是「動側欄的 tasks 呈現」，
      依 CLAUDE.md 開頭的判準屬於 lessons 而非 CLAUDE.md 本身

## 6. 收尾

- [x] 6.1 `npm run typecheck` 與 `npm run lint`（**不要跑 prettier**）
- [x] 6.2 `npm test`
- [x] 6.3 `npm run probe:openspec`
- [x] 6.4 `npm run measure:bundle` —— 確認 renderer bundle 沒有因為新的 markdown 呼叫點而出現
      非預期的產物（該腳本在產物出現語言服務 worker 時以非零碼結束）
- [x] 6.5 `npm run test:e2e` 全套（封存前）。**版面會因為一行變一段而改變**，而以真滑鼠座標點擊的
      探針對版面敏感 —— 若出現時綠時紅，第一嫌疑是版面而不是時序（design Risks）。
      **結果：865 綠 / 8 紅，而 8 紅全部與本 change 無關且已歸檔** —— 2 條是殘留行程抓著 debugging
      port 造成的假紅（**issue #18**，清除後 `probe:workspace` 97/97 全綠），其餘 6 條加上先前
      未列的 1 條共 7 條為 dev 模式的既有穩定失敗（**issue #19**，已跑 baseline 對照：`git stash`
      到 HEAD 後 `probe:openspec` / `probe:keyboard` / `probe:terminal` 原樣重現）。
      本 change 新增的三條斷言在兩個模式下皆綠，且已做對照組（退回 `<span>` 後全紅）
- [x] 6.6 **實機驗收**：起 dev、開本 repo 兩個 active change 的 tasks 分頁確認呈現。
      實測 `artifact-order-resilience`（40 條）渲染出 **91 個行內程式碼、33 個強調**，多行續行
      正確接續；巢狀清單項目為 0 —— 符合預期（本 repo 的續行是 lazy continuation，依 CommonMark
      併為同一段落，`- ` 子項才會成為清單，probe fixture 涵蓋後者）
