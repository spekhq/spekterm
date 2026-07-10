import { shell, type WebContents } from 'electron'
import { isAllowedExternalUrl } from './external-url'

/**
 * renderer 只有一個頁面，它永遠不需要導航。任何導航請求都來自它所渲染的**不受信任內容**
 * —— 使用者 repo 裡的一個 markdown 連結、一段被注入的 HTML。
 *
 * 攔截的理由不是「跳走會很怪」：preload 綁在 `webContents` 上，會在每一次導航後重新注入，
 * 且不分來源。renderer 一旦被帶往遠端頁面，那個頁面的 `window.workspace.fs` 就是我們的
 * 檔案系統白名單 —— 它能列出並讀取使用者所有 workspace folder 的內容。
 *
 * 換句話說：少了這道防護，`filesystem-access` 建立的整道邊界會被一個連結繞過。
 */
export function applyNavigationGuards(contents: WebContents): void {
  contents.on('will-navigate', (details) => {
    details.preventDefault()
    console.warn(`[navigation] 已阻擋 renderer 導航至 ${details.url}`)
  })

  contents.setWindowOpenHandler(({ url }) => {
    console.warn(`[navigation] 已阻擋 renderer 開啟新視窗 ${url}`)
    return { action: 'deny' }
  })
}

/**
 * 把外部連結交給系統的預設瀏覽器。協定不在白名單內即拒絕 —— `shell.openExternal`
 * 會把它收到的任何 URL 交給作業系統處理，包含 `file:` 這類我們不打算代為開啟的協定。
 */
export async function openExternalUrl(rawUrl: string): Promise<void> {
  if (!isAllowedExternalUrl(rawUrl)) {
    throw new Error(`refused to open external url: ${rawUrl}`)
  }
  await shell.openExternal(rawUrl)
}
