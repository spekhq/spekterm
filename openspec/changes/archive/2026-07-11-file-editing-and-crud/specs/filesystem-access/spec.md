## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: 檔案系統能力僅暴露已為其定義邊界要求的操作

暴露給 renderer 的檔案系統能力 SHALL 僅含本規格已定義邊界要求的操作。任何新的檔案系統能力 SHALL NOT 出現於 renderer 可觸及的介面上，直到後續 change 明確引入並為其定義邊界要求。

這條要求的形式是「白名單」而非「清單」—— 它約束的不是當下有哪幾個函式，而是**任何函式進入介面之前，都必須先有邊界要求**。

#### Scenario: 介面上只有已定義邊界要求的能力

- **WHEN** 於 renderer 檢視 preload 暴露的檔案系統介面
- **THEN** 其上只有 `listDir`、`readFile`、`writeFile`、`createFile`、`createDirectory`、`deleteEntry`、`rename`、`watch`、`unwatch` 與變更事件的訂閱介面 `onWatchEvent`，不存在建立符號連結、變更權限或其他未經本規格定義邊界要求的能力
