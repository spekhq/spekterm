## Purpose

把版控中的原始碼變成一份**可獨立分發、脫離 repo 執行**的 Linux 桌面產物 —— 打包指令與產物形態、
打包設定的宣告位置、native 模組在 asar 中的處置、production 政策在產物中仍然生效，以及開發模式與
產物之間的使用者資料隔離。

這份規格之所以獨立存在，是因為**打包會改變執行環境的形狀，而那些改變的失效幾乎都是靜默或異地的**：
`.node` 的載入走 `dlopen`，需要真實的檔案系統路徑（asar 是唯讀虛擬檔案系統）；重建 native 相依會
反過來綁死 Electron 的 ABI，且問題只在缺 toolchain 的機器上浮現；自桌面環境啟動的行程不繼承使用者
shell profile 的 PATH，而自終端機啟動的驗收看不出這件事；`file://` 的 URL 形狀在打包後改變，
既有的 CSP 覆蓋推論不到它。

因此這份規格反覆做同一件事：**要求以行為判定，而非以檔案存在性或設定欄位替代**，並如實記載每一道
守衛的效力上界。產品身分（`productName`、`appId`、userData 的解析來源）由 `app-identity` 規範，
本規格消費它。

## Requirements

### Requirement: 專案產出可獨立執行的 Linux 桌面產物

專案 SHALL 提供一個打包指令，從版控中的原始碼產出**單一可執行檔**形態的 Linux x64 產物
（AppImage），落於 `release/`。

該產物 SHALL 可在 repo 工作副本之外的任意目錄執行 —— 這正是它存在的理由：**使用 app 與開發 app
必須是兩份互不干擾的東西**。一份仍需 repo 才能執行的產物，等於沒有解決任何問題。

產物 SHALL NOT 進入版控（`release/` 已列於 `.gitignore`）。

#### Scenario: 打包指令產出可執行的 AppImage

- **WHEN** 執行打包指令
- **THEN** `release/` 之下出現一個副檔名為 `.AppImage` 的檔案，且該檔案具備執行權限

#### Scenario: 產物脫離 repo 仍可執行

- **WHEN** 將產物複製到 repo 工作副本之外的目錄並執行
- **THEN** 應用程式視窗成功開啟

### Requirement: 打包設定宣告於 package.json

electron-builder 的設定 SHALL 宣告於 `package.json` 的 `build` 之下，SHALL NOT 外移為獨立的
設定檔（`electron-builder.yml`／`.json`／`.js`）。

理由是**避免製造假綠**：`app-identity` 有一條 scenario 直接讀取版控中的 `package.json` 斷言
`build.appId`。設定一旦外移，那條斷言會**繼續通過** —— `build.appId` 仍在原處，只是
electron-builder 不再讀它，於是驗收與實際生效的設定悄悄脫鉤。

後續 change 若必須外移設定，SHALL 同時更新 `app-identity` 的該條 scenario 與其驗收腳本。

#### Scenario: 打包設定位於 package.json

- **WHEN** 讀取版控中的 `package.json`
- **THEN** `build` 之下存在 Linux 目標設定，且該設定指定 AppImage 為產出形態

#### Scenario: 版控中不存在獨立的 electron-builder 設定檔

- **WHEN** 檢查 repo 根目錄
- **THEN** 不存在 `electron-builder.yml`、`electron-builder.json` 或 `electron-builder.config.js`

### Requirement: 打包產物中的 native 模組可載入並 spawn 出真實 pty

打包產物執行時 SHALL 能載入 `node-pty` 並 spawn 出真正的偽終端。

asar 是唯讀的虛擬檔案系統，而 `.node` 的載入走 `dlopen` —— 它需要一個真實的檔案系統路徑。
因此打包產物中的 `node-pty` SHALL 位於 asar 之外，且其 `lib/` 與 `prebuilds/` SHALL 落在同一棵
目錄樹裡（`lib` 以相對路徑解析 `.node`）。

打包設定 SHALL 明示這項要求，**即使打包工具的預設行為已經滿足它** —— 不把「native 模組會落在
asar 之外」這件事繫在第三方工具的隱含行為上：那個行為不出現在我們的設定裡，也就不會在它改變時
發出任何聲音。

**該設定的守衛 SHALL NOT 被詮釋為「少了它產物就會壞」。** 實測（design D3）移除該設定後產物
結構完全相同 —— 打包工具偵測到套件內含 `.node` 就會整包解出。守衛守的是「這個明示不被靜默
拿掉」，僅此而已。**位於 asar 之外這件事本身，由下方的行為 scenario 擔保** —— pty 建立成功
即代表 `dlopen` 成功。

**此要求的驗收 SHALL 以行為判定。** 驗收 SHALL NOT 以「`app.asar.unpacked` 之下存在
`pty.node`」替代：後者是檔案存在性，它在 `dlopen` 因任何其他原因失敗時（glibc 不符、
Electron 的 unpacked 轉向未生效、相依檔未一併解出）**仍會通過**。

行為的判定形式為兩件事：**pty 行程確實存在**，且**送進該 session 的指令確實被執行**。

驗收 SHALL NOT 以「終端畫面上出現指令的輸出」為判準。理由有二，且都與便利無關：

1. **讀畫面的手法綁死 renderer 種類。** 承載文字的 DOM 元素只存在於 DOM renderer；GPU
   renderer 把畫面畫進 canvas 之後它就消失了 —— 而它讀不到時**回空字串**，於是斷言會以
   「畫面上沒有東西」的形狀紅掉，指向錯誤的原因。
2. **那條路徑與打包無關。** pty → 主行程 → IPC → renderer → 終端元件全部是 JavaScript、
   全部住在 asar 內，而「asar 內的 JavaScript 載入正常」已由 renderer 成功載入那條
   requirement 證明。打包唯一能破壞的是 **native 模組的載入**。

「指令被執行」的判定 SHALL 能與「字元僅被回顯」區分 —— 字元送達 pty 但 shell 未執行時，
畫面上一樣看得見那行字。

#### Scenario: 打包產物中建立的 session 產生真實的 pty 行程

- **WHEN** 啟動打包產物並於其中建立一個終端 session
- **THEN** 系統中出現一個由該 app 產生的 shell 行程

#### Scenario: 送進 session 的指令確實被執行

- **WHEN** 對該 session 送出一段會在檔案系統留下副作用的指令
- **THEN** 該副作用出現，且其內容與送出的指令一致

#### Scenario: 打包設定明示 node-pty 須解出 asar

- **WHEN** 讀取 `package.json` 的 `build.asarUnpack`
- **THEN** 其涵蓋 `node-pty` 套件

#### Scenario: asarUnpack 的涵蓋範圍不致使 asar 失去意義

- **WHEN** 以一個純 JavaScript 相依的路徑比對 `build.asarUnpack` 的每一個 pattern
- **THEN** 沒有任何 pattern 匹配它

### Requirement: 打包過程不重建 native 模組

打包過程 SHALL NOT 對 native 相依執行重建。

`native-module-toolchain` 的整條規格建立在「node-pty 是 Node-API 模組，其 prebuilt binary 可同時
被 Node 與 Electron 載入、**無需為 Electron 的 ABI 重建**」之上。而打包工具的預設行為與此相反
——它預設會重建 native 相依。

沿用該預設有兩個代價：打包從此**需要 C++ toolchain**（`native-module-toolchain` 明文要求安裝
不得依賴本地編譯，理由是 Linux 正是優先支援的平台之一）；且重建產出的 binary **反而綁死了
Electron 的 ABI**，使該規格所依賴的跨 runtime 相容性失效。

此設定的失效是**遲滯且異地**的：在具備 toolchain 的機器上打包照樣成功，問題會出現在別人的機器
或 CI 上。

#### Scenario: 打包設定關閉 native 模組重建

- **WHEN** 讀取 `package.json` 的 `build` 設定
- **THEN** 重建 native 相依的選項為關閉

#### Scenario: 打包過程回報未執行重建

- **WHEN** 執行打包並檢視其輸出
- **THEN** 輸出指出已略過相依重建

### Requirement: 打包產物套用 production 內容安全政策

打包產物執行時，其 renderer 收到的 response SHALL 帶有 production 的 Content-Security-Policy
—— 即不含開發模式為 Vite dev server 所做的放寬。

政策的**內容**已由既有驗收覆蓋（切換依 `ELECTRON_RENDERER_URL` 的存在，打包產物與既有探針的
建置模式落在同一個分支）。此處新增的驗收對象是**另一件事**：主行程的 `onHeadersReceived` 對
**asar 內的 `file://` response** 仍然觸發。URL 的形狀在打包後改變了，那不是可以從既有覆蓋推論
出來的。

#### Scenario: 打包產物的 renderer 收到 production CSP

- **WHEN** 啟動打包產物並檢視 renderer 生效中的 Content-Security-Policy
- **THEN** 政策存在，`script-src` 為 `'self'`，且不含任何指向 dev server 的來源

### Requirement: 打包產物載入 renderer 並呈現產品身分

打包產物 SHALL 從 asar 內載入 renderer 並完成呈現。

這同時是 **ESM 進入點在 asar 內解析成功**的證明 —— `package.json` 宣告 `type: "module"`，主行程
產物為 ESM、preload 為 `.mjs`；若解析失敗，應用程式根本開不起來。

#### Scenario: 打包產物開啟視窗並載入 renderer

- **WHEN** 啟動打包產物
- **THEN** 視窗開啟，且其 `document.title` 為 `spekterm`

### Requirement: 打包設定不得靜默退化

專案 SHALL 提供一道併入單元測試層（秒級、隨時可跑）的守衛，斷言打包設定的關鍵欄位仍在。

**此守衛的效力有明確上界，SHALL 被如實記載**：它擋的是「日後某次整理 `package.json` 時把設定
靜默拿掉」。它 SHALL NOT 被詮釋為「打包會成功」或「產物可執行」—— 它連一次打包都沒有執行過。
產物是否真的能用，只有實際打包並執行產物的驗收能回答。

#### Scenario: 關鍵設定齊備時守衛通過

- **WHEN** 在打包設定完整的情況下執行單元測試
- **THEN** 該守衛通過

#### Scenario: 移除 asarUnpack 時守衛失敗

- **WHEN** 自 `package.json` 移除 `build.asarUnpack` 的 `node-pty` 涵蓋後執行單元測試
- **THEN** 該守衛失敗

### Requirement: 打包產物於桌面環境啟動時仍能解析使用者的 agent CLI

自**桌面環境**（應用程式選單、檔案管理員、桌面捷徑）啟動的打包產物，其終端 session SHALL 能解析
到使用者 shell profile 所提供的可執行檔路徑 —— 包含 `claude` 本身。

桌面環境啟動的行程只繼承系統預設 PATH，不含使用者 profile 所加入的路徑（nvm、`~/.local/bin`
之屬）。此要求由既有的 login shell spawn 機制承擔，**而該機制的涵蓋範圍取決於 spawn 目標**：

- spawn 目標為 login shell 者，其 shell 掛在 pty 上為**互動** shell，會讀取只在互動時載入的 rc 檔
  （`.zshrc`、`.bashrc`），因此涵蓋由那些檔案初始化的版本管理器（nvm 之屬）。
- spawn 目標為 agent CLI 者，其 shell 以**非互動**方式執行一個命令，**不**讀取那些 rc 檔。該目標
  目前得以解析到 `claude`，是因為它安裝於 login rc 所提供的路徑；**若改安裝於僅由互動 rc 初始化的
  版本管理器之下，本要求的 scenario 會在桌面環境啟動時失敗** —— 此為已知缺口，追蹤於 issue #20。

**此要求 SHALL 以自桌面環境啟動的執行驗收，SHALL NOT 以自終端機啟動的執行替代。** 自終端機執行
產物時，它繼承該終端機的完整 PATH —— 於是 login shell 機制**有沒有生效完全看不出來**，驗收會在
機制失效的情況下依然通過。

#### Scenario: 自桌面環境啟動後可建立 agent session

- **WHEN** 自應用程式選單或檔案管理員（而非終端機）啟動打包產物，並於其中建立一個 agent session
- **THEN** `claude` 成功啟動並顯示其互動介面

### Requirement: 主行程代表使用者執行的外部程式亦解析使用者的 PATH

主行程本身（非終端 session）代表使用者 spawn 外部程式時，SHALL 能解析到使用者**互動** shell 所提供
的可執行檔路徑，包含只由互動 rc 初始化的版本管理器（nvm 之屬）所提供者。

上一條要求所倚賴的 login shell spawn 機制**對此無能為力** —— 那個機制作用於 pty，主行程自身的
`process.env.PATH` 不受它影響。

實作 SHALL 於程序啟動時**一次性**取得，且：

- SHALL 以**互動** shell 取得。非互動 shell 不讀取 `.zshrc` / `.bashrc`，取不到 nvm 之屬所提供的
  路徑。
- 取得的路徑 SHALL **前置**於既有 PATH，SHALL NOT 附加於其後。附加時外部程式雖被解析到，其
  `#!/usr/bin/env …` 之類的直譯器仍會解析到系統版本而失敗，**且該失敗與「未安裝」無法區分**。
- 既有 PATH 的項目 SHALL NOT 被移除（產物自身注入的路徑必須保留）。它們會被排到使用者路徑之後 ——
  這是刻意的，且**「不移除」不等於「不受影響」**。
- **SHALL 只對已知能以此方式安全查詢的 shell 執行**，其餘一律放棄。至少一種常見 shell（`fish`）的
  `PATH` 是一個 list 而非以分隔符連接的字串，對它套用同一種取值方式會**靜默地**取回不完整的路徑 ——
  沒有錯誤、只是少了大部分項目。
- SHALL NOT 阻塞視窗建立，SHALL 於逾時後放棄並維持原 PATH，且 SHALL 於放棄時**確保所生成的子行程
  被收掉**（否則每次啟動可能留下一個等待中的 shell）。
- 取得失敗、逾時、平台或 shell 不支援時，SHALL NOT 使任何功能失效 —— 倚賴它的功能一律有各自的退路。
- 套用 SHALL 只發生在**單一、確定的時點**，SHALL NOT 於某個功能的使用點才套用。主行程的環境會被
  其所 spawn 的一切繼承（含終端 session），在使用點套用會使「其他行程有沒有拿到修好的 PATH」取決於
  使用者是否先用過那個功能 —— 一個順序相依且靜默的差異。

**此要求 SHALL 以自桌面環境啟動的執行驗收，SHALL NOT 以自終端機啟動的執行替代**（理由同上一條）。

**驗收 SHALL 以「取不到權威順序時所呈現的說明是否出現」判定，SHALL NOT 以 artifact 的排列順序判定。**
排列順序不具鑑別力：可用的 schema 其宣告順序恰與敘事順序相同，於是「權威順序被取用」與「退路頂替」
產生完全相同的畫面。**該說明的有無與順序無關**，是這兩者唯一可觀察的差別。

判讀 SHALL 在啟動後**留出足夠的時間**再進行：資料來源對「取不到」的結果亦有數十秒的快取，啟動早期的
第一次讀取可能落在本要求的機制完成之前。機制真的失效時該說明會**持續存在**，成立時則至多出現於最初
的那段窗口。

自動化驗收 SHALL 涵蓋路徑合併與輸出解析的邏輯本身，但 SHALL NOT 被詮釋為「桌面環境啟動下確實解析
得到」。

#### Scenario: 主行程解析得到只由互動 rc 提供的可執行檔

- **WHEN** 自桌面環境啟動打包產物，而某個外部程式只存在於使用者互動 rc 所加入的路徑中
- **THEN** 主行程代表使用者執行該程式時解析得到它

#### Scenario: 使用者的路徑前置而非附加

- **WHEN** 合併使用者 PATH 與既有 PATH
- **THEN** 使用者 PATH 中既有 PATH 所無的項目排在既有項目之前，且既有項目一個都沒有被移除

#### Scenario: 無法安全查詢的 shell 一律放棄

- **WHEN** 使用者的 shell 不屬於已知能以此方式安全查詢者
- **THEN** 不變更 PATH，且不產生錯誤

#### Scenario: 取得失敗不致使功能失效

- **WHEN** 使用者 PATH 無法取得（shell 不可用、逾時、或平台不支援）
- **THEN** 主行程維持原 PATH 繼續運作，倚賴它的功能各自落到其退路

### Requirement: 開發模式與打包產物使用不同的使用者資料目錄

`npm run dev` 啟動的開發模式，其 `app.getPath('userData')` SHALL 解析到與打包產物**不同**的目錄。

此分離 SHALL 由啟動指令本身保證 —— SHALL NOT 僅以文件約定或執行者記得設定環境變數來達成。
需要開發模式的場合（追一支探針抓不到的行為、迭代版面）**正是最不會記得設定環境變數的場合**，
而遺漏的後果是靜默的：兩份執行各自落盤 session 清單，後寫的贏，使用者正在使用的 session 分頁
會消失而其 pty 仍存活。

此分離 SHALL NOT 以修改主行程的路徑解析達成。在主行程判斷「是否為開發模式」需要同時滿足兩個
條件才正確（依 dev server 的存在而非 `app.isPackaged`；命令列已指定使用者資料目錄時不得覆蓋），
而兩者失效時皆無徵狀 —— 後者更會壓掉每一支探針的隔離。

打包產物 SHALL 繼續解析到 `app-identity` 所規範的位置（即以 `productName` 命名的目錄），
使既有的使用者設定為打包產物所沿用。

#### Scenario: 開發模式的啟動指令自身宣告了資料目錄的隔離

- **WHEN** 讀取版控中 `package.json` 的 `dev` script
- **THEN** 該指令設定了使 `userData` 解析至他處的環境變數，而非僅在文件中記載該做法

#### Scenario: 該環境變數確實改變 userData 的解析結果

- **WHEN** 於設定與未設定該環境變數的兩種情況下各啟動一次 Electron，並讀取
  `app.getPath('userData')`
- **THEN** 兩次解析出不同的路徑，且設定時的路徑位於該環境變數所指的目錄之下

### Requirement: 產物的執行前提與逃生口見於文件

`README` SHALL 記載打包與執行產物所需的前提，以及前提不成立時的逃生口。至少涵蓋：

- 執行 AppImage 需要 `libfuse2`（Ubuntu 22.04 起預設不再安裝）。缺少時的失敗訊息指向動態連結器
  而非套件缺失，讀起來像「這個 app 壞了」。
- 上述情況的逃生口：以 `--appimage-extract-and-run` 執行（不經 fuse）。
- 首次打包需要網路（下載 Electron binary）。

一個只有作者知道的逃生口等於沒有逃生口 —— 而這幾條的共同特徵是**失敗訊息不會指向真正的原因**。

#### Scenario: README 記載執行前提與逃生口

- **WHEN** 閱讀 `README`
- **THEN** 其中記載 `libfuse2` 的前提、`--appimage-extract-and-run` 的逃生口，以及首次打包的網路
  需求
