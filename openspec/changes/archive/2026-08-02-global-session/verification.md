# 驗收對照表（tasks 15.1）

**這張表回答的是「每一條 scenario 由誰驗」，不是「跑了幾條測試」。**

CLAUDE.md 記著這個 repo 已經漏過三次「spec 有 scenario、design 有交代、實作零覆蓋」，而**最後
一次是在寫下前兩條教訓之後犯的**。因此這張表在收尾時逐條填出來，無載體者一律明寫理由。

> 只列**本 change 新增或改寫**的 scenario（＝ delta 中有、而封存前的主 spec 沒有的那些）。
> MODIFIED requirement 裡原封不動重述的既有 scenario 由既有的驗收承擔，不重複列出。

> **這一版是重寫的。** 上一版由獨立稽核判定不可 archive —— 它宣稱了**四條不存在的載體**
> （見文末「上一版錯在哪」），而未覆蓋清單是**按組**寫的，於是九條字面底下藏著約二十條
> scenario。這一版**逐條 scenario**列，載體一律指到具體的斷言文字。

---

## global-session（新能力，24 條新 scenario）

| scenario | 載體 |
|---|---|
| 全域項目位於所有 folder 之前 | `probe:workspace`「rail 呈現全域項目，且它是第一個項目」 |
| 尚無任何 folder 時仍呈現 | **✗ 不覆蓋** —— 見未覆蓋 #1 |
| 不呈現 git 分支 | `probe:workspace`「全域項目不呈現 git 分支」 |
| 不提供移除入口 | `probe:workspace`「全域項目不提供移除入口」 |
| 不可被拖曳排序 | `probe:workspace`「全域項目不可被拖曳排序（順序不變）」 |
| 全域項目不使 folder 的拖曳落點偏移 | `probe:workspace` 既有拖曳段落（三個 folder，落點與指示線一致） |
| 不進入 workspace 的持久化設定 | `probe:workspace`「workspace 的持久化設定中沒有代表全域項目的條目」 |
| 冷啟動不預設選中全域項目 | `probe:terminal` `runGlobalSession`「冷啟動不預設選中全域項目（分頁列為空，儘管它有一個 session）」 |
| 於全域項目建立 session | `probe:terminal` `runGlobalSession`「於全域項目建立 session（產生一個 pty）」 |
| 兩種 spawn 目標皆可選 | `probe:keyboard`「於全域項目按 Ctrl+T 開啟 spawn 選單」（選單兩項）。**只有 shell 那條被真的 spawn 過** —— claude 目標由 `probe:terminal` 的既有 stub 段落間接承擔 |
| 拒絕為全域 session 指定工作目錄識別碼 | `worktree-pick.test.ts`「全域 session 帶著工作目錄識別碼時被拒」（**含對照組**：拿掉空集合短路 ⇒ 2 條變紅），並斷言**列舉未被呼叫**（那是「短路」與「列舉後沒命中」唯一的差別） |
| 建立介面不接受路徑參數 | **✗ 不覆蓋（型別層）** —— 見未覆蓋 #2 |
| shell 目標於最後的工作目錄重生 | `terminal.test.ts`「cd 到家目錄之外的位置後仍被記錄」＋ `probe:terminal`「全域 shell session 於最後的目錄重生」 |
| shell 目標的工作目錄不受路徑夾制 | 同上 —— probe 的目標目錄**刻意落在每一個 workspace folder 之外**（夾制過的實作到不了那裡） |
| 工作目錄已不存在時退回家目錄 | `terminal.test.ts`「最後已知的工作目錄已不存在時，退回家目錄」 |
| claude 目標恆於家目錄重生 | **✗ 不覆蓋** —— 見未覆蓋 #3 |
| 續接失敗自癒後仍於家目錄 | **✗ 不覆蓋** —— 見未覆蓋 #4 |
| 工作目錄為家目錄時不偵測 git 狀態 | **✗ 不覆蓋** —— 見未覆蓋 #5 |
| cd 進工作區後照常偵測 | `probe:workspace`「全域 session cd 進 git repo 後，狀態列呈現該處的分支」（判準是**現場問到的**分支，不是寫死的 `master`） |
| 續寫入口對全域 session 恆為停用 | `continuation.test.ts`（**含對照組**：拿掉那一行 ⇒ 3 條變紅） |
| 側欄來源亦未選定時仍為停用 | `continuation.test.ts`。**UI 上不可達** —— 沒有來源時 `SidePanel` 走空狀態，`ContinuationBar` 根本不掛載；安全性質另有 `MainStage` 的一道 gate。scenario 的字面沒有任何 UI 狀態能滿足（`audit-findings.md` 的 m13） |
| 全域 session 跨重啟重建 | `probe:terminal` `runGlobalSession`「關掉 app 再開，全域 session 原樣重建於全域項目之下」 |
| claude 目標的全域 session 續接原對話 | **✗ 自動化不覆蓋 —— 由 dogfood 承擔**（tasks 15.5，已測） |
| 落盤內容以明確狀態表示不隸屬任何 folder | `session-store.test.ts`「folderId 缺席或為空字串 ⇒ 丟棄該筆」 |

## keyboard-navigation（41 條，其中 23 條為本 change 新增或改寫）

### ADDED：選取或焦點改變時目標捲入可視範圍（9 條）

| scenario | 載體 |
|---|---|
| 切換至視野外的 rail 項目時捲入視野 | `probe:keyboard`「Ctrl+↓ 切換後，選中的項目完整落在 rail 的可視範圍內」（**含對照組**） |
| 切換至視野外的 session 時分頁列橫向捲動 | `probe:keyboard`「切換至視野外的 session 時，分頁列橫向捲動使該分頁完整可見」＋「分頁列確實橫向捲動了」（`scrollLeft > 0`）。溢出以壓窄視窗達成，仍不夠時**以鍵盤補 session** |
| 以滑鼠選取部分可見的項目時不捲動 | `probe:keyboard`「以滑鼠選取部分可見的項目時 rail 不捲動」（**含對照組**：拿掉例外判定 ⇒ `scrollTop 20 → 0`）。半截的列是**主動算**出來的，不是「捲到底再找找看」 |
| 循環至頂端的項目時捲回頂部 | **✗ 不覆蓋** —— 見未覆蓋 #7 |
| 切換 session 時其 rail 子列亦捲入視野 | **✗ 不覆蓋** —— 見未覆蓋 #8 |
| 移動 rail 項目後它仍可見 | **✗ 不覆蓋** —— 見未覆蓋 #9 |
| 移動 session 後它仍可見 | **✗ 不覆蓋** —— 見未覆蓋 #10 |
| 目標已完整可見時不捲動 | **✗ 不覆蓋** —— 見未覆蓋 #11 |
| 點選 rail 子列時分頁列仍捲動 | **✗ 不覆蓋** —— 見未覆蓋 #12 |

### MODIFIED：作用域自「repo」放寬為「rail 上的項目」（14 條）

| scenario | 載體 |
|---|---|
| 切換至下一個／上一個項目（措辭改寫） | `probe:keyboard`（兩模式，既有斷言） |
| 自第一個 folder 往上切換即抵達全域項目 | `probe:keyboard`「自第一個 folder 按 Ctrl+↑ 抵達全域項目」 |
| 於末端循環回到全域項目 | `probe:keyboard`「自最後一個 folder 按 Ctrl+↓ 循環回全域項目」 |
| 尚未選中任何項目時選中第一個 | `probe:keyboard`（冷啟動後第一次 `Ctrl+↓`） |
| rail 只有全域項目時為無操作 | **✗ 不覆蓋** —— 見未覆蓋 #13 |
| 於全域項目內切換 session（`Ctrl+Tab`） | `probe:keyboard`「於全域項目內以 Ctrl+Tab 切換 session」 |
| 於全域項目開啟 spawn 選單（`Ctrl+T`） | `probe:keyboard`「於全域項目按 Ctrl+T 開啟 spawn 選單」 |
| 沒有選中任何項目時為無操作（`Ctrl+T`） | **✗ 不覆蓋** —— 見未覆蓋 #14 |
| 於全域項目關閉 session（`Ctrl+Shift+W`） | `probe:keyboard`「於全域項目內以 Ctrl+Shift+W 關閉當前 session」 |
| 於全域項目調整 session 順序（`Shift+←→`） | `probe:keyboard`「於全域項目內以 Shift+→ 調整 session 順序」 |
| 選中全域項目時 `Shift+↑↓` 為無操作 | `probe:keyboard`「選中全域項目時 Shift+↓ 無操作」 |
| 第一個 folder 仍可往下移動一格 | `probe:keyboard`（**三個 folder** —— 兩個時夾制會讓錯誤實作看起來正確） |
| 第二個 folder 仍可往上移動一格 | 同上 |

> 上面四條「於全域項目…」此前**一條都驗不到**：那一段按完 `Ctrl+T` 就 `Escape`，全域項目在
> 整支探針裡 session 數恆為 0。現在它真的建兩個 login shell 再驗。

## status-bar（20 條，其中 11 條新增或改寫）

| scenario | 載體 |
|---|---|
| 全域 session 以全域身分取代 repo 名稱 | `probe:workspace`「全域 session focused 時，狀態列以全域身分標示取代 repo 名稱」＋「狀態列不呈現任何 folder 的名稱」 |
| 全域項目的 session 計入 | `probe:workspace`「狀態列的 session 計數涵蓋全域項目（非零）」 |
| 全域 session cd 進 repo 後呈現該處的分支 | `probe:workspace`（新增，見上） |
| 全域項目的來源未選定時不標示來源 | `probe:workspace`「來源未選定時，狀態列不標示側欄來源」 |
| 來源未選定時不呈現 spec 與 change 數 | `probe:workspace`「來源未選定時，狀態列不呈現 spec 與 change 數」 |
| 全域 session 的其餘欄位照常呈現 | **✗ 不覆蓋** —— 見未覆蓋 #15。（`cd` 之後仍以全域身分標示那條是**部分**間接保證） |
| 全域項目已選定來源時標示它 | **✗ 不覆蓋** —— 見未覆蓋 #16 |
| workspace 為空但有全域 session 時不呈現空狀態 | **✗ 不覆蓋** —— 見未覆蓋 #17 |
| 視窗變窄時全域身分標示仍然可見 | **✗ 不覆蓋** —— 見未覆蓋 #18 |
| workspace 為空且無任何 session 時／當前項目沒有 session 時（措辭改寫） | 既有的空狀態斷言承擔；本 change 未改變其行為 |

> 稽核已確認上面四條「不覆蓋」的**實作都是對的**（`StatusBar.tsx` 的 `sourceIsForeign`／
> `anchorSource`／`!focused` gate／`branch` 只取自 `live`）。缺的是載體，不是行為。

## workspace-layout（13 條，其中 8 條新增）

| scenario | 載體 |
|---|---|
| 選中全域項目時呈現其分頁列 | `probe:terminal` `runGlobalSession`「分頁列呈現全域項目的 session」 |
| 切換至 folder 後分頁列不再含全域 session | `probe:terminal` `runGlobalSession`「切到 folder 後分頁列不含全域 session」 |
| 自 rail 的全域項目建立 session | `probe:terminal` `runGlobalSession`＋`probe:workspace`（狀態列段落自那顆入口建立） |
| 切走再切回全域項目（focus 記憶） | `probe:keyboard`「以鍵盤切走再切回，focused session 回到離開時的那一個」＋「以滑鼠切走再切回，落點與鍵盤相同」 |
| 側欄來源未選定時 OpenSpec 身分可用 | `probe:openspec`「來源未選定時 OpenSpec 身分仍可用（空狀態到得了）」 |
| 選中來源未選定的全域項目 | 同上 |
| 全域項目尚無 session 時呈現屬於它的空狀態 | **✗ 不覆蓋** —— 見未覆蓋 #19 |
| 全域項目的 header 與 repo 的 header 可區分 | **✗ 自動化不覆蓋 —— 純呈現，由 dogfood 承擔**（已測） |

## side-panel-source（15 條，其中 8 條新增）

| scenario | 載體 |
|---|---|
| 全域項目的來源預設為未選定 | `probe:openspec`「全域項目的側欄來源預設為未選定」 |
| 全域項目可選取任一 repo 為來源 | `probe:openspec`「全域項目可將側欄來源指向任一 repo」 |
| 全域項目可將來源清回未選定 | `probe:openspec`「全域項目可將來源清回未選定」 |
| 全域項目不呈現回到自身 repo 的捷徑 | `probe:openspec`「全域項目不呈現『回到自身 repo』捷徑」 |
| 全域項目的座標與 folder 的座標互不干擾 | `probe:openspec`「切走再切回，全域項目仍呈現它自己選定的來源」——**先設成非預設值才切走**，切走的目標刻意選另一個 repo（否則「共用同一個鍵空間」的實作也會通過） |
| 同一個 rail 項目的不同 session 共用同一組座標 | `probe:openspec` 既有的座標段落 |
| folder 的識別碼恰為保留字時座標仍互不覆蓋 | `panel-store.test.ts`（**含對照組**：併回同一鍵空間 ⇒ 2 條變紅） |
| 清除來源的捷徑與回到自身採同一形式與同一圖示 | **部分覆蓋** —— 形式（來源列上的按鈕、非下拉項目）已驗；**「圖示相同」未斷言**，見未覆蓋 #21 |

## session-persistence（20 條，其中 4 條新增）

| scenario | 載體 |
|---|---|
| 全域 session 一併重建於全域項目之下 | `session-store.test.ts` ＋ `probe:terminal` `runGlobalSession`（新增） |
| 全域 shell session 於家目錄之外的目錄重生 | `probe:terminal` `runGlobalSession`（新增） |
| 冷啟動不因全域項目恆存而喚醒 session | `probe:terminal` `runGlobalSession`「冷啟動不因全域項目恆存而喚醒它的 session（沒有任何 pty）」 |
| 全域 claude session 重生於家目錄 | **✗ 不覆蓋** —— 見未覆蓋 #3（同一個觀測管道問題） |

## 其餘 capability

| capability | 載體 |
|---|---|
| `terminal-sessions`（12，新增 3） | 「兩種歸屬並存」「其餘保證同等適用」由 `probe:terminal` `runGlobalSession` 承擔；**「歸屬不以保留字串偽裝」為型別層**，見未覆蓋 #22 |
| `artifact-continuation`（10，新增 2） | `continuation.test.ts`（**含對照組**）—— 兩條皆有；第二條的 UI 可達性見上文備註 |
| `openspec-panel`（3） | **只有一條半。**「全域項目預設呈現空狀態」由 `probe:openspec`「來源未選定時 OpenSpec 身分仍可用（空狀態到得了）」**部分**承擔 —— 它驗的是身分沒有被停用（空狀態的前置），不是空狀態的文字本身。另兩條未覆蓋，見 #23、#24 |
| `file-explorer`（3） | `probe:openspec`「來源未選定時 Files 不呈現任何檔案列」＋**正向對照**「選定來源後檔案樹呈現該 repo 的內容」 |
| `workspace-folders`（2） | `probe:workspace`（清單不含全域項目的條目） |

---

## 未覆蓋的 scenario（逐條，共 24 條）

**結構性驗不到（有明確的技術理由）**

1. `global-session`：**尚無任何 folder 時仍呈現** —— 需要一次**空 workspace 的啟動**，現有九支
   探針沒有任何一支這樣跑。既有的「rail 呈現全域項目」跑在種了三個 folder 的 fixture 上，
   **區分不了「恆常呈現」與「有 folder 時才呈現」**。（tasks 14.3；**已轉為 issue #11** ——
   它同時卡住 #13 與 #17，是一個**跨三條 scenario** 的共同缺口，不是單一疏漏，補的時候是
   **一次**新增零 folder 的啟動）
2. `global-session`：**建立介面不接受路徑參數** —— 型別層宣稱。`probe:shell` 的白名單守衛看不到
   簽名改變（實測：contextBridge 把 `Function.length` 抹成 0），由 typecheck + code review 承擔。
3. `global-session` / `session-persistence`：**claude 目標恆於家目錄重生** —— `cwdOf()` 對 claude
   目標恆回 `undefined`，沒有觀測管道。由 code review + `#heal` 的實作註解承擔（tasks 14.4）。
4. `global-session`：**續接失敗自癒後仍於家目錄** —— 同 #3。
5. `global-session`：**工作目錄為家目錄時不偵測 git 狀態** —— 需要**家目錄本身是 git repo**，而
   探針的 HOME 是暫存目錄。反面（`cd` 進 repo 後照常偵測）已由 `probe:workspace` 覆蓋，於是
   「乾脆永遠不偵測」的實作**擋得住**；擋不住的只有「連家目錄也偵測」。由 design D10 承擔。
6. `global-session`：**claude 目標的全域 session 續接原對話** —— 互動模式的續接由 dogfood 承擔
   （tasks 15.5，已測）。
22. `terminal-sessions`：**歸屬的表達不以保留識別碼字串偽裝** —— 同 #2，型別層。

**成本取捨（做得到，但這一輪沒做）**

7. `keyboard-navigation`：**循環至頂端的項目時捲回頂部** —— 探針的 `Ctrl+↑` 段落在捲離頂部的
   狀態下**從未走到全域項目**（它停在 repo-a）。已驗的「往回切換確實把容器捲了回去」是同型的
   間接保證。
8. `keyboard-navigation`：**切換 session 時其 rail 子列亦捲入視野**。
9. `keyboard-navigation`：**移動 rail 項目後它仍可見**（`Shift+↑↓`）。
10. `keyboard-navigation`：**移動 session 後它仍可見**（`Shift+←→`）。
11. `keyboard-navigation`：**目標已完整可見時不捲動** —— 做得到（在已捲動的狀態下切換到一個
    完整可見的項目，斷言 `scrollTop` 不變），只是這一輪沒做。**它與 #12 是這條 requirement
    僅存的兩個「不該捲」方向** —— 而「該捲」的方向已有三條含對照組的斷言。
12. `keyboard-navigation`：**點選 rail 子列時分頁列仍捲動** —— 需要「分頁列溢出」與「rail 子列
    可見」同時成立。**這一條是新的例外判定唯一沒被驗到的方向**（作用域為單一容器），而它正是
    「把例外做成全域的最後一次輸入」會壞掉的那條路徑 —— 由 `useScrollIntoView` 的 doc 與
    code review 承擔。
13. `keyboard-navigation`：**rail 只有全域項目時為無操作** —— 同 #1，需空 workspace 啟動。
14. `keyboard-navigation`：**沒有選中任何項目時 `Ctrl+T` 為無操作**。
15. `status-bar`：**全域 session 的其餘欄位照常呈現**。
16. `status-bar`：**全域項目已選定來源時標示它** —— 反面（未選定時不標示）已覆蓋。
17. `status-bar`：**workspace 為空但有全域 session 時不呈現空狀態** —— 同 #1。
18. `status-bar`：**視窗變窄時全域身分標示仍然可見** —— 既有的 repo／branch 截斷優先序本來也沒有
    探針覆蓋。
19. `workspace-layout`：**全域項目尚無 session 時呈現屬於它的空狀態** —— 實作為
    `MainStage.tsx` 的 `t('stage.noSession')`，稽核已確認正確。
20. `workspace-layout`：**全域項目的 header 與 repo 的 header 可區分** —— 純呈現，dogfood 已測。
21. `side-panel-source`：**清除捷徑與回到自身「圖示相同」** —— 形式已驗、圖示未斷言。實作是對的
    （兩者都是同一顆 `↩`）。
23. `openspec-panel`：**與「來源不含 openspec」的狀態相區別** —— 兩種空狀態的文案差異未斷言。
24. `openspec-panel`：**選擇來源後即呈現該 repo 的內容** —— 已驗的是**來源標籤**換了，不是側欄
    內容換了。同型的 folder 版本由既有段落承擔（`panel-coordinate-per-folder` 起就有「斷言側欄
    內容真的換了，不是只驗選單關掉」），而全域項目走的是同一條路徑。


---

## 上一版錯在哪（留著，因為它是這個 repo 第四次踩同一個坑）

上一版宣稱了**四條不存在的載體**。四條都不是實作錯誤，是**對照表本身說了謊**：

| 上一版的宣稱 | 事實 | 這一版 |
|---|---|---|
| 拒絕為全域 session 指定工作目錄識別碼 → `terminal.test.ts` | 那個測試不存在。行為住在 `ipc/terminal.ts` 的 handler 裡，而該模組於載入時就 `import { ipcMain } from 'electron'`，node:test 進不去 —— **把 `strict: true` 改成 `false` 不會有任何紅燈** | 解析抽成 `worktree-pick.ts` 的 `pickCreateWorktree`，補 3 條測試**含對照組** |
| 冷啟動不預設選中全域項目 → `probe:workspace` | `probe:workspace` 沒有冷啟動斷言 | 改由 `probe:terminal` `runGlobalSession` 的重啟段落承擔 |
| 續寫入口恆為停用 → `continuation.test.ts` **＋ `probe:openspec`** | 單元測試那半是真的；`probe:openspec` 沒有任何相關斷言 | 只保留單元測試那半 |
| 於全域項目內切換 session → `probe:keyboard` | 該段按完 `Ctrl+T` 就 `Escape`，全域項目 session 數恆為 0 | 改為真的建兩個 session，並一併補齊另外兩顆快捷鍵 |

**一般形式：「補一條 scenario」與「覆蓋一條 scenario」是兩個動作。** 而這一次的四條全都躲過了
`openspec validate --strict`（scenario 存在且格式合法）、躲過了 delta 與主 spec 的 header 稽核
（那支腳本不看驗收），也躲過了探針全綠（沒有人在看那條）。

**能結構性擋住它的做法**：稽核腳本除了比對 delta 與主 spec，還應對**每一條新增的 scenario**
要求一個對應的驗收指認 —— 哪支探針、哪條斷言、或明寫「不覆蓋，理由是…」。**這一條本身不是本
change 的交付**（它是一個關於流程的提案），**已轉為 issue #12**；未覆蓋 #1 的那個「零 folder
啟動」缺口是 **issue #11**。
