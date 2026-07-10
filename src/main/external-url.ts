/**
 * 交給系統瀏覽器開啟的外部連結，其協定的白名單。
 *
 * 這個判斷之所以是主行程的一支純函式，而不是 renderer 的一段檢查：markdown 渲染器
 * 已經以 `defaultUrlTransform` 過濾過一次協定，但那是在 renderer 裡 —— 與 preload
 * 的邊界檢查同理，renderer 的檢查等於沒有檢查。真正把 URL 交給作業系統的是主行程，
 * 驗證就必須在主行程。
 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

export function isAllowedExternalUrl(rawUrl: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol)
}
