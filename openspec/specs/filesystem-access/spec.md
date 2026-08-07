## Purpose

主行程對 renderer 暴露的檔案系統能力。核心要求不是「能列目錄」，而是**能力受 workspace
folder 邊界約束** —— renderer 以 `(folderId, relPath)` 定址，在語彙上無法表達邊界外的位置；
邊界檢查一律在主行程執行。後續 Phase 的 `readFile` / `writeFile` 都長在這條要求上。
## Requirements
### Requirement: renderer 以 folder 識別碼定址檔案系統，不得傳遞絕對路徑

renderer 存取檔案系統的能力 SHALL 以 `(folderId, relPath)` 定址：`folderId` 指向一個已加入 workspace 的 folder，`relPath` 是相對於該 folder 根目錄的路徑。renderer SHALL NOT 傳遞絕對路徑。

此定址方式使 renderer 在語彙上無法表達邊界外的位置 —— 邊界由結構保證，而非由字串驗證事後補救。

#### Scenario: 以相對路徑列出子目錄

- **WHEN** renderer 對一個已加入的 folder 呼叫 `listDir`，`relPath` 指向其中一個子目錄
- **THEN** 回傳該子目錄的項目清單

#### Scenario: 拒絕絕對路徑

- **WHEN** `relPath` 是絕對路徑
- **THEN** 呼叫被拒絕並回報錯誤，不回傳任何目錄內容

#### Scenario: 拒絕未註冊的 folder 識別碼

- **WHEN** `folderId` 不對應任何已加入 workspace 的 folder
- **THEN** 呼叫被拒絕並回報錯誤

### Requirement: 路徑不得逃逸出 workspace folder 的邊界

解析後的目標路徑 SHALL 位於該 folder 根目錄之內，否則呼叫 SHALL 被拒絕。判定 SHALL 在解析 symlink 之後進行，且 SHALL NOT 以字串前綴比對實作 —— 前綴比對會把 `/a/bc` 誤判為位於 `/a/b` 之內。

邊界檢查 SHALL 在主行程執行。preload 與 renderer 位於同一個行程樹，於該處檢查等同沒有檢查。

#### Scenario: 拒絕以上層參照逃逸

- **WHEN** `relPath` 含有 `..`，且解析後落在 folder 根目錄之外
- **THEN** 呼叫被拒絕並回報錯誤

#### Scenario: 拒絕經由 symlink 逃逸

- **WHEN** folder 之內存在一個 symlink，其真實路徑落在 folder 根目錄之外，且 `relPath` 指向它
- **THEN** 呼叫被拒絕並回報錯誤

#### Scenario: 兄弟目錄不得被誤判為位於邊界之內

- **WHEN** 一個目錄的路徑以 folder 根目錄的路徑為字串前綴，但並非其子目錄（例如根目錄為 `/a/b`，目標為 `/a/bc`）
- **THEN** 呼叫被拒絕並回報錯誤

#### Scenario: 邊界檢查不因呼叫來源而略過

- **WHEN** 以越界的參數呼叫主行程的檔案系統處理常式
- **THEN** 無論呼叫來自何處，皆被拒絕並回報錯誤

### Requirement: listDir 回報目錄項目及其種類

`listDir` SHALL 回傳目標目錄的直接子項目，每個項目 SHALL 標明名稱、種類（檔案、目錄、符號連結、其他）與最後修改時間。它 SHALL NOT 遞迴。

最後修改時間 SHALL 以數值時間戳回傳，SHALL NOT 回傳已格式化的相對時間字串 —— 格式化牽涉語言與當下時刻，屬於呈現層的職責。

#### Scenario: 回報混合種類的目錄

- **WHEN** 目標目錄同時含有檔案、子目錄與符號連結
- **THEN** 回傳的每個項目標明其名稱、對應的種類與最後修改時間，且不包含子目錄之下的項目

#### Scenario: 最後修改時間為數值時間戳

- **WHEN** 檢視 `listDir` 回傳的任一項目
- **THEN** 其最後修改時間為數值時間戳，而非「2 小時前」之類的字串

#### Scenario: 目標不是目錄

- **WHEN** `relPath` 指向一個檔案，或指向不存在的路徑
- **THEN** 呼叫被拒絕並回報錯誤，而非回傳空清單

### Requirement: readFile 讀取 workspace folder 內的文字檔案內容

`readFile` SHALL 以 `(folderId, relPath)` 定址並回傳目標檔案的文字內容。它 SHALL 受與 `listDir` 相同的邊界約束：絕對路徑、以 `..` 逃逸、經 symlink 逃逸、未註冊的 `folderId` 一律拒絕。

`readFile` SHALL 在讀取內容之前先取得檔案大小，並在超過上限時直接拒絕 —— SHALL NOT 先將檔案讀入記憶體再判斷。

#### Scenario: 讀取文字檔案

- **WHEN** renderer 對一個已加入的 folder 呼叫 `readFile`，`relPath` 指向其中一個大小在上限之內的文字檔案
- **THEN** 回傳該檔案的文字內容

#### Scenario: 拒絕逃逸出邊界的路徑

- **WHEN** `readFile` 的 `relPath` 為絕對路徑、含 `..` 且解析後落在 folder 之外、或指向一個真實路徑落在 folder 之外的 symlink
- **THEN** 呼叫被拒絕並回報錯誤，不回傳任何內容

#### Scenario: 目標不是檔案

- **WHEN** `relPath` 指向一個目錄，或指向不存在的路徑
- **THEN** 呼叫被拒絕並回報錯誤

### Requirement: readFile 拒絕過大的檔案

`readFile` SHALL 定義一個檔案大小上限，超過者一律拒絕並回報「過大」與該上限。它 SHALL NOT 截斷內容後回傳。

該上限 SHALL 低於編輯器停止進行語法標記的門檻 —— 否則被接受的檔案將無法滿足「檢視器提供語法高亮」的要求。

#### Scenario: 超過上限的檔案

- **WHEN** `relPath` 指向一個大小超過上限的檔案
- **THEN** 呼叫被拒絕，錯誤明確指出檔案過大，且不回傳任何內容片段

#### Scenario: 上限低於編輯器的語法標記門檻

- **WHEN** 檢視 `readFile` 採用的大小上限
- **THEN** 該上限小於編輯器停止進行語法標記的檔案大小門檻

### Requirement: readFile 拒絕二進位檔案

`readFile` SHALL 判定目標是否為二進位檔案：檔案開頭一段位元組（不少於前 8000 bytes 或整個檔案，取其小者）中若出現 NUL，即視為二進位。二進位檔案 SHALL 被拒絕並回報其原因。

此判準與 `git` 一致 —— 於前 8000 bytes 內出現 NUL 即視為二進位。

#### Scenario: 開頭含 NUL 的檔案

- **WHEN** `relPath` 指向一個在前 8000 bytes 內含有 NUL 位元組的檔案
- **THEN** 呼叫被拒絕，錯誤明確指出該檔案為二進位

#### Scenario: NUL 出現在判定範圍之外

- **WHEN** `relPath` 指向一個文字檔案，其唯一的 NUL 位元組出現在第 8000 bytes 之後
- **THEN** 該檔案被視為文字並回傳其內容

### Requirement: watch 監看目錄變更並將事件推送至 renderer

主行程 SHALL 提供 `watch(folderId, relPath)` 與 `unwatch(folderId, relPath)`，使 renderer 得以訂閱與取消訂閱某個目錄的**直接子項目**變更。變更事件 SHALL 由主行程推送至 renderer。

事件 SHALL 涵蓋子項目的新增、刪除與內容變更，並區分檔案與目錄。

#### Scenario: 監看中的目錄新增檔案

- **WHEN** renderer 監看某目錄，其後該目錄中新增一個檔案
- **THEN** renderer 收到一則指出該項目被新增的事件

#### Scenario: 取消監看後不再收到事件

- **WHEN** renderer 對某目錄呼叫 `unwatch`，其後該目錄的內容發生變更
- **THEN** renderer 不再收到該目錄的任何事件

#### Scenario: 未被監看的子目錄不產生事件

- **WHEN** 某個被監看目錄之下、未被監看的子目錄中，其內容發生變更
- **THEN** renderer 不會收到該變更的事件

#### Scenario: 同一目錄被多個路徑訂閱時各自獨立

- **WHEN** renderer 同時以某目錄的路徑、以及 folder 內一個指向該目錄的 symlink 路徑監看它，其後取消其中一個訂閱
- **THEN** 另一個訂閱仍持續收到該目錄的變更事件

取消一個訂閱 SHALL NOT 影響仍存在的其他訂閱 —— 底層的監看以磁碟上的真實路徑進行，而訂閱以 renderer 使用的路徑計數。

### Requirement: 推送的事件以 folder 識別碼與相對路徑表達

推送至 renderer 的每一則變更事件 SHALL 以 `(folderId, relPath)` 表達受影響的項目。事件 SHALL NOT 包含絕對路徑。

主行程 SHALL 在推送之前確認該路徑位於對應 folder 的邊界之內，落在邊界之外的事件 SHALL 被丟棄。這與 `listDir` 的邊界檢查同源：renderer 只能收到它有詞彙表達的位置。

#### Scenario: 事件不含絕對路徑

- **WHEN** renderer 收到一則變更事件
- **THEN** 該事件以 folder 識別碼與相對路徑指出受影響的項目，其中不含 folder 根目錄以外的路徑資訊

#### Scenario: 監看不跟隨指向邊界外的 symlink

- **WHEN** 一個被監看的目錄之下存在指向 folder 根目錄之外的 symlink，且該 symlink 的目標內容發生變更
- **THEN** renderer 不會收到任何指向邊界之外的事件

#### Scenario: 事件以訂閱者使用的路徑表達

- **WHEN** renderer 經由一個指向 folder 內部另一個目錄的 symlink 路徑監看該目錄，其後該目錄中新增一個檔案
- **THEN** 事件的相對路徑以 renderer 訂閱時使用的路徑表達，而非該目錄在磁碟上的真實路徑

renderer 以樹上的位址認識檔案系統。以真實路徑回報，等於交給它一個認不得的位址。

### Requirement: watcher 隨其 renderer 的生命週期釋放

主行程為某個 renderer 建立的 watcher SHALL 於該 renderer 銷毀時全部釋放。renderer 重新載入時，其先前的監看集合 SHALL 被清空 —— 重新載入不會銷毀 `webContents`，因此不得只依賴銷毀事件。

#### Scenario: renderer 銷毀時釋放 watcher

- **WHEN** 承載 renderer 的視窗被關閉
- **THEN** 該 renderer 建立的所有 watcher 皆被釋放

#### Scenario: renderer 重新載入時清空監看集合

- **WHEN** renderer 監看若干目錄之後重新載入頁面
- **THEN** 先前的監看集合被清空，主行程持有的 watcher 數量不因反覆重新載入而累積

### Requirement: 檔案系統能力僅暴露已為其定義邊界要求的操作

暴露給 renderer 的檔案系統能力 SHALL 僅含本規格已定義邊界要求的操作。任何新的檔案系統能力 SHALL NOT 出現於 renderer 可觸及的介面上，直到後續 change 明確引入並為其定義邊界要求。

這條要求的形式是「白名單」而非「清單」—— 它約束的不是當下有哪幾個函式，而是**任何函式進入介面之前，都必須先有邊界要求**。

#### Scenario: 介面上只有已定義邊界要求的能力

- **WHEN** 於 renderer 檢視 preload 暴露的檔案系統介面
- **THEN** 其上只有 `listDir`、`listFiles`、`readFile`、`writeFile`、`createFile`、`createDirectory`、`deleteEntry`、`rename`、`watch`、`unwatch` 與變更事件的訂閱介面 `onWatchEvent`，不存在建立符號連結、變更權限或其他未經本規格定義邊界要求的能力
### Requirement: 寫入類操作的路徑解析與開啟不可分割

任何會改變磁碟狀態的操作（寫入、建立、刪除、改名）SHALL 以解析 symlink 之後的真實路徑執行，且 SHALL 在開啟目標時關閉最後一段的符號解析，使「檢查」與「使用」之間無法插入一個指向 folder 之外的符號連結。

讀取所採用的「先檢查、再依原路徑開啟」SHALL NOT 被寫入沿用 —— 該寫法在寫入時已被證明會逸出邊界：檢查通過之後、開啟之前，若目標被替換為指向 folder 之外的符號連結，寫入將落在該連結的目標上。

在不提供該機制的平台上，實作 SHALL 於開啟之前再次確認目標不是符號連結。此為窗口更窄的替代，SHALL NOT 被描述為等價的防護。

#### Scenario: 解析與開啟之間目標被替換為越界的符號連結

- **WHEN** 一個寫入類操作的目標在其路徑解析完成之後、開啟之前，被替換為指向 workspace folder 之外的符號連結
- **THEN** 該操作失敗，且 folder 之外的檔案內容不被修改

#### Scenario: 對指向邊界外的符號連結寫入

- **WHEN** `writeFile` 的 `relPath` 指向一個真實路徑落在 folder 之外的符號連結
- **THEN** 呼叫被拒絕並回報錯誤，且該連結的目標不被修改

### Requirement: renderer 不得取得建立或操縱符號連結的能力

暴露給 renderer 的檔案系統介面 SHALL NOT 包含建立符號連結的能力。

寫入類操作 SHALL 以解析 symlink 之後的真實路徑判定邊界，**包含路徑的最後一段**。任何解析後落在 folder 之外的目標 SHALL 被拒絕，即使該路徑的最後一段本身位於 folder 之內。

因此 renderer SHALL NOT 能對一個指向 folder 之外的符號連結執行改名或刪除 —— 它無法建立這樣的連結，也無法搬動既有的連結。這是「路徑中間段的替換無法被機制防護」得以被接受的**前提**：構成該替換所需的符號連結，renderer 既造不出、也碰不到。

#### Scenario: 介面上不存在建立符號連結的能力

- **WHEN** 於 renderer 檢視 preload 暴露的檔案系統介面
- **THEN** 其上不存在任何建立符號連結的能力

#### Scenario: 拒絕改名指向邊界外的符號連結

- **WHEN** folder 內存在一個指向 folder 之外的符號連結，renderer 對其呼叫 `rename`
- **THEN** 呼叫被拒絕並回報錯誤，該連結不被搬動

#### Scenario: 拒絕刪除指向邊界外的符號連結

- **WHEN** folder 內存在一個指向 folder 之外的符號連結，renderer 對其呼叫 `deleteEntry`
- **THEN** 呼叫被拒絕並回報錯誤

### Requirement: writeFile 覆寫 workspace folder 內既有檔案的內容

`writeFile` SHALL 以 `(folderId, relPath)` 定址，將給定的文字內容寫入一個**既有的**檔案。它 SHALL 受與 `listDir` 相同的邊界約束：絕對路徑、以 `..` 逃逸、經 symlink 逃逸、未註冊的 `folderId` 一律拒絕。

目標不存在時 SHALL 被拒絕 —— 建立檔案是 `createFile` 的職責。目標為目錄時 SHALL 被拒絕。

`writeFile` SHALL 就地寫入目標檔案，SHALL NOT 以「寫入暫存檔後改名取代」的方式實作。後者會把使用者 repo 內的符號連結取代為普通檔案、斷開 hard link，並使一次存檔在監看器上呈現為「刪除後新增」而非「內容變更」。

#### Scenario: 覆寫既有檔案

- **WHEN** renderer 對一個已加入的 folder 呼叫 `writeFile`，`relPath` 指向其中一個既有的文字檔案
- **THEN** 該檔案的內容被替換為給定的內容

#### Scenario: 目標不存在

- **WHEN** `writeFile` 的 `relPath` 指向一個不存在的路徑
- **THEN** 呼叫被拒絕並回報錯誤，且不建立任何檔案

#### Scenario: 目標是目錄

- **WHEN** `writeFile` 的 `relPath` 指向一個目錄
- **THEN** 呼叫被拒絕並回報錯誤

#### Scenario: 拒絕逃逸出邊界的路徑

- **WHEN** `writeFile` 的 `relPath` 為絕對路徑、含 `..` 且解析後落在 folder 之外、或指向一個真實路徑落在 folder 之外的符號連結
- **THEN** 呼叫被拒絕並回報錯誤，且不寫入任何內容

#### Scenario: 寫入不取代 folder 內的符號連結

- **WHEN** `relPath` 指向一個 folder 內、且其目標亦位於該 folder 內的符號連結，並對其呼叫 `writeFile`
- **THEN** 該路徑仍是符號連結，且其目標檔案的內容被更新

### Requirement: writeFile 以基準時間戳偵測衝突，衝突時拒絕寫入

`writeFile` SHALL 接受一個基準修改時間（開啟該檔案時磁碟上的 `mtime`）。寫入之前 SHALL 比對目標當下的 `mtime`：若兩者不符，呼叫 SHALL 被拒絕並回報衝突與磁碟當下的 `mtime`，且 SHALL NOT 寫入任何內容。

呼叫端 SHALL 能以省略基準時間戳的方式明確要求覆寫。

此機制偵測衝突，SHALL NOT 被描述為互斥鎖 —— 比對與寫入之間仍存在窗口，其後果是覆蓋而非逸出邊界。

#### Scenario: 磁碟上的檔案已被改動

- **WHEN** renderer 以某個基準修改時間呼叫 `writeFile`，而目標檔案在此之前已被 app 之外的程序改動
- **THEN** 呼叫被拒絕，錯誤指出發生衝突並帶有磁碟當下的修改時間，且檔案內容不被修改

#### Scenario: 明確要求覆寫

- **WHEN** renderer 省略基準修改時間呼叫 `writeFile`
- **THEN** 內容被寫入，不進行比對

#### Scenario: 基準時間戳相符

- **WHEN** renderer 以與磁碟一致的基準修改時間呼叫 `writeFile`
- **THEN** 內容被寫入

### Requirement: createFile 建立新的空檔案

`createFile` SHALL 於 workspace folder 內建立一個空的普通檔案，受與 `writeFile` 相同的邊界約束。

目標已存在時 SHALL 被拒絕 —— 判定 SHALL 以路徑本身為準，**既有的符號連結亦視為已存在**，因此 `createFile` SHALL NOT 寫穿一個既存的符號連結。

`createFile` SHALL 只建立普通檔案。

#### Scenario: 建立新檔案

- **WHEN** renderer 對一個不存在的路徑呼叫 `createFile`
- **THEN** 該路徑出現一個空的普通檔案

#### Scenario: 目標已存在

- **WHEN** `createFile` 的 `relPath` 指向一個既有的檔案或目錄
- **THEN** 呼叫被拒絕並回報錯誤，且既有項目的內容不被修改

#### Scenario: 目標是既有的符號連結

- **WHEN** `createFile` 的 `relPath` 指向一個既有的符號連結
- **THEN** 呼叫被拒絕並回報錯誤，且該連結的目標不被建立或修改

#### Scenario: 父目錄不存在

- **WHEN** `createFile` 的 `relPath` 其父目錄不存在
- **THEN** 呼叫被拒絕並回報錯誤，SHALL NOT 自動建立中間目錄

### Requirement: createDirectory 建立新的目錄

`createDirectory` SHALL 於 workspace folder 內建立一個目錄，受與 `writeFile` 相同的邊界約束。目標已存在時 SHALL 被拒絕。父目錄不存在時 SHALL 被拒絕，SHALL NOT 自動建立中間目錄。

#### Scenario: 建立新目錄

- **WHEN** renderer 對一個不存在的路徑呼叫 `createDirectory`
- **THEN** 該路徑出現一個空目錄

#### Scenario: 目標已存在

- **WHEN** `createDirectory` 的 `relPath` 指向一個既有的檔案或目錄
- **THEN** 呼叫被拒絕並回報錯誤

### Requirement: deleteEntry 刪除檔案或目錄

`deleteEntry` SHALL 刪除 workspace folder 內的一個檔案或目錄，受與 `writeFile` 相同的邊界約束。

刪除目錄 SHALL 為遞迴，且 SHALL NOT 跟隨其中的符號連結 —— 位於 folder 之外的內容不因刪除 folder 內的目錄而被移除。

#### Scenario: 刪除檔案

- **WHEN** renderer 對一個既有檔案呼叫 `deleteEntry`
- **THEN** 該檔案自磁碟移除

#### Scenario: 遞迴刪除非空目錄

- **WHEN** renderer 對一個含有子項目的目錄呼叫 `deleteEntry`
- **THEN** 該目錄及其所有子項目自磁碟移除

#### Scenario: 遞迴刪除不跟隨符號連結

- **WHEN** 被刪除的目錄之中含有一個指向其外部的符號連結，對該目錄呼叫 `deleteEntry`
- **THEN** 該符號連結被移除，但其目標及目標之下的內容不被移除

#### Scenario: 拒絕逃逸出邊界的路徑

- **WHEN** `deleteEntry` 的 `relPath` 解析後落在 folder 之外
- **THEN** 呼叫被拒絕並回報錯誤，且不移除任何項目

### Requirement: rename 變更項目的名稱或位置

`rename` SHALL 變更 workspace folder 內一個項目的名稱或位置。**來源與目標兩端**皆 SHALL 受邊界約束：任一端解析後落在 folder 之外時，呼叫 SHALL 被拒絕。

目標已存在時 SHALL 被拒絕，且此判定 SHALL 於改名之前執行 —— 底層的改名操作會無聲覆蓋既有的目標。

#### Scenario: 變更檔案名稱

- **WHEN** renderer 對一個既有檔案呼叫 `rename`，目標為同一目錄下一個不存在的名稱
- **THEN** 該檔案以新名稱存在，舊名稱不再存在

#### Scenario: 移動至另一個目錄

- **WHEN** `rename` 的目標位於 folder 內的另一個既有目錄之下
- **THEN** 該項目出現於新位置，舊位置不再存在

#### Scenario: 目標已存在

- **WHEN** `rename` 的目標路徑已存在一個檔案或目錄
- **THEN** 呼叫被拒絕並回報錯誤，且既有目標的內容不被修改

#### Scenario: 目標逃逸出邊界

- **WHEN** `rename` 的目標解析後落在 folder 之外
- **THEN** 呼叫被拒絕並回報錯誤，且來源不被搬動

### Requirement: 新項目的名稱在建立之前於主行程被驗證

`createFile`、`createDirectory` 與 `rename` 所使用的名稱 SHALL 於主行程驗證，SHALL NOT 僅依賴 renderer 的檢查。

名稱 SHALL NOT 為空、SHALL NOT 為 `.` 或 `..`、SHALL NOT 含有路徑分隔符或 NUL、SHALL NOT 以空白或 `.` 結尾、SHALL NOT 為作業系統的保留名稱。

驗證規則 SHALL 採目標平台的交集，而非當下執行平台的規則 —— 在某個平台上放行一個其他平台無法開啟的名稱，等於製造一個只在部分機器上損壞的 repo。

#### Scenario: 拒絕含路徑分隔符的名稱

- **WHEN** 以一個含有路徑分隔符的名稱呼叫 `createFile`
- **THEN** 呼叫被拒絕並回報錯誤

#### Scenario: 拒絕在其他平台為保留字的名稱

- **WHEN** 於任一平台以一個屬於其他目標平台保留名稱的名稱呼叫 `createFile`
- **THEN** 呼叫被拒絕並回報錯誤

#### Scenario: 拒絕以句點或空白結尾的名稱

- **WHEN** 以一個結尾為 `.` 或空白的名稱呼叫 `createDirectory`
- **THEN** 呼叫被拒絕並回報錯誤

### Requirement: 應用程式自身造成的檔案變更不推送為外部變更事件

主行程 SHALL 抑制由自身寫入操作所觸發的監看事件，使 renderer SHALL NOT 因為自己的存檔而收到該檔案的外部變更事件。

抑制 SHALL 在主行程執行。renderer SHALL NOT 需要辨識哪些事件源自它自己的呼叫。

抑制 SHALL 有時限，且 SHALL NOT 抑制在寫入完成之後由其他程序造成的變更。

#### Scenario: 存檔不觸發外部變更事件

- **WHEN** renderer 監看某目錄，並對該目錄中的一個檔案呼叫 `writeFile` 且寫入成功
- **THEN** renderer 不會收到該檔案的變更事件

#### Scenario: 存檔之後的外部變更仍被推送

- **WHEN** renderer 對一個檔案存檔成功，其後該檔案由 app 之外的程序改動
- **THEN** renderer 收到該檔案的變更事件

### Requirement: listFiles 遞迴列舉可供選擇的檔案

`listFiles` SHALL 以 `(folderId, relPath)` 定址一個目錄，並回傳該目錄之下**遞迴**的檔案清單。

**每個項目 SHALL 為 folder-relative 路徑** —— 與 `watch` 推送的事件、與 `readFile` 的參數屬於
**同一個座標系**。它 SHALL NOT 以相對於 `relPath` 的路徑表達：呼叫端取得清單的目的就是把項目
交給其他 `fs.*` 操作，兩種座標系並存只會把一次換算的責任推給每一個呼叫端，而換算漏掉時的症狀是
**打開另一個同名的檔案**，沒有任何錯誤。

它 SHALL 受與 `listDir` **完全相同**的邊界約束：絕對路徑、以 `..` 逃逸、經 symlink 逃逸、未註冊
的 `folderId` 一律拒絕。**本要求不放寬既有的任何一條邊界** —— 它只是換一種列舉的粒度，定址的詞彙
（folder 識別碼 ＋ folder-relative 路徑）一個字都沒有改變。

**遞迴 SHALL NOT 跟隨符號連結進入目錄。** 邊界的包含關係判定是**字面**比較，一條指向 folder 之外
的 symlink 目錄，其下的檔案路徑在字面上仍位於 folder 之內 —— 判定必定放行，邊界會從這道側門漏掉
（此為既有教訓：檔案監看曾因預設跟隨 symlink 而把邊界外的檔名推給 renderer）。這也避免 folder
**之內**的 symlink 目錄使同一個檔案以兩條路徑重複出現。

回傳的每一個路徑 SHALL 在推送給 renderer 之前通過與 `listDir` 相同的包含關係判定。列舉的來源
若為外部程式，其輸出 SHALL NOT 被信任為「必然位於邊界之內」—— 邊界保證的來源是我們自己的判定，
不是來源程式的性質。

清單 SHALL 只含檔案，SHALL NOT 含目錄。

檔名不限於 ASCII。列舉的來源若對非 ASCII 位元組施加任何轉義或引號，`listFiles` SHALL 還原為原始
的檔名 —— 一個被轉義的路徑在清單中看起來像亂碼，且拿它去 `readFile` 會得到「找不到檔案」。

#### Scenario: 回傳的路徑為 folder-relative

- **WHEN** renderer 以一個位於 folder 之下數層的目錄為目標呼叫 `listFiles`
- **THEN** 回傳的每個項目皆為自 folder 根起算的路徑，可直接作為 `readFile` 的 `relPath` 使用

#### Scenario: 回傳遞迴的檔案清單

- **WHEN** renderer 對一個已加入的 folder 呼叫 `listFiles`，目標目錄之下有多層子目錄
- **THEN** 回傳的清單含有各層之下的檔案

#### Scenario: 清單不含目錄

- **WHEN** 目標目錄之下同時含有檔案與子目錄
- **THEN** 回傳的清單只含檔案

#### Scenario: 不跟隨指向 folder 之外的 symlink 目錄

- **WHEN** 目標目錄之下有一個指向 folder 邊界之外的 symlink 目錄，其中含有檔案
- **THEN** 回傳的清單不含該 symlink 之下的任何檔案

#### Scenario: 不因 folder 之內的 symlink 目錄而重複

- **WHEN** 目標目錄之下有一個指向該 folder 內另一個目錄的 symlink
- **THEN** 該目錄之下的每個檔案在清單中恰好出現一次

#### Scenario: 拒絕逃逸出邊界的路徑

- **WHEN** `listFiles` 的 `relPath` 為絕對路徑、含 `..` 且解析後落在 folder 之外、或指向一個真實路徑落在 folder 之外的 symlink
- **THEN** 呼叫被拒絕並回報錯誤，不回傳任何清單

#### Scenario: 非 ASCII 檔名以原始形式回傳

- **WHEN** 目標目錄之下含有檔名為非 ASCII 字元的檔案
- **THEN** 該項目於清單中為原始檔名，且以它呼叫 `readFile` 可讀到該檔案的內容

### Requirement: listFiles 排除其他工作目錄與版控忽略的內容

`listFiles` SHALL 排除位於**其他 git 工作目錄**之下的檔案，以及版本控制所忽略的內容。

**排除其他工作目錄是本要求的重點。** 一個 repo 的 git worktree 可能位於該 repo **自身之內**
（使用者的標準工作流即如此），此時天真的遞迴會使同一個檔案在清單中出現多次 —— 而清單的用途是
讓使用者從中挑一個，重複項使它無法達成目的。

**退回保守列舉的條件 SHALL 限於「目標不在版本控制之下」，SHALL NOT 涵蓋其他失敗。** 退回之所以
可接受，理由是「不在版本控制之下的目錄沒有巢狀工作目錄的問題」—— 該理由只對這一個條件成立。
若因逾時或輸出過大而退回，巢狀工作目錄之下的檔案會**全部湧入**，本要求當場失效，**而使用者只會
看到清單變長**。逾時與輸出過大 SHALL 回報錯誤。

目標目錄整個位於版控忽略範圍之內時（列舉成功但結果為空），`listFiles` SHALL 改以保守列舉回傳
清單 —— 使用者既然正在該目錄下工作，「它被忽略」不是把它呈現為空的理由。

列舉失敗時 `listFiles` SHALL 回報錯誤，**SHALL NOT 回傳空清單** —— 空清單與「這個目錄真的沒有
檔案」在呼叫端無法區分。

#### Scenario: 排除位於自身之內的其他工作目錄

- **WHEN** 目標目錄之下含有一個屬於同一 repo 的 git worktree
- **THEN** 回傳的清單不含該 worktree 之下的任何檔案

#### Scenario: 排除版控忽略的內容

- **WHEN** 目標目錄之下含有被版本控制忽略的目錄（例如相依套件或建置產物）
- **THEN** 回傳的清單不含其中的檔案

#### Scenario: 目標不在版本控制之下時仍可列舉

- **WHEN** 目標目錄不在任何 git 版本庫之內
- **THEN** 回傳可用的檔案清單，且不含常見的相依套件與建置產物目錄之下的檔案

#### Scenario: 目標整個被版控忽略時仍可列舉

- **WHEN** 目標目錄本身位於版控忽略的範圍之內，其下含有檔案
- **THEN** 回傳的清單含有那些檔案，而非一個空清單

#### Scenario: 逾時不退回保守列舉

- **WHEN** 版控列舉因逾時而失敗
- **THEN** 呼叫回報錯誤，SHALL NOT 改以保守列舉回傳一份含有其他工作目錄之檔案的清單

#### Scenario: 列舉失敗時回報錯誤

- **WHEN** 列舉因目標不存在或不是目錄而失敗
- **THEN** 呼叫被拒絕並回報錯誤，而非回傳空清單

### Requirement: listFiles 的列舉不得阻塞主行程

`listFiles` 若藉由執行外部程式完成列舉，該執行 SHALL 為非同步。

主行程一旦阻塞，**所有終端 session 的輸入輸出會一併停住** —— 它同時是 pty 資料流的中介。一個
大型版本庫的列舉是數十至數百毫秒等級，那個代價 SHALL NOT 由整個應用程式承擔。

**此性質的驗收 SHALL 觀察「事件迴圈於列舉期間仍在運行」，SHALL NOT 以「某個同步 API 未被呼叫」
代之。** 後者是前者的代理判準，且它有一個結構性的盲點：以具名匯入取得的函式不經屬性查找，攔截
其模組的匯出**攔不到它** —— 於是一個使用同步 API 的實作會讓該斷言保持綠燈。

#### Scenario: 列舉期間事件迴圈仍在運行

- **WHEN** 對一個大型版本庫呼叫 `listFiles`，同時有一個已排入佇列的計時器等待執行
- **THEN** 該計時器於列舉完成之前即被執行
