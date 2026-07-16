# CLAUDE.md

![x](https://example.com/image.webp)

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

spekterm 是一個以 agent 為核心的本地開發工作台 —— 獨立的 Electron 桌面 app（私有、專有授權），
把多個「一個 repo／資料夾各自一個 `claude` session」的 terminal 包在一個殼裡，
並加上一塊懂 OpenSpec 結構的側欄，讓使用者不必另外開 IDE 就能一邊駕駛 agent、一邊看著 spec 上下文。

**現況：Phase 5（`openspec-side-panel`）已封存。** Phase 0–4 亦已封存：Electron
骨架、PRD §12 信任模型、`node-pty` spawn 真 pty、主行程以 `@spekjs/core` 直接掃描 OpenSpec
結構、多 folder 工作區（清單持久化於 userData）、活動列 + rail + 三欄版面、受邊界約束的
`listDir`、side panel 的 `[◈ OpenSpec │ ▤ Files]` 身分切換、遞迴檔案樹（lazy load + chokidar
監控）、面板內的檔案檢視與編輯、完整 CRUD、dirty buffer（跨換頁與跨 folder 存活）、mtime
樂觀鎖、watcher 的自寫事件抑制、關閉視窗時的未存提示，以及 Phase 4 的 terminal（`node-pty`
多 session、IPC 雙向串流、xterm + fit、session 分頁 + rail 子列、spawn 目標可選 `claude`／
login shell、關分頁／reload／關視窗三路徑皆**不留孤兒行程**）。

Phase 5 讓側欄**首次真的懂 OpenSpec**（在此之前那格只是一塊 placeholder，這個 app 相對於
「開四個終端機分頁」沒有增量價值）：主行程以 `@spekjs/core` 為**每個 folder** 供應 OpenSpec
結構（per-folder 快取 + `openspec/` 的 chokidar 監看 → **agent 改檔，側欄自己更新**）、
`openspec.*` IPC（形狀對齊 spek 的 `ApiAdapter`，全部只收 `folderId`）、renderer 的
`IpcAdapter`、side panel 的兩個視圖（**本 change** ＝每個 artifact 一個分頁；**瀏覽** ＝ Specs／
Changes 兩棵樹）、tasks 進度與 spec deltas 的 BDD 高亮、spec/change ↔ 檔案的**交叉導覽**、
session 的**錨定 change**（側欄跟隨 focused session），以及 **Graph 與 Timeline 的全視窗 overlay**
—— 那兩個來自新抽出的 **`@spekjs/ui`**（發佈至 npm，與 spek web 共用同一份 d3 力導向圖與 Gantt）。
`probe:openspec` 142/142，dev 與 build 兩模式。

`session-navigation-and-labels`（不屬於任何 Phase）再補上**鍵盤導航**——`Ctrl+Tab` 切 session、
`Ctrl+↑↓` 切 repo、`Ctrl+T` 開 spawn 選單（選單可全鍵盤操作），攔截點在 window 的 **capture 階段**
（早於 xterm 與 Monaco，被攔下的按鍵不會流進 pty）；以及 **login shell 不再採用 pty 宣告的 OSC 標題**
（那串 `使用者@主機:/路徑` 零資訊量，且它晚一秒多才到、抵達時把「+ session」入口往右推 150px）。
`probe:keyboard` 64/64、`probe:terminal` 112/112。

`renderer-security-hardening`（不屬於任何 Phase）是一次資安掃描後補上的三項**縱深防禦**——
主行程施加的 **CSP**（inline script 不執行、鎖死 script／object／iframe／base-uri，為 XSS 立足點
設第二層防線；**放行遠端 https 圖片**——那是 markdown 的正常內容；dev／production 切換依
`ELECTRON_RENDERER_URL`，不是 `app.isPackaged`）、`clipboard:writeText` 的**型別 guard**
（非字串輸入不再使主行程拋未捕捉例外）、xterm 的 **OSC 8 `linkHandler`**（OSC 8 超連結改走
`openExternal`，不落入 xterm 內建的 confirm＋window.open）。`probe:files` 101/101、`probe:terminal`
114/114。

`rail-legibility-and-repo-row`（不屬於任何 Phase）是**第一次 dogfooding 的回饋**——字太小、repo
名稱不夠突出、每個 repo 底下都掛一行「OpenSpec」。它交付兩個新能力與一次 rail 重整：
**`typography-scale`**（全 renderer 的字級收斂為 token，**只剩一個旋鈕 `--text-base`**，定案 17px；
收斂前有 70 處寫死的 `text-[Npx]`，於是 `@theme` 裡的 token 調了也沒用；新增守衛擋住寫死字級）、
**`repo-branch`**（rail 顯示 git 分支，讀 `.git/HEAD` 不 spawn `git`，**兩層 watcher** 使「在
terminal 裡切 branch」即時反映），以及 rail 的 repo 列重整（移除那顆 `onClick` 裡只有
`stopPropagation()` 的 **`◈` 假按鈕**、名稱取回視覺主導、副標由「每列都喊一次的 OpenSpec」改為分支，
「缺少 `openspec/`」降級為弱訊號）。詳見下文「字級尺度」與「git 分支」兩節 —— 那裡記著四個**會靜默
失敗**的實測踩雷。`probe:terminal` 120/120、`probe:workspace` 42/42。

`session-title-authority`（不屬於任何 Phase）是**第二次 dogfooding 的回饋**——「把 session 改名成 b
之後，claude 一直跳訊息要改回 a」。它移除了「pty 想改名要先問過」的**整個確認對話框**：使用者一旦命名
就是**永久接管**命名權，pty 其後宣告的 OSC 標題一律**靜默地不予呈現**（交還的唯一路徑是把名字清空）。
根因不是實作 bug，是 `session-rename-and-reorder` 的一個錯誤假設——它假定「pty 想改名是罕見事件，值得
問一次」，但 `claude` 隨任務進展**持續**改標題。詳見下文「session 的命名權」那條的引文。連帶：那條以
「標題衝突對話框」為載體的**快捷鍵抑制驗收**換成了 **Graph／Timeline overlay**（它本來就是
`role="dialog"`，卻從未被驗過抑制——**把一筆隱藏的技術債換成了資產**，而不是把「三種」默默改成兩種）。
`probe:terminal` 108/108、`probe:openspec` 146/146、`probe:keyboard` 64/64。

`session-restore`（不屬於任何 Phase）是**第三次 dogfooding 的回饋**——「把 app 關掉再重開，原本的
claude session 跟 shell session 都會消失不見」。消失的不只是 pty（那是必然），而是**連「開過哪些
session、叫什麼名字、什麼順序、錨定哪個 change」都沒了** —— session 狀態一直是**純記憶體**的。
它交付新能力 **`session-persistence`**：session 清單落盤（`sessions.json`，版本 + 原子寫 + 損毀隔離，
比照 `workspace.json`；快照另存 `sessions/<id>.scrollback`）、重開時**原樣重建**、**claude 真的續接
對話**（以 `--session-id` 開、以 `--resume` 續）、shell 於**最後已知的 cwd** 重生並**重播上次的畫面**，
以及**休眠**——重建的 session **於首次被顯示時才 spawn**，於是開 app 只起**一個** claude，不是 N 個
一起搶 CPU。連帶修好「reload 也會清光 session」。`probe:terminal` 144/144（新增 36 條）。

`ui-copy-i18n`（不屬於任何 Phase）把 **app 的文案從中英混雜正名為全英文**，並讓文案第一次**有地方
住**。原本約 150 個使用者可見的字串硬編在 JSX、`aria-label`、`title`、原生對話框與 `TerminalError`
的 message 裡 —— 同一條活動列上並排著 `Handoffs` 與「搜尋」「設定」。它交付 **i18next + 單一 `en`
字典**（`src/shared/i18n/en.json`，**主行程與 renderer 共用同一份**）、key 的**編譯期型別安全**、
以及一道**守衛**（產品原始碼的字串字面值不得含 CJK，註解豁免 —— 走 AST 而非行掃描）。連帶：
**`aria-label` 同時是選擇器**這件事被正面處理 —— 6 支 probe 的 97 處選擇器與 `Ctrl+T` 的
`querySelector` 全部改為**自同一份字典取字串**，於是「改文案 → 探針靜默選不到元素」這個失敗模式
被結構性地消滅。`npm test` 228/228，六支 probe 全綠（15 / 42 / 101 / 162 / 64 / 146）。
詳見下文「UI 文案與 i18n」—— 那裡記著五個**會靜默失敗**的實測踩雷。

`workspace-reordering`（不屬於任何 Phase）是**第四次 dogfooding 的回饋**——「repo 的順序不能改，而
排序只有滑鼠一條路」。rail 的 repo 一律照「加入的先後」排（那是一次性的偶然），而 session 雖然能拖曳
排序，卻**沒有鍵盤對應** —— 在一個「終端幾乎永遠持有焦點」的 app 裡，那代表每次調整順序都得把手從
鍵盤上拿開。它交付：**repo 的拖曳排序 + 順序落盤**（`folders.reorder`，**以識別碼定位而非位置** ——
清單的權威在主行程，飛行中的索引可能已指向另一個 folder）、**四顆排序快捷鍵**（`Shift+↑↓` 移動選中的
repo、`Shift+←→` 移動 focused session，**端點不循環**），以及**可拖曳項目的游標**（靜止 `pointer`、
拖曳中 `grabbing` —— 原本是 `grab`，那宣告的是「這東西只能被拖」，但它們點一下是有作用的）。

`Shift+arrow` 的代價**與前三顆鍵不同種**：**已知的犧牲者正是 `claude` 自己的 agents view** ——
`Ctrl+T` 能拿的關鍵前提是「claude 沒在用它」，這一顆是**明知它在用仍然拿走**（使用者在知情下的裁決；
退路 `Ctrl+Shift+arrow` 成本為零）。它也帶來一條導航快捷鍵**沒有**的例外：**可編輯文字讓路**
（`Shift+arrow` 就是文字選取鍵）。

**最重要的收穫來自 `/opsx:verify` 的獨立稽核**：它抓出一個**既有**的 off-by-one —— 拖曳往下放時，
東西落在**指示線的下一格**（把 repo 拖到第二個 repo 的下半部，它會飛到清單末端）。那個 bug 從
`session-rename-and-reorder` 起就在，卻通過了每一輪驗收，**因為分頁列的拖曳只用兩個分頁測 —— 兩個
項目時，兩種語意的結果完全相同**。而我寫探針時**撞見了它、卻把準心移開去閃避它**。詳見下文「拖曳的
落點」與「游標」兩節。`npm test` 238/238，六支 probe 全綠（16 / 56 / 102 / 168 / 104 / 146）。

`side-panel-repo-anchor`（不屬於任何 Phase）是**第五次 dogfooding 的三大痛之首**——「我在 repo A
的 session 裡叫 claude 去改 repo B，但側欄還停在 repo A、看不到 repo B 的 openspec 與 files」。
根因是 `MainStage` 的 `folder` prop 一路灌到底，同時決定「駕駛誰」（terminal）與「讀誰」（側欄）——
在單 repo 世界這永遠是同一個 folder（**巧合，非設計**），agent 一旦跨 repo 就破了。它把側欄的來源
與 rail 的 focus **解耦**：側欄的來源是 **per-session** 的屬性（比照 `anchoredChange` 的自然擴展 ——
粒度從「一個 change」放大為「一個 (repo, change)」，共用同一條「側欄跟隨 focused session」的線）、
隨 session 一併落盤（`sessions.json` 加 `panelFolderId?`）、可指向 workspace 中任一 folder，
terminal 那半完全不受影響；重開 app 上次側欄看哪個 repo原樣還原（folder 若已被移除則退回自身
folder）。切換來源時**重置 `anchoredChange`**（change 的 slug 隸屬於某個 repo，換 repo 後舊 slug
不存在）。**proposal 一度設想的「跟隨/釘住」toggle 被取消**：session 掛在哪個 folder 不隨 pty 的
cwd 浮動，「跟隨」退化為「釘在自身 folder」，一個 toggle 無事可做（design D1）—— 側欄來源指向非
自身時提供「回到自身 repo」一鍵捷徑取代它。**「側欄選一個 repo 而非聚合多個」的決定性理由**：Files
的檔案樹是單一 repo 的階層，本就一次只能呈現一個來源；若 OpenSpec 聚合而 Files 只能選一個，兩個
身分的來源語意會分裂。`probe:openspec` 182/182（+18 條：15 條跨 repo + 3 條 reload 還原）、
`npm test` 240/240。

`shell-affordance-tweaks`（不屬於任何 Phase）是**第五次 dogfooding 的三個殼層小毛病** —— 按 `Alt`
會浮出一條**空的原生 menu bar**（app 從未定義任何 menu 內容，只擋畫面）；建立 session 的按鈕寫著
`+ session`，一顆 `+` 已足夠表意；有 `Ctrl+T` 開建立入口，卻沒有對應的關閉快捷鍵，關 session 只能
點分頁的 ✕。三條各自獨立、都便宜，一起收：`Menu.setApplicationMenu(null)`（**不是**
`autoHideMenuBar` —— 那只是隱藏、按 `Alt` 仍浮出）、`+ session` → `+`（**`aria-label` 不動** ——
它是 6 支 probe 與 `Ctrl+T` 的選擇器）、`Ctrl+Shift+W` 關當前 session（**代價為零**：`Ctrl+Shift+<字母>`
在終端協定裡編碼不出來，pty 內收不到；與 GNOME Terminal 的關分頁一致）。`probe:keyboard` 114/114
（+10 條，兩模式各 5）、`probe:terminal` 168/168（`+ session` → `+` 不打到既有選擇器）。

尚未開始：打包（Phase 6）、handoff（Phase 7+）。**session 常駐**（讓 pty 活過 app 的生命）已排入
路線圖但**刻意不做** —— 見 `docs/PRD.md` §11 的「session 常駐」，那裡記著 tmux 與自寫 daemon 的取捨。

### 開發指令

```bash
npm run dev             # electron-vite dev（開發模式）
npm run build           # 建置至 out/
npm run typecheck       # tsc：main / preload（node）+ renderer（web）
npm test                # node:test 單元測試（fs 邊界、workspace store、listDir/readFile、watcher、外部 URL、pty 管理器、git 分支解析、字級不得寫死、舊產品名不得殘留、UI 文案不得含 CJK、aria-label 不得硬編、字典 key 的型別安全）
npm run probe:shell     # 驗收 workspace-app-shell（開視窗 + 信任模型 + preload 白名單，走 CDP）
npm run probe:workspace # 驗收 workspace-folders / filesystem-access / workspace-layout / repo-branch（rail 呈現分支、於 app 之外切 branch 後自己更新、detached HEAD、執行期間變成 git repo、rail 不呈現不可操作的控制項；**repo 的拖曳排序** —— 落點與指示線一致、末端拖得到、拖 session 子列不會連 repo 一起搬、未位移的按下＝點擊、順序跨重啟還原、可拖曳項目的靜止游標為 pointer）
npm run probe:files     # 驗收 file-explorer / file-viewer / 編輯 / 存檔 / 衝突 / CRUD / 導航防護 / 編輯器 worker / CSP（遠端圖片可載入、script-src 僅 self、注入點對 file:// 生效，dev + build 兩模式）
npm run probe:terminal  # 驗收 terminal-sessions + session-persistence（pty 雙向／cwd／resize／多開／關分頁・reload・關窗皆不留孤兒；剪貼簿畸形輸入防禦；OSC 標題與命名權；**關掉 app 再開後 session 原樣重建**、只喚醒被顯示的那一個、claude 以 --resume 續接同一個對話、續接失敗自癒為全新對話、shell 於最後 cwd 重生並重播畫面、kill -9 後快照仍在、損毀韌性、被竄改的識別碼不進命令 —— 皆以 PATH 上的 stub claude 承載，dev + build 兩模式）
npm run probe:keyboard  # 驗收 keyboard-navigation（Ctrl+Tab 切 session／Ctrl+↑↓ 切 repo／位置序非 MRU／按鍵不流進 pty／編輯器與對話框的行為；**Shift+↑↓ 排 repo、Shift+←→ 排 session** —— 端點不循環、移動後仍選中／focused、終端持有焦點時仍生效且按鍵不進 pty、**編輯器持有焦點時 Shift+→ 仍是文字選取**，dev + build 兩模式）
npm run probe:openspec  # 驗收 openspec-data-access / openspec-panel（兩個視圖／兩棵樹／artifact 分頁／agent 改檔即更新／錨定／交叉導覽／Graph・Timeline 的 overlay，dev + build 兩模式）
npm run probe:native    # 驗收 native-module-toolchain（Electron 主行程載入 node-pty + spawn pty）
npm run probe:core      # 驗收 spek-core-integration（主行程掃描 OpenSpec，且不開 TCP 埠）
npm run probe:identity  # 驗收 app-identity（productName／appId／userData 路徑／視窗標題）
npm run measure:bundle  # renderer bundle 體積報告（依編輯器核心／worker／語言分類歸因）
```

`probe:identity` **不傳 `--user-data-dir`** —— 它要驗的正是 `app.getPath('userData')` 實際解析出來
的路徑，而那個旗標會把待驗的對象本身覆寫掉。其他 probe 用暫存 profile 隔離自己的手法在這裡不適用，
因此它像 `probe:native` 一樣「自己就是一個 Electron 主行程」。

`probe:files` 的開發模式**自己起 renderer dev server（`--rendererOnly`）再自己 spawn electron**，
不用 `electron-vite dev` 直接拉起 electron —— 後者產生的 electron 是孫行程，殺 `npx` 殺不到它
（會留下佔著 debugging port 的殭屍），且它轉發 CLI 參數的 `ELECTRON_CLI_ARGS` 實測未生效，
`--user-data-dir` 進不到 electron 的 argv，探針會讀到你真實的 workspace 設定。

`probe:workspace` 以 `--user-data-dir` 指向暫存 profile，因此可以反覆重啟 app、餵它一份
損毀的設定檔，而不會污染你真實的 workspace 設定。

**收尾殺行程時，殺 wrapper 殺不到它 spawn 的真行程。** `node_modules/.bin/electron` 是個
node wrapper，它自己再 spawn 真正的 electron 二進位；`npx electron-vite dev` 的 vite 也是孫
行程。對 wrapper 送 SIGTERM／SIGKILL，底下的真行程會變孤兒，繼續佔著 debugging port（9224）
或 dev port，讓下一輪 probe 連到殭屍而讀到空樹（實測：一連串失敗看起來像 regression，其實是
殭屍）。**兩種收法**：electron 以獨一無二的 `--user-data-dir=<profile>` 用 `pkill -9 -f <profile>`
連根拔除整棵樹（每個子行程的 argv 都帶著它）；dev server 以 `detached: true` spawn 成 group
leader，再 `process.kill(-pid)` 殺整組。**另外，面板留有未存變更時關閉會觸發原生對話框
（design D15），它會擋住主行程訊息迴圈使 SIGTERM 失效** —— 這也是必須連根拔除而非溫柔關閉
的理由。`probe:files` 的每次探針失敗若伴隨「樹是空的」，先 `pgrep -f spekterm-files-profile` 檢查
有無殭屍，別急著改產品程式碼。

> **`pkill -f` / `pgrep -f` 會匹配到你自己那條命令。** pattern 寫在 command line 上，而
> `-f` 比對的是整條 command line —— 於是 `pkill -9 -f spekterm-files-profile` 會把執行它的
> 那個 shell 一起殺掉（實測：指令中途死亡、後面的清理不再執行，看起來像「殺完就沒事了」，
> 其實一個殭屍都沒殺到）。把 `-` 包成字元類別即可自我豁免：`pkill -9 -f 'spekterm[-]files-profile'`
> —— regex 仍匹配真正的 profile 名，但你自己那條命令的字面不匹配。

**驗互動時用真事件，不要用 `dispatchEvent(new MouseEvent(...))`。** 合成事件不等於真實
輸入：它不走完整的 pointer/mouse/contextmenu 序列，也不觸發 React 19 對 trusted discrete
事件的同步 effect flush。實測踩過：右鍵選單用合成 `contextmenu` 測「全綠」，但真右鍵完全開
不起來 —— 開啟選單的那次事件冒泡到 window，被選單自己的 dismiss listener 當場關掉（React 19
在同一次事件內就把 effect 掛上了）。而「用選擇器 `.click()` 選單項」會跳過定位，選單溢出
viewport 也照樣通過。**右鍵 / 點擊要用 `Input.dispatchMouseEvent`（button:right/left），
並斷言選單的 `getBoundingClientRect()` 完整落在 viewport 內。** overlay/選單類 UI 的定位與
「開啟事件不可自我關閉」只有真事件測得出來。

**但送真滑鼠事件，就得自己面對座標會過期。「量完就點」是在賭版面不動 —— 而分頁列會動。**
pty 宣告的 OSC 標題比 session 晚到**很多**（shell 要載完 rc、畫出第一個 prompt 才送出，實測
一秒以上）。標題一到，分頁標籤就從 `shell 1` 變成 `kewang@host:/長長的/路徑`，寬度暴增，把它
右邊的「+ session」往右推（實測跳了 **150px**）。探針量到的座標於是在幾毫秒內過期，點擊落在
變寬後的分頁標籤上 —— click 的 target 是那個 `SPAN` 而不是按鈕。**症狀看起來卻像「產品的選單
壞了」**（`probe:openspec` 因此在 Phase 5 全程是紅的，一度被當成 regression 追）。兩道防護要
一起上：`stableRect`（連續數次量到同一位置才算數，**取樣窗口必須跨過標題的延遲** —— 只量兩次、
間隔 150ms 會落在標題抵達前的**假平靜期**裡，實測仍然點空），以及**點完確認選單真的開了，沒開
就重量再點**（對手是外部行程何時吐標題，穩定判準只能壓低機率、消不掉它）。

> **一條沒有 `detail` 的 `check()`，失敗時等於什麼都沒說。** 上面那個 bug 難追，正是因為與它
> 同時紅的「該 change 成為側欄呈現的 change」只斷言相等、不印出實際值 —— 它其實是**另一個**
> 競態（側欄換 change 時會清空資料、短暫回到「載入中…」，而它只 `evaluate` 一次就斷言，沒有
> 輪詢）。兩個不同的病擠在同一份紅色輸出裡，看起來像同一個根因。

開發模式（未打包）啟動時，主行程會輸出一行掃描摘要。掃描目標預設為本 repo，
以 `SPEKTERM_SCAN_PATH` 覆寫：

```bash
SPEKTERM_SCAN_PATH=../spek npm run dev
# [openspec] scan /home/me/git/spek specs=43 activeChanges=1 archivedChanges=67 defaultSchema=spec-driven
```

`scripts/probe-*.mjs` 一律透過 CDP 或真正的 Electron 主行程來驗收，**不在產品程式碼裡塞測試分支** ——
要驗的正是被出貨的那份程式碼。撰寫 Electron ESM 主行程時注意：**不可 top-level `await app.whenReady()`**，
ready 事件要等主 script 評估完成才觸發，會死鎖。

### 權威來源

- **`docs/PRD.md`** — 產品需求的**單一權威來源**。任何關於功能範圍、路線圖、架構決策的問題以它為準。
- **`docs/workspace-mockup.html`** — 定案的高保真 UI 互動雛型。**UI 版面與行為以它為權威**；
  PRD §6 的文字若與雛型有出入，以雛型為準。

## Relationship to `spek`

- 開源的 [`spek`](https://github.com/spekhq/spek)（MIT）是 OpenSpec 內容檢視器 monorepo，本機 clone 在 `../spek`。
- **本 repo 是獨立的私有 repo**，專有授權（All rights reserved），**不是** spek monorepo 的 npm workspace 成員。
- 計畫重用 core 引擎（scanner / tasks / git-cache / worktrees / types）與 spek 的前端元件，
  詳見 `docs/PRD.md` §9。

### core 套件的名稱與分發（已定案）

core 對外發佈為 **`@spekjs/core`**（已於 npm public registry 發佈，本 repo 以 `^1.1.1`
宣告依賴）。Phase 5 抽出的 UI 套件為 **`@spekjs/ui`**（`^1.0.1`）。

> **`@spekjs/core` 1.1.0 是「minor 版號卻破壞型別」的一版** —— `ChangeInfo` 新增了 **required**
> 的 `defaultSchema: string | null`。**凡是自己建構 `ChangeInfo` 的程式碼都會 `TS2741` 編譯失敗**
> （典型的受害者是手工組一份 `changes` 餵給 `@spekjs/ui` 的 `<ChangeTimeline>`），純粹**讀取** core
> 產出的值則不受影響。spekterm 之所以毫髮無傷，是因為主行程的 `getChanges()` 把 core 的陣列**原封
> 不動轉手**（沒有 `.map()`、沒有 spread 重建），renderer 的 `ChangeInfo` 又是從 IPC 型別**推導**
> 出來的（`ChangesData['active'][number]`）—— 新欄位於是自己流穿到底。**這個「不重建」的性質是承重的**：
> 日後若在主行程對 change 做欄位改寫（比照 `SpecInfo.path` 的絕對路徑翻譯），就會接下同步 core 型別
> 的義務。（`SpecInfo` 早就是那樣了 —— 但它翻譯的目的地是本地 DTO `SpecSummary`，core 加欄位打不到它。）
>
> 順帶：**`@spekjs/ui` 對 core 是 peer 依賴**（`>=1.0.0`）。升級後務必確認 npm 把它 **dedupe 成同一份
> core** —— 樹上若同時存在兩份，`<ChangeTimeline>` 眼中的 `ChangeInfo` 與我們的就是兩個不同的型別。

改名的原因：**`@spek` 這個 npm scope 已被他人註冊**（佔用者 0 個套件），本專案帳號無權
發佈至該 scope —— 決策與證據見 `openspec/changes/.../design.md` D1。更名與發佈由 `spek`
repo 自己的 change 承載（OpenSpec change 是 repo-local 的）。

**依賴一律宣告 npm 版本，不要把 `file:` / `link:` / `portal:` 寫進版控** —— 那會讓 CI 與
`electron-builder` 打包看到與開發者機器不同的依賴。本機要同步改 core 時用 `npm link` 覆寫。

> 驗證 npm scope 是否可發佈時，**不要用 `npm publish --dry-run`** —— 它只做本地打包，
> 不向 registry 驗證權限（對你無權的 scope 也會「成功」）。npm 的 `scope:` 搜尋過濾器
> 同樣不可靠。可用的方法是 `npm org ls <scope>` 與 `npm access list packages @<scope>`，
> 且都要拿已知存在／不存在的名稱當對照組。

## Tech Stack

Electron 43.1.0（釘死）+ electron-vite、TypeScript、React 19 + Tailwind CSS v4、
node-pty 1.2.0-beta.14（釘死）、Monaco Editor、chokidar 5、react-markdown + remark-gfm、
@xterm/xterm 6 + addon-fit / addon-web-links（terminal UI）、electron-builder（打包，Phase 6）。

完整技術選型與理由見 `docs/PRD.md` §8.3。幾個容易踩的點：

- **node-pty 不需要 `@electron/rebuild`**。它是 Node-API 模組，prebuilt 的 `.node` 可同時
  被 Node 與 Electron 載入（兩者 ABI 編號不同，但 N-API 版本相同）。版本必須釘 1.2.0-beta
  系列 —— npm `latest`（1.1.0）缺 Linux prebuild，會強迫本地編譯。
- **編輯器採 Monaco，且只取語法高亮**（`basic-languages/*` 的 monarch tokenizer），
  **不含任何 `language/*` 語言服務**。編輯器承擔的是語法高亮，深度改檔走 agent 或使用者自己的
  IDE（PRD §6.2）；`ts.worker` 單獨就佔 12.65 MB。實測：含語言服務 21.51 MB、不含 8.81 MB。
  `npm run measure:bundle` 會在建置產物出現任何語言服務 worker 時以非零碼結束。退守 CodeMirror 6
  的成本侷限於 `src/renderer/src/editor` 這個 wrapper 模組。
- **編輯器關閉 Monaco 的 native EditContext（`editContext: false`）**，改用經典的隱形 textarea
  輸入路徑。理由是可驗收性：native EditContext 的 `ime-text-area` **恆為 `readonly`**，與編輯器
  唯不唯讀無關 —— Phase 2 的 probe 曾以「textarea.readOnly === true」斷言唯讀，那條對可編輯的
  編輯器**一樣會通過**，是假驗收（Phase 2 結論剛好正確才沒被發現）。關掉 EditContext 後，
  textarea 的 `readonly` 正確反映狀態，且 CDP 的 `Input.insertText` 能真的打字。驗證編輯能力
  **必須讓內容真的改變並回讀磁碟**，不能只看某個 textarea 的 `readonly`。
- **`react-markdown` 的安全性來自預設值**：原始 HTML 被降級為純文字、URL 由
  `defaultUrlTransform` 過濾（只放行 `http(s)`/`mailto`/`xmpp`）。**絕不可加 `rehype-raw`、
  也不可覆寫 `urlTransform`** —— 檔案樹渲染的是使用者 repo 裡的任意 `.md`，那是不受信任的輸入。
- **終端封裝於單一 wrapper 模組**（`src/renderer/src/shell/terminal/xterm.ts`），與編輯器同一
  條約束：renderer 的其他模組不直接 import `@xterm/*`。**web-links addon 的開啟 handler 必須
  覆寫為走主行程的 `shell.openExternal`** —— pty 的輸出同樣是不受信任的內容（使用者 repo 裡
  任何東西都可能印出一個 URL），不得讓 xterm 自行導航或開窗。

## 產品身分（`rename-to-spekterm` 起 —— **已凍結，不要改**）

| | |
|---|---|
| `package.json` 的 `name` | `spekterm`（unscoped —— 本 package 是 `private`、不發佈，不需要 scope） |
| `productName` | `Spekterm` |
| `build.appId` | `com.spekterm.app` |
| userData | `~/.config/Spekterm` |
| 視窗標題（`document.title`） | `spekterm` |

**`appId` 與 `productName` 一旦隨安裝檔發佈就凍結。** `appId` 進 macOS 的 `CFBundleIdentifier`
與 Windows 的 uninstall registry key —— 改動它的作業系統語意是「**發佈一個不同的 app**」：舊版不會
自動更新過去，使用者手上會同時裝著兩個。`productName` 同理（它決定 userData 的落點，改了＝所有人的
設定失聯）。**Phase 6 之後，這兩個值不可再動。**

- **`app.getName()` 優先讀 `productName`、缺才退回 `name`** —— 所以 `productName` 不只是顯示名稱，
  它同時決定使用者設定存在哪。正名前沒有 `productName`，於是退回當時那個 **scoped** 的 `name`，
  而 scope 名直接成了路徑的一層，造出一個帶 `@` 的巢狀 userData 目錄。
- **品牌書寫全小寫（`spekterm`），但 `productName` 首字大寫（`Spekterm`）** —— 後者是作業系統的
  顯示名稱（Dock、安裝檔名），那些位置的慣例是專有名詞。兩者不同源，不需一致。
- **`npm test` 有一條守衛**（`scripts/naming.test.mjs`）：版控中不得殘留舊名，`archive/` 除外。
  它的對照組要求「**不排除** archive 時必須命中舊名」—— 少了這條，`git grep` 的 ANSI 顏色碼曾讓
  路徑比對靜默失準而全綠（實測）。
- **`probe:identity` 不能傳 `--user-data-dir`**（那會覆寫掉待驗的對象），**也不能寫成 Electron 主
  行程腳本**（`electron <script>` 不讀 repo 的 `package.json`，只會量到 Electron 的預設值 `Electron`）。
  它啟動真正的 `electron .`，再從**子行程的 argv** 讀出解析後的 userData。

> **`spekterm.com` 與 `spekterm.app` 已購入**（2026-07-12，Cloudflare，到期 2027-07-12）——
> **`appId` 的風險就此關閉。** `com.spekterm.app` 是反寫 `spekterm.com`，若該 domain 落入他人手中，
> 這個**已凍結**的 appId 就變成在宣告別人的命名空間，而且事後**無法以改 appId 化解**（改 appId 的
> 作業系統語意是「發佈一個不同的 app」）。
>
> **因此續約不是行政瑣事，是承重的。** domain 一旦過期被他人註冊，上面那個無解的問題就原封不動地
> 回來 —— 而那時 app 已經發佈，退路比現在更少。

### GitHub 位置：org 是 `spekhq`（**不凍結**，與上表無關）

本 repo 位於 **`spekhq/spekterm`**（原 `kewang/spekterm`，已 transfer，舊網址自動 redirect）。
org 名**不是**凍結身分的一部分 —— repo 改名與 transfer 皆自動 redirect，隨時可做。

- **`spekjs` 這個 GitHub org 開不出來。** 它被一個 0 repo、0 follower 的閒置 User 帳號佔著
  （username 與 org 共用同一個命名空間），而 GitHub **不因閒置釋出名字**，只受理商標爭議 ——
  申訴已放棄。`spekhq` 是 `rename-to-spekterm` design D5 早已寫下的備案。
- **npm scope 仍是 `@spekjs`，不要「順手對齊」成 `@spekhq`。** 那個 npm org 真的叫 `spekjs`、
  套件已發佈。**GitHub org 名與 npm scope 不一致是常態**（`@tailwindcss/*` 的源碼在
  `tailwindlabs/tailwindcss`），為了對齊而重新發佈一次 scope，成本遠大於收益。
- **開源的 `spek` 也已搬進 org**（`spekhq/spek`，由該 repo 自己的 `move-to-spekhq-org` 承載，
  已隨 **v1.7.0** 發佈）。兩件事 GitHub **不 redirect**，都是一次付清的代價：
  **GitHub Action 的 `uses:` 參照**（刻意的安全設計 —— 舊路徑直接 `repository not found`，
  故 `uses:` 已改為 `spekhq/spek@v1`）與 **GitHub Pages**（`kewang.github.io/spek` 的 badge 與
  Live Demo 永久失效，已改指 `spekhq.github.io/spek`）。
- **`kewang/spek` 這個名字此後不可再被佔用** —— repo redirect 是承重的：已發佈版本的 npm
  metadata 永遠指向舊位置且無法修正，`action.yml` 的歷史 tag 也靠它解析。重建同名 repo 會同時
  炸掉兩者。細節見 `spek` 自己的 CLAUDE.md。

## Workflow

- **所有變更都必須使用 OpenSpec 工作流程**：每個功能、修復或修改都要先建立 OpenSpec change，
  經過 proposal → design → tasks 流程後再實作。
- 使用 `/openspec-new-change` 或 `/opsx:new` 建立新的 change。
- 實作完成後使用 `/openspec-verify-change` 驗證，再用 `/openspec-archive-change` 封存。
- **Archive 時必須**：更新相關文件（CLAUDE.md、README 等若有影響），並建立 git commit。

### 路線圖與 change 的對應

開發路線圖見 `docs/PRD.md` §11。每個 Phase 對應一個（或數個）OpenSpec change，可單獨驗收。

- **Phase 0** — `workspace-foundation-spike`（已封存）：package 骨架 + 高風險相依的技術驗證。
  除 PRD 列的三項外，另納入 core 套件的跨 repo 分發（`@spekjs/core`）。
- **Phase 1** — `multi-folder-workspace-shell`（已封存）：folder 清單持久化、活動列 + rail +
  三欄版面、受邊界約束的 `listDir`。
- **Phase 2** — `file-explorer-readonly-view`（已封存）：side panel 的身分切換、檔案樹
  （lazy load + chokidar）、`readFile` / `watch`、面板內的唯讀檢視、導航防護。
- **Phase 3** — `file-editing-and-crud`（已封存）：編輯能力、完整 CRUD、dirty buffer、
  mtime 樂觀鎖、寫入路徑的邊界。
- **Phase 4** — `terminal-agent-sessions`（已封存）：node-pty 多 session 管理、IPC 雙向串流、
  xterm + fit、session 分頁 + rail 的 repo→session 子列、spawn 目標可選（claude／login shell）、
  生命週期不留孤兒行程。後續三個 change 亦已封存：`session-titles-and-controls`（pty 宣告的
  OSC 標題）、`terminal-clipboard`（複製貼上）、`session-rename-and-reorder`（命名權與拖曳排序）。
- **Phase 5** — `openspec-side-panel`（已封存）：主行程的 per-folder OpenSpec 資料
  供應層（快取 + watch）、`openspec.*` IPC、renderer 的 `IpcAdapter`、side panel 的兩個視圖
  （本 change 的 artifact 分頁 / 瀏覽的兩棵樹）、tasks 進度與 spec deltas、交叉導覽、
  session 的錨定 change、Graph 與 Timeline 的全視窗 overlay。
  跨 repo：`spek` 的 `extract-ui-package` 抽出並發佈 **`@spekjs/ui@1.0.0`**。
- **正名** — `rename-to-spekterm`（已封存，**不屬於任何 Phase**）：產品從一個描述性的佔位名
  （開源專案名 + 泛用詞，見該 change 的 proposal）正名為 **spekterm**，並定下會隨打包凍結的作業
  系統身分（見上文「產品身分」）。**它必須排在 Phase 6 之前** —— `appId` 一旦隨安裝檔發佈就改不了，
  正名的成本從打包起單調上升。
- **鍵盤導航與 session 標籤** — `session-navigation-and-labels`（已封存，**不屬於任何 Phase**）：
  新能力 `keyboard-navigation`（`Ctrl+Tab` 切 session、`Ctrl+↑↓` 切 repo、`Ctrl+T` 開 spawn 選單，
  選單可全鍵盤操作），以及 **login shell 不再採用 pty 宣告的 OSC 標題**（見上文兩節）。
  連帶：`ContextMenu` 加上鍵盤導覽、`files/dialogs.tsx` 補上 `role="dialog"`、新增 `probe:keyboard`，
  並把 `probe:terminal` 的 OSC 標題驗收換到**由探針控制的 stub `claude`** 上（不換就是假綠 —— 那些
  測試會繼續通過，但測的已經不是它們自稱在測的東西）。
- **renderer 安全硬化** — `renderer-security-hardening`（已封存，**不屬於任何 Phase**）：一次資安
  掃描後補上的三項縱深防禦 —— 主行程施加的 **CSP**（inline script 不執行、鎖死
  script／object／iframe／base-uri；**放行遠端 https 圖片**——markdown 的正常內容；dev／production
  切換依 `ELECTRON_RENDERER_URL` 而非 `app.isPackaged`）、`clipboard:writeText` 的**型別 guard**
  （非字串不再使主行程拋未捕捉例外）、xterm 的 **OSC 8 `linkHandler`**（OSC 8 超連結改走
  `openExternal`，不落入 xterm 內建的 confirm＋window.open）。詳見上文「renderer 安全硬化的實測與
  踩雷」——含 CSP 切換依據、CDP 繞過 script-src、OSC 8 probe 假綠三個踩雷。
- **rail 的可讀性與 repo 列重整** — `rail-legibility-and-repo-row`（已封存，**不屬於任何 Phase**）：
  第一次 dogfooding 的回饋。新能力 `typography-scale`（字級收斂為 token，**單一旋鈕 `--text-base`**，
  並加一道守衛擋住寫死字級）與 `repo-branch`（rail 顯示 git 分支，讀 `.git/HEAD` 不 spawn `git`，
  兩層 watcher 使「在 terminal 裡切 branch」即時反映）；rail 的 repo 列重整 —— 移除那顆 `onClick`
  裡只有 `stopPropagation()` 的 **`◈` 假按鈕**、名稱取回視覺主導（粗體＋亮色，選中轉 accent）、
  副標由「每列都喊一次的 `OpenSpec`」改為**分支**，「缺少 `openspec/`」降級為弱訊號。詳見上文
  「字級尺度」與「git 分支」兩節的實測踩雷。
- **session 的命名權** — `session-title-authority`（已封存，**不屬於任何 Phase**）：第二次 dogfooding
  的回饋。**移除「pty 想改名須經確認」的整條 requirement 與 `TitleConflictDialog`** —— 命名 ＝ **永久**
  接管，pty 其後宣告的標題靜默不予呈現（不覆蓋、不確認、不提示），交還的唯一路徑是**把名字清空**
  （清空即立即回到 pty 最近宣告的標題 —— 標題於接管期間**持續被記錄**，這是交還得以即時的前提）。
  連帶：`keyboard-navigation` 那條「對話框開啟時導航快捷鍵不生效」的**驗收載體**由「標題衝突對話框」
  換成 **Graph／Timeline overlay**，且那條紀律（「以角色存在判定、SHALL NOT 逐一列舉、驗收須以多種
  對話框各驗一次」）**寫進了 spec 本身**，不再只活在這份 CLAUDE.md 裡。詳見上文「session 的命名權」。
- **session 的持久化與重建** — `session-restore`（已封存，**不屬於任何 Phase**）：第三次 dogfooding
  的回饋（「關掉 app 再重開，session 全不見了」）。新能力 `session-persistence` —— session 清單、
  使用者取的名字、順序、錨定的 change 與終端畫面快照皆落盤（`sessions.json` + `sessions/<id>.scrollback`，
  版本 + 原子寫 + 損毀隔離）；重開時**原樣重建**且**預設休眠**（首次被顯示才 spawn，於是只起一個
  claude）；claude 以 `--session-id` 開、`--resume` 續接**同一個對話**，續不上時**自癒為全新對話**且
  身分不變；shell 於**最後已知的 cwd** 重生（主行程讀 `/proc/<pid>/cwd`，夾制於 folder 邊界內）並
  **重播上次的畫面**（歷史與 live 之間有明確分隔 —— 那是誠實性，不是裝飾）。連帶：`terminal-sessions`
  的「初始 cwd 恆為 folder 根目錄」放寬為「落在邊界內」（**renderer 依然沒有任何路徑詞彙**），
  `probe:shell` 補上 `terminal.*` 的白名單守衛（它一度與當年的 `folders.*` 一樣完全沒有守衛）。
  詳見上文「session 的持久化與重建」—— 那裡記著八個**會靜默失敗**的實測踩雷。
- **UI 文案與 i18n** — `ui-copy-i18n`（**不屬於任何 Phase**）：app 的文案從**中英混雜**正名為
  全英文，並第一次讓文案**有地方住**。新能力 `ui-localization` —— i18next + **單一 `en` 字典**
  （`src/shared/i18n/en.json`，主行程與 renderer **共用同一份**）、key 的**編譯期型別安全**
  （`CustomTypeOptions` + `resolveJsonModule`，**不需型別產生器**）、以及一道**守衛**（產品原始碼
  的字串字面值不得含 CJK；註解豁免，因此**必須走 AST**）。連帶：`openspec-panel`、
  `keyboard-navigation`、`file-explorer` 的 delta（那些 scenario 以中文文案指名控制項），以及
  **6 支 probe 的 97 處選擇器 + `Ctrl+T` 的 `querySelector` 全部改為自字典取字串** ——
  `aria-label` 在這個 repo 裡同時是**選擇器**，硬編它，一次文案改動就會讓探針**靜默地選不到元素**
  （而 `Ctrl+T` 連紅燈都不會有）。詳見上文「UI 文案與 i18n」。
- **排序（拖曳與快捷鍵）** — `workspace-reordering`（**不屬於任何 Phase**）：第四次 dogfooding 的
  回饋。**repo 的拖曳排序 + 順序落盤**（`workspace-folders` 的新 requirement，`folders.reorder`
  **以識別碼定位而非位置** —— 權威在主行程，飛行中的索引可能已指向另一個 folder）、**四顆排序快捷鍵**
  （`keyboard-navigation`：`Shift+↑↓` 排 repo、`Shift+←→` 排 session，**端點不循環**；外加一條導航
  快捷鍵**沒有**的例外 —— **可編輯文字讓路**，且判準**不能寫成「是不是 textarea」**：xterm 與 Monaco
  的輸入路徑**都是** textarea）、**可拖曳項目的游標**（靜止 `pointer`、拖曳中 `grabbing`）。
  連帶（獨立稽核抓到）：修掉一個**既有**的 off-by-one —— **拖曳往下放時，東西落在指示線的下一格**
  （`session-rename-and-reorder` 起就在，卻通過每一輪驗收 —— **分頁列只用兩個分頁測，而兩個項目時
  兩種語意結果相同**）。詳見上文「拖曳的落點」「游標」與「四顆鍵，四種代價」三節。
- **側欄來源解耦 rail focus** — `side-panel-repo-anchor`（**不屬於任何 Phase**）：第五次 dogfooding
  的主痛。`SessionState` / `PersistedSession` 新增 `panelFolderId?`（renderer 供應、主行程原樣保存，
  比照 `anchoredChange`）；`openspec-panel` / `file-explorer` / `session-persistence` 三個 delta：
  兩條「側欄跟隨 focused session」與「隨檔案變更更新」改以**側欄來源** repo 為準；Files「呈現當前
  folder」的當前 folder 定義為側欄來源；持久化事實清單納入側欄來源，重建時指向的 folder 若已被移除
  則退回自身 folder。新 capability `side-panel-source`：來源指示器（`ContextMenu` 下拉可選任一
  folder，鍵盤全操作）、來源非自身時的「回到自身 repo」一鍵捷徑、OpenSpec 與 Files 兩身分共用同一
  來源、切換來源時重置錨定。詳見下文「side-panel-repo-anchor 的實測與踩雷」。
- **殼層小毛病** — `shell-affordance-tweaks`（**不屬於任何 Phase**）：第五次 dogfooding 的三條殼層
  微調 —— **移除原生 menu bar**（`Menu.setApplicationMenu(null)`，`workspace-app-shell` 新增
  requirement；**不是** `autoHideMenuBar` 隱藏，那按 `Alt` 仍浮出）、**建立 session 的按鈕文字
  `+ session` → `+`**（純呈現，`aria-label` 保持不動 —— 它是 6 支 probe 與 `Ctrl+T` 的選擇器）、
  **`Ctrl+Shift+W` 關當前 session**（`keyboard-navigation` 新增 requirement，攔截於 window capture
  階段，對話框開啟時不生效；代價為零，見下文「四顆鍵，四種代價」補上的第五顆）。詳見下文
  「shell-affordance-tweaks 的實測與踩雷」。
- Phase 6 打包與發佈，Phase 7+ 建立護城河（handoff）。**session 常駐**已排入路線圖但刻意不做
  （PRD §11）。

> **Phase 5 對 PRD 的「抽出 `@spekjs/ui`」做了對半的裁決**（PRD §9.2 已回寫）：整頁視圖**不抽**
> （側欄是窄欄 UI，spek 是全寬頁面，不是同一個東西），但 **Graph 與 Timeline 抽了** —— 它們不是
> 頁面，是自足的視覺化元件。詳見下文「Phase 5 的實測與踩雷」。

> **Phase 1 欠下的 Monaco 債，已於 Phase 2 償還。** `multi-folder-workspace-shell` 曾把
> `workspace-app-shell` 的兩條 Monaco requirement 標為 `REMOVED`（診斷頁退場後沒有模組引用
> `editor/`）。`file-explorer-readonly-view` 以 side panel 的檔案檢視為載體重新確立它們，並
> 新增兩條：「不引入任何語言服務 worker」與「worker 於 dev 與 build 兩模式皆完成一次往返」。

> **Phase 3 已償還 Phase 1/2 欠下的寫入邊界債**（`file-editing-and-crud`）：讀取的「先
> `realpath` 檢查、再依原路徑開啟」**不被寫入沿用**（已實測會逸出邊界）；寫入改為解析與開啟
> 不可分割、帶 `O_NOFOLLOW`。中間目錄段的 TOCTOU 因 Node 無 `openat` 無法機制性防護，改以
> 「白名單不暴露 `symlink()`、寫入 leaf 一律 `realpath`」的威脅模型承擔 —— 詳見上文「檔案系統
> 邊界」段與 design D1–D8。**此結論有前提，暴露 `symlink()` 或改用 `lstat` 語意即失效。**

## Conventions

- 程式碼用英文撰寫
- 註解與文件使用繁體中文（台灣用語）
- **UI 文案為英文，且一律來自字典**（`src/shared/i18n/en.json`）—— 見下文「UI 文案與 i18n」。
  註解仍是繁中：那兩件事是分開的，而它們曾經混在一起（於是每個 change 的作者一邊用中文寫註解，
  一邊很自然地把中文寫進 `aria-label`）。
- 本 repo 的 Node 版本固定在 `.nvmrc`（22.22.0），與 `../spek` 一致

## Phase 0 推翻的 PRD 假設

以下三點 PRD 原本寫錯，已於 `workspace-foundation-spike` 實測並回寫。留在此處，
是因為它們是容易憑直覺再犯的錯：

- **「node-pty 需要 `electron-rebuild` 對齊 Electron ABI」—— 錯。** 那是它還用 NAN 的時代的
  舊事實。實測 `pty.node` 有 40 個 `napi_*` symbol、0 個 `v8::` symbol；Node 22 的 ABI 是 127、
  Electron 43 是 148，但兩者 N-API 同為 10，同一顆 `.node` 兩邊都載入得了。
- **「Monaco 的 Vite worker 設定是風險」—— 已證偽。** dev（`http://`）與 build（`file://`）
  兩模式的 worker 皆正常。`file://` 下的動態 import 與 module worker 建立也都沒問題，
  不需要改用自訂協定。
- **「主行程可直接 import `@spek/core`」—— 論點對，名字錯。** 主行程確實能直接 import core、
  在行程內完成掃描（已實測，全程不開任何 TCP 埠）。但 `@spek/core` 從未發佈、`@spek` scope
  也不屬於本專案 —— PRD 假設了一個不存在的取得管道。改名並發佈為 `@spekjs/core` 後才成立。

驗證編輯器 worker 是否存活時，**不能靠「看到語法高亮」** —— tokenization 在主執行緒完成。
必須讓 worker 真的做一次往返。Phase 2 起不再有語言服務 worker，改以 Monaco 內建的 link
provider 驗證：它為 `language: '*'` 註冊，呼叫 worker 端的 `$computeLinks`，命中的 URL 會被
畫上 `.detected-link`。**開一個含 URL 的檔案，看到 `.detected-link` 就是往返的證據** ——
零 bundle 成本、零測試鉤子。

## Phase 2 推翻的假設

- **「`import 'monaco-editor/esm/vs/editor/editor.all.js'` 是必要的」—— 錯。** 只要引用任何一種
  `basic-languages/*` 的 contribution，`_.contribution.js` 就已經把整套 editor contribution 拉了
  進來。實測：加與不加，建置產物只差 **15 bytes**。
- **「chokidar 監看 folder 內的目錄不會越界」—— 錯。** 它的 `followSymlinks` **預設為 `true`**，
  folder 內一個指向 `/etc` 的 symlink 被展開時，watcher 會跟著走出去，把邊界外的檔名經事件
  推給 renderer。`listDir` 守住的邊界，會從 watcher 這道側門漏掉。必須 `followSymlinks: false`，
  且事件路徑在推送前再過一次 `isWithin`。
- **「渲染 markdown 只是個顯示功能」—— 錯，它是攻擊面。** preload 綁在 `webContents` 上，
  **每次導航後都會重新注入，不分來源**。使用者 repo 裡一個 `[click](https://evil.com)` 就能把
  renderer 帶去遠端頁面，而那個頁面的 `window.workspace.fs` 就是我們的檔案系統白名單。
  `will-navigate` / `setWindowOpenHandler` 的防護是渲染 markdown 的**前提**，不是加分項。
- **「`did-start-navigation` 可以當作 renderer 重新載入的訊號」—— 錯。** 它與 `will-navigate`
  對同一次導航都會觸發，`preventDefault()` 只是隨後取消它。於是每擋下一次導航，就會順手把
  該 renderer 的所有 watcher 關掉，檔案樹與檢視器從此靜默地不再更新（已實測）。要用
  `did-navigate`（已 commit）。**「導航開始」不等於「導航發生」。**
- **「主行程拋出的錯誤可以帶著 `code` 傳到 renderer」—— 錯。** Electron 的 IPC 序列化**只保留
  `message`**，自訂屬性一律遺失。需要結構化的失敗資訊（錯誤碼、檔案大小與上限）時，要在 IPC
  接縫上改回傳 `{ ok: false, code, detail }` 結果物件。純邏輯層仍然拋錯。
- **「一個樹上的路徑對應一個被監看的目錄」—— 錯。** folder 內指向 `sub/` 的 symlink，在樹上是
  兩個節點、在磁碟上是同一個目錄，而 chokidar 只認絕對路徑。訂閱（樹上的 relPath）與監看
  （磁碟上的 realpath）必須分層並以參考計數對接，事件也必須**以訂閱者使用的路徑改寫**後才推送
  —— 否則收合其中一個節點會停掉另一個的監看，而經 symlink 展開的節點永遠收不到事件。
  **驗收 fixture 裡沒有 symlink，這個 bug 就會躲過整輪全綠的驗收。**
- **「先列目錄、再開始監看」—— 錯。** 兩者之間的窗口裡發生的變更會兩頭落空：列目錄沒看到它，
  事件也還沒開始送。**必須先訂閱、再列目錄** —— 訂閱前的狀態由列目錄補齊，之後的由事件送達。
  這個 app 的前提就是旁邊有 agent 一直在寫檔，那個窗口一點都不理論。

驗證「app 沒有開 TCP 埠」時，**不能只讀主行程的 `/proc/<pid>/net/tcp`** —— Chromium 的 zygote
與 renderer 跑在各自的 network namespace，主行程那張表看不到它們。`probe:core` 因此用兩道互補
判準：逐 pid 取「該 pid 的 socket inode ∩ 該 pid 所屬 netns 的 LISTEN 表」，外加「app 存活期間
本 netns 是否新增 LISTEN socket」—— 後者不需要讀任何 pid 的 fd，可繞過 sandbox 造成的權限死角。

## Phase 4 的實測與踩雷（terminal）

- **`did-navigate` 不只要清 watcher，也必須殺光 pty。** reload 不銷毀 `webContents`，只掛
  `'destroyed'` 的清理不會觸發 —— 舊 pty 會變成孤兒行程，且新頁面的 xterm **永遠收不到它們
  的輸出**（listener 綁在已消失的舊 renderer 上）。`probe:terminal` 真的 reload、再回查行程表。
- **`node-pty` 的 spawn 對 execvp 失敗「不會」同步拋錯 —— 原假設是錯的。** 實測
  `spawn('/nonexistent', ['-l'])` → 不 throw、pty 以 exit code 1 結束、`execvp(3) failed.` 由
  `onData` 送出。於是「shell 路徑無效」與「claude 找不到」殊途同歸，都經 `onExit`（非零）+
  終端上的錯誤訊息呈現，而**不是** `create` 回一個錯誤碼。`create` 的 try/catch 只防罕見的
  「底層 pty 配置不出來」。
- **GUI app 常缺使用者 shell 的 PATH**（從桌面啟動不會繼承 `.zprofile` / `.bashrc`），直接
  `spawn('claude')` 會 ENOENT。兩種 spawn 目標因此都經 login shell：shell 模式 `$SHELL -l`、
  claude 模式 `$SHELL -l -c claude`。**這道緩解的真正驗證點在 Phase 6 打包後從桌面啟動** ——
  `npm run dev` 是從終端起的，env 本來就是完整的，測不出這個問題。
- **terminal 的 cwd 邊界不是沙箱。** `create` **只收 `folderId`、不收任何路徑**（renderer 在
  語彙上無從指定 workspace 外的 cwd），但這只約束**初始** cwd —— pty 起來之後使用者可以 `cd`
  到任何地方、執行任何命令，那正是終端的用途。**不要把它與 `fs.*` 白名單的沙箱語意混為一談**
  （日後評估 handoff auto-spawn 的信任邊界時，這個區別很要命）。
- **輸出的訂閱必須早於 `create`。** pty 在 `create` 回傳的那一刻就開始吐第一個 prompt，而
  `TerminalView` 要等 React 渲染完才 attach —— 中間沒有接收者的輸出會**直接消失**。
  `SessionsProvider` 因此在任何一次 create 之前就掛好唯一的 `onData`，尚未 attach 的 session
  其輸出先進 backlog，終端掛上時先 flush 再接 live。與 Phase 2 的「**先訂閱、再列目錄**」同源。
- **終端必須跨「切換 folder」常駐。** 若只掛載當前 folder 的 session，切走再切回時 xterm 實例
  已被卸載，先前的 scrollback 就沒了（backlog 補得回未顯示期間的新輸出，補不回已卸載的歷史）。
  因此掛載 `sessions.all()`、以 `display:none` 決定顯示 —— 代價是隱藏時 `FitAddon` 量到 0，
  由隱藏轉為顯示時必須重新 `fit()` 一次。

- **session 的身分由 pty 自己宣告，不是我們給的流水號**（`session-titles-and-controls`）。
  pty 內的程式以 OSC 序列（`ESC ] 0 ; <title> BEL`）設定終端標題 —— `claude` 正是這樣讓終端
  模擬器的分頁自動改名的。xterm 的 `onTitleChange` 直接把這個事件交給我們：**不必輪詢
  node-pty 的 `pty.process`（那是近似值），也不需要任何主行程改動或 IPC**。分頁列與 rail
  子列共用同一個標籤；pty 沒宣告時才退回 `claude 1` 這種本地標籤。截斷只是呈現，完整標題
  留在 tooltip。

- **終端的複製貼上不能靠瀏覽器原生的路徑**（`terminal-clipboard`）。xterm 的選取**不是 DOM
  selection**（它自己畫），因此原生的「Ctrl+C 複製選取文字」對它完全無效。複製走
  `term.getSelection()` + 主行程的 clipboard；貼上走 `clipboard.readText()` + `term.paste()`。
  **不用 `navigator.clipboard`** —— 它的 `readText()` 在 Electron 中受 `clipboard-read` 權限
  模型擺布，跨平台不一致。
  - **`Ctrl+C` 必須維持 SIGINT，不可挪用為複製**：agent 跑失控時要中斷它的能力，不能因為畫面
    上剛好有一段選取就失靈。複製用 `Ctrl+Shift+C`（macOS 的 `Cmd+C` 不衝突，故該平台用 Cmd）。
  - **選單操作完要把焦點還給終端**。實測（探針抓到）：自右鍵選單貼上之後按 Enter **不會執行**
    —— 焦點還在選單那邊，使用者得再點一次終端。`copy`／`paste` 之後都要 `focus()`。
  - **`clipboard.readText()` 沒有 workspace 邊界可言**（剪貼簿裡可能是剛複製的密碼）。它可接受
    的前提有二：導航防護確保 renderer 不會變成別人的頁面（少了它，一個 markdown 連結就能把這個
    能力交給遠端頁面）；且只在使用者明確要求貼上時讀取，不主動、不輪詢。

- **session 的命名權可以被使用者接管**（`session-rename-and-reorder`；語意於
  `session-title-authority` 修正）。標籤三層優先序：**使用者取的名字 > pty 宣告的 OSC 標題
  （僅 `claude` 目標）> 本地流水號**。使用者一旦命名，就是**永久**接管 —— pty 其後宣告的標題
  一律**靜默地不予呈現**（不覆蓋、不確認、不提示）。交還命名權的唯一路徑：**把名字清空**。

  > **這裡原本有一個「pty 想改名，要採用嗎？」的確認對話框，已移除 —— 它的前提是錯的。**
  > 它假定「使用者命名後，pty 想改名是**罕見**事件，值得問一次」，但 `claude` 隨任務進展
  > **持續**改標題。而「保留我的名字」只清掉待裁決欄位、**不記錄使用者已經拒絕過** —— 於是下
  > 一次判定條件與第一次完全相同，對話框再跳一次；**連 pty 送同一個標題都會再問**（「與待裁決
  > 的相同就不問」那條短路，在按下「保留我的」的瞬間就失效了）。第二次 dogfooding 的原話：
  > 「改成 b 之後，claude 一直跳訊息要改回 a」。
  >
  > 諷刺的是，當初的 spec **已經察覺** agent 會頻繁改名（才有「待確認的標題是單一欄位而非佇列，
  > 否則堆疊 N 個對話框會把畫面淹掉」），但緩解只做到「不同時堆疊」，沒處理「**沿著時間軸反覆問
  > 同一個問題**」。**教訓：一個高頻事件上的確認，緩解「不要一次問太多次」是不夠的 —— 要問的是
  > 「這個問題值得問嗎」。** 而它的答案是可預測的（使用者才剛親手命名，當然是保留自己的）——
  > **「使用者取的名字 > pty 的標題」這條優先序本身就已經是那個裁決。**

- **pty 的標題在使用者接管期間仍持續被記錄，只是不呈現**（`session-title-authority` 的 D3）。
  這是「清空名字＝交還命名權」得以即時的前提：清空的那一刻，標籤立即回到 pty **最近一次**宣告的
  標題。若接管期間直接丟棄，清空後會退回 `claude 1`，空等到 pty 下次宣告為止（session 閒置的話
  可能永遠不會來）—— 使用者會以為「名字不見了」。
- **拖曳排序用滑鼠事件實作，不用 HTML5 drag-and-drop** —— 後者在 CDP 下要走
  `Input.setInterceptDrags` + `dispatchDragEvent`，與探針既有的 `dragMouse`（真滑鼠序列）
  格格不入。自己做，驗收就能送真拖曳。

- **login shell 的 session 不採用 pty 宣告的 OSC 標題**（`session-navigation-and-labels`）。
  上面那條三層優先序，第二層**只對 `claude` 目標成立**。shell 送的是它預設的 prompt 標題
  （`使用者@主機:/路徑`），對使用者零識別意義；而且它**比 session 晚一秒多才到**（shell 要先
  載完 rc、畫出第一個 prompt），抵達時分頁從約 60px 暴增到約 210px，把緊鄰其後的「+ session」
  入口**往右推 150px** —— 使用者正要點下去時，按鈕從游標底下跳走（`probe:openspec` 就是這樣
  點空的，症狀看起來卻像「產品的選單壞了」）。**分頁不限寬** —— 根因是標籤內容突變，不是缺少
  寬度上限。
  - **擋在 `sessions.tsx` 的 `setTitle()`，不是顯示層。** 那是 OSC 標題進入狀態的唯一入口：
    擋在那裡，`title` 恆為 `undefined`（標籤自然退回本地標籤），`pendingTitle` 也永遠不會被設
    —— **確認對話框一起失去觸發條件**。只改顯示層的話，標籤是對了，但使用者仍會被一個「pty 想
    把它改名為 `kewang@host:/tmp/…`，要採用嗎？」的對話框打斷，而那個名字他根本永遠看不到。

## 快捷鍵（`session-navigation-and-labels` 起）

| | |
|---|---|
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 當前 repo 內的下／上一個 session（**分頁位置序**，可循環） |
| `Ctrl+↓` / `Ctrl+↑` | rail 上的下／上一個 repo（可循環） |
| `Ctrl+T` | 開啟建立 session 的入口（spawn 選單，可全鍵盤操作） |
| `Ctrl+Shift+W` | 關閉當前 focused 的 session（沒有選中的 repo 或該 repo 無 session 時無操作） |
| `Shift+↓` / `Shift+↑` | 把**選中的 repo** 在 rail 上往下／往上移動一格（**不循環**） |
| `Shift+→` / `Shift+←` | 把 **focused session** 在分頁列上往右／往左移動一格（**不循環**） |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | 終端的複製貼上（macOS 用 `Cmd`） |
| `Cmd/Ctrl+S` | 存檔 |
| `Esc` | 關閉 overlay／對話框／選單 |

**`docs/workspace-mockup.html` 對快捷鍵沉默** —— 這組綁定由該 change 定義，不是偏離雛型。

**選單必須能全鍵盤操作，這不是加分項而是前提。** `Ctrl+T` 跳出的是選單（spawn 目標要選），而原本的
`ContextMenu` 只處理 `Esc` —— **用快捷鍵叫出一個只能用滑鼠點的選單，等於沒做這個快捷鍵**。因此它加上了
「開啟時焦點落在第一項 / `↑↓` 循環 / `Enter` 觸發」，並且**必須有 `focus:` 的視覺樣式**（少了它，使用者
不知道 Enter 會按到什麼）。`ContextMenu` 是共用元件（分頁右鍵、檔案樹右鍵、spawn 選單都是它）——
動它要跑 `probe:terminal` 與 `probe:files` 回歸。

**`Ctrl+T` 的觸發走「啟動既有的建立入口」**（找到 `[aria-label="新增 session"]` 並觸發它），不自己算座標
—— 於是鍵盤叫出的選單與滑鼠點出來的**錨定在同一個地方**（`useSpawnMenu` 是從 `event.currentTarget` 的
rect 算位置的），spawn 選單的狀態也不必從 `SessionTabs` 搬出來，**鍵盤的接縫仍然只有一處**。

### 攔截點是 window 的 **capture 階段** —— 「`Ctrl+S` 必須寫進 Monaco」的教訓被誤讀了

終端幾乎永遠持有焦點，xterm 會把按鍵直接寫進 pty，Monaco 也會吃鍵。但這**不代表 window
listener 沒用** —— 既有的 `Ctrl+S` 之所以被迫註冊在 Monaco 內部（`editor/index.tsx`），是因為
它註冊在 **bubble 階段**：Monaco 攔下該鍵並停止傳播，它永遠冒不到 window。**capture 由 window
往下傳，早於 xterm 與 Monaco 綁在各自 DOM 節點上的 listener** —— `stopPropagation()` 一下，
兩者都收不到，被攔下的按鍵也就不會流進 agent。**階段選對就沒有這個問題**（design D1）。

「對話框開著時抑制快捷鍵」以 **`[role="dialog"]` 的存在**判定 —— 任何遵守這個無障礙慣例的新
對話框都自動被尊重，不必記得去某份清單註冊。代價是**漏掉 `role` 的對話框會靜默失效**，因此對
**三種**對話框各驗一次抑制：**session 命名**與 **files 的**（`probe:keyboard`），以及 **Graph／
Timeline 的全視窗 overlay**（`probe:openspec`）—— 只驗一種就宣稱涵蓋，等於沒驗。

> **第三種原本是「pty 標題衝突」的確認對話框，它已隨 `session-title-authority` 移除。** 那條抑制
> 驗收於是要換一個載體 —— 而 `VizOverlay` 本來就是 `role="dialog"`，卻**從未被驗過抑制**（overlay
> 蓋滿視窗時按 `Ctrl+↓` 切 repo，切了也看不見，關掉 overlay 才發現自己站在別的 repo 上）。
> **把一筆隱藏的技術債換成了資產** —— 而不是把「三種」默默改成「兩種」。這條紀律現在也寫進了
> `keyboard-navigation` 的 spec 本身，不再只活在這份 CLAUDE.md 裡。

### 四顆鍵，四種代價 —— 不要混為一談

- **`Ctrl+Tab` 是白撿的。** 它在標準終端編碼下**送不出去**（`Tab` 就是 `Ctrl+I`＝`0x09`）——
  沒有任何 shell 或 agent 綁得了它。拿走它，pty 內**零損失**。這正是 GNOME Terminal、iTerm2
  敢拿它切分頁的原因。
- **`Ctrl+↑/↓` 送得出去**（`CSI 1;5A` / `CSI 1;5B`）—— 攔截它等於從 pty 裡的程式手上**永久
  沒收**這顆鍵，而且沒有逃生口（本 change 不做鍵位設定）。實測：zsh 與 bash 預設皆未綁定；
  **唯一的犧牲者是 tmux**（`prefix + C-Up/C-Down` 的 pane resize、copy-mode 的捲動）—— 而這個
  app 本身就是要取代那個用途。
- **`Ctrl+T` 的代價最貴，採用它有兩個前提。** 實測 **zsh 與 bash readline 都把它綁成
  `transpose-chars`**。它之所以仍然可以拿：(1) 使用者的 GNOME Terminal **本來就把 `Ctrl+T` 拿去
  開新分頁了**（`new-tab = <Primary>t`），所以那個 `transpose-chars` 他早就沒有；(2) **`claude`
  沒有使用 `Ctrl+T`**（使用者確認）—— 後者是關鍵，claude session 是這個 app 的主場。
  > **此結論有前提。** 日後若 `claude`（或其他常駐 pty 的 agent）開始使用 `Ctrl+T`，本裁決即失效。
  > 退路是 **`Ctrl+Shift+T`**，成本為零（`Ctrl+Shift+字母` 在終端協定裡編碼不出來 —— 這正是複製
  > 貼上用 `Ctrl+Shift+C/V` 的理由）。
- **`Shift+arrow`（排序，`workspace-reordering` 起）的代價與上面三顆不同種 —— 它是「明知主場在用，
  仍然拿走」。** 它送得出去（`CSI 1;2A`–`D`），實測 zsh 與 bash 皆未綁定；但**已知的犧牲者正是
  `claude` 自己的 agents view**（使用者指出它用 `Shift+↑↓`）。**`Ctrl+T` 能拿的關鍵前提是「claude
  沒在用它」，這一顆正好相反** —— 使用者在知情下裁決採用（在 rail 上排 repo 的頻率遠高於在 agents
  view 裡按 `Shift+↑↓`）。
  > **此裁決有前提。** claude 的 `Shift+↑↓` 若變成常用路徑，本裁決即失效。退路是 **`Ctrl+Shift+arrow`**
  > （`CSI 1;6A`–`D`，實測 shell 亦未綁定，且與 `Ctrl+↑↓`／`Ctrl+Tab` 成對：Ctrl ＝ 移動游標，加
  > Shift ＝ 移動東西）。**改鍵位只動 `KeyboardNavigation.tsx` 的一個判斷 + spec + probe** —— 沒有
  > 任何資料格式綁在鍵位上。
- **`Ctrl+Alt+↑/↓` 不能用** —— Linux 上被 GNOME 拿去切工作區，按鍵到不了我們。（被 WM 拿走的是
  `Ctrl+**Alt**+方向鍵`，不是 `Ctrl+方向鍵`。）
- **`Ctrl+C` 絕不挪用** —— 它必須維持中斷訊號。
- **`Ctrl+Shift+W`（關 session，`shell-affordance-tweaks` 起）是唯一「代價確定為零」的一顆。**
  `Ctrl+Shift+<字母>` 在終端協定裡編碼不出來，pty 內沒有任何程式收得到它 —— 這正是複製貼上用
  `Ctrl+Shift+C/V` 的理由。它就是 GNOME Terminal 關分頁的鍵，與使用者的肌肉記憶一致。**選 Shift 版
  而非 `Ctrl+W`**：後者在 zsh 是 `backward-kill-word`、bash 是 `unix-word-rubout`（終端裡的高頻
  刪字鍵，實測），且它沒有 `Ctrl+T` 的「GNOME Terminal 早已把它拿去開新分頁」豁免。開／關的不對稱
  （`Ctrl+T` 開、`Ctrl+Shift+W` 關）反映的正是真實的代價差 —— `Ctrl+T` 是白撿的，`Ctrl+W` 不是。

### 排序快捷鍵有一條導航快捷鍵**沒有**的例外：可編輯文字讓路

**`Shift+arrow` 就是文字選取鍵。** 全域 capture 攔下它，side panel 的 Monaco 連「選一個字元」都做不到。
因此排序快捷鍵在**可編輯文字持有焦點**時完全不攔（不 `preventDefault`、不 `stopPropagation`）——
而導航快捷鍵**不受此限**（spec 明文要求 `Ctrl+Tab` 在編輯器裡仍生效）。兩條規格必須各自寫明它作用於
哪一組鍵，否則它們自相矛盾。

- **判準不能寫成「activeElement 是不是 textarea」。** xterm 的輸入路徑是一個隱形的 `<textarea>`，而
  Monaco 的輸入路徑**也是**（我們刻意關掉了它的 native EditContext）—— 那樣寫，排序快捷鍵會在終端
  持有焦點時（也就是這個 app 絕大多數的時間）**靜默失效**。判準是兩段式的：**先問「在不在 `.xterm`
  之內」**（在 → 不算可編輯文字），再問「是不是 input／textarea／contenteditable」。
- **兩個相反的失效方向都要驗**（`probe:keyboard`）：終端持有焦點時 `Shift+↓` 仍移動 repo 且按鍵不進
  pty；編輯器持有焦點時 `Shift+→` 仍選取文字且不排序。**對照組已證明後者有鑑別力**（拿掉讓路判準，
  那兩條如期變紅）。
- **Monaco 的選取不是 DOM selection**（與 xterm 同源的坑）—— `window.getSelection()` 讀不到，要看
  view overlay 的 `.selected-text` 元素。
- **但原生 `<input>` 的選取，CDP 驅動不了**（實測）：`rawKeyDown` 跳過預設動作，而 `keyDown` 的編輯
  命令在 Linux 上來自平台的 key-binding 層，合成事件繞過它 —— 兩種送法的選取長度都恆為 0，**與 app
  有沒有攔截這顆鍵無關**。那條斷言已移除（留著就是一盞測不到自己宣稱在測的東西的燈），「讓位＝完全
  不攔」由 Monaco 那條承擔。比照 OSC 8 `linkHandler` 的處理。

### 游標：`<button>` 不繼承父層的 `cursor`（Tailwind v4）

可拖曳且可點擊的項目（rail 的 repo 列與 session 子列、session 分頁），**靜止時的游標是 `pointer`
（食指），只有拖曳進行中才是 `grabbing`** —— `grab`（張開的手）宣告的是「這東西只能被拖」，但它們
**點一下是有作用的**（選中 repo／切換 focused session），而那是使用者最常做的事。游標該宣告主要的
可供性（VS Code 與瀏覽器的分頁亦然）。

**兩個會靜默失敗的地方：**

- **`cursor` 雖是可繼承屬性，但元素自己的宣告會贏過繼承來的值；而 `<button>` 帶著一條 UA 的
  `cursor: default`，Tailwind v4 的 preflight 不再像 v3 那樣把它改回 `pointer`** —— 於是外層
  wrapper 上的 `cursor-pointer` **到不了裡面的按鈕**（分頁的 `role="tab"` 正是一顆 button）。實測：
  探針量到 `default`。**靜止的游標要掛在使用者真正滑過的那個元素上。**
- **拖曳中的 `grabbing` 不能靠 `body.style.cursor`，也不該由每個呼叫端各自加一個三元式。** 同一條
  「元素自己的宣告會贏」的規則，讓 body 上的 grabbing 被沿路每一個元素蓋掉（可拖曳的列是 pointer、
  按鈕是 UA 的 default）—— 而 repo 的拖曳判定**刻意涵蓋整個區塊**（含 session 子列與 ▾／＋／✕），
  游標一定會掃過它們，於是一路閃爍。**呼叫端逐一補三元式是修不完的**（獨立稽核抓到的）。作法是
  `useDragReorder` 在 `body` 掛上 `data-dragging`，由 `index.css` 的一條 `!important` 規則覆蓋
  **整棵子樹**。

### 拖曳的落點：插入點與提交序位差一格 —— 而**兩個項目時看不出來**

`useDragReorder` 的命中判定回傳**插入點**（「插在第 i 個之前」，指示線畫的也是它），但提交端是
「**先移除、再插入**」（`splice(from,1)` → `splice(to,0,moved)`）—— 移除會讓被拖曳項目**之後**的元素
前移一格。於是**往下／往右拖時，落點比指示線多一格**（把 repo 拖到第二個 repo 的下半部，它會**飛到
清單最後**）。換算集中在 `commitIndex()` 一處，state 裡存的**永遠是插入點**。

- **這個 bug 在 session 的拖曳上是既有的**（`session-rename-and-reorder` 起），卻通過了每一輪驗收 ——
  **分頁列的拖曳只用兩個分頁測，而兩個項目時兩種語意的結果完全相同**；rail 子列則只測了往上拖（不受
  影響）。**驗收拖曳排序必須用至少三個項目，且往下／往右拖。** 這條紀律已寫進 `workspace-layout` 的
  spec 本身。
- **末端要拖得到**：命中判定在「游標落在所有中線之後」時必須回 `count`（不是 `count - 1`，那會讓使用者
  永遠拖不到最後一格），並在最後一個項目**之後**畫指示線（`dropAtEnd`）。
- **無操作時不畫指示線** —— 一條說「放開會移動」的線，放開卻什麼都不動，是在騙人。

> **探針曾經是繞過它、不是抓到它。** 我寫 `probe:workspace` 時撞見了「repo 飛到最後」，處置卻是把
> 準心移到區塊頂端 3px 去遷就它（註解裡還留著「實測踩過」）—— 驗收於是永遠是綠的，而使用者的拖曳是
> 錯的。**探針撞到怪現象時，先問「這是不是產品的 bug」，不要先調整探針去閃避它。**

> **探針送 `Enter` 必須用 `keyDown` + `text`，不能用 `rawKeyDown`。** `<button>` 是靠 Enter 的
> **預設動作**被觸發的，而 `rawKeyDown` 刻意跳過預設動作 —— 用它送 Enter，按鈕完全沒反應（實測：
> 選單裡按 Enter 建不出 session）。其餘帶修飾鍵的按鍵則相反，要用 `rawKeyDown`，否則 `keyDown`
> 附帶的 `text` 會在終端上多打一個字。

### 探針證明不了「真實鍵盤」—— 這道缺口只能由人補

CDP 的 `Input.dispatchKeyEvent` 是把事件**注入 Chromium 的輸入管線**，它**繞過**作業系統與瀏覽器
的 accelerator 層。因此 `probe:keyboard` 能證明 handler 正確、被攔下的按鍵沒流進 pty，**但不能
證明一顆真的 `Ctrl+Tab` 抵達得了 renderer**（若 Chromium 把它保留給分頁切換，探針照樣全綠）。

> **X11 的 XTEST 合成注入在本機被環境擋掉了** —— 自我檢驗：開一個自己的 X 視窗、確認焦點落在
> 它身上、`fake_input` 送一顆 `a`，**收到 0 個 KeyPress**。所以「用 xdotool 代替真人」這條路
> 在這台機器上不通。

### React 的 state updater 必須是純函式 —— StrictMode 會抓到你

**副作用絕不可寫在 `setState` 的 updater 裡。** StrictMode（**只在 dev 生效**）會刻意
double-invoke updater 來揪出不純的實作 —— 把 `onCommit` 寫在 `setDrag(current => {...})`
裡面，排序就會被套用**兩次**（交換兩次＝回到原位，看起來像「拖曳完全沒反應」）。

實測：**dev 模式拖曳失效、build 模式正常**。一邊過一邊不過，第一直覺會以為是時序 flaky，
其實是 React 在告訴你「你的 updater 不純」。副作用要移到 event handler 裡（以 ref 保存要提交
的值），updater 只回傳新 state。

### 驗 terminal 的兩個假綠陷阱

- **Enter 必須是一次真的 keyEvent。** 把 `\r` 併進 `Input.insertText` 的文字裡送出，字元確實
  抵達 pty（**終端上看得到回顯**），但 shell **從未執行那一行** —— xterm 的換行是在 keydown 上
  判讀的，不是從 textarea 的內容剖析出來的。只斷言「終端出現了我打的字」會誤判成功。
- **斷言要能區分「回顯」與「執行」。** tty 會回顯輸入行，因此 `echo COLS=$(stty size ...)` 這
  種命令，畫面上在**執行之前**就已經有 `COLS=` 了 —— 等它出現會讀到還沒產生的值（實測 build
  模式因此讀到 0，dev 模式僥倖通過，是典型的 flaky）。要用「回顯不含答案」的形式：
  `echo OUT_$((6*7))` 只有真的執行才會出現 `OUT_42`；驗 cwd 用 `echo CWD=$(pwd)`（`$(pwd)`
  在回顯裡不會展開）。

## Phase 5 的實測與踩雷（OpenSpec 側欄）

### PRD §9.2 的「原封不動重用 spek 頁面」—— 對頁面是錯的，對視覺化元件是對的

PRD 曾主張「新增一個 `IpcAdapter`，既有 spek 頁面（Dashboard / SpecDetail / ChangeDetail /
GraphView）幾乎可原封不動跑起來」。Phase 5 對它做了**對半的裁決**：

- **對「頁面」是錯的。** mockup 的側欄是為 320–620px 窄欄設計的緊湊 UI；spek 的頁面是為全寬瀏覽器
  設計的（自帶 `Layout` + `Sidebar`）。**不是同一個東西。** 側欄因此自刻 —— 而且它在 spek 根本
  沒有對應物（**spek web 的 sidebar 只是五個扁平的 nav link**，內容全在主頁面裡；真正的兩棵樹在
  **VSCode extension** 的 tree provider，那才是為窄側欄設計的，才是該抄的對象）。
- **對「視覺化元件」是對的。** `GraphView`（d3 力導向圖）與 `timeline/*`（Gantt）**不是頁面** ——
  它們吃資料、吐 SVG，對宿主零認知。**這兩個抽了**（`@spekjs/ui@1.0.0`，已發佈 npm，與 spek web
  共用同一份程式碼）。

**我一度自刻了一個二分圖取代 force graph，被使用者判定為「四不像」。** 教訓不是「早該抽套件」，
而是：**幾百行的 d3 模擬與時間軸刻度規則，重刻一次只會得到一個更差的版本，而且從此兩邊分叉。**
判斷「該不該重用」要問的是「**它綁死了版面嗎**」，不是「它在 spek 長什麼樣」。

**`@spekjs/ui` 不含 `ApiAdapter`。** 我們的 `IpcAdapter` 每個 method 第一個參數都是 `folderId`
（同時開著多個 repo），**簽名與 spek 的 `ApiAdapter` 不相容、實作不了它** —— 搬進套件對我們零價值。
但 **`openspec.*` IPC 照 `ApiAdapter` 形狀設計這個決定仍然回本了**：接上套件時換的是 UI，不是接縫。

### 跨宿主的元件有三條鐵律（`@spekjs/ui` 的 design）

1. **純呈現層** —— 沒有 router（導航是回呼）、沒有 adapter（資料由 props 進）、沒有 theme context。
2. **顏色是明確的契約**，套件**擁有自己的變數名**（`--spek-*`）。**它絕不可讀宿主的 token** ——
   spek web 叫 `--color-text-primary`，我們叫 `--color-ink`，名字對不上，圖會**畫得出來但完全沒有
   顏色**。換膚＝在 `index.css` 覆寫那 8 個變數（`probe:openspec` 有一條專門驗這件事：套件的
   `--spek-accent` 必須解析到我們的 `--color-accent`）。
3. **React 必須是 peer 依賴** —— 兩份 React 實例會讓 hooks 直接爆炸。

**d3 把顏色寫進 SVG 屬性**（命令式），不能用 `var()` —— 所以宿主換膚時圖必須重畫。套件**不去偵測**
主題（監看 `data-theme` 是在猜宿主的實作），而是由宿主換一個 `themeKey` 明說「該重畫了」。
我們只有深色主題，不傳。

### Graph ≠ Timeline

**它們是兩個不同的功能，別再搞混。** Graph 是 spec ↔ change 的**關聯結構**（無時間概念）；
Timeline 是 change 的**生命週期**（Gantt，有日期軸）。我一度以為使用者說的 graph 就是 gantt，
做出來的東西哪個都不是。

**兩者都不屬於 side panel** —— Timeline 的最小可用寬度是 **920px**（label 欄 200 + 圖表區 720，
皆為套件的預設常數），而側欄上限 620px。它們是「搞懂全局」的動作，不是「一邊駕駛 agent 一邊盯著」
的動作，**沒有與 terminal 並存的需求** → 全視窗 overlay。

### `@spekjs/core` 的四個簽名／語意陷阱（全部實測）

- **`readSpec` / `readChange` 找不到目標時回 `null`，不拋錯**；而 **`readSpecAtChange` /
  `buildGraphData` / `findRelatedChanges` 是同步函式**（會阻塞主行程做磁碟 IO）。把它們一律
  當成「非同步且會拋錯」會直接編譯失敗 —— 但更危險的是反過來：把 `null` 當成成功值傳下去。
- **`SpecInfo.path` 是絕對路徑。** 直接送給 renderer 會**破壞邊界語彙**（renderer 的全部設計
  前提是「它沒有詞彙可以表達 workspace 之外的位置」）。主行程必須翻成 folder-relative，
  翻不出來就回 `null` —— 側欄少一個「跳到檔案」的入口，好過洩漏一個絕對路徑。
- **`listChangeMarkdownFiles(repo, slug)` 不是它聽起來的意思** —— 實測回的是 repo 根目錄的
  `["CLAUDE.md", "README.md"]`，**不是** change 的 artifact 檔案。不要拿它推交叉導覽的路徑
  （改以 OpenSpec 的目錄慣例推導候選路徑，再 `stat` 確認存在）。
- **`GraphNode.label` 對 change 是 humanize 過的描述（`solo change`），不是 slug
  （`solo-change`）。** 拿它去錨定會找不到那個 change。identity 一律從 `node.id`
  （`change:<slug>` / `spec:<topic>`）取，`label` 只用於顯示。**這是探針抓到的 —— 而且我後來寫
  探針時又踩了一次同一個坑**（用 slug 去找節點的文字標籤，於是根本沒點下去）。在 d3 的圖上定位
  節點要讀它綁在 DOM 上的 `__data__.id`，不要讀文字。
- 好消息：**`SpecInfo.historyCount` 恆等於 `findRelatedChanges()` 的長度**（實測吻合），
  所以 Specs 清單的「N changes」是零成本的，不必為每個 topic 再跑一次查詢。

- **`ChangeInfo.createdDate` 只來自每個 change 的 `.openspec.yaml`（`created:` key）。**
  沒有它，change 就**放不上 Timeline**（會被歸到「沒有建立日期」那一區，Gantt 上一條 bar 都不會
  有）。造 fixture 時很容易漏掉 —— `openspec/config.yaml` 是 repo 層的，跟這個無關。

### `slug` / `topic` 是不受信任的輸入 —— 查表，不要過濾字元

它們來自 renderer，且會被 core 拿去**拼接檔案路徑**（`readChange(repoPath, slug)`）。
一個 `slug = "../../../../etc"` 就是 path traversal。

**防護是白名單**：先在快取的掃描結果裡**查表**，只對確實存在的 identifier 呼叫 core。這比
「檢查有沒有 `..`」強 —— 後者是黑名單，總有漏網的編碼形式。這與 `fs.*` 的路徑邊界是**互補而
非重複**的：那道防的是 relPath，這道防的是 identifier，兩者的詞彙不同。

### React：「把 prop 同步成 state」的 effect 會在**首次掛載時靜默失效**

side panel 的兩個身分**互斥掛載**（顯示 OpenSpec 時 FilesPanel 根本不存在）。於是跨身分導航
（「在 Files 中開啟」）送出的請求，抵達時 FilesPanel 是**那一刻才第一次掛載**的 —— 若用
「nonce 變了才套用」的寫法，`useState(nonce)` 的初始值就等於當前 nonce，兩者相等，**跳過去的
那一次永遠不會開檔**（實測：身分切過去了，畫面停在檔案樹）。**請求必須在 `useState` 的初始值
就套用。**

順帶兩條：**副作用不可寫在 effect 裡同步 setState**（`react-hooks/set-state-in-effect` 會抓
到，且它是對的）—— 用 React 官方的「渲染期間調整 state」（`if (next !== seen) { setSeen(next);
setX(...) }`）。但**渲染期間只能改自己的 state**，不能呼叫父層的 setState（React 會報
「Cannot update a component while rendering a different component」）—— 所以錨定要在
**送出請求的那個 event handler** 裡完成，不能等 panel 收到請求後回呼。

**換 folder 必須清掉待處理的跨身分請求** —— 它是**上一個 repo** 的座標。少了這步，切到新 repo
時側欄會停在「顯示某個 spec」的視圖，而那個 spec 屬於前一個 repo。**這也是探針抓到的。**

### 側欄的資料流：重取時不可回到 loading

`openspec/` 一有變更就重新取數 —— 但**保留舊資料、不回到 loading**。agent 每存一次檔就閃一次
「載入中…」，側欄會變成一塊閃爍的東西，而使用者正在讀它。`loading` 只在「還沒有任何資料」時為真。

反過來，**key 變了（切 folder、換 change）就必須把資料清掉**：沿用上一份的話，畫面會有一瞬間
顯示**上一個 folder 的 change** —— 那比 loading 更糟，因為它看起來像是真的。

### 驗「pty 宣告的標題」不能用真的 claude —— 用 PATH 上的一支 stub

OSC 標題只對 `claude` spawn 目標生效，於是那組驗收的載體必須是 claude 目標的 session。但我們
**叫不動真的 `claude` 去宣告一個指定的標題**，也不能要求每台機器都裝了它，更不該讓一支探針真的
去啟動一個 Claude Code session。

產品的 claude 模式是 `$SHELL -l -c claude` —— **從 PATH 解析**，而 pty 的 env 整份繼承 Electron
行程的 `process.env`。探針本來就自己 spawn Electron，因此把一個放著 stub `claude` 的目錄前置到
`PATH`，走的就是**產品原本那條路徑**：動的是環境，不是被出貨的程式碼。stub 本身是個互動 shell
（`exec /bin/sh -i`），既有的 `typeLine(printf '\033]0;…')` 一個字都不用改就能驅動它宣告標題。

- **`HOME` 也必須換掉，否則 stub 會被真的 claude 蓋過去（實測踩過）。** `-l` 是 login shell，
  它 source `~/.profile`，而 Ubuntu 的預設 `~/.profile` 裡有 `PATH="$HOME/.local/bin:$PATH"`
  —— 那一行把**真** claude 的目錄搶到我們前面，於是探針真的把一個 Claude Code session 跑了起來
  （分頁標籤變成它宣告的任務描述，四條斷言以看不懂的方式失敗）。把 `HOME` 指向暫存目錄後：那裡
  沒有 `~/.profile` 可 source，而且 stub 就放在該 HOME 的 `.local/bin` 裡 —— **即使 profile 真的
  prepend `$HOME/.local/bin`，它指的也是我們的目錄**。
- **`SHELL` 要釘成 `/bin/sh`** —— zsh 會自己送 OSC 標題（它的 prompt 就在做這件事），claude
  session 的標籤就不確定了。
- **「stub 真的跑起來了」要以磁碟上的憑據斷言，不要看終端畫面。** 「終端上有沒有出現某行字」對
  掛載時機、backlog 的 flush 與捲動都很敏感（dev 的 StrictMode 還會把元件重掛一次，實測因此讀
  不到）。把一個穩固的事實綁在脆弱的訊號上，只會換來一支時綠時紅的探針。

### 一支永遠紅的探針等於沒有探針

`probe:shell` 的「fs 介面只暴露已定義邊界要求的能力」這條，自 **Phase 3 起就是紅的** ——
它還在斷言「不得有 `writeFile`」，而 Phase 3 正是加入寫入能力的那個 change（封存時漏了它）。
Phase 5 把清單補齊，並補上兩條它本來就該守的：**`fs.symlink` 絕不可出現**（寫入邊界的 TOCTOU
論證完全建立在這個前提上），以及 `openspec.*` 也受同一條白名單原則約束。

**探針的斷言會隨規格過期。** 加能力到 preload 白名單時，記得那裡有一道守衛在等著。

### 驗 reload 要用 `Page.reload`，不能用頁面裡的 `location.reload()`

`location.reload()` 是**頁面發起**的導航，會觸發 `will-navigate` —— 而導航防護正是無條件
`preventDefault()` 它。於是 **reload 被 app 自己的防護擋掉，頁面根本沒有重新載入**，而探針
會在一個從未 reload 過的頁面上把整段驗收跑完（實測：看起來只是「莫名其妙地失敗」）。
用 CDP 的 `Page.reload`（瀏覽器層發起，不走 `will-navigate`）—— `probe:terminal` 一直是這樣做的。

**而且要斷言 reload 真的發生了。** 我一度寫了一支「重現腳本」證明 reload 之後一切正常，
但那支腳本從頭到尾沒切換過身分，side panel 的身分**本來就是預設的 OpenSpec** —— 有沒有 reload
都一樣，於是它對「頁面沒被換掉」完全無感，給了我一個假綠。可靠的作法是**先把狀態改成非預設值**
（例如切到 Files 身分），reload 之後看它有沒有回到預設。

### 現在有四到五個 `role="tablist"`

身分切換（`side panel 身分切換`）、OpenSpec 的視圖（`OpenSpec 視圖`）、**本 change 的 artifact
分頁**（`Change artifact`）、session 分頁列（`Session 分頁`），overlay 開著時還有第五個
（`視覺化`）。**探針裡全域的 `[role="tablist"] button[role="tab"]` 會把它們混在一起**
（`probe:files` 因此一度數到 6 個分頁）。選取時一律連 `aria-label` 一起指名。

## renderer 安全硬化的實測與踩雷（`renderer-security-hardening`）

一次資安掃描後補上的三項縱深防禦（都在既有邊界之上，補既有硬化未收攏的邊角）：renderer 的
**CSP**、`clipboard:writeText` 的**型別 guard**、xterm 的 **OSC 8 `linkHandler`**。

### CSP 的切換依據是「有沒有 dev server」，不是 `app.isPackaged`

CSP 由**主行程**施加（`session.defaultSession.webRequest.onHeadersReceived`），不是 renderer
自宣告的 `<meta>` —— 與 fs 邊界同哲學：renderer 渲染不受信任內容，它自己宣告的約束不構成防護。
已實測 **`onHeadersReceived` 對 `file://` response 確實觸發且 CSP 生效**，build 模式不必退回 meta。

dev 政策要放行 Vite HMR（inline preamble 的 `'unsafe-inline'` script、HMR 的 `ws:`），production
一律收回。**切換依 `ELECTRON_RENDERER_URL` 的存在，不是 `app.isPackaged`** —— 這是探針抓到的：
`app.isPackaged` 只有真正打包後才為 true，於是「未打包但載入 `file://` build 產物」（probe 的建置
模式、或開發者 `npm run build` 後直接 `electron .`）會**誤發 dev 政策**，更糟的是 **production 政策
從此沒有任何 probe 覆蓋**（probe 永遠 `isPackaged === false`）—— 一個經典的假綠。以 dev server 的
存在為準，`file://` 一律拿到緊政策，probe 的建置模式驗的就是 production 政策。

`style-src` 的 `'unsafe-inline'` 無法避免（Monaco／xterm／Tailwind v4 都在執行期注入 inline
`<style>`）；`script-src` 維持 `'self'`（建置產物無 `eval`，連 `'unsafe-eval'` 都不需要）；
`img-src` **放行 `https:`**。一度是擋掉遠端圖片（防追蹤 beacon），但使用者判定「markdown 本就該能
載入遠端圖片」—— 而且那 beacon 是低嚴重度（洩漏「開了這個檔」＋ IP，無程式執行／憑證竊取／邊界
逸出），使用者本就在這些 repo 裡跑 agent 與 shell，擋圖片划不來，改為放行。`http:` 不放行（近乎所有
真實圖片是 https，且擋 `http:` 同時擋掉惡意 markdown 對 `http://localhost` 的 image-GET 探測）。

### 驗 CSP 的 inline-script 阻擋，不能用 CDP 動態插入 script —— 它繞過 script-src

`probe:files` 起初用「CDP evaluate 動態插入一段 inline script，斷言它沒執行」驗 `script-src`。
**錯**：`Runtime.evaluate` 注入的程式碼繞過頁面 CSP 的 script-src（DevTools 的設計，否則無法在
嚴格 CSP 頁面除錯），那段 inline script **會**執行 —— 不管政策對不對都給假結果。改從
`securitypolicyviolation` 事件的 `originalPolicy` 端到端讀出**實際施加的政策**，斷言 `script-src`
僅 `'self'`。**擷取 `originalPolicy` 需要一個一定被擋的請求去觸發違規** —— 圖片放行後不再是觸發源，
改用 `fetch` 一個遠端主機（`connect-src 'self'` 擋下 → connect-src 違規 → originalPolicy）。遠端
圖片則反過來驗「**不**引發 `img-src` violation」（放行），這條也擋得住「又改回封鎖圖片」的 regression。

### OSC 8 連結的行為驗不進 probe —— 對照組證明了假綠

xterm 的 OSC 8 超連結走 `Terminal.linkHandler`（與 WebLinksAddon 的純文字連結是**兩套**）。未設它
會落入 xterm 內建預設：`confirm()`（文字由不受信任的 pty 輸出控制）+ `window.open()`。設
`linkHandler.activate → openLink` 讓兩套連結都匯到 `openExternal`（design D4）。

`probe:terminal` 曾有一條「真滑鼠 hover+click 一個 OSC 8 連結，斷言不彈 confirm／window.open」。
**對照組證明它是假綠**：把產品的 `linkHandler` 整個移除、重跑，斷言**仍然全綠** —— 那個 hover+click
根本沒觸發 xterm 的 OSC 8 連結激活（DOM renderer 下的 hit-test 與 Linkifier2 的 hover 追蹤，注入式
滑鼠事件驅動不了），confirm 於是恆為 false，與 linkHandler 設沒設無關。且即使觸發得了，正向「走了
openExternal」仍不可觀察（fire-and-forget、交主行程開系統瀏覽器）。**這條缺口由 code review +
design D4 補**，比照「探針證明不了真實鍵盤」。移除假綠斷言、把理由留在 probe 與此處，好過留一盞
測不到自己宣稱在測的東西的綠燈。

### clipboard 的 guard：probe 驗得到「主行程存活」，驗不到「無 uncaught exception」

`clipboard:writeText` 是 fire-and-forget 的 `ipcMain.on`、無回應通道；非字串會讓
`clipboard.writeText` 拋 `TypeError` → 主行程未捕捉例外（實測：真實 Electron 行程會跳原生錯誤
對話框）。guard 是一行 `typeof text !== 'string'` 的丟棄。`probe:terminal` 送幾個非字串、再確認
主行程仍服務後續 IPC、合法字串仍寫得進剪貼簿。**headless 侷限**：主行程有無 uncaught exception
不傳到 renderer，且 headless 下它拋了也不整個崩潰 —— 此斷言驗的是「畸形輸入後主行程與 clipboard
通道仍健康」（可觀察、真實發生），區分不了「有 guard 靜默丟棄」與「無 guard 拋例外但存活」。guard
本身由 code review + design D3 承擔。

## session 的持久化與重建（`session-restore` 起）

**session 是被「重建」的，不是「常駐」的。** 關掉 app，pty 一定會死 —— **pty 的 master fd 必須有人
持有**，app 一死，slave 收到 SIGHUP，底下的行程跟著死。重開時我們是**重新開一個 pty**，然後讓
claude 續接對話、shell 回到最後的工作目錄。**跑到一半的 build 或 dev server 救不回來**，那需要常駐
（見 `docs/PRD.md` §11）。不要把兩者混為一談。

### `claude` CLI 的四個實測結論（全部左右了設計）

- **`claude --session-id <uuid>` 可由我們指定對話 id**；`--resume <uuid>` **沿用**原 id
  （`--fork-session` 才換）。於是 id 可以被持久化並在下次直接續接，**不必去 `~/.claude/projects/`
  猜哪個 `.jsonl` 是我們的**。
- **`claude --session-id <已存在的 id>` 會直接報 `Error: Session ID … is already in use.`**
  —— 於是 **`claude --resume X || claude --session-id X` 這種自癒寫法是個陷阱**：claude 若因其他原因
  非零退出（使用者 Ctrl+C、API 錯誤），`||` 會觸發第二條並撞號，換來一則看不懂的錯誤。
- **開了 claude session、還沒跟它講話就關掉 app → claude 根本不寫 transcript**（實測：互動啟動、
  4 秒後殺掉，`~/.claude/projects/` 下什麼都沒有）。於是重建時 `--resume` **必定失敗**。
  **這不是邊角，是主線情境**（開個分頁準備等一下用）—— 續接失敗的處理不能當例外路徑草草了事。
- `claude --resume` 在互動模式下**會自己把過去的對話重畫在終端上**。因此 **claude session 絕不重播
  我們存的畫面快照**（會看到兩份歷史），**只有 shell 存快照**。順帶省下絕大部分的快照 IO ——
  一直在吐字的正是 agent。

### pty 的環境必須抹掉「巢狀 Claude Code」的標記 —— 否則續接功能**靜默失效**

**這是 dogfooding 第一次重開 app 時抓到的，而且它偽裝成「功能正常」。**

spekterm 若由一個 agent 啟動（`npm run dev` 是 agent 幫忙跑的 —— **dogfooding 時的常態**），Electron
會繼承那個 Claude Code session 的環境變數，pty 再整份繼承下去。於是裡面每一個 `claude` 都認為自己是
**巢狀的子 session**，而**巢狀的 claude 不寫 transcript**（實測：對話真的發生了、claude 也回覆了，但
`~/.claude/projects/` 底下什麼都沒有）。

後果：`--resume` **必然失敗** → 自癒接手 → 使用者拿到一個**能用的** claude，只是對話永遠是全新的。
**沒有錯誤訊息、沒有紅燈，連探針也抓不到**（探針用的是 stub claude，它不管 env）。

- **元兇是單一一個變數**（二分實測）：**`CLAUDE_CODE_CHILD_SESSION`**。單獨拿掉 `CLAUDECODE` 或
  `CLAUDE_CODE_ENTRYPOINT` 都**無效**。
- **絕不以 `CLAUDE*` 前綴一概剝除** —— `CLAUDE_CODE_OAUTH_TOKEN` 是認證用的，剝掉它 claude 登不進去。
  `ptyEnv()` 的名單是明確列舉的，且不含任何帶 KEY／TOKEN 的名字。
- **login shell 讓副作用很小**：使用者自己在 `~/.zshrc` 設的變數會被重新 source 回來，拿掉的只有
  「啟動 spekterm 的那個行程注入的」。
- **兩種 spawn 目標都適用** —— 在 shell session 裡手動打 `claude`，踩的是同一個坑。

> **另一個附帶的實測**：`claude` 一啟動就會宣告一個**任務式的 OSC 標題**（`✳ Claude Code` →
> `✳ session persistence recovery`），**即使你一個字都還沒跟它講**。所以**分頁標題不是「有對話」的
> 證據** —— 我一度拿它當證據，差點把「沒有 transcript」誤判成 claude 的 bug。

### spekterm 的 session id 與 claude 的對話 id **必須解耦**

直覺會想把兩者綁死（主行程本來就用 `randomUUID()` 產 sessionId）。**但上面第二、三條讓「換號」變成
必要能力**：續接失敗時必須以一個**全新的** uuid 開新對話（沿用舊的會撞號），而若兩者是同一個欄位，
換號就等於換掉 session 的身分 —— 分頁 key、focus、順序、錨定全都要跟著搬。

因此持久化有兩個識別碼：`id`（spekterm 的 session identity，**永不改變**）與 `claudeSessionId`
（**可被替換**）。續接策略是**一律 `--resume`，pty 若在 3 秒內以非零碼結束就判定續接失敗，以全新 uuid
重試一次**（至多一次）。**判準只看「時間 + 結束碼」，不解析 claude 的輸出。** 這條路徑**零 layout 依賴**
—— 不去複製 claude 的內部檔案佈局（那會隨版本變，而且**降級方向是壞的**：猜錯就會撞號讓 session 死掉）。
重試法猜錯的下場只是「開一個全新的 claude」，永遠不會撞號。

### 「新增一個狀態」＝**要去找出每一個 `if (status === …)`** —— 而且它們不會編譯失敗

`session-persistence` 為 session 加了第三個狀態 `dormant`。TypeScript **一條都沒攔下來** ——
因為既有的判斷全是 `status === 'running' ? A : B` 這種**二分**寫法，多一個列舉值只是靜默地落進
`else`。實測後果（`/opsx:verify` 的獨立稽核抓到）：

- `session-badge.tsx` 只認得 running／exited → **每個休眠的 session 都亮紅燈、tooltip 說它
  「已結束（代碼 0）」**。那是使用者重開 app 之後看到的**第一個畫面** —— 等於在告訴他「你的
  session 都死了」。
- `TerminalView` 的快照 flush 只判斷 spawnTarget、不判斷 status → 一個**從未被喚醒**的休眠 shell
  session，關窗時會把 xterm 裡那份「重播的歷史 + 分隔線」**再序列化回快照** → 下次重播再追加一條
  分隔線。**每重開一次就多一條。**

**加列舉值時，把 `status ===` / `spawnTarget ===` 全部 grep 一遍。** 三元運算子的 `else` 分支是
新狀態的墳場。

### 休眠的提示被 xterm 蓋住 —— 而 `elementFromPoint` **量不到 `pointer-events-none` 的元素**

xterm 的 `.xterm` 是 `position: relative`，且由 `handle.open(host)` 在 **effect 裡 append** ——
排在 React children **之後**。兩者都是 `z-index: auto` → 依 tree order 繪製 → **xterm 蓋在提示上**，
而 `.xterm-viewport` 的背景是不透明的。於是「休眠的 session SHALL NOT 呈現為空白終端」這條 spec
**在實作上完全沒有兌現**，卻沒有任何測試發現 —— 那個 scenario 是零覆蓋的。

修法是 host 給 `relative`、提示給 `z-10`。**但驗它的方法有個坑**：`document.elementFromPoint()`
回傳的是「**會收到指標事件**的最上層元素」——**它會跳過 `pointer-events: none` 的元素**。拿它去量
一個 `pointer-events-none` 的提示，永遠只會拿到底下的 xterm，**不管修沒修**。

順著這個坑反而問出一個對的產品決定：**「這個 session 恢復不了」的提示不該是 `pointer-events-none`**
—— 它背後是一個永遠不會活過來的終端，沒有東西值得點。讓它接住指標事件，提示才是實心的，而
`elementFromPoint` 也就成了真正的 hit-test（對照組確認：拿掉 `z-10`，它回傳 `xterm-screen`）。

### 喚醒把「pty 先誕生、終端後掛載」的順序**倒了過來** —— pty 於是停在 80 欄

**dogfooding 抓到的**：resume 之後 claude 的畫面「縮成一小塊」，手動拖動視窗才恢復。

`fit()` 在「尺寸沒變」時回 `null`（它的用途是「要不要打擾 pty」）。喚醒一個休眠的 session 時：

1. 終端由隱藏轉為顯示 → `active` 的 effect 先跑（`TerminalView` 是子層，effect 早於父層的 `wake`），
   `fit()` **成功**量到真實尺寸 → 送出 resize → **pty 還不存在，主行程直接丟掉**。
2. 而 `lastCols` 已經記成了那個尺寸 → 之後 ResizeObserver 再 `fit()` 一律回 `null`
   → **再也不會有人告訴 pty 真正的尺寸** → 它一輩子停在 spawn 時的 **80×24**。

**新建的 session 不會踩到** —— 它的 pty **先**誕生、終端**後**掛載 `fit()`。

修法：**pty 誕生的那一刻（`status` 轉為 `running`），把終端當下的尺寸告訴它**（`XtermHandle.size()`
—— 它不做「尺寸有沒有變」的偵測，`fit()` 沒辦法回答這個問題）。

> **探針證明不了 wake 那條路的修正（對照組確認）。** 走不走到上面那條路，取決於 xterm 何時量到
> 字元尺寸 —— 若 `fit()` 在 `active` 的 effect 裡回了 `null`，`lastCols` 維持 0，稍後 ResizeObserver
> 就會補救成功。**探針一直走那條幸運的路**：把修正整個拿掉，斷言照樣是綠的。留下的那條只擋「完全
> 沒有人告訴 pty 尺寸」的回歸；真正的防護由 code review + design 承擔（比照 OSC 8 `linkHandler`）。

> **而 `#heal()` 那條路上，同一個 bug 是確定會發生的 —— 它一開始漏掉了。** 自癒對 renderer
> **完全不可見**（`status` 一直是 `running`，它收不到任何事件）：那個「pty 誕生時推尺寸」的 effect
> 不會重跑，`fit()` 又因「尺寸沒變」回 `null` —— 於是自癒出來的 pty **一輩子停在 80×24**。而
> **自癒是主線情境**（沒跟 claude 講過話的 session，續接必定失敗），這條路比 wake 那條更常被走到。
> 修法：`#spawn` 接受 cols／rows，`#heal` 把**將死那顆 pty 的 `IPty.cols`／`rows`** 帶過去。
> 這條探針驗得到（stub claude 自己 `exec $SHELL -i`，是個可以打字的互動 shell）。

### `disposed` 的 exit **不是** session 結束 —— 少了這個區分，關一次視窗就清空持久化

關視窗與 reload 時我們自己殺光所有 pty（Phase 4 的「不留孤兒」）。那些 pty 都會觸發 `onExit`。而
「已結束的 session 不持久化」這條要求，若直接寫成「收到 exit 就把它從持久化移除」——**關一次視窗，
`sessions.json` 就被清空了**。那正是這個 change 要修的 bug 本人，只是換了一種寫法。

`TerminalSink.exit` 因此帶 **`ExitReason`**：`self`（pty 自己死了）／`killed`（使用者關掉）都是真的
結束；**`disposed`（我們收工時殺的）不是** —— 持久化必須原封不動，而且**那個 exit 也不可推給
renderer**（reload 後的新頁面已經用同樣的 id 重建了這些 session，一則遲到的 exit 會把剛重建好的分頁
標成已結束）。

### 兩個會**靜默毀掉使用者資料**的 React 陷阱

- **落盤的 effect 必須有一道「restore 完成了嗎」的閘。** 首次渲染時 `sessions` 是空陣列 —— 少了閘，
  它會在 restore 從磁碟讀回來**之前**就送出一份空清單，**把上一次的 session 全部抹掉**。沒有錯誤、
  沒有訊息，只有「重開之後什麼都不見了」。
- **restore 的 `setSessions` 必須是合併，不能是覆蓋。** restore 是一次非同步 IPC，使用者完全可能在它
  回來之前就按下「+ session」—— 直接 `setSessions(重建的清單)` 會讓那個剛建好的 session **憑空消失，
  而它的 pty 還活著**。（探針抓到的正是這個：「pty 行程存在」是綠的，「分頁出現」是紅的。）

### StrictMode 會把重建做兩次 —— 而且只有 dev 會壞

- restore 的 effect 需要一道 **ref 閘**，否則 `restore()` 被呼叫兩次，**每個 session 都變成兩份分頁**。
- 快照的取用**不可以是「讀完即刪」**：StrictMode 把 `TerminalView` 的掛載 effect 跑兩次，第一次就把
  快照取走了，第二次（也就是**真正存活下來**的那個 xterm）拿到 `undefined`，畫面一片空白。
  改為非破壞性讀取，條目在 `close()` 時才清掉。

### `\x1b[?1049l` 只能**條件式**地送 —— 沒進過 alt screen 時，它會把游標拉回 (0,0)

**`SerializeAddon` 會把終端模式一起序列化**（實測：使用者關 app 時正開著 vim，快照裡就真的有
`\x1b[?1049h` 與 `\x1b[?1003h`）。所以重播完之後，我們**可能就站在 alternate buffer 裡** —— 不離開它，
新的 shell 就跑在 vim 的那塊畫面上：**歷史全部看不見、沒有 scrollback**。

直覺的修法是「重播前後各送一次 `?1049l` 把狀態清乾淨」。**兩邊都錯：**

- **寫在歷史之前，對 alt screen 毫無作用** —— `?1049h` 在**歷史的中間**，重播完照樣在 alt buffer 裡。
- **無條件寫在歷史之後，會毀掉沒進過 alt screen 的正常情況** —— `?1049l` 不只切換緩衝區，它還會
  **還原「進入 alt screen 當下所儲存的游標」**。沒進去過時那個位置是 **(0,0)**：游標被拉回左上角，
  接著寫入的分隔線蓋掉歷史的第二行、live 的第一個 prompt 再蓋掉第三行（探針抓到的畫面是
  **`$ RK_42`** —— `MARK_42` 的前兩個字被 `$ ` 覆寫掉了）。

**正解：重播完之後，只有 `term.buffer.active.type === 'alternate'` 時才送 `?1049l`。** 真的進去過時，
它還原的正是我們要的游標；沒進去過時根本不送。不動游標的那些重置（滑鼠追蹤、SGR）則無條件送。

而且**重播完要自己把游標挪到內容之後**（只用相對移動的 `\n`，絕對定位在一個尺寸與快照當下不同的終端
上會落在錯的地方），再寫分隔線，**然後才接上 live 串流** —— 否則 pty 的第一個 prompt 會插進歷史中間。

> **這條的驗收差點又是一盞假綠。** 起初的斷言是「重建後新 shell 的輸出看得見」—— 而**卡在 alt buffer
> 裡的 shell，它的輸出照樣看得見**（只是被畫在 vim 的畫面上）。對照組（拿掉修正後重跑）**照樣全綠**。
> 有鑑別力的判準是「**normal buffer 裡的歷史看得見**」：那是兩種情況真正的差別，也是使用者真正失去的
> 東西。換上它之後，對照組如期變紅。

### 一個 claude session 是**兩個** `/bin/sh` 行程 —— 探針要數 session，不是數行程

`$SHELL -l -c "claude …"` 的那層 shell **不會 exec**（實測，cmdline 說了實話）：它與 claude 自己的
shell 是兩個行程，兩個的 `argv[0]` 都是 `/bin/sh`。login shell 的 session 則只有一個。**拿行程數去
斷言「只喚醒了一個 session」，會把一個好的實作判成壞的。** node-pty spawn 的恆是 `$SHELL -l …` ——
以 `-l` 認出領頭行程，數量就等於 session 數。

### `probe:terminal` 的 reload 斷言在本 change 之前是**靠競態維持的綠燈**

「重新載入釋放先前的所有 pty」原本斷言「pty **數量**為 0」，而「重新載入後分頁列回到空狀態」更是
**直接與新規格相反**（我們刻意要把分頁重建回來）—— 兩條都靠「reload 之後、restore 還沒 resolve 之前
有一個幾毫秒的空窗」而繼續是綠的。判準必須改成「**先前那些 pid 不再存在**」（重建會立刻起新的 pty）。
**探針的斷言會隨規格過期**（同 `probe:shell` 與 `probe:workspace` 的教訓）。

> **斷言只驗「字串存在」，就驗不出畫面被弄壞。** 上面那個 `?1049l` 的 bug，在
> `replayed.includes('MARK_42')` 這種斷言下**照樣是綠的** —— `MARK_42` 確實還「在」（雖然它變成了
> `RK_42` 且跑到分隔線後面去了）。**順序也要驗**：歷史必須完整，且整段在分隔線之前。

### 不要用 `head -N` 過濾 `npm run typecheck` 的輸出

npm 會先印幾行 `>` 開頭的腳本回顯與**空行**；`npm run typecheck 2>&1 | grep -v '^>' | head -3` 於是
只顯示那幾個空行，**真正的錯誤被擠出視窗**。我因此一度以為「typecheck 抓不到未定義的函式」而去懷疑
`tsconfig` —— 對照組證明它抓得到（`TS2304`），是我自己把眼睛遮住了。**要看 exit code，不要看被截斷
的前幾行。**

## side-panel-repo-anchor 的實測與踩雷

跨 repo 側欄。實作本身是「拆一個 prop」，真正承重的思考在**要不要「跟隨/釘住」toggle**（決定不要，
見 D1）與**確認式對話框的教訓再次應用**（換個議題但同樣的答案：可預測答案的高頻問題，不該問）。

### 「一堵拿不到 pid 的牆」逼出正確的框架

痛點看起來是「側欄跟不上 agent」—— 直覺會想「側欄自動跟隨 agent 實際在動的 repo」。**這條路技術上
是死的**：Linux 的 inotify **不回報 pid**（事件裡沒這欄位），fanotify 需 `CAP_SYS_ADMIN`（root）。
一個桌面 app 不可能要求那個。於是「哪個 session 改了哪個 repo」在核心層面就拿不到。

被這堵牆逼一下之後，回頭看使用者的原話「無法在這個 repo **看到** repo B 的 openspec 與 files」——
他要的其實是「一邊盯著 repo A 的 agent、一邊**讀** repo B 的 spec」。這個框架不需要偵測、不需要
歸因：**把側欄的來源與 rail focus 解耦就好** —— 側欄自己有一個來源選擇器，terminal 那半照常。

**這條「拿不到 pid」寫進 change 的 design 是承重的**：它擋住未來想「加點自動化」的衝動 —— 那條路
沒有可靠的入口，除非願意讀 claude 的 transcript（`~/.claude/projects/*.jsonl` 裡確實有每一次 Edit
的絕對路徑），而那是把設計綁在 claude 的內部檔案佈局上，`session-restore` 已留下教訓（別做）。

### 「跟隨/釘住」toggle 是可預測答案的高頻問題 —— 不要問

proposal 一度設計了「跟隨（預設）/ 釘住」toggle。**它其實無事可做**：那顆 toggle 的「跟隨」本意是
「側欄 = 我正在駕駛的 repo」，但在這個 app 裡「正在駕駛的 repo」＝ `session.folderId`，而它**不隨
pty 的 cwd 浮動**（session 掛在哪個 repo 是固定的，見「一堵拿不到 pid 的牆」）。於是「跟隨」退化
為「釘在自身 folder」，與「釘住」在行為上完全一樣。

**這與 `session-title-authority` 移除「pty 想改名要問過」對話框是同源的教訓**：都是「一個可預測
答案的高頻問題不該被問」。那個對話框在 agent 持續改標題的情境下無限重跳，且答案永遠是「保留我
命名的」；這顆 toggle 在正常使用下永遠停在同一態，且答案永遠是「跟自身走」。**優先序的裁決**
（`customTitle` > `title`、`panelSource` 隨 focused session 走）本身就是那個問題的答案，不需要在
UI 上再問第二次。

真正有意義的差別只剩「切走再切回，記不記得指向 repoB」—— 而 per-session 的裁決已經決定「記得」。
於是 toggle 被取消，改用**來源指示器 + 「回到自身 repo」一鍵捷徑**：把 toggle 的唯一有用部分
（「回到預設」）留下、不假裝有動態跟隨。

### 切換來源時 `anchoredChange` **必須重置** —— slug 是綁在 repo 上的

`change` 的 slug 隸屬於某個 repo（`openspec/changes/<slug>`）。切側欄來源時若沿用舊 slug，「本
change」視圖會對著一個在新 repo 不存在的 change 顯示空狀態，**看起來像壞掉**。所以 `setPanelSource`
一併把 `anchoredChange` 重置為 undefined，讓既有的衍生預設接手（新 repo 恰有一個 active change
就是它，否則呈現空狀態讓使用者自己挑）。「一個 (repo, change)」在資料上是「`panelFolderId` +
隸屬於它的 `anchoredChange`」，不是一個獨立的複合鍵 —— 切 repo，change 歸零重解析。

### `PanelSourceBar` 的 `session's` 單引號炸掉 probe（`aria-label` 是選擇器再一次咬人）

第一版文案寫 `"Back to this session's repo"`。**probe 的選擇器是 `[aria-label="…session's repo"]`**
—— 那個單引號提前關閉了 probe 的字串字面值，整個 evaluate throw、build 模式 exit 1、沒有紅的斷言，
只有一個 Uncaught error。改為 `"Back to the session repo"` 就過了。這正是「aria-label 是選擇器」
再演一次 —— 而這次的教訓比先前更緊：**寫 aria-label 文案時也要避開 shell 引號會咬到的字元**
（單引號、雙引號、反引號），因為 probe 選擇器是用字串拼的。

順帶：那次 exit 是我 pipe 到 `tail -50` 讀 stdout 尾巴，`tail` 自己的 exit code 覆蓋了 probe 的。
**要看真的 exit code，別讓 pipe 蓋掉它**（與 CLAUDE.md 已記的「用 `head -N` 過濾 typecheck」同源）。

### CSP 「build 模式拿到 dev 政策」的紅是**環境串擾**、不是產品 bug

`probe:files` 曾有一條「CSP 的 script-src 僅 self」在 build 模式紅、detail 是 `'self' 'unsafe-inline'`
（dev 政策）。CSP 切換依 `ELECTRON_RENDERER_URL` 是否存在（見 `renderer-security-hardening` 的
「CSP 切換依據」），而我當時剛跑過 `npm run dev` —— 那條命令把 `ELECTRON_RENDERER_URL`、
`NODE_ENV_ELECTRON_VITE` 等變數**繼承到我 shell 的 env 裡**，之後起的 electron 一律讀到它。
另有 3 個 files-profile 電子殭屍佔著 debugging port（前一次 probe 失敗沒清乾淨）。

**修法**：清 env（`env -u ELECTRON_RENDERER_URL -u NODE_ENV_ELECTRON_VITE -u ELECTRON_MAJOR_VER
-u ELECTRON_CLI_ARGS -u ELECTRON_EXEC_PATH -u npm_lifecycle_script npm run probe:files`）+ 精準
`kill <pid>` 殺殭屍（不用 `pkill -f` 的 pattern —— 那會匹配到執行它自己的那條 shell 命令，把整個
清理 shell 也一起殺掉，看起來像「清完就沒事」，其實一個殭屍都沒殺到）。

**這條要寫進 CLAUDE.md 而非 change design**，因為它是**跨 change 的紀律**：以後任何 dogfood 中途要
跑 probe，都要**先確認 dev 是否還在跑，並用 env -u 清 env**。

## shell-affordance-tweaks 的實測與踩雷

三條殼層小毛病（`Alt` 空 menu、`+ session` → `+`、`Ctrl+Shift+W` 關 session）。前兩條實作各一行，
真正的實測踩雷都在**第三條的 probe 驗收**上 —— 該怎麼在既有 probe 裡塞新斷言而不害到自己。

### `autoHideMenuBar` 只是隱藏，不是移除 —— 兩者按 `Alt` 的行為天差地遠

原本 `BrowserWindow` 設 `autoHideMenuBar: true`，我起初以為它就是「不呈現 menu」—— 錯了，那只是
「平時隱藏、按 `Alt` 浮出」。使用者要的是**按 `Alt` 什麼都不發生**，所以必須真正移除 menu：
`Menu.setApplicationMenu(null)`（app 層，設一次涵蓋整個應用程式）。連帶要把 `autoHideMenuBar` 從
`BrowserWindow` 選項裡拿掉 —— 沒有 menu 之後，那個選項是死代碼。

**macOS 未實測**（`shell-affordance-tweaks` 的 design D2 已列為 Phase 6 打包前確認項）：macOS 的
應用程式 menu 是系統層的（不在視窗內），`setApplicationMenu(null)` 的行為與 Linux／Windows 不同。

### 插入新 probe 斷言：位置與相對數字，兩件事都會靜默毀掉既有測試

`probe:keyboard` 已經是一串按時序流動的狀態機（`fixture` 從 3 個 session 開始，中間段落建 session、
關 session、切 folder），每段測試對狀態有明確的假設。加新斷言時**兩件事都會靜默毀掉既有測試**，
而且症狀看起來像「新斷言壞掉」：

- **寫死絕對數字必死。** 我第一版寫「repo-a 有 3 個 session」當前置條件 —— 實測是 4 個。原因：中間
  段落有一條「Enter 觸發選項，真的建立了一個 session」的驗收，那條為了驗 Enter 而**多建了一個**。
  這種「順手建的 session」以後還會有，寫死數字是把測試綁在**每個中間段落的內部細節**上。改為
  相對數字 —— `nBefore = (await evaluate(TABS)).length` 存下來，斷言 `length === nBefore - 1`
  —— 前面段落淨變化多少都自我修復。
- **插入段的位置也是承重的。** 我第二版把段落插在 runMode 中間，斷言全綠了但**下一段既有測試變紅**
  —— 那段依賴 `shell 1` 存在（`nextOrdinal` 單調遞增，關掉不重用；shell 1 一被關就再也回不來）。
  正解：**插在 runMode 最後、finally 之前**。前面所有既有測試跑完後才動 session 狀態，不會污染任何
  後續斷言。

**兩個規則加起來的教訓：** 新加的 probe 斷言，內部要用相對數字，外部要放在最後。這與 CLAUDE.md 已有
的「一支永遠紅的探針等於沒有探針」是同源的紀律 —— 加斷言時要問「這條斷言假設了什麼、那個假設會不會
被誰改動」。

### 「按鍵不進 pty」由對照組的鑑別力承擔，不由「文字有沒有變」直接證明

`Ctrl+Shift+W` 的核心保證是「終端持有焦點時它關 session、且**不流進 pty**」。直覺會想：按下去、
斷言終端文字沒變。**但那被關掉的 session，terminal 元素直接不存在了** —— `TERMINAL_TEXT` 讀不到，
斷言恆為 undefined，證明不了任何事。

解法是**對照組**：先按純 `w`（不帶修飾鍵）—— 若攔截失敗、Ctrl+Shift+W 也進 pty，那顆按下去終端會多
一個 `w`。所以：

- 對照組驗「純 `w` 確實抵達 pty」（終端文字變）
- 攔截組驗「Ctrl+Shift+W 關掉 session」（tab 數 nBefore-1）

兩條合起來承擔「Ctrl+Shift+W 沒進 pty」的證明 —— **若它進了 pty，對照組的鑑別力保證我們看得見**。
這是既有 Ctrl+T 驗收（`beforeCtrlT` / `afterCtrlT` 對比終端文字）的變體：Ctrl+T 不改變 session 數，
可以直接比對；Ctrl+Shift+W 改變 session 數（terminal 元素被切走），只能靠對照組間接證明。

### `aria-label` 是選擇器（既有事實再驗一次）

改「+ session」→「+」時直覺會擔心 probe 破 —— 實測 168/168 全綠。因為既有選擇器全都靠
`aria-label`（`t('sessions.new')`）定位，可見文字改動不影響。這條老紀律（`ui-copy-i18n` 的
「aria-label 同時是選擇器」）在這裡以另一個方向被驗證：**你可以自由改可見文字，只要 aria-label 不動**。

## UI 文案與 i18n（`ui-copy-i18n` 起）

**使用者看得到的每一個字都來自字典 `src/shared/i18n/en.json`，語言是英文。** 主行程與 renderer
**共用同一份字典**（兩個 realm 各持有一份 i18next 實例，`resources` 指向同一個 JSON）。

**「使用者可見的文案」有四類，後兩類最容易漏 —— 它們住在主行程，看起來像內部錯誤：**

1. renderer 的介面文字（JSX、`aria-label`、`title`、驗證訊息、空狀態）
2. 主行程的**原生對話框**（關窗時的未存提示）
3. 主行程**經 IPC 送達畫面**的錯誤訊息 —— `TerminalError` 的 message 會被畫成「Cannot restore
   this session: …」，`FsServiceError` 的 message 會成為 FileViewer 的 hint
4. **寫進 pty 串流給人讀的訊息**（session 重建的重播分隔線；只有**文字**進字典，ANSI 與框線
   字元留在程式碼）

**`console.*` 與內部不變式的 `throw` 不進字典**（沒有使用者會讀到它們），**但一律英文** ——
因為守衛是一刀切的，而一刀切是對的：「這個字串會不會被顯示」**無法靜態判定**（見第 3 類）。

### 字典是 `.json` 而不是 `.ts` —— 因為 probe 要 import 它

`scripts/*.mjs` import 不了 TypeScript。Node 22 的 import attributes 讀得到 JSON：
`import en from '…/en.json' with { type: 'json' }`（`scripts/lib/copy.mjs`）。

**而「JSON 字典 ⇒ key 沒有型別安全」是錯的。** `resolveJsonModule` 早已開啟，把 `typeof en` 餵進
i18next 的 `CustomTypeOptions`（`src/shared/i18n/i18next.d.ts`），`t('rail.emty')` 就會
**編譯失敗**（TS2345，還會提示 `Did you mean "rail.empty"?`）。**不需要任何型別產生器。** 少了這
一段，打錯的 key 會在執行期把 `rail.emty` 這串字**印在畫面上**。

### i18n **於模組載入時初始化**，不是導出一個「請記得呼叫」的 init

**未初始化的 `t()` 不會拋錯，它回傳 `undefined`**（實測）—— 任何在 init 之前產生的文案都會靜靜
地變成 `undefined`：不是錯誤訊息，畫面上就只是什麼都沒有。而「誰先載入」在三個環境裡並不一致：
主行程於 `whenReady` 才啟動、renderer 於進入點，而**單元測試根本沒有進入點**（它直接 import
`fs-service`，而那裡的錯誤訊息現在也走字典）。把 init 綁在 import 上，這一整類 bug 就不存在了。

renderer 因此改用 `<I18nextProvider>` 交付實例（`use(initReactI18next)` 必須在 `init` 之前，
而 init 已經發生在 import 的那一刻）。

### **`i18next` 必須在 `dependencies`，不是 `devDependencies`**

main 的 build 用 `externalizeDepsPlugin()` —— i18next 不會被 bundle 進 main，而是在**執行期
require**（已驗證：`out/main/index.js` 裡是 `import i18next from "i18next"`）。electron-builder
只把 `dependencies` 打進 asar，**放錯區塊時 dev 模式完全正常，打包後的 app 一啟動就
`MODULE_NOT_FOUND`**。（`react-i18next` 只在 renderer、會被 vite bundle 進產物，因此放
`devDependencies` —— 比照 `react` 與 `react-markdown`。）

### 守衛：產品原始碼的字串字面值不得含 CJK（`scripts/copy-language.test.mjs`）

**文案之所以會變成中文，不是因為有人決定用中文，而是因為沒有東西擋著。** 收斂前有約 150 處。

- **必須走語法樹（`ts.createSourceFile`），不能 regex 掃行** —— **豁免註解正是這道守衛的核心
  語意**（repo 慣例是繁中註解），而註解與字串在同一行裡分不開（`const x = 'ok' // 這是註解`），
  JSX 的區塊註解更是讓「行首是不是 `//`」的判斷完全失效。判不準註解，守衛不是誤殺就是全綠。
- **對照組不是裝飾**：守衛餵一段刻意違規的來源要求它被抓到、餵一段只有繁中註解的來源要求它
  不被誤報。**外加一次實地對照** —— 往真的產品檔案塞一個中文字串，確認它會紅（這證明的是
  `walk()` 真的走到了 `src/`，而不是掃了空目錄之後全綠）。
- 豁免：`*.test.ts`（測試可以用中文描述自己在測什麼）、`scripts/`（探針的輸出是開發工具）。

> **這道守衛只擋 CJK，擋不住硬編的英文文案。** `Side panel`、`Change artifact`、`Specs`、
> `Tasks`、`Spec deltas` 這些 `aria-label` 本來就是英文，於是守衛看不見它們，我第一輪也漏了 ——
> **是 probe 的選擇器盤點把它們揪出來的。** 新增可見文案時（尤其是英文的），要自己記得進字典。

### **`aria-label` 同時是選擇器** —— 這是本 repo 的結構性事實

驗收不得為此在產品 UI 上掛 `data-*`（既有紀律），於是 probe 只能靠 `role` 與 `aria-label` 定位
元素 —— **6 支 probe 共 97 處**。而 `Ctrl+T` 的實作是「找到既有的建立入口並觸發它」，靠的正是
`document.querySelector('[aria-label="…"]')`。

**兩者都從字典取字串**（`scripts/lib/copy.mjs` 的 `copy()` / `label()`；`KeyboardNavigation.tsx`
用 `t('sessions.new')`）。**文案與選擇器一旦分離為兩份字面值，它們就會在某一次改文案時失去同步
—— 而失去同步的徵狀是「選不到元素」，不是「斷言失敗」。** `Ctrl+T` 更是連紅燈都不會有：字串比對
不會使型別檢查失敗，快捷鍵直接靜默失效。

> **「測試與被測物同源，字典寫錯時探針不會發現」—— 不成立。** probe 驗的是**行為**，不是文案
> 內容：沒有哪條 spec 說那顆按鈕必須叫 `New session`，spec 說的是「觸發它會建立一個 session」。
> `aria-label` 在 probe 裡的角色是**定位手段**，與 `role` 或 CSS class 沒有差別。文案內容的正確
> 性由人擔保 —— 它就印在畫面上。

### 三道守衛，缺一不可（它們互補，不重複）

| 守衛 | 擋什麼 | 少了它會怎樣 |
|---|---|---|
| `copy-language.test.mjs` | 產品原始碼的字串字面值含 **CJK** | 文案慢慢變回中文（沒有東西擋著） |
| `aria-label-source.test.mjs` | **硬編**的 `aria-label`（**含本來就是英文的**） | 改文案時探針**靜默地選不到元素**；`Ctrl+T` 連紅燈都沒有 |
| `i18n-key-safety.test.mjs` | 字典 key 的**編譯期**型別安全 | 打錯的 key 在**執行期**把 `rail.emty` 印在畫面上 |

**第二道是第一道抓不到的**：`Side panel`、`Change artifact`、`Specs`、`Tasks` 這些 `aria-label`
本來就是英文，CJK 守衛看不見它們 —— `ui-copy-i18n` 的第一輪實作正好漏掉了它們。

**第三道守的是一份 ambient declaration。** `src/shared/i18n/i18next.d.ts` 的 `CustomTypeOptions`
**沒有任何模組 import 它** —— **拿掉那個檔案，`npm run typecheck` 照樣 exit 0**（已實測），而
`t('rail.emty')` 從此變成一個只在執行期現形的錯誤。**一個「拿掉之後沒有任何東西會紅」的防護，
就是一個遲早會被拿掉的防護。**

### 五個實測踩雷（全部會靜默失敗，或以「產品壞了」的樣貌現身）

- **英文的語序與中文不同 —— 前綴／後綴選擇器不能機械替換。** `自 workspace 移除 {{name}}` 的
  固定部分在**前面**，它的英文 `Remove {{name}} from workspace` 把變數放到了**中間**（前綴只剩
  `Remove `）。而 rail 的展開／收合鈕，中文的兩個標籤都以「的 session」結尾 —— 一個 `$=` 就通吃；
  英文是 `Expand sessions in {{name}}` / `Collapse sessions in {{name}}`，**沒有共同的固定後綴，
  只能兩個前綴都試**。`copy.mjs` 因此提供 `prefixOf` / `suffixOf` / `patternOf`（後者可**自文案
  反推變數的值**）；`prefixOf` 在前綴為空時**拋錯** —— `[aria-label^=""]` 會匹配**每一個**元素，
  那比選不到更糟，因為它會靜默地通過。
- **探針的內容斷言也會過期，不只選擇器。** `/尚未選擇 repo/.test(...)`、`/過大/`、
  `/這個動作無法復原/`、`CLICK_MENU_ITEM('新增檔案')`、`CLICK_VIEW('瀏覽')`、
  `MODE_PRESSED('預覽')`、`indexOf('以上為上次的內容')` —— 這些比對的是 UI 上的**文字**，
  換文案就全紅。**但要區分文案與 fixture**：`/# 標題/` 是探針自己寫進 markdown 檔的內容，
  改它就錯了。
- **註解裡的 `*/` 與反引號會炸掉檔案（我踩了兩次）。** 在 `copy-language.test.mjs` 的**區塊註解**
  裡寫 JSX 的區塊註解形式，那個 `*/` 提前關閉了註解；在 probe 的**模板字串**內寫註解、又在裡面
  用反引號舉例，反引號把模板字串提前結束了。**很應景 —— 這道守衛講的正是「註解與程式碼難分」。**
- **一支新的 CPU 密集測試會逼出既有的競態。** `copy-language.test.mjs` 用 TypeScript 解析整個
  `src/`，`npm test` 平行跑時把 `terminal.test.ts` 的兩處 `stub.calls()` 斷言擠爆了 ——
  產品在 spawn 的**當下**就回報了 conversationId，但 stub 是在自己的行程裡 `echo "$@" >> log`，
  中間隔著一次 fork/exec。**其餘的 `stub.calls()` 斷言本來就都先 `waitFor` 過，那兩處漏了。**
  （baseline 對照證明它不是 i18n 引入的：改動前完整 `npm test` 連跑 4 次全綠。）
- **對已 `close()` 的 CDP client 呼叫 `evaluate`，會無限等待。** `cdp.mjs` 的 `send` 是靠 message
  id 配對 resolve 的 —— WebSocket 關掉之後，訊息沒有人接，那個 Promise **永遠不會 resolve**：
  **不拋錯、不逾時**。`probe:shell` 在 `pollUntil` 之後就 `client.close()` 了，我在那之後補一條
  `evaluate` 量 `document.documentElement.lang`，探針就這樣卡死十分鐘 —— **而症狀看起來像
  「Electron 啟動很慢」**（我差點就當成慢而繼續等）。**量測要併進 `PROBE_EXPRESSION`**，那個
  IIFE 在 client 還活著時就跑完了。
- **`probe:openspec` 的第一條斷言一直是靠運氣的。** `MOUNTED` 只等 rail 的 `<aside>` 出現 ——
  **folder 列來自一次非同步的 `folders.list()`，晚一步才渲染**。`SELECT_FOLDER` 只 `evaluate`
  一次，機器一忙就選不到那一列，而後面**每一條**斷言都跟著紅（看起來像側欄壞了，其實只是還沒
  畫出來）。已改為輪詢。

### 順手抓到的一則過期文案

`SessionNameDialog` 的提示原本寫著「取名之後，pty 想改名**會先問過你**」—— 而那個確認對話框早已
隨 `session-title-authority` 移除（現在是**永久接管、靜默忽略**）。文案與行為不符，而且它承諾的是
一個不存在的功能。英文版改為誠實的敘述：「While a name is set, titles announced by the pty are
ignored. Clear the name to follow them again.」**全面改寫文案時會撞見這種東西 —— 它們是資產。**

## 字級尺度（`rail-legibility-and-repo-row` 起）

**renderer 的字級只有一個旋鈕：`index.css` 的 `--text-base`（定案為 17px）。** 五級尺度全部由它以
`calc()` 平移推導（`2xs` 13 / `xs` 14 / `sm` 15 / `base` 17 / `lg` 18），terminal 的
`--text-terminal`（16px）也是。要整體放大或縮小字級，**只改那一行**。

**字級是版面的輸入，不是裝飾。** 把旋鈕從 15px 調到 17px 時，rail 立刻縮不到它宣告的
`minSize="180px"`（實測卡在 240px）—— 因為 flex item 的 `min-width` 預設是 `auto`，`Panel` 會被
**內容**撐住。`workspace-layout` 要求「拖動 SHALL 被夾制於該下限」，而這道夾制**在實作上一直沒有
真的兌現**，只是字級小的時候 rail 的 min-content 恰好小於 180px，所以看不出來。修的是 `Panel` 的
`min-w-0`（以及 rail 內不會自我截斷的標題），**不是把 180px 調高** —— 最小寬度是版面契約，不該
隨字級浮動。

- **不得寫死字級。** `npm test` 有一道守衛（`scripts/typography.test.mjs`）：產品原始碼不得出現
  `text-[13px]` 這類 arbitrary 值，CSS 的 `font-size` 必須引用 token（`em` / `%` 放行 —— 它們相對
  父層，會跟著旋鈕走；`rem` **不放行**，它相對 html 的 16px，旋鈕轉不動它）。這道守衛是必要的：
  收斂前有 **70 處**寫死的字級，於是 `@theme` 裡的 token 調了也沒用。
- **平移，不是等比縮放。** 使用者要的是「每個字都大一點」；等比縮放會讓大字長得比小字快，改變的
  是版面的層次關係，不只是大小。

### 三個會**靜默失敗**的陷阱（全部實測，全部踩過）

- **`@theme` 會 tree-shake 掉沒有任何 utility 用到的 token。** `--text-terminal` 只被 JS 讀取、
  永遠不會有 utility 引用它 —— 放在 `@theme` 裡它**會從產物中消失**。必須定義在 `:root`。
- **CSS 自訂屬性的 computed value 不會求值 `calc()`。**
  `getComputedStyle(root).getPropertyValue('--text-terminal')` 回傳的是字面的 `"calc(15px - 1px)"`，
  `parseFloat` 得到 `NaN`。**而 fallback 剛好等於正確值，畫面上看不出來** —— 終端字級就此與尺度
  脫鉤，旋鈕轉了它也不動。要讓**瀏覽器**求值：把 `var(--text-terminal)` 餵給一個離屏元素的
  `font-size`（有型別的屬性，computed value 必為絕對 px），再讀回它的 `fontSize`。
- **把 arbitrary 值換成具名 token，換掉的不只是你盯著的那個屬性。** `text-[12px]` 只設
  `font-size`；`text-xs` **連 `line-height` 一起設**（Tailwind 每個字級 token 都有預設的
  `--text-*--line-height`）。於是 45 處 `text-[12px]` 一收斂就憑空多出 16px 行高，分頁列與對話框
  變高 —— 而 `probe:terminal` 是以**真滑鼠座標**點擊的，版面一動，那組對時序敏感的 OSC 標題斷言
  就開始點空。**徵狀是時綠時紅、每次紅的還是不同條，極易誤判為既有的 flaky**；是 baseline 對照組
  （stash 掉改動後跑，114/114 全綠）戳破了這個藉口。因此 `@theme` 裡的五個
  `--text-*--line-height` 全部明確釘住，對齊各自收斂前的來源。

## git 分支（`repo-branch`，`rail-legibility-and-repo-row` 起）

rail 的每一列顯示該 folder 的 git 當前分支。**以讀取 `.git/HEAD` 實作，不 spawn `git`** —— 這是
每個 folder、每次載入都要做的判定，與 `hasOpenSpec` 同一條理由（也因此 `workspace-folders` 那條
「偵測 SHALL NOT 呼叫任何外部程式」在本 change 後依然成立）。`.git` 是**檔案**時（worktree /
submodule）要解 `gitdir:` 那層間接，worktree 寫絕對路徑、submodule 寫相對路徑，兩種都要吃。

**那個 gitdir 常在 folder 邊界之外。** 那是主行程自己的檔案存取，不經 renderer 的
`(folderId, relPath)` 詞彙 —— **不是 `filesystem-access` 白名單的擴大**，推給 renderer 的只有分支
字串。

### 監看分支要兩層 watcher —— 兩者都反直覺（實測）

- **`git checkout` 是寫 `HEAD.lock` 再 rename 上去**，HEAD 的 inode 每次都變。這正是「暫存檔 +
  改名」模式，直覺會認為監看單一檔案的 watcher 第一次就失聯 —— **但 chokidar 撐得住**（會在 rename
  後重新 attach，連續切三次分支三次都收到 `change`）。所以**監看單一檔案即可**，不必退而監看整個
  `.git/`（那會被 `index.lock`、`refs/`、object 寫入的事件淹沒）。
- **但監看一個「尚不存在」的 `.git/HEAD` 是行不通的** —— `git init` 之後 800ms 內收不到任何事件
  （連父目錄都不存在，chokidar 無從 attach）。因此**第一層**監看 folder 根目錄（恆常存在，`depth: 0`，
  以 basename `.git` 過濾），用來等 `.git` 出現或消失，再據以建立／銷毀**第二層**（HEAD 檔案）。

> **`probe:shell` 的白名單守衛一度漏掉整個 `folders.*` namespace**（它只檢查 `fs.*` 與
> `openspec.*`）—— 於是往 folders 加 method 不會被任何東西擋下。那是守衛的漏洞，不是許可，已補上。
>
> **而 `probe:workspace` 曾以那顆 `◈` 指示鈕來識別 rail 的每一列** —— `◈` 一移除，rail 的列數就
> 變成 0，五條斷言連帶全紅，看起來像「rail 壞了」。**探針的斷言會隨規格過期**（同 Phase 5 的
> `probe:shell` 教訓）。

## 檔案系統邊界（`multi-folder-workspace-shell` 起）

renderer 以 `(folderId, relPath)` 定址檔案系統，**永遠不傳絕對路徑** —— 它沒有詞彙可以表達
workspace 之外的位置。邊界檢查一律在**主行程**執行；preload 與 renderer 同屬一個行程樹，
在那裡檢查等同沒有檢查。

- **包含關係一律用 `path.relative(root, target)` 判定，絕不用 `target.startsWith(root)`。**
  前綴比對會把 `/a/bc` 誤判為位於 `/a/b` 之內。`src/main/fs-boundary.test.ts` 有一條測試就是
  為了讓這個寫法必定失敗；不要「簡化」掉它。
- **symlink 必須在比對之前解析**（root 與 target 兩端都要 `realpath`）。只看字面路徑會漏掉
  「folder 內的 symlink 指向 folder 外」。
- **讀取路徑（`resolveWithinRoot`）與寫入路徑（`openExistingForWrite` / `resolveNewWithin`）
  分家，不可混用。** 讀取回傳一個路徑，呼叫端拿去 `open`；寫入若沿用這個「檢查完再依原路徑
  開啟」，已實測會逸出邊界（check 與 open 之間 leaf 被換成越界 symlink）。寫入必須解析與開啟
  不可分割：對 `realpath` 的結果、帶 `O_NOFOLLOW` 開啟。
- **TOCTOU 與 hard link：Phase 3 起以威脅模型承擔，不是機制性防護。** Node 沒有 `openat`，
  `O_NOFOLLOW` 只約束路徑最後一段，中間目錄段的 race 防不住。關鍵在**白名單不暴露 `symlink()`、
  寫入的 leaf 檢查一律用 `realpath`（不是 `lstat`）** —— 於是 renderer 既造不出、也操縱不到
  race 所需的 symlink。這道邊界防的仍是**被入侵或有 bug 的 renderer**，不是已拿到本機寫入權的
  攻擊者。**此結論有前提**：任何後續 change 若要暴露 `symlink()`、或把寫入 leaf 檢查改為 `lstat`
  語意，本論證即失效，必須重新論證。完整論證見 `file-editing-and-crud` 的 `design.md` D1–D8
  （`O_NOFOLLOW` 為 POSIX-only，Windows 退為 `lstat` 二次確認，且本 repo 無 Windows 實測，
  列為 Phase 6 打包驗收前必須確認的項目）。
- **原地寫入，不做「暫存檔 + 改名」。** 後者會把 folder 內的 symlink 取代成普通檔案、斷開
  hard link，並讓一次存檔在 watcher 上呈現為「刪除後新增」（已實測）。取捨見 design D5。
- **watcher 也受同一道邊界約束**：`followSymlinks: false`，且事件的絕對路徑轉成
  `(folderId, relPath)` 之前必須再過一次 `isWithin`。推給 renderer 的每一個路徑，
  都必須是 renderer 有詞彙表達的路徑。**且 app 自身的寫入不得回推為外部變更事件** —— 否則
  每次存檔都會警告使用者磁碟被改動（自寫抑制見 design D12）。

驗證「某段邏輯沒有 spawn 外部程式」時，**不要用行程樹取樣** —— 開發模式的掃描摘要本來就會
spawn 一次 `git log`（core 的 `getTimestamps`），會混淆歸屬；而 `git` 是毫秒級行程，取樣容易
漏抓。改在單元測試裡攔截 `node:child_process` 的全部入口，並加一個對照組證明攔截確實生效。
