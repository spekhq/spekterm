## ADDED Requirements

### Requirement: renderer 以內容安全政策約束可載入的資源

主行程 SHALL 對 renderer 施加一份 Content-Security-Policy，限制 renderer 可載入與連線的資源
來源。此政策 SHALL 由主行程施加，而非 renderer 自身於文件中宣告的 `<meta>` —— renderer 渲染的是
不受信任的內容，其自我宣告的約束不構成防護。此要求與 preload 白名單、「renderer 不得導航離開
應用程式來源」同屬 PRD §12 信任模型的一環。

政策 SHALL 阻止 renderer 文件中的 inline script 被執行，並 SHALL 限制 script、object、iframe 與
base-uri 的來源，使任何未來的 XSS 立足點無法升級（載入遠端 script、導航離開、嵌入 iframe、改寫
base-uri）。應用程式自身的 script 皆為打包後的 same-origin 外部檔案。

政策 SHALL NOT 破壞應用程式自身的資源載入（打包後的 same-origin script、Monaco 的編輯器 worker、
以及 Monaco／xterm／Tailwind 於執行期注入的 inline style），亦 SHALL NOT 阻擋 markdown 中合法的
遠端圖片 —— 遠端圖片是 markdown 的正常內容（README 徽章、架構圖、螢幕截圖），為了防一個低嚴重度
的追蹤 beacon 而擋掉它，代價大於效益。

#### Scenario: markdown 中的遠端圖片不被阻擋

- **WHEN** 使用者開啟一個含有遠端 https 圖片（`![](https://…/x.png)`）的 markdown 檔案
- **THEN** 該圖片不觸發內容安全政策的 img-src 違規，可向來源請求載入

#### Scenario: renderer 文件中的 inline script 不被執行

- **WHEN** 一段 inline script 出現在 renderer 的文件中
- **THEN** 它被內容安全政策阻擋，不被執行

#### Scenario: 應用程式自身的編輯器與終端在政策之下正常運作

- **WHEN** 應用程式在內容安全政策之下載入其編輯器與終端
- **THEN** Monaco 的編輯器 worker 完成一次往返，且 Monaco／xterm／Tailwind 注入的 inline style
  生效，介面正常呈現
