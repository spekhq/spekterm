## 1. 歷史改寫（design D0–D3；force push 之前停下等使用者批准）

- [x] 1.1 在 `~/spekterm-oss/` 準備替換對照表（`replacements.txt`，D1 的規則：字面、長的與特定的在前、大小寫分開、家目錄只換家目錄那一段）與全歷史掃描腳本（`scan.sh`：所有 commit 的每一個 blob 與每一則訊息，對原名、同事名、家目錄路徑計數）。先對**目前的**歷史跑掃描，記下每一類的命中數作為基準（必須非零，否則掃描本身無效）
- [x] 1.2 `git clone --no-local` 到 `~/spekterm-oss/rewrite/`，以 `git filter-repo --replace-text --replace-message` 改寫。對改寫結果跑 1.1 的掃描，每一類零命中；`npm ci && npm test` 全綠；`git log --no-color --oneline | wc -l` 與改寫前相同
- [x] 1.3 向使用者呈現：改寫前後 HEAD 的 `git diff --no-color --stat`、每條規則的命中數、掃描結果。**停下，等使用者批准 force push**
- [x] 1.4 （使用者批准後）從改寫後的 clone 加回 `origin`、`git push --force origin master`；`git ls-remote origin master` 等於改寫後的 HEAD
- [x] 1.5 本機原地換成新歷史（D3）：`git fetch ~/spekterm-oss/rewrite master`、`git reset --hard FETCH_HEAD`、`git fetch --prune`、`git reflog expire --expire=now --all`、`git gc --prune=now`。確認本 change 目錄仍在，且對本機 `git log --all` 跑 1.1 的掃描零命中

## 2. 改寫後的修補

- [x] 2.1 `src/main/handoff-target.test.ts` 的「前綴不算」與「子字串不算」兩條，把片段改成新名字的前綴與子字串（D1）；`src/main/handoff-intro.test.ts` 的 fixture 與之對齊。對照組：把 `resolveTarget` 暫時改成前綴比對，「前綴不算」那條變紅；還原後 `npm test` 全綠
- [x] 2.2 依 `~/spekterm-oss/rewrite/.git/filter-repo/commit-map` 更新 repo 內引用 commit 識別碼的 15 處（D4）。每一個新識別碼以 `git cat-file -t` 確認是存在的 commit
- [x] 2.3 `git grep --no-color --untracked -n "/home/"` 的結果逐一檢視，只剩通用的家目錄路徑

## 3. 授權宣告與文件

- [x] 3.1 新增根目錄 `LICENSE`：MIT 全文，著作權行 `Copyright (c) 2026 Kewang`。以 `diff` 對照 `../spek/LICENSE`，確認兩份相同（同一份範本、同一個著作權人）
- [x] 3.2 `package.json`：`license` 改為 `MIT`，補 `author`、`repository`、`homepage`，`private: true` 不動；`npm install --package-lock-only` 同步 lock，`git diff --no-color package-lock.json` 只有根項目的欄位改變
- [x] 3.3 新增 `CONTRIBUTING.md`（D9）與 `.github/FUNDING.yml`（`github: [kewang]`），內容符合 spec 的兩條 scenario
- [x] 3.4 README、CLAUDE.md、`openspec/config.yaml`、PRD 依 D8 改寫。PRD 另外人工檢查每一處描述 spekterm 自己為封閉、付費、私有的說法（D5：守衛看不到不含禁字的那些）。`git grep --no-color -n -i -E "私有 repo|專有授權|商業版|All rights reserved" README.md CLAUDE.md docs/PRD.md openspec/config.yaml` 無命中

## 4. 被出貨的產物

- [x] 4.1 第三方授權彙總（D7）：`electron.vite.config.ts` 的 plugin 與 `scripts/third-party-licenses.mjs`，接進 `npm run build`。純函式（路徑 → 套件，含 scoped 與巢狀 `node_modules`；套件 → 彙總條目，含無授權檔的註明）有單元測試。`npm run build` 後 `out/THIRD_PARTY_LICENSES.txt` 含 `react`、`monaco-editor`、`@xterm/xterm`、`i18next`、`node-pty` 且各帶授權全文
- [x] 4.2 `package.json` 的 `build.extraFiles` 帶上 `LICENSE` 與 `out/THIRD_PARTY_LICENSES.txt`，放在產物根目錄。以 `npx electron-builder --linux -c.directories.output=<scratch>` 建出產物，在 scratch 目錄 `--appimage-extract`，`cmp` 確認 `LICENSE` 與版控逐位元組相同、彙總檔存在；`release/` 沒有被動到
  - 結果：`LICENSE` 與 `THIRD_PARTY_LICENSES.txt` 皆與來源逐位元組相同；`release/` 未被動到。**實作時另外發現**：`files` 的 `out/**` 會把 `out/licenses/*.json` 打進 asar，而那些檔案記的是建置機器上的絕對路徑（含家目錄）—— 已在 `files` 排除 `out/licenses/**` 與彙總本身，產物的 asar 對家目錄路徑零命中
- [x] 4.3 交叉檢查：以開了 sourcemap 的一次性建置（不 commit 該設定），從 renderer 與 main 的 sourcemap `sources` 列出 `node_modules` 之下的套件，每一個都在 4.1 的彙總裡。清單與比對結果記在本 task 底下
  - 結果：`electron-vite build --sourcemap` 產出 88 份 sourcemap，其 `sources` 落在 `node_modules` 之下的套件共 97 個，**全部**在彙總裡（彙總 113 個；差額是原樣出貨、不經 bundle 的依賴）。sourcemap 的集合小於收集端的集合是預期的 —— 被 tree-shake 到沒有程式碼的模組不會出現在 sourcemap 裡
- [x] 4.4 `scripts/probe-package.mjs`：從被啟動行程的 `/proc/<pid>/environ` 讀 `APPDIR`（不列舉掛載點），斷言 `LICENSE` 逐位元組相同、彙總含 spec 點名的五個套件。`PROBE_PACKAGE_APPIMAGE=<4.2 的產物> node scripts/run-probe.mjs package`：新斷言綠、換版斷言照預期紅（D7）、其餘全綠
  - 結果：新斷言四條全綠（掛載點、`LICENSE`、彙總、內嵌聲明），換版斷言照預期紅，其餘全綠（15/16）。
  - **實作時改了定位方式**：從 `APPDIR` 或 `/proc/<pid>/exe` 定位都實測失敗 —— 探針若在 Spekterm 開出來的終端裡執行，繼承的 `APPDIR` 是使用者那一份產物的（runtime 不覆寫），而 Electron 行程不可 dump，`environ` 與 `exe` 讀不到；掛載表的來源只記檔名，與使用者那份同名。改為「啟動後比啟動前多出來的那一個掛載點」，並在啟動前清掉繼承來的 `APPDIR`／`APPIMAGE`／`ARGV0`／`OWD`。
  - **順帶修掉一個既有的回歸**：「產生了一個真實 pty」在舊產物上同樣紅。原因是探針的標記變數叫 `SPEKTERM_PROBE_MARKER`，而 `agent-peer-name` 之後 `ptyEnv()` 會剝掉所有 `SPEKTERM_` 開頭的變數 —— 標記根本進不了 pty。改名為 `PROBE_PACKAGE_MARKER` 後轉綠。產品沒壞，是探針自 `handoff-lineage` 起一直沒跑過
- [x] 4.5 對照組：拿掉 `extraFiles` 以同樣方式重建，4.4 的兩條新斷言變紅；還原後重建、再次通過。結果記在本 task 底下
  - 結果：拿掉 `extraFiles` 重建的產物上，`LICENSE`、彙總、內嵌聲明三條變紅（12/16）；`package.json` 以備份還原（與 4.4 通過的那份產物同一份設定）。另以改寫前的正式 0.1.18 產物跑同一支探針，同樣三條紅
- [x] 4.6 完整的 `RELEASE_LEVEL=minor npm run probe:package` 於封存 commit 之後執行（使用者裁決：第一個公開版本是 0.2.0）；產物為 `Spekterm-0.2.0.AppImage`、全部段落通過才打勾
  - 結果：於實作 commit `ed725f0` 之後執行，換版提交 `chore(release): 0.2.0`，`release/Spekterm-0.2.0.AppImage`，**16/16 全過**（含四條授權斷言與恢復綠燈的 pty 那條）

## 5. 守衛

- [x] 5.1 `scripts/license.test.mjs`（D5）：範圍含未追蹤檔、`-i --fixed-strings`、排除恰為三處並以靜態斷言釘住、禁字清單從規則定義處解析並與測試構造的清單比對、逐字對照、archive 對照、`project-license` 的其餘靜態 scenario。測試名不含禁字。`npm test` 全綠，`scripts/test-glob.test.mjs` 認得它
  - 結果：10 項全過。**這支守衛抓到的第一個違規是它自己** —— 檔頭註解為了說明「不分大小寫」舉了兩個大小寫不同的例子，已改寫
- [x] 5.2 `scripts/public-hygiene.test.mjs`（D6）：`git ls-files -co --exclude-standard`、不排除路徑、跳過二進位、切詞＋SHA-256 比對、`spekterm` 對照組、家目錄路徑搜尋。雜湊清單由 `~/spekterm-oss/` 的原名清單產生，測試檔內只有十六進位值。`npm test` 全綠
  - 結果：5 項全過，整個 repo（含 archive 與未追蹤檔）約 0.5 秒。清單收三個字詞：公司名、一個內部系統名、同事的名；**同事的姓與另一個 handle 刻意不收**（常見的名與姓，開源專案的貢獻者裡完全可能正當出現），歷史已清，只是不設守衛
- [x] 5.3 守衛的對照組，逐一實跑並還原：(a) 在 README 寫回英文的保留權利聲明 ⇒ 授權守衛紅；(b) 把授權守衛某個禁字的組合拼錯 ⇒ 清單比對紅；(c) 在授權守衛的排除清單多加一條 ⇒ 排除清單斷言紅；(d) `private` 改成 `false` ⇒ 對應斷言紅；(e) 在一份未追蹤的新檔寫入一個內部名稱 ⇒ 內容守衛紅；(f) 在一份 archive 檔寫入一個內部名稱 ⇒ 內容守衛紅；(g) 把內容守衛的 `spekterm` 對照雜湊改錯一位 ⇒ 對照組紅。七次結果記在本 task 底下（記錄時不寫出內部名稱）
  - (a) README 寫回英文的保留權利聲明 ⇒「版控中不殘留限制性授權的宣告」紅
  - (b) 一個禁字的組合拼錯 ⇒「禁字清單與規則定義處列出的相同」與逐字對照兩條紅
  - (c) 排除清單多加 `docs` ⇒「排除恰為規則定義處宣告的三處」紅
  - (d) `private` 改成 `false` ⇒「package.json 宣告 MIT，且仍不發佈到 npm」紅
  - (e) 一份未追蹤的新檔寫入公司名 ⇒「repo 不含維護者宣告為內部的識別字詞」紅
  - (f) 一份 archive 檔寫入內部系統名 ⇒ 同一條紅
  - (g) 對照雜湊改錯一位 ⇒「對照組：一個已知存在的公開字詞比對得到」紅
  - 七處皆已還原，兩支守衛全綠
- [x] 5.4 `scripts/scenario-coverage.test.mjs`：`open-source-mit` 登記進 `COVERED_CHANGES`，每條 scenario 一列（D10），`greenIfAbsent` 與 `mutation` 引用 2.1、4.5、5.3 實跑過的對照組，mutation 描述不含禁字與內部名稱。`npm test` 全綠
  - 結果：本 change 18 條新 scenario 各一列；`agent-handoff-source` 修改的五條沿用既有列（名稱相同，重列會撞「重複的列」），其中「前綴不算」那一列補記 2.1 的重跑。兩列無 repo 內載體並寫明理由（sourcemap 交叉檢查、全歷史掃描）。對照：刪掉一列 ⇒「每一條 scenario 在對照表上恰有一列」紅；在未追蹤檔寫入家目錄路徑 ⇒「repo 不含維護者的本機家目錄路徑」紅；皆已還原

## 6. 遞增層級（design D11）

- [x] 6.1 `scripts/release-bump.mjs` 讀 `RELEASE_LEVEL`（預設 `patch`；`minor`、`major`；其他值在動手之前失敗並列出可用的值）。`scripts/release-bump.test.mjs` 補三條，對應 `build-identity` 的三條新 scenario（fixture 版本 `0.1.18`）；對照組：把層級寫死回 `patch`，minor 那條變紅
  - 結果：10 項全過（新增三條）；對照組把層級寫死回 `patch` ⇒「指定 minor 時遞增 minor 並把 patch 歸零」紅，已還原。三條 scenario 已登記進覆蓋對照表
- [x] 6.2 CLAUDE.md 與 README 的打包說明補上 `RELEASE_LEVEL`

## 7. 收尾

- [x] 7.1 `npm run typecheck`、`npm run lint`、`npm test` 全綠（看 exit code，不經 pipe 截斷）
