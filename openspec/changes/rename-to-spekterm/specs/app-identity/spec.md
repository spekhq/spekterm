## ADDED Requirements

### Requirement: 應用程式宣告作業系統層級的身分

`package.json` SHALL 宣告 `productName` 與 `build.appId`。`productName` SHALL 為 `Spekterm`；
`build.appId` SHALL 為 `com.spekterm.app`。

`appId` 是 macOS `CFBundleIdentifier` 與 Windows uninstall registry key 的來源：**一經隨安裝檔
發佈即凍結**。後續 change SHALL NOT 變更它 —— 變更 `appId` 的作業系統語意是「發佈一個不同的
app」：舊版不會自動更新過去，使用者手上會同時裝著兩個。

#### Scenario: package.json 宣告產品身分

- **WHEN** 讀取版控中的 `package.json`
- **THEN** `productName` 為 `Spekterm`，且 `build.appId` 為 `com.spekterm.app`

#### Scenario: appId 為合法的反向域名形狀

- **WHEN** 檢查 `build.appId`
- **THEN** 它由至少三個以點分隔的區段組成（macOS bundle identifier 的慣例形狀）

### Requirement: package 名稱不得借用不屬於本專案的 npm scope

`package.json` 的 `name` SHALL 為 `spekterm`，不帶 scope。本 package 為 `private`、不發佈至 npm，
因此不需要 scope。

`name` SHALL NOT 使用本專案無發佈權的 npm scope。`@spek` 已由他人註冊 —— 這正是 core 套件當初
被迫改名為 `@spekjs/core` 的原因；宣告一個自己無權發佈的 scope，是一個會誤導讀者、且永遠無法
兌現的宣告。

#### Scenario: package 名稱為 unscoped 的產品名

- **WHEN** 讀取版控中的 `package.json`
- **THEN** `name` 為 `spekterm`，且不以 `@` 開頭

### Requirement: userData 目錄跟隨產品名

執行中的應用程式，其 `app.getPath('userData')` SHALL 解析到以 `productName` 命名的目錄。

（Electron 的 `app.getName()` **優先取 `productName`、缺才退回 `name`** —— 因此 `productName`
不只是顯示名稱，它同時決定使用者設定的落點。）

#### Scenario: userData 落在產品名的目錄下

- **WHEN** 應用程式啟動
- **THEN** `app.getPath('userData')` 的最後一段為 `Spekterm`，且完整路徑不含 `@spek` 或
  `workspace`

### Requirement: 視窗標題呈現產品名

renderer 的文件標題 SHALL 為 `spekterm`。

（視窗標題是 renderer 的內容、不是作業系統的 app 身分，因此跟隨品牌的書寫形式 —— 全小寫 ——
而非 `productName` 的 `Spekterm`。兩者不同源，不需一致。）

#### Scenario: 視窗標題為產品名

- **WHEN** 視窗完成載入
- **THEN** `document.title` 為 `spekterm`

### Requirement: 掃描路徑覆寫的環境變數跟隨產品名

開發模式下覆寫 OpenSpec 掃描目標的環境變數 SHALL 名為 `SPEKTERM_SCAN_PATH`。

#### Scenario: 以環境變數覆寫掃描目標

- **WHEN** 以 `SPEKTERM_SCAN_PATH` 指向另一個含 `openspec/` 的 repo 啟動開發模式
- **THEN** 主行程掃描該路徑，並輸出對應於該 repo 的掃描摘要

### Requirement: 版控內容不得殘留舊產品名

除 `openspec/changes/archive/**` 之外，版控中的程式碼、設定、文件與驗收腳本 SHALL NOT 含有舊產品名
（`spek workspace`）、舊 package 名（`@spek/workspace`）、舊環境變數名（`SPEK_SCAN_PATH`），或以
`spek-` 為前綴的 probe `--user-data-dir` profile 名。

probe 的 profile 名不是無關痛癢的字串：驗收腳本靠「每個子行程的 argv 都帶著那個獨一無二的
`--user-data-dir` 值」來連根拔除殭屍行程樹（`pkill -9 -f <profile>`）。腳本與文件若不同步更名，
下一輪 probe 會連到仍佔著 debugging port 的殭屍、讀到空樹 —— 而那看起來會像 regression。

`openspec/changes/archive/**` 是歷史紀錄，記載的是「在那個時間點這個專案叫什麼」，本身正確，
SHALL 保持原樣。

#### Scenario: 舊識別字串不殘留

- **WHEN** 在版控追蹤的檔案中搜尋 `spek workspace`、`@spek/workspace`、`SPEK_SCAN_PATH` 與
  `spek-*-profile`，且排除 `openspec/changes/archive/**`
- **THEN** 沒有任何命中

#### Scenario: 歷史紀錄未被竄改

- **WHEN** 檢視本次正名所產生的 diff
- **THEN** `openspec/changes/archive/**` 之下沒有任何檔案被修改
