## Context

動機見 `proposal.md` 的 Why；要求見 `specs/`。這裡只談怎麼做。

> **本 change 的四份文件刻意不寫出任何內部名稱**（公司名、內部 repo 名、同事名字）。它們封存後會進 archive，
> 而 archive 也在 `public-content-hygiene` 的檢查範圍內。需要指稱時一律說「內部名稱」；具體的對照表住在
> repo 外面（D1）。

現況中與做法有關的幾件事：

- **授權宣告散在多處**：`package.json` 的 `license`（`UNLICENSED`）與 `package-lock.json` 根項目的同一欄、README、
  CLAUDE.md、`openspec/config.yaml` 的 context、PRD。repo 沒有 `LICENSE` 檔。
- **內部名稱散在目前的檔案與全部歷史裡**：UI 雛型、PRD、程式註解、測試 fixture、一條 main spec 的 scenario 範例、
  十幾份已封存 change 的實測紀錄，以及 6 則 commit 訊息。另有同事的名字（雛型與一支 renderer 測試）、維護者的
  家目錄路徑（CLAUDE.md、`docs/lessons/terminal.md` 與歷史）。已掃過：**沒有任何真正的憑證**（gitleaks 全歷史零
  命中；環境變數只有名稱沒有值）。
- **已經有一道形狀相同的守衛**：`scripts/naming.test.mjs`（版控中不得殘留舊產品名）。它的講究 —— 禁字以字串
  組合構造、以「不排除 archive 時必須命中」當對照組、`git grep` 關掉顏色 —— 在授權守衛這裡同樣適用。
- **打包設定的 `files` 只收 `out/**` 與 `package.json`**，所以根目錄的 `LICENSE` 目前不會進產物；build 不產生
  sourcemap。
- **`probe:package` 會真的啟動 AppImage**，執行期間 AppImage 掛載在暫存目錄下的 `.mount_*`。**使用者自己正在跑
  的 Spekterm 也有一個這樣的掛載點**，所以「列出所有掛載點」分不出哪一個是這一輪的。
- **本機只有一份工作副本**（沒有其他 worktree）。遠端只剩 `master` 與兩條 PR 參照；本機另有一條過期的
  `claude/*` 追蹤參照（遠端已不存在）。
- **`git filter-repo` 已安裝。**

## Goals / Non-Goals

**Goals:**

- 公開之前，全部歷史（內容與 commit 訊息）不含內部名稱、同事名字、維護者家目錄路徑。
- 授權宣告在版控每一處一致為 MIT；產物帶著本身與第三方的授權文字。
- 兩道守衛擋住兩類內容被寫回來。

**Non-Goals:**

- **不改寫 commit 作者 email、不移除 commit 訊息裡的 session 連結**（使用者裁決）。
- **不處理 GitHub 上的 issue 內文與 PR 參照**。PR 參照裡的舊 commit 使用者已裁決可以接受；issue 內文是使用者在
  GitHub 上自己的動作（目前 #3、#7、#16、#20、#37 含內部名稱）。
- **不把 README／CLAUDE.md／CONTRIBUTING 改成英文。** repo 的文件慣例是繁體中文；要不要為開源受眾改成英文，是
  另一個決定。
- **不動 `package.json` 的 `private: true`**（理由見 proposal）。

## Decisions

### D0. 順序：先改寫歷史，再做其餘的事

**歷史改寫是 apply 的第一步**，其餘所有工作都在改寫後的歷史上進行。反過來（先做完、封存、再改寫）有三個問題：

1. **內容守衛會在改寫之前一直是紅的** —— 它不排除 archive，而 archive 裡有內部名稱。先做守衛就得先開一個
   「暫時排除 archive」的後門。
2. **目前檔案的清理會做兩次** —— 改寫本身就會把 HEAD 裡的名稱換掉，先手工清一遍是白工。
3. **本 change 的 commit 會落在舊歷史上** —— 改寫時得連它一起改，多一個出錯的地方。

先改寫的代價是：force push 在 apply 的第一步就發生，而不是在使用者測過之後。這可以接受，因為歷史改寫**不新增
任何 commit**，也不動產品行為 —— 它與「測過再封存」的慣例不衝突。**force push 之前停下等使用者批准**（D2）。

本 change 的四份文件是未追蹤檔案，改寫時不在歷史裡，原地換成新歷史（D3）也不會動到它們。

### D1. 替換對照表住在 repo 外面

對照表放在 `~/spekterm-oss/replacements.txt`（`git filter-repo --replace-text` 的格式），**不進版控** —— 對照表
本身就寫著原名。同一份檔案也餵給 `--replace-message`，commit 訊息一起換。

- **一律用字面規則，長的在前、特定的在前**：內部 repo 名（`<公司名>-<系統名>`）在前，單獨的公司名在後；環境變數名
  整個換（`<公司名>_<系統>_URL` → `TRACKER_URL`）。
- **大小寫各寫一條，不用不分大小寫的規則。** 一支測試靠「同一個名字的兩種大小寫」驗證解析不分大小寫；把兩種都換成
  同一個小寫新名字，那條測試會退化成完全相等比對，照樣綠卻測不到東西。
- **家目錄路徑換成 `/home/me`。** 要小心歷史裡有「家目錄＋舊產品名」的路徑 —— 替換只動家目錄那一段，舊產品名
  留著，`naming.test.mjs` 的 archive 對照組才不會被波及。
- **同事的名字與 handle 換成通用名**（`@alex`、`@sam`、`Alex Chen` 這一類）。
- **一條測試的鑑別力要改寫後手工補回來**：那支測試用原名的前綴與子字串驗「前綴不算命中」。原名被換掉之後，那兩個
  片段不再是新名字的前綴與子字串，測試變成對任何實作都恆綠。改寫後把兩個片段手工改成新名字的前綴與子字串
  （tasks 2.1），main spec 的對應 scenario 以 delta 更新（`specs/agent-handoff-source/`）。

### D2. 改寫在一份全新的 clone 上做，驗證通過才 force push

`git filter-repo` 只在全新 clone 上執行（在原工作副本上它會拒絕）。流程：

1. `git clone --no-local` 到 `~/spekterm-oss/rewrite/`，執行 `git filter-repo --replace-text … --replace-message …`。
2. **全歷史掃描**（`~/spekterm-oss/scan.sh`，也在 repo 外面，因為它要寫出原名）：所有 commit 的每一個 blob 與每一則
   訊息，對原名、同事名、家目錄路徑**零命中**。
   - filter-repo 會跳過前 8KB 含 NUL 的 blob。已查過歷史：唯一同時含 NUL 與內部名稱的 blob，NUL 在 8KB 之後，會被
     正常替換 —— 但**掃描不依賴這個推論**，它直接掃結果。
3. 在改寫後的 clone 上跑 `npm ci && npm test`，全綠。
4. 給使用者看：改寫前後 HEAD 的 `git diff --stat`、每一條替換規則各命中幾處、掃描結果。**停下，等使用者批准。**
5. 批准後 `git push --force origin master`（從改寫後的 clone 推，推之前重新加回 `origin`，filter-repo 會把它移除）。
   `git ls-remote` 確認遠端的 `master` 等於改寫後的 HEAD。

### D3. 本機原地換成新歷史，不搬目錄

這個工作副本同時是使用者 dogfood 中的 Spekterm folder，裡面還有正在執行的 session。**搬目錄會讓那些行程的 cwd
跟著跑到舊目錄**，所以原地替換：

1. `git fetch ~/spekterm-oss/rewrite master` → `git reset --hard FETCH_HEAD`（未追蹤的本 change 目錄保留）。
2. 刪掉過期的遠端追蹤參照（`git fetch --prune`），`git reflog expire --expire=now --all && git gc --prune=now`。
3. `git log --all` 的掃描對原名零命中 —— 證明舊物件已經不在本機，**之後的任何 push 都帶不回它們**。

**風險**：任何別處的舊 clone（例如手機版 app 的雲端 session 若是從舊歷史開的分支）一 push，就會把舊物件以新分支
的形式帶回 GitHub。改寫後告知使用者：舊 clone 一律作廢。

### D4. 引用 commit 識別碼的文件依對照表更新

改寫後所有 commit 識別碼都變了。filter-repo 會自動改寫 commit 訊息裡的舊識別碼，但**不改檔案內容**。repo 內有 15 處
引用 7 個識別碼（1 處在 `docs/lessons/terminal.md`，14 處在 archive）。依 filter-repo 產出的
`.git/filter-repo/commit-map` 把它們換成新識別碼（tasks 2.2）。這是本 change 唯一改動 archive 內容的地方 —— 改的是
「指向哪個 commit」，不是歷史紀錄的內容，而不改的話它們全部指向不存在的東西。

### D5. 授權守衛：`scripts/license.test.mjs`

照 `naming.test.mjs` 的形狀，加上 review 抓到的四點：

- **檢查範圍含未追蹤檔案**（`git grep --untracked`，它尊重 `.gitignore`）。這同時解掉「規格檔還沒 `git add` 時
  對照組會紅」的順序問題。
- **排除恰為 spec 宣告的三處**，並有一條靜態斷言釘住排除清單 —— 最自然的「修法」是再加一條排除，而那就是後門。
- **禁字不分大小寫**（`git grep -i --fixed-strings`），以字串組合構造，測試檔自己不含字面。
- **逐字對照**：禁字清單**從規則定義處解析出來**（封存前是本 change 目錄裡的規格，封存後是 main spec，取存在的那
  一份），與測試裡構造的清單比對，再逐字搜尋規則定義處必須命中。這讓兩份清單不會各自漂移，也證明每一個禁字的
  搜尋都真的有效。只靠 archive 當對照組不夠：archive 裡只有部分禁字。
- **archive 對照**：不排除 archive 時至少一個禁字命中 archive。

**禁字清單的取捨**：

- **納入「私有 repo」這個片語，不納入「私有」這個詞** —— 後者有合法用途（「私有 bus」）。
- **不納入「商業授權」** —— PRD 的競品分析寫別家產品的授權時需要這個詞，守衛分不出「宣告自己」與「描述別人」。
  改由 tasks 2.4 人工把關 PRD 裡描述 spekterm 自己的說法。
- **`UNLICENSED` 留著**：依賴一個 `UNLICENSED` 的套件就不能以 MIT 散布產物，那正是要被發現的事（review 已確認
  目前出貨的依賴樹沒有）。

同一支測試也驗 `project-license` 的其餘靜態 scenario（`LICENSE`、`package.json`、README、`CONTRIBUTING.md`、
`FUNDING.yml`）。**測試名與覆蓋表的 mutation 描述都避開禁字**（review：覆蓋表會逐字寫出 scenario 標題與 mutation，
而它不在排除範圍內）。

### D6. 內容守衛：`scripts/public-hygiene.test.mjs`

- **範圍**：`git ls-files -co --exclude-standard`（追蹤＋未追蹤但未被忽略），**不排除任何路徑**。前 8KB 含 NUL 的
  檔案視為二進位（圖片），跳過 —— 文字檔裡的 NUL 已由 `nul-byte-source.test.mjs` 擋住。
- **切詞**：轉小寫，依 `[^a-z0-9]+` 切開。每個字詞算 SHA-256，與清單比對。
- **清單**：寫在測試檔裡的十六進位雜湊陣列。**這不是密碼學上的保密** —— 短字詞的雜湊猜得出來；它要做到的是
  「repo 不主動寫出這些名字」，而不是「沒有人能知道」。
- **對照組**：產品名 `spekterm` 的雜湊必須命中，證明切詞與雜湊流程真的有在比對。
- **家目錄路徑**：以字串組合構造維護者的家目錄路徑，`--fixed-strings` 搜尋。使用者名稱本身是公開帳號，不在
  清單內。
- **不在清單裡的字**：內部系統用的公開產品名（例如 issue tracker 的產品名）不列 —— 它不是識別資訊，列了會誤擋。

### D7. `LICENSE` 與第三方授權彙總放進產物根目錄

**`extraFiles`**（產物根目錄，與執行檔、`LICENSE.electron.txt` 並列）。不選 asar 內（打開產物的人看不到），也不選
`resources/`（與 Electron 自己的授權檔不在同一層）。

**第三方授權彙總**（`THIRD_PARTY_LICENSES.txt`）由建置產生：

- **被打進 bundle 的套件**：`electron.vite.config.ts` 裡一個小 plugin，在 main、preload、renderer 三個 build 的
  `generateBundle` 收集 `this.getModuleIds()`，把 `node_modules/` 之下的路徑對應到套件根目錄（含 scoped 與巢狀
  `node_modules`），寫成 `out/licenses/<target>.json`。**用建置工具自己的模組清單**，而不是用依賴宣告去推 ——
  devDependencies 裡哪些真的被打進去，只有 bundler 知道。
- **原樣出貨的依賴**：`package-lock.json` 裡非 `dev` 的項目（electron-builder 帶進 asar 的就是這一組）。
- **內嵌的第三方原始碼**（實作時發現）：`monaco-editor` 把 DOMPurify 的原始碼直接放在自己的樹裡，它在
  `node_modules` 裡不是獨立套件，Monaco 自己的 `ThirdPartyNotices.txt` 也沒列它；它的授權只寫在原始檔開頭的
  `/*! @license ... */`，而**打包會剝掉這段註解**（實測 renderer 產物裡一個 `@license` 都不剩）。因此收集端也從
  每一個被打包的原始檔收回標明授權的保留註解（`/*!`、`@license`、`@preserve`），依內容去重後附在彙總最後；
  套件層級則連同 `ThirdPartyNotices` 這類聲明檔一起帶上。
- **合併**：`npm run build` 之後接一支 `scripts/third-party-licenses.mjs`，讀上面兩組、讀每個套件的 `package.json`
  與 `LICENSE*`／`LICENCE*`／`COPYING*` 檔，輸出彙總。沒有授權檔的套件列出它宣告的授權識別並註明未附全文。
  把「路徑 → 套件」與「套件 → 彙總條目」寫成純函式，給單元測試。
- **獨立交叉檢查**（tasks 4.3）：以開了 sourcemap 的一次性建置，從 sourcemap 的 `sources` 獨立列出 bundle 裡的套件，
  確認每一個都在彙總裡。這是 spec「彙總涵蓋每一個被打包的套件」的載體 —— 只用 plugin 自己的輸出去驗 plugin，
  驗不出它漏收了什麼。

**驗證走 `probe:package`**：**從被啟動行程的 `/proc/<pid>/environ` 讀 `APPDIR`**，不列舉掛載點 —— 使用者自己的
Spekterm 也有一個掛載點，列舉會抓錯（現在會誤紅；使用者裝上新版後則變成假綠）。斷言：`APPDIR/LICENSE` 與版控
逐位元組相同；`APPDIR/THIRD_PARTY_LICENSES.txt` 含 spec 點名的五個套件，各帶授權全文。

**迭代時的建置**（review 抓到的兩點）：

- 不換版的建置一律輸出到 scratch 目錄（`npx electron-builder --linux -c.directories.output=<scratch>`），**不碰
  `release/`** —— 否則會蓋掉正式的同版號產物，`install:desktop` 會裝到測試產物。`--appimage-extract` 也在 scratch
  目錄執行，免得在 repo 根目錄留下 `squashfs-root/` 被 `eslint .` 掃到。
- 走 `PROBE_PACKAGE_APPIMAGE` 時，探針「最新 commit 是 `chore(release): <版本>`」那條斷言**預期是紅的**（沒走
  `dist:linux`）。迭代的驗收標準是「新斷言綠、換版斷言照預期紅、其餘全綠」。
- **完整的 `npm run probe:package` 在封存時跑**（使用者裁決）：先 commit 本 change，再跑它 —— 換版腳本要求
  `package.json` 沒有未提交的變更。這一次同時讓 About 顯示的 commit 回到改寫後的歷史上。

### D8. 文件改寫的口徑

- **README**：開頭不再自稱商業版；授權段寫 MIT 並指向 `LICENSE`；「現況」段更新（它停在「handoff 尚未開始」，
  而它是開源後的門面）。沿用同一個 repo，程式碼裡的 issue 編號照舊有效，不必另外註明。
- **CLAUDE.md**：兩處改成「開源（MIT）、獨立的 repo」，保留「不是 spek monorepo 的 npm workspace 成員」（依賴關係
  的事實）。
- **PRD**：§1 授權句；§10 改名為「商業模式（已裁決：MIT 開源，不做付費層）」，§10.1 原規劃保留作為歷史但授權那
  一行避開禁字，§10.3 記下裁決；§14 策略問題標為已裁決；§5 的 F9、§11 的 Phase 8+ 標為已裁決不做；§2 競品表、
  SWOT 與其他描述 spekterm 自己為「封閉、付費、私有」的說法改寫（review 列了四處，它們不含禁字，守衛看不到）。
- **`openspec/config.yaml`**：context 改成 MIT 開源；Status 更新為現況（它還停在 Phase 4，而這段會被餵給每一次
  `openspec instructions`）。
- **`package.json`**：補 `author`（`Kewang`）、`repository`、`homepage`。之後出 macOS／Windows 產物時，
  electron-builder 的 `copyright` 預設值由 `author` 推導。

### D9. `CONTRIBUTING.md` 與 `FUNDING.yml`

- `CONTRIBUTING.md` 繁體中文，三件事：貢獻依 MIT 提供、贊助歸維護者且不依貢獻分配、開發流程指向 CLAUDE.md 與
  OpenSpec 工作流程。**不寫 CLA、不要求 DCO** —— 以這個規模沒有對應的風險；GitHub 服務條款 D.6 的 inbound =
  outbound 已涵蓋授權。
- `FUNDING.yml` 只寫 `github: [kewang]`。

### D11. 遞增層級以環境變數指定

第一個公開版本是 0.2.0（使用者裁決），而 `release-bump.mjs` 寫死 `npm version patch`。

- **用環境變數 `RELEASE_LEVEL`，不用命令列引數。** `dist:linux` 是 `release-bump && build && electron-builder &&
  prune-release`，`npm run dist:linux -- minor` 會把 `minor` 接在 `prune-release` 後面。另開一條
  `dist:linux:minor` 也可以，但層級有三種，而 `probe:package` 的入口也要能帶上它 —— 環境變數會一路傳下去。
- **`argv[2]` 維持是 repo 根的覆寫**（檔頭說明它是承重的：測試以它指向暫存的 git fixture）。
- **不認得的值在動手之前就失敗**，與既有的「版本宣告檔案已被修改時拒絕打包」同一個位置。
- 封存時的完整打包：`RELEASE_LEVEL=minor npm run probe:package`，產出 `Spekterm-0.2.0.AppImage`。

### D10. scenario 覆蓋表

`open-source-mit` 登記進 `COVERED_CHANGES`。載體：`project-license` 的靜態 scenario 與 `public-content-hygiene` 的
前兩條 → 兩支守衛的對應斷言；產物那三條 → `probe:package` 的新斷言與 tasks 4.3 的交叉檢查；「全歷史零命中」→ D2 的
掃描（repo 外的腳本，**在表上註明它的載體不在 repo 裡、只在公開前執行一次**）；`agent-handoff-source` 修改的兩條
→ `handoff-target.test.ts` 的對應斷言。

## Risks / Trade-offs

- **[force push 不可逆，而且發生在 apply 的第一步]** → D2 的四道驗證（全歷史掃描、npm test、前後 diff、規則命中數）
  全部過了才停下請使用者批准；批准之前沒有任何東西離開本機。
- **[對照表漏了某個名稱]** → 全歷史掃描是 gate，掃描用的是原名清單而不是對照表本身，漏掉的規則會以「掃描有命中」
  的形式浮現。
- **[PR 參照裡的舊 commit 仍可憑識別碼在 GitHub 上打開]** → 使用者已裁決接受。
- **[舊 clone 一 push 就把舊物件帶回來]** → D3 的告知；本機的舊物件以 gc 清掉。
- **[內容守衛的雜湊猜得出來]** → 見 D6，它的目標不是保密。
- **[禁字清單不含「商業授權」與「私有」]** → 見 D5，改由人工把關那兩個詞的自我描述。
- **[已安裝的舊產物 About 顯示的 commit 查不到]** → 封存時的完整打包（D7）重新產出一份。
