## Why

側欄的 OpenSpec 身分自 `openspec-worktree-aggregation` 起已經**看得見**每個 git worktree 裡的
change，`session-in-worktree` 也讓 session **開得進去**那個工作目錄。唯獨 Files 身分停在原地：
檔案樹的根**恆為 folder 根**，於是使用者在側欄讀到的永遠是主工作目錄那一份內容 —— 而他正在做的
那個 change，其程式碼躺在 `.claude/worktrees/<slug>/` 底下。

第八次 dogfooding 的原話：「我在 files 沒辦法切換到另一個 worktree 看實際的內容，現在的視角都是
用 branch 的視角去看內容」。現況並非全無出路 —— worktree 位於 folder 邊界內，理論上一層層展開
`.claude/worktrees/<slug>/…` 就到得了。但那是**把工作目錄當成一個碰巧存在的子目錄**：路徑前綴
在每一列上重複、樹的深度平白多兩層、而使用者心裡的那個根本來就是 worktree 自己。

**這正是「一個能力做完一半」的形狀**，與 `worktree-reverse-navigation` 修的是同一種病：那次是
「同一個檔案去得了、回不來」，這次是「同一個 repo，OpenSpec 看得見 worktree、Files 看不見」。
側欄懂 OpenSpec 是這個 app 相對於「開四個終端機分頁」的增量價值，而「每個 change 各自一個
worktree」是使用者自己的標準工作流（`common-openspec-change` skill）—— 側欄讀得到那個 change 的
spec 卻讀不到它的程式碼，價值命題就缺了一半。

## What Changes

- **側欄來源新增「工作目錄」維度**：既有的側欄來源是一個 repo（`panelFolderId`），本 change 為它
  加上第二個維度 —— 該 repo 的哪一個工作目錄。**本階段只有 Files 身分消費它**（OpenSpec 身分維持
  聚合，理由見下），但欄位的語意屬於側欄來源本身，不是 Files 專屬。
- **Files 身分新增工作目錄選擇器**：選定之後，**整棵檔案樹的根就是該工作目錄**，樹上呈現的路徑
  自它算起。選擇器呈現當前工作目錄的識別（分支名），**folder 自身**為預設 —— 不是該 repo 的主
  工作目錄，folder 本身可能就是一個 linked worktree（design D5）。
- **選擇為 per-session 的狀態**，比照 `panelFolderId` 與 `anchoredChange`：隨 session 一併落盤，
  重開應用程式時原樣還原；切換側欄來源 repo 時**重置**為 folder 自身（工作目錄隸屬於某個 repo，
  換 repo 後舊的識別碼不存在 —— 與既有的「切來源時重置 `anchoredChange`」同一條理由）。
- **邊界外的工作目錄於選擇器中呈現但停用，並說明原因**。既有的 `worktree-aggregation` 已明文
  規定「邊界外 worktree 的檔案不在該 folder 的檔案樹中」（它們沒有 folder-relative 路徑），本
  change **不鬆動那條**。但整筆省略會讓使用者以為 app 沒看見它 —— 呈現且停用是誠實的那一邊。
- **跨身分導覽維持雙向可用**：自 OpenSpec 跳到 worktree 裡的檔案時，Files 的工作目錄**跟著切**；
  自 Files 跳回 OpenSpec 的判定不因根改變而失效。
- **未存的變更跨工作目錄切換存活**（它們以 folder-relative 路徑為 key，切根不改變那個 key）。

### 一個必須正面處理的張力：OpenSpec 聚合，而 Files 選一個

`side-panel-source` 有一條 requirement 的論證明白寫著：「若 OpenSpec 聚合而 Files 只能選一個，
兩個身分的來源語意就會分裂」—— 那正是它拒絕「側欄聚合多個 repo」的決定性理由。而本 change 在
worktree 維度上做的，恰好是它反對的事。

**這不是推翻它，因為兩條論證的作用域不同，而分裂在 worktree 維度上早已存在：**

| | repo 維度 | 工作目錄維度 |
|---|---|---|
| OpenSpec 身分 | 選一個 | **聚合**（`openspec-worktree-aggregation` 起） |
| Files 身分 | 選一個 | 選一個（現況＝恆為主工作目錄） |

聚合多個 **repo** 的 change 沒有意義（不同的專案）；聚合同一個 repo 各工作目錄的 change **有**
意義，而且那正是 `openspec-worktree-aggregation` 的價值主張（一次看見所有進行中的 change）。
反過來，聚合同一組檔案的多個版本則毫無意義 —— 那是同一棵樹疊在一起。

**於是這一維的分裂不是本 change 引入的**：現況已經是「OpenSpec 聚合、Files 恆為主工作目錄」，
本 change 只是把 Files 那邊的「選哪一個」從寫死變成使用者可控，分裂的程度沒有改變。
`side-panel-source` 那條的作用域因此要被**明確化為 repo 維度**，否則新舊兩條規格會互相打架
（比照 `session-in-worktree` 修改邊界論證時的教訓：改一條論證，要把宣稱自己是它延續的規格一起找出來）。

### 與 issue #5（rail 把 worktree 列為一級組織單位）的關係

**不合併，但本 change 不做出讓 #5 加不進來的設計。** #5 有三個組成部分，其中「worktree 作為
session 的掛載點」已由 issue #4（`session-in-worktree`）完成，「worktree 作為側欄來源」的 Files
那半即本 change，剩下的是「rail 上可選中」與 OpenSpec 那半。

分開做的兩個理由：

1. **#5 卡在一個本 change 不碰的規格拍板上。** `workspace-folders` 要求 rail 的偵測
   「SHALL NOT 呼叫任何外部程式」，而 core 的 `listWorktrees()` 會 spawn `git worktree list`。
   本 change 用的 `openspec.getWorktreeRoots` 走的是 OpenSpec 的掃描路徑 —— 那一軌本來就 spawn，
   故不觸及該拍板。
2. **#5 自陳「形狀應該由 dogfood 決定」**，而本 change 正是那次 dogfood 的產物。「rail 上選中一個
   worktree 之後，OpenSpec 身分該顯示什麼」（維持聚合則選中無意義，只顯示該 worktree 則退掉聚合的
   價值）是 #5 必須拍板的問題，而目前的 dogfood 訊號尚未觸及它。

因此 per-session 的欄位命名為**側欄來源的工作目錄維度**而非 Files 專屬 —— #5 到來時是**擴充
消費者**，不是拆掉重做。

**不在本 change 範圍內：**

- **檔案的 git 變更狀態**（新增／修改／刪除的標示）—— 同一次 dogfooding 的第二條回饋，獨立成
  另一個 change。它需要 spawn `git`、快取與監看，是一個完整的新資料來源；而它的**基準**正是
  「當下選定的工作目錄」，故順序上排在本 change 之後。
- **擴大 `fs.*` 的邊界至 folder 之外**。見下方 Impact —— 本 change 刻意不動安全邊界。
- **rail 呈現 worktree**（issue #5），與上節的裁決一致。

## Capabilities

### New Capabilities

- `side-panel-worktree`: 側欄來源的工作目錄維度 —— 選擇的語意（per-session、預設主工作目錄、
  切 repo 時重置）、選擇器的呈現與操作、邊界外工作目錄的降級呈現、本階段的消費者範圍
  （Files 身分；OpenSpec 身分維持聚合）。

### Modified Capabilities

- `side-panel-source`: 「OpenSpec 與 Files 兩個身分共用同一個側欄來源」的作用域**明確化為 repo
  維度** —— 工作目錄維度不受該條約束，理由見上節的張力分析。
- `file-explorer`: 「Files 身分呈現當前 folder 的檔案樹」的**根**由 folder 根放寬為「當前選定的
  工作目錄」；隨之，樹上呈現的路徑、項目計數與監看範圍皆以該根為基準。**未存變更的總數則相反 ——
  維持 folder-wide**，理由見該 delta（那不是疏漏，是兩個不同作用域的刻意區分）。
- `file-operations`: 「入口 SHALL 亦可用於空目錄與 **folder 的根目錄**」的根目錄改為**當前選定
  工作目錄的根**。少了這條，選定 worktree 之後 header 的新增入口會把檔案建在 folder 根 —— 它不在
  當下可見的樹底下，使用者看到的是「按了沒反應」，而那違反同一能力的「操作的結果反映於檔案樹」。
- `openspec-data-access`: 新增一條 requirement —— 主行程供應各工作目錄的**選擇清單**（識別碼、
  folder-relative 根或 `null`、分支）。既有的「供應各工作目錄的 folder-relative 根」**不修改**：
  兩者回答不同的問題（定位 OpenSpec 內容 vs 可供選擇的工作目錄），見 design D3。
- `session-persistence`: 持久化的事實清單納入側欄來源的工作目錄，且該工作目錄 SHALL 以不可逆
  識別碼表示（延續既有的「持久化不得把路徑詞彙交給 renderer」）；重建時該工作目錄已不存在
  （worktree 於應用程式未開啟時被移除）SHALL 退回 folder 自身而非使重建失敗。
- `worktree-aggregation`: 「檔案導覽入口存在時 SHALL 為雙向」的既有要求，在樹根可切換之後仍須
  成立 —— 明確化自 OpenSpec 跳往 worktree 內檔案時工作目錄一併切換。

## Impact

**刻意不受影響者（本 change 的核心設計約束）：**

- **`filesystem-access` 一條 requirement 都不改。** 本 change 只把樹根切到**位於 folder 邊界內**
  的工作目錄，邊界外的整個排除在可選集合之外（呈現但停用）。可選的每一個根都是合法的
  folder-relative 路徑 —— 「切根」在定址上只是換一個路徑前綴。`fs.*` 的操作、watch 的訂閱與事件
  推送、`(folderId, relPath)` 的定址詞彙與邊界夾制**全部不動**。

  > 這句話早先寫成「worktree 位於 folder 邊界**內**」，那是**假的** —— 邊界外的 worktree 存在，
  > 本文件三段之前才剛描述過它們。結論不變（`fs.*` 不動），但理由是「邊界外的被**排除**」而非
  > 「它們不存在」。一個承重的前提不該以一句不成立的斷言表述。
- **`fs.*` 不需要工作目錄識別碼參數。** `session-in-worktree` 之所以需要不可逆識別碼 + 主行程
  查表，是因為 pty 的 cwd **可以**落在 folder 邊界之外；Files 不能，於是那套機制在**定址**上是
  多餘的 —— renderer 自己組出完整的 folder-relative 路徑即可，邊界照舊由主行程夾制。
  **但持久化是另一回事**：`session-persistence` 明文禁止 renderer 把**絕對或相對路徑**送進落盤
  資料，工作目錄僅得以不可逆識別碼表示。於是 renderer 同時需要兩者 —— 識別碼用於狀態與落盤、
  相對路徑用於組路徑。兩者並存的作用域區分見 design D2。
- **既有的 `openspec.getWorktreeRoots` 不修改。** 它供應的是「可用於定位 OpenSpec 內容的根」，
  邊界外整筆省略是它的正確行為；選擇器問的是另一個問題（見下）。

**受影響者：**

- 主行程：**新增** `openspec.getWorktrees`，每個工作目錄一筆（不可逆識別碼、folder-relative 根
  或 `null`、分支、`isMain`），供選擇器呈現與持久化使用。它與既有的 `worktreesOf`／
  `getWorktreeRoots` 同為一份 `#scan` 結果的投影，非新的 git 呼叫（design D3）。
- renderer：`useFileTree`（接受根前綴）、`FilesPanel`（選擇器、麵包屑基準、新增入口的根）、
  `MainStage`（跨身分導覽時判定目標所屬的工作目錄）、`sessions.tsx`（新的 per-session 欄位）、
  `SessionState` / `PersistedSession` 型別。
- **一道既有的成本 gate 被撤銷**：`FilesPanel` 目前僅對含 `openspec/` 的 folder 取工作目錄清單
  （那道 gate 是 `worktree-reverse-navigation` 被獨立稽核抓到後補的）。選擇器必須對「有 worktree
  但沒有 `openspec/`」的 folder 也出現，否則使用者無從得知那是刻意的限制還是壞了。於是每個 folder
  首次進入 Files 身分時會走一次掃描（core 於該路徑 spawn `git worktree list`）。**已裁決接受**：
  掃描結果為 per-folder 快取，成本是一次性的；而這個 app 的 folder 幾乎都是 OpenSpec repo。
- 文案字典 `src/shared/i18n/en.json`（選擇器與停用說明）。
- 驗收：`probe:openspec`（工作目錄切換與跨身分導覽的往返）、`probe:files`（樹根與路徑基準）、
  `probe:terminal`（per-session 狀態的重建）。
