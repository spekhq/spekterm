## Why

`@spekjs/core` 已發佈到 **1.6.0**，而本 repo 宣告的是 `^1.3.0`（實際安裝 1.3.0）。要升級有一個直接的
理由與一個被擋住的理由：

1. **1.6.0 帶來 `sortArtifacts`** —— artifact 排序的權威實作，就住在 `@spekjs/core/artifact-order`
   這個 node-free subpath 上。`artifact-order-resilience`（側欄 artifact 分頁順序反了）**整個被它擋著**：
   那個 change 的核心決定是「敘事順序要取自資料來源公佈的常數與規則，不在本 repo 另寫一份」，
   而在 1.6.0 之前，core 只給了常數、沒給規則。
2. **1.4.0 已經改了 `parseTasks` 的語意，而我們還沒吸收它。** 這不是升級的副作用，是升級的**工作本身**。

**第 2 點會讓側欄變糟，若只改版本號而不動渲染。** 實測 1.6.0：

```
parseTasks("- [ ] 1.1 First line\n      a continuation line")
  → text: "1.1 First line\n    a continuation line"
```

`TaskItem.text` 現在保留續行（換行 + 縮排）。而 `ChangeView.tsx:369` 是
`<span className="min-w-0">{task.text}</span>` —— **純文字渲染，HTML 會把換行摺成一個空格**。
於是一條帶子項的 task 會變成一長串黏在一起的字，縮排消失。

**而這個 repo 自己的 `tasks.md` 幾乎每一條都有續行**（本檔案所屬的 change 也不例外），所以升級當下，
側欄那塊「使用者一邊駕駛 agent 一邊盯著的主要閱讀內容」（CLAUDE.md 對 tasks 分頁的定位）會立刻退化。

現在做，是因為 ①（core 上移 `sortArtifacts`）剛發版完成，而 ③ 等著它。**刻意與 ③ 分開**：
升級的風險面（`parseTasks` 語意改變）與排序修正毫無關係，混在一起出事時分不清是誰造成的。

## What Changes

- **`@spekjs/core` 的依賴宣告自 `^1.3.0` 提升至 `^1.6.0`**，並安裝之。
- **tasks 分頁改為呈現多行的 task 文字**，不再讓續行被摺成空格。呈現方式（保留換行 vs. 當 markdown
  渲染）留給 design 裁決 —— 上游 spek 的 web 選了 markdown，而側欄寬度受限，兩者取捨不同。
- **`@spekjs/ui` 不動。** 已驗證其 peer 為 `@spekjs/core: >=1.3.0`，1.6.0 仍滿足。
- **CLAUDE.md 的「兩者必須同時升」修正措辭** —— 那句話的成因是 ui@1.2.0 的 peer 要 core>=1.3.0
  而當時 core 是 1.2.0，**規則其實是「升級時檢查 peer 是否仍被滿足」**。照字面讀會讓人以為每次升 core
  都得動 ui，而這次正是不必動的例子。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `openspec-panel`：「tasks 分頁呈現進度與分組的項目」—— 補上 task 文字可能是**多行**的行為條款。
  現行條文只談分組與完成狀態，對文字的呈現沉默，於是「摺成一行」與「保留換行」都不違反它。

## Impact

**依賴**

- `package.json`：`@spekjs/core` `^1.3.0` → `^1.6.0`。**同時吃進 1.4.0 與 1.5.0** ——
  1.4.0 是續行保留（本 change 要處理的），1.5.0 是 `parseTasks` 的行尾與空白邊界改依 CommonMark
  （lone `\r` 現在算行尾；只有空白與 tab 算空行）。後者對使用一般 `\n` 的檔案輸出完全相同。
- **`@spekjs/ui` 維持 1.2.0**，且升級後要確認 npm 仍 dedupe 成同一份 core（樹上兩份 core 會讓套件
  眼中的 `ChangeInfo` 與我們的成為兩個型別）。

**程式碼**

- `src/renderer/src/shell/openspec/ChangeView.tsx` 的 `TaskList` —— 文字呈現，以及 `key={task.text}`
  是否仍合適（text 的形狀變了）。
- 依 CLAUDE.md 的升 core 檢查清單，其餘三條已先驗過，**都不受影響**：主行程沒有自己建構 core 的型別
  （`Omit<ChangeInfo, 'source'>` 原封流穿）、已使用聚合 API、無任何 spec 或程式碼寫死 core 版本號。

**不影響**

- `spek-core-integration` 的任何條款 —— 它要求語意化版本與非本機協定，兩者升級後皆維持。
- 檔案系統邊界、IPC 詞彙、pty —— 這個 change 不碰它們。

**解鎖**

- `artifact-order-resilience`（③）在本 change 完成後才能開始實作。
