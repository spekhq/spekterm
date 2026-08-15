# Design — 補上 panel-coordinate-per-folder 的三個驗收缺口

## Context

三條缺口的實作都在原處、都沒有壞，缺的只是**載體**。因此本 change 的全部技術內容就是
「這三條各自的前置狀態怎麼造、造完怎麼還原、以及怎麼確保它有鑑別力」。

現場的四個結構事實決定了可行的作法：

1. **`probe:openspec` 的五個段落是線性依賴鏈、共用同一個 app**（`SECTIONS` 的 `deps`，
   `probe-openspec.mjs:3386`）。**但段落機制本身不要求共用** —— `afterMode` 只關 `context.app`
   （`scripts/lib/sections.mjs`），一個不宣告 `deps`、自己 `launch` 的段落在自己的 `finally`
   收掉即可。先例是 `probe:keyboard` 的 `checkEmptyWorkspace`（`probe-keyboard.mjs:2027`），
   它自帶 `seedProfile([])` 與 `launch`，由 `probe-coverage-gaps` 交付。
2. **`seedProfile(folders)` 目前只寫 `workspace.json`**（`probe-openspec.mjs:325`）。落盤還原的
   驗收此前一律走 `Page.reload`，其註解明寫「reload 走與『關 app 重開』**同一條** persist→restore
   落盤路徑」（`:2346`）。
3. **worktree 段落在 `createSession`（`:2515`）之前有兩塊**：工作目錄選擇器那一小塊
   （`:2431–2464`，末尾以 `resetWorktreeToSelf` ＋ `CLICK_IDENTITY('◈')` 還原），
   以及其後四條聚合斷言（`:2466–2514`，開頭是 `CLICK_VIEW(browse)`）。跨身分導覽的既有斷言
   （`邊界內 worktree 的 artifact 可跨身分導覽`，`:2527`）落在 `createSession` **之後** ——
   這正是 issue #10 第 2 條所述「驗收一律先建 session，於是那一支零覆蓋」的現場。
4. **錨定的鍵是 rail 上選中的項目，不是側欄來源。** `coordinate = panel.coordinateOf(selection)`
   （`MainStage.tsx:90`）、`anchorChange = (slug) => panel.setAnchor(selection, slug)`（`:216-221`）。
   **這個事實讓一整類反向斷言失去意義**，見 D4。

## Goals / Non-Goals

**Goals:**

- 三條 scenario 各有一條**能區分正確與錯誤實作**的斷言。
- 把驗收前提中承重的部分寫進 spec，讓假綠機制下次表達不出來。
- 不改變任何既有斷言的判準，也不改變段落之間既有的狀態契約。

**Non-Goals:**

- **不動產品程式碼。** 三條的實作都已交付；本 change 若需要改實作才驗得過，那是另一張票。
- **不新增 fixture repo、不改變 rail 的項目數。** 見 D4 末段。
- 不處理 issue #10 文末那條「側欄的工作目錄與 session 開啟的工作目錄各自保存」——
  它刻意不補，理由（兩個維度由不同 store 管，結構上的保證比原本那條單元測試更強）記在已封存的
  `tasks.md` 8.0，本 change 不推翻它。

## Decisions

### D1 — 第 3 條（來源指向的 folder 已被移除）以**自帶 profile 的獨立段落**承擔

該 scenario 的措辭是「repoB 於應用程式**未開啟期間**被移出 workspace」。**一份 `panel.json` 的
來源欄位指向一個不在 `workspace.json` 裡的 folder 識別碼，就是那個情境本身** —— 不需要在執行中
移除 folder。

作法：新增一個**不宣告 `deps`** 的段落，自己 `seedProfile`（含構造的 `panel.json`）、自己
`launch`、自己在 `finally` 關閉，形制照 `checkEmptyWorkspace`。

**為什麼不是「擴充五段共用的 `seedProfile`」**：那條路走不通，而它走不通的理由正是 D2 ——
鑑別力需要 `panel.json` 裡**另有一筆非預設的合法來源**，而五段共用的 fixture 裡**每一個 folder
的「來源為自身」都是承重的**：

| folder | 依賴它的既有斷言 |
|---|---|
| `repo-plain` | `:2166` 不含 openspec 的 folder 退回 Files 身分（`openSpecEnabled = panelFolder.hasOpenSpec`） |
| `repo-single` | `:1407` 尚未建立 session 就呈現唯一的 active change（衍生預設取自 panelFolder） |
| `repo-derived` | `:1516` 恰一個 active change 時由衍生預設呈現它 |
| `repo-archived-only` | `:2067` 沒有 active change 時無錨定 |
| `repo-many` | `:3286` 註解明寫「它自己的來源預設為它自己」 |
| `repo-worktree` / `wt-inside` | `:2428` 起、`:2938` 起的整段聚合驗收 |
| 全域項目 | `:3228` 全域項目的側欄來源預設為未選定 |

**獨立 profile 沒有這個問題** —— 它的 fixture 由這一段自己定義，愛放什麼放什麼。

> 本決策的第一版否決了獨立段落，理由是「`afterMode` 的關閉責任是為共用 app 寫的，要開特例」。
> **那個理由不成立**（見 Context 第 1 點），而它同時使 D2 變得無法滿足。獨立段落是唯一能同時
> 滿足鑑別力與不污染共用狀態的方案。

### D2 — 第 3 條的鑑別力由「同一份 `panel.json` 裡另有一筆合法來源」提供

**「退回自身」就是預設值** —— 一個完全不讀 `panel.json` 的實作也會通過。這條若只斷言退回自身，
它是一條假綠，而且是本 repo 記載過最多次的那一種。

因此該段落自己的 `panel.json` 必須**同時**帶一筆**合法**的來源（某 folder 指向另一個真實存在的
folder），並斷言它**確實被還原**。兩條並列才構成判準：

- 合法那筆被還原 ⇒ `panel.json` 確實被讀了
- 非法那筆退回自身 ⇒ 是**那一筆**被丟棄，而不是整份被忽略

scenario 另有「**且應用程式正常啟動**」一句，以既有的 `awaitMounted` 明確表達。

### D3 — 第 2 條插在**聚合斷言之後、`createSession` 之前**，並自帶還原

落點：`probe-openspec.mjs:2514` 之後、`:2515` 的 `createSession` 之前。

**這個位置是唯一有鑑別力的**，三個候選只有它成立：

| 候選落點 | 為什麼不行 |
|---|---|
| `:2450–2463`（工作目錄選擇器那一小塊之內） | 此刻座標**已經是** `feat-inside`（`CLICK_WORKTREE_ITEM` 剛切過去），對照組下斷言照樣綠 ⇒ **假綠** |
| `:2450` 之前 | 新的導覽先把根切過去，既有的 `:2459` 那條變成貼空 ⇒ 打壞一條既有斷言的鑑別力 |
| **`:2514` 之後** | 座標已於 `:2463` 還原為 folder 自身、身分已於 `:2464` 回到 OpenSpec ⇒ 乾淨的起點 |

**還原必須自帶，不能沿用既有的那一次** —— `:2463` 的 `resetWorktreeToSelf` 在新落點**之前**。
跨身分導覽會改變工作目錄與身分兩個維度，兩者都跨段落存活，因此本段結束時要各還原一次。

**斷言樹根的寫法**：範本是 `:3093–3105` 那**兩條並列**（新根的項目在 **且 folder 自身的根層項目
不在**），不是 `:2459` 那條。`:2459` 的註解寫著「判準是根的直接子項目」，**實際讀的卻是
`WORKTREE_PICKER`（選擇器的標籤）** —— 名實不符，照抄它會交出一條連「切根沒生效」都測不出來的
斷言。且跨身分導覽之後 Files 呈現的是**檔案檢視器而非樹**（`FilesPanel.tsx:305`），斷言取值的
時點要據此安排。

**與既有斷言的分工**（寫進程式碼註解，否則日後會被當成重複而刪除）：

| 斷言 | 驗什麼 |
|---|---|
| `:2459` `樹根確實切到該工作目錄` | **手動**經工作目錄選擇器切換（且它只驗到選擇器標籤） |
| `:2527` `邊界內 worktree 的 artifact 可跨身分導覽` | 跨身分導覽的入口**在不在**（且已在 session 之後） |
| **本 change 新增** | **跨身分導覽之後樹根有沒有跟著切**，且在**尚無 session** 時 |

### D4 — 第 1 條只驗正向；反向斷言**取消**，因為錨定的鍵是 rail selection

正向斷言（切 rail 到來源 folder，斷言該 change 成為它的錨定）**有鑑別力**：一個「總是寫進
focused folder」的實作會讓來源 folder **沒有**錨定。這一條是本缺口的核心，保留。

**反向斷言（「rail 選中的那一筆未被寫入」）取消。** 推導：

1. 錨定的鍵是 rail selection（Context 第 4 點）。要讓側欄呈現**來源 repo** 的某個 change，
   使用者必須先錨定它 —— 而那一筆**寫進 rail 選中的 folder**。
2. 唯一的例外是衍生預設 `soleActiveChangeForPanel`（`MainStage.tsx:170`），它要求側欄來源
   **恰有一個** active change。`repo-worktree` 有三個（`:268`／`:288`／`:294`），走不到。
3. 於是在觸發入口的那一刻，該 change **已經**是 rail 選中那一筆的錨定。
4. ⇒ 「未**變為**該 change」對**正確**實作為假；改寫成「未**被改動**」則對「兩邊都寫」的錯誤
   實作為真（寫入的是一個已經在那裡的值）。**兩種寫法都沒有鑑別力。**
5. ⇒ 而且「兩邊都寫」在這條路徑上**沒有可觀察的傷害**：rail 選中那一筆的錨定本來就是該 change，
   不存在「先前的錨定被無聲換掉」。

**為什麼不新增 fixture 把它做出來**：要讓 rail 選中那一筆沒有明確錨定，需要一個「**恰有一個**
active change 且該 change 住在 worktree」的來源 repo，走衍生預設那條路。那要新增 fixture repo
並改變 rail 的項目數。第 5 點已經證明它擋住的是一個**沒有傷害的差異** —— 代價高於收益。

> **這條的第一版把反向斷言寫進了 spec delta**，而它做不出來。**擋住它的是獨立稽核，不是推理**
> —— 而下一步（發現它紅、改寫成「未被改動」）會交付一條永遠綠的斷言，並透過 delta 把它寫成
> SHALL：本 change 宣稱要消滅的機制，原封不動重演一次。

前置與位置：於 `runWorktreeAggregation` **末尾**建立（rail 選中另一個 repo、側欄來源指向
`repo-worktree`），理由與該段落本身放在最後一樣 —— 它會動到其他斷言依賴的狀態，且其後只剩
`runQuickOpenSection`。入口的呈現條件只看 `data.worktree && foreignWorktree(...)`
（`ChangeView.tsx:174`），與續寫入口的停用原因無關，因此前置不會死在那裡。

### D5 — 三條驗收紀律進 spec，一條一個能力

`artifact-continuation`、`side-panel-worktree`、`side-panel-source` 各一條。形式沿用
`probe-coverage-gaps` 的 `global-session` delta（陳述 ＋ 假綠機制 ＋ scenario）。

**第三條（`side-panel-source`）不能省。** 第一版以「既有的『還原前的值必須是非預設的』那條註解
涵蓋同一條精神」為由不補，那不成立：**那句話是探針註解而非規格條文**（`probe-openspec.mjs:2349`），
而且它涵蓋的是 **reload 情境**（先經 UI 設成非預設值再 reload）；D2 的情境結構相反 ——
被觀察的值**本身就是預設值**，鑑別力得靠「同一份檔案裡另有一筆合法值被還原」。這是一個新的
假綠機制，而本 change 的整個前提正是「口頭紀律不是機制」。

## Risks / Trade-offs

- **[插入的斷言污染後續段落的狀態]** → 本 repo 付過代價的失效方式（`files-in-worktree`
  一次紅 15 條，**其中兩條反而變成假綠**）。D1 用獨立 profile（結構上不可能污染）、D3 自帶還原、
  D4 在段落末尾。驗收時 `probe:openspec` 必須**完整跑完**並與現況的斷言數逐一比對。
- **[新段落使 `probe:openspec` 多付一次 app 啟動]** → 接受。這是 D1 的成本，換到的是不必在
  五段共用的 fixture 裡找一個不存在的空位。
- **[D4 的前置建立失敗會表現為一連串紅燈]** → 前置步驟以「（前置）」斷言表達，沿用該檔既有慣例
  （如 `（前置）reload 前錨定一個非衍生預設的 change`），使前置失敗與被驗行為失敗可區分。
- **[三條都只在 `probe:openspec`，而該支是線性鏈]** → 既有結構，本 change 不改變它，但驗收時
  要確認總結標示為「**完整執行**」—— 不完整的那一輪不能拿來宣稱缺口已補。

## Open Questions（實作後的結論）

- **D4 還原到什麼程度** —— **已確認：`runQuickOpenSection` 確實依賴**。本段結束時 rail 停在
  **全域項目**、其側欄來源指向 `repo-single`（quick-open 作用域那一塊留下的），因此 D4 的收尾
  把這個狀態完整放回去。實測含該段落的完整輪次全綠。
- **新段落註冊在 `SECTIONS` 的哪個位置** —— **已確認：必須是第一個**。理由比原本預期的強：
  不只是 `deps`，而是**同一個 mode 內所有段落共用同一個 debugging port**，而共用鏈的 app
  直到 `afterMode` 才關閉 —— 排在其後會撞上一個還活著的 app。profile 前綴沿用 `seedProfile`
  的統一命名，`killStrays` 一併涵蓋。

## 實作時才發現的兩個前置（design 未預料，記於此以免重踩）

- **`launch` 無條件需要 `stub`** —— 它以 stub 覆寫 `HOME` 與 `PATH`（那是隔離使用者真正的
  claude 的方式），省略時在 spawn 當下就 `TypeError`。不建 session 的段落同樣要傳。
- **`anchorChange` 只在 OpenSpec 身分內有效** —— 它自己會切視圖（`CLICK_VIEW(tabBrowse)`）
  但**不切身分**。D4 的落點在 quick-open 那一塊之後，而該處結束時身分是 Files，因此前置要先
  切回 OpenSpec。少了它，失敗形式是「錨定回 `null`」並燒掉 42 秒的等待窗口 —— 看起來像錨定
  壞了，而不是像身分不對。
