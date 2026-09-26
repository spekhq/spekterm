/**
 * claude session 的固定名字（`agent-peer-name`）。
 *
 * 名字是 agent CLI 本機訊息機制裡的**地址**。CLI 自動產生的名字每個行程都不同，而 spekterm 的
 * session 在重開、續接、自癒時都是新的行程 —— 不指定名字，母子 session 記住的地址下一次就失效
 * （實測見 `docs/lessons/handoff.md` 第十一節）。
 *
 * ## 字元集是我們收斂的，不是 CLI 要求的
 *
 * CLI 原樣接受任何字元（空白、CJK、引號皆實測過）。收斂成「字母、數字、`_`、`-`」是為了讓名字在
 * agent 的訊息定址、命令列與人眼中都沒有歧義。**CJK 保留** —— `簡報-c463` 比 `session-c463` 好認。
 *
 * ## 首字必須是字母或數字
 *
 * 以 `-` 開頭的名字會被 CLI 當成旗標。前綴正規化之後為空時用 `session`，就是為此。
 */

/** 名字的總長上限（code point）。 */
export const PEER_NAME_MAX_LENGTH = 64

/** 全域 session 的前綴。它是地址，不隨介面語言改變。 */
export const GLOBAL_PEER_PREFIX = 'global'

/** 前綴正規化之後為空時的代替字。 */
export const FALLBACK_PEER_PREFIX = 'session'

const SHORT_START = 4

const VALID = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u

/** 驗證一個（通常讀自磁碟的）名字。**讀回的名字會成為 CLI 的參數**，不合法的一律不用。 */
export function isValidPeerName(value: unknown): value is string {
  return typeof value === 'string' && VALID.test(value) && [...value].length <= PEER_NAME_MAX_LENGTH
}

/** rail 項目名稱 → 前綴。`null` ＝ 全域。 */
export function peerPrefix(label: string | null): string {
  if (label === null) return GLOBAL_PEER_PREFIX
  const collapsed = label
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[_-]+|[_-]+$/g, '')
  return collapsed === '' ? FALLBACK_PEER_PREFIX : collapsed
}

function compose(prefix: string, short: string): string {
  const room = PEER_NAME_MAX_LENGTH - 1 - short.length
  const cut = [...prefix].slice(0, room).join('').replace(/[_-]+$/, '')
  return `${cut === '' ? FALLBACK_PEER_PREFIX : cut}-${short}`
}

/**
 * 決定一個 session 的名字。
 *
 * **只在它第一次需要名字時呼叫一次，結果落盤**（`session-store` 的 `peerName`）—— 每次重算的話，
 * 一個新 session 的出現可能讓舊 session 的短碼被延長，而那正是規格禁止的事。
 *
 * `taken` 是本應用程式其他 session 已經持有的名字。**比較不分大小寫**（保守起見 —— CLI 的比較
 * 方式未實測）。短碼由 4 碼起，撞了就延長 2 碼。
 */
export function decidePeerName(label: string | null, sessionId: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((name) => name.toLowerCase()))
  const prefix = peerPrefix(label)
  const hex = sessionId.replace(/[^0-9a-f]/gi, '').toLowerCase()
  for (let length = SHORT_START; length <= hex.length; length += 2) {
    const name = compose(prefix, hex.slice(0, length))
    if (!used.has(name.toLowerCase())) return name
  }
  // 32 碼全用上還撞 ⇒ 只可能是有人手動寫了同一個識別碼。照樣回傳，唯一性於此放棄（不會發生）。
  return compose(prefix, hex)
}
