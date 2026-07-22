## Context

`getGraphData`（`src/main/openspec-service.ts`）目前這樣送出關係圖：

```ts
const graph = await this.#read(() => buildGraphDataAggregated(root, { includeJj: false }), …)
return {
  nodes: graph.nodes.map(({ source: _source, ...node }) => node),   // 剝掉含絕對路徑的來源
  edges: graph.edges,                                               // 識別碼原樣（仍帶 worktree key）
}
```

而 renderer（`VizOverlay`）在餵給 `buildLanes` 之前，用 `plainChangeId()` 把 `change:<key>:<slug>`
切成 `change:<slug>` —— **靠切第一個 `:`**，因為那裡已經拿不到 `source`。

`@spekjs/ui@1.1.0` 抽出了 `changeNodeSlug()`，但它以 `node.source?.key` 判定是否有 key。
**我們送出的節點沒有 `source`**，所以升級之後那個 helper 對我們的圖仍然無效（實測見 proposal）。

其後 upstream 又動了一次（[#28](https://github.com/spekhq/spek/issues/28)）：`changeNodeSlug`
移到 **core**（產生該格式的地方）並以 node-free subpath `@spekjs/core/graph-node-id` 出貨，
ui 改為自它消費並原樣 re-export。**於是主行程 import 得到它了** —— 這改變了本設計的 D2。

**而獨立稽核指出：現況不只是「不夠漂亮」，是壞的。** `VizOverlay` 只把正規化過的圖餵給
`buildLanes`，**`SpecGraph` 拿的是未正規化的那一份**；它的剝除條件式地依賴 `source`
（`SpecGraph.js:148` 的 `else if (d.source)`），而我們把 `source` 剝掉了。於是聚合 repo 裡點一個
change 節點會錨定 `<key>:<slug>` —— 一個不存在的 change，且會寫進 `sessions.json` 存活。
**本 change 因此是 bug fix**（詳見 proposal 的 Why）。

## Goals / Non-Goals

**Goals:**

- 正規化發生在**握有 `source.key`** 的地方，不再靠字串切割推測。
- renderer 不再需要知道識別碼的格式。
- 「識別碼形狀」與「不附來源」成為明文契約，而不是實作巧合。

**Non-Goals:**

- 不改變任何使用者可見的行為（Timeline 分組、Graph 的節點與邊都不變）。
- 不把 `source` 送給 renderer（那正是 `openspec-worktree-aggregation` 修掉的路徑洩漏）。
- 不改變 `getGraphData` 之外的任何 core 用法（升級是為了那個 subpath，不是為了新功能）。

## Decisions

### D1：正規化搬到主行程，而不是拿掉

升級後**仍然需要正規化** —— 不是因為 upstream 沒修好，而是因為我們刻意不送 `source`，
於是 upstream 的 helper 在我們這裡拿不到判定所需的資訊。

**兩邊的解法互補，不重複**：upstream 服務的是「拿到完整節點」的宿主；我們是「刻意剝掉來源」的宿主。

**替代方案（否決）**：把 `source` 送給 renderer，讓 `changeNodeSlug` 自己剝。**這會重新引入
路徑洩漏** —— `WorktreeSource.path` 是絕對路徑，而 `openspec-data-access` 明文禁止它進 DTO。
若只送 `key` 而不送 `path`，那已經不是 core 的 `WorktreeSource` 了，`changeNodeSlug` 的型別對不上，
且我們等於在 IPC 上多開一個只為了讓 renderer 做一件主行程更適合做的事的欄位。

### D2：直接採用 core 的 `changeNodeSlug`，不自己寫一份

本設計初稿的結論是「主行程自己寫一個小函式」，理由是 `changeNodeSlug` 當時住在 `@spekjs/ui`，
而那個套件沒有 subpath export、唯一入口會拉進 JSX／d3／React —— 主行程碰不得。

**那個限制的根因不是 exports 開太少，而是解析放錯了套件**：識別碼格式由 **core** 產生
（`scanner.ts` 的 `change:${slug}` 與 `change:${wt.key}:${slug}`），解析卻住在 ui。
**產生與解析分居兩個套件**，正是 [#25](https://github.com/spekhq/spek/issues/25) 的溫床 ——
core 開始加 worktree key，ui 的解析沒跟上，沒有任何東西會紅。

已回報並由 upstream 採納（[#28](https://github.com/spekhq/spek/issues/28)）：現在它是
**`@spekjs/core/graph-node-id`**，與 `scanner.ts` 同居，比照 core 既有的 `./headings` 與
`./artifact-order`。因此：

```ts
import { changeNodeSlug } from '@spekjs/core/graph-node-id'
```

**已實測**（純 Node 環境，等同主行程）：subpath import 成功、只 export 那一個函式（不帶
React／d3）、四種節點形狀行為正確 —— 含**冪等**（已正規化但仍帶 `source` 的節點回傳正確 slug，
那是 upstream 那個 `startsWith` guard 的作用）。

> **它回傳的是 slug，不是識別碼。** `changeNodeSlug({id:'change:c5ec24d6:x', source:{key:'c5ec24d6'}})`
> 回 `'x'`（**沒有 `change:` 前綴**），而 `spec:auth` 這種非 change 節點**原樣**回傳 `'spec:auth'`。
> 因此新識別碼是 `` `change:${changeNodeSlug(node)}` ``，且**只對 `node.type === 'change'` 施加** ——
> 一律套用會把 `spec:auth` 變成 `change:spec:auth`，而直接把回傳值當 id 用則會產生裸 slug 的節點。
>
> **裸 slug 那個錯誤特別危險**：`changeTopicsMap` 與 `SpecGraph` 對它**仍然運作正常**
> （`changeNodeSlug('x')` 回 `'x'`），Timeline 分組照樣是綠的 —— 只有 `probe:openspec` 那條
> 以 `change:<slug>` 定位節點的斷言抓得到它，而那要付十幾分鐘。

**這比自己寫嚴格更好**，而不只是少寫幾行：解析與產生從此同源，core 若再改格式，兩邊在同一個
套件裡；而我們手寫的版本會是第三份各自過期的副本。

> 順帶：ui 的發佈產物此前**不是合法的 Node ESM**（extensionless 相對 specifier），
> 因為所有消費端都經 bundler 而三個版本無人發現。那是同一次修的（upstream #27），
> 也是我們實測 `import('@spekjs/ui')` 時撞到的 `ERR_MODULE_NOT_FOUND`。

### D3：`edges` 的端點必須跟著換 —— 而它的欄位名叫 `source`，與來源無關

`GraphEdge` 是 `{ source: string; target: string }`，那是**邊的兩端**；`GraphNode.source` 是
**worktree 來源**。兩個 `source` 在同一段程式碼裡出現，改動時極容易看混。

`changeTopicsMap` 是**先用 edge 的端點查 node、再讀 `node.id`** —— 只換 nodes 而不換 edges，
查表就全部落空（與修好前的症狀一模一樣：分組靜默全落到「無 topic」，圖照樣畫得出來）。

作法是先從 nodes 建一份「舊識別碼 → 新識別碼」的映射（**只有 nodes 握有 `source.key`**），
再用它改寫 edges 的兩端。

### D4：契約寫進 spec，因為它是承重的且失效無聲

`worktree-aggregation` 目前只說「視覺化的既有行為不因聚合而退化」，沒說**憑什麼**。
本 change 把兩件事寫成明文：送往 renderer 的關係圖，其 change 節點識別碼為**非聚合形式**，
且**不附帶來源工作目錄的資訊**。

**它們是同一件事的兩面**：因為不送來源，所以必須先還原識別碼。規格不寫的話，下一個人可以
完全合理地只做其中一半 —— 例如讀到 upstream 已修，就把正規化拿掉。而失效方式是無聲的
（分組全落到「無 topic」，圖照樣畫得出來），這個 change 自己就是被這個形狀咬過的。

### D5：驗收要加的是 **Graph 的點擊**，不是 Timeline 的分組

Timeline 那條（`probe:openspec` 既有）問的是行為、不是實作位置，因此新舊實作都會過 ——
它是**回歸守衛**，不是本 change 的**證明**。

真正該加的是：於**聚合 fixture** 的 Graph 點一個 change 節點，斷言錨定的 slug 不含來源識別碼。
現有的 Graph 點擊斷言跑在單一工作目錄的 fixture 上（`repo-single`），聚合 fixture 只開過
Timeline —— 所以這條缺口是真的，而它**在改動前必定紅**。

**一個沒有驗收的修正，在這個 repo 已經有兩次前例**（OSC 8 `linkHandler`、wake 的 resize），
兩次都只能靠 code review 承擔。這一條驗得到，就不該讓它變成第三次。

## Risks / Trade-offs

- **只換 nodes 忘了換 edges** → 分組靜默失效。**Mitigation**：D3 的映射作法讓兩者同源；
  `probe:openspec` 的「聚合後 Timeline 仍依 topic 分組」對此有鑑別力（已於前一個 change 驗證
  —— 沒有正規化時它會紅）。

- **升兩個套件的其他變動** → 已逐檔比對：`@spekjs/core` 1.2.0 → 1.3.0 的 `types.d.ts`
  **零差異**、`index.d.ts` 只多一行 export（純新增）；`@spekjs/ui` 的變動集中在 `changeNodeSlug`
  改為自 core 消費、以及發佈產物的 Node ESM 修正。**我們送出的識別碼在搬家後是無 key 的形式**，
  `SpecGraph` 與 `grouping` 兩條路徑都走 guard 的否定分支、原樣回傳。
  另已 grep 確認我們**不自己建構** core 的型別（`WorktreeInfo` / `WorktreeSource` 只在註解出現），
  因此 CLAUDE.md 記載的「minor 版號卻破壞型別」那類風險碰不到。

- **~~搬家不修任何 bug~~ —— 這個初稿判斷是錯的**：它修好 `SpecGraph` 在聚合 repo 上錨定到
  不存在 slug 的缺陷（見 Context）。就 Timeline 而言確實只是把「靠慣例的推測」換成「靠資訊的
  判定」，但 Graph 那條是真的壞著。**因此驗收義務也隨之改變**（見 D5）。

- **正規化移除了唯一能區別同名節點的資訊，節點識別碼從「不可能碰撞」變成「倚賴慣例」** →
  已逐條追過 core 的去重保證：archived 全域依 slug 去重、active 的 git 選舉保證每個 slug 恰一個
  勝出者、jj 那條我們以 `includeJj: false` 完全不觸及 —— **正常情況下不會碰撞**（稽核以三 change
  ／兩 worktree 的 fixture 實測確認）。**縫在跨清單**：主 spec 自己明文「同一個 slug 可能同時出現
  於 active 與 archived」，而 archived 的 slug 就是 archive 目錄名。OpenSpec 慣例的
  `YYYY-MM-DD-` 前綴使它不會撞到 active —— **那是慣例，不是保證**。影響有限（d3 的 id map 與
  `nodeById` 都是後者覆蓋前者，畫面上多一顆重複節點），且**現況帶著 key 沒有這個問題**。
  接受並記錄，不為此改實作。

## Migration Plan

無資料遷移、無持久化格式改變、無 IPC 形狀改變（`GraphData` 的欄位不變，只有 change 節點的
識別碼字面值改變，而它此前就已經被 renderer 正規化成同樣的形式）。

回退即把 `withPlainChangeIds` 放回 `VizOverlay` 並移除主行程的正規化。

## Open Questions

無。
