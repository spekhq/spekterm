## Context

`OpenSpecService`（`src/main/openspec-service.ts`）目前以 core 的**非聚合** `scanOpenSpec(root)`
為每個 folder 供應資料，`root` 恆為 folder 的路徑。整個類別由三件事貫穿（其 class doc 自己寫著）：
定址只認 `folderId`、`slug`/`topic` 一律查表、快取 + 監看。本 change 要在**不動搖這三條**的前提下，
把掃描的涵蓋範圍從「folder 根目錄」擴為「folder 所屬 repo 的全部 git worktree」。

三個既有的結構事實決定了本設計的形狀：

1. **`#ensureWatch` 發生在掃描之前**（`openspec-service.ts:424`，註解寫著「先訂閱、再掃描」——
   Phase 2 的教訓）。但**要監看哪些 worktree，只有掃描之後才知道**。這是本 change 的核心張力。
2. **DTO 的路徑欄位一律 folder-relative，翻不出來就回 `null`**（design D5）。core 的
   `WorktreeSource.path` 是絕對路徑。
3. **`getChanges` 目前把 core 的陣列原封不動轉手**（`:303`），CLAUDE.md 記為承重的性質 ——
   core 新增欄位會自己流穿到 renderer。

## Goals / Non-Goals

**Goals:**

- 側欄看得見 folder 所屬 repo 全部 git worktree 裡的 change，且每個 slug 只出現一次。
- change 的來源（哪個 worktree／哪個分支）呈現在畫面上，且**不以絕對路徑**表達。
- worktree 位於 folder 邊界外（例如 `/tmp`）時，資料照樣完整，只有「跳到檔案」類入口降級。
- 保留日後接上「聚合範圍的使用者控制」的空間，但本 change 不做該控制。

**Non-Goals:**

- 自行實作 worktree 列舉、去重、分歧判定 —— 那全部在 core，本 change 一行都不寫。
- jj workspace（`includeJj: false`）。
- session 開在 worktree、rail 把 worktree 列為一級項目。
- 讓 renderer 取得 worktree 的詞彙（它仍然只認 `folderId`）。

## Decisions

### D1：聚合的全部語意由 core 決定，本 app 只換函式

`scanOpenSpec` → `scanOpenSpecAggregated`、`buildGraphData` → `buildGraphDataAggregated`。
worktree 列舉（`git worktree list --porcelain`）、active change 的**git 分歧選舉**去重、archived
依 slug 去重、specs 只取主工作目錄、graph 節點的 key 命名 —— 全在 core。

**為什麼不自己列舉**：`git worktree list` 的 porcelain 解析、「相對 main HEAD 是否確實推進」的三點
diff、多個分歧副本的 mtime tiebreak，重寫一次只會得到一個更差的版本，而且從此與 spek 分叉。這與
Phase 5「不要重刻 d3 力導向圖」是同一條判準（**它綁死了版面嗎？沒有 → 重用**）。

**替代方案（否決）**：自己以檔案讀取列舉 worktree（讀 `<gitdir>/worktrees/*/gitdir`），理由是
「不 spawn git」。否決 —— `workspace-folders` 那條 no-spawn 約束的對象是 **rail 的 folder 偵測**
（每個 folder、每次載入都要做的熱路徑判定），而 OpenSpec 的掃描路徑本來就會經 core 的
`getTimestamps` spawn `git log`。把 no-spawn 無差別套用到這裡，換來的是一套與 core 平行、
會靜默分歧的第二實作。

**注意**：`buildGraphDataAggregated` 是 **async**，而非聚合的 `buildGraphData` 是**同步**的。
`#read` 已同時吃兩者，呼叫端不必改結構。

### D2：讀取根由主行程從自己的快取解析，renderer 不需要 worktree 的詞彙

`getChange` / `getSpecAtChange` 目前以 `root` 呼叫 `readChange(root, slug)`。聚合後，change 可能
不在 `root` 底下。

**作法**：`#findChange` 已經是白名單查表（design D6），它回傳的 `ChangeInfo` 在聚合下帶著
`source.path`。讀取根即 `change.source?.path ?? root`。

- **安全性不變**：`source.path` 來自 **core 對 git 的列舉**，不是 renderer 送來的。白名單的語意
  完好 —— renderer 給 slug、主行程查表、表裡那筆決定去哪讀。
- **IPC 形狀完全不動**：不需要 spek web 的 `?wt=<key>` 那層參數。**這比 spek 更緊**：spek web 是
  無狀態 HTTP，client 必須自己帶著來源；我們的主行程持有快取，答案本來就在手上。

**替代方案（否決）**：比照 spek 讓 IPC 收 `worktreeKey`。否決 —— 那會讓 renderer 第一次擁有
「worktree」這個定址維度，而它得不到任何東西（active slug 經選舉後唯一，沒有「同一個 slug 要選
哪個 worktree」的問題）。

### D2b：spec 的讀取根**也**要改 —— `specs` 取自主工作目錄，而 `root` 不一定是它

`scanner.ts:679` 是 `specs: main.scan.specs` —— **spec 一律取自主工作目錄**，與 change 不同。
`getSpecs` / `getSpec` 若沿用 `root`，在兩種情形下會壞（皆已實測）：

| folder 是什麼 | 症狀 |
|---|---|
| 一個 **linked worktree** | 只存在於主工作目錄的 spec 列得出來、**打不開**（`readSpec` 回 `null` → `NOT_FOUND`） |
| repo 的一個 **子目錄** | **每一個** spec 都打不開 |

因此 spec 的讀取根 SHALL 為**主工作目錄**（`result.worktrees` 中 `isMain` 的那筆），而非 `root`。
`getSpecs` 的 `toRelPath` 基準仍是 folder root —— 翻不出來就回 `null`（D6），不因此洩漏路徑。

**「folder 是 repo 的子目錄」帶來一個行為切換，必須明說**：今天這種 folder 的 OpenSpec 是空的
（子目錄下沒有 `openspec/`）。改用聚合之後，**只要該 repo 有 ≥2 個工作目錄**，整個 repo 的
spec 與 change 就會突然出現在側欄 —— 因為 `listWorkspaces` 是對 repo 作答，不是對子目錄作答。

**裁決：接受這個行為，不特別抑制。** 「這個 folder 屬於哪個 repo」本來就是聚合的定義域；而
抑制它需要判斷「root 是不是某個工作目錄的根」，那等於自己重做一次 core 的判定（違反 D1）。
代價是它**取決於 worktree 數**（1 個時看不到、2 個時看得到），這個不一致寫進 Risks，並在
dogfood 時確認是否惱人。

### D3：來源 DTO 叫 `worktree` 而不是 `source` —— 這一個命名同時解決兩個問題

送往 renderer 的 change 摘要定義為：

```ts
type ChangeOrigin = {
  key: string
  branch: string | null
  vcs: 'git' | 'jj'
  /** 是否為該 repo 的主工作目錄 —— **呈現**用（徽章不標示 main，對齊 spek）。 */
  isMain: boolean
  /** 來源工作目錄是否就是這個 folder 本身 —— **能力判定**用（續寫入口的條件 4，D7）。 */
  isFolderRoot: boolean
}
type ChangeSummary = Omit<ChangeInfo, 'source'> & { worktree?: ChangeOrigin }
```

**兩個布林各司其職，不可互相代用**：`isMain` 是來源的**性質**，`isFolderRoot` 是來源與**這個
folder** 的關係。folder 本身就是 linked worktree 時兩者相反（見 D7）。`isFolderRoot` 由主行程
比較 `source.path` 與 `folder.path` 得出 —— renderer 因此不需要路徑就能做能力判定。

三個性質是刻意的：

- **不含 `path`** —— 絕對路徑不出 IPC（既有 D5）。`key` 是 core 算的路徑 sha1 前 8 碼，不可逆、
  不含路徑資訊，足以作為識別碼。
- **`Omit<ChangeInfo, 'source'>` 而非逐欄列舉** —— core 日後新增欄位仍會**自己流穿**到 renderer，
  保住 CLAUDE.md 記為承重的那個性質。本 change 接下的義務因此縮到最小：**只有 `source` 這一個欄位
  需要跟著 core 走**，不是整個 `ChangeInfo`。
- **欄位名不叫 `source`** —— 因為 `Omit` 之後 `source` 屬性不存在，而它在 `ChangeInfo` 裡是
  **optional**，於是 `ChangeSummary` 仍可直接餵給 `@spekjs/ui` 的 `<ChangeTimeline>`（它要的是
  core 的 `ChangeInfo`）。若沿用 `source` 這個名字但換成我們的型別，就會因缺 `path` 而不 assignable，
  Timeline 那條路要多一次剝除。**一個命名選擇省掉一個接縫。**

`vcs` 現階段恆為 `'git'`（`includeJj: false`），帶著它的成本為零，而最終方向要 jj。

### D4：兩層 watcher —— 「先訂閱再掃描」與「訂閱什麼取決於掃描」的調和

`#ensureWatch` 必須在掃描前建立，但 worktree 清單是掃描的產物。拆成兩層（與 `branch-service`
的兩層 watcher 同構 —— 那裡是「監看 folder 根等 `.git` 出現」→「監看 `.git/HEAD`」）：

| | 監看什麼 | 何時建立 | 為什麼 |
|---|---|---|---|
| 基礎層 | folder 的 `openspec/` + **`<gitdir>/worktrees/`** | 掃描**前**（同現況） | 不需要掃描結果就知道要看哪 |
| worktree 層 | 每個 worktree 的 `openspec/` | 每次掃描**完成後**依 `result.worktrees` 同步 | 清單是掃描的產物 |

**`<gitdir>/worktrees/` 這一條是承重的，不是加保險**：worktree 是「先建目錄、再寫 change」。
少了它，一個新建 worktree 的第一次 openspec 寫入**沒有任何 watcher 在場** —— 側欄要等到別的事件
（主 repo 剛好有人改檔）才會醒來。這是個雞生蛋問題，只能由「監看清單本身」打破。

**要監看的是 common dir 底下的 `worktrees/`，不是 gitdir 底下的** —— 這一層差別在
「folder 本身就是一個 linked worktree」時決定生死，而那**正是** `common-openspec-change` 工作流
的產物（proposal 引用的那個）。實測：

```
<worktree>/.git            → "gitdir: <main>/.git/worktrees/<name>"
<gitdir>/worktrees         → 不存在，且永遠不會存在
<gitdir>/commondir         → "../.."  ⇒ <main>/.git      ← 要的是這個
```

`git-branch.ts:31` 現有的 `resolveGitDir()` **只解一層 `gitdir:` 間接**，停在
`<main>/.git/worktrees/<name>`。少了 commondir 那一層，基礎層會 watch 一個**永不存在**的目錄 ——
chokidar 不報錯、不發事件，於是「新建的 worktree 被納入」這條 scenario **靜默失效**。

因此需要一個 `resolveCommonDir()`：讀 `<gitdir>/commondir`（存在時解析為相對於 gitdir 的路徑，
否則 common dir 即 gitdir 自身）。**仍然不 spawn git**（純檔案讀取），等價於
`git rev-parse --git-common-dir`，兩種情形都已實測得到 `<main>/.git`。

**基礎層的 worktree 清單監看要收窄為 `depth: 0` 且只理會目錄的新增與移除**：實測在 worktree 裡
跑一次 `git commit`，`<commonDir>/worktrees/` 底下會產生 3 個事件（`index` / `logs/HEAD` /
`COMMIT_EDITMSG`）。這個 app 的前提是旁邊有 agent 一直在跑 git —— 不收窄的話，**每次 commit 都會
使 OpenSpec 快取失效並重跑一次聚合掃描**（約 175ms）。我們要的訊號只有「多了／少了一個工作目錄」。

> 順帶實測確認：一次聚合掃描**本身**不會在該目錄下產生任何事件，因此沒有「掃描 → 觸發 watcher
> → 再掃描」的回饋迴圈。

**已知窗口（接受）**：掃描開始到 worktree 層建立之間，worktree 的 `openspec/` 變更會落空。緩解是
基礎層仍在（主 repo 與 worktree 清單的變更照樣觸發重掃），且該窗口只有一次掃描的長度。**不以
「掃描前先跑一次 worktree 列舉」消除它** —— 那等於為了關掉一個毫秒級窗口，在每次冷啟動多 spawn
一次 git。

### D5：監看邊界外的 worktree 是允許的，且與 `followSymlinks: false` 不衝突

既有約束：「監看 SHALL NOT 跟隨 symlink 走出 folder 邊界」。它的對象是 **symlink 的展開** ——
一個**不受信任的**、由 repo 內容決定的展開路徑，而且它會把邊界外的檔名經事件推給 renderer
（Phase 2 的實測）。

worktree 的路徑則是**由 git 列舉出來的已知位置**，且**推給 renderer 的只有「該 folder 的 OpenSpec
結構已變更」這一個 folderId** —— 沒有任何路徑經由事件流出。這與 `branch-service.ts:131` 的 HEAD
watcher 是同一個論證（gitdir 常在邊界外，推給 renderer 的只有分支字串），本 change 沿用它。

`followSymlinks: false` 在所有 watcher 上維持不變。

### D6：邊界外 worktree 的降級 —— 延續既有 D5，不新增機制

所有 relPath 的推導（`changeDirRelPath` / `artifactRelPath` / `deltaSpecRelPath`）改為：以**來源
worktree 的絕對路徑**組出候選並 `stat` 確認存在，再以 **folder root** 為基準呼叫 `toRelPath`。

- worktree 在 folder 邊界內（例如 `.claude/worktrees/<slug>`）→ 翻得出 relPath，交叉導覽照常。
- worktree 在邊界外（例如 `/tmp/...`）→ `toRelPath` 回 `null`，「跳到檔案」與「在 Files 中開啟」
  的入口不呈現。change 內容、tasks 進度、spec deltas **完全不受影響**。

這正是既有 D5 的原話：「側欄少一個『跳到檔案』的入口，好過送一個不存在或越界的路徑給 renderer」。
**本 change 不為此新增任何機制**，只是讓既有的降級路徑在一個新情境下被走到。

> **一個承重的前提：`isWithin` 是純字面比較（`fs-boundary.ts:33`），而這裡第一次拿兩個獨立來源
> 的絕對路徑相比。** 今天的 `changeDirRelPath` 是 `path.join(root, rel)`，兩端同源，比不出問題；
> 改用來源工作目錄之後，一端來自 `workspace.json`、另一端來自 `git worktree list`。
> **兩端目前都是 realpath**（`workspace-store.ts:159` 的 `add()` 以 `realpathSync` 正規化；
> git 回的一律是解析過 symlink 的路徑，已實測），所以可直接比較。
> **若日後 workspace 的路徑正規化改變，每一個 change 的「跳到檔案」會同時靜默消失** —— 這條
> 前提要寫在程式碼註解裡，不能只活在這份 design。

### D7：續寫入口對非主工作目錄的 change **停用**（不是消失）—— 沿用既有的第 4 個條件

`artifact-continuation` 把 `/opsx:continue <slug>` 送進 **focused session 的 pty**，而 session 的
cwd 是 folder 根目錄。change 若只存在於某個 worktree，那個指令會在主 repo 執行 —— **agent 找不到
該 change**（或更糟，在主 repo 建出一個同名的空 change）。

**這與該 spec 既有的條件 1 是同一種病**：它已經寫著「側欄來源等於 focused session 自身的 folder」，
理由是「把另一個 repo 的 change 識別碼送進去會查無此 change；而兩個 repo 恰有同名 change 時，agent
會在**錯的 repo** 動手」。worktree 是那個論證的**更細粒度版本** —— 同一個 repo 之內，change 在
worktree 而 agent 站在主工作目錄。

**裁決：新增第 4 個條件「錨定 change 的來源工作目錄，就是該 session 所屬 folder 本身」，並沿用
既有的呈現紀律 —— 停用並說明原因，SHALL NOT 消失。**

**判準不是 `isMain`。** 那是個看起來對、但方向錯的代理：條件 1 的理由是「agent 的工作目錄是它
自己的 repo」，而 session 的 cwd 是 **folder 的根目錄** —— 那**不一定是主工作目錄**。使用者把一個
linked worktree 加進 workspace 時（`common-openspec-change` 工作流的產物），session 的 cwd 就在
那個 worktree 裡，change 也在那裡，`/opsx:continue` **明明會成功** —— 用 `isMain` 判就會把它
錯誤地停用。實測佐證：`listWorkspaces` 從一個 linked worktree 呼叫時，`isMain` 掛在**該 repo 的
主工作目錄**上，傳入的那個 worktree 是 `isMain: false`。

真正要問的是「agent 站的地方，就是 change 在的地方嗎」，而那是 **`source.path === folder.path`**。
renderer 沒有路徑詞彙，因此這個比較由**主行程**在翻譯 DTO 時完成，以布林形式送出（見 D3 的
`isFolderRoot`）。

> **教訓的一般形式：`isMain` 是「來源的性質」，條件 4 要問的是「來源與 session 的關係」。**
> 這與 CLAUDE.md 記載的「別拿 DOM 元素數量當『持有某資源』的代理判準」同型 —— 一個方便取得、
> 看起來相關的量，不等於規格真正在乎的那個量。

> 本設計初稿寫的是「不呈現」，**那違反了該 spec 已有的明文**：「條件不成立時，入口 SHALL 以停用
> 狀態呈現並說明原因，SHALL NOT 消失 —— 消失會讓使用者以為這個功能不存在或已損壞，而停用加說明
> 才讓他知道怎樣它才會亮。」停用是對的：使用者需要知道的正是「這顆按鈕存在，但你得先讓 session
> 站到那個 worktree 去」—— 而那恰好就是 L2 的內容。

**這條讓 `artifact-continuation` 成為本 change 的 Modified Capability**（已列於 proposal）。
正解是讓 session 能開在 worktree（L2），屆時這條停用可以取消。

### D8：不做聚合開關，但不得做出讓開關加不進來的設計

`scanOpenSpecAggregated` 的 `aggregate` 參數採預設（true）。core 在 `aggregate: false` **或
worktree ≤ 1** 時回退為等同 `scanOpenSpec` 的結果（外掛 `worktrees` 與 `aggregated: false`）——
於是「單一 worktree 的 repo」行為與今天**完全相同**，這也是回歸風險最低的性質。

日後接上使用者控制（對齊 spek 的三態）是「把一個值從偏好讀出來傳進去」，不是改資料流。

### D9：來源徽章對齊 spek 的規則，但 tooltip 必須偏離

spek 的 `WorktreeBadge`（`packages/web/src/components/WorktreeBadge.tsx`）規則照抄：

| | 顯示 |
|---|---|
| `isMain` | **不顯示** —— 避免大量重複的標籤淹沒畫面 |
| git worktree | `branch`，detached HEAD（`branch === null`）時為 `detached` |
| jj workspace | `jj:${branch ?? ''}` —— 本 change 走不到（`includeJj: false`），但規則先寫著 |

**唯一偏離：tooltip。** spek 的 tooltip 是 `source.path`（絕對路徑）—— 那是 web 的自由，它本來就
在同一台機器上服務同一個使用者。**我們不能**：D3 已經決定絕對路徑不出 IPC。徽章因此不提供路徑
tooltip；分支名本身已足以識別來源，而「這個 change 在磁碟上的哪裡」不是側欄要回答的問題。

**這是「跟 spek 一致」的正確詮釋**：一致指的是**規則與呈現**，不是連違反本 app 邊界模型的細節
一起照抄。

### D10：`@spekjs/ui` 內部對聚合節點 id 的處理不一致 —— Timeline 的分組要在宿主端適配

本設計初稿宣稱「`@spekjs/ui` 零改動，`SpecGraph` 已能處理聚合形式的 change 節點 id」。**那只查了
一半**：同一份 `GraphData` 在 `VizOverlay.tsx:177` 還餵給了 `buildLanes`（Timeline 的
group-by-topic 用它推 change → topic），而套件內部兩者不一致 ——

| | 對 `change:<key>:<slug>` 的處理 |
|---|---|
| `SpecGraph` | **剝掉** key（`SpecGraph.js:149`） |
| `buildLanes` / `changeTopicsMap` | **不剝**（`grouping.js:31` 只剝 `change:` 前綴），再以 `topicsBySlug.get(c.slug)` 查表 |

於是查表恆不命中，**Timeline 的「依 topic 分組」靜默退化為「全部落在無 topic」**（實測：聚合前
`[{topic:'foo',…},{topic:'',…}]`，聚合後 `[{topic:'',items:[全部]}]`）。這是產品可見的回歸，
而且 **Timeline 仍然畫得出來**，只是分組沒了 —— 典型的「不會變紅的壞掉」。

**作法**：`buildLanes` 的 `graph` 參數**只用來推 topic 對應**（已確認其簽名與用途），因此在餵給它
之前把 change 節點 id 正規化為 `change:<slug>` 即可。`SpecGraph` 仍拿原始的聚合 id（它自己會剝，
而且節點 id 的唯一性是它的事）。

這是**宿主端的格式適配，不是重做 core 的功能**（D1 約束的是「涵蓋範圍與去重的判定」）。
**同時應回報 upstream** —— spek web 自己的 Timeline 在聚合模式下應該有同樣的問題。

### D11：`ChangeDetailView` 也要帶來源 —— 而 core 幫不上忙

`openspec-panel` 要求「本 change 視圖」也標示來源，D7 的條件 4 也需要它。但兩者吃的是
`getChange` → `ChangeDetailView`，而**那條路上沒有來源**：

- core 的 `ChangeDetail.source` 雖然在 `types.ts` 宣告著「僅聚合讀取會填入」，但 **`readChange`
  從來不填它** —— core 沒有聚合版的 `readChange`（已 grep 確認整個 package 無任何寫入點）。

**作法**：來源不從 `readChange` 取，而從**掃描結果**取 —— `getChange` 本來就先經 `#findChange`
查表拿到那筆 `ChangeInfo`（它帶著 `source`），把翻譯後的 `ChangeOrigin` 一併放進
`ChangeDetailView`。零額外成本，且與 D2 的讀取根解析同源（同一筆查表結果）。

**續寫入口的條件 4 因此有兩條可能的取得路徑**（`MainStage` 目前只看 session 狀態，拿不到 change
資料）：從 `ChangeDetailView` 取，或在 `MainStage` 另拉一份 change 清單。**採前者** —— 本 change
視圖本來就已經取了那份 detail，不必為一個布林多開一條資料流。

## Risks / Trade-offs

- **`worktrees.length <= 1` 時 core 靜默退回非聚合** → 驗收若 fixture 的 worktree 沒建成功，
  「清單有渲染」這類斷言**照樣全綠**（這個 repo 最常見的假綠形態）。**Mitigation**：驗收必須有
  正向斷言 —— 該 change 帶著非 main 的來源、且它**不在**主 repo 的 `openspec/changes/` 底下。

- **重建 DTO 接下同步 core 型別的義務** → core 若改動 `WorktreeSource` 的形狀，`ChangeOrigin`
  的翻譯要跟上。**Mitigation**：以 `Omit` 保留其餘欄位的流穿（D3），義務縮到單一欄位；且
  `WorktreeSource` 已有 required 的 `vcs`（CLAUDE.md 記載的 1.2.0 地雷）—— 我們**只讀不建構**
  core 的型別，`TS2741` 那個坑碰不到。

- **同一個 spec 的「相關 change 數」在三條路徑上會給出三個數字** → (1) Specs 清單的
  `historyCount`（取自主工作目錄的掃描）；(2) 聚合 graph 依聚合後的邊重算 —— `SpecGraph` 雖不印
  數字，但**以它決定 spec 節點的半徑**，是視覺可見的；(3) `SpecDetail` 的 `relatedChanges` 來自
  `findRelatedChanges(root, …)`，**只算 folder 自己那個工作目錄**。**Mitigation**：本 change
  不統一它們（統一需要為每個 topic 跑一次聚合查詢，成本與價值不成比例）。差異寫進 spec 的說明，
  不假裝它不存在；dogfood 時確認是否造成困惑。

- **主 repo 為 bare 時 `isMain` 會全盤錯位** → `scanner.ts:590` 取「第一個非 bare」為 main，
  而 bare repo 的第一筆是 bare 且 `isMain: true` ⇒ `main.wt.isMain === false` ⇒ **每一個 change
  的 `source.isMain` 都是 false** ⇒ 全部被打上徽章。**未實測**（由原始碼讀出）。**Mitigation**：
  這是 core 的行為，本 app 不繞過它（D1）；bare 主 repo 不是本 app 的目標情境（folder 要能開
  terminal 與看檔案）。若 dogfood 遇到，回報 upstream。

- **「folder 是 repo 的子目錄」時，側欄的內容取決於該 repo 有幾個工作目錄** → 1 個時空的、
  ≥2 個時突然出現整個 repo 的 spec 與 change（D2b）。**Mitigation**：接受並記錄，理由見 D2b。

- **每次快取失效都會重跑聚合掃描（數個毫秒級 git 行程）** → agent 連續寫檔時成本乘上重掃次數。
  **Mitigation**：既有的 150ms debounce 不變；core 的 `getTimestamps` 對每個 absDir 有 in-memory
  快取。

- **`schemaOrder` 的 CLI spawn（約 1.2 秒）不跨 worktree 共用** —— 已查證，非推測：
  `schema-order.ts:120` 的 cache key 是 `` `${repoRoot}::${schema}` ``，而每個 worktree 是不同的
  `repoRoot`；TTL 30 秒。CLAUDE.md 記載的「1.1.3 起 key 在 schema 而非 change」成立於**同一個
  `repoRoot` 之內**，跨 worktree 本來就不共用。
  **影響比直覺小**：它發生在 `readChange`（開啟某個 change 的內容），**不在掃描路徑上** ——
  側欄一次只呈現一個 change，因此代價是「切到另一個 worktree 的 change 時，該 worktree 的第一次
  付一次」，不是「每次重掃付 N 次」。
  **不做優化**：spek 用的是同一份 core 與同一個 provider，行為完全相同。要改該在 upstream 改
  （cache key 是否應以 repo 的 common dir 而非 worktree 路徑分桶），不在本 app 疊一層自己的快取。

- **掃描期間 worktree 的變更會落空**（D4 的已知窗口）→ 接受，緩解見 D4。

- **graph 節點 id 由 `change:<slug>` 變為 `change:<key>:<slug>`** → `@spekjs/ui` 的 `SpecGraph`
  已自行剝出 slug，renderer 的 `onSelectChange` 收到的仍是 slug（已確認 `VizOverlay.tsx:215`
  用的是 `change.slug`）。**風險在自訂的節點處理**，本 repo 沒有。

## Migration Plan

無資料遷移 —— 沒有任何持久化格式改變（`workspace.json` / `sessions.json` / `preferences.json`
都不動）。單一 worktree 的 repo 行為與今天完全相同（D8）。

回退即把兩個掃描函式換回非聚合版本；DTO 的 `worktree` 欄位為 optional，renderer 不會因它缺席而壞。

## Open Questions

無 —— design 階段原有的兩個都已查證定案：

1. **`schemaOrder` 快取跨不跨 worktree** → **不跨**（`schema-order.ts:120` 的 cache key 含
   `repoRoot`）。成本的形狀與「不做優化」的理由見 Risks。
2. **來源徽章顯示什麼** → 對齊 spek 的 `WorktreeBadge`，唯 tooltip 必須偏離（D9）。

一條留給實作時**以實際畫面確認**、但不阻擋設計的事：徽章在側欄這種窄欄裡的排版（spek 是全寬頁面）。
若分支名過長需截斷，截斷是純呈現，不影響本設計的任何決定。
