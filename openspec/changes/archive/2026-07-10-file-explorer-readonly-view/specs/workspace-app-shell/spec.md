## ADDED Requirements

### Requirement: renderer 不得導航離開應用程式來源

主行程 SHALL 阻止 renderer 導航至應用程式自身來源之外的位置，並 SHALL 阻止其開啟新視窗。外部連結 SHALL 改由系統的預設瀏覽器開啟，且主行程 SHALL 在交付之前驗證其協定，僅放行 `http` 與 `https`。

此要求對應 PRD §12 的信任模型，且是引入 markdown 渲染的前提：preload 綁定於 `webContents`，會在該 `webContents` 的每一次導航後重新注入，不分來源。若 renderer 被一個檔案中的連結帶往遠端頁面，該頁面將取得 preload 暴露的全部檔案系統能力 —— workspace folder 的邊界會被完全繞過。

協定驗證 SHALL 在主行程執行。renderer 端的過濾不構成防護。

#### Scenario: renderer 嘗試導航至外部位址

- **WHEN** renderer 中的一個連結被觸發，其目標為應用程式來源之外的位址
- **THEN** renderer 不發生導航，仍停留於原本的頁面

#### Scenario: renderer 嘗試開啟新視窗

- **WHEN** renderer 嘗試開啟一個新視窗
- **THEN** 不建立任何新視窗

#### Scenario: 主行程拒絕不安全協定的外部連結

- **WHEN** 一個協定不屬於 `http` 或 `https` 的外部連結被交付至主行程
- **THEN** 主行程拒絕開啟它

### Requirement: 編輯器於檔案檢視中載入並提供語法高亮

renderer 於檢視非 markdown 的文字檔案時 SHALL 載入編輯器，且 SHALL 對其內容提供語法高亮 —— 內容中的語法元素 SHALL 被賦予不同的呈現樣式，而非單一樣式。

此 requirement 的載體為 side panel 的檔案檢視。它取代了 Phase 0 以診斷頁為載體、並於 Phase 1 隨診斷頁一併移除的同名 requirement。

#### Scenario: 開發模式下載入編輯器並高亮

- **WHEN** 以開發模式啟動應用程式，並於檔案檢視中開啟一個原始碼檔案
- **THEN** 編輯器完成掛載，且其內容中的語法元素被賦予多於一種的呈現樣式

#### Scenario: 正式建置下載入編輯器並高亮

- **WHEN** 啟動正式建置後的應用程式，並於檔案檢視中開啟一個原始碼檔案
- **THEN** 編輯器完成掛載，且其內容中的語法元素被賦予多於一種的呈現樣式

### Requirement: 編輯器的 worker 於 dev 與 build 兩種模式皆完成一次往返

編輯器的 worker SHALL 於開發模式與正式建置兩種模式下皆能被建立、載入並完成一次與主執行緒的往返。

驗收 SHALL NOT 以「觀察到語法高亮」作為 worker 存活的依據 —— 語法標記在主執行緒完成，worker 未載入時高亮依然存在。驗收 SHALL 觀察一項只可能由 worker 計算得出的結果。

#### Scenario: 開發模式下 worker 完成往返

- **WHEN** 以開發模式啟動應用程式，並於檔案檢視中開啟一個內容含有 URL 的檔案
- **THEN** 該 URL 於編輯器中被標示為連結 —— 此標示只可能由 worker 計算後回填

#### Scenario: 正式建置下 worker 完成往返

- **WHEN** 啟動正式建置後的應用程式，並於檔案檢視中開啟一個內容含有 URL 的檔案
- **THEN** 該 URL 於編輯器中被標示為連結

### Requirement: 唯讀檢視不引入任何語言服務 worker

renderer 的建置產物 SHALL NOT 包含任何語言服務 worker（TypeScript、JSON、CSS、HTML）。唯讀檢視只需要語法標記，不需要語意分析 —— 使用者無法於此處修正編輯器回報的任何診斷。

語言服務 worker 是編輯器體積的主要來源，其中 TypeScript 語言服務單獨即超過整個其餘產物。明文禁止，以免日後為了單一便利而讓它悄悄回到產物中。

#### Scenario: 建置產物不含語言服務 worker

- **WHEN** 檢視 renderer 的正式建置產物
- **THEN** 其中不存在 TypeScript、JSON、CSS 或 HTML 的語言服務 worker 資產

#### Scenario: 語法高亮不依賴語言服務

- **WHEN** 於檔案檢視中開啟一個 TypeScript 檔案
- **THEN** 其語法元素被賦予不同的呈現樣式，且未載入任何語言服務 worker

### Requirement: 編輯器對 renderer bundle 的體積貢獻可量測且可歸因

renderer 的建置產物 SHALL 具備一份體積報告，其中編輯器帶來的資產 SHALL 可被辨識並歸因 —— 報告 SHALL 區分編輯器的核心產物、其 worker 與其各語言的延遲載入資產。

此 requirement 是判斷是否依 PRD §8.3 退守替代編輯器的依據。它取代了 Phase 0 以「與不含 Monaco 的基準相比較」為形式、並於 Phase 1 隨診斷頁一併移除的同名 requirement —— 該形式在編輯器成為產品的一部分之後已無法成立，因為不含編輯器的建置不再是這個應用程式。

#### Scenario: 體積報告可歸因編輯器的貢獻

- **WHEN** 執行 renderer 的體積報告
- **THEN** 報告分別列出編輯器的核心產物、其 worker 資產與其語言資產的體積，且三者之和可與產物總體積相比較

#### Scenario: 各語言的資產為延遲載入

- **WHEN** 檢視 renderer 建置產物中編輯器的語言資產
- **THEN** 每種語言為獨立的資產，SHALL NOT 被合併進主要的載入路徑
