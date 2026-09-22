## 1. 實作

- [x] 1.1 `src/renderer/src/index.css`：在 `.markdown-dense` 的規則附近加上
      `.task-done .markdown * { color: inherit; }`，並附註解說明**為什麼是 `*` 而不是列舉
      `strong, a`**（列舉是白名單 —— 同一份 `index.css` 裡 `h1..h4` / `blockquote` / `th`
      也自帶顏色，而 design 第一版的清單就漏了這三條）、**為什麼不用 `[&_*]:text-inherit`**，
      以及**這條規則不得被收進 `@layer`**（勝負來自 unlayered，見 design D2）。
- [x] 1.2 `src/renderer/src/shell/openspec/ChangeView.tsx`：已完成的 task `<li>` 加上
      `task-done`（與既有的 `text-ink-faint line-through` 同一處），未完成的列不加；
      留一句註解指向 `index.css` 的那條規則。**不動 `TaskMark`** —— 完成標記維持 `text-green`。
- [x] 1.3 `npm run typecheck`、`npm run lint`、`npm test` 全綠。（**1.1 只改 CSS，這三者都不會
      因它而紅** —— eslint 的 `files` 只涵蓋 `.ts/.tsx` 與 `scripts/**/*.mjs`。這一步是回歸防護，
      不是 1.1／1.2 的驗證；那兩步的驗證在 §2 與 1.4。）
- [x] 1.4 `npm run dev` 實際開啟一個已封存 change 的 tasks 分頁，確認：已完成項目的文字通篇
      只有一種前景色（粗體、連結、BDD 標示都不再跳出來）、**完成標記仍是綠的**、未完成項目與
      proposal／design／spec deltas 分頁、agent 對話 view 皆未改變。

## 2. 驗收載體（`scripts/probe-openspec.mjs`）

- [x] 2.1 `TASKS` fixture 的 task 1.1（已完成那條）補一個**外部連結**與一個 `**SHALL**`。
      確認既有三條斷言不回歸（`codeMarks.includes('docs/api.md')`、`strongMarks.includes('務必')`、
      `!text.includes('**')` 與 `!text.includes('\`')`），且 `PROGRESS` 的 1/3 與 `TASK_SECTIONS`
      不受影響。
- [x] 2.2 `TASK_ITEMS` 增加欄位：該 `<li>` 的 computed `color`、其 `<strong>` / `<a>` / BDD 標示的
      computed `color`，以及完成標記 `<svg>` 的 computed `color`。**`querySelector` 的結果要
      guard `null`** —— fixture 的 1.2／2.1 沒有 `strong`，不 guard 會讓整個 `evaluate` throw。
      沿用既有的直接子代鏈選擇器。
- [x] 2.3 新增斷言「已完成 task 的行內標記與內文同色」—— `<strong>`、`<a>`、BDD 標示三者的
      computed color 皆等於該 `<li>` 的 computed color。
- [x] 2.4 新增斷言「已完成與未完成的內文顏色不同」。**這條不是裝飾**：少了它，一個把整份清單都
      畫成 `ink-faint` 的實作會讓 2.3 全綠。
- [x] 2.5 新增斷言「完成標記不隨文字淡化」—— 已完成 task 的標記 computed color 仍為
      `--color-green`。
- [x] 2.6 2.3–2.5 **必須插在 `probe-openspec.mjs:2006` 之前** —— 那一行寫入 `TASKS_DONE` 把 1.2
      也勾掉，之後就沒有未完成的列可以當 2.4 的參照物了。
- [x] 2.7 對照組逐條驗過，確認三條都有鑑別力：刪掉 1.1 的 CSS 規則 ⇒ 2.3 紅；把未完成的 `<li>`
      也改成 `text-ink-faint` ⇒ 2.4 紅；把規則的作用域由 `.markdown *` 放寬成 `.task-done *`
      ⇒ 2.5 紅。驗完把 mutation 還原。
- [x] 2.8 `npm run probe:openspec` 全段綠。

## 3. scenario → 載體對照表（`scripts/scenario-coverage.test.mjs`）

- [x] 3.1 把 `task-completion-dimming` 加進 `COVERED_CHANGES` —— 少了它，「每一條 scenario
      在表上恰有一列」的守衛會對本 change 完全沉默。
- [x] 3.2 為本 change delta 裡的**全部八條** scenario 各填一列（MODIFIED 整條搬過來，五條既有的
      也會被掃到）。既有那五條**必須真的把斷言找出來**才填，找不到就寫「無載體」＋理由，不憑印象
      填「既有」。每列附 `greenIfAbsent` 與 `mutation`。
- [x] 3.3 `npm test` 綠。表的守衛有三道：每條 scenario 恰有一列、每個載體標籤在原始碼中**至少**
      命中一處（判準是「至少」而非「恰好」，見該檔註解）、`greenIfAbsent` 為 true 的列必須有
      `mutation` 或 `note`。

## 4. 文件

- [x] 4.1 `docs/lessons/side-panel.md` 的 `TaskItem.text` 那一節補一條 —— **淡化是靠繼承套用到
      整列的，而子元素自己宣告的顏色會贏過繼承**；修正要下在呼叫端而非 `MarkdownView`
      （拿掉 `strong` 的顏色會改到散文，而散文的一般 `strong` 沒有載體）；涵蓋範圍由通用選擇器
      保證而非列舉（`index.css` 裡自帶顏色的不只 `strong` 與 `a`）；**勝負來自 cascade layer
      而非 specificity**，把規則收進 `@layer` 會讓它靜默失效。
- [x] 4.2 `CLAUDE.md` 踩雷指南：該列的觸發器 `src/renderer/src/side-panel/` **路徑是錯的**
      （實際在 `shell/` 之下），且不涵蓋 `shell/openspec/` —— 也就是本 change 動到的檔案。
      改成 `src/renderer/src/shell/side-panel/` 與 `src/renderer/src/shell/openspec/`。
- [x] 4.3 `docs/lessons/side-panel.md` 記下**對比度缺口**：已完成 task 的文字落在 3.06:1，
      低於 WCAG AA 的 4.5:1，也低於上游 spek judged-unacceptable 的 3.24:1；spekterm 目前
      **沒有任何對比度守衛**，這是知情裁決而非疏漏（論證見本 change 的 design D4）。
