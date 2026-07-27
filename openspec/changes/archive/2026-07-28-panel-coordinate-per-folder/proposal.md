## Why

**沒有開 session 時，側欄的 repo 選擇器與工作目錄選擇器都完全無法使用。**

根因寫在 `side-panel-source` 的規格裡：「沒有任何 session 時，側欄來源 SHALL **退回** rail 的
focused folder」——「退回」是一個**唯讀的 fallback**，不是可編輯的狀態。於是實作把兩個選擇器
都 gate 在 `focusedId !== null`（`MainStage.tsx` 的 `canSelectSource`，`FilesPanel` 的
`canSelectWorktree` 直接沿用它），連 i18n 字典裡都有一句
`"Start a session in this repo to switch working directory"` 在向使用者解釋這個限制。

**而側欄是一個「閱讀」工具，不該需要先開一個 terminal 才能用。**

第八次 dogfooding 的第二個發現：使用者剛封存 `files-in-worktree`（Files 的工作目錄選擇器），
第一次要 dogfood 那個新功能就被擋住 —— 他要看的 repo 沒有 session。**一個剛做完的功能，使用者
第一次要用就用不了，而擋住他的是一個與該功能無關的既有限制。**

這是 `side-panel-repo-anchor` 當初的盲點：它的痛點來自「我在 repo A 的 session 裡叫 claude 去改
repo B」，整個設計都在回答「**有** session 時」的問題，從沒問過「**沒有** session 時使用者要不要
用側欄」。per-session 這個粒度是從「比照 `anchoredChange` 的自然擴展」推導出來的，而那個類比不
成立：`anchoredChange` per-session 有道理（每個 session 在做不同的 change），側欄**來源**沒有
同樣的道理。

**這個盲點已經在 codebase 裡長出一個影子。** `MainStage.tsx:41` 有一個 per-folder 的 `viewing`
map，註解自己寫著：

> 沒有任何 session 時，「本 change」看的是哪個 change —— 錨定無處可去，**改由 folder 持有**。

三個座標欄位中已經有一個自發地長出了 per-folder 版本，只因為 per-session 回答不了「沒有
session」。那不是一個補丁，那是模型錯了的徵狀。

## What Changes

- **側欄的座標由 per-session 改為 per-folder。** rail 的每個 repo 各記著「我站在這裡時，側欄看
  什麼」。三個欄位一起搬 —— 側欄來源 repo（`panelFolderId`）、工作目錄（`panelWorktreeKey`）、
  錨定的 change（`anchoredChange`）。**BREAKING**（對已封存的 `side-panel-source` 而言）。
- **兩個選擇器的 `canSelect` gate 整個消失。** 沒有 session 的 folder 一樣選得了來源與工作目錄，
  `files.worktree.needSession` 這句文案隨之刪除。
- **`MainStage` 的 `viewing` map 消失** —— 它是這個分歧的具體化，per-folder 之後無事可做。
- **落盤位置搬家**：三個欄位離開 `sessions.json`，改存於 folder 維度。**既有資料回到預設一次**
  （見下「代價」）。
- **`anchoredChange` 一起搬，不留在 session 上。** 側欄的完整座標是
  `(來源 repo, 工作目錄, change)`；三個欄位若歸屬不同層級，模型會比現在更亂 —— 而且錨定正是那個
  已經長出 per-folder 影子的欄位。
- **「回到自身 repo」的捷徑仍在，但「自身」的定義改變**：由「focused session 所屬的 folder」變成
  「rail 上當前選中的 folder」。有 session 時兩者恆等（session 一律屬於 focused folder），沒有
  session 時前者不存在 —— 這正是本 change 要修的那個洞。

### 為什麼不是「保留 per-session + 另加一個可寫的 fallback」

那個選項**不消滅分歧，它管理分歧** —— 而且需要一個額外的裁決：**建立第一個 session 時，側欄要不
要跳回該 session 的預設？**

- 跳回 → 使用者正在讀的東西被換掉（他開 session 的目的往往正是為了處理眼前讀到的那個 change）。
- 不跳回 → 違反 `side-panel-source` 自己「預設為 session 所屬 folder」那條 requirement。

**兩個答案都是壞的。** 這個形狀在本 repo 出現過兩次，結論都一樣：`session-title-authority` 移除
「pty 想改名要問過」的對話框、`side-panel-repo-anchor` 自己取消掉的「跟隨/釘住」toggle ——
**一個需要額外裁決的分歧，通常表示模型錯了，而不是缺一條規則。**

### 第三個選項（側欄自己的全域座標）已否決

不隸屬 session 也不隸屬 folder 的話，切 repo 時側欄不跟著走 —— 比現況更糟。「側欄跟隨我在
rail 上的位置」是既有且正確的語意，本 change 保留它，只是把跟隨的**單位**由 session 換成 folder。

### 原始痛點仍然解得了

`side-panel-repo-anchor` 的情境（選中 repoA、側欄指 repoB、terminal 不受影響）per-folder 完全
表達得出來 —— folder A 的記錄就是 `{來源: B, …}`。失去的只有「同一個 repo 的**不同 session**
各自不同側欄座標」，使用者已知情並接受。

### 留給 issue #5 的接口

#5（rail 把 worktree 列為一級組織單位）與本 change 在同一塊資料上交會，且**它一定會再動這塊資料**
—— 因為它改變的正是「rail 的項目是什麼」。差別只在那是**擴充**還是**重做**：

- 若座標的鍵是「**rail 項目的識別碼**」（今日恰好等於 folder id），#5 是擴充鍵空間。
- 若把三個欄位塞進 `workspace.json` 的 folder 陣列，就把「鍵是一個 folder」焊死了 —— #5 屆時是
  重做。本 change 因此傾向獨立的落盤（落點由 design 定案）。

而 per-folder 的模型恰好回答了 #5 那個自陳未解的問題（「rail 上選中一個 worktree 之後，OpenSpec
身分該顯示什麼？」）：**選中一個 worktree ＝ 設定座標的工作目錄維度，不是 repo 維度** —— OpenSpec
維持聚合（`worktree-aggregation` 的價值主張保住），Files 以該 worktree 為根。這與
`side-panel-source` 已定案的「兩身分共用同一來源，作用域為 **repo 維度**」完全一致。
**本 change 不實作它**，只是不做出讓它加不進來的設計。

## Capabilities

### New Capabilities

無。本 change 是既有能力的**改基**，不引入新能力 —— 座標的三個維度各自已有歸屬的 capability
（`side-panel-source` / `side-panel-worktree` / `openspec-panel`），改變的是它們隸屬於誰、存在哪。

### Modified Capabilities

**per-session 的假設滲透得比初估更深 —— 逐條盤點（第二輪由獨立稽核複驗）之後的完整清單：**

- `side-panel-source`：**核心** —— 「側欄來源為 per-session」改為 per-folder；「沒有 session 時
  退回 focused folder」這條唯讀 fallback 移除（它是本痛點的根因）；「回到自身 repo」的「自身」
  重新定義為 rail 的 focused folder；新增一條**座標持久化**的 requirement（涵蓋三個維度，並
  明文承接 `session-persistence`「落盤不得含路徑詞彙」的邊界論證）。
- `terminal-sessions`：**移除**整條「session 可錨定一個 change」（含 5 個 scenario）—— 那是「錨定
  為 per-session」的**根**。其中「錨定由使用者建立、SHALL NOT 自 pty 的輸出推測」的論證遷往
  `openspec-panel`；「session 建立時自動錨定」那半整個消失（動態的衍生預設涵蓋它）。
  **順手清掉一個既有矛盾**：該條的「錨定關係 SHALL NOT 持久化」與 `session-persistence` 的
  「錨定的 change 一併回來」對立 —— `session-restore` 加了持久化卻沒回寫這一條。
- `side-panel-worktree`：「工作目錄的選擇為 per-session」改為 per-folder；「切換側欄來源 repo 時
  重置工作目錄」的主詞由 session 改為 folder。
- `openspec-panel`：三條以 session 為主詞的 requirement 改基 —— 「側欄跟隨 focused session 的錨定
  change」、「於瀏覽視圖選擇 change 即錨定至當前 session」、「無錨定 change 時本 change 視圖呈現
  空狀態」；並接收自 `terminal-sessions` 遷來的「錨定不由系統推測」。
- `session-persistence`：「session 跨應用程式重啟與 renderer 重新載入存活」的**事實清單移除三個
  側欄座標欄位**與對應的 scenario；「持久化不得把路徑詞彙交給 renderer」中指名「側欄的工作目錄」
  的那一段改為指向新的落腳處（**該原則本身不鬆動**，只是換一份規格承載它）。
- `artifact-continuation`：「新建的 session SHALL 錨定該 change」改為「該 change SHALL 成為該
  session 所屬 folder 的錨定」（意圖不變、機制改變）；「無錨定 change 時不呈現入口」的 scenario
  主詞由 session 改為側欄來源。**其餘四個條件的措辭仍然成立，不動** —— 條件 1「側欄來源等於
  focused session 自身所屬的 folder」在新模型下依然為真（session 恆屬 focused folder，而座標的
  鍵就是 focused folder）。
- `status-bar`：「狀態列呈現 focused session 的脈絡」中「以及**它**錨定的 change」—— 錨定不再是
  session 的關係。**其餘關於側欄來源的兩個 scenario 仍然成立，不動。**
- `file-explorer`：「Files 身分呈現當前 folder 的檔案樹」中定義「當前 folder」的那一段 ——
  「它是 focused session 的側欄來源…（沒有任何 session 時退回 focused folder）」不再成立。
- `openspec-data-access`：「主行程供應可供選擇的工作目錄清單」中，論證識別碼為何必要的那個括號
  指向 `session-persistence` —— 而工作目錄的選擇改由 `side-panel-source` 落盤之後，那個指路牌會
  指向一份不再承載該原則的規格。**純交叉引用修正，行為不變。**

**盤點後確認不受影響的**：`workspace-layout`（「選單以滑鼠選取後即關閉」用側欄來源下拉當例子，
敘述仍然為真）、`workspace-folders`（座標不與 folder 清單同居，見 design D2）、`filesystem-access`
（座標不改變任何可達位置）、`keyboard-navigation`（其「錨定」指的是選單的錨定位置，同名不同義）。

**順手償還的一筆技術債**：`openspec-panel` 的「瀏覽視圖以兩棵樹呈現**當前 folder** 的 OpenSpec
結構」—— 那個說法自 `side-panel-repo-anchor` 起就已過期（應為側欄來源）。不是本 change 造成的，
但本 change 正在把整份側欄的座標寫清楚，一併修正。

## Impact

**代價（誠實列出）：**

1. **這是推翻一個已封存 change 的核心決定。** `side-panel-source` 的 5 條 requirement 有 3 條要改。
2. **既有的側欄座標回到預設一次。** `sessions.json` 裡的 `panelFolderId` / `panelWorktreeKey` /
   `anchoredChange` 不再被讀取。**不做遷移** —— 沒有「哪個 session 是 focused」被持久化，選誰的
   座標當 folder 的座標都是任意的，而一個猜錯的還原比一個乾淨的預設更難理解。舊欄位留在檔案裡直到
   下次改寫，不影響解析（`parseSessionEntry` 對未知欄位是容忍的）。
3. **失去「同一 repo 的不同 session 各自不同側欄座標」。** 使用者已知情。
4. **九份 delta spec，含 6 條 ADDED、15 條 MODIFIED、5 條 REMOVED**（REMOVED 分佈於四份：
   `side-panel-source`／`side-panel-worktree`／`terminal-sessions` 各 1、`openspec-panel` 2），
   且多條 requirement 的 scenario 數量不小（`session-persistence` 的事實清單有 10 個、
   `terminal-sessions` 被移除的那條有 5 個）—— 漏抄會在 archive 時永久遺失既有內容。
   **這個統計本身是承重的**：archive 時要拿它對 `git diff --numstat` 的刪除量。
5. **兩個行為退步。**
   - 衍生預設由「半黏著」統一為動態（design D9，已裁決）：「agent 建了第二個 active change →
     側欄掉回空狀態」。
   - **無 session 時的錨定，其歸屬由「來源 repo」變成「rail 項目」**（design D1 的代價二）——
     今天「站在 A、指向 B、點了 B 的 change X」，切到 B 看得到 X；改基後看不到。那是 `viewing`
     map 一個未經論證的實作選擇（鍵是 `panelFolder.id`），但它確實是既有行為。

**主行程：**
- `src/main/session-store.ts` — `PersistedSession` 移除三個欄位與 `parseSessionEntry` 的對應解析
- 新的 per-folder 座標 store（落點由 design 定案）+ 其 IPC namespace
- `src/main/workspace-store.ts` — 若座標與 folder 清單同居則此處；否則為新 store 提供 folder 存在性

**renderer：**
- `terminal/sessions.tsx` — 移除 `panelFolderId` / `panelWorktreeKey` / `anchoredChange` 三個欄位、
  `setPanelSource` / `setPanelWorktree` / `anchorChange` 三個 setter、`panelSourceOf` /
  `panelWorktreeOf` / `anchoredChangeOf` 三個讀取器
- `shell/MainStage.tsx` — `panelFolder` 的解析、`viewing` map 刪除、三個 change* 回呼改寫
- `shell/side-panel/SidePanel.tsx`、`PanelSourceBar.tsx`、`files/WorktreePicker.tsx`、
  `files/FilesPanel.tsx` — `canSelect` / `canSelectSource` / `canSelectWorktree` 整條移除
- `shell/StatusBar.tsx` — 側欄來源與錨定 change 的讀取改走 per-folder

**字典：** `files.worktree.needSession` 刪除（唯一消費者是即將消失的那道 gate）。

**驗收：**
- `probe:openspec` — 「切換 focused session 後側欄跟隨」等以 session 為主詞的段落改基；
  **新增「沒有任何 session 時兩個選擇器可用」**（本 change 的核心驗收，且必須有對照組 ——
  它正是先前恆為停用的那條路徑）
- `probe:files`、`probe:workspace` — 工作目錄選擇器與側欄來源的段落
- `probe:shell` — 新 IPC namespace 的白名單守衛（**加能力到 preload 就要動它**，這道守衛已經
  在 `panel-drive-and-shell-affordances` 咬過一次）
- `npm test` — `session-store.test.ts` 移除三個欄位的測試、新 store 的測試（含損毀隔離與對照組）
