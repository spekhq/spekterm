## ADDED Requirements

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

`listDir` SHALL 回傳目標目錄的直接子項目，每個項目 SHALL 標明名稱與種類（檔案、目錄、符號連結、其他）。它 SHALL NOT 遞迴。

#### Scenario: 回報混合種類的目錄

- **WHEN** 目標目錄同時含有檔案、子目錄與符號連結
- **THEN** 回傳的每個項目標明其名稱與對應的種類，且不包含子目錄之下的項目

#### Scenario: 目標不是目錄

- **WHEN** `relPath` 指向一個檔案，或指向不存在的路徑
- **THEN** 呼叫被拒絕並回報錯誤，而非回傳空清單

### Requirement: 本能力只暴露 listDir

暴露給 renderer 的檔案系統能力 SHALL 僅含 `listDir`。讀檔、寫檔、刪除、監看等能力 SHALL NOT 存在於 renderer 可觸及的介面上，直到後續 change 明確引入並為其定義邊界要求。

#### Scenario: 未引入的檔案系統能力不存在

- **WHEN** 於 renderer 檢視 preload 暴露的檔案系統介面
- **THEN** 其上只有 `listDir`，不存在 `readFile`、`writeFile` 或其他未經本規格定義的能力
