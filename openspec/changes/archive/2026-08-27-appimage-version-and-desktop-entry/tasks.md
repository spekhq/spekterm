> **每一條 scenario 都要指名載體。** 下面每個「驗收」任務的括號裡寫的是它承載哪幾條 scenario；
> 沒有任何一條 scenario 被留在「以後再說」。**填這張表時要真的把斷言寫出來**——本 repo 已經有
> 一次「對照表做了，填表的方式錯了」的紀錄（`rail-pinned-repos`，39 條裡 4 條是假的）。
>
> **scenario 名稱在此逐字引用，不改寫、不斷行**，如此這張表可以機械核對：
>
> ```bash
> grep -h '^#### Scenario:' specs/*/spec.md | sed 's/#### Scenario: //' \
>   | while IFS= read -r s; do grep -qF "$s" tasks.md || echo "MISS $s"; done
> ```
>
> 這條指令**必須零輸出** —— **`specs/terminal-preferences/` 除外**，理由見下。一張核不動的
> 對照表，就是會被憑印象填的那一張。
>
> **MODIFIED 的 delta 必須逐字複製整條 requirement，於是它會帶進一批不屬於本 change 的既有
> scenario。** `terminal-preferences` 的 delta 有六條，其中**只有一條是新增的**
> （〈介面涵蓋終端偏好以外的區段〉，載體見 4.5）。其餘五條**已逐條核對過既有載體**，不是憑
> 印象填的：
>
> | 既有 scenario | 載體 |
> |---|---|
> | 開啟終端偏好設定介面 | `probe-workspace.mjs:575` |
> | 字型 family 自系統的等寬字型清單選取 | `probe-workspace.mjs:600` |
> | 預覽隨選取即時更新 | `probe-workspace.mjs:627` |
> | 預覽不含框線字元 | `probe-workspace.mjs:566`（box-drawing 的 regex） |
> | 設定介面開啟時抑制導航快捷鍵 | `probe-keyboard.mjs:247` 的 `SUPPRESSORS` |
>
> 本 change 不改動這五條的行為，因此不需新增載體 —— **但它們的載體會被 4.1 的標題文案改動
> 打到**，回歸見 4.4。

## 1. 建置身分的產生端

- [x] 1.1 新增 `scripts/lib/build-info.mjs`：導出一個函式，接受 **repo 根與版本為參數**，回傳
      `{ version, builtAt, commit, dirty }`。`dirty` 以 `git status --porcelain` 空輸出判定；
      spawn git 時設 `LC_ALL=C`（錯誤訊息會被在地化，本機 git 講繁中）。驗證：`node -e` 對本
      repo 呼叫它，四個欄位皆有值
- [x] 1.2 同檔導出開發模式的身分（明確標示 development，**不含 `builtAt`** —— 不冒充建置時刻）。
      驗證：兩種身分可由型別／欄位區分，不需讀值就分得出來
- [x] 1.3 同檔導出 **semver 比較函式**（解析 major/minor/patch 後逐段比大小），供選檔與清理
      **共用**（D5）。驗證：`0.1.10` 比 `0.1.9` 大 —— 字典序在此相反

## 2. 遞增與提交

- [x] 2.1 新增 `scripts/release-bump.mjs`：依序做 (a) **`package.json` 或 `package-lock.json`
      任一已被修改則中止**並印出處置（「先提交或還原它們」）、(b) `npm version patch
      --no-git-tag-version`、(c) `git commit package.json package-lock.json -m
      "chore(release): <version>"`（**指名檔案，不得 `-a`**）、(d) 版控不可用或提交被拒則明確
      報告並以非零碼結束，**detached HEAD 以 `git symbolic-ref -q HEAD` 主動偵測**（實測
      detached HEAD 下 `git commit` 會 exit 0）。驗證：於暫存 git repo 手動跑一次，版本遞增
      且 `git status --porcelain` 為空
- [x] 2.2 `dist:linux` 改為 `node scripts/release-bump.mjs && npm run build && electron-builder
      --linux && node scripts/prune-release.mjs`（清理是**第四步**，必須在 electron-builder
      之後）。驗證：`npm run dist:linux` 走完後 `git log -1` 為 `chore(release): <新版本>`、
      `package.json` 的 version 等於該版本、且工作副本沒有殘留的版本宣告變更

## 3. 注入與消費

- [x] 3.1 `electron.vite.config.ts` 改為函式形式 `defineConfig(({ command }) => …)`，於 renderer
      的 `define` 注入 `__BUILD_INFO__`：`command === 'serve'` 用開發身分，否則用完整建置身分。
      驗證：`npm run build` 後於產物中搜得到注入的 commit 值
- [x] 3.2 新增 **`src/renderer/src/build-info.ts`**（**不可放 `src/shared/`** —— 那個目錄的契約是
      main 也解析得到，而 define 只注入 renderer，見 design D1）：`declare const __BUILD_INFO__`，
      導出型別化的值，**不提供缺席時的 fallback**。驗證：`npm run typecheck` 通過
- [x] 3.3 確認**不**新增任何 preload 白名單項目與 IPC 通道（D1）。驗證：`git diff` 於
      `src/preload/` 與 IPC 註冊處零改動

## 4. 「關於」段

- [x] 4.1 `src/shared/i18n/en.json` 新增「關於」段的標籤（段落名、版本、建置時刻、commit、
      未提交變更、開發模式），並**把 `settings.title` 從 `Terminal` 改為涵蓋實際範圍的字串**
      （`terminal-preferences` 的 delta 已要求標題反映範圍）。**值本身不進字典**（資料不是文案）。
      `aria-label` 文案避開單引號、雙引號、反引號（探針的選擇器是字串拼的）。驗證：`npm test`
      的 `i18n-key-safety` 與 `copy-language` 通過
- [x] 4.2 `TerminalFontDialog.tsx` 新增 `<section role="group" aria-label={t(...)}>` 呈現建置身分；
      工作副本不乾淨時明確標示。驗證：`npm run dev` 開啟 Settings 看得到該段，且
      `npm test` 的 `aria-label-source` 通過
- [x] 4.3 確認狀態列未新增版本欄位（`status-bar` 明文禁止）。驗證：`StatusBar.tsx` 零改動
- [x] 4.5 `probe-workspace.mjs:575` 那條既有斷言擴充為涵蓋〈介面涵蓋終端偏好以外的區段〉：
      對話框中除終端偏好之外另有建置身分區段，且標題不將自身侷限於終端
- [x] 4.4 跑 `npm run probe:workspace` 與 `npm run probe:identity` 回歸 —— 兩支都有對 Settings
      對話框的既有斷言，新增區段與改標題文案可能打到它們

## 5. 選檔與產物清理

- [x] 5.1 `scripts/probe-package.mjs` 的 `findAppImage()` 改為以 `package.json` 的 version 建構
      期望檔名，找不到即明確失敗（**不用 `.sort().at(-1)`** —— 字典序不是版本序）。
      `PROBE_PACKAGE_APPIMAGE` 覆寫維持。驗證：`release/` 內同時放 `0.1.9` 與 `0.1.10` 兩個
      空檔時，選中的是 `package.json` 宣告的那一個
- [x] 5.2 新增 `scripts/prune-release.mjs`：只保留**版本序**上最新的兩份 `Spekterm-*.AppImage`
      （共用 1.3 的比較函式，**不得用字串排序**），刪除更早的。比對用確定的檔名形態，
      **不用萬用的 `*.AppImage`**。驗證：暫存目錄放 `0.1.8`／`0.1.9`／`0.1.10`／`0.1.11` 四個
      fixture 加一個非本專案的檔，跑完剩 `0.1.10`／`0.1.11` ＋ 那個非本專案的檔

## 6. 桌面整合

- [x] 6.1 新增 `scripts/install-desktop.mjs`：把產物安裝為 `$XDG_BIN_HOME`（缺省 `~/.local/bin`）
      `/Spekterm.AppImage`（**檔名不帶版本**）、寫入 `$XDG_DATA_HOME/applications/spekterm.desktop`
      （`Exec` 為絕對路徑、`Icon` 為已安裝圖示的絕對路徑、`StartupWMClass=Spekterm`）、
      複製 `build/icon.png` 到 `$XDG_DATA_HOME/icons/hicolor/512x512/apps/spekterm.png`。
      **寫入產物走「暫存名 + `rename()`」，不得就地覆寫**（執行中的可執行檔會 `ETXTBSY`，
      而那正是換版流程的常態）；失敗判定看 `errno`，**不比對訊息**（本機訊息是在地化的）。
      產物不存在時明確失敗且不寫任何檔案。驗證：以暫存 `HOME`／`XDG_*` 跑一次，三個檔案都在
- [x] 6.2 新增 `scripts/uninstall-desktop.mjs`：移除上述三個檔案。驗證：跑完後三個檔案皆不存在
- [x] 6.3 `package.json` 新增 `install:desktop` 與 `uninstall:desktop` 兩個 script。
      驗證：`npm run install:desktop` 之後應用程式選單出現 Spekterm 項目

## 7. 驗收載體

- [x] 7.1 新增 `scripts/build-info.test.mjs`（單元層）：以**暫存 git repo** 驗
      〈帶著未提交的變更建置時被標示〉與其對照組〈工作副本乾淨時不標示〉。
      **對照組要先確認會紅**（把標示邏輯拿掉，乾淨那條必須失敗）。同檔驗 1.3 的 semver 比較
      在跨十位數時的正確性
- [x] 7.2 新增 `scripts/release-bump.test.mjs`：以暫存 git repo 驗六條 ——
      〈連續兩次打包產出不同的版本〉、
      〈工作副本帶有其他未提交的變更時，它們不被提交〉、
      〈遞增後工作副本中不留下未提交的版本宣告〉、
      〈打包不建立 tag〉、
      〈無法提交時明確告知〉、
      〈版本宣告檔案已被修改時拒絕打包〉。
      **fixture 必須含 `package-lock.json`** —— 沒有它，第三條與 dirty 那組對照組全部失去
      鑑別力（`npm version` 正是會一併改寫它）。〈無法提交時明確告知〉**至少要造兩種失敗**：
      非 git repo 與 detached HEAD（後者 `git commit` 會 exit 0，只看結束碼的實作會靜默通過）
- [x] 7.3 新增 `scripts/install-desktop.test.mjs`：以暫存 `HOME`／`XDG_*` 驗六條 ——
      〈安裝後桌面項目存在且指向已安裝的產物〉、
      〈桌面項目的執行目標不隨版本改變〉（fixture 必須造**兩個檔名不同**的來源產物，否則無鑑別力）、
      〈重複安裝不產生重複的項目〉（**這條在 D6 的固定檔名之下結構上不可能紅** —— 它記錄的是一個
      結構性保證，不是一條有鑑別力的斷言，不得被計入「抓得到 bug 的覆蓋」）、
      〈提供移除方式〉、
      〈產物不存在時明確失敗〉、
      〈已安裝的產物正在執行時仍可換版〉（以一個長跑的 fixture 執行檔佔住目標路徑，
      驗安裝仍成功且舊行程未被殺）
- [x] 7.3a 同檔驗〈打包輸出目錄被清除後已安裝的產物仍可執行〉的**可驗部分**：安裝的是獨立
      副本而非連結，刪掉來源後檔案仍在且可執行。**「應用程式視窗成功開啟」不由此承擔** ——
      那半條由 dogfood 認定（見 8.3），此處不得被詮釋為已完整覆蓋
- [x] 7.4 新增 `scripts/prune-release.test.mjs`：
      〈第三次打包後只留下最近兩份產物〉、
      〈版本號跨越十位數時保留的仍是版本序上最新的兩份〉、
      〈不刪除輸出目錄中的其他內容〉。
      **把比較換成字典序時，跨十位數那條必須變紅** —— 先確認這件事再算這條做完
- [x] 7.5 擴充 `scripts/packaging-config.test.mjs`：〈README 記載安裝與移除〉的文件斷言；
      **`scripts['dist:linux']` 含 `release-bump` 與 `prune-release` 的靜態守衛**（與該檔既有的
      「`dev` script 含 `XDG_CONFIG_HOME`」同一個模式 —— 少了它，把 bump 從 `dist:linux` 拿掉
      不會有任何東西變紅）；`build.artifactName` 若被設定則 SHALL 含 `${version}`；
      **`electron.vite.config.ts` 的 renderer `define` 宣告了 `__BUILD_INFO__`**
      （`declare const` 讓 typecheck 對注入被拿掉完全無感）
- [x] 7.6 `scripts/probe-package.mjs` 新增段落：
      〈檔名含當次的版本〉（**列舉 `release/` 目錄**並斷言其中存在檔名嵌著當前 version 的產物 ——
      **不得斷言「以 version 建構出來的檔名含 version」**，那是被觀察值等於被建構值，不可能紅）、
      〈設定介面呈現建置身分〉、
      〈呈現的版本與產物檔名的版本相同〉（比對的是 **`release/` 的來源檔名**，不是 `workDir` 裡
      那份 —— 既有程式碼把它複製成 `Spekterm.AppImage`，版本已被剝掉）、
      〈產物脫離 repo 執行時建置身分仍完整〉（複用既有把 AppImage 複製到 `workDir` 的路徑；
      **「與在 repo 之內執行時相同」那半沒有對照臂**，且在 D1 之下「執行時問 git」表達不出來 ——
      這條接近恆真，不得被計入有鑑別力的覆蓋）、
      〈遞增不倚賴任何額外的人工步驟〉（斷言最後一個 commit 為 `chore(release): <version>` 且
      `package.json` 的 version 等於它。**注意其上界**：走 `PROBE_PACKAGE_APPIMAGE` 時
      `dist:linux` 根本沒跑，這條會讀到上一輪的殘留而照樣綠 —— 真正擋住「bump 被拿掉」的是
      7.5 的靜態守衛）
- [x] 7.6a `probe-package.mjs` 目前是**單一 `try` 區塊、無段落隔離**（不在 `ALL_PROBES` 內、未用
      `sections.mjs`）。7.6 加的是需要開 Settings 對話框的 UI 互動，一次 throw 會連帶帶走既有的
      pty 與 CSP 兩條斷言。實作時評估是否要一併導入段落隔離，或至少把新段落包在自己的
      try/catch 裡
- [x] 7.7 `scripts/probe-files.mjs` 的 **dev 段**新增〈開發模式的身分可與打包產物區分〉——
      該支自起 `electron-vite dev --rendererOnly`，是**唯一**能拿到 `command === 'serve'` 建置的
      renderer 的探針（`probe:workspace` 只跑 build 產物，掛在那裡必為假綠，見 design D8）。
      需新增一條開啟 Settings 對話框的路徑（該支目前不碰活動列）
- [x] 7.8 確認新增的三支腳本落在 `wait-source` / `retry-source` / `check-detail` 三道原始碼守衛的
      定義域內（它們掃 `scripts/*.mjs` 與 `scripts/lib/*.mjs`）—— 不得手寫等待迴圈或固定次數重試
- [x] 7.9 `npm run typecheck && npm run lint && npm test` 全綠

## 8. 文件與收束

- [x] 8.1 README：更新「打包與安裝」（`Spekterm-0.1.0.AppImage` 的字面路徑全部要改，含第 89 行
      的 `dist:linux` 說明）、新增 `install:desktop` / `uninstall:desktop` 的說明與移除方式，
      並改寫「AppImage 不會自動出現在應用程式選單」那條前提（它不再成立）
- [x] 8.2 CLAUDE.md：開發指令表新增兩個 script；更新「現況」段；寫明**跑一次 `probe:package`
      會產生一個 `chore(release)` commit**（迭代要走 `PROBE_PACKAGE_APPIMAGE=<path> node
      scripts/run-probe.mjs package` 繞過 `dist:linux`），以及那些 commit 會混進 `standup`
- [x] 8.3 `docs/PRD.md` §11 的 Phase 6 清單：新增本 change 交付的能力與打包步驟
      （CLAUDE.md 明訂 PRD 是範圍的單一權威）
- [x] 8.4 dogfood 人工驗收：先提交本 change（D4 步驟 1 會擋住已被修改的 `package.json`）→
      `dist:linux` → `install:desktop` → **清掉 `release/`** → 自應用程式選單啟動 → 開 Settings
      確認建置身分與檔名同版。這同時是 `desktop-packaging` 兩條「SHALL 以自桌面環境啟動驗收」
      首次具備可執行前提的證明
- [x] 8.5 刪除 `release/Spekterm-0.1.0.AppImage.prev`（本 change 要取代的權宜作法）
- [x] 8.6 關閉 issue #13 與 #15
