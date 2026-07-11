# Design — OpenSpec 側欄（Phase 5）

## Context

主行程已經 `import` 了 `@spekjs/core`（Phase 0 的 `spek-core-integration` 證明了「core 是純 Node 模組，
主行程可直接使用、不必開 HTTP」這個論證），但至今只用它印一行 stdout 摘要。renderer 端的 side panel
有一個完整的身分切換骨架（`[◈ OpenSpec │ ▤ Files]`），OpenSpec 那一格是空的。

本 change 要把這條路徑接通：**core → 主行程資料供應層 → `openspec.*` IPC → renderer 的 IpcAdapter →
側欄 UI**。四個環節都要新建，但每一環都有既有的樣板可循 —— `fs.*` 與 `terminal.*` 已經把 IPC 的
邊界語彙、錯誤傳遞、生命週期記帳的作法立好了。

**約束**：

- **renderer 以 `(folderId, …)` 定址，永遠不傳絕對路徑**（`multi-folder-workspace-shell` 起的邊界）。
  但 core 回傳的 `SpecInfo.path` **是絕對路徑**（已實測：`/home/me/git/spek-workspace/openspec/specs/…`）。
- side panel 寬 320–620px（mockup `flex: 0 0 42%; min-width:320px; max-width:620px`）。所有 OpenSpec
  的視圖都必須在這個寬度內可讀。
- 這個 app 的前提是**旁邊有 agent 一直在寫檔** —— 側欄不能是啟動時的快照。
- `docs/workspace-mockup.html` 是 UI 權威（CLAUDE.md：PRD §6 的文字若與雛型有出入，以雛型為準）。

## Goals / Non-Goals

**Goals:**

- 側欄能顯示當前 folder 的 OpenSpec 結構，且 agent 改檔後會自己更新。
- 「本 change」tab 能跟隨 focused terminal session —— 這是本 app 相對於「開四個終端機分頁」的核心增量。
- IPC 契約的形狀與 spek 前端既有的 `ApiAdapter` 對齊，使日後若要接 `@spekjs/ui` 不必重做接縫。
- 不擴大檔案系統的攻擊面：`openspec.*` 帶來的新輸入（slug / topic）不得成為 path traversal 的入口。

**Non-Goals:**

- **不抽出 `@spekjs/ui`**（D1）。
- **不做全域搜尋**（spek `ApiAdapter` 的 `search()`）—— 側欄沒有搜尋框，mockup 也沒畫。
- **不做 worktree 聚合**（core 的 `scanOpenSpecAggregated` / `aggregate` 參數）。workspace 的 folder 是
  使用者自己加的，一個 folder 就是一個工作目錄；聚合是 spek web 的情境。IPC 契約保留這個維度的擴充餘地
  （不傳 `aggregate` 參數即為單一 worktree），但本 change 不實作。
- **不做 change 的編輯**（勾 tasks、改 spec）。側欄是**檢視**，改檔走 agent 或 Files 身分的編輯器。
- **不持久化錨定關係**。session 本身就不持久化（Phase 6 才做 layout 持久化）。

## Decisions

### D1 — 不抽出 `@spekjs/ui`；改為對齊 `ApiAdapter` 的介面契約

**PRD §9.2 的假設不成立，本 change 推翻它並回寫。**

PRD 寫「spek 前端已把通訊層抽象成 `ApiAdapter`（Fetch / Message / Static）。Workspace 只要新增一個
`IpcAdapter`，既有 spek 頁面（Dashboard / SpecDetail / ChangeDetail / GraphView）幾乎可原封不動在
Electron renderer 跑起來。**這是整合既有畫面的關鍵槓桿。**」

探查後，這句話**前半對、後半錯**：

- **對的一半**：`packages/web/src/api/types.ts` 的 `ApiAdapter` 確實是個乾淨的介面（11 個 method、全
  Promise、參數皆可序列化），有三個實作當範本，且「同一份 UI ＋ 不同 shell」的模式在 spek 已跑過四次
  （web / vscode webview / intellij / demo）。頁面對宿主零認知。
- **錯的一半**：**「既有 spek 頁面幾乎可原封不動跑起來」在我們的側欄裡不成立。** mockup 定義的 OpenSpec
  側欄是為 320–620px 窄欄設計的緊湊 UI（四個 nav tab、進度條、依 section 分組的 checklist、BDD 高亮的
  requirement 區塊、stub list rows）；spek 的 Dashboard / ChangeDetail / GraphView 是為全寬瀏覽器頁面
  設計的（自帶 `Layout` + `Sidebar`，GraphView 是 336 行的 d3 force graph）。**兩者不是同一個東西。**

於是「抽 `@spekjs/ui`」要付的代價（動 spek repo、修兩處 adapter 洩漏〔`useFileWatcher` 硬編
`/api/openspec/watch`、`SelectRepo` 裸 fetch〕、讓 `@spekjs/web` 回歸、補一條不存在的 npm publish CI）
換來的是**我們用不到的整頁元件**。真正可重用的是「介面契約與型別」，而那些從 `@spekjs/core` 直接就
拿得到（core 已導出約 25 個型別；renderer 對 core 主入口只做 `import type`，型別會被 TS 擦除，不會把
`node:fs` 拖進 renderer）。

**決策**：本 change 不抽套件，側欄照 mockup 自刻。但 **`openspec.*` IPC 的 method 形狀刻意對齊
`ApiAdapter`**：

| spek `ApiAdapter` | 本 change 的 `openspec.*` |
| --- | --- |
| `getOverview(aggregate?)` | `getOverview(folderId)` |
| `getSpecs()` | `getSpecs(folderId)` |
| `getSpec(topic)` | `getSpec(folderId, topic)` |
| `getSpecAtChange(topic, slug)` | `getSpecAtChange(folderId, topic, slug)` |
| `getChanges(aggregate?)` | `getChanges(folderId)` |
| `getChange(slug, wt?)` | `getChange(folderId, slug)` |
| `getGraphData(aggregate?)` | `getGraphData(folderId)` |
| `search` / `browse` / `detect` / `resync` | — 不實作（見 Non-Goals） |

renderer 端的 `IpcAdapter` 是一個實作這組 method 的 class。日後若真要接 `@spekjs/ui`，換的是 UI，
不是接縫 —— 今天做的不會白做。

**代價**：`@spekjs/ui` 這件事被推遲，spek 與 workspace 兩邊的 markdown 渲染與 BDD 高亮會**各有一份**。
可接受，因為兩邊的呈現本來就不同（窄欄 vs 全頁），且 workspace 這邊已經有自己的 `MarkdownView` 與
`.markdown` 樣式（Phase 2 建立）。

> **修訂（使用者實測後）：這條決策對「頁面」仍然成立，但對 Graph 與 Timeline 不成立 —— 那兩個要抽。**
>
> 上面的論證有一個沒說出口的前提：「可重用的候選都是**整頁**」。`Dashboard` / `SpecDetail` /
> `ChangeDetail` 確實如此（自帶 `Layout` + `Sidebar`，與我們的窄欄不相容）。但 **`GraphView` 與
> `timeline/*` 不是頁面，是自足的視覺化元件** —— 它們吃 `{nodes, edges}` 與 `ChangeInfo[]`，
> 吐一塊 SVG，對宿主零認知。它們正是「真正可重用的那種」。
>
> 而且一旦它們搬進**全視窗 overlay**（D12），「窄欄裝不下」這個唯一的技術理由也消失了。
>
> **修訂後的決策**：抽出 `@spekjs/ui`，內容為 **`ApiAdapter` 介面 + 共用型別 + `GraphView` +
> `timeline/*`**（不含整頁的 Dashboard / SpecDetail / ChangeDetail —— 那些我們仍然自刻）。
> 側欄本體（兩棵樹、本 change、BDD 高亮）**維持自刻**，因為它們在 spek 沒有對應物
> （spek web 的 Sidebar 只是 5 個扁平連結）。
>
> **抽出時必須解決的一件事**：spek 的 `GraphView` 以 `getComputedStyle(document.documentElement)`
> 讀 CSS 變數取色（`--accent` 之類），而 workspace 的 `@theme` token 叫 `--color-accent`。
> 套件必須把**主題契約**一起定義清楚（連同 CSS 出貨，或改由 props 傳色），否則圖在 Electron 裡
> 會沒有顏色。
>
> IPC 契約照 `ApiAdapter` 形狀設計的那個決定，在這裡得到了回報：接上 `@spekjs/ui` 時換的是 UI，
> 不是接縫。

### D2 — OpenSpec 身分的啟用條件維持 `hasOpenSpec`，不改為「有 active change」

PRD §6.3 寫啟用條件是「repo 有 `openspec/` **且有 active change**」，但現行實作與
`workspace-layout` 規格只檢查 `hasOpenSpec`（一次 `statSync`），且 `workspace-folders` 規格**明文禁止**
在這個判定裡做完整掃描。

**決策**：維持 `hasOpenSpec`，**回寫 PRD §6.3**。理由有二：

1. **「有 active change」需要一次完整掃描**（要讀 `openspec/changes/` 下每個目錄）。folder 清單是啟動時
   一次算出來的，把掃描塞進去等於讓 app 啟動時間隨 folder 數線性成長 —— 這正是 `workspace-folders`
   規格禁止它的原因。
2. **沒有 active change 不代表側欄沒東西可看。** Specs / Changes / Graph 三個 tab 對一個「只有 archived
   change」的 repo 仍然完全有用（本 repo 的 archive 有 8 個 change、11 份 spec）。用「沒有 active change」
   停用整個身分，是拿「本 change」tab 的空狀態去懲罰另外三個 tab。

**「本 change」tab 在沒有 active change 時呈現空狀態** —— 這才是正確的降級層級。

### D3 — session 的「錨定 change」由使用者建立，不由系統猜

mockup 的 Changes tab 有一列 highlight（`.highlight`，accent 邊框 + accent-soft 底），右側註記帶 session
與進度（`S1 · 3/9`、`S2 · running`）；PRD §6.3 寫「自動跟隨 focused session 的 change」。這需要一個
「session ↔ change」的錨定關係，而 session 資料模型目前沒有這個欄位。

**問題是：我們根本無從得知 agent 在做哪個 change。** pty 裡跑的是 `claude`，它不會告訴我們。可能的推導
來源都不可靠：

- **由 cwd 推導** — session 的 cwd 是 folder root，不含 change 資訊。無效。
- **由 pty 宣告的 OSC 標題推導** — `claude` 設的標題是任務描述的自然語言，不是 change slug。硬做字串
  比對會在「標題剛好提到某個 slug」時假陽性，在「標題是別的說法」時假陰性。**這是在猜。**
- **由「最近被修改的 change 目錄」推導** — 檔案變更無法歸因到特定 session（兩個 session 可能同時在寫）。

**決策**：**錨定關係由使用者建立，系統只提供一個誠實的預設值。**

- **預設**：session 建立時，若該 folder **恰有一個 active change**，錨定它。多於一個（或零個）→ 無錨定。
- **使用者建立／改變錨定**：在 Changes tab 點選一個 change → 該 change 錨定到**當前 focused session**。
- **跟隨**：切換 focused session 時，「本 change」tab 顯示該 session 的錨定 change；Changes tab 中該列高亮。
- **無錨定時**：「本 change」tab 呈現空狀態，並引導使用者到 Changes tab 選一個。

**替代方案（已否決）**：從 pty 標題猜。否決理由 —— Phase 4 的教訓是「session 的身分由 pty 自己宣告」，
但那是因為 pty **真的用 OSC 序列宣告了標題**（一個明確的協定）。change 的錨定沒有這樣的協定，硬猜就是
在製造一個「大部分時候對、偶爾莫名其妙跳到別的 change」的功能 —— 那比沒有更糟，因為使用者會開始不信任側欄。

**這個決策為 Phase 7 鋪路**：handoff 的 payload 明確帶著 change slug，auto-spawn 的 session 天生就有錨定
—— 屆時「系統知道 session 在做哪個 change」會是**因為有人告訴它**，而不是因為猜對了。

### D4 — 主行程做 per-folder 快取，chokidar 監看 `openspec/` 觸發失效並推送

**掃描不便宜**（core 會遞迴讀 `openspec/specs` 與 `openspec/changes`，並 spawn 一次 `git log` 取時間戳），
而側欄的四個 tab 會反覆要同一份 `ScanResult`。

**決策**：主行程持有 per-folder 的 `ScanResult` 快取。以 chokidar 監看 `<folder>/openspec`（遞迴、
`followSymlinks: false`、`ignoreInitial: true`），任何變更事件 → 清該 folder 的快取 → **debounce 後**
推送 `openspec:changed`（帶 `folderId`）給該 folder 的訂閱者，renderer 收到後重新取資料。

- **debounce 是必要的**，不是優化：agent 一次操作會寫入數個檔案（proposal + design + specs/*.md + tasks），
  chokidar 會噴出一串事件。不 debounce 就會讓側欄在一秒內重掃十次。
- **`followSymlinks: false`** —— Phase 2 的教訓：chokidar 預設會跟著 symlink 走出 folder 邊界。
- **先訂閱、再掃描** —— Phase 2 的教訓：兩者之間的窗口裡發生的變更會兩頭落空。
- **快取是 per-folder，watcher 也是 per-folder**，且與 `fs.*` 的樹狀 watcher **分開**（後者是 renderer
  訂閱驅動的、按樹上的目錄訂閱；openspec 的監看是主行程自發的、範圍固定為 `openspec/`）。共用 chokidar
  這個依賴，不共用 watcher 實例。
- **`ChangeDetail` 不另做快取**：它只在使用者看某個 change 時才讀，且會隨 tasks 勾選頻繁變動。每次 IPC
  現讀即可。

**替代方案（已否決）**：讓 renderer 輪詢。否決 —— agent 寫檔的節奏不可預測，輪詢要嘛太慢（看不到 agent
剛勾掉的 task）要嘛太吵。

### D5 — 主行程負責把 core 的絕對路徑翻成 folder-relative 的 relPath

core 的 `SpecInfo.path` **是絕對路徑**（已實測）。直接送給 renderer 會**破壞邊界語彙** —— renderer 的
全部設計前提是「它沒有詞彙表達 workspace 之外的位置」，一旦 DTO 裡出現絕對路徑，這個前提就破了。

**決策**：主行程在回應 `openspec.*` 之前，把所有路徑欄位轉成**相對於該 folder root** 的 relPath
（`path.relative(root, abs)`），且轉換後 **必須通過 `isWithin` 檢查**（沿用 `src/main/fs-boundary.ts`）。
轉換不出來（或落在 root 之外）的項目，其路徑欄位回 `null`，而不是回絕對路徑 —— **側欄少一個「跳到檔案」
的入口，好過洩漏一個絕對路徑。**

這也讓交叉導覽（D7）成立：renderer 拿到的 relPath 正好是 `fs.readFile(folderId, relPath)` 吃的東西。

### D6 — slug / topic 是不受信任的輸入，必須以「查表」而非「拼路徑」使用

`openspec.*` 引入了新的輸入型別：change 的 `slug`、spec 的 `topic`。它們是使用者 repo 裡的目錄名，
會被 core 拿去拼路徑（`readChange(repoPath, slug)`）。**一個 `slug = "../../../../etc"` 就是 path traversal。**

**決策**：主行程收到 `slug` / `topic` 後，**先在快取的 `ScanResult` 裡查它是否存在**，只對查得到的
identifier 呼叫 core。查不到 → 回 `{ ok: false, code: 'ENOENT' }`，**不呼叫 core**。

這比「檢查 slug 是否含 `..`」更強：它是白名單（只有掃描確實發現的 change / spec 才可讀），而不是黑名單
（列舉危險字元，總有漏網的編碼形式）。快取（D4）讓這個查表是零成本的。

**注意**：這條與 `fs.*` 的邊界防護是**互補而非重複**的。`fs.*` 防的是 renderer 給的 relPath；`openspec.*`
防的是 renderer 給的 slug / topic。兩者的信任模型相同（防的是被入侵或有 bug 的 renderer），但輸入的
詞彙不同。

### D7 — 交叉導覽以「導航意圖」貫穿兩個身分，由 `MainStage` 承接

side panel 一次只顯示一個身分（`workspace-layout` 的既有 requirement），所以「從 spec 跳到它的 `.md` 檔」
必然是一次**跨身分**的導航：切到 Files 身分 + 開啟那個檔。

**決策**：`MainStage`（PanelIdentity 的擁有者）提供一個 `navigate({ identity, target })` 的入口，
兩個身分都可以呼叫它。

- **OpenSpec → Files**：spec / change artifact 的標題旁提供「在 Files 中開啟」的入口，帶著 D5 的 relPath。
- **Files → OpenSpec**：Files 身分開著的檔案若落在 `openspec/specs/<topic>/` 或 `openspec/changes/<slug>/`
  之下，提供「在 OpenSpec 中檢視」的入口（由 relPath 反推 topic / slug）。

**Files 身分現有的 dirty buffer 不受影響** —— 跨身分導航不卸載 dirty buffer（Phase 3 已保證「dirty buffer
跨換頁與跨 folder 存活」）。

### D8 — ~~Graph 是自寫的二分圖~~ **已作廢（使用者實測後推翻）**

> **原決策**：自寫 SVG 二分圖（左欄 changes、右欄 specs、中間連線），零新依賴，理由是 spek 的
> d3 force graph 在 320px 側欄裡會擠成一團。
>
> **使用者實測後的判定：「四不像，不好用」。** 而且他指出了一個我從頭到尾搞錯的事實 ——
> **Graph 與 Timeline 在 spek 是兩個不同的功能**（`/graph` 的 d3 力導向圖、`/timeline` 的
> Gantt），我把兩者混為一談，做出來的東西哪個都不是。

**新決策**：搬 spek 的**兩個**視覺化元件，並把它們放進**全視窗 overlay**（見 D12）——
一旦離開 320px 的側欄，原決策的整個前提（寬度）就不存在了。

- **Graph** = spek 的 `GraphView`（d3-force + zoom/pan/drag，spec 是圓、change 是圓角矩形）。
- **Timeline** = spek 的 `TimelinePage`（Gantt：橫軸日期、一列一個 change、bar 自 `createdDate`
  到 `archivedDate`、active 延伸至 today 並畫箭頭、today 虛線、hover tooltip）。

**現有的 IPC 不必改**：`getChanges` 已經帶著 `createdDate` / `archivedDate` / `status` /
`taskStats`，`getGraphData` 已經回 `{ nodes, edges }`。而且因為我們是**非聚合**掃描，node id
是 `change:<slug>` / `spec:<topic>`，正好符合 spek `grouping.ts` 的 `stripPrefix` 預期
（聚合模式的 id 會多一段 worktree key，反而會 parse 錯）。

### D11 — 側欄的 Specs / Changes 改為兩棵樹，nav 由四個縮為兩個

**使用者的判定**：「Specs 跟 Changes 這兩個 nav 放在這邊感覺太浪費了」。

而探查推翻了另一個共同的前提：**spek web 的 Sidebar 根本不是兩棵樹** —— 它只是 5 個扁平的
nav link，所有內容都在主內容區的 pages 裡。**真正的兩棵樹在 VSCode extension**
（`packages/vscode/src/tree-provider.ts`），而那正是**為 ~300px 窄側欄設計的** —— 那才是我們
該抄的對象，不是 web。

**決策**：side panel 的 OpenSpec 身分改為兩個視圖：

- **本 change**（不變，見 D13）
- **瀏覽**：上下堆疊、各自可收合的兩棵樹
  - **Specs 樹**：`spec topic → heading(h2/h3)`，兩層。heading 由 core 的 `extractHeadings` 解析
    —— 那個 subpath 是 **node-free** 的，renderer 可以 runtime import，**不需要新的 IPC**。
  - **Changes 樹**：`Active / Archived 兩個群組 → change slug`（葉節點），帶 tasks 進度。

點 change 的葉節點 = 錨定它（沿用 D3）。點 spec topic / heading = 檢視該 spec。

### D12 — Graph 與 Timeline 放進全視窗 overlay，不放側欄、也不放主舞台

Timeline 的最小可用寬度是 **920px**（label 欄 200 + chart 最小 720，皆為 spek 的寫死常數）。
側欄是 320–620px —— 在 320px 裡只看得到時間軸的六分之一。**它不是「調一調常數就好」的問題，
是這兩個東西根本不屬於側欄。**

**決策**：全視窗 overlay。側欄留兩個入口，點下去蓋滿視窗，`Esc` 關閉。

**理由**：Graph 與 Timeline 是「**搞懂全局**」的動作，不是「一邊駕駛 agent 一邊盯著」的動作 ——
它們沒有與 terminal 並存的需求。**替代方案（已否決）**：放進主舞台當一個分頁 —— 那會模糊
「主舞台屬於 terminal」這條線（PRD §6.2），而且換來的並存能力沒有人需要。

### D13 — 「本 change」的 artifact 以分頁並排，不以區塊堆疊

**使用者的判定**：堆疊「在找資料的時候不好找」。

初版把 tasks 與 spec deltas 攤開、proposal / design 收合成區塊，一路往下堆。要找一段內容得先想
它在第幾個區塊、再捲過前面所有東西。

**決策**：**每個 artifact 一個分頁**（Proposal │ Design │ Tasks │ Specs），一次只顯示一個 ——
與 spek web 的 `ChangeDetail`（`artifacts.map(...)` 餵給 `TabView`）同一個編排。順序以 schema
宣告的 `schemaOrder` 為準。

**進度條留在標題底下、不進分頁** —— 它是這個 change 的狀態摘要，不論你正在讀哪個 artifact 都
想看得到它。

> 初版之所以漏掉 proposal / design，是因為 **mockup 的「本 change」只畫了 tasks 與 spec
> deltas** —— 而我把雛型的簡化當成了規格。雛型是**版面與互動**的權威，不是**內容完整性**的
> 權威：core 一直都把那些 artifact 回傳了。

### D9 — delta spec 的解析在 renderer 做，純字串處理、可單元測試

「本 change」tab 的 SPEC DELTAS 區塊要呈現：requirement 區塊 + `ADDED` / `MODIFIED` / `REMOVED` badge
+ BDD 關鍵字上色。

core 的 `ChangeArtifact`（`kind: 'specs'`）回的是 **raw markdown**（`specs: { topic, content }[]`），
沒有結構化的 delta 資訊。而 OpenSpec 的 delta spec 有穩定的格式（已核對本 repo 的 archived changes）：

```
## ADDED Requirements          ← badge 從這個 section header 推導
### Requirement: <名稱>
#### Scenario: <名稱>
- **WHEN** …                   ← BDD 關鍵字是 markdown 的 strong
- **THEN** …
```

**決策**：在 renderer 寫一個純函式 parser（`shell/openspec/delta.ts`），輸入 raw markdown、輸出
`{ verb: 'ADDED'|'MODIFIED'|'REMOVED'|'RENAMED', name, body }[]`。它不碰 DOM、不碰 IPC，可以用 `node:test`
單元測試（給一份 fixture markdown，斷言解析結果）。

BDD 關鍵字的上色**不做第二個 parser** —— 交給既有的 `react-markdown`：`**WHEN**` 已經是 `<strong>`，
以 `components.strong` 依文字內容（`WHEN` / `THEN` / `AND` / `MUST` / `SHALL`）決定顏色即可。
**不加 `rehype-raw`、不覆寫 `urlTransform`** —— delta spec 是使用者 repo 裡的內容，是不受信任的輸入
（Phase 2 的教訓）。

**放在 renderer 而非主行程的理由**：它是呈現層的關注點（要不要顯示 badge、怎麼分區塊），把它放主行程
會讓 IPC 契約綁死一種呈現方式，也偏離了「IPC 契約對齊 `ApiAdapter`」（D1）—— `ApiAdapter` 回的就是
raw content。

### D10 — 補上 mockup 用到但 `@theme` 缺的設計 token

mockup 的 OpenSpec 區塊用到 `--blue`（`WHEN` / `MODIFIED` badge）、`--green`（`THEN` / 已完成 checkbox）、
`--red`（`MUST`）、`--accent-soft`（active nav tab 底、highlight row），而 `src/renderer/src/index.css`
的 `@theme` 目前沒有這四個。

**決策**：值以 mockup 的 `:root` 為準補進 `@theme`（`--color-blue` / `--color-green` / `--color-red` /
`--color-accent-soft`），沿用既有 token 的命名慣例。**不新增 `tailwind.config.js`** —— 本 repo 的 Tailwind v4
是 CSS-first，token 全在 `@theme`。

## Risks / Trade-offs

- **[大型 repo 的掃描延遲]** core 的掃描會遞迴讀 `openspec/` 且 spawn 一次 `git log`。folder 很大時，
  第一次開側欄可能有可感知的延遲。→ **Mitigation**：per-folder 快取（D4）讓延遲只付一次；UI 在資料未
  到達時呈現 loading 而非空白（避免「側欄壞了」的錯覺）。若實測延遲不可接受，再考慮啟動時預熱當前 folder。

- **[chokidar 監看整個 `openspec/` 的成本]** `openspec/changes/archive/` 會隨時間長大（spek 自己已有 67 個
  archived changes）。遞迴監看整個目錄樹要付 inode watch 的成本。→ **Mitigation**：先實作最單純的版本
  （監看整個 `openspec/`），並在 probe 中量測。若成本過高，archive 目錄的內容實際上**只增不改**，可以
  改為只監看 `openspec/specs` 與 `openspec/changes`（depth 限制），archive 的變動靠「archive 動作本身會
  動到 `openspec/changes/`」間接偵測到。

- **[二分圖在大 repo 難讀]** → **Mitigation**：D8 的退路（互動式清單），不需改 IPC 契約。

- **[「錨定 change」不自動推導，使用者要多點一下]** 這是刻意的（D3）。→ **Mitigation**：單一 active change
  時自動錨定（涵蓋最常見的情境：一個 repo 同時只在做一個 change）。**若使用者實測後覺得多此一舉，
  再檢討** —— 但寧可少猜，不要猜錯。

- **[delta spec 的格式若改變，parser 會失效]** OpenSpec 的 delta 格式不是我們控制的。→ **Mitigation**：
  parser 對認不得的內容**降級為原樣渲染 markdown**（不 throw、不顯示空白）。單元測試涵蓋「格式不合預期」
  的 fixture。

- **[預設身分翻回 OpenSpec 會改變既有使用者的第一印象]** 對只用 Files 的 repo 沒有影響（OpenSpec 身分
  停用時仍退回 Files，`MainStage` 的既有衍生邏輯已處理）。→ 可接受。

## Open Questions

- **側欄的 graph 在真實 repo（上百個 change）中是否仍可讀？** D8 的退路已備妥，但要等實作後在真 repo 上
  看過才知道要不要走。
- **`openspec/` 的 watcher 是否該在 folder 未被選中時停掉？** 目前傾向：只監看**當前選中的 folder**
  （其餘 folder 的側欄反正沒在顯示）。但這會讓「切回某個 folder 時」需要重新掃描。先實作「只監看當前
  folder」，並在 probe 中驗證切換 folder 後側欄仍會更新。
