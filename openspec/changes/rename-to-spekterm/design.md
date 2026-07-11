## Context

產品正名為 **spekterm**。這份 design 要處理的不是「把字串換掉」（那是 tasks 的事），而是**哪些
決策一旦做出就改不了**，以及那些改不了的東西該長什麼形狀。

正名之所以有 design 可寫，全因為一件事：**app 的身分會外溢到作業系統**。`appId` 進 macOS 的
`CFBundleIdentifier` 與 Windows 的 uninstall registry key；`productName` 決定 userData 目錄名、
Dock 顯示名與安裝檔名。這些值一旦隨安裝檔離開這台機器就凍結 —— 改動等於發佈一個「不同的 app」，
舊版不會自動更新過去，使用者手上會同時裝著兩個。Phase 6 就是打包，所以這是最後一個能便宜決定的
時機。

現況（實測）：

- `package.json`：`name` = `@spek/workspace`，**無** `productName`、**無** `build`。
- userData 實測落在 `~/.config/@spek/workspace/workspace.json` —— Electron 的 `app.getName()`
  **優先讀 `productName`、缺才退回 `name`**，於是 scoped name 造出一個帶 `@` 的巢狀目錄。
- 視窗標題來自 `src/renderer/index.html` 的 `<title>spek workspace</title>`。
- `src/main/index.ts` 只呼叫 `app.getPath('userData')`，**沒有**任何硬編的 app 名稱。

可用性已驗證：npm `spekterm` 未被佔用；GitHub `spekterm` 未被佔用；`spekterm.com` / `.dev` /
`.app` 三個 TLD 皆未註冊。

## Goals / Non-Goals

**Goals:**

- 給 app 一個**穩定、可凍結**的作業系統身分（`appId` / `productName`），並把它訂成一份可驗收的
  規格（capability `app-identity`），而不是散落在各檔案裡的字串。
- 擺脫 `@spek` —— 一個不屬於本專案的 npm scope。
- 讓 Phase 6 的打包有明確、已凍結的輸入，不必在打包當下才臨時決定名字。

**Non-Goals:**

- **不寫 userData 遷移**（D4）。
- **不改 `openspec/changes/archive/**`** —— 歷史紀錄。那些文件寫的是「在那個時間點這個專案叫什麼」，
  本身正確；改它等於竄改決策脈絡。
- **不改既有 capability 名稱**（`workspace-app-shell`、`spek-core-integration` 等）—— 內部
  identifier。`spek-core-integration` 指的是「整合開源的 `@spekjs/core`」，正名後依然正確。
- **不動 `@spekjs/core` / `@spekjs/ui` 依賴** —— 那是 spek 開源專案的套件，不隨本 app 改名。
- **不把開源 `spek` repo 搬進 org** —— 那是另一個 repo 的事（OpenSpec change 是 repo-local 的）。
- 不做 landing page、不設定 domain 的 DNS —— 買 domain 是 change 之外的動作。

## Decisions

### D1 — 產品名的書寫形式：品牌全小寫 `spekterm`，但 `productName` 用 `Spekterm`

**決策**：`package.json` 的 `productName` = **`Spekterm`**（首字大寫）；文件、npm、CLI、domain 一律
寫作 **`spekterm`**（全小寫）。

`productName` 是**作業系統的顯示名稱** —— 它出現在 Dock/工作列、Finder 的 Applications、Windows
的「新增或移除程式」、以及 electron-builder 產出的安裝檔名（`Spekterm-1.0.0.dmg`）。那些位置的
慣例是首字大寫的專有名詞。小寫的品牌調性（xterm / kitty / ghostty 那一掛）活在 README、CLI 與
domain 裡，而 Ghostty 自己也正是這樣：品牌寫 `ghostty`，macOS 的 app 名是 `Ghostty`。

**這個決策不是純美學** —— 它決定了 userData 目錄名（見 D3）。

### D2 — `appId` = `com.spekterm.app`（凍結）

**決策**：`build.appId` = **`com.spekterm.app`**。

作者將買下 `spekterm.com`（同時買 `.app` 做 301 導向，避免另一個 TLD 落入 squatter 手中）。
`appId` 慣例是反寫自己控制的 domain：

- 反寫 `spekterm.com` → `com.spekterm` → 補產品段 → **`com.spekterm.app`**。三段，標準形狀。
- 反寫 `spekterm.app` → `app.spekterm` —— **只有兩段**。技術上可行，但不合 macOS bundle
  identifier 的三段慣例，讀起來不像 bundle id。

**appId 與網站的 canonical domain 脫鉤**：`appId` 只是一個「作者控制的命名空間」宣告，不需要對應
到實際提供服務的網站。因此網站最後要用 `.com` 還是 `.app` 當 canonical，**日後隨時可改，不影響已
發佈的 app**。只有 `appId` 本身凍結。

### D3 — `package.json` 的 `name` = `spekterm`（unscoped）

**決策**：`name` = **`spekterm`**，不帶 scope。

- 本 package 是 `private: true`、**不發佈至 npm**，因此不需要 scope。
- 用 unscoped 名稱徹底擺脫借來的 `@spek`（`@spek` 已被他人註冊，這正是 core 當初被迫改名為
  `@spekjs/core` 的原因）。
- **不用 `@spekjs/spekterm`**：`@spekjs` 是**開源套件**的 scope（MIT，供人 `npm install`）。這個
  app 是專有授權的商業產品、不發佈。把它掛進開源 scope，會模糊正名本來要釐清的那條授權界線。

**副作用**：`name` 與 `productName` 同時存在時，Electron 的 `app.getName()` 取 `productName`。
因此 userData 會落在 **`~/.config/Spekterm/`**（依 D1 的大小寫），而不是 `~/.config/spekterm/`。
這是可接受的 —— userData 目錄名跟隨 OS 顯示名，是 Electron 的既定行為，不值得為了統一大小寫而
去覆寫 `app.setName()`（那會讓兩個名字的來源分叉，日後更難追）。

### D4 — 不寫 userData 遷移（**此決策有前提**）

**決策**：正名會讓 userData 從 `~/.config/@spek/workspace/` 移到 `~/.config/Spekterm/`，
既有的 `workspace.json`（folder 清單）不會被讀到。**本 change 不寫任何遷移程式碼。**

**前提**：app **尚未發佈**，唯一的使用者是作者本人。手動重新加入幾個 folder 的成本，遠低於一段
只會執行一次、卻要長期留在 `src/main/` 裡的遷移路徑 —— 而那段程式碼還得自己處理「舊路徑存在但
損毀」「新舊都存在該信誰」之類的分支，全都是純負債。

**失效條件（寫給未來的自己）**：**一旦有第一個外部使用者，這個結論就失效。** 此後任何改動
`productName` 的 change 都必須附遷移，否則使用者升級後會看到一個空的 workspace，而他的設定其實
還躺在磁碟上另一個目錄裡。這與 `workspace-folders` 既有的「設定檔損毀不得阻止應用程式啟動」是
同一種精神：**設定的遺失必須是使用者可理解、可挽回的，不能是靜默的。**

舊目錄 `~/.config/@spek/workspace/` 由作者自行刪除，不由程式碼處理。

### D5 — GitHub：repo 名現在就定，org 歸屬**刻意不阻塞**

**決策**：repo 正名為 `spekterm`（GitHub 上未被佔用）。org 歸屬另案處理。

首選是 `spekjs` org（與 npm scope `@spekjs` 對齊），但該名稱被一個閒置 User 帳號佔著（0 repo、
0 follower、2020 年建、2022 年後無動靜），已向 GitHub Support 申請釋出 —— 作者曾以同一管道成功
要回 `kewang`（原 `kewangtw`），故此路可行但**時程與結果都不可控**。

**因此它不能進入本 change 的關鍵路徑**，而且天生就不需要：

- `appId`、`name`、`productName` 這三個**會凍結**的值，**都不依賴 GitHub org**。
- GitHub 的 repo 改名與 transfer **皆自動 redirect**，既有的 `git remote` 不會斷，隨時可做。

**備案（若申訴失敗）**：`spek-js` 只差一個連字號，打錯就把流量送給那個空帳號，**不用**；
`spekterm` 當 org 名的話，開源的 spek 就得住在一個商業產品名的組織底下，反而模糊授權界線，**不用**；
可行的是 `spekhq`（組織名，底下同時裝 MIT 開源與 private 商業 repo 皆自洽），或乾脆留在
`kewang/spekterm` —— 個人帳號在有協作者之前並無實害。

**GitHub org 名與 npm scope 不一致是常態**，不需要為了對齊而勉強（`@vscode/*` 的源碼在
`microsoft/vscode`，`@types/*` 在 `DefinitelyTyped`）。

### D6 — `appId` / `productName` 寫進 `package.json`，不另建 `electron-builder.yml`

**決策**：把 `productName` 與 `build.appId` 直接宣告在 `package.json`。

electron-builder 尚未安裝（Phase 6 才裝），但它**預設就讀 `package.json` 的 `build` 欄位**，
所以現在寫下的值，到 Phase 6 會直接生效、不需搬家。更重要的是：`productName` **本來就必須**在
`package.json`（Electron 的 `app.getName()` 讀它），與 electron-builder 裝沒裝無關。

把兩者放在一起，`app-identity` 這份 spec 現在就**可驗收**（讀 `package.json` + 讀執行中 app 的
`app.getPath('userData')`），不必等到 Phase 6。

### D7 — 內部識別字串跟著改，且 probe 的 profile 名**必須**同步

**決策**：`SPEK_SCAN_PATH` → `SPEKTERM_SCAN_PATH`；probe 的 `--user-data-dir` profile 名
`spek-*-profile` → `spekterm-*-profile`。

profile 名不是無關痛癢的字串：CLAUDE.md 記載的殭屍行程收屍手法
（`pkill -9 -f <profile>` —— 靠每個子行程 argv 裡都帶著那個獨一無二的 `--user-data-dir` 值，
連根拔除整棵行程樹）**直接依賴它**。改 probe 腳本卻漏改文件裡的 `pkill` 指令，下一輪 probe 就會
連到殭屍、讀到空樹，而那看起來會像是 regression —— CLAUDE.md 對這個陷阱已有明文警告。因此
**腳本與文件必須同一個 commit 內一起改**。

### D8 — 視窗標題

**決策**：`src/renderer/index.html` 的 `<title>` 改為 `spekterm`（品牌小寫）。

視窗標題是 renderer 的內容、不是 OS 的 app 身分，因此跟隨品牌書寫形式（小寫），與 D1 的
`productName`（`Spekterm`）不同源、也不需要一致。

## Risks / Trade-offs

- **`appId` 押在一個還沒買的 domain 上 —— 封存時此風險仍未結。** `com.spekterm.app` 假設作者確實
  買下 `spekterm.com`。**實際上封存時 domain 尚未購買**（tasks 5.1，作者決定延後），而 `appId`
  已隨本 change 凍結。

  這個 appId 仍可運作（appId 從不做 DNS 查詢，只是一個唯一字串），但兩件事已經成立：「反寫自己
  擁有的 domain」這個慣例的正當性沒了；且**若 `spekterm.com` 被他人註冊，這個 appId 就變成在宣告
  一個別人的命名空間**。

  **這個風險隨時間單調上升，而且事後無法以改 appId 化解** —— 改 appId 的作業系統語意是「發佈一個
  不同的 app」（舊版不會自動更新過去）。也就是說：**買 domain 的窗口不會因為延後而變寬，只會變窄。**
  緩解只有一個：在 Phase 6 打包發佈前買下它。查證當下 `spekterm.com` / `.dev` / `.app` 三個 TLD
  皆未註冊。
- **不做遷移＝作者自己的 workspace 設定會歸零。** 這是有意識的取捨（D4），但實作完第一次啟動時
  folder 清單會是空的 —— 這是**預期行為，不是 bug**。驗收時別把它當成 regression。
- **改名會踩到 CLAUDE.md 記載的殭屍陷阱。** 舊 profile 名（`spek-files-profile`）的殭屍若還在跑，
  新 probe 用新 profile 名啟動，舊的 `pkill` 模式就抓不到它們，而它們還佔著 debugging port。
  **緩解**：實作時先用舊模式清一次殘留，再切換命名（見 tasks）。
- **有一個名字沒有被正名。** `openspec/specs/spek-core-integration/` 這個 capability 保留原名。
  它指的是「整合 `@spekjs/core`」而非「整合 spek workspace」，所以名字仍然正確 —— 但日後讀 spec
  清單的人可能會愣一下。判斷是：改名要動 spec 目錄、archive 裡的交叉引用與所有 probe，成本遠大於
  那一秒的困惑。
