## ADDED Requirements

### Requirement: 點選檔案於 side panel 內呈現其內容

點選檔案樹中的檔案 SHALL 使 Files 身分自檔案樹換頁為該檔案的內容檢視，SHALL NOT 佔用主舞台。面板的路徑導覽 SHALL 反映當前檔案的位置，並提供返回檔案樹的入口。

檔案檢視與檔案樹是 Files 身分的兩個狀態，而非兩個並列的區域 —— side panel 的寬度不足以同時容納兩者。

#### Scenario: 點選檔案

- **WHEN** 使用者點選檔案樹中的一個檔案
- **THEN** side panel 呈現該檔案的內容，且主舞台的其餘部分不受影響

#### Scenario: 返回檔案樹

- **WHEN** 使用者於檔案內容檢視中觸發返回入口
- **THEN** side panel 回到檔案樹，且先前的展開狀態保持不變

### Requirement: 檔案內容為唯讀

檔案檢視 SHALL 為唯讀。使用者 SHALL NOT 能於其中修改檔案內容。

#### Scenario: 嘗試輸入

- **WHEN** 使用者於檔案內容檢視中輸入文字
- **THEN** 內容不因此改變

### Requirement: markdown 檔案以渲染後的樣貌呈現

副檔名為 markdown 的檔案 SHALL 以渲染後的樣貌呈現，而非原始碼。渲染 SHALL 支援 GitHub Flavored Markdown 的表格與清單。

#### Scenario: 呈現 markdown

- **WHEN** 使用者開啟一個含有標題、清單與表格的 markdown 檔案
- **THEN** 內容以渲染後的樣貌呈現，而非原始的 markdown 文字

### Requirement: markdown 中的 HTML 與不安全連結不得被執行

markdown 渲染 SHALL NOT 將檔案中的原始 HTML 當作 HTML 執行 —— 它 SHALL 以純文字呈現。檔案樹渲染的是使用者 repo 中的任意檔案，屬於不受信任的輸入。

連結的 URL SHALL 僅在其協定屬於安全清單時保留，其餘協定（例如 `javascript:`）SHALL 被清除，使該連結不可觸發任何行為。

#### Scenario: markdown 中的 script 標籤

- **WHEN** 使用者開啟一個含有 `<script>` 標籤的 markdown 檔案
- **THEN** 該標籤以純文字呈現，其中的程式碼不被執行

#### Scenario: markdown 中的 javascript: 連結

- **WHEN** 使用者開啟一個含有 `javascript:` 協定連結的 markdown 檔案
- **THEN** 點擊該連結不觸發任何行為

### Requirement: 其餘文字檔以具語法高亮的唯讀編輯器呈現

非 markdown 的文字檔案 SHALL 以編輯器呈現，並依其副檔名判定語言以提供語法高亮。無法判定語言的檔案 SHALL 以純文字呈現，SHALL NOT 拒絕開啟。

#### Scenario: 呈現原始碼檔案

- **WHEN** 使用者開啟一個 TypeScript 檔案
- **THEN** 內容以編輯器呈現，且其語法元素被賦予不同的呈現樣式

#### Scenario: 未知副檔名的文字檔

- **WHEN** 使用者開啟一個副檔名無法對應到任何語言的文字檔案
- **THEN** 內容以純文字呈現於編輯器中

### Requirement: 過大或二進位的檔案拒絕開啟並說明原因

超過大小上限的檔案與二進位檔案 SHALL NOT 被開啟。檢視器 SHALL 呈現拒絕的原因，SHALL NOT 呈現內容的片段 —— 截斷的內容會讓使用者誤以為那就是全部。

#### Scenario: 開啟過大的檔案

- **WHEN** 使用者點選一個大小超過上限的檔案
- **THEN** 檢視器呈現說明該檔案過大的訊息，並指出上限，且不呈現任何內容片段

#### Scenario: 開啟二進位檔案

- **WHEN** 使用者點選一個二進位檔案
- **THEN** 檢視器呈現說明該檔案無法以文字檢視的訊息

### Requirement: 檢視中的檔案於磁碟被改動時提示重載

當前正在檢視的檔案若於磁碟上被外部改動，檢視器 SHALL 提示使用者其內容已過期，並提供重新載入的入口。

唯讀檢視沒有未儲存的變更，因此 SHALL NOT 需要任何衝突解決流程。

#### Scenario: 檢視中的檔案被外部修改

- **WHEN** 使用者正在檢視某個檔案，該檔案由 app 之外的程序改動
- **THEN** 檢視器提示其內容已過期，並提供重新載入的入口

#### Scenario: 檢視中的檔案被外部刪除

- **WHEN** 使用者正在檢視某個檔案，該檔案由 app 之外的程序刪除
- **THEN** 檢視器明確標示該檔案已不存在
