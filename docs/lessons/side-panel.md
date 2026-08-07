# OpenSpec 側欄與 `@spekjs`

元件重用的判準、`@spekjs/core` 的簽名與語意陷阱、worktree 聚合、聚合圖節點識別碼、反向導覽、側欄的資料流與座標、狀態橋接、續寫入口。

> 這份文件是 `CLAUDE.md` 的延伸。**它與 CLAUDE.md 同一個定位：**
> 幾乎每一條都是「不知道就會踩、而且失敗是靜默的」的實測結論。
> 觸發條件（什麼時候該讀它）寫在 CLAUDE.md 的「踩雷指南」。

## 重用的判準是「它綁死了版面嗎」

完整論證見 `docs/PRD.md` §9.2（該節已依 Phase 5 的實作結論改寫）。一句話：**側欄自刻**（spek 的
頁面是為全寬瀏覽器設計的，不是同一個東西），**`SpecGraph` / `ChangeTimeline` 抽進 `@spekjs/ui`**
（它們吃資料、吐 SVG，對宿主零認知）。判斷「該不該重用」要問的是「**它綁死了版面嗎**」，不是
「它在 spek 長什麼樣」—— 我一度自刻了一個二分圖取代 force graph，被判定為「四不像」。

日常會踩到的兩條：

- **套件擁有自己的顏色變數名（`--spek-*`），絕不讀宿主的 token。** spek web 叫
  `--color-text-primary`，我們叫 `--color-ink` —— 名字對不上時圖會**畫得出來但完全沒有顏色**。
  換膚＝覆寫那 8 個變數。**React 必須是 peer 依賴**（兩份實例會讓 hooks 直接爆炸）。
- **d3 把顏色寫進 SVG 屬性**（命令式），不能用 `var()` —— 宿主換膚時圖必須重畫。套件**不去偵測**
  主題（監看 `data-theme` 是在猜宿主的實作），由宿主換一個 `themeKey` 明說「該重畫了」。

## Graph ≠ Timeline

**它們是兩個不同的功能。** Graph 是 spec ↔ change 的**關聯結構**（無時間概念）；Timeline 是 change
的**生命週期**（Gantt，有日期軸）。**兩者都不屬於 side panel** —— Timeline 的最小可用寬度是
**920px**，而側欄上限 620px。它們是「搞懂全局」的動作，不是「一邊駕駛 agent 一邊盯著」的動作，
沒有與 terminal 並存的需求 → 全視窗 overlay。

## `@spekjs/core` 的簽名與語意陷阱（全部實測）

- **`readSpec` / `readChange` 找不到目標時回 `null`，不拋錯**；而 **`readSpecAtChange` /
  `buildGraphData` / `findRelatedChanges` 是同步函式**（會阻塞主行程做磁碟 IO）。危險的是把 `null`
  當成成功值傳下去。
- **`SpecInfo.path` 是絕對路徑。** 直接送給 renderer 會**破壞邊界語彙**。主行程必須翻成
  folder-relative，翻不出來就回 `null` —— 側欄少一個「跳到檔案」的入口，好過洩漏一個絕對路徑。
- **`listChangeMarkdownFiles(repo, slug)` 不是它聽起來的意思** —— 實測回的是 repo 根目錄的
  `["CLAUDE.md", "README.md"]`。改以 OpenSpec 的目錄慣例推導候選路徑，再 `stat` 確認。
- **`GraphNode.label` 對 change 是 humanize 過的描述（`solo change`），不是 slug（`solo-change`）。**
  identity 一律從 `node.id` 取。在 d3 的圖上定位節點要讀 DOM 上的 `__data__.id`，不要讀文字。
- **`ChangeDetail.source` 是一個宣告了但從不被填的欄位**（core 沒有聚合版的 `readChange`）。
  要來源就**從掃描結果取**（`ChangeInfo` 本來就帶著它）。
- **`ChangeInfo.createdDate` 只來自每個 change 的 `.openspec.yaml`（`created:` key）。** 沒有它，
  change 就**放不上 Timeline**。造 fixture 時很容易漏 —— `openspec/config.yaml` 是 repo 層的，無關。
- **`SpecInfo.historyCount` 恆等於 `findRelatedChanges()` 的長度**（實測吻合），所以 Specs 清單的
  「N changes」是零成本的。
- **`schemaOrder` 的 CLI 快取 key 是 `repoRoot::schema`，不跨 worktree。** 影響比直覺小：它發生在
  `readChange`（開啟某個 change），**不在掃描路徑上**。**不在本 app 疊一層自己的快取** —— spek 用
  同一份 core，要改該在 upstream 改。

## worktree 聚合

**涵蓋範圍、去重、graph 節點命名全部委由 core**（upstream #17／#23）。宿主端只做四件事：來源 DTO
（丟棄絕對路徑，換成識別碼＋分支）、三個讀取根、兩層 watcher、Timeline 分組的適配。

- **「worktree ≤ 1 時 core 靜默退回非聚合」是最大的假綠來源。** `scanOpenSpecAggregated` 在
  `aggregate: false` **或工作目錄只有一個**時，回傳結果等同 `scanOpenSpec`。這讓回歸風險極低 ——
  但也意味著**驗收的 fixture 若 `git worktree add` 失敗，每一條斷言仍會通過**。
- **讀取根有三個，不是一個**（core 的聚合是 `specs: main.scan.specs` —— spec 一律取自主工作目錄）：

  | 讀什麼 | 根 |
  |---|---|
  | change 的內容 / 某個 change 當下的 spec 版本 | **該 change 自己的來源工作目錄** |
  | spec 的內容 | **主工作目錄**（不是 folder 自己！） |
  | relPath 的翻譯基準 | **folder**（翻不出來就 `null`） |

  沿用單一根的話兩種情形會壞：folder 是 **linked worktree** 時只存在於主工作目錄的 spec **列得出來
  卻打不開**；folder 是 repo 的**子目錄**時**每一個** spec 都打不開。
- **`isMain` 與 `isFolderRoot` 不可互代。** `listWorkspaces` 從一個 linked worktree 呼叫時，`isMain`
  掛在**該 repo 的主工作目錄**上。要問的是「**agent 站的地方，就是 change 在的地方嗎**」＝
  `source.path === folder.path`。DTO 因此帶兩個布林：`isMain`（來源的**性質**，呈現用）與
  `isFolderRoot`（來源與**這個 folder** 的關係，能力判定用）。folder 本身是 linked worktree 時兩者
  相反。
- **gitdir 要多解一層 `commondir`。** worktree 清單住在 **common dir** 底下的 `worktrees/`，而
  `.git` 檔案只指到 `<main>/.git/worktrees/<name>` —— **那底下永遠不會有 `worktrees/`**。
  少了 `resolveCommonDir()`，watcher 會 attach 到一個永不存在的路徑，而 chokidar **不報錯、也不發
  事件**。
- **監看工作目錄清單本身是承重的，不是加保險** —— worktree 是「先建立目錄、後寫入 change」，只監看
  既有工作目錄的 `openspec/` 時，新建 worktree 的第一次寫入**沒有任何 watcher 在場**。這與「先訂閱、
  再掃描」直接打架，解法是分兩層。基礎層要 `depth: 0` 且只理會 `addDir`／`unlinkDir`：實測在
  worktree 裡跑一次 `git commit` 會產生 3 個檔案事件，不收窄的話每次 commit 都重跑一次聚合掃描
  （約 175ms）。
- **`isWithin` 是純字面比較**，而這裡第一次拿兩個獨立來源的絕對路徑相比（`workspace.json` vs
  `git worktree list`）。**兩端目前都是 realpath**，所以比得起來。**若 workspace 的路徑正規化改變，
  每一個 change 的「跳到檔案」會同時靜默消失。**
- **連帶一個已接受的行為切換**：folder 是 repo 的子目錄時，該 repo 只要有 ≥2 個工作目錄，整個 repo
  的 spec 與 change 就會突然出現在側欄（`listWorkspaces` 是對 repo 作答，不是對子目錄）。

## 聚合圖的節點識別碼

聚合關係圖的 change 節點 id 是 `change:<worktreeKey>:<slug>`。**我們送出的圖必須先還原識別碼、
再剝掉來源 —— 順序是承重的**（判斷「那個 key 存不存在」靠的正是即將被剝掉的 `source`）。

只做剝除會送出一個**不自洽**的節點，而**兩個消費端都不報錯**：`SpecGraph` 把整串當成 slug 交出去
⇒ **錨定到一個不存在的 change，還會寫進落盤**；`changeTopicsMap` 查表落空 ⇒ **Timeline 的分組全部
掉到「無 topic」**。

- **`changeNodeSlug` 回傳的是 slug，不是識別碼** —— 前綴要自己補，且**只能對 `type === 'change'`
  的節點施加**（否則 `spec:auth` 會變成 `change:spec:auth`）。**直接拿回傳值當 id（裸 slug）是最
  危險的寫法**：兩個消費端對它照樣運作，只有「識別碼恰為 `change:<slug>`」這條斷言擋得住。
- **邊的兩端也要換。** 而 `GraphEdge.source` 是**端點**、`GraphNode.source` 是 **worktree 來源** ——
  兩個 `source` 在同一段程式碼裡，極容易看混。只換節點不換邊，症狀與完全沒換相同。
- **`@spekjs/ui` 內部對聚合 id 的處理不一致**：`SpecGraph` **在 `node.source` 存在時**才剝掉 key，
  `buildLanes` / `changeTopicsMap` 不剝。**spekterm 是唯一刻意剝掉 `source` 的宿主**，於是那條
  guard 對我們恰好是假的。**抄別人的行為表時要連 guard 一起抄。**
- **邊指向一個不存在的 spec 節點是合法狀態，不是 bug**（upstream 已正確駁回）。spec 節點來自**已
  納入 specs 的 capability**，而一個 change 的 delta 可以提議一個**尚未納入**的 topic —— 那正表達
  「這個 change 提議一個新 capability」。與聚合無關。
- **產生格式的地方與解析格式的地方應當同居。** 解析原本住在 `@spekjs/ui`，正是 upstream #25 的
  溫床（core 開始加 key，ui 的解析沒跟上，**沒有任何東西會紅**）。已回報並採納：現在是
  **`@spekjs/core/graph-node-id`**（node-free subpath）—— **於是主行程 import 得到它**
  （`@spekjs/ui` 的入口會拉進 JSX／d3／React，Node 環境碰不得）。
  > **判斷「該不該回報 upstream」的一個訊號：你正要手寫第二份它剛抽出來防止重寫的東西。**

## 反向導覽與工作目錄清單

判準是「**以工作目錄根由長至短逐一嘗試**，剝除該根之後首段為 `openspec` 且其後符合已知結構者即
命中」。

- **folder 自身必須恆入清單（以空字串），不經 `toRelPath`、不取決於 git 列舉是否成功。**
  三條路都會靜默把它弄丟：`toRelPath(root, root)` 回 **`null`**；非 git 目錄的 `listWorktrees` 回
  **空陣列**；folder 是 repo **子目錄**時那筆指向 repo 根而落在邊界外。
  **清單裡不以 `null` 佔位** —— 空字串是 folder 自身的合法值，兩者會在消費端糾纏。
- **`toRelPath` 對 folder 自身回 `null`，所以「合成 + 翻譯其餘」會產生兩筆。** 照抄那個結構寫新
  API，**每一個 folder 即其 repo 主工作目錄的普通 repo**（最常見的情形）都會得到兩筆，而後者標著
  「位於此 folder 之外、無法瀏覽」—— 選擇器於是在每個 git repo 都冒出來。**正解是「合併」而非
  「附加」**：列舉中 `path === root` 的那一筆**就是**代表 folder 自身的那一筆。以 `self` / `others`
  的**互斥分割**表達，讓不變式由結構保證，而不是靠事後去重。
- **spec 一律來自主工作目錄，所以它的入口要標示來源。** worktree 裡的 spec 檔案跳過去呈現的是
  主工作目錄那一份，而往返會把使用者送到**另一個檔案**。**仍然給入口**（反向導覽的目標是 **topic**
  這個實體，不給只會製造另一種不對稱），**但必須標示**，且只在該 repo 有**多於一個**工作目錄時標
  （單一工作目錄時沒有歧義，標示只是噪音）。
  > **同一個決定上，頻率假設連錯兩次，方向還相反。** 第一版裁決「不給入口」（把罕見當常態）；
  > 翻轉之後又寫「只有跑過 `/opsx:sync` 才會分歧」（把常態當罕見）。實際上工作流要求 archive 前在
  > worktree 裡 backfill main spec —— **分歧是每個 change 出貨前的常態終局**，而那正是使用者最常
  > 盯著側欄的時刻。**該動的是代價的處理，不是裁決本身。**

## Files 的工作目錄

- **權威恆為完整的 folder-relative 路徑，只有「呈現給人看的那一段」剝前綴。** 回報是三件事免費成立：
  未存變更跨工作目錄切換自然存活（鍵沒變）、反向導覽的判定一行不用改、watch 不受影響。
  - **`title` 必須留在完整座標系** —— 它同時是 6 個 probe 助手的選擇器。剝掉它，那些助手**選不到
    元素而回 `false`**，導航靜默停住，其後的斷言驗的是上一個狀態。麵包屑因此 `title={完整路徑}` 而
    顯示剝前綴 —— **兩者要成對驗**，只驗一邊的話「兩邊都不剝」或「兩邊都剝」都會通過。
- **樹根解析必須在父層，因為它同時是 key。** 在 `FilesPanel` 內解析的話，樹會先以 folder 根建起來、
  清單抵達後再整棵換掉，而 key 沒變、初始狀態也不會重設。連帶：`useFileTree` 的**根狀態鍵是
  `rootPrefix` 而非 `ROOT_PATH`** —— `rootLoading` / `rootError` 漏改，工作目錄根的「載入中…」與根層
  錯誤訊息會**靜默地永遠不出現**。
- **「使用者主動切換」四個字是規範性的。** 切換工作目錄要關閉開啟中的檔案，但**跨身分導覽也會切換
  工作目錄**，而它緊接著就要開一個檔案。兩者若共用觸發點會變成「開了又關」或「關了又開」。
  **而 bug 的方向不對稱**：關檔那條 scenario 兩種順序都會通過，只有跨身分導覽那條會時綠時紅 ——
  紅燈會指向錯的地方。觸發點因此是**選擇器的選取事件**。
- **`fs.*` 的定址一行未改** —— 可選的工作目錄一律在 folder 邊界內，切根只是換一個路徑前綴。

## 側欄的資料流與座標

- **重取時不可回到 loading。** `openspec/` 一有變更就重新取數，但**保留舊資料** —— agent 每存一次檔
  就閃一次「載入中…」，側欄會變成一塊閃爍的東西，而使用者正在讀它。`loading` 只在「還沒有任何
  資料」時為真。**反過來，key 變了（切 folder、換 change）就必須把資料清掉** —— 沿用上一份的話會有
  一瞬間顯示**上一個 folder 的 change**，那比 loading 更糟，因為它看起來像是真的。
- **側欄座標（來源 repo／工作目錄／錨定的 change）是 per-folder 的，落盤於 `panel.json`。**
  刻意**不與 folder 清單同居** —— `parseWorkspace` 是 all-or-nothing 且它損毀的代價是「失去所有
  repo」，而錨定一次 change 就要重寫一次那份清單。
  - **鍵刻意措辭為「rail 項目的識別碼」**（今日等於 folder id）—— **issue #5**（rail 把 worktree
    列為一級項目，尚未做）到來時是**擴充鍵空間**而非重做。而 per-folder 的模型順帶回答了 #5 自陳
    未解的那個問題：**rail 選中 worktree ＝ 設定工作目錄維度，不是 repo 維度** ⇒ OpenSpec 維持
    聚合、Files 以該 worktree 為根。同理 Files 的工作目錄欄位命名為**側欄來源的維度**而非 Files
    專屬，#5 到來時是擴充消費者。
- **切換來源時 `anchoredChange` 必須重置** —— slug 隸屬於某個 repo，沿用舊 slug 會對著一個在新 repo
  不存在的 change 顯示空狀態，**看起來像壞掉**。「一個 (repo, change)」在資料上是「來源 + 隸屬於它
  的錨定」，不是一個獨立的複合鍵。
- **「一堵拿不到 pid 的牆」擋住了「側欄自動跟隨 agent 實際在動的 repo」這條路。** Linux 的 inotify
  **不回報 pid**，fanotify 需 `CAP_SYS_ADMIN`。於是「哪個 session 改了哪個 repo」在核心層面就拿不到。
  被這堵牆逼一下之後，正確的框架是「把側欄的來源與 rail focus 解耦」—— 不需要偵測、不需要歸因。
  > **這條擋住未來想「加點自動化」的衝動**：那條路沒有可靠的入口，除非願意讀 claude 的 transcript，
  > 而那是把設計綁在 claude 的內部檔案佈局上。
- **「側欄選一個 repo 而非聚合多個」的決定性理由**：Files 的檔案樹是單一 repo 的階層，本就一次只能
  呈現一個來源；若 OpenSpec 聚合而 Files 只能選一個，兩個身分的來源語意會分裂。
- **watcher 的錯誤一律經 `src/main/watcher.ts` 回報，不要在呼叫端另建 watcher。** 那個模組是
  chokidar 的唯一入口（eslint + `scripts/watcher-source.test.mjs` 兩道守衛），錯誤處理與
  `followSymlinks` 都在裡面。此前三個站點各自建構，於是演化出三種姿態 —— 其中
  `openspec-service` 的 `on('error', () => {})` 使「watcher 建不起來」與「檔案沒變」無法區分，
  而 `branch-service` 根本沒掛 handler（Node 對沒有 listener 的 `'error'` 直接 throw ⇒ 主行程
  掛掉 ⇒ 所有 pty 陪葬）。
  > **這裡原本寫著一個錯誤的根因，留作教訓**：舊版說「`inotify` 的 `max_user_instances` 是
  > per-user 的 128，app 每監看一處就吃一個，加夠多 repo 側欄就會安靜地停止更新」。**實測是
  > 錯的** —— libuv 對整個 event loop 只開**一個** instance（主行程實測佔 3 個），每個路徑是
  > 一個 **watch descriptor**，上限是 `max_user_watches`（524288，主行程實測佔 7675）。
  > 真正會撞到的機器是 `max_user_watches` 仍為 8192 預設的那些，見 README 的疑難排解。
  > **一個看起來相關、又容易量到的數字（97/128），不等於規格真正在乎的那個。**

## 與 agent 的狀態橋接（`claude-status-bridge`）

狀態列上「只有 agent 算得出來」的那幾段（模型顯示名、context 用量百分比、花費、rate limit）不是
我們算的 —— spawn 時以 **`--settings`（公開的 CLI 旗標）**注入一個 `statusLine` 命令，把 claude
已經算好的 payload 落盤，主行程監看後推給 renderer。

- **不解析 transcript。** 那裡面**有** model id、effort、token usage、cwd、gitBranch；**沒有**花費、
  rate limit、**context window 大小**。而 `message.model` 的 **`[1m]` 後綴被拿掉了** —— 1M 與 200k
  兩種變體長得一模一樣，**百分比的分母算不出來**。
- **`--settings` 吃 inline JSON 也吃檔案路徑，且是疊加**（只有 `statusLine` 被指定）。
- **注入的命令看得到我們設給 pty 的環境變數** —— 落點因此可以是 per-session 的路徑，同一份設定檔給
  所有 session 共用。
- **payload 內含 `context_window.context_window_size`** —— **於是不需要維護一張「模型 → context
  window」的對照表**。那種表會隨新模型過期，而**它失效的樣子是一個看起來很正常的錯誤百分比**。
- **`rate_limits` 在全新 session 的 payload 中缺席** —— **每個欄位都必須能單獨缺席**。
- **預設啟用**（第一版「預設關閉」的理由被實測推翻）：`⏵⏵ auto mode …` 那條**不是** statusLine，
  兩種情況都在。自訂的 statusline 是額外多出來的一行 —— **接管一個空位，損失為零**。
  **但有一條保險**：使用者已有自訂 statusline、而我們**讀不出**它的命令時，**整個不注入** ——
  注入會讓他失去自己那條，不注入只是少一個他還不知道存在的功能。**兩種失敗的代價不對等，就往代價
  小的那邊倒。**
  > **這推翻了「別綁 claude 的內部佈局」嗎？沒有，而區別是承重的**：那條教訓的情境是「猜錯 → 撞號
  > → session 死掉」，**降級方向是災難性的**；這裡猜錯的下場是狀態列少幾個欄位。而且我們綁的是一個
  > CLI 旗標與它自己的輸出。**同一條紀律不該無差別套用 —— 要問的是「失效時會怎樣」。**

## 續寫入口（`artifact-continuation`）

側欄在 change 尚缺 artifact 時提供入口，觸發即把 **`/opsx:continue <slug>` 送出並執行**於 focused
session 的 pty。

- **送 slash command 而非自然語言**：行為本就是「產生恰好一個然後停」、帶 slug 可省掉反問，
  而且它是 ASCII，**於是「該用中文還是英文」這個沒有好答案的問題根本不存在**。
- **一顆按鈕而非每個缺漏各一顆** —— 續寫流程一次只產生一個且由它自己挑，四顆按鈕會承諾一個它給
  不出的選擇。
- **`null === null` 的誤啟用是這裡最危險的一條。** 全域 session 沒有所屬 folder（`null`），而全域
  項目的側欄來源**預設也是缺席** —— 樸素的 `panelSource === session.folderId` 會讓入口亮起來，然後
  把 change 識別碼送進一個站在家目錄的 agent，它會在**家目錄**建出一個同名的空 change。
  **而一個取決於「今天恰好用 `?.` 還是 `??`」的安全判定，本身就不可接受**，不論它今天倒向哪一邊。
  判定因此抽成純函式並由**對照組**守住。
- **第 4 個條件（來源工作目錄）不能寫成「比對兩個識別碼」**：開在 folder 根的 session **沒有識別
  碼**，而 folder 本身是 linked worktree 時**它自己的 change 帶著識別碼** ⇒ 錯誤地停用一個會成功的
  入口。正確的是兩段式 —— `session 有 key ? origin.key === session.key : origin.isFolderRoot`。
  **舊判準沒有消失，它降級成了新判準的一個分支。**
  > **一般形式：一個條件依賴的「巧合」被打破時，它通常不是變得多餘，而是需要更精確的判準。**
