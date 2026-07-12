import type { Session } from 'electron'

/**
 * renderer 的 Content-Security-Policy。
 *
 * **由主行程施加**（`session` 的 `onHeadersReceived`），不是 renderer 於文件中自宣告的
 * `<meta>` —— renderer 渲染的是不受信任的內容（repo 裡的 markdown、pty 的輸出），它自我宣告
 * 的約束不構成防護。與 preload 白名單、導航防護同屬 PRD §12 信任模型的一環。
 *
 * 這道政策防的是 **XSS 與升級**：inline script 一律不執行（`script-src 'self'`），且 script／
 * object／iframe／base-uri 都鎖死，使任何未來的 XSS 立足點無法載入遠端 script、無法導航離開、
 * 無法嵌 iframe、無法改寫 base-uri。**它不限制圖片** —— 遠端圖片是 markdown 的正常內容（README
 * 徽章、架構圖、螢幕截圖），為了防一個低嚴重度的追蹤 beacon 而擋掉它，代價大於效益，尤其使用者
 * 本就對其 workspace folder 做過信任決定、還在裡面跑 agent 與 shell。
 *
 * 政策生成是**純函式**（`contentSecurityPolicy`），與 Electron 的施加接縫（`applyContentSecurityPolicy`）
 * 分離，因此政策內容可由單元測試鎖住，不必啟動 app —— 比照 `external-url.ts` 的風格。
 */

/**
 * 共通的 directive 骨架。
 *
 * 幾個非顯而易見的選擇（見 change 的 design D2）：
 * - **無 `'unsafe-eval'`**：建置產物實測無 `eval`／`new Function`，故 `script-src` 不需要它。
 * - `style-src` 帶 `'unsafe-inline'`：Monaco、xterm、Tailwind v4 都在執行期注入 inline `<style>`，
 *   無法避免；且 style 的 inline 不像 script 那樣可被武器化為程式執行。
 * - `worker-src` 帶 `blob:`：Monaco 的 `editor.worker` 是 same-origin module worker，另有一處
 *   `createObjectURL` 的 blob worker fallback（blob worker 只能源於自身，不構成外洩）。
 * - `img-src` 帶 `https:`：**放行遠端 https 圖片**（markdown 的正常內容）。不放行 `http:` ——
 *   一來近乎所有真實圖片都是 https，二來擋 `http:` 同時擋掉惡意 markdown 對 `http://localhost`
 *   的 image-GET 探測（一種窄面的 CSRF-via-image）。`data:` 放行內嵌圖示。
 */
function baseDirectives(): Record<string, string[]> {
  return {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'worker-src': ["'self'", 'blob:'],
    'connect-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'frame-src': ["'none'"],
  }
}

/**
 * 依是否載入 Vite dev server 回傳 directive 表。
 *
 * **切換依據是「有沒有 dev server」，不是 `app.isPackaged`。** dev server（`ELECTRON_RENDERER_URL`）
 * 提供的 renderer 需要放行：React Fast Refresh 注入的 inline module script（`script-src` 需
 * `'unsafe-inline'`），與 HMR 的 websocket（`connect-src` 需 `ws:`）。而「未打包但載入 file:// 的
 * build 產物」（例如 probe 的建置模式、或開發者 `npm run build` 後直接 `electron .`）**不需要**這些
 * 放寬 —— 那種情形 `isPackaged` 仍為 false，若以它為準會誤發 dev 政策，且會讓 production 政策
 * 永遠沒有任何 probe 覆蓋。以 dev server 的存在為準，才能讓 file:// 一律拿到緊政策。
 */
function directivesFor(isDevServer: boolean): Record<string, string[]> {
  const base = baseDirectives()
  if (!isDevServer) return base
  return {
    ...base,
    'script-src': ["'self'", "'unsafe-inline'"],
    'connect-src': ["'self'", 'ws:'],
  }
}

/** 組成 `Content-Security-Policy` header 的值。純函式，供單元測試直接斷言。 */
export function contentSecurityPolicy(isDevServer: boolean): string {
  return Object.entries(directivesFor(isDevServer))
    .map(([directive, values]) => `${directive} ${values.join(' ')}`)
    .join('; ')
}

/**
 * 對一個 session 施加 CSP。
 *
 * 掛在 `onHeadersReceived` 上，對其 response 附加 `Content-Security-Policy` header。必須在
 * **載入任何 renderer 內容之前**掛上（呼叫端於 `app.whenReady` 內、建立視窗之前呼叫）。
 *
 * `isDevServer` 由呼叫端以 `ELECTRON_RENDERER_URL` 的存在決定 —— 見 `directivesFor` 的說明。
 */
export function applyContentSecurityPolicy(session: Session, isDevServer: boolean): void {
  const policy = contentSecurityPolicy(isDevServer)
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })
}
