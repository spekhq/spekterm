# 獨立稽核的發現（archive 前必須處理）

> ## 處理狀態（已全部處理，此文件保留為紀錄）
>
> | 項目 | 處置 |
> |---|---|
> | **C1** 四條假載體 | **三條把載體真的做出來**（`worktree-pick.test.ts` 含對照組、`runGlobalSession` 的重啟段落、`probe:keyboard` 的全域 session），一條刪掉不實的那半。`verification.md` 整份重寫 |
> | **M2** 捲動覆蓋被誇大、分頁列橫向捲動零覆蓋 | **分頁列補上 4 條**（含 `scrollLeft > 0` 的對照判準）；其餘逐條進未覆蓋清單 |
> | **M3** 滑鼠例外的實作違反 spec | **實作那個例外**（`useScrollIntoView`，使用者裁決）＋ probe 斷言（**對照組**：`scrollTop 20 → 0`）＋ 修正 `WorkspaceRail.tsx` 註解與 CLAUDE.md |
> | **M4** 四條 tasks 名不副實 | 13.2／13.7 **把差額做掉**；13.6／13.8 改寫成事實並指認真正的載體 |
> | **M5／M6／M7** 清查不完整 | `verification.md` **逐條 scenario 重建**，未覆蓋 23 條各自附理由 |
> | **m8** 座標污染那條沒有鑑別力 | 重寫為「先設成非預設值、切走的目標刻意選另一個 repo」 |
> | **m9** 往回捲那條在對照組裡是綠的 | 加「先強制捲到底」的前置 + 「`scrollTop` 真的變小了」的判準 |
> | **m16** 字面 NUL 讓 grep 瞎掉 | 兩個檔案一併改為 escape 序列（比照 `cc3014c`），並寫進 CLAUDE.md |
> | **m10** `## Purpose` 同步不完整 | `keyboard-navigation` 與 `workspace-layout` 兩份主 spec 的 Purpose 已補（前者作用域改為「rail 上的項目」並補上捲動；後者寫明 rail 的項目不等於 folder） |
> | **m14** scenario 歸錯 requirement | 「header 可區分」自「focus 記憶」移到「主舞台呈現其分頁列」之下 |
> | m11／m12／m13／m15 | 併入 `verification.md` 的未覆蓋清單或已於該表註明。**m11（`SessionsApi` 的參數雙變性）與 m12（git 偵測的跳過比 spec 寬）維持現狀** —— 執行期皆正確，且兩者都不是本輪的封存阻礙 |
>
> 驗收：`npm test` **392/392**、`probe:keyboard` **170/170**、`probe:workspace` **91/91**、
> `probe:openspec` **410/410**、`probe:files` **102/102**、`probe:shell` **19/19**、
> `probe:terminal` **241/242**（唯一紅燈為 issue #8 那條既有的偶發）。

**狀態（稽核當下）：不可 archive。** 由獨立 agent 執行 `/openspec-verify-change` 產出，
1 CRITICAL + 6 MAJOR。

**這份文件是交接用的，請當作待辦清單讀。** 實作本身在 design 擔心的每一條路徑上都是穩的（見文末
「已確認無問題」——那一段是為了讓你不必重複調查）。**問題集中在「`verification.md` 與 `tasks.md`
宣稱的覆蓋與事實不符」**，外加一條真實的 spec-vs-實作分歧（M3）。

驗證基線：`openspec validate --strict` 通過、21 條 MODIFIED header 全部對得上主 spec、
`npm test` 389/389、`typecheck` 0、`lint` 0。

---

## CRITICAL

### C1. `verification.md` 有四條載體不存在

| 宣稱 | 事實 |
|---|---|
| 「拒絕為全域 session 指定工作目錄識別碼」→ `terminal.test.ts` | **那個測試不存在**。該行為住在 `src/main/ipc/terminal.ts:227-230`，而 `terminal.test.ts` 碰不到那一層（`TerminalService.create` 收的是 `cwd`，不是 key）。行為本身只被**既有的** `worktree-pick.test.ts:70`（「列舉為空時任何識別碼都被拒」）間接涵蓋，**本 change 新接的那一行 `folderId === null ? pickWorktree([], key, {strict:true})` 完全未測** —— 把 `true` 改成 `false` 不會有任何紅燈 |
| 「冷啟動不預設選中全域項目」→ `probe:workspace` | `probe:workspace` **沒有冷啟動斷言**（launch 後第一條 check 是「rail 為每個 folder 呈現一列」）。唯一會抓到「預設選中全域」的其實是 `probe:files:558`，而那是巧合 |
| 「續寫入口對全域 session 恆為停用」→ `continuation.test.ts` **＋ `probe:openspec`** | 單元測試那半是真的（含對照組）；**`probe:openspec` 那半是假的** —— 該支沒有任何 `continueBlocked.globalSession` 斷言 |
| 「於全域項目內切換 session（`Ctrl+Tab`）」→ `probe:keyboard` | 該段按了 `Ctrl+T` 之後隨即按 `Escape`，**從未建立全域 session** —— 全域項目在整支探針裡 session 數恆為 0，`Ctrl+Tab` 不可能被驗到 |

**為什麼是 CRITICAL**：task 15.1 存在的唯一理由就是擋住這個 repo 已經犯過三次的
「補一條 scenario 與覆蓋一條 scenario 是兩個動作」。帶著這四列 archive，等於**第四次**犯同一個錯，
而且缺口從此不在任何工作清單上。

**修法**：改正那四列（移進未覆蓋清單並寫理由，或補上斷言）。**最划算的真實補強**是為
「全域 + worktreeKey ⇒ 拒絕」補一條 ipc 層的測試 —— 那條保證目前掛在一行未測的程式碼上。

---

## MAJOR

### M2. 捲動的覆蓋被誇大約 4 倍，而**分頁列的橫向捲動零覆蓋**

ADDED 的「選取或焦點改變時目標捲入可視範圍」有 **9 條 scenario**。探針每模式加了 4 條檢查，
其中 2 條是前提、1 條無鑑別力（見 m9）。**真正被驗到的只有「`Ctrl+↓` 捲入視野」。**

未覆蓋且**未列入未覆蓋清單**的：

- **切換至視野外的 session 時分頁列橫向捲動** —— `SessionTabs.tsx` 新增的 `scrollIntoView`
  **完全沒有自動化覆蓋**。那是第二條 dogfood 回饋的**一半**
- 切換 session 時其 rail 子列亦捲入視野
- 移動 rail 項目後它仍可見（`Shift+↑↓`）
- 移動 session 後它仍可見（`Shift+←→`）
- 目標已完整可見時不捲動
- 以滑鼠選取部分可見的項目時不捲動（見 M3）
- 循環至頂端的項目時捲回頂部（探針的 `Ctrl+↑` 那段在捲離頂部的狀態下從未走到全域項目）

**失效情境**：日後有人刪掉 `SessionTabs.tsx:49-64`，`probe:keyboard` 仍是 142/142，而分頁列
靜默地不再跟著 `Ctrl+Tab` 走 —— 正是這個 change 要修的那個 bug。

### M3. 「以滑鼠選取部分可見的項目時不捲動」**實作違反了 spec**，而註解與 CLAUDE.md 都斷言了相反的事

**位置**：`src/renderer/src/shell/WorkspaceRail.tsx:481-485`（同型：`:161-166`、
`SessionTabs.tsx:56-63`）

effect 掛在 `selection` 上，**滑鼠與鍵盤都會觸發**。而 `block: 'nearest'` 只保證「**完全**可見
就不捲」—— **部分可見的元素它會捲動**（捲最小的量）。spec 的 scenario 講的正是「下緣被裁掉一半」，
requirement 也明文「唯一的例外是使用者直接操作該容器內元素所造成的改變」。

**三個地方都寫了相反的話**：`WorkspaceRail.tsx:478-480` 的註解、spec 的推理、以及**已經寫進
`CLAUDE.md`** 的那段（「用 `block: 'nearest'` 讓…同時成立，不必為兩種輸入各寫一條路徑」）。

**失效情境**：rail 已捲動，使用者點下緣那個半截的列 → rail 在游標底下跳。session 子列與分頁
同型。

**修法（二選一）**：
- (a) 真的實作那個例外（pointer handler 設一個 ref 旗標，effect 讀完即清）
- (b) 收窄 spec 的 scenario 去對齊實作，並寫明理由

**無論選哪個，都必須修 `WorkspaceRail.tsx` 的註解與 CLAUDE.md 那一段** ——
**一個錯的教訓寫進 CLAUDE.md 比 bug 更貴**，它會誤導下一個 change。

### M4. 四條 tasks 打了勾，但描述的內容沒有交付

依這個 repo 自己的 archive 規則（「做完，或明確轉為 issue 並把那一條改寫成…」）：

| task | 宣稱 | 事實 |
|---|---|---|
| 13.2 | `probe:terminal` 驗「關 app 重開後重建於全域項目之下、shell 於最後的目錄重生」 | `runGlobalSession` 兩者皆無（4 條檢查：pty 數、cwd=家目錄、分頁列、切到 folder）。該段沒有任何重啟 |
| 13.6 | `probe:openspec` 驗「座標跨重啟還原」與「續寫入口停用」 | 新增的段落裡兩者皆無 |
| 13.7 | 狀態列**四條**：全域標示、**`cd` 進 repo 後呈現分支**、計數非零、**來源未選定時不標示來源** | 實作的四條是：前提(入口存在)、全域標示、不呈現 folder 名、計數非零。**點名的四項有兩項沒做** |
| 13.8 | `probe:files` 的哨兵 + 正向對照 | `scripts/probe-files.mjs` **未修改**；空狀態與正向對照落在 `probe:openspec`，哨兵刻意不做（`file-explorer` delta 的論證是成立的）—— 但 task 文字沒改寫 |

### M5. `status-bar` 新增的 8 條 scenario 有 5 條無載體，且都不在未覆蓋清單

有載體：全域標示取代 repo 名稱、session 計數涵蓋全域、（視窗變窄那條已列為未覆蓋）。

**無載體且未列出**：`cd` 進 repo 後呈現該處分支、其餘欄位照常呈現、來源未選定時不標示來源、
已選定來源時標示它、來源未選定時不呈現 spec 與 change 數、workspace 為空但有全域 session 時
不呈現空狀態。

> 稽核已確認這六條**實作都是對的**（`StatusBar.tsx` 的 `sourceIsForeign`／`anchorSource`／
> `!focused` gate／`branch` 只取自 `live`）。問題純粹在對照表宣稱了不存在的覆蓋。

### M6. 「尚無任何 folder 時 rail 仍呈現全域項目」的載體跑在 3-folder 的 fixture 上

點名的斷言是 `probe:workspace` 的「rail 呈現全域項目，且它是第一個項目」—— 它跑在種了三個
folder 的 fixture 上，**無法區分「恆常呈現」與「有 folder 時才呈現」**。

而 tasks 14.3 說這需要一次空 workspace 啟動並要求「指認載體或明寫不覆蓋的理由」——
`verification.md` 的未覆蓋清單第 5 項涵蓋的是**另一條** scenario（`rail 只有全域項目時為無操作`）。
14.3 的問題等於只答了一半。**整個 repo 沒有任何探針以零 folder 啟動。**

### M7. `workspace-layout` 新增的 6 條有 2 條未列入清查

「全域項目尚無 session 時呈現屬於它的空狀態」（含 `SHALL NOT 呈現「尚未選擇 repo」` 那句）與
「切走再切回全域項目」（per-item 的 focus 記憶，本身就是一條 ADDED requirement）。

兩者**實作都是對的**（`MainStage.tsx:425-429` 用 `t('stage.noSession')`；focus 記憶由
`Map<string|null, string>` 的鍵自然得出）—— 缺的是清查。

---

## MINOR

- **m8. `probe:openspec` 的「切走再切回，全域項目的座標未被污染」沒有鑑別力。** 切換的那一刻
  全域座標**剛被清回預設**，於是「永遠回 `EMPTY`」或「與 folder 共用鍵空間」的實作都會通過。
  這正是 CLAUDE.md 記載 `panel-coordinate-per-folder` 的那個形態（「三個維度都先設成非預設值
  才切」）。spec 的 scenario 說的是「選 repoA…再切回…**呈現 repoA**」—— 照那個寫。
- **m9. 四條捲動檢查中有一條在自己的對照組裡是綠的。** 拿掉 `scrollIntoView` 後 `scrollTop`
  恆為 0，於是兩次 `Ctrl+↑` 之後 `repo-a` 本來就可見 ⇒「往回切換後仍完整落在可視範圍內」
  兩種實作都過。與 tasks 13.5 自己記的「4 條變紅」（＝ 2 條 × 2 模式）一致。
- **m10. `## Purpose` 同步（task 15.2）不完整。** 只改了 `terminal-sessions` 與
  `side-panel-source`。還有兩份現在比它們的 requirement 窄：`keyboard-navigation` 的 Purpose
  仍寫「於**當前 repo** 的 session 之間切換、於 **repo** 之間切換…調整 **repo** 與 session 的
  順序」，而它有六條 requirement 剛被放寬為「rail 上的項目」；`workspace-layout` 的 Purpose 寫
  「rail 呈現**每個 folder** 的身分」，而 rail 現在有一個非 folder 的項目。
- **m11. D1 的「編譯期攔截」比 design 宣稱的弱。** `SessionsProvider` 內部的 `create`／`focus`／
  `reorder`（`sessions.tsx:370, 418, 476`）**仍宣告 `folderId: string`**；`SessionsApi` 用
  method shorthand 宣告，TypeScript 的參數雙變性因此**靜默接受**較窄的型別。執行期沒問題
  （到處都是 `Map<string|null,…>`），但沒有任何東西在編譯期守住那條線。
- **m12. git 偵測的跳過比 spec 寬。** `session-status.ts:44` 對**任何** cwd 等於家目錄的 session
  跳過偵測，而 requirement 的作用域是全域 session。無害（folder session `cd ~` 之後退回
  `folder.branch`）但屬未記載的分歧。
- **m13. 「全域 session 且來源亦未選定時仍然停用」在 UI 上不可達。** 沒有來源時 `SidePanel` 走
  空狀態，`ChangeView`／`ContinuationBar` 根本不掛載 ⇒ 入口是「不存在」而非「以停用狀態呈現」。
  安全性質成立（`MainStage:232` 另有一道 gate），單元測試也涵蓋了判定式，但 scenario 的字面
  沒有任何 UI 狀態能滿足。
- **m14. `workspace-layout` delta 有一條 scenario 歸錯 requirement。** 「全域項目的 header 與
  repo 的 header 可區分」被放在「切換至全域項目時 focused session 落在最後聚焦過的那一個」之下，
  而後者講的是 focus 記憶。
- **m15. 「兩者的圖示相同」沒有被斷言。** `probe:openspec` 只驗了清除按鈕存在於來源列上，
  而圖示相等（那正是該 scenario 的重點）沒驗。實作是對的（兩者都是 `↩`）。
- **m16（既有問題，但它讓本 change 的清查技術瞎掉）**：`side-panel/SidePanel.tsx` 與
  `files/dirty-buffers.tsx` 含**字面 NUL byte**（`key={\`${folder.id}\0${rootPrefix}\`}`），
  於是 git 視之為 binary（`git diff` 只顯示 `Bin 7574 -> 8725 bytes` —— 本 change 改過
  `SidePanel.tsx`，它的 diff 無法審閱），而**純 `grep` 回空且 exit 1**，連「binary file」都不說。
  tasks 2.2 的 D1a 清查（「21 處命中」）因此對 `dirty-buffers.tsx` 的 5 處
  `folderId ===`／`!==` **結構性地瞎掉**。那五處都是檔案定址，結論不變 —— 但 design 倚賴的
  清查技術有一個沒人發現的盲點。**commit `cc3014c` 修過完全同型的坑**（在另一個檔案），
  這兩個漏了。建議獨立處理（一行修掉，或開 issue）。

---

## 已確認無問題（不必重複調查）

- **D1a**：兩個承重點真的修好了 —— `MainStage.tsx:420` 用 `session.folderId === itemKey`
  （不是 `focusedFolder?.id`），續寫判定抽成純函式。稽核**獨立重跑了 grep**（含對那兩個 binary
  檔加 `-a`），沒有殘留錯誤的歸屬比較。
- **D1b**：`parseFolderId` 回結果物件，使「合法的全域」與「不合法」可辨；`SessionStore.replace`
  **重新驗證**（不只 `parseSessionEntry`），於是過期的 renderer 漏欄位時該筆被丟棄而非靜默
  全域化。4 條新測試涵蓋，含欄位缺席的情形。
- **D1c**：`panel.json` 的 `global` 與 `coordinates` **並列**；`PanelStore.remove()` 只走
  `#coordinates`；provider 另有 `globalCoordinate` state 與自己的 `touched` 鍵。測試用一個名為
  `global` 的 folder 斷言碰撞情形，且檔案維持 version 1（向後相容，舊檔讀成 `global: undefined`）。
- **邊界宣稱**：`filesystem-access` 確實不必改 —— `fs.*` 仍需 `folderId`，而家目錄不是 folder。
  `create` 以 `os.homedir()` 為主行程常數；**`cwdAllowed()` 是 `#initialCwd` 與 `cwdOf` 共用的
  唯一夾制入口**（`session-in-worktree` 的兩道夾制教訓正確應用）；`#heal()` 連同 `cwd`／`cols`／
  `rows` 一起繼承 `global`。
- **wake/restore**：`restore` 對 `folderId === null` 跳過孤兒清理（少了它每次重啟都會清光全域
  session）；`resolveWorktreeForRebuild` 對全域短路為 `[]`；全域 claude 於 `homedir()` 喚醒、
  全域 shell 於記錄的 cwd（含存在性檢查）。
- **`ipc/panel.ts`／preload／`probe:shell` 白名單**：key 集合未變，白名單守衛仍有意義。
- **拖曳的 off-by-one（D7）**：`probe:workspace` 的 `FOLDER_LIS` 與 `WorkspaceRail` 的
  `blockRefs` 都以 **folder 清單**索引，全域列不傳 `blockRef`／`onDragStart`。三個 folder 的
  拖曳 scenario 仍涵蓋往下拖的情形。
- **`aria-current`**：是真改善不是遮羞 —— 它取代了一個真的假綠
  （`className.includes('bg-hover')` 會匹配 `hover:bg-hover/60`），探針現在讀它。它連帶炸出的
  那件事（`SELECTED_FOLDER` 從未被走到的分支讀 `innerText` 第一行，也就是 `▾`）也已正確修為
  讀 `aria-label`。

---

## Archive 前的最小集

1. **C1** —— 改正那四條假載體，並補上那條划算的真測試（ipc 層的「全域 + worktreeKey ⇒ 拒絕」）
2. **M4** —— 把 13.2／13.6／13.7／13.8 改寫成事實（或把差額做掉）
3. **M2／M5／M6／M7** —— 未覆蓋清單**逐條 scenario 重建**，不要按組寫；它會從 9 條長到約 20 條。
   其中最值得真的補起來的是**分頁列的橫向捲動**（一整個已交付的功能目前零覆蓋）
4. **M3** —— 裁決：實作那個例外，或收窄 scenario。**兩者都必須連帶修 `WorkspaceRail.tsx` 的
   註解與 CLAUDE.md 已經寫下的那一段**

**m16** 超出本 change 範圍，但它擊敗了本 change 的 design 所倚賴的審查技術，值得一行修掉或開 issue。
