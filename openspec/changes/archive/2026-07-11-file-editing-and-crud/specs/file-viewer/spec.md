## ADDED Requirements

### Requirement: 其餘文字檔以具語法高亮的編輯器呈現

非 markdown 的文字檔案 SHALL 以編輯器呈現，並依其副檔名判定語言以提供語法高亮。無法判定語言的檔案 SHALL 以純文字呈現，SHALL NOT 拒絕開啟。

編輯器 SHALL 允許修改內容。它 SHALL NOT 提供語意分析 —— 語法高亮之外的語言能力不屬於本檢視的職責。

#### Scenario: 呈現原始碼檔案

- **WHEN** 使用者開啟一個 TypeScript 檔案
- **THEN** 內容以編輯器呈現，且其語法元素被賦予不同的呈現樣式

#### Scenario: 未知副檔名的文字檔

- **WHEN** 使用者開啟一個副檔名無法對應到任何語言的文字檔案
- **THEN** 內容以純文字呈現於編輯器中

#### Scenario: 於編輯器中輸入

- **WHEN** 使用者於編輯器中輸入文字
- **THEN** 內容隨之改變

### Requirement: markdown 提供預覽與原始碼兩種互斥的模式

markdown 檔案的檢視 SHALL 提供「預覽」與「原始碼」兩種模式，一次呈現其中一種，並提供切換的入口。預覽 SHALL 為預設模式。

原始碼模式 SHALL 以具語法高亮的編輯器呈現其原始的 markdown 文字，並允許修改。預覽模式 SHALL NOT 允許修改。

切換模式 SHALL NOT 捨棄未存的變更 —— 於原始碼模式所做的修改，切至預覽時 SHALL 反映於預覽的內容中。

#### Scenario: 預設呈現預覽

- **WHEN** 使用者開啟一個 markdown 檔案
- **THEN** 內容以渲染後的樣貌呈現

#### Scenario: 切換至原始碼模式

- **WHEN** 使用者於一個 markdown 檔案的檢視中切換至原始碼模式
- **THEN** 呈現其原始的 markdown 文字，且可被修改

#### Scenario: 於原始碼模式的修改反映於預覽

- **WHEN** 使用者於原始碼模式修改內容之後切換至預覽模式
- **THEN** 預覽呈現修改後的內容，且該修改未被捨棄

## MODIFIED Requirements

### Requirement: markdown 檔案以渲染後的樣貌呈現

副檔名為 markdown 的檔案於**預覽模式**下 SHALL 以渲染後的樣貌呈現，而非原始碼。渲染 SHALL 支援 GitHub Flavored Markdown 的表格與清單。

#### Scenario: 呈現 markdown

- **WHEN** 使用者開啟一個含有標題、清單與表格的 markdown 檔案
- **THEN** 內容以渲染後的樣貌呈現，而非原始的 markdown 文字

### Requirement: 檢視中的檔案於磁碟被改動時提示重載

當前正在檢視的檔案若於磁碟上被外部改動，檢視器 SHALL 提示使用者其內容已過期，並提供重新載入的入口。

該檔案若有未存的變更，重新載入即為破壞性操作 —— 檢視器 SHALL 於重新載入之前指出未存的變更將被捨棄，SHALL NOT 直接以磁碟上的內容取代之。

由應用程式自身的寫入所造成的變更 SHALL NOT 觸發此提示。

#### Scenario: 檢視中的檔案被外部修改

- **WHEN** 使用者正在檢視某個沒有未存變更的檔案，該檔案由 app 之外的程序改動
- **THEN** 檢視器提示其內容已過期，並提供重新載入的入口

#### Scenario: 有未存變更時被外部修改

- **WHEN** 使用者正在編輯某個檔案且尚未存檔，該檔案由 app 之外的程序改動
- **THEN** 檢視器提示其內容已過期，且指出重新載入將捨棄未存的變更

#### Scenario: 檢視中的檔案被外部刪除

- **WHEN** 使用者正在檢視某個檔案，該檔案由 app 之外的程序刪除
- **THEN** 檢視器明確標示該檔案已不存在

## REMOVED Requirements

### Requirement: 檔案內容為唯讀

**Reason**: 本 change 的目的正是讓檔案內容可被編輯。該 requirement 與 `file-editing` 的「檔案內容可於面板內編輯並產生未存變更的狀態」直接衝突。

**Migration**: 由 `file-editing` 承接編輯的行為與其未存變更的保護。`file-viewer` 保留「呈現」的職責 —— 兩種模式、拒絕過大與二進位的檔案、外部變更的提示。

### Requirement: 其餘文字檔以具語法高亮的唯讀編輯器呈現

**Reason**: 該 requirement 的標題與內文皆以「唯讀」為前提。語法高亮與「未知副檔名不拒絕開啟」的約束仍然成立，僅唯讀不再成立。

**Migration**: 由 `## ADDED Requirements` 中的「其餘文字檔以具語法高亮的編輯器呈現」承接，其 scenario 完整保留，並新增「於編輯器中輸入」以確立可編輯性。
