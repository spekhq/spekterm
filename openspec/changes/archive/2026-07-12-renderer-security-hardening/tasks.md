## 1. CSP：主行程注入（design D1／D2）

- [x] 1.1 新增 CSP 模組（`src/main/content-security-policy.ts`）：政策生成為**純函式**（輸入
      `isDevServer`，輸出政策字串），與主行程的注入分離，比照 `external-url.ts`／`fs-boundary.ts`
      的可測性風格 —— 純邏輯可單元測試，Electron 接縫另計。
- [x] 1.2 主行程於 `session.defaultSession.webRequest.onHeadersReceived` 施加該政策，掛載點在
      `app.whenReady` 內、**建立視窗與載入任何 renderer 內容之前**（與 `applyNavigationGuards`
      同屬信任模型的前置防護）。
- [x] 1.3 定義 build（production）政策內容：`default-src 'self'`、`script-src 'self'`、
      `style-src 'self' 'unsafe-inline'`、`img-src 'self' data: https:`（放行遠端 https 圖片）、
      `font-src 'self' data:`、`worker-src 'self' blob:`、`connect-src 'self'`、`object-src 'none'`、
      `base-uri 'none'`、`frame-src 'none'`（design D2）。
- [x] 1.4 定義 dev 政策：在 build 政策基礎上放行 Vite HMR 所需（`script-src` 的 `'unsafe-inline'`、
      `connect-src` 的 `ws:`）。**切換依 `ELECTRON_RENDERER_URL` 而非 `app.isPackaged`** —— 後者
      會讓「未打包載入 build 產物」誤發 dev 政策、且使 production 政策永無 probe 覆蓋（探針抓到，
      見 CLAUDE.md）。dev 模式以 `probe:files` 的 `app.mounted` 實測未弄壞 HMR。
- [x] 1.5 CSP 政策生成純函式加單元測試（`content-security-policy.test.ts`，node:test，11 條）：
      斷言 build 政策含 `default-src 'self'`、`img-src` 不含遠端來源、**不含** `'unsafe-eval'`、
      `script-src` 僅 `'self'`；dev 政策放行 `ws:` 與 inline script。

## 2. clipboard：輸入型別防禦（design D3）

- [x] 2.1 於 `src/main/ipc/clipboard.ts` 的 `writeText` handler 加 `typeof text !== 'string'` 的
      guard，非字串輸入靜默丟棄（單向 `send`，無回應通道 —— 丟棄是唯一合理處置）。

## 3. 終端 OSC 8 連結（design D4）

- [x] 3.1 於 `src/renderer/src/shell/terminal/xterm.ts` 的 `new Terminal({...})` 設
      `linkHandler.activate` 導向既有的 `openLink`，使 OSC 8 超連結與純文字連結匯到同一條
      `openExternal`；**不設** `allowNonHttpProtocols`（保持雙重保險）。

## 4. 驗收（dev 與 build 兩模式）

- [x] 4.1 `probe:files` 增補 CSP 斷言（101/101）：CSP 確實施加、`script-src` 僅 `'self'`（自
      `securitypolicyviolation` 的 `originalPolicy` 端到端讀取，以一個一定被擋的 `fetch` 觸發捕捉 ——
      不用 CDP 動態插入 script，那繞過 script-src）、`img-src` 放行遠端 https 圖片、markdown 的遠端
      圖片**不被** CSP 阻擋、Monaco worker 在政策下**仍完成往返**（dev + build 兩模式）。
- [x] 4.2 `probe:terminal` 增補（114/114）：**(a) clipboard** —— 送非字串後主行程仍服務後續 IPC、
      合法字串仍寫得進剪貼簿（headless 侷限見 CLAUDE.md）。**(b) OSC 8** —— 原擬的「hover+click
      斷言不彈 confirm」經**對照組證明是假綠**（移除 linkHandler 後仍全綠，注入式滑鼠驅動不了 xterm
      連結激活），已移除；OSC 8 的行為改由 code review + design D4 保證，理由記於 probe 與 CLAUDE.md。
- [x] 4.3 `npm run typecheck` 通過（main／preload 與 renderer 兩側）。
- [x] 4.4 `npm run lint` 通過。
- [x] 4.5 `npm test` 通過（含新增的 11 條 CSP 單元測試），既有單元測試不回歸。

## 5. 文件

- [x] 5.1 更新 `CLAUDE.md`：新增「renderer 安全硬化的實測與踩雷」節（CSP 切換依據、CDP 繞過
      script-src、OSC 8 probe 假綠、clipboard 的 headless 侷限），並更新開發指令的 probe 清單、
      Project Overview 與路線圖的 change 對應。
- [x] 5.2 更新 `README.md`：信任模型段補上 CSP，probe 清單反映 `probe:files`／`probe:terminal`
      的新增驗收。
