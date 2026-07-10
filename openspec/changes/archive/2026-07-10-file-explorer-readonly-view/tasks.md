## 1. 主行程的導航防護（先做，其餘 UI 的前提）

- [x] 1.1 建立視窗時阻止 renderer 導航離開應用程式來源；阻止開啟新視窗
- [x] 1.2 外部連結交由系統預設瀏覽器開啟，並於主行程驗證協定，僅放行 `http` 與 `https`
- [x] 1.3 renderer 不得自行決定哪些連結安全 —— 協定驗證只在主行程執行
- [x] 1.4 單元測試涵蓋協定驗證：`javascript:`、`file:`、`data:` 一律拒絕，`http`／`https` 放行

## 2. `listDir` 擴充與 `readFile`

- [x] 2.1 `listDir` 的每個項目增加最後修改時間，以數值時間戳回傳（不回傳已格式化的字串）
- [x] 2.2 建立 `readFile(folderId, relPath)`，邊界沿用既有的 `resolveWithinRoot`
- [x] 2.3 先取得檔案大小再決定是否讀取；超過上限即拒絕，**不得**先讀入記憶體
- [x] 2.4 上限定為 2 MiB，並於程式碼中註明其必須低於編輯器停止語法標記的門檻（20 MB）
- [x] 2.5 二進位偵測：檔案開頭 8000 bytes（或整個檔案，取其小者）內出現 NUL 即拒絕
- [x] 2.6 內容以 UTF-8 解碼並去除 BOM
- [x] 2.7 目標為目錄或不存在時回報錯誤，而非回傳空內容
- [x] 2.8 單元測試：邊界逃逸（絕對路徑、`..`、symlink）、過大、二進位（NUL 在 7999 與 9000 兩種位置）、目錄、BOM

## 3. 檔案監控（`watch` / `unwatch`）

- [x] 3.1 加入 `chokidar` 依賴（runtime 依賴，非 devDependency）
- [x] 3.2 建立 watcher 服務：每個 workspace folder 一個 chokidar 實例，`depth: 0`
- [x] 3.3 `watch(folderId, relPath)` 對已解析的絕對路徑呼叫 `watcher.add`；`unwatch` 對應 `watcher.unwatch`
- [x] 3.4 `followSymlinks: false` —— chokidar 的預設為 `true`，會跟隨 symlink 走出 workspace folder
- [x] 3.5 polling 決策取自 `@spekjs/core` 的 `shouldUsePolling` 與 `pollingInterval`
- [x] 3.6 以 core 的 `withAuthoritativeChokidarEnv` 包住 watcher 的建立，且該 callback **必須同步**（只呼叫 `chokidar.watch(...)`，不得 `await`）
- [x] 3.7 事件的絕對路徑轉為 `(folderId, relPath)` 後才推送；轉換前再過一次邊界檢查，落在邊界外者丟棄
- [x] 3.8 事件以每個 folder 為單位合批後推送，避免單次批次寫入造成逐檔推送
- [x] 3.9 watcher 的生命週期綁定 `webContents`：銷毀時全部釋放
- [x] 3.10 renderer 重新載入時清空其監看集合 —— 重新載入不會銷毀 `webContents`，不得只依賴銷毀事件
- [x] 3.11 folder 自 workspace 移除時，釋放其 watcher
- [x] 3.12 單元測試：事件路徑的邊界過濾、dispose 契約（釋放後不再推送）、重複 `watch` 同一目錄不重複建立
- [x] 3.13 訂閱（樹上的 relPath）與監看（磁碟上的 realpath）分層，以參考計數對接：`watcher.add` 只在第一個訂閱者出現時呼叫、`watcher.unwatch` 只在最後一個離開時呼叫
- [x] 3.14 事件以**訂閱者使用的路徑**改寫後推送 —— folder 內的 symlink 目錄在樹上是獨立節點，不得收到目標目錄的真實路徑
- [x] 3.15 單元測試：symlink 別名（兩個節點、一個目錄）的事件歸屬、收合其一不影響另一、最後一個訂閱者離開才停止監看

## 4. preload 白名單

- [x] 4.1 擴充為 `fs.readFile`、`fs.watch`、`fs.unwatch`，以及變更事件的訂閱介面
- [x] 4.2 訂閱介面回傳取消訂閱的函式，且不得把 `ipcRenderer` 洩漏給 renderer
- [x] 4.3 同步更新 `src/preload/index.d.ts`
- [x] 4.4 介面上不得出現 `writeFile`、刪除或其他未經本 change 定義邊界要求的能力

## 5. 編輯器 wrapper 改造

- [x] 5.1 移除 `import 'monaco-editor/esm/vs/editor/editor.all.js'` —— 實測證明它沒有作用（`basic-languages/_.contribution.js` 已 import 整套 editor contribution），並更正該處註解
- [x] 5.2 移除 `language/typescript` 的 contribution 與 `ts.worker`
- [x] 5.3 改為引用全部 `basic-languages/*` 的 contribution（每種語言為獨立的延遲載入資產）
- [x] 5.4 `MonacoEnvironment.getWorker` 只回傳 `editor.worker`
- [x] 5.5 wrapper 對外介面不洩漏編輯器套件的型別；語言以字串表示，由副檔名判定
- [x] 5.6 無法對應語言的副檔名以純文字呈現，不拒絕開啟
- [x] 5.7 確認 renderer 中仍只有 wrapper 直接 import `monaco-editor`（eslint `no-restricted-imports` 已在守）

## 6. renderer：side panel 的兩個身分

- [x] 6.1 repo header 加入身分切換入口（OpenSpec ／ Files），當前身分於入口上可辨識
- [x] 6.2 一次只顯示一個身分；side panel 收合時觸發任一身分皆重新展開
- [x] 6.3 選中的 folder 不含 `openspec/` 時，OpenSpec 入口為停用狀態且可被輔助技術辨識；停用的入口不改變當前身分
- [x] 6.4 Phase 2 的預設身分為 Files（OpenSpec 尚無內容）；於程式碼註明 Phase 5 應改回雛型的預設
- [x] 6.5 OpenSpec 身分維持佔位內容

## 7. renderer：檔案樹

- [x] 7.1 建立檔案樹元件，根目錄預設展開，目錄與檔案可被區分
- [x] 7.2 未選中任何 folder 時呈現說明此狀態的提示
- [x] 7.3 展開目錄時才呼叫 `listDir`；已載入的子樹於收合後保留，再次展開時立即以快取呈現，並於背景靜默重新列出（收合期間未監看，`ignoreInitial` 不補報，快取可能過期）
- [x] 7.4 以 relPath 為 key 的 in-flight 集合：重複請求不重發；載入中又被要求重載則於該輪結束後補跑；回應抵達時該節點已收合則不顯現
- [x] 7.5 每列呈現相對修改時間，於 renderer 以 `Intl.RelativeTimeFormat`（`zh-TW`）依當下時刻計算
- [x] 7.6 排序為目錄優先、其次名稱（`Intl.Collator`）
- [x] 7.7 面板 header 呈現當前可見的項目數，隨展開／收合更新
- [x] 7.8 展開目錄時 `watch`、收合時 `unwatch`；監看集合恆等於展開集合
- [x] 7.9 **先訂閱、再列目錄**：對帳的 effect 於 `watch` 成功後才 `listDir`，使「列完」到「訂閱生效」之間的變更不致兩頭落空；`activate` 只改展開狀態，不觸發載入
- [x] 7.10 對帳集合以 JSON 為 effect 的相依 key，不以分隔符串接（Linux 檔名可含換行字元）
- [x] 7.11 依變更事件更新樹：新增、刪除、內容變更、目錄的新增與刪除
- [x] 7.12 symlink 以獨立種類呈現；展開指向 folder 外的 symlink 目錄時失敗並說明其超出 workspace 邊界
- [x] 7.13 樹的視覺狀態對齊雛型的 `.file-tree`（展開／收合字符、深度縮排、目錄名稱較醒目）

## 8. renderer：檔案檢視

- [x] 8.1 點選檔案時 Files 身分換頁為檔案內容；不佔用主舞台
- [x] 8.2 路徑導覽反映當前檔案位置，並提供返回檔案樹的入口；返回後樹的展開狀態不變
- [x] 8.3 markdown 以 `react-markdown` + `remark-gfm` 渲染
- [x] 8.4 **不得**加入 `rehype-raw`；原始 HTML 以純文字呈現
- [x] 8.5 **不得**覆寫 `urlTransform`；不安全協定的連結被清除
- [x] 8.6 markdown 中的外部連結交由第 1 節的主行程管道以系統瀏覽器開啟
- [x] 8.7 其餘文字檔以唯讀編輯器呈現，語言依副檔名判定
- [x] 8.8 過大與二進位的檔案呈現拒絕的原因（含上限值），不呈現任何內容片段
- [x] 8.9 檢視中的檔案於磁碟被改動時提示內容已過期並提供重新載入入口；被刪除時明確標示
- [x] 8.10 檢視為唯讀，使用者無法修改內容

## 9. 量測與探針

- [x] 9.1 `measure:bundle` 改為可歸因：分別列出編輯器核心產物、worker 資產、各語言資產的體積，並與總體積相比較
- [x] 9.2 加入斷言或報告項：建置產物中不存在 TypeScript／JSON／CSS／HTML 的語言服務 worker
- [x] 9.3 探針驗證身分切換與 OpenSpec 停用態（以真實 folder，含與不含 `openspec/` 兩種）
- [x] 9.4 探針驗證樹的 lazy load：未展開的目錄不產生 `listDir` 呼叫
- [x] 9.5 探針驗證外部變更：於磁碟新增／刪除檔案後樹隨之更新
- [x] 9.6 探針驗證 `readFile` 的拒絕條件（過大、二進位）於真實 UI 上的呈現
- [x] 9.7 探針驗證 worker 往返：開啟含 URL 的檔案，編輯器中出現由 worker 計算的連結標示；dev 與 build 兩種模式皆須通過
- [x] 9.8 探針驗證導航防護：觸發指向外部位址的連結後，renderer 仍停留於原頁面
- [x] 9.9 驗證 watcher 不洩漏：未採用 `/proc/<pid>/fdinfo` 數 inotify watch descriptor（跨 pid 讀 fd 在 sandbox 下不可靠，且量的是實作細節）。改以釋放契約的單元測試 + 探針的「收合後不再更新」行為斷言涵蓋；結論記於 design
- [x] 9.10 探針 fixture 加入 symlink：一個指向 folder 內部、一個指向外部。少了它，watcher 的別名 bug 會躲過整輪驗收
- [x] 9.11 探針驗證 renderer 重新載入後監看集合重建（樹仍隨磁碟更新）
- [x] 9.12 探針驗證未知副檔名以純文字呈現、檢視為唯讀（實際送出輸入後內容不變）、未選中 folder 時的提示
- [x] 9.13 探針驗證快取與競態：再次展開以快取立即呈現（於 microtask 後即可見，IPC 不可能那麼快）、收合期間的變更於再次展開後被校正、載入完成前收合不使內容顯現
- [x] 9.14 `measure:bundle` 斷言分類之和等於資產總計、語言資產為多個獨立的延遲載入 chunk

## 10. 驗證與文件回寫

- [x] 10.1 `npm run typecheck` 通過
- [x] 10.2 `npm run lint` 通過
- [x] 10.3 `npm test` 通過
- [x] 10.4 `docs/PRD.md` §11 的 Phase 2 條目改寫：「全域 tab manager」改為「side panel 內的檔案檢視」；§5 的 F3 條目一併對齊
- [x] 10.5 `openspec/config.yaml` 的 `context:` 更新（Phase 1 已封存、Phase 2 實作中；monaco 已被引用；chokidar 已安裝）
- [x] 10.6 `CLAUDE.md` 更新：Phase 1 已封存、Phase 2 現況、Monaco 債已償還、新增的 chokidar 與 markdown 依賴、開發指令
- [x] 10.7 `CLAUDE.md` 記錄本 change 推翻的假設：`editor.all.js` 的 import 無作用；chokidar `followSymlinks` 預設為 `true`；渲染 markdown 若無導航防護會使 preload 白名單外洩
- [x] 10.8 `README.md` 的現況段落更新
