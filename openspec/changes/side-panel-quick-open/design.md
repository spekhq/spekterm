## Context

側欄的 Files 身分只有一棵逐層展開的檔案樹。要開一個**已知路徑**的檔案，使用者得從根一層一層點
下去 —— 而這個 app 的價值命題是「不必另外開 IDE」。

三個既有的結構決定了本 change 的形狀：

- **`MainStage.openFileFromOpenSpec(relPath)` 已經是完整的開檔路徑** —— 它解析目標所屬的工作目錄、
  切換身分、展開側欄。quick open 的「開啟」那一半是免費的。
- **側欄座標（來源 repo ＋ 工作目錄）是 per-folder 的既有狀態**（`panel-coordinate-per-folder`）。
  搜尋範圍取自它，不引入新的範圍概念。
- **`keyboard-navigation` 的既有通則是「終端持有焦點時仍然生效」**，而本 change 的快捷鍵要求相反。
  那條 spec 自己警告過：差別必須各自寫明，否則規格自相矛盾。

而使用者已知情裁決：**只做焦點判定版**（`Ctrl+P` 在終端持有焦點時讓路給 pty，因為 `claude` 用它
顯示 previous history）。無條件生效的第二顆鍵不做。

## Goals / Non-Goals

**Goals:**

- 側欄持有焦點時，以純鍵盤在當前工作目錄裡找到並開啟一個檔案。
- 搜尋範圍與側欄當下看的那棵樹**完全一致** —— 使用者不必推理「它搜的是哪裡」。
- 結果清單不含雜訊（建置產物、相依套件、**其他工作目錄的重複檔案**）。
- `filesystem-access` 的定址詞彙與邊界保證**一個字都不改**。

**Non-Goals:**

- command palette（命令清冊是獨立的論證）。
- 跨 repo 搜尋、內容搜尋（grep）、目錄搜尋。
- 「把焦點移到側欄」的快捷鍵，或任何無條件生效的第二顆鍵。
- 最近開啟過的檔案優先（MRU）—— 見 Open Questions。

## Decisions

### D1：觸發點掛在**側欄容器的 capture 階段**，不掛在 window

「焦點在側欄之內」**就是**「keydown 事件經過側欄容器」—— 那是 DOM 事件傳播的定義。因此判定不需要
`activeElement.closest(某個選擇器)`、不需要 ref 比對、也不需要為驗收之外的目的掛任何標記。

**為什麼是 capture 而不是 bubble**：Monaco 會攔下按鍵並停止傳播 —— 既有的 `Ctrl+S` 正是因此被迫
註冊在編輯器內部（CLAUDE.md 記著這條，而它當年被誤讀成「window listener 沒用」）。capture 由容器
往下傳，早於 Monaco 綁在自己節點上的 listener。側欄裡的編輯器因此也吃得到這顆鍵。

**為什麼不需要像既有快捷鍵那樣早於 xterm**：焦點不在終端時，xterm 的隱形 textarea 收不到任何按鍵
（它走 `attachCustomKeyEventHandler`，事件來自那個 textarea）。**這正是本 change 的整個前提** ——
讓路不需要實作，它是焦點模型的推論。

> 已查證側欄裡沒有既有的 `Ctrl+P` 消費者：Monaco 只 `addCommand` 了 `Ctrl+S`。

**替代方案**：window capture ＋ `event.target.closest(容器)`。**它與本決策等價** —— 兩者問的是
同一件事（事件來源在不在側欄子樹裡），只是一個靠 listener 的位置回答、一個靠查詢回答。選容器
listener 是因為它不需要一個穩定的側欄選擇器（側欄有多個 `<section>`、`aria-label` 隨身分而變）。
**真正被否決的是比對 `document.activeElement`**：它與 `event.target` 在焦點正在轉移的瞬間可能不
一致，那會是一個間歇性、方向不明的失效。規格因此只要求「以事件來源為準」，不規定機制。

### D1b：**對話框的抑制必須是 document-wide，而不是「側欄之內」**

「按鍵來源在側欄之內」是觸發條件；「有沒有東西在等使用者裁決」是**另一個問題**，它的作用域是整份
文件。把後者也收窄到側欄子樹會漏掉一個真實情境：

**`VizOverlay`（Graph／Timeline）portal 到 `document.body`，且它不移動焦點**（已查證：整個元件沒有
任何 `focus()` 呼叫）。它由 `OpenSpecPanel` 裡的按鈕開啟 —— 於是 overlay 蓋滿視窗之後，
`document.activeElement` **仍是側欄裡的那顆按鈕**，觸發條件恰好成立，quick open 會在 overlay
底下開起來。

既有的 `KeyboardNavigation.tsx` 用的正是 document-wide 的
`document.querySelector('[role="dialog"], [role="menu"]')`。**兩者必須用同一個作用域**，否則「什麼
算是在等待裁決」會在兩個地方分歧 —— 而那種分歧不會有紅燈，只會有某些組合下的怪行為。

### D1c：工作目錄的解析必須上提，否則「範圍與樹一致」沒有實作載體

`rootPrefix`（`worktreeKey` → 路徑前綴）目前在 `SidePanel` 的 `FilesPanelForFolder` 內解析，
而**那個元件只在 Files 身分之下渲染**。quick open 在 OpenSpec 身分之下也必須能用（spec 有這條
scenario），於是最省事的實作會在 `MainStage` 用手上的 `panelWorktrees` **再解析一次** —— 那正好
違反「兩者 SHALL NOT 各自解析」。

解析因此要上提到兩者共同的上游（`MainStage`，或抽成一個 hook），`SidePanel` 改為接收解析結果。
**這是一條真的 codebase 改動，不是措辭** —— 它必須有自己的 task。

### D2：列舉走 `git ls-files`，非 git 才退回遞迴 —— 決定性理由是**巢狀 worktree**

實測（core-lib，folder 根）：

| 列舉法 | 總數 | 其中在 `.claude/worktrees/` 底下 |
|---|---|---|
| Node 遞迴 ＋ 硬編忽略清單 | 4517 | **1981（44%）** |
| `git ls-files --cached --others --exclude-standard` | 2446 | **0** |

`common-openspec-change` 是使用者的標準工作流，它把每個 change 的 worktree 開在 `.claude/worktrees/`
—— **repo 內部**。遞迴列舉會讓同一個 `lib/foo.js` 在結果裡出現 N+1 次，而那正好摧毀本 change 的
主要情境（「我知道檔名」）。**git 自動排除巢狀工作目錄** —— 這不是 `.gitignore` 的功勞（該檔案裡
沒有提到 worktrees），是 git 知道那是另一個工作目錄。

它同時與 `side-panel-worktree` 的模型一致：**worktree 是另一個工作目錄，有自己的選擇器**。把它們
的檔案混進來，等於在同一個介面裡同時主張「工作目錄是一個選擇」與「工作目錄不存在」。

次要收益是 `.gitignore`（那 2071 個差額裡的其餘部分：建置產物、相依套件）。

- **spawn 一次 `git` 是可接受的，而且已有先例與論證**：`repo-branch` 的「偵測 SHALL NOT 呼叫任何
  外部程式」，其對象是「每個 folder、每次載入都要做」的判定；`agent-status.ts` 已經為「只對當前
  focused 的那一個求值」的情形寫下同型的論證。quick open 的列舉是**使用者按下快捷鍵時的一次性
  動作**，比照列舉字型用 `fc-list` 的先例。
- **必須非同步（`execFile`，不是 `spawnSync`）。** 主行程一凍結，**所有 pty 的 IPC 一起停住** ——
  CLAUDE.md 已經記著一次教訓：家目錄的 git 狀態偵測用 `spawnSync` 且每 2 秒一次，會週期性阻塞
  主行程。一個大 repo 的 `git ls-files` 是數十至數百毫秒，那個代價不能由整個 app 承擔。
  > **要照抄的先例是 `src/main/ipc/settings.ts` 的 `fc-list`（非同步 `execFile`），不是
  > `agent-status.ts`** —— 後者用的正是 `spawnSync`，照它寫就會違反本決策。而 `fc-list` 那處
  > **只設了 `timeout`、沒有 `maxBuffer`**，本能力的輸出大得多，那一項要自己補。
- **`-z` 是必要的，不是講究。** `git ls-files` 預設 `core.quotePath=true`，非 ASCII 檔名會被
  C-quote 並包上雙引號（實測：`"docs2/\346\270\254\350\251\246…"`）。失效方式是**清單裡那一筆
  看起來像亂碼，選了之後 `readFile` 回「找不到檔案」**。`-z` 以 NUL 分隔且輸出原始位元組，順帶
  解決檔名含換行的情形（`-c core.quotePath=false` 只解決前者）。
- **只有「不在版控之下」才退回保守列舉。** 非 git 目錄回 exit 128 並在 stderr 說明，此時退回
  遞迴 ＋ 忽略清單（`.git` / `node_modules` / `out` / `dist` …）—— **退回是降級而非等價**，它可以
  接受的唯一理由是「非 git 目錄沒有巢狀 worktree 的問題」。**逾時與輸出過大 SHALL NOT 退回**：
  那時 repo 是 git repo，退回會讓 `.claude/worktrees/` 底下的檔案全部湧入，D2 的整個論點當場失效
  —— 而使用者只會看到清單變長，沒有任何訊號。
- **git 成功但輸出為空 ⇒ 目標整個被 ignore，此時改用保守列舉。** 實測：在一個被 `.gitignore`
  涵蓋的目錄（例如 `out/`）裡執行，`rc=0` 且無輸出。使用者既然正在那裡工作，把它呈現為空是錯的
  （VS Code 亦然）。這一條在 exit code 上與成功無法區分，只能以「成功但為空」判定。
- **輸出仍須過邊界檢查**。git 回的是相對於工作目錄的路徑，理論上不會越界；但「理論上不會」不是
  邊界保證的來源。列舉的結果與 `listDir` 走**同一道** `isWithin` 判定 —— 該檢查是純字面比較，
  成本可忽略。
- **退回路徑不得跟隨 symlink 進入目錄 —— 而這一條只有退回路徑需要。** `isWithin` 是**字面**比較，
  `escape-link/secret.txt` 這種路徑必定放行；`fs.readdirSync(dir, { recursive: true })` 會走進
  symlink 目錄，於是邊界外的檔名會從這道側門進入 renderer（與 chokidar `followSymlinks` 預設為
  true 的既有教訓完全同源）。作法是手寫遞迴、**只在 `dirent.isDirectory()` 為真時下鑽**
  （symlink 的 Dirent 是 `isSymbolicLink()`）。它同時解決 folder **之內**的 symlink 造成的重複項。
  **`git ls-files` 不遞迴 symlink**（實測只列出該連結本身），因此主路徑不受影響。
  > `probe:files` 的 fixture **就有** `escape-link → outside/secret.txt`，而它正是唯一會走到
  > 退回路徑的探針（非 git 目錄）—— 這個缺陷會在那裡真的發生。

### D3：清單於**開啟時取得一次**，不隨 watcher 更新、不快取

quick open 的生命週期是幾秒鐘。為它維護一份 watcher 訂閱要付兩份代價：inotify 的 instance 是
**per-user 128 個**的稀缺資源（CLAUDE.md 記著這條，而 `openspec-service` 對 watcher 錯誤是靜默
吞掉的 —— 那正是這條稀缺性會以「側欄安靜地停止更新」現身的地方）；以及一份與 UI 生命週期
不同步的訂閱。

**不快取**（每次開啟重掃）：實測 10–34ms，而旁邊有 agent 一直在寫檔 —— 一份 TTL 快取換來的是
「剛剛建好的檔案找不到」，那正是這個 app 最常見的情境。**正確性遠比 30ms 值錢。**

代價：清單在 overlay 開著的期間是靜態的。可接受 —— 使用者不會開著它等 agent 建檔。

### D4：模糊比對自己寫，不引入套件

實測（單執行緒線性掃描，含評分）：

| 項目數 | 每次按鍵 |
|---|---|
| 5,000 | 4–16ms |
| 50,000 | 48–58ms |
| 200,000 | 165–223ms |

真實規模落在第一列（本 repo 412、core-lib 2446，皆為 git 列舉後），成本遠低於一幀。
引入一個 fuzzy 套件換不到效能，只換來 bundle 與一份我們控制不了的排序規則。

**排序規則以「我知道檔名」為主要情境**：basename 上的命中權重高於路徑中段、連續命中加分、
詞邊界（`/`、`-`、`_` 之後）加分、長路徑輕微懲罰。查詢為空時以路徑排序呈現前 N 筆。

### D5：overlay 形態，且**關閉時必須把焦點還給側欄**

以 portal 掛到 `document.body`、`role="dialog"`（比照 `VizOverlay`：`position: fixed` 若有祖先帶
`transform`／`filter` 就會改以該祖先為包含塊）。錨定於畫面上方中央 —— 側欄最窄可到 180px，結果
需要呈現完整路徑，塞不進去。

`role="dialog"` 使它**自動被既有的「對話框或選單開啟時導航快捷鍵不生效」尊重**（該條明文要求
以角色存在判定、不得逐一列舉）。

**焦點歸還是承重的，不是禮貌。** 本 change 的觸發條件就是焦點位置 —— overlay 關閉後若焦點落在
`document.body`，下一次 `Ctrl+P` **靜默失效**，而使用者看到的是「這顆鍵時好時壞」。這與既有的
「選單操作完要把焦點還給終端」同源（那次是探針抓到的：自右鍵選單貼上之後按 Enter 不會執行）。
開啟前記住 `document.activeElement`，關閉時還原；該元素若已消失（例如檔案樹重繪）則退回側欄
容器本身。

> **而「退回側欄容器」在現況下是一個靜默的 no-op**：那個容器是一個沒有 `tabIndex` 的
> `<section>`，`.focus()` 對它無效 ⇒ 焦點掉到 `<body>` ⇒ 下一次快捷鍵失效。**而「開啟檔案」正是
> 那個記住的元素必然消失的路徑**（檔案樹被 `FileViewer` 換掉）—— 也就是說退路在最常走的那條路上
> 才會被用到。容器因此要加 `tabIndex={-1}`（可程式聚焦、不進 Tab 序）。

### D6：沒有可搜的樹時**無操作**

側欄來源未選定時（全域項目的預設狀態）沒有任何工作目錄可搜 —— 此時 `Ctrl+P` 不開啟 overlay。

**這不是「照字面寫一句無操作」就結束的條款。** `global-session` 留下的教訓正相反：
`keyboard-navigation` 有四條 requirement 各帶一句「沒有選中的 repo 時 SHALL 為無操作」，而照字面
實作會讓全域項目上四顆鍵全部失效。此處的無操作**必須以「有沒有可搜的樹」為判準，不是以「rail
選了什麼」** —— 全域項目只要把側欄來源指向某個 repo，quick open 就該正常運作。

**側欄收合時不需要條款，但理由不是我原本以為的那個。** 「焦點不可能在收合的容器裡」是**錯的** ——
側欄用的是 `<Panel collapsible collapsedSize={0}>`，收合只是把尺寸設為 0，**子樹仍然掛載**，焦點
若原本在樹列上並不會被移走。真正的理由是**行為上無害**：那個狀態下觸發入口，選取後的開檔路徑
本來就會 `expandSidePanel()`。**留著這條紀錄是因為原本的論證看起來很有說服力，而它是假的。**

### D7：overlay 開啟期間不重複開啟 —— 而這是**結構保證**，不是旗標

overlay portal 到 `document.body`，焦點落在它的搜尋框上 —— 事件不再經過側欄容器，於是 `Ctrl+P`
根本到不了 D1 的 listener。**沒有旗標可以忘記重設。**

記錄它是為了說明這個性質是設計的推論，而不是巧合：日後若有人把 overlay 改成掛在側欄子樹之內，
這條就失效了（而症狀是「按第二次 Ctrl+P 會重開並清空輸入」）。

### D8：只列**檔案**，不列目錄

目標是開啟一個檔案，而側欄的檢視器開不了目錄。列出目錄只會稀釋結果。

### D9：新的 IPC 是 `fs.*` 的一員，受同一道邊界約束

它不是新的定址詞彙 —— 參數仍是 `(folderId, relPath)`，`FsResult<T>` 的形狀不變。
**`filesystem-access` 因此沒有任何一條邊界被放寬。**

**但它不只是 ADDED。** 既有那條「檔案系統能力僅暴露已為其定義邊界要求的操作」，其 scenario 是一份
**逐一列舉 method 名稱**的清單（`listDir`、`readFile`、…共 10 個）。`listFiles` 進了 preload 而
不修改它，主 spec、實作與 `probe:shell` 的白名單守衛就會三方分岔 —— 那道守衛的存在理由正是「你
加了東西卻沒告訴它」，而它已經在 `panel-drive-and-shell-affordances` 抓到過一次（帶著兩條紅燈被
封存）。因此本 change 對它是 **MODIFIED**。

> 「白名單的形式是原則而非清單」寫在該 requirement 的內文裡，但**驗收落在那份窮舉的 scenario 上**
> —— 原則不會過期，清單會。

### D10：`listFiles` 回傳 **folder-relative** 路徑，不是「相對於目標目錄」

直覺的 API 語意是「相對於你傳進來的那個目錄」，而那會製造一道**每個呼叫端都要自己記得做**的換算：
清單的用途就是把項目交給其他 `fs.*` 操作，而那些操作一律吃 folder-relative。

**漏掉換算的症狀是打開另一個同名的檔案，沒有任何錯誤。** 具體路徑：側欄工作目錄為
`.claude/worktrees/wt-inside`，使用者選 `openspec/specs/auth/spec.md`（worktree-relative）——
`openFileFromOpenSpec` 以最長相符根反推所屬工作目錄，查不到 ⇒ **把樹根切回主工作目錄** ⇒ 開啟
主工作目錄那一份同名檔案。內容不同、沒有紅燈。

主行程本來就要對每一筆做邊界判定（它手上有 folder 根），在那裡一併輸出 folder-relative 是零成本
的，而且讓「呈現要剝前綴、權威是完整路徑」與 `side-panel-worktree` 的既有模式完全一致。

**代價**：呈現層必須剝掉工作目錄前綴（否則使用者看到一段對他沒有意義的 `.claude/worktrees/…/`）。
那正是既有的 `paths.ts` 在做的事，且該處已經記著「權威永遠是完整的 folder-relative 路徑」。

## Risks / Trade-offs

- **[終端裡不生效，而終端幾乎永遠持有焦點]** → 這是使用者的知情裁決（proposal 已記錄）。退路是
  一顆無條件生效的 `Ctrl+Shift+P`（`Ctrl+Shift+<字母>` 在終端協定裡編碼不出來，代價確定為零），
  屆時只動一個判斷 ＋ spec ＋ probe，**沒有任何資料格式綁在鍵位上**。

- **[超大 repo 的每次按鍵評分成本]** → 5 萬項時約 50ms（可感知但可用），20 萬項時約 200ms（不可
  接受）。git 列舉排除了 `node_modules` 與巢狀 worktree，實務上很難達到 5 萬。**第一個該加的是
  輸入 debounce，而不是索引** —— 記在這裡是為了讓下一個人不必重新量。

- **[`git ls-files` 逾時或輸出過大]** → 設 `timeout` 與 `maxBuffer`，並**回報錯誤而非退回遞迴**
  （見 D2：在 git repo 上退回遞迴會讓巢狀 worktree 全部湧入，而使用者只看到清單變長）。無論如何
  **不得靜默回傳空清單** —— 一個空的 quick open 與一個「這個 repo 真的沒有檔案」在畫面上長得
  一模一樣。

- **[焦點歸還失敗使快捷鍵靜默失效]** → 見 D5。這條的失效方向最惡劣（間歇、無錯誤、使用者判定
  為「壞了」），因此驗收必須**連開兩次**：開啟 → 關閉 → **再開啟一次**。只驗一次的話，焦點沒還
  回去也照樣通過。

- **[「不阻塞」的驗收若用代理判準會結構性失明]** → 直覺作法是攔截 `node:child_process` 的同步
  匯出、斷言它們沒被呼叫（既有的 `git-branch.test.ts` 就是這樣寫的）。**但 ESM 的具名匯入
  （`import { execFileSync } from 'node:child_process'`）不經屬性查找，攔不到** —— 實測：受測
  模組照常執行了同步呼叫，而攔截器看到的呼叫紀錄是空的。既有那兩支測試沒踩到，是因為它們的受測
  模組根本不 import `child_process`。**改為驗性質**：列舉期間排入一個計時器，斷言它在列舉完成
  之前就執行了。對照組（把實作改成同步版本）必須讓它變紅。

- **[驗收只驗「側欄裡開得起來」等於沒驗]** → 一個無條件攔截的錯誤實作會通過那條斷言。**兩個方向
  都要有對照組**：側欄持有焦點時開得起來、**且**終端持有焦點時 `Ctrl+P` 不開啟 overlay 而是抵達
  pty（後者以既有的「按鍵是否流進 pty」手法承擔 —— 而該手法本身有前科：`cat -v` 不 escape Tab，
  那條外洩偵測從未生效過，改用 `cat -A`）。

- **[git 列舉與遞迴退回兩條路徑，只驗一條]** → fixture 必須涵蓋 git repo **與**非 git 目錄。
  `probe:files` 的既有 fixture 恰好是非 git 的，`probe:openspec` 的是 git 且有 3 個 worktree ——
  兩者合起來涵蓋得到，但**不得假設它們會自動涵蓋**：巢狀 worktree 去重那條需要一個「worktree 在
  repo 內部」的 fixture 才有鑑別力。

## Open Questions

- **最近開啟過的檔案優先（MRU）**：VS Code 的 `Ctrl+P` 在空查詢時列出最近開啟的檔案，那是它最好用
  的部分之一。本 change 不做（需要一份開檔歷史，而它該不該落盤、隸屬於哪個座標維度，都要獨立
  論證）。若 dogfood 認為空查詢的價值不足，這是第一個候選。

- **是否呈現「清單來自哪一種列舉」**：git 與遞迴的結果集不同（後者含建置產物）。目前不呈現 ——
  在非 git 目錄裡使用者本來就沒有「被忽略的檔案」這個概念。若日後發現使用者困惑於「為什麼這個
  檔案找不到」，這是要補的訊號。
