## Context

Files 身分的檔案樹根恆為 folder 根：`FilesPanel` 把 `folder.id` 交給 `useFileTree`，後者以
`(folderId, relPath)` 呼叫 `fs.*`，而主行程的 `requireFolder()` 一律解出 `folder.path`。
worktree 裡的檔案在樹上不是看不到 —— 它們就在 `.claude/worktrees/<slug>/` 底下 —— 但那是
「把工作目錄當成一個碰巧存在的子目錄」。

**本 change 的形狀由三條既有規格決定，它們互相牽制：**

1. **`filesystem-access`**：renderer 以 `(folderId, relPath)` 定址，邊界檢查一律在主行程。
   **可選的**工作目錄一律位於 folder 邊界**內**（邊界外的呈現但停用，見 D10），所以每個可選的根
   都是合法的 relPath —— 切根在定址上只是換前綴。
2. **`session-persistence`**：「renderer 送往持久化的內容 SHALL NOT 包含任何**絕對或相對**路徑…
   工作目錄僅以**不可逆識別碼**表示」。**相對路徑也在禁止之列。**
3. **`openspec-data-access`**：`getWorktreeRoots` 供應的是 folder-relative 根字串陣列，邊界外的
   **整筆省略、SHALL NOT 以 `null` 佔位**（理由：空字串是 folder 自身的合法值，混入 `null` 會在
   消費端與它糾纏）。

第 1 與第 2 條看似衝突，實則作用域不同 —— 這是本設計最重要的一個區分（D2）。

## Goals / Non-Goals

**Goals:**

- Files 身分的檔案樹根可切至該 folder 所屬 repo 的任一**邊界內**工作目錄，路徑自該根算起。
- 選擇為 per-session 且跨重啟存活，語意與既有的 `panelFolderId` / `anchoredChange` 一致。
- 跨身分導覽維持雙向可用，且自 OpenSpec 跳往 worktree 內檔案時工作目錄一併切換。
- **不動任何安全邊界**：`filesystem-access` 一條 requirement 不改，`fs.*` 的簽名一行不動。
- 不做出讓 issue #5 加不進來的設計。

**Non-Goals:**

- 檔案的 git 變更狀態（下一個 change）。
- 邊界外工作目錄的檔案瀏覽（`worktree-aggregation` 已明文排除，本 change 不鬆動）。
- 同一檔案跨工作目錄的版本比較 / 差異檢視（見 D7）。
- rail 呈現 worktree、OpenSpec 身分的工作目錄選擇（issue #5）。

## Decisions

### D1：切根以「folder-relative 路徑前綴」達成，`fs.*` 的簽名一行不動

`useFileTree` 接受一個**根前綴**（`''` ＝ folder 自身，或 `.claude/worktrees/<slug>`）。它送給
`fs.*` 的仍然是完整的 folder-relative 路徑（前綴 + 樹內路徑），主行程照舊夾制於 folder 邊界內。

**替代方案：`fs.*` 全數新增 `worktreeKey` 參數，由主行程查表解出根。** 否決 —— 那是 8 個操作 +
watch 的訂閱與事件推送 + preload 白名單 + `filesystem-access` 的 20 條 requirement 全部要重新
論證，而**換來的邊界能力恰好是零**：worktree 在 folder 邊界內，前綴法可達的位置集合與它完全相同。
`session-in-worktree` 之所以非那樣不可，是因為 pty 的 cwd **可以**落在 folder 之外；Files 不能。

**這條的代價寫在 D6**：renderer 內部從此有兩種座標系。

### D2：定址用路徑、持久化用識別碼 —— 兩者並存，因為它們防的不是同一件事

這是本設計最容易寫錯的一處。`session-persistence` 禁止 renderer 把**相對路徑**送進持久化，而
D1 又要 renderer 手上有 relPath。兩者並存的理由：

| | 作用域 | 用什麼 |
|---|---|---|
| 呼叫 `fs.*` | renderer 的**記憶體與 IPC 參數** | folder-relative 路徑（本來就是它的合法詞彙） |
| 存進 `sessions.json` | **落盤的事實** | 不可逆識別碼（core 算的路徑 sha1 前 8 碼） |

`session-persistence` 那條限制的是「**送往持久化**的內容」，不是 renderer 記憶體裡有什麼 ——
否則整個 Files 身分都違規（它一直在傳 relPath）。而落盤禁路徑的理由是獨立的：持久化的內容會在
**下次啟動時**被主行程拿去解析，一個落盤的路徑等於一個繞過查表的位置指定。

於是 renderer 需要**同時**拿到 key 與 relPath：key 用於狀態與落盤，relPath 用於組路徑。

> **proposal 原本寫「不需要工作目錄識別碼參數」，那句話只對 `fs.*` 成立，對持久化是錯的。**
> 已於 proposal 修訂。錯誤的來源是把「不需要主行程查表解析 cwd」推廣成了「不需要識別碼」。

### D3：新增 `openspec.getWorktrees`，**不修改** `getWorktreeRoots`

選擇器要的資料（含邊界外的工作目錄、分支名）與 `getWorktreeRoots` 供應的（可用於**定位 OpenSpec
內容**的根）不是同一個問題的答案。

新 API 回傳每個工作目錄一筆：

```ts
{ key: string; relPath: string | null; branch: string | null; isMain: boolean }
```

`relPath` 為 `null` ＝ 位於 folder 邊界外 ⇒ 不可瀏覽（選擇器呈現但停用）。**絕不含絕對路徑**
（`openspec-data-access` 的既有要求）。

**替代方案：擴充 `getWorktreeRoots` 回物件陣列、邊界外的以 `relPath: null` 表示。** 否決，兩個
理由：

- `getWorktreeRoots` 的「邊界外整筆省略」**是它的正確行為，不是缺陷** —— 反向導覽根本碰不到那些
  檔案（它們不在樹上）。擴充它會讓既有消費端多一個只為別人服務的 filter。
- 那條 requirement 的論證（「混入 `null` 會與空字串糾纏」）是針對**字串陣列**的。改成物件陣列後
  該論證確實不再適用 —— 但「既有論證在新形狀下不適用」不是鬆動它的理由，只是說明鬆動它**可以**
  做到安全；而我們根本不需要鬆動。

**這不是平行實作。** `worktreesOf`（主行程內部，含絕對路徑）與 `getWorktreeRoots`（renderer，
folder-relative）早已是同一份 `#scan` 結果的兩個投影，本 API 是第三個。它們同源，不會分歧。

### D3a：folder 自身那一筆是**合併**出來的，不是額外加上去的

**這是獨立稽核抓到的 CRITICAL，而它的錯誤形態值得記下來。** `toRelPath()` 在 `rel === ''` 時
回 **`null`** 而非 `''`：

```ts
const rel = path.relative(root, abs)
if (rel === '') return null      // ← folder 自身翻不出相對路徑
```

於是既有的 `getWorktreeRoots` 是「先塞一個合成的 `''`，再讓 `path === root` 的那一筆被
`rel !== null` **靜默過濾掉**」。照抄那個結構寫新 API（`[self, ...worktrees.map(toEntry)]`），
在**每一個普通 git repo**（folder ＝ main worktree、零個 linked worktree）上會產出兩筆：

```
[{ relPath: '' }, { relPath: null, branch: 'master' }]
```

第二筆是**使用者正在看的那個目錄**，卻標著「位於此 folder 之外，無法瀏覽」—— 而選擇器會因此在
每個 git repo 都冒出來，直接違反「單一工作目錄的 repo 不呈現選擇器」。

**規則**：folder 自身那一筆 ＝ `path === root` 的那個工作目錄（存在時），其 `relPath` **強制**為
`''`；不存在時（folder 是 repo 子目錄、或根本不在版控下）才合成一筆。**兩者擇一，永不並存。**

> **為什麼整套驗收原本抓不到它**：`probe:files` 的 fixture 非 git（走 `listWorktrees` 回**空陣列**
> 那條），`probe:openspec` 的 fixture 有 **3 個** worktree 且無筆數斷言 —— 「**恰好 1 個**工作目錄
> 的 git repo」這條路徑一次都沒被走到。這是 CLAUDE.md 那條「worktree ≤ 1 時 core 靜默退回非聚合
> ⇒ 假綠」的變體，只是分歧點落在 **0 與 1 之間**。載體用 `probe:workspace` 的 `repo-openspec`
> （已是 `git init` + commit 的真 repo 且已在 workspace 中），並斷言**筆數**。

### D3b：folder 自身以「**沒有識別碼**」表示，不是「main 的識別碼」

folder 不在版控之下時 `listWorktrees` 回空陣列 —— **根本沒有 key 可放**。而 `terminal-sessions`
對「folder 根」的既有表示法正是**省略 key**（`worktree-pick.ts` 的 `if (!worktreeKey) return`、
`session-store.ts` 的 `worktreeKey?: string`）。

於是 `panelWorktreeKey === undefined` ＝ folder 自身。若改採「main 的 key」，同一個邏輯狀態會有
**兩種落盤表示**，而「切換來源時重置」與「工作目錄已消失時退回」兩條就沒有唯一的正確值可寫。

**D5 的 `relPath === ''` 回答的是「怎麼判斷當前是不是 folder 自身」，本條回答的是「該存什麼」**
—— 兩個不同的問題，先前只答了前一個。

### D4：選擇器位於麵包屑的中段，且**僅在工作目錄多於一個時呈現**

```
core-lib / [⑂ master ▾] / files                    ● 3   42 items   ＋
core-lib / [⑂ ec-region-…-gate ▾] / files / lib/foo.js        ◈   Back
```

工作目錄在概念上正介於 repo 與檔案路徑之間，放在那裡它自己就說明了「路徑自這裡算起」。

**清單恰有一筆時不呈現** —— 判準是**清單的筆數**，不是「可選取的筆數」。這個區分是承重的
（獨立稽核抓到原本的表述自相矛盾）：

| 情形 | 清單 | 呈現？ |
|---|---|---|
| 非 git repo／單一工作目錄的 repo | `['']` | **否** —— 沒有任何資訊可傳達 |
| folder 是 repo 子目錄 | `['', main:null]` | **是** —— 使用者該知道 main 存在但不可瀏覽 |
| folder 自身即 worktree，另有邊界外的 | `['', main:null, outside:null]` | **是** —— 同上 |

若改用「可選取的筆數」，上表後兩列會變成不呈現 —— 而那正好把 D10 要傳達的「有東西但你看不了」
整個藏起來，與它自相矛盾。**噪音的定義是「沒有資訊」，不是「沒有可點的東西」**：一個全部停用的
清單仍然在回答「這個 repo 還有哪些工作目錄」。

這沿用 `worktree-reverse-navigation` 對 spec 來源標示的同一條判準（該 repo >1 工作目錄才標示）。

下拉沿用 `ContextMenu`（鍵盤可全操作是本 repo 的紀律），比照 `PanelSourceBar`。

**替代方案：放在 `PanelSourceBar`（側欄頂部的來源列）。** 否決 —— 那一列是 OpenSpec 與 Files 兩個
身分共用的，而工作目錄維度本階段只有 Files 消費（proposal 的張力分析）。放在那裡會讓 OpenSpec
身分看到一個對它無作用的控制項。**issue #5 若讓 OpenSpec 也消費這一維，那時再搬。**

### D5：預設與「回到預設」的目標是 **folder 自身**，不是 `isMain`

`isMain` 是**該 repo 的**主工作目錄；folder 本身可能就是一個 linked worktree，此時
`isMain === false` 而它才是使用者的預設視角。判準是 `relPath === ''`。

**這是 `openspec-worktree-aggregation` 已經踩過的坑的同型**（續寫入口的條件 4 誤用 `isMain`，
導致「folder 本身是 worktree」時入口被錯誤停用）。`isMain` 在本 change 只用於**呈現**（主工作
目錄不加來源徽章，對齊 spek），能力與預設的判定一律用 `relPath === ''`。

### D6：內部一律用**完整 folder-relative 路徑**，只在顯示的最後一刻剝前綴

D1 引入了兩種座標系，而混用它們的每一個地方都會是靜默的 bug：

| 用途 | 座標系 |
|---|---|
| `fs.*` 的參數、watch 的訂閱與事件、dirty buffer 的 key、`openPath`、`targetOfPath` 的輸入 | **完整** folder-relative |
| **樹列與麵包屑的 `title` 屬性**、刪除確認對話框的目標、`files.deleteAria` | **完整** folder-relative（見下） |
| 樹上每一列的縮排文字、麵包屑的尾段 | 工作目錄相對（顯示時剝前綴） |

**`title` 必須留在完整座標系，因為它同時是探針的選擇器。** `FileTree` 的每一列與麵包屑的尾段都
帶 `title={relPath}`，而 6 支 probe 助手（`FILES_HAS_ROW`／`FILES_ROW_EXPANDED`／`FILES_CLICK_ROW`
／`CLICK_ROW`／`ROW_IS_DIRTY`／`OPEN_FILE_PATH`）以 `[title=<完整 relPath>]` 定位元素。把它一起
剝掉，那些助手會**選不到元素而回 `false`** —— 導航靜默停住，其後的斷言驗的是上一個狀態
（`worktree-reverse-navigation` 已實測過這個失敗形態）。

這是 CLAUDE.md「`aria-label` 同時是選擇器」的**同一條結構性事實，換了一個屬性**。`title` 對使用者
的作用本來就是「看完整路徑」，留著完整值同時滿足兩邊，沒有取捨。

**這條紀律的回報是三件事免費成立**：dirty buffer 跨工作目錄切換自然存活（key 沒變）、
`targetOfPath()` 的反向導覽判定**一行都不用改**（它吃的本來就是完整路徑與工作目錄根清單）、
watch 的訂閱與事件推送不受影響。

比照 `workspace-reordering` 的「state 裡存的永遠是插入點，換算集中在 `commitIndex()` 一處」——
兩種座標系並存時，**選一個當權威、換算集中在單一函式**，不要讓每個消費端各自決定。

### D7：**使用者主動**切換工作目錄時關閉開著的檔案，回到樹

**「使用者主動」四個字是規範性的，不是修辭**（獨立稽核抓到）。跨身分導覽（D8）也會切換工作目錄，
而它緊接著就要開啟一個檔案 —— 若把「關檔」掛在工作目錄的 setter 上，兩者會變成「開了又關」或
「關了又開」，取決於呼叫順序。

更糟的是**這個 bug 的方向是不對稱的**：本決定的 scenario 兩種順序都會通過（它只斷言「切換後回到
樹」），只有跨身分導覽那條會時綠時紅 —— 於是紅燈會指向錯的地方。因此關檔的觸發點是**選擇器的
選取事件**，不是工作目錄狀態的變更。

**替代方案：在新工作目錄開啟同一個工作目錄相對路徑**（「看另一個 branch 的同一個檔案」）。
否決 —— 它是**版本比較**的需求，而這個機制只能提供它的一個半吊子版本（檔案不存在時要退回、
兩份內容無法並排、沒有 diff）。切換工作目錄的語意是**換一個上下文**，不是換一個版本。

使用者原話「不好閱讀」指向的是導航成本，不是版本比較 —— 本決定沒有辜負原始需求。真要做版本
比較，那是一個獨立的、該有 diff 檢視的功能。

### D8：跨身分導覽的工作目錄切換，在**送出請求的 event handler** 裡完成

`FilesPanel` 在 `useState` 的**初始值**就套用跨身分請求（否則首次掛載那一次永遠不會開檔，已實測）。
而設定工作目錄是**父層** session 的 state —— React 不允許在渲染期間呼叫父層的 setState。

沿用既有解法：錨定與工作目錄的切換都在**送出 `FileRequest` 的那個 handler** 裡完成，`FilesPanel`
掛載時看到的已經是正確的工作目錄。判定「target 落在哪個工作目錄」以最長的 `relPath` 前綴命中
（`worktree-reverse-navigation` 的「由長至短逐一嘗試」同一條，理由也相同：兩個工作目錄根可能
互為前綴）。

**那個 handler 在 `MainStage`（`openFileFromOpenSpec`），不是 `OpenSpecPanel`**（獨立稽核更正）。
這有一個實際後果：`MainStage` 會成為工作目錄清單的**第三個**消費者（判定歸屬需要那份清單），
而不只是 `FilesPanel` 與選擇器兩個。

### D9：renderer 端的工作目錄查表**不承擔安全**

`panelWorktreeKey` 在清單中查無時（worktree 於應用程式未開啟時被移除）退回 folder 自身。這個
查表在 **renderer** 做，與 `session-in-worktree` 的主行程查表不同 —— 因為兩者擔保的事不同：

- `session-in-worktree` 的查表決定 **pty 的 cwd**，那是可以落在 folder 之外的位置 ⇒ **圍堵性**。
- 本 change 的查表只決定**樹根的前綴**，而真正的邊界仍由 `fs.*` 在主行程夾制 ⇒ renderer 就算
  組出一個亂七八糟的前綴，可達的位置集合**一點也不會變大**。

**於是它擔保的是誠實性，不是圍堵性**（比照 `session-in-worktree` 對三個前提的區分：查無即拒絕
擔保誠實性、查表與 git 列舉擔保圍堵性）。日後若有人想把這個查表搬去主行程，要知道那不會讓邊界
更緊 —— 邊界從來不在這裡。

### D10：邊界外的工作目錄呈現但停用，並說明原因

`worktree-aggregation` 已明文「邊界外 worktree 的檔案不在該 folder 的檔案樹中」，本 change 不動它。
但選擇器**整筆省略**會製造一個更糟的不一致：OpenSpec 身分**看得見**那個 worktree 的 change（聚合
是完整的，只有檔案導覽降級），Files 的選擇器卻找不到對應的工作目錄。呈現且停用是誠實的那一邊。

停用項不呈現任何路徑（`relPath` 為 `null`，我們也不送絕對路徑）—— 說明文字只講「位於此 folder
之外，無法於此瀏覽」。

### D11：per-session 欄位命名為 `panelWorktreeKey`

與 `panelFolderId` 成對（側欄來源的兩個維度），而非 `filesWorktreeKey`。理由見 proposal 的
「與 issue #5 的關係」—— #5 到來時是擴充消費者，不是拆掉重做。

`session-store.ts` 已有 `isWorktreeKey()` 的驗證，新欄位沿用它（持久化的識別碼在使用前必須驗證，
`session-persistence` 的既有要求）。

### D12：撤銷「僅對含 `openspec/` 的 folder 取工作目錄清單」那道成本 gate

`FilesPanel` 目前以 `folder.hasOpenSpec` gate 住工作目錄清單的取數，而**那道 gate 本身是
`worktree-reverse-navigation` 被獨立稽核抓到後補的**（沒有 `openspec/` 的 folder 此前不會為一份
用不到的清單走一趟 `#scan`，而 core 在那條路上 spawn `git worktree list`）。

選擇器不能沿用它：一個「有 worktree 但沒有 `openspec/`」的 repo，使用者會看到選擇器缺席，而**無從
分辨那是刻意的限制還是壞了**。於是成本回來了 —— 每個 folder 首次進入 Files 身分時走一次掃描。

**已裁決接受**，兩個理由：掃描結果是 per-folder 快取，成本一次性；而這個 app 的 folder 幾乎都是
OpenSpec repo（那是它的定位）。**這是一個明白的裁決，不是一個靜靜發生的迴歸** —— 記在這裡，是
因為它撤銷的正是前一次稽核的產物。

### D13：detached HEAD 以短 commit hash 呈現（原為 Open Question，已查證）

core 的 `WorktreeInfo` **同時**帶 `branch: string | null` 與 `head: string | null` —— 先前列為
「實作時查證」的問題現在就有答案。因此 DTO 加 `head`，選擇器於 `branch === null` 時以短 hash
呈現，並與 `repo-branch` 既有的 detached HEAD 呈現方式一致。

**不加的話會是「spec 寫無條件、實作註定有條件」那一類缺陷**（`worktree-reverse-navigation` 被
`/opsx:verify` 抓到過）：spec 若無條件寫「以分支呈現」，detached 的 worktree 在選擇器上就是一個
空標籤。commit hash 不是路徑，加進 DTO 不影響「不含絕對路徑」那條。

## Risks / Trade-offs

**[兩個 worktree 欄位極容易看混]** `worktreeKey`（session 的 pty 開在哪）與 `panelWorktreeKey`
（側欄的 Files 看哪）並存於同一個 `SessionState`，且**它們可以不同**（session 開在 worktree A、
側欄看 worktree B —— 那是合法且有用的）。這與 CLAUDE.md 記載的 `GraphEdge.source`（端點）vs
`GraphNode.source`（worktree 來源）是同型的風險。
→ **Mitigation**：型別上不可區分（都是 `string`），故靠命名與註解 —— 每個宣告點寫明它回答的是
哪個問題。單元測試對「兩者不同」的情形至少一條。

**[worktree ≤ 1 時 core 靜默退回非聚合 ⇒ 假綠]** CLAUDE.md 記載的頭號假綠來源：
`scanOpenSpecAggregated` 在工作目錄只有一個時回傳等同 `scanOpenSpec` 的結果，於是驗收 fixture 若
`git worktree add` 失敗，**每一條斷言仍會通過**。
→ **Mitigation**：驗收採**成對的反向斷言** —— 不只「選了 worktree 之後樹上有 X」，還要「X 確實
不在主工作目錄的同一路徑底下」。並比照既有做法：「來自 worktree 的標示」要配「主工作目錄的
**不**標示」。

**[兩種座標系混用 ⇒ 靜默的路徑錯誤]** 剝前綴剝錯一層，檔案會開在錯的位置或開不起來；而 D6 列的
消費端有六處。
→ **Mitigation**：換算集中在單一函式（D6），且**權威是完整路徑** —— 錯誤方向因此偏向「顯示多了
前綴」（看得見）而非「開錯檔案」（看不見）。單元測試涵蓋前綴為空字串的情形（folder 自身），
那是最容易被 `if (prefix)` 之類的守衛誤殺的一個值。

**[選擇器的標籤過長導致版面跳動]** 分支名如 `worktree-ec-region-market-recall-gate`。CLAUDE.md
記著 pty 的 OSC 標題讓「+ session」入口右移 150px、使探針點空的實測。
→ **Mitigation**：截斷 + tooltip（麵包屑既有做法）。本 change 的標籤來自掃描結果而非非同步的
外部行程，抵達時機不像 OSC 標題那樣晚且不可預測，但寬度仍須夾制。

**[`useFileTree` 的根狀態全部鍵在 `ROOT_PATH`]** `rootLoading` / `rootError` 讀的是
`state.loading[ROOT_PATH]` / `state.errors[ROOT_PATH]`，而 `FilesPanel` 正在渲染它們。前綴改為
非空之後若漏改這兩處，worktree 根的「載入中…」與根層錯誤訊息會**靜默地永遠不出現**。
→ **Mitigation**：D6 的換算集中處要涵蓋「根的鍵」，不只路徑參數；tasks 明列這兩行。

**[換 worktree 時沒有東西重新掛載那棵樹]** `FilesPanel` 以 `folder.id` 為 key 掛載，而
`useFileTree` 的註解明寫「呼叫端須以 `folderId` 為 key 掛載 —— 換 folder 等於換一棵樹」。換
worktree 同樣是換一棵樹，卻不會換 key：舊路徑的節點只是孤懸（`buildRows` 從別處起算，無害），
但**初始 loading 態不會被設**。
→ **Mitigation**：把 key 延伸為 `(folderId, 工作目錄)`，或在前綴變更的路徑上顯式重置。前者較
誠實 —— 它讓「換一棵樹」這件事在程式碼裡看得見。

**[issue #5 可能取代這個 UI]** 真的做了 #5，rail 上選中 worktree 之後，Files 頂部這個選擇器可能
變成多餘。
→ **Mitigation**：資料層（`panelWorktreeKey`、`getWorktrees`）不會白做，命名已按側欄來源的維度
而非 Files 專屬（D11）。UI 層的重工是已知且接受的代價 —— 而 #5 的形狀本來就該由**用過這個選擇器
之後的** dogfood 決定。

## Open Questions

- **選擇器要不要有鍵盤快捷鍵？** 現有快捷鍵已佔用 `Ctrl+Tab`／`Ctrl+↑↓`／`Ctrl+T`／
  `Ctrl+Shift+W`／`Shift+方向鍵`，而每一顆的代價都是實測論證過的。本 change **不加**新快捷鍵 ——
  切換工作目錄不是高頻動作（一個 change 的生命週期內切幾次），不值得再從 pty 手上沒收一顆鍵。
  留待 dogfood 反證。
- **`useFileTree` 換前綴而不重新掛載時的實際行為**（見 Risks 的「根狀態的鍵」）。對帳的 effect
  可能會補救，但 loading／error 態的表現只有跑起來才知道 —— 實作時以真實操作確認，不要只看
  單元測試。
- **監看工作目錄根（depth 0）會不會被雜訊吵到。** linked worktree 的 `.git` 是靜態的指標檔案，
  推測安靜；但 `openspec-worktree-aggregation` 曾實測「一次 `git commit` 在工作目錄下產生 3 個
  檔案事件」，故不推測、實作時量。
