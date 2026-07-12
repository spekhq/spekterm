## Why

一次資安掃描發現三道**位於既有邊界之上、屬於縱深防禦缺口**的縫隙。核心信任模型（fs 邊界、
preload 白名單、導航防護、markdown 的 react-markdown 預設安全值）已紮實，但這三項是既有硬化
未收攏的邊角，且都落在本 app 的明確威脅模型內 ——「渲染使用者 repo 裡的不受信任 markdown」與
「終端承載不受信任的 pty 輸出」。趁 Phase 6 打包發佈前補上，成本最低（發佈後 renderer 的
攻擊面只會擴大）。

## What Changes

- **renderer 套用嚴格的 Content-Security-Policy。** 目前 renderer **完全沒有 CSP**。CSP 提供
  縱深防禦：inline script 一律不執行（`script-src 'self'`），且 script／object／iframe／base-uri
  的來源鎖死 —— 萬一日後任一處出現 XSS 立足點（誤加 `rehype-raw`、元件庫的 bug），這些限制讓它
  無法載入遠端 script、導航離開、嵌 iframe 或改寫 base-uri。**它不限制圖片**：遠端圖片是 markdown
  的正常內容，擋它只能防一個低嚴重度的追蹤 beacon，代價大於效益（見 design D2）。政策必須與
  Monaco 的 worker、xterm 與 Tailwind v4 注入的 inline style 相容 —— 這是本項的主要風險，留待
  design 裁決注入方式與 directive 集合。

- **`clipboard:writeText` 的主行程 handler 對輸入防禦。** 該 handler 是 fire-and-forget 的
  `ipcMain.on`、無 try/catch，而 `clipboard.writeText` 收到非字串會拋 `TypeError`。於是一個
  被入侵或有 bug 的 renderer 送出非字串，就會在**主行程**造成未捕捉例外（已以真實 Electron
  行程實測：跳出原生錯誤對話框，且可被重複觸發洗版、擋住 app）。對照之下 `terminal.*` 的
  `write`／`resize`／`kill` 已在服務層以 try/catch 與數值夾制防禦，缺這道防護的只有剪貼簿寫入。

- **xterm 的 `Terminal` 設定 `linkHandler`。** app 已謹慎覆寫 `WebLinksAddon`，讓終端輸出中的
  **純文字** URL 都經主行程 `openExternal` 驗協定。但 **OSC 8 escape-sequence 超連結**
  （`ESC ] 8 ; ; <uri> …`）由 xterm 核心的 `OscLinkProvider` 處理，走的是 `Terminal` 的
  `linkHandler` 選項 —— 而目前**未設定**它，於是落入 xterm 內建預設處理器：一個 `confirm()`
  對話框（其 URL 文字由不受信任的 pty 輸出控制，可用於仿冒）加上 `window.open()`。實際導航雖
  被既有的 `setWindowOpenHandler` 兜底擋下，但這條路徑完全繞過了刻意建立的 `openExternal`
  接縫，且會彈出攻擊者可控文字的對話框。設定 `linkHandler` 讓 OSC 8 與純文字連結走同一條受控
  接縫。

三項皆為局部、非破壞性的硬化，無新增依賴。

## Capabilities

### New Capabilities

（無 —— 三項皆為既有能力的 requirement 演進，不是新能力。）

### Modified Capabilities

- `workspace-app-shell`：新增一條 requirement —— renderer SHALL 以內容安全政策約束其可載入的
  資源：阻止 inline script 執行、鎖死 script／object／iframe／base-uri 的來源，但**不阻擋**合法的
  遠端圖片。此為既有「信任模型隔離」與「renderer 不得導航離開來源」兩條 requirement 的同類延伸。

- `terminal-sessions`：新增兩條 requirement —— (1) 終端內的連結（含 OSC 8 超連結）SHALL 一律
  經受控接縫、由主行程驗證協定後交系統瀏覽器開啟，不得落入終端模擬器的內建預設處理器；
  (2) 主行程的剪貼簿寫入 SHALL 對 renderer 傳來的畸形輸入防禦，不因非字串輸入使主行程崩潰。

## Impact

- **程式碼**：
  - CSP 注入點（`src/renderer/index.html` 的 meta，或主行程 `session` 的 `onHeadersReceived`
    —— 由 design 裁決）。
  - `src/main/ipc/clipboard.ts`（型別檢查）。
  - `src/renderer/src/shell/terminal/xterm.ts`（`linkHandler`）。
- **驗收**：`probe:files`（CSP 生效、script-src 僅 self、markdown 遠端圖片不被擋、編輯器 worker
  仍完成往返）、`probe:terminal`（剪貼簿畸形輸入不崩潰）。
- **依賴／相容性**：無新增依賴、無 breaking change。主要相容性風險為 CSP 不得破壞 Monaco
  worker 與 xterm／Tailwind 的 inline style。
- **文件**：封存時更新 `CLAUDE.md`（新增此 change 的踩雷與結論）與相關 spec。
