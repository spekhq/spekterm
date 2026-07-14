## MODIFIED Requirements

### Requirement: OpenSpec 身分呈現「本 change」與「瀏覽」兩個視圖

side panel 的 OpenSpec 身分 SHALL 於其內部提供兩個視圖的切換：**本 change** 與 **瀏覽**。
任一時刻 SHALL 恰有一個視圖被呈現，且當前視圖 SHALL 於切換入口上被明確標示。

兩個視圖於介面上的標籤為 **This change** 與 **Browse**（UI 的文案為英文，見 `ui-localization`）。
本規格以中文稱呼它們是概念上的指涉；scenario 中以英文標籤指名，指的是使用者實際看到的那個入口。

此切換為 OpenSpec 身分**內部**的第二層導航，與 side panel 的身分切換（`[◈ OpenSpec │ ▤ Files]`）
是不同層級。

視圖採**換頁而非並列**，理由與 Files 身分相同：side panel 的寬度不足以並列多個視圖。

Graph 與 Timeline **不是**這裡的視圖 —— 它們在全視窗 overlay 中呈現（見下）。

#### Scenario: 切換至瀏覽視圖

- **WHEN** 使用者於 OpenSpec 身分中觸發 **Browse** 視圖的入口
- **THEN** side panel 呈現瀏覽視圖，本 change 視圖的內容不再顯示，且 **Browse** 於入口上被標示為當前視圖

#### Scenario: 一次只顯示一個視圖

- **WHEN** 檢視 OpenSpec 身分的內容
- **THEN** 兩個視圖之中恰有一個被呈現

### Requirement: OpenSpec 與 Files 兩個身分之間可交叉導覽

使用者 SHALL 能自 OpenSpec 身分中的 spec 或 change artifact，跳至其底層的檔案 —— 該操作 SHALL 切換
side panel 至 Files 身分並開啟該檔案。該入口於介面上的標籤為 **Open in Files**。

使用者 SHALL 能自 Files 身分中一個位於 `openspec/` 之下的檔案，跳至其對應的 spec 或 change —— 該操作
SHALL 切換 side panel 至 OpenSpec 身分並呈現對應的內容。該入口於介面上的標籤為 **View in OpenSpec**。

交叉導覽 SHALL NOT 影響未存檔的編輯內容（dirty buffer 跨身分存活，延續 `file-editing` 的既有保證）。

#### Scenario: 自 spec 跳至其檔案

- **WHEN** 使用者於 OpenSpec 身分中觸發某個 spec 的 **Open in Files**
- **THEN** side panel 切換至 Files 身分，並開啟該 spec 的 `.md` 檔

#### Scenario: 自 openspec 目錄下的檔案跳回 OpenSpec 身分

- **WHEN** 使用者於 Files 身分中開啟一個位於 `openspec/changes/<slug>/` 之下的檔案，並觸發 **View in OpenSpec**
- **THEN** side panel 切換至 OpenSpec 身分，並呈現該 change

#### Scenario: 交叉導覽不丟失未存的編輯

- **WHEN** 使用者在 Files 身分中有未存檔的編輯，切換至 OpenSpec 身分後再切回
- **THEN** 未存檔的編輯內容仍在
