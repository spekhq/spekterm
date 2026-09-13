import type { Secret } from './secret-store'
import type { SlackMessage } from './slack-mention'

/**
 * Slack Web API 的薄用戶端。**這是唯一解開憑證的模組**（`secret-scope` 的 `REVEAL_ALLOWLIST`
 * 裡只有它與機密模組自己），而那份白名單就是這件事的清單。
 *
 * ## 沒有 SDK
 *
 * Node 22 的全域 `fetch` 就夠了（design D15）。不引入官方 SDK 有兩個理由，第二個是承重的：
 *
 * 1. 依賴放錯 `dependencies` / `devDependencies` 區塊時，dev 完全正常而打包後一啟動就
 *    `MODULE_NOT_FOUND`，唯一驗得到它的載體是最貴的 `probe:package`。
 * 2. **許多服務 SDK 會讀約定俗成的環境變數**（`SLACK_TOKEN` 之屬）。往 `process.env` 寫一個值
 *    就會進到**每一個 pty**（`ptyEnv()` 展開它），而那正是 `secret-scope` 守衛①所防的向量。
 *    不引入 SDK，這件事連發生的機會都沒有。
 *
 * ## 憑證只走 header
 *
 * **絕不放進 URL 或 query string** —— 那會讓它出現在任何記錄 URL 的地方（我們自己的診斷輸出、
 * 對端的存取記錄、錯誤訊息裡的 request 描述）。
 *
 * ## 失敗分三類，而分類是給使用者看的
 *
 * Slack 對業務錯誤回 **HTTP 200 + `{ ok: false, error: '…' }`** —— 只看 HTTP 狀態碼的實作會把
 * 「憑證已失效」當成成功而拿到一個空清單，**症狀與「沒有人提及我」完全相同**。因此這裡把回應
 * 分成三類，讓上層能把「憑證失效」與「暫時性失敗」與「真的沒有東西」區分開（`agent-intake`
 * 那條「失效與閒置必須可區分」倚賴它）。
 */

/** 端點的相對路徑 —— 全部以 POST + form body 呼叫（Slack 兩種都吃，form 較不易踩編碼問題）。 */
type SlackMethod =
  | 'auth.test'
  | 'users.conversations'
  | 'conversations.history'
  | 'conversations.replies'
  | 'users.info'

export type SlackFailure =
  /** 憑證已失效或權限不足 —— **使用者必須知道**，重試無用。 */
  | { kind: 'auth'; error: string }
  /** 暫時性：網路、5xx、速率限制。重試有用。 */
  | { kind: 'transient'; error: string; retryAfterSeconds?: number }
  /** 對端回了我們看不懂的東西 —— 不當成暫時性，否則會無限重試。 */
  | { kind: 'malformed'; error: string }

export type SlackResult<T> = { ok: true; value: T } | ({ ok: false } & SlackFailure)

/** Slack 判定為「憑證／權限」的錯誤碼。其餘一律當暫時性 —— 寧可重試也不要謊報憑證壞了。 */
const AUTH_ERRORS = new Set([
  'invalid_auth',
  'not_authed',
  'account_inactive',
  'token_revoked',
  'token_expired',
  'missing_scope',
  'no_permission',
  'not_allowed_token_type',
])

export interface SlackApiOptions {
  baseUrl: string
  token: Secret
  /**
   * 取代 `fetch` 的接縫，**只給單元測試用**。
   *
   * 產品的替身接縫是**可設定的端點**（design D11），不是這個參數 —— 那一條要能在真正執行中的
   * 應用程式裡被驗收。這個參數讓純邏輯的測試不必起一個 HTTP 伺服器。
   */
  fetchImpl?: typeof fetch
}

export interface SlackIdentity {
  teamId: string
  userId: string
}

export interface SlackChannel {
  id: string
  name: string
}

export interface SlackHistoryPage {
  messages: SlackMessage[]
  /** 還有更多時的游標。 */
  nextCursor?: string
}

function failureFromError(error: string): SlackFailure {
  return AUTH_ERRORS.has(error) ? { kind: 'auth', error } : { kind: 'transient', error }
}

export class SlackApi {
  readonly #baseUrl: string
  readonly #token: Secret
  readonly #fetch: typeof fetch

  constructor(options: SlackApiOptions) {
    this.#baseUrl = options.baseUrl
    this.#token = options.token
    this.#fetch = options.fetchImpl ?? fetch
  }

  /**
   * 呼叫一個方法。
   *
   * **憑證在這裡被解開，而且只在這裡** —— `Authorization` header，不進 URL。
   */
  async #call(method: SlackMethod, params: Record<string, string>): Promise<SlackResult<unknown>> {
    let response: Response
    try {
      response = await this.#fetch(`${this.#baseUrl}/${method}`, {
        method: 'POST',
        headers: {
          // **唯一解開憑證的地方。** 見 `secret-scope` 的 REVEAL_ALLOWLIST。
          Authorization: `Bearer ${this.#token.reveal()}`,
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        },
        body: new URLSearchParams(params).toString(),
      })
    } catch {
      // **刻意不把 error 原文帶出去**：它可能含 request 的描述，而那個描述含 header。
      return { ok: false, kind: 'transient', error: 'network' }
    }

    if (response.status === 429) {
      const header = response.headers.get('retry-after')
      const seconds = header === null ? undefined : Number(header)
      return {
        ok: false,
        kind: 'transient',
        error: 'rate_limited',
        retryAfterSeconds: Number.isFinite(seconds) ? seconds : undefined,
      }
    }
    if (!response.ok) return { ok: false, kind: 'transient', error: `http_${response.status}` }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return { ok: false, kind: 'malformed', error: 'not_json' }
    }
    if (typeof payload !== 'object' || payload === null) {
      return { ok: false, kind: 'malformed', error: 'not_object' }
    }

    const body = payload as Record<string, unknown>
    // **Slack 對業務錯誤回 HTTP 200** —— 只看狀態碼的實作會把「憑證已失效」當成成功。
    if (body.ok !== true) {
      const error = typeof body.error === 'string' ? body.error : 'unknown'
      return { ok: false, ...failureFromError(error) }
    }
    return { ok: true, value: body }
  }

  /**
   * 憑證的擁有者是誰、屬於哪個工作區。
   *
   * **「要偵測誰被提及」的答案就是這裡回傳的 `userId`**（design D14）—— 不是一個設定欄位。
   * 一個填錯的設定欄位，其症狀是什麼都不會發生，與「沒有人提及我」在畫面上完全相同。
   */
  async authTest(): Promise<SlackResult<SlackIdentity>> {
    const result = await this.#call('auth.test', {})
    if (!result.ok) return result
    const body = result.value as Record<string, unknown>
    const teamId = body.team_id
    const userId = body.user_id
    if (typeof teamId !== 'string' || typeof userId !== 'string') {
      return { ok: false, kind: 'malformed', error: 'auth_test_shape' }
    }
    return { ok: true, value: { teamId, userId } }
  }

  /** 使用者所在的頻道（含私訊）。一頁一頁取，由呼叫端決定要不要全部取完。 */
  async usersConversations(
    params: { cursor?: string; limit?: number } = {},
  ): Promise<SlackResult<{ channels: SlackChannel[]; nextCursor?: string }>> {
    const form: Record<string, string> = {
      types: 'public_channel,private_channel,mpim,im',
      exclude_archived: 'true',
      limit: String(params.limit ?? 200),
    }
    if (params.cursor !== undefined) form.cursor = params.cursor
    const result = await this.#call('users.conversations', form)
    if (!result.ok) return result

    const body = result.value as Record<string, unknown>
    if (!Array.isArray(body.channels)) {
      return { ok: false, kind: 'malformed', error: 'conversations_shape' }
    }
    const channels: SlackChannel[] = []
    for (const raw of body.channels) {
      if (typeof raw !== 'object' || raw === null) continue
      const entry = raw as Record<string, unknown>
      if (typeof entry.id !== 'string') continue
      // 私訊沒有 `name` —— 以 id 代替（呈現上不理想，但比丟掉整個頻道好）。
      channels.push({ id: entry.id, name: typeof entry.name === 'string' ? entry.name : entry.id })
    }
    return { ok: true, value: { channels, nextCursor: cursorOf(body) } }
  }

  /** 一個頻道自 `oldest`（含）之後的訊息。 */
  async conversationsHistory(params: {
    channel: string
    oldest: string
    cursor?: string
    limit?: number
  }): Promise<SlackResult<SlackHistoryPage>> {
    const form: Record<string, string> = {
      channel: params.channel,
      oldest: params.oldest,
      inclusive: 'false',
      limit: String(params.limit ?? 200),
    }
    if (params.cursor !== undefined) form.cursor = params.cursor
    const result = await this.#call('conversations.history', form)
    return messagesFrom(result)
  }

  /** 一條討論串的全部訊息（含起始那一則）。 */
  async conversationsReplies(params: {
    channel: string
    ts: string
    limit?: number
  }): Promise<SlackResult<SlackHistoryPage>> {
    const result = await this.#call('conversations.replies', {
      channel: params.channel,
      ts: params.ts,
      limit: String(params.limit ?? 200),
    })
    return messagesFrom(result)
  }

  /** 一個 user 的顯示名稱。取不到時由呼叫端退回 id。 */
  async userDisplayName(userId: string): Promise<SlackResult<string>> {
    const result = await this.#call('users.info', { user: userId })
    if (!result.ok) return result
    const body = result.value as Record<string, unknown>
    const user = body.user
    if (typeof user !== 'object' || user === null) {
      return { ok: false, kind: 'malformed', error: 'users_info_shape' }
    }
    const entry = user as Record<string, unknown>
    const profile =
      typeof entry.profile === 'object' && entry.profile !== null
        ? (entry.profile as Record<string, unknown>)
        : {}
    // 偏好順序：display_name（使用者自己挑的）→ real_name → name（handle）。
    for (const candidate of [profile.display_name, profile.real_name, entry.real_name, entry.name]) {
      if (typeof candidate === 'string' && candidate !== '') return { ok: true, value: candidate }
    }
    return { ok: false, kind: 'malformed', error: 'users_info_no_name' }
  }
}

function cursorOf(body: Record<string, unknown>): string | undefined {
  const meta = body.response_metadata
  if (typeof meta !== 'object' || meta === null) return undefined
  const cursor = (meta as Record<string, unknown>).next_cursor
  return typeof cursor === 'string' && cursor !== '' ? cursor : undefined
}

function messagesFrom(result: SlackResult<unknown>): SlackResult<SlackHistoryPage> {
  if (!result.ok) return result
  const body = result.value as Record<string, unknown>
  if (!Array.isArray(body.messages)) {
    return { ok: false, kind: 'malformed', error: 'messages_shape' }
  }
  const messages: SlackMessage[] = []
  for (const raw of body.messages) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as Record<string, unknown>
    if (typeof entry.ts !== 'string') continue
    messages.push({
      ts: entry.ts,
      user: typeof entry.user === 'string' ? entry.user : undefined,
      text: typeof entry.text === 'string' ? entry.text : undefined,
    })
  }
  // Slack 的 history 由新到舊，`replies` 由舊到新 —— 統一成由舊到新，呼叫端不必記得。
  messages.sort((left, right) => Number(left.ts) - Number(right.ts))
  return { ok: true, value: { messages, nextCursor: cursorOf(body) } }
}
