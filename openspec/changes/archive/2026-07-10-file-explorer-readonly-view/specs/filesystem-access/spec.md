## ADDED Requirements

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
- **THEN** 其上只有 `listDir`、`readFile`、`watch`、`unwatch` 與變更事件的訂閱介面 `onWatchEvent`，不存在 `writeFile`、刪除或其他未經本規格定義邊界要求的能力

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: 本能力只暴露 listDir

**Reason**: 本 change 引入 `readFile`、`watch` 與 `unwatch`，該 requirement 的 scenario（「其上只有 `listDir`，不存在 `readFile`」）不再為真。

它真正要守的從來不是「只有一個函式」，而是「**沒有一個函式在缺乏邊界要求的情況下進入介面**」。以檔案清單形式寫下的約束，每新增一個能力就得改寫一次，且改寫時容易把原則一併丟掉。

**Migration**: 由 `## ADDED Requirements` 中的「檔案系統能力僅暴露已為其定義邊界要求的操作」承接。該 requirement 以白名單原則取代能力清單，並在本 change 中為三個新能力各自定義了邊界要求（大小上限、二進位拒絕、監看範圍不得逃逸 folder、事件不得含絕對路徑）。
