## 1. 升級套件

- [x] 1.1 `@spekjs/core` 升至 `^1.3.0`、`@spekjs/ui` 升至 `^1.2.0`（`npm install`，lockfile 一併進版控）
- [x] 1.2 確認 npm 把 core **dedupe 成同一份** —— `@spekjs/ui` 對 core 是 peer 依賴，樹上若同時存在兩份，`SpecGraph` 眼中的型別與我們的就是兩個不同的型別（CLAUDE.md 既有紀律）。注意 **1.2.0 的 peer 已是 `>=1.3.0`**（不是 CLAUDE.md 記的 `>=1.0.0`），因此兩個套件必須**同時**升，分兩次會 ERESOLVE

## 2. 正規化移至主行程

- [x] 2.1 `getGraphData` 改用 `changeNodeSlug`（`@spekjs/core/graph-node-id`）—— **在剝除 `source` 之前**完成正規化，那時判準所需的 `source.key` 還在。**它回傳的是 slug 不是識別碼**：新 id 為 `` `change:${changeNodeSlug(node)}` ``，且**只對 `node.type === 'change'` 施加**（見 design D2 的但書 —— 直接拿回傳值當 id 會產生裸 slug，而那個錯誤在 Timeline 與 Graph 上都「正常運作」）
- [x] 2.2 以節點建「舊識別碼 → 新識別碼」的映射，再據以改寫 **edges 的兩端**（design D3 —— 只換節點會使 `changeTopicsMap` 的查表全數落空，症狀與完全沒換相同）
- [x] 2.3 更新 `getGraphData` 的註解：說明「為什麼正規化必須發生在剝除來源之前」，以及那兩件事是同一件事的兩面

## 3. 刪除 renderer 的適配層

- [x] 3.1 `VizOverlay.tsx` 刪除 `withPlainChangeIds` / `plainChangeId` / `CHANGE_PREFIX` 與其註解，`buildLanes` 直接吃 `graph.data`
- [x] 3.2 一併移除因此不再需要的 `GraphData` type import

## 4. 驗收

- [x] 4.1 單元測試：擴充既有的「關係圖不洩漏路徑」為一併驗識別碼形狀 —— change 節點的識別碼為 `change:<slug>`（**非裸 slug、亦不含來源識別碼**）、節點無來源資訊、**每條邊的 change 端都對得到節點**（**只驗 change 端**：spec 端的懸空邊是掃描結果的既有性質，見 spec 的但書）
- [x] 4.2 **對照組**：只還原節點而不還原邊時，該測試必須變紅（否則 4.1 對 D3 那半沒有鑑別力）
- [x] 4.3 `npm run typecheck` 與 `npm test` 全綠
- [x] 4.3b 單元測試：**非聚合** repo 的節點識別碼仍為 `change:<slug>`（回歸 —— 那條路徑上 `source` 本來就不存在，正規化必須是 no-op）
- [x] 4.4 **`probe:openspec` 新增一條**（design D5）：於**聚合 fixture** 開啟 Graph、點一個來自 worktree 的 change 節點，斷言錨定的 slug **不含來源識別碼**。既有的 Graph 點擊斷言跑在單一工作目錄的 fixture 上，聚合 fixture 只開過 Timeline —— 這條缺口是真的，且**在改動前必定紅**（那是它唯一的存在理由）
- [x] 4.5 `npm run probe:openspec` —— 既有的「聚合後 Timeline 仍依 topic 分組」是**回歸守衛**（它問的是行為不是實作位置，新舊實作都該通過），本 change 的**證明**是上面 4.4 那條

## 5. 文件

- [x] 5.1 `CLAUDE.md` 修正那張「`SpecGraph` 剝掉 key／`buildLanes` 不剝」的對照表 —— **漏了條件**：`SpecGraph` 是**當 `node.source` 存在時**才剝，而我們是唯一刻意剝掉 `source` 的宿主，於是那一列**對我們恰好是假的**（這正是 C1 沒被前一個 change 發現的原因）。一般形式：**依賴 optional 欄位的判定，在「刻意移除該欄位」的宿主眼中會反轉；抄別人的行為表時要連 guard 一起抄**
- [x] 5.2 `CLAUDE.md` 的 core／ui 版本敘述更新（含 peer 已是 `>=1.3.0`），並記下結構性收穫：**產生格式與解析格式應當同居**（upstream #25 → #28 的因果），以及「一個 downstream 正要手寫第二份，就是它放錯位置的訊號」
