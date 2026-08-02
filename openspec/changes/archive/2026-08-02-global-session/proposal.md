# 全域 session：不隸屬於任何 repo 的終端

## Why

第九次 dogfooding 的回饋，使用者原話：

> 我需要一個全域的 claude code 或 login session，因為有時候 context 不一定跟任何一個 repo 有關係。

今日 session 的模型是「repo → session」：`terminal.create()` 只收 `folderId`、查表拒絕未註冊的
folder，rail 是 folder 的清單而 session 是它的子列。於是**要開一個終端，必須先有一個 repo** ——
而「問 claude 一個跟手上任何 repo 都無關的問題」「在家目錄底下翻個東西」這類需求沒有位置可放。

**使用者今日的變通是有代價的**：把 `~` 當成一個普通 folder 加進 workspace，確實開得出 session，
但那會把 `fs.*` 白名單與 Files 的檔案樹**對整個家目錄開放** —— 那是真正的邊界擴大。相對地，一個
全域 session 只改變 pty 的**初始工作目錄**，而 `terminal-sessions` 早已明文「此邊界只約束初始工作
目錄，session 一旦啟動即為真實 shell」。**兩者的安全代價不同量級**，這是本 change 存在的理由。

時機也剛好：`panel-coordinate-per-folder`（上一個 change）把側欄座標的歸屬單位刻意措辭為「**rail
上的項目**」而非 folder，並寫明「rail 的項目集合日後可能擴充，屆時座標的歸屬單位隨之擴充，而非
重新設計」。全域項目正是那個擴充的第一個實例 —— 側欄那半**不需要重新設計，只需要多一個鍵**。

## What Changes

- **rail 頂端新增一個固定的「全域」項目**，與 folder 清單之間有明確分隔。它**不可移除、不可拖曳
  排序**（它不是 workspace 的成員，而是這個 app 恆常提供的一格），但其餘行為比照 repo 列：可展開
  session 子列、可自該列建立 session、可被 `Ctrl+↑↓` 切換到。
- **全域 session 的初始工作目錄恆為使用者的家目錄**，由主行程自行解析。renderer **不獲得任何新的
  路徑詞彙** —— 它至多送出「這是一個全域 session」這件事，路徑是主行程的常數。
- **工作目錄比照 repo session 記憶並重生**，且沿用 `session-persistence` 既有的**依 spawn 目標分工**
  —— 那個分工不是實作細節，它決定了兩種 session 記的是不同的東西：
  - **shell** 目標記**最後已知的**工作目錄（主行程觀測 `/proc`），重生時回到那裡。
  - **claude** 目標回到**建立時所選定的**工作目錄（＝家目錄），既有規格明文「SHALL NOT 由觀測 pty
    當下的工作目錄取得」—— agent 的 `cd` 發生在子行程，本來就不改變 pty 自身的位置。
- **全域 shell session 的工作目錄不受路徑夾制**（裁決點，見下）。既有的夾制是「夾回所屬 folder 或
  該 repo 的工作目錄」，而其正當性來自 session **宣稱自己屬於某個 folder**；全域 session 沒有這個
  宣稱，家目錄是它的**起點**而不是它的**邊界**。夾制在這裡唯一的效果會是「重開後莫名跳回家目錄」，
  而使用者說不出為什麼。**保留的是存在性檢查**：目錄已不存在時退回家目錄。
  **`fs.*` 的可達集合完全不因此改變** —— 那條路徑由主行程自行讀取、寫入、使用，renderer 拿不到
  可定址的詞彙。**但要誠實記一筆**：狀態列**會**收到當下的工作目錄以供顯示（既有的 `liveCwdOf`
  路徑），因此家目錄與其後 `cd` 到的位置第一次成為**常態**被送往 renderer 的顯示字串。這不擴大
  可達集合，但它擴大了揭露面，值得寫下來而不是宣稱「renderer 全程沒看到」（見 design D9）。
- **工作目錄恰為家目錄時不偵測 git 工作區狀態**（見 design D10）。該偵測是同步的外部程式呼叫、
  每數秒重複一次；家目錄本身是 git repo 是常見設定（dotfiles），於整個家目錄跑它會週期性地阻塞
  主行程。`cd` 進真正的工作區後照常。
- **來源未選定時 OpenSpec 身分仍可用**（見 design D11）—— 否則側欄的空狀態永遠到不了：身分被停用
  並強制退回 Files，而 Files 在同一個狀態下也是空的，使用者無從得知「選一個 repo 就有了」。
- **冷啟動不預設選中全域項目**（見 design D12）—— 它恆常存在，「預設選中它」會使冷啟動立刻喚醒
  一個 session，而「開 app 只起一個 claude」正是 `session-restore` 花力氣換來的。
- **全域 session 一樣持久化與休眠重建**：清單、使用者取的名字、順序、pty 宣告的標題、claude 的對話
  續接，全部比照 repo session。
- **側欄沿用既有的來源選擇器**：全域項目有自己的一組側欄座標，**預設為未選定（空狀態）**，使用者
  可指向 workspace 中任一 repo。於是「在全域終端裡工作，同時讀著 repo A 的 spec」是成立的。
- **續寫入口在全域 session 上恆為停用**並說明原因 —— 它的條件 1 要求「側欄來源等於 session 自身所屬
  的 folder」，而全域 session 沒有所屬 folder。
- **狀態列為全域 session 呈現對應的脈絡**：沒有 repo 名稱與 git 分支可呈現，改以全域身分標示。

**併收第九次 dogfooding 的第二個回饋**（使用者裁決併入而非另立 change）：

> 我在用 `Ctrl+↑↓` 的時候，如果原本的 repo list 已經超出 viewport 產生 scrollbar 的話，
> scrollbar 不會跟著上下走。

- **以鍵盤改變選取或順序時，目標一併捲入可視範圍。** 今日 renderer **沒有任何 `scrollIntoView`**
  —— rail（`overflow-y-auto`）與 session 分頁列（`overflow-x-auto`）都會捲動，但鍵盤導航從未告訴
  它們該捲到哪。切過去了卻看不到，等於導航沒有完成。
- 涵蓋四顆鍵的**兩個方向**：`Ctrl+↑↓`（rail 縱向）、`Ctrl+Tab`（rail 子列縱向 **+** 分頁列橫向）、
  `Shift+↑↓`（移動後該 repo 可能被推出視野）、`Shift+←→`（分頁列橫向）。**分頁列那半使用者尚未
  回報，但它是同一個根因** —— 不一起收會留下一個一模一樣的 bug。
- **滑鼠操作不受影響**：使用者點得到的東西本來就在視野裡，為它捲動只會讓畫面跳。

**它與全域 session 有真正的耦合，這是併收而非另立的理由**：全域項目位於 rail 頂端，`Ctrl+↑` 自第
一個 folder 循環過去時若捲軸不動，畫面上什麼都不會變 —— 使用者會直接判定「這個快捷鍵壞了」。
兩者也都要改 `keyboard-navigation` 的同一條 requirement。

**不做**（各有獨立的前提，不順手夾帶）：

- 全域 session 的**初始**工作目錄可設定（它恆為家目錄）—— 最後位置的記憶**有做**，見上。
- 多個全域「群組」—— 一格就夠，多一格就要回答「它們的差別是什麼」。
- 讓 Files 身分瀏覽家目錄 —— 那**正是**本 change 拒絕的那條路（見 Why）。

## Capabilities

### New Capabilities

- `global-session`: rail 上一個不隸屬於任何 workspace folder 的固定項目，及其 session 的建立、
  工作目錄、生命週期與邊界論證。涵蓋「它不是 workspace 的成員」所帶來的差異：不可移除、不可排序、
  無 git 分支、無自身 repo 可作為側欄來源的預設值。

### Modified Capabilities

- `terminal-sessions`: 「於選中的 folder 建立終端 session」擴充為涵蓋不隸屬任何 folder 的 session；
  邊界論證延伸 —— renderer 可達的初始工作目錄集合**恰好擴大一個元素，且該元素是主行程的常數**，
  仍不由 renderer 的字串決定。
- `session-persistence`（4 條）: 重建所需的事實中「所屬 folder」需要一個明確的落盤表示；
  「shell 於最後已知的工作目錄重生」的**夾制**對它無對應物，改為只做存在性檢查；「claude 於其建立
  時的工作目錄重生」的**結論**成立但**機制條款**不成立（原文寫「由持久化的工作目錄識別碼查表解析」，
  而全域 session 沒有識別碼可查）；「重建的 session 為休眠態」要明寫**冷啟動不預設選中全域項目**，
  否則它恆存的性質會使那條「至多啟動一個 session」的前提失效。
- `side-panel-source`（2 條）: 座標的鍵空間納入全域項目（**存於分離的鍵空間，不用保留字串當鍵**）；
  **預設值的「該項目自身」對它無定義**，改為未選定；來源指示器對它**不提供「回到自身 repo」捷徑**
  （沒有目的地）但**必須提供「清除來源」**，否則「未選定」是一條單向道，而它正是兩條空狀態唯一的入口。
- `workspace-layout`（2 條 + 2 條新增）: rail 頂端的固定項目及其 session 子列、分頁列與 focus 記憶；
  **OpenSpec 身分的停用條件**收窄為「來源已選定且不含 `openspec/`」；**預設身分**對應調整。
- `keyboard-navigation`（6 條 + 1 條新增）: **四顆以「當前選中的 repo」為作用域的快捷鍵**
  （`Ctrl+Tab`／`Ctrl+T`／`Ctrl+Shift+W`／`Shift+←→`）作用域擴為 rail 項目 —— 它們各帶一句
  「沒有選中的 repo 時 SHALL 為無操作」，那是**行為條款而非措辭**，照字面全域項目上這四顆鍵全部
  失效；`Ctrl+↑↓` 的循環序納入全域項目；`Shift+↑↓` 選中它時無操作；**新增捲動要求**。
- `workspace-folders`: 「清單的順序**就是** rail 上的呈現順序」在 rail 多一個固定項目後為假 ——
  而 design D7 正是要警告不可用 rail 列位置算索引，那條規格卻寫著兩者相等。
- `status-bar`: focused session 為全域 session 時，repo 名稱與 git 分支不存在，呈現全域身分；
  寬度不足時的省略順序隨之調整。
- `artifact-continuation`: 續寫入口的條件 1 對全域 session 恆不成立，需明寫其停用與說明 ——
  否則照字面實作會是一次 `undefined` 的比較，而那類比較此前已經誤判過一個會成功的入口。
- `openspec-panel`: 側欄來源**未選定**時的空狀態（此前每個 rail 項目都有自身 folder 作為預設來源，
  這個狀態不存在）。
- `file-explorer`: 同上 —— 「呈現當前 folder 的檔案樹」在來源未選定時的呈現。

### 明確不修改

- **`filesystem-access` 一條都不改。** 全域 session 不引入任何新的檔案系統定址：renderer 仍以
  `(folderId, relPath)` 定址，而家目錄**不是**任何 folder，因此 `fs.*` 一個位元組都讀不到它。
  這是本 change 與「把 `~` 加進 workspace」之間的全部差別。
- `repo-branch`: 措辭限於 workspace 的 folder，而全域項目不是 folder —— 它不進 folder 清單、
  不可移除、沒有分支可讀。
- `side-panel-worktree`: 工作目錄維度隸屬於**來源 repo**（`side-panel-source` 已如此界定），全域
  項目選定來源之後即照既有規則運作。

## Impact

- **主行程**：`terminal.ts` 的 `create()` 位置解析、`session-store.ts` 的落盤欄位驗證
  （`folderId` 目前是必填且非空的字串）、`session-status.ts` / `status-bar` 的脈絡供應。
- **renderer**：`sessions.tsx` 的 `SessionState.folderId` 與所有 `forFolder` / `focusedIdFor` /
  `countFor` 的鍵、`WorkspaceRail.tsx`、`MainStage.tsx` 的 `folder` prop、`panel-coordinate.tsx`
  的鍵空間、`KeyboardNavigation.tsx` 的 rail 項目序。
- **捲動**：`WorkspaceRail.tsx`（已有 `blockRefs`，拖曳排序量 rect 用 —— 可直接沿用）與
  `SessionTabs.tsx`。副作用 SHALL 於 DOM 更新後執行，**絕不可寫在 `setState` 的 updater 裡**
  （StrictMode 會 double-invoke，這個 repo 因此付過一次「拖曳完全沒反應」的學費）。
- **落盤格式**：`sessions.json` 需能表示「不隸屬任何 folder」；`panel.json` 的鍵需能表示全域項目。
  兩者皆已有版本欄位與損毀隔離，格式演進走既有路徑。
- **風險（需實測，見 design）**：`claude --resume` 的對話查找是 **git repo 關聯**的
  （`session-in-worktree` 的實測結論）。全域對話開在家目錄、也自家目錄續接，同一個目錄理應找得到，
  但家目錄本身是否為 git repo 可能影響行為，必須實地驗證而非推論。

  **採用「claude 回到建立時的工作目錄」使這條風險大幅收窄**：若改成「claude 也回到最後觀測到的
  cwd」，使用者在全域 agent 裡 `cd` 進任一 git repo 之後重開 app，就會從**那個 repo** 去續接一個
  開在家目錄的對話 —— 依上述實測結論，那很可能查無此對話，於是靜默自癒為全新對話（降級方向安全，
  但歷史沒了，且沒有任何訊號）。既有規格的分工避開了它，但仍須實測確認家目錄這個位置本身沒有意外。
- **不影響**：`fs.*` 白名單、CSP、導航防護、編輯器、worktree 聚合、終端偏好與 GPU renderer。
