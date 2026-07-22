## Why

`openspec-worktree-aggregation` 為了讓 Timeline 的「依 topic 分組」在聚合後仍然有效，在 **renderer**
加了一層識別碼正規化（`VizOverlay` 的 `withPlainChangeIds`）—— 把 `change:<worktreeKey>:<slug>`
換回 `change:<slug>`，因為 `@spekjs/ui` 的 `buildLanes` 不剝那個 key。

**upstream 已經修好了**（[spekhq/spek#25](https://github.com/spekhq/spek/issues/25)，`@spekjs/ui@1.1.0`
抽出 exported 的 `changeNodeSlug()`）。但**升級並不能讓我們把那層拿掉**，因為新 helper 是這樣判定的：

```ts
const key = node.source?.key
if (key && rest.startsWith(`${key}:`)) return rest.slice(key.length + 1)
```

它要靠 **`node.source.key`**，而我們的 `getGraphData` **刻意剝掉 `source`** —— 那是同一個 change
修掉的一條路徑洩漏（core 會把含絕對路徑的 `WorktreeSource` 掛在每個 change 節點上）。實測：

| 送進 `changeNodeSlug` 的節點 | 回傳 |
|---|---|
| core 原樣（帶 `source`） | `my-change` ✓ |
| **我們送出的（已剝 `source`、未正規化）** | **`c5ec24d6:my-change`** ✗ |
| 我們送出的（已剝 `source`、已正規化） | `my-change` ✓ |

**所以真正該改的不是「拿掉」，是「搬家」。** 目前的正規化在 renderer —— 那裡 `source` 已經被剝掉，
只能**切第一個 `:`** 去猜。upstream 的 design 正好點出這個作法的弱點：

> the id alone is ambiguous — nothing distinguishes a worktree key from the head of a slug

而**主行程手上就有 `source.key`**，可以精確剝除。把正規化搬到那裡，renderer 那一層就整個不需要了。

實務上那個切法不會出錯（OpenSpec 的 slug 是 kebab-case，不含 `:`），所以就 Timeline 而言，
搬家只是**把一個靠慣例成立的推測，換成一個靠資訊成立的判定**。

**但獨立稽核發現：Timeline 不是唯一的消費端，而另一個消費端現在是壞的。**

`VizOverlay` 只把正規化過的圖餵給 `buildLanes`；**`SpecGraph` 拿的是未正規化的那一份**。
而它的剝除是**條件式地**依賴 `source`（`SpecGraph.js:148`）：

```js
else if (d.source) { const slug = d.id.slice(`change:${d.source.key}:`.length); … }
else { onSelectChangeRef.current?.(d.id.replace(/^change:/, "")) }   // ← 我們走這條
```

我們剝掉了 `source`，於是點一個 change 節點得到的是 **`a512de39:my-change`** —— 一個不存在的
slug。它會被 `viewInOpenSpec` 拿去錨定，並**寫進 `sessions.json` 的 `anchoredChange` 跨重啟存活**。

這直接違反既有規格 `openspec-panel`「於 Graph 中觸發一個 change → 該 change 成為側欄呈現的
change」，而且**升 `@spekjs/ui` 修不了它**：1.2.0 改用 `changeNodeSlug(d)`，而該函式對「無
`source` 但 id 帶 key」的節點回傳的正是上表第二列那個錯誤值。**唯一的修法就是在主行程正規化。**

**所以本 change 是一個 bug fix，不是純 refactor** —— 而它修的那條路徑正落在「每個 change 一個
worktree」的工作流上。

**而「搬到主行程」原本要付一份自己手寫的解析** —— `changeNodeSlug` 當時住在 `@spekjs/ui`，
那個套件沒有 subpath export，唯一入口會拉進 JSX／d3／React，主行程碰不得。
**這一點已回報並由 upstream 解決**（[spekhq/spek#28](https://github.com/spekhq/spek/issues/28)）：
`changeNodeSlug` 移到了**產生該格式的地方**（core，`scanner.ts` 隔壁），並以 node-free subpath
`@spekjs/core/graph-node-id` 出貨（比照既有的 `./headings`、`./artifact-order`）；ui 改為從那裡
消費並原樣 re-export。**於是主行程直接 import 即可，不必再自己寫一份。**

## What Changes

- **`@spekjs/core` 升至 `^1.3.0`、`@spekjs/ui` 升至 `^1.2.0`**（本 repo 目前是 `^1.0.1`，
  故 ui 是 1.0.1 → 1.2.0，**跳過 1.1.0**）。core 的升級是**純新增**（`types.d.ts` 零差異，
  `index.d.ts` 只多一行 export，`scanner.js` 逐位元組相同 —— 已逐檔比對）。
  **兩者必須同時升**：`@spekjs/ui@1.2.0` 的 peer 已是 `@spekjs/core >=1.3.0`，分兩次升會 ERESOLVE。
- **關係圖的識別碼正規化移至主行程**，並**直接採用 core 的 `changeNodeSlug`**
  （`@spekjs/core/graph-node-id`）—— `getGraphData` 在剝除 `source` **之前**完成正規化，
  那時 `source.key` 還在。**不自己實作解析。**
- **`VizOverlay` 的 `withPlainChangeIds` / `plainChangeId` 整層刪除**（含它們的註解與
  `GraphData` 的 type import）。
- **識別碼的形狀成為明文契約**：送往 renderer 的關係圖，其 change 節點識別碼一律為非聚合形式。
  此前這只是實作巧合；而它是**承重的** —— renderer 收不到 `source`，無法自行還原。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `worktree-aggregation`: 「視覺化的既有行為不因聚合而退化」新增識別碼與來源資訊的契約 ——
  關係圖的 change 節點識別碼 SHALL 為非聚合形式、SHALL NOT 附帶來源工作目錄的資訊。
  兩者是**同一件事的兩面**：因為不送來源（絕對路徑不出 IPC），所以必須先把識別碼還原；
  規格不寫明的話，下一個人可以合理地只做其中一半，而失效方式是**分組靜默全部落到「無 topic」，
  圖照樣畫得出來**。

## Impact

**程式碼**

- `package.json` / `package-lock.json` — `@spekjs/core` 與 `@spekjs/ui` 版本。
- `src/main/openspec-service.ts` — `getGraphData` 的正規化。
- `src/renderer/src/shell/openspec/VizOverlay.tsx` — 刪除適配層。
- `src/main/openspec-service.test.ts` — 既有「關係圖不洩漏路徑」那條擴充為一併驗識別碼形狀。

**驗收**

`probe:openspec` 已有「聚合後 Timeline 仍依 topic 分組」，它同時覆蓋新舊兩種實作位置 ——
那條斷言問的是行為，不是實作在哪。

**但它守不到本 change 真正修好的那件事。** Graph 的點擊斷言目前跑在單一工作目錄的 fixture 上，
聚合 fixture 只開過 Timeline。因此**必須新增一條**：於聚合 repo 的 Graph 點一個 change 節點，
斷言錨定的 slug 不含來源識別碼。**這條在改動前必定紅** —— 是本 change 唯一有鑑別力的新驗收，
而一個沒有驗收的修正在這個 repo 已經有兩次前例（OSC 8 `linkHandler`、wake 的 resize）。

**風險**

低。`@spekjs/ui` 的變動集中在 `changeNodeSlug` 的抽出、改為自 core 消費、以及發佈產物的
Node ESM 修正；`@spekjs/core` 的變動是新增一個 node-free subpath。**我們送出的識別碼在搬家後
是無 key 的形式**，`SpecGraph` 與 `grouping` 兩條路徑都走 guard 的否定分支，得到正確的 slug
（已實測冪等：帶著 `source` 的已正規化識別碼也回傳正確的 slug）。
注意 `changeNodeSlug` 回傳的是**剝掉 `change:` 之後的 slug**，不是「原樣的識別碼」—— 見 design D2。
