# Tasks — 全域 session

> **實作順序是承重的**：第 1、2 組先把「歸屬」與「rail 選中」兩個表示改好並讓**既有行為**全綠，
> 之後才加全域項目。這樣「型別改動弄壞了什麼」與「新功能弄壞了什麼」分得開 —— 反過來做的話，任何
> 一條紅燈都有兩個嫌疑犯（`terminal-gpu-renderer` 換觀測管道時付過這個學費）。

## 1. rail「選中哪個項目」的表示（design D8 —— 比 session 的歸屬更早被讀到）

- [x] 1.1 `useWorkspaceFolders.ts` / `AppShell.tsx`：選中狀態改為 discriminated union
      （`{ kind: 'global' } | { kind: 'folder'; id: string }`，外層仍可為 `null` ＝ 未選中）
- [x] 1.2 逐一處理它造成的編譯錯誤 —— `KeyboardNavigation` 的 `if (!selectedId) return`、
      `StatusBar` 的 `!folder ⇒ noRepo`、`WorkspaceRail` 的 `folder.id === selectedId`
- [x] 1.3 `npm run typecheck` 與 `npm test` 全綠，**既有行為未變**（此時 UI 上還沒有全域項目）

## 2. session 的歸屬改為可缺席

- [x] 2.1 `types.ts` / `sessions.tsx`：`SessionState.folderId` 改為 `string | null`，
      **不新增任何 sentinel 字串**（design D1）
- [x] 2.2 **具名的清查（design D1a）**：`grep -rn 'folderId ===\|=== .*folderId\|folderId !==\|!== .*folderId'`
      逐一檢視並決定。**編譯器攔不到這些** —— `string | null` 與 `string | undefined` 的 `===`
      實測不報錯，而歸屬的消費點絕大多數是比較。
      **清查結論**（21 處命中，分三類）：
      - `sessions.tsx` 的 5 處（`forFolder`／`countFor`／`focusedIdFor`／close 找 sibling／
        `reorder`）**恰好都是對的** —— `null === null` 在那裡正是「兩個都是全域」的正確語意
      - fs/watch/openspec/panel 的 12 處與 session 歸屬**無關**（那是檔案定址的 folderId）
      - **真正要改的兩處都在 `MainStage`**，且都需要它先認得 rail 的 selection：
        `:382` 的 active／wake 判準（第 4 組）、`:190` 的續寫入口判定（第 8 組）
- [x] 2.3 處理 2.1 造成的編譯錯誤（傳參與 Map 鍵那一半）
- [x] 2.4 `terminal.ts`：`create()` 的位置解析改為「歸屬為 folder 時查表，歸屬為全域時取
      `os.homedir()`」；**全域且帶工作目錄識別碼時於主行程拒絕**（型別互斥擋不到 IPC 的輸入）
- [x] 2.5 `terminal.ts`：`#initialCwd` 與 `cwdOf()` **兩道**都要處理全域 session —— 共用同一個
      判定；全域者只做存在性檢查、不做路徑夾制（design D3）
- [x] 2.6 `session-store.ts`：落盤以**明確標記**表示全域（design D1b —— **不可用「欄位缺席」**，
      那會讓一次漏欄位把 repo session 靜默變成全域 session）；`replace()` 對 `folderId` 加形狀驗證
- [x] 2.7 `ipc/terminal.ts` 與 `preload/index.ts`：建立介面反映兩種歸屬，renderer 無從傳遞路徑
- [x] 2.8 `npm run typecheck` 與 `npm test` 全綠，**既有行為未變**

## 3. rail 的全域項目

- [x] 3.1 `WorkspaceRail.tsx`：於 folder 清單之前呈現全域項目，含視覺分隔與專屬圖示；不呈現 git
      分支、不提供移除入口
- [x] 3.2 全域項目的 session 子列、建立入口、關閉入口、右鍵選單 —— 行為比照 folder 列
- [x] 3.3 `useDragReorder` 的落點索引**以 folder 清單為基準，不以 rail 列位置**；全域項目本身不可
      拖曳、不作為落點
- [x] 3.4 workspace 尚無任何 folder 時 rail 仍呈現全域項目
- [x] 3.5 **冷啟動不預設選中全域項目**（design D12）—— 它恆存，「順手選中它」會讓冷啟動立刻喚醒
      一個 session

## 4. 主舞台與 session 分頁列

- [x] 4.1 `MainStage.tsx`：選中的 rail 項目為全域項目時，分頁列為它服務（標示 focused、切換、
      建立入口緊鄰最後一個分頁、可關閉、右鍵選單、空狀態）
- [x] 4.2 分頁列僅呈現當前選中項目的 session —— 全域與各 folder 的 session 不混列
- [x] 4.3 主舞台 header 對全域項目呈現其身分，**不得沿用「尚未選擇 repo」的既有空狀態文案**
      （那句話在叫使用者去做一件他已經做了的事）
- [x] 4.4 「最後聚焦過的 session」記憶涵蓋全域項目（切走再切回落點相同，且不持久化）

## 5. 側欄座標

- [x] 5.1 `panel-store.ts`：全域座標存於與 `coordinates` **並列的獨立欄位**（design D1c ——
      **不可用保留字串當 folder 鍵空間裡的鍵**，folder 識別碼不受格式約束）
- [x] 5.2 全域項目的來源 repo 預設為**未選定**；來源未選定時工作目錄與 change 一併為未選定
- [x] 5.3 來源指示器於全域項目上：可選任一 folder、**不呈現「回到自身 repo」捷徑**、
      **必須提供「清除來源」**（少了它「未選定」是單向道，而它是兩條空狀態唯一的入口）
- [x] 5.4 全域項目與各 folder 的座標互不干擾（切走再切回各自保留）

## 6. 側欄兩個身分

- [x] 6.1 `MainStage.tsx` 的 `openSpecEnabled`：停用條件收窄為「**來源已選定且**該 repo 不含
      `openspec/`」（design D11）—— 現行的 `panelFolder?.hasOpenSpec ?? false` 會讓全域項目的
      OpenSpec 身分恆為停用，**本 change 新寫的空狀態永遠到不了**
- [x] 6.2 `OpenSpecPanel.tsx`：來源未選定時的空狀態，並指向來源指示器
- [x] 6.3 `FilesPanel.tsx`：來源未選定時的空狀態，說明**為什麼**沒有檔案樹
- [x] 6.4 確認 Files 在任何情況下都不以家目錄為樹根 —— `fs.*` 一律需要 folder 識別碼，
      **本組不得為此新增任何繞道**

## 7. 狀態列

- [x] 7.1 `StatusBar.tsx`：全域 session 以全域身分標示取代 **repo 名稱**；分支**不隨之消失**
      （它衍生自 cwd 而非 folder —— `cd` 進 repo 後照常呈現）
- [x] 7.2 session 計數涵蓋全域項目（現行 `folder ? countFor(folder.id) : 0` 會使它恆為 0）；
      來源未選定時不呈現 spec 數與 change 數
- [x] 7.3 空狀態的條件改為「沒有 focused session」，**不是**「workspace 沒有 folder」——
      沒有任何 folder 但有全域 session 時，狀態列要呈現該 session 的脈絡
- [x] 7.4 寬度不足時全域身分標示享有與 repo／分支同等的保留優先序
- [x] 7.5 「側欄來源 ≠ 選中項目時才標示」的判定**先確認該項目是否具備自身 repo**，不由兩個缺席值
      的相等比較得出
- [x] 7.6 `agent-status.ts` / `session-status.ts`：**cwd 恰為家目錄時跳過 git 狀態偵測**
      （design D10 —— 那是 `spawnSync`，每 2 秒一次，家目錄是 git repo 時會週期性阻塞主行程）

## 8. 續寫入口 —— design D2 的那個坑

- [x] 8.1 條件 1 的判定：**先問這個 session 是不是全域的**，全域即判定不成立；不得寫成
      `panelSource === session.folderId`（兩端皆可能缺席，方向取決於 `?.` / `??` 的正規化，
      而**不確定本身就不可接受** —— 它會在下一次無關的重構中翻面）
- [x] 8.2 停用時的說明文案要說出真正的原因（全域 session 沒有所屬 repo），不是沿用「側欄來源指向
      別的 repo」那句
- [x] 8.3 **自動化對照組**（不是手動確認）：一條測續寫判定的單元測試，**把判定改回
      `panelSource === session.folderId` 必須變紅**。design 自陳這是本 change 最危險的坑，
      而手動確認過的東西下一次重構就沒有人守著了

## 9. 快捷鍵

- [x] 9.1 `Ctrl+↑↓` 的循環序納入全域項目；**尚未選中任何項目時選中第一個**（冷啟動不預設選中，
      使用者要能純鍵盤開始）
- [x] 9.2 **四顆以「當前選中的 repo」為作用域的快捷鍵**作用域改為 rail 項目：`Ctrl+Tab`、
      `Ctrl+T`、`Ctrl+Shift+W`、`Shift+←→` —— 它們各帶一句「沒有選中的 repo 時 SHALL 為無操作」，
      照字面實作會讓全域項目上這四顆鍵**全部失效**
- [x] 9.3 `Shift+↑↓` 選中全域項目時無操作（不交換、不做無持久化的位移）
- [x] 9.4 `Ctrl+T` 對全域項目的建立入口**以同一條 `aria-label` 路徑定位**，不新增第二套選擇器

## 10. 鍵盤導航的捲動（第九次 dogfooding 的第二個回饋）

- [x] 10.1 `WorkspaceRail.tsx`：以鍵盤改變選中的 rail 項目或其順序時，把目標捲入可視範圍。
      **捲動目標為標題列元素，不是整個 `<li>`** —— `<li>` 含展開的 session 子列，可能比捲動容器
      還高，而 `nearest` 對「已相交但更高」的元素不捲動，判準會永遠為假
- [x] 10.2 `SessionTabs.tsx`：分頁列的橫向捲動；`Ctrl+Tab` / `Shift+←→` **同時**要捲 rail
      （同一顆鍵、兩個容器）
- [x] 10.3 `Ctrl+Shift+W` 關閉後承接焦點的 session、`Ctrl+T` 建立的新 session 一併捲入視野
- [x] 10.4 **點 rail 子列時分頁列仍要捲** —— 「使用者直接操作」的例外只及於被操作的那一個容器
- [x] 10.5 用 `block: 'nearest'` 語意（已完整可見時不捲動）
- [x] 10.6 副作用置於 DOM 更新後的 effect，**絕不可寫在 `setState` 的 updater 裡**（StrictMode
      會 double-invoke —— 這個 repo 付過一次「拖曳完全沒反應、且只有 dev 模式壞」的學費）

## 11. 文案

- [x] 11.1 新增文案一律進 `src/shared/i18n/en.json`（全域項目標籤、兩個空狀態、狀態列標示、
      續寫停用原因、清除來源）
- [x] 11.2 新增的 `aria-label` 走字典，probe 的選擇器自同一份字典取字串
- [x] 11.3 **全域項目需要一個字典來源的 `aria-label` 供探針定位** —— `probe:workspace` 的
      `RAIL_ROWS` 以「移除按鈕」識別列（全域項目沒有），`probe:keyboard` 的 `RAIL_ORDER` 讀
      `title` 的 basename；兩者都會靜默地看不到它或讀出空字串
- [x] 11.4 文案避開 shell 引號會咬到的字元（單引號、雙引號、反引號）

## 12. 單元測試

- [x] 12.1 `session-store.test.ts`：明確標記 ⇒ 全域；**欄位缺席 ⇒ 該筆被丟棄**（不得被當成全域）；
      **對照組**：把 `replace()` 的逐欄位白名單改回 `...entry`，「多餘欄位不得落盤」須變紅
- [x] 12.2 `panel-store.test.ts`：**folder 識別碼恰為保留字時兩者座標互不覆蓋，且移除該 folder
      不影響全域座標**（不是「保留鍵不像 UUID」—— 那測的是一個實例，不是不變式）；
      **對照組**：把全域座標放回 folder 的鍵空間須變紅
- [x] 12.3 `terminal.test.ts`：全域 session 初始 cwd 為家目錄；帶工作目錄識別碼時**於主行程**被
      拒絕；**`cwdOf` 對全域 session 不夾制**（對照組：改回夾制須變紅）
- [x] 12.4 ~~全域 claude session 的自癒（`#heal`）仍在家目錄~~ **改由 code review 承擔（見 14.4）**
      —— 實作時查證：`cwdOf()` 對 claude 目標**恆回 `undefined`**（`session.target !== 'shell'`），
      而那是這個 session 的 cwd 唯一的觀測管道。寫得出來的測試只能斷言「自癒後 session 仍存在」，
      那對「它站在哪裡」完全無感 —— 是一盞測不到自己宣稱在測的東西的燈。同型於 CLAUDE.md 記載的
      「探針證明不了 wake 那條路的修正」
- [x] 12.5 `terminal.test.ts`：全域 shell session 的工作目錄已不存在時退回家目錄
- [x] 12.6 續寫入口的判定（見 8.3）

## 13. 探針驗收

- [x] 13.1 `probe:workspace`：rail 呈現全域項目與分隔、無分支、無移除入口、不可拖曳；
      **`workspace.json` 中不存在路徑為家目錄的條目**（那才是「它不是被合成出來的 folder」的
      鑑別點）；**三個以上 folder 時拖曳落點不偏移**
- [x] 13.2 `probe:terminal`：於全域項目建立 session、cwd 為家目錄、關 app 重開後重建於全域項目
      之下、shell 於最後的目錄重生（含家目錄之外的目錄）
      **重啟那半是稽核之後才補的** —— 原本 `runGlobalSession` 只有四條檢查（pty 數、cwd、分頁列、
      切到 folder），整段**沒有任何重啟**，而這一條卻打了勾。補上的五條一次承載五條 scenario：
      重建、重建於全域項目之下、shell 於家目錄之外的目錄重生、冷啟動不預設選中全域項目、
      冷啟動不喚醒它的 session。**目標目錄刻意選在每一個 workspace folder 之外**（落在 folder 裡
      的話，夾制過的實作也會通過）
- [x] 13.3 `probe:keyboard`：`Ctrl+↑↓` 循環涵蓋全域項目；**四顆快捷鍵在全域項目上皆生效**
      （`Ctrl+Tab` 切、`Ctrl+T` 開選單、`Ctrl+Shift+W` 關、`Shift+←→` 排序）；
      `Shift+↑↓` 選中全域項目時無操作；**第一個 folder 仍可往下移動一格、第二個仍可往上移動一格**
      （三個以上 folder —— 兩個時夾制會讓錯誤實作看起來正確）
- [x] 13.4 **捲動的自動化驗收**（載體換到 `probe:keyboard`）
      **不在 `probe:workspace`**：那支探針送不進 `Ctrl+↓` —— 診斷顯示 `aria-current` 不動而
      `scrollTop` 卻變了，那是**未被 preventDefault 時瀏覽器的原生捲動**，不是產品的
      `scrollIntoView`。該段已整段移除（留著就是假綠燈）。
      **rail 溢出以 `Emulation.setDeviceMetricsOverride` 壓矮 viewport 達成**，不以擴大 fixture
      —— fixture 是全域的，改它會打壞前面每一條絕對斷言。實測 `scrollHeight 318 > clientHeight 180`。
- [x] 13.5 捲動的判準與對照組
      判準為**「選中的項目完整落在容器 rect 內」的不變式**，不以 `scrollTop` 是否改變判定，
      也**不依賴精確的按鍵次數**（實測會差一格，而紅起來時指向的是計數不是捲動）。
      **對照組已跑**：拿掉 `WorkspaceRail` 的 `scrollIntoView` ⇒ 4 條變紅
      （`scrollTop: 0`、`visible: false`），還原後 142/142。
- [x] 13.6 `probe:openspec`：全域項目預設空狀態且 **OpenSpec 身分可用**、可選任一 repo 為來源、
      **可清除來源回到空狀態**、切走再切回座標保留
      **「切走再切回」原本沒有鑑別力，已重寫**：舊版是在**已經把來源清回未選定之後**才切走的，
      於是「永遠回未選定」與「與 folder 共用同一個鍵空間」兩種錯誤實作都會通過。改為**先把來源
      設成非預設值**、且切走的目標刻意選另一個 repo。
      **「座標跨重啟還原」與「續寫入口停用」不在這支探針裡** —— 前者由 `panel-store.test.ts`
      承擔（含對照組），後者由 `continuation.test.ts` 承擔（含對照組，UI 上不可達，見
      `verification.md`）。原本這一條宣稱它們在 `probe:openspec`，那是假的
- [x] 13.7 `probe:workspace`：**狀態列**的四條 —— 全域身分標示取代 repo 名稱、
      `cd` 進 repo 後呈現分支、session 計數非零、來源未選定時不標示來源
      **後兩者是稽核之後才補的**（原本只有全域身分標示 + 計數 + 「不呈現 folder 名」三條）。
      順帶補上「來源未選定時不呈現 spec 與 change 數」。
      **`cd` 那條的前置條件要自己建立**：fixture 此刻是 detached HEAD（上一段的驗收切過去的），
      而 `readGitWorkingState` 對 detached **刻意回 `undefined`** —— 狀態列本來就不會有分支，
      紅燈會被誤讀成「偵測沒有恢復」。**這與 rail 不同源**（rail 的 `branch-service` 在 detached
      時呈現短 sha，狀態列的這一條不是），第一版就是照抄 rail 的作法而紅的
- [x] 13.8 ~~`probe:files`：全域項目的 Files 空狀態 + 家目錄的哨兵檔~~
      **本 change 不做哨兵檔，且載體不是 `probe:files`。** 哨兵檔要求 `probe:files` 改設 `HOME`
      （它目前不設），而**它要防的東西根本表達不出來**：`fs.*` 一律需要 `folderId`，而家目錄不是
      任何 folder —— renderer 連一個能指向它的詞彙都沒有（`file-explorer` delta 的論證，成立）。
      實際載體是 `probe:openspec`：「來源未選定時 Files 不呈現任何檔案列」＋**正向對照**
      「選定來源後檔案樹呈現該 repo 的內容」。`scripts/probe-files.mjs` **未修改**
- [x] 13.9 `probe:shell`：preload 白名單守衛 —— **不論本組有沒有改到它都要跑**
- [x] 13.10 新增的 probe 斷言使用**相對數字**、且插入在既有段落**之後**；插入段落自行還原它改動
      的狀態（身分、視圖、選中項目、捲動位置）

## 13b. 獨立稽核（`/opsx:verify`）之後補的實作

- [x] 13b.1 **滑鼠的例外真的實作出來**（`useScrollIntoView`）—— `block: 'nearest'` 只保證
      「**完全**可見就不捲」，部分可見的它會捲最小的量，於是點下緣半截的那一列時它在游標底下
      跳走。spec 的 scenario、程式註解與 CLAUDE.md 三處都斷言了相反的事。
      判定是**「最後一次輸入來自哪裡」而不是「消費一次旗標」**（後者會被一次沒有造成狀態改變的
      點擊留下殘值，下一次鍵盤導航就被靜默吃掉一次），且**作用域是單一容器**（全域的話，在 rail
      點一列 session 之後分頁列就不捲了 —— 而那個分頁使用者還沒看到）。
      用 `mousedown` 而非 `pointerdown`：與 `useDragReorder` 一致，且 CDP 一定產生它（驗得到）。
      **hook 的回傳值必須 `useMemo`** —— 呼叫端把它放進 effect 的依賴陣列（lint 會要求），一個
      每次渲染都重建的物件會讓那個 effect **每渲染一次就跑一次**，於是無關的重繪也可能把一個
      半可見的目標捲進視野
- [x] 13b.2 **`terminal.create` 的全域分支抽成 `pickCreateWorktree`**（`worktree-pick.ts`）——
      它原本住在 `ipc/terminal.ts` 的 handler 裡，而該模組於載入時就 `import { ipcMain } from
      'electron'`，node:test 進不去：**把 `strict: true` 改成 `false` 不會有任何紅燈**。
      新測試斷言**列舉未被呼叫** —— 那是「空集合短路」與「列舉後沒命中」唯一的差別。
      對照組：把短路改回「先列舉」⇒ 2 條變紅
- [x] 13b.3 **`SidePanel.tsx` 與 `dirty-buffers.tsx` 的字面 NUL 位元組改為 escape 序列**
      （比照 `ff4fb29` 對 `data.tsx` 的修正）。它讓 `git diff` 把整個檔案當二進位、讓 `grep`
      **回空且 exit 1**，於是 D1a 的「把 `folderId ===` grep 一遍」清查對 `dirty-buffers.tsx`
      的 5 處命中**結構性地瞎掉**（結論不變 —— 那五處都是檔案定址）
- [x] 13b.4 **`probe:openspec` 的座標污染那條重寫為有鑑別力的版本** —— 舊版在「已經清回未選定」
      之後才切走，於是「永遠回未選定」與「共用同一個鍵空間」兩種錯誤實作都會通過

## 14. 明確不由自動化承擔的項目（寫明，不留假綠燈）

- [x] 14.1 「建立介面不接受路徑參數」「歸屬不以保留字串偽裝」兩條為**型別層**宣稱 ——
      `probe:shell` 的白名單守衛**看不到簽名改變**（實測：contextBridge 把 `Function.length`
      抹成 0），改由 **typecheck + code review** 承擔，並在 probe 原處留下註記
- [x] 14.2 「全域項目不可被拖曳時不呈現插入指示線」—— `dragMouse` 是原子的，指示線在可
      `evaluate` 的時候已經消失。以手寫的 press → move → evaluate → release 序列驗，
      **或**明寫由 code review 承擔
- [x] 14.3 「尚無任何 folder 時 rail 仍呈現全域項目」需要一次**空 workspace 的啟動** ——
      現有 9 支探針沒有任何一支這樣跑。指認它由哪一次啟動承擔，或明寫不覆蓋的理由
      **明寫不覆蓋。** 而稽核指出這一條原本只答了一半：它**不只卡住這一條** —— `Ctrl+↑↓` 的
      「rail 只有全域項目時為無操作」與狀態列的「workspace 為空但有全域 session 時不呈現空狀態」
      是同一個缺口的另外兩個面。三條一起列進 `verification.md` 的未覆蓋清單（#1／#13／#17），
      並標明它們共用同一個前置條件 —— 補的時候是**一次**新增零 folder 的啟動，不是三次
- [x] 14.4 **全域 claude session 的自癒仍在家目錄** —— 由 code review + 實作註解承擔（原 12.4）。
      `#heal()` 沿用 `session.cwd` 與 `session.global`，兩者在同一個物件上、同一次 `#spawn` 呼叫
      裡傳遞；而 `cwd`／`cols`／`rows` 三個都是當年漏掉後才補的，`global` 那一行的註解明寫了
      這件事。**驗不到的理由是結構性的**：claude 目標的 cwd 沒有觀測管道（見 12.4）

## 15. 收尾

- [x] 15.1 **逐條對照本 change 新增的每一條 scenario，指認其驗收載體**，無載體者明寫
      「不覆蓋，理由是…」。**這張表要在動工前就填出來、而不是留到收尾** —— 「補一條 scenario」
      與「覆蓋一條 scenario」是兩個動作，這個 repo 已經漏過三次，且最後一次是在寫下前兩條教訓
      之後犯的
      **第一版被獨立稽核判定為不可 archive，已重寫。** 它宣稱了**四條不存在的載體**，而未覆蓋
      清單是**按組**寫的（九條字面底下藏著約二十條 scenario）。這一版逐條列、載體指到具體的斷言
      文字，未覆蓋 24 條各自附理由。四條假載體不是改標籤了事 —— 三條把載體真的做出來了
      （`worktree-pick.test.ts`、`runGlobalSession` 的重啟段落、`probe:keyboard` 的全域 session），
      一條刪掉不實的那半
- [x] 15.2 **同步 `## Purpose`**（delta 不承載 Purpose，只能直接改主 spec）。已知至少兩處會變成
      假陳述：`terminal-sessions` 的「初始 cwd 落在某個 workspace folder 之內」、
      `side-panel-source` 的「rail 上的項目**今日恰為 workspace 的 folder**」
      **稽核指出這一條只做了一半**（原本只改了那兩處）：`keyboard-navigation` 的 Purpose 仍寫
      「於**當前 repo** 的 session 之間切換、於 **repo** 之間切換」，而它有六條 requirement 剛被
      放寬為「rail 上的項目」；`workspace-layout` 的 Purpose 寫「rail 呈現**每個 folder** 的
      身分」，而 rail 現在有一個非 folder 的項目。兩份已補
- [x] 15.3 `npm run typecheck`、`npm run lint`、`npm test` 全綠（稽核後為 **392/392**，
      新增 3 條 `pickCreateWorktree`）
- [x] 15.4 `npm run test:all` —— **8/9**：`native` 9/9、`core` 17/17、`identity` 7/7、
      `shell` 19/19、`workspace` 86/86、`files`／`keyboard`／`openspec` 皆無紅燈。
      唯一紅燈是 `probe:terminal` 的「持久化檔案損毀時應用程式照常啟動」——**既有的偶發**：
      單獨連跑兩次為 1 紅 1 綠（`分頁=1 隔離檔=無` vs `分頁=0 隔離檔=sessions.json.corrupt-…`），
      失效模式是「寫入損毀內容」與「前一個 app 關閉時的 flush」相競。與本 change 無關（改動在
      解析階段，不觸及該時序），且與 `panel-coordinate-per-folder` 封存時的情況同型（issue #8）
      **稽核之後重跑**（探針有改動的六支，逐支跑）：`keyboard` **170/170**、`workspace` **91/91**、
      `openspec` **410/410**、`files` **102/102**、`shell` **19/19**、`terminal` 的
      `runGlobalSession` **9/9（兩模式）**。
      **`probe:terminal` 全跑時，新增的重啟段落一度撞到 issue #7**（relaunch 時 CDP WebSocket
      連線失敗 —— 那是 **throw 而不是紅燈**，整支從那裡中斷）。已在 quit 與 relaunch 之間補上
      `waitPtysGone` 的斷言：它既是一條該有的驗收（關閉終止其所有 pty），也讓舊行程的 debugging
      port 有時間釋放。補上之後全跑 **241/242**，唯一紅燈仍是 issue #8 那條既有的偶發
- [x] 15.5 dogfood：開一個全域 claude session 講幾句話、關 app、重開，確認**續接同一個對話**
      （design D4 的實測是 `-p` 模式，互動模式要親自走一次）
- [x] 15.6 dogfood：rail 加到超出 viewport，以 `Ctrl+↑↓` 走一輪確認捲軸跟著走 —— 這是本 change
      併收那條回饋的原始情境，**由回報者本人確認**
- [x] 15.7 更新 `CLAUDE.md`：快捷鍵表、rail 的結構、以及本 change 的實測踩雷（**`string | null`
      對 `===` 不報錯**、`openspec validate` 只看 requirement 第一行、`--resume` 的位置相依性、
      「renderer 從來沒有任何 `scrollIntoView`」、**folder 識別碼不受格式約束**）
