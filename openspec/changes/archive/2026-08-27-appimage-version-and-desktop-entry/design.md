## Context

動機見 `proposal.md`。此處只記與作法有關的現況：

- `dist:linux` 目前是 `npm run build && electron-builder --linux`，`version` 從未被動過，
  產物檔名恆為 `Spekterm-0.1.0.AppImage`（electron-builder 的預設 `artifactName` 即含 `${version}`，
  **不必新增設定就已滿足「檔名帶版本」**）。
- **`probe:package` 的入口就是 `npm run dist:linux && node scripts/run-probe.mjs package`** ——
  遞增與提交一旦掛進 `dist:linux`，跑一次 probe 就會產生一個 commit。這是本設計最大的副作用。
- Settings 對話框（`TerminalFontDialog.tsx`）已經不是純粹的「終端偏好」：agent status 開關就住在
  那裡。**而那次擴張是對 `terminal-preferences` 下 delta 完成的** —— 主 spec 第 147 行的
  「偏好包含是否啟用 agent 狀態橋接」即出自 `2026-07-21-panel-drive-and-shell-affordances`，
  該 change 的 proposal 把 `terminal-preferences` 列為 Modified Capability。
  **本 change 沿用的是這條慣例**（此處初版寫成了相反的敘述，已更正）。
- 該對話框的標題文案是 **`Terminal`**（`en.json` 的 `settings.title`），不是 `Settings`。
- 探針以 `role` ＋ `aria-label` 定位元素，兩者皆自 `src/shared/i18n/en.json` 取字串
  （`scripts/lib/copy.mjs`）。新增的區段必須遵守，否則探針定位不到。

## Goals / Non-Goals

**Goals:**

- 版本的遞增、提交、注入、呈現構成**一條沒有人工步驟的鏈**，且鏈上每一環的失效都是有聲的。
- 建置身分的**產生**與**消費**分離，使產生端可在秒級單元測試中以真實的 git fixture 驗證 ——
  而不必為了驗一個字串格式去跑一次十分鐘的打包。
- 桌面整合的驗收不倚賴「作者這台機器的 `~/.local/share`」。

**Non-Goals:**

- 不做發佈流程（tag、changelog、release notes、自動更新）。本設計刻意**不打 tag**。
- 不碰 `productName` / `appId` / userData（`app-identity` 已凍結）。
- 不處理 macOS／Windows 的桌面整合 —— 那兩個平台連產物都還沒有。
- 不改應用程式圖示的內容（issue #14）；安裝腳本沿用 `build/icon.png`。

## Decisions

### D1：建置身分經 vite `define` 注入，不經 IPC、不新增 preload 白名單

`electron.vite.config.ts` 於**設定載入時**計算一次建置身分，以 `define` 注入 renderer bundle。

- **替代方案：主行程取得 → IPC → renderer。** 否決的理由是它要為一個**唯讀、恆定、無邊界語意**
  的值新增一條 preload 白名單。白名單是本專案的信任邊界（`filesystem-access`），每加一項都是
  永久成本；而這個值裡沒有路徑、沒有使用者資料，經 bundle 交付與經 IPC 交付在安全性上完全等價。
- **替代方案：建置前產生 `src/shared/build-info.json`。** 否決：那個檔案要嘛進版控（每次打包都
  弄髒工作副本 —— 而「工作副本乾淨與否」正是我們要如實回報的東西，自己弄髒它是荒謬的），
  要嘛進 `.gitignore`（那 dev 與單元測試都得處理它不存在的情況）。
- **消費端集中於單一模組** `src/renderer/src/build-info.ts`，其中 `declare const __BUILD_INFO__`。
  define 若沒生效，該模組載入即 `ReferenceError`，**app 開不起來** —— 這是刻意的：一個「注入
  失敗就顯示空白」的設計，其失效方式正是本 change 要消滅的那種。
- **它不可以放在 `src/shared/`。** 那個目錄的契約是「main 與 renderer 都解析得到」（`@shared`
  alias 同時掛在 main / preload / renderer），而 define **只注入 renderer**。一個帶
  `declare const` 的模組住在那裡是一把上了膛的槍：日後任何 main／preload 的 import
  **型別檢查會過、bundle 會過**，執行期 `ReferenceError` 打死主行程 —— 而主行程一死，
  所有 pty 陪葬。
- **`declare const` 讓 typecheck 對「注入被拿掉」完全無感**，唯一的偵測時機會是使用者啟動 app。
  因此另補一道秒級守衛，斷言 `electron.vite.config.ts` 的 renderer `define` 宣告了
  `__BUILD_INFO__`。

### D2：dev 與 build 的身分由 vite 的 `command` 分岔，**不由 `app.isPackaged`**

`defineConfig(({ command }) => …)`：`serve` ⇒ 開發身分，`build` ⇒ 完整建置身分。

這與 CSP 那條「切換依 `ELECTRON_RENDERER_URL` 的存在，不是 `app.isPackaged`」**是同一個教訓的
另一面**，但理由不同：CSP 那條怕的是「未打包但載入 build 產物」誤發 dev 政策；這裡則是
`app.isPackaged` **根本問不到** —— 身分要在建置當下固定（spec：不隨執行環境改變），而
`app.isPackaged` 是執行期的值。`command` 是唯一在正確時點就已知的判準。

### D3：產生端是一支獨立腳本，接受 repo 根為參數

`scripts/lib/build-info.mjs` 導出一個函式：給定 repo 根與版本，回傳建置身分物件
（`version` / `builtAt` / `commit` / `dirty`）。`electron.vite.config.ts` 呼叫它。

**參數化 repo 根是承重的，不是彈性。** 「工作副本不乾淨時標示之」與它的對照組「乾淨時不標示」
—— 這一對只有在測試能**自己造出**一個乾淨與一個不乾淨的 git 工作副本時才驗得到。寫死
`process.cwd()` 的話，那兩條的載體就只剩「在本 repo 當下的狀態跑一次」，而那**不是對照組**。

`dirty` 的判定用 `git status --porcelain`（**空輸出即乾淨**）。注意本 repo 的既有教訓：
比對 git 輸出一律 `--no-color`；`--porcelain` 本身即不上色，但 spawn 時仍設 `LC_ALL=C`
（錯誤訊息會被在地化，這台機器的 git 講繁中）。

### D4：遞增與提交是另一支獨立腳本，且**先拒絕再動手**

`scripts/release-bump.mjs`，`dist:linux` 的第一步。順序：

1. **檢查 `package.json` 自身是否已被修改** —— 是的話**立刻中止**，不遞增、不提交。
   這是 spec 那條「拒絕打包」的唯一實作方式：遞增與使用者的編輯落在同一個檔案裡，
   一次提交必然把兩者一起帶走，**提交範圍解決不了它**。
2. `npm version patch --no-git-tag-version` —— **不能用 `npm version patch` 的預設行為**：
   它自己會 commit ＋ tag，而且**在工作副本不乾淨時直接失敗**（`Git working directory not clean`，
   已實測；`--no-git-tag-version` 一併豁免該檢查，亦已實測）。帶著未提交的編輯去打包在 dogfood
   期間是常態，沿用預設等於讓打包指令在最常見的情況下拒絕執行。
3. `git commit package.json package-lock.json -m "chore(release): <version>"` ——
   **指名檔案，絕不 `-a`**。
4. 版控不可用／提交被拒 ⇒ 明確報告並以非零碼結束。**detached HEAD 要主動偵測**
   （`git symbolic-ref -q HEAD`），不能只看 `git commit` 的結束碼 —— 實測 detached HEAD 下
   `git commit` **exit 0**，commit 落在一個 dangling 的位置上。而那正是本條 requirement 的理由
   （「下一次 `git checkout` 就會讓它消失」）所描述的情況：只看結束碼的實作會**靜默通過**。

**`package-lock.json` 必須一起提交，這一條是承重的。** 它在版控中，而 `npm version` 會一併改寫
它（實測：`git diff --numstat` 顯示 `package-lock.json` 2 行、`package.json` 1 行）。漏掉它的話
它會永遠留在工作副本裡未提交 ⇒ 隨後 D3 算 `dirty` 時 `git status --porcelain` 必然非空 ⇒
**每一份產物都被標為 dirty**，而〈工作副本乾淨時不標示〉在真實流程中永遠不成立。
更糟的是**單元 fixture 若沒有 lockfile，那條對照組會全綠** —— 這是本 repo 記載過的假綠形狀。
步驟 1 的拒絕檢查同樣涵蓋兩個檔案。

**取捨：commit 在 build 之前。** 於是建置身分裡的 commit 就是那個換版提交本身，它所含的
`package.json` 版本與產物宣稱的版本是同一個 —— 自我一致。代價是建置隨後失敗時版本白跳一格
（spec 已明訂接受）。

### D5：選檔一律以「當前宣告的版本」建構檔名，不用排序

`install:desktop` 與 `probe-package.mjs` 的 `findAppImage()` 都要在 `release/` 裡挑一份產物。
**現行的 `.sort().at(-1)` 在版本遞增之後就是錯的** —— 字典序不是版本序（`0.1.9` 排在 `0.1.10`
之後）。改為讀 `package.json` 的 `version` 直接建構期望的檔名，找不到就明確失敗。

- **替代方案：挑 mtime 最新的。** 否決：它回答的是「哪一個最近被寫」，而規格在乎的是「哪一個
  對應當前宣告的版本」。這正是 CLAUDE.md 那條「一個方便取得、看起來相關的量，不等於規格真正
  在乎的那個量」——已經咬過四次。
- `PROBE_PACKAGE_APPIMAGE` 的覆寫維持不變（迭代逃生口）。

**同一條套用到產物清理，而初版漏了它。** 清理要判定「哪兩份最近」，若以檔名字典序排序，
`Spekterm-0.1.10` 會排在 `Spekterm-0.1.8` **之前** ⇒ **剛建好的那一份成為被刪的那一份**。
以逐次遞增計，第十次打包就會發生。因此 **選檔與清理共用同一個 semver 比較函式**（解析出
major/minor/patch 三個數字後逐段比大小），SHALL NOT 各自用字串排序。

**而這個 bug 的對照組必須跨十位數才有鑑別力**：`0.1.1`–`0.1.4` 這種 fixture 下字典序與版本序
結果完全相同，一個字典序的實作照樣全綠。fixture 一律用 `0.1.8` / `0.1.9` / `0.1.10` / `0.1.11`。

### D6：桌面整合寫三個檔案，位置全部經 XDG 環境變數解析

| 檔案 | 位置 |
|---|---|
| 產物 | `$XDG_BIN_HOME`（缺省 `~/.local/bin`）`/Spekterm.AppImage` |
| 桌面項目 | `$XDG_DATA_HOME`（缺省 `~/.local/share`）`/applications/spekterm.desktop` |
| 圖示 | `$XDG_DATA_HOME/icons/hicolor/512x512/apps/spekterm.png` |

**產物的檔名不帶版本**，這正是「執行目標不隨版本改變」那條 requirement 的實作 —— 換版只是覆蓋
它，桌面項目一個字都不必改。

**經環境變數解析是驗收的前提，不是可攜性的裝飾**：單元測試把 `HOME` 與 `XDG_*` 指向暫存目錄，
就能完整驗證安裝、重複安裝、移除、產物不存在時的失敗 —— 全部在秒級，且不碰作者真正的桌面環境。
寫死 `~/.local/share` 的話，這一整組 scenario 就只剩人工驗收。

`Icon=` 用**絕對路徑**指向已安裝的圖示，不用 hicolor 的圖示名。理由是可驗收性：「指向一個實際
存在的檔案」是一條讀得到的斷言，而圖示名要對就得依賴 `gtk-update-icon-cache` 與主題查找，
那條路失敗時**沒有任何訊息**，選單只會安靜地顯示一個預設齒輪。代價是放棄多解析度 —— 而我們
本來就只有一張 512×512。

`StartupWMClass=Spekterm` 必須寫入（否則執行中的視窗不會與選單圖示歸為一組）。它的值是
`productName`，而那個值**已凍結**（`app-identity`），不會漂移。

**安裝不得就地覆寫產物** —— 作業系統拒絕覆寫一個執行中的可執行檔（實測：`cp` 對執行中的檔案
回 `ETXTBSY`）。而「一邊用著手上這份、一邊重新打包再裝上去」正是換版流程本身，**這是常態不是
邊緣情況**。作法是寫到同目錄的暫存名再 `rename()` 覆蓋（Linux 允許 rename 覆蓋執行中的檔案，
既有行程續用舊 inode 跑完）。

**判定失敗要看 `errno`（`ETXTBSY` / `EBUSY`），不得比對錯誤訊息** —— 這台機器的訊息是在地化的
（實測回「文字檔忙錄中」）。與既有的 `LC_ALL=C` 那條同族。

### D7：「關於」段放進既有的 Settings 對話框，不新增入口

沿用 agent status 開關的先例（見 Context）。段落以 `<section role="group" aria-label={t(...)}>`
呈現，字串來自字典 —— 那同時是探針的定位手段。**值本身（版本、commit、時刻）不進字典**，
它們是資料不是文案；進字典的只有標籤。

`aria-label` 的文案避開單引號、雙引號、反引號（探針的選擇器是用字串拼的，實測被咬過一次）。

### D8：開發身分的驗收載體是 `probe:files` 的 dev 段，不是 `probe:workspace`

〈開發模式的身分可與打包產物區分〉需要一個**真的以 `command === 'serve'` 建置的 renderer**。

**`probe:workspace` 提供不了它** —— 它只有一種啟動路徑（`npm run build` 之後 `electron .`），
全檔 `grep ELECTRON_RENDERER_URL` 零命中。依 D2，它拿到的一律是完整建置身分。把這條斷言掛在
那裡，結局只有兩種：它紅，或者被「修好」成一個不驗 dev 的判準（假綠）。

**`probe:files` 提供得了** —— 它自己起 `electron-vite dev --rendererOnly` 並以
`ELECTRON_RENDERER_URL` 指過去，renderer 因此來自 dev server。而 `define` 純粹是 renderer 側的
注入，`--rendererOnly` 已經足夠。代價是要在該支新增一條「開 Settings 讀關於段」的路徑（它目前
不碰活動列）。

**替代方案：降級為 dogfood 認定**（像 7.3a 那樣自陳）。否決：dev 模式的建置身分是**每天都看得到**
的東西，不是虛擬螢幕驗不到的畫素問題 —— 它有真載體可用時不該推給人。

## Risks / Trade-offs

- **每跑一次 `probe:package` 就產生一個 commit** → 該探針的定位本來就是「換版前跑一次」，
  一次打包＝一個換版，語意一致。迭代時走 `PROBE_PACKAGE_APPIMAGE=<path> node scripts/run-probe.mjs package`
  重用既有產物，完全不經 `dist:linux`。**這條逃生口要寫進 CLAUDE.md**，否則下一個人會在調
  probe 的過程中堆出十幾個 commit。
- **`package.json` 被改過就不能打包** → 這是刻意的拒絕，但它會在一個意外的時機咬人（升完依賴
  想立刻打包）。訊息必須直接說出處置（「先提交或還原 `package.json`」），不能只說「working
  directory not clean」——那正是 `npm version` 那句沒人看得懂的話。
- **刪除舊產物**（`desktop-packaging` 新增的那條）→ 只比對本專案自己的產物檔名形態，且保留前
  一份。風險在於「本專案的產物」這個判定寫鬆了會誤刪 —— 因此以 `Spekterm-*.AppImage` 這個確定
  的形態比對，不用萬用的 `*.AppImage`。**排序錯了的風險見 D5**（那才是這條真正會咬人的地方）。
  順帶一提，`release/` 真正的空間大戶是 `linux-unpacked`（實測 330 MB，AppImage 各 126 MB），
  而它每次被覆蓋、不受這條約束 —— **這條處理的是較小的那一半**，不要把它讀成「磁碟問題解決了」。
- **每次打包一個 `chore(release)` commit 會進 `git log`** → 使用者的 `standup` skill 以 commit
  作者過濾，這些會混進去。不致命，但要在 CLAUDE.md 寫明它們是什麼。
- **`define` 注入的值進了 renderer bundle** → 其中含 commit 與建置時刻。renderer 渲染不受信任
  的內容（使用者 repo 的 markdown），但這些值本身不是祕密，且 CSP 已擋掉外送的路徑
  （`script-src 'self'`、`connect-src` 無外部來源）。無新增風險。
- **開發模式下改 `electron.vite.config.ts` 不會熱套用** → 與既有教訓同族（改 preload／主行程
  要重啟 dev）。調身分格式時記得重啟，否則會對著舊值困惑。
- **XDG 的三個變數在不同桌面環境下未必都有設** → 一律以 freedesktop 的缺省值回退，
  且 `XDG_BIN_HOME` 實際上不是 freedesktop 正式標準的一員（只有 `~/.local/bin` 是慣例）——
  仍支援它是為了讓測試可以指向暫存目錄，這一點在腳本註解裡要寫明，免得被讀成標準。

## Migration Plan

無資料遷移。既有使用者的 userData 不受影響（`app-identity` 未變）。

**唯一的一次性動作**：`release/` 裡現存的 `Spekterm-0.1.0.AppImage` 與手工的
`Spekterm-0.1.0.AppImage.prev` —— 後者是本 change 要取代的那個權宜作法，交付後可刪
（`.prev` 不以 `.AppImage` 結尾，清理不會誤傷它）。第一次跑新的 `dist:linux` 會把版本推到
`0.1.1`。

**第一次執行前工作副本必須乾淨**：本 change 自己會動到 `package.json`（新增 script），
而 D4 步驟 1 正是「`package.json` 已被修改就拒絕」—— 先把本 change 提交完，再跑第一次
`dist:linux`。
