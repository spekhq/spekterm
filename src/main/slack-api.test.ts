import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Secret } from './secret-store'
import { SlackApi } from './slack-api'

const TOKEN = 'xoxp-SENTINEL-a7f3c91e-do-not-leak'

interface Call {
  url: string
  init: RequestInit
}

/** 一個記帳用的 `fetch` 替身。**回傳值由測試指定，呼叫內容被記下來供斷言。** */
function stubFetch(
  responses: { status?: number; headers?: Record<string, string>; body?: unknown; raw?: string }[],
): { impl: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  let index = 0
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const spec = responses[Math.min(index, responses.length - 1)]
    index += 1
    const text = spec.raw ?? JSON.stringify(spec.body ?? { ok: true })
    return new Response(text, {
      status: spec.status ?? 200,
      headers: { 'content-type': 'application/json', ...(spec.headers ?? {}) },
    })
  }) as unknown as typeof fetch
  return { impl, calls }
}

function api(responses: Parameters<typeof stubFetch>[0]): { api: SlackApi; calls: Call[] } {
  const { impl, calls } = stubFetch(responses)
  return {
    api: new SlackApi({ baseUrl: 'https://slack.example.com/api', token: new Secret(TOKEN), fetchImpl: impl }),
    calls,
  }
}

describe('憑證只走 header', () => {
  it('憑證出現在 Authorization，且**不在 URL 裡**', async () => {
    // **絕不放進 URL** —— 那會讓它出現在任何記錄 URL 的地方（我們的診斷輸出、對端的存取記錄、
    // 錯誤訊息裡的 request 描述）。
    const { api: client, calls } = api([{ body: { ok: true, team_id: 'T1', user_id: 'U1' } }])
    await client.authTest()

    assert.equal(calls.length, 1)
    assert.equal(calls[0].url.includes(TOKEN), false, '憑證洩漏到 URL 裡')
    assert.equal(calls[0].url, 'https://slack.example.com/api/auth.test')
    const headers = calls[0].init.headers as Record<string, string>
    assert.equal(headers.Authorization, `Bearer ${TOKEN}`)
  })

  it('憑證也不在 body 裡', async () => {
    const { api: client, calls } = api([{ body: { ok: true, team_id: 'T1', user_id: 'U1' } }])
    await client.authTest()
    assert.equal(String(calls[0].init.body ?? '').includes(TOKEN), false, '憑證洩漏到 body 裡')
  })
})

describe('失敗分四類 —— Slack 對業務錯誤回 HTTP 200', () => {
  it('**HTTP 200 + ok:false + 憑證類錯誤碼 ⇒ auth**', async () => {
    // **這是本模組最重要的一條。** 只看 HTTP 狀態碼的實作會把「憑證已失效」當成成功而拿到一個
    // 空清單 —— 而那個症狀與「沒有人提及我」完全相同，使用者會在一件壞掉的事上繼續等。
    for (const error of ['invalid_auth', 'token_revoked', 'account_inactive', 'token_expired']) {
      const { api: client } = api([{ status: 200, body: { ok: false, error } }])
      const result = await client.authTest()
      assert.equal(result.ok, false)
      assert.equal(result.ok ? '' : result.kind, 'auth', `${error} 應被判為 auth`)
    }
  })

  it('**權限不足是 scope 而不是 auth，且帶出缺哪些**', async () => {
    // **兩者的處置完全不同**：`auth` 要換一份憑證，`scope` 要加 scope 並重新安裝。
    // 併在一起是一句會害人白做一輪的謊 —— 實測踩過：`users.conversations` 回 `missing_scope`，
    // 畫面上說「你的憑證不再有效」，而憑證是完全好的。
    const { api: client } = api([
      {
        status: 200,
        body: {
          ok: false,
          error: 'missing_scope',
          needed: 'channels:read,groups:read',
          provided: 'channels:history',
        },
      },
    ])
    const result = await client.authTest()
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'scope')
    // **`needed` 是這則訊息唯一可行動的部分**，而 Slack 在回應裡就給了它。
    assert.equal(result.kind === 'scope' ? result.needed : undefined, 'channels:read,groups:read')
  })

  it('用錯 token 種類也是 scope —— 處置是換用對的那一份，不是重新產生', async () => {
    const { api: client } = api([{ status: 200, body: { ok: false, error: 'not_allowed_token_type' } }])
    assert.equal((await client.authTest()).ok ? '' : 'scope', 'scope')
  })

  it('不認得的錯誤碼判為 transient —— 寧可重試也不要謊報憑證壞了', async () => {
    const { api: client } = api([{ status: 200, body: { ok: false, error: 'fatal_error' } }])
    const result = await client.authTest()
    assert.equal(result.ok ? '' : result.kind, 'transient')
  })

  it('**429 自成一類，並帶上 Retry-After**', async () => {
    // 與 `transient` 分開的理由和 `scope` 與 `auth` 分開相同：**處置不同**。
    // 這一類使用者什麼都不必做，而系統必須等到對端說的那個時間才能再來。
    const { api: client } = api([
      { status: 429, headers: { 'retry-after': '17' }, body: { ok: false, error: 'ratelimited' } },
    ])
    const result = await client.authTest()
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'rate_limited')
    assert.equal(result.error, 'rate_limited')
    assert.equal(result.kind === 'rate_limited' ? result.retryAfterSeconds : undefined, 17)
  })

  it('**沒有 Retry-After 的 429 仍然是 rate_limited**', async () => {
    // 以標頭的有無決定種類，會讓「對端沒帶標頭」靜默退化成「馬上重試」——
    // 而那正是讓拒絕延長的做法。缺席只影響等多久（由上層夾制），不影響是哪一類。
    const { api: client } = api([{ status: 429, body: { ok: false, error: 'ratelimited' } }])
    const result = await client.authTest()
    assert.equal(result.ok ? '' : result.kind, 'rate_limited')
    assert.equal(result.ok || result.kind !== 'rate_limited' ? 'x' : result.retryAfterSeconds, undefined)
  })

  it('5xx 判為 transient', async () => {
    const { api: client } = api([{ status: 503, raw: 'upstream down' }])
    const result = await client.authTest()
    assert.equal(result.ok ? '' : result.kind, 'transient')
  })

  it('**看不懂的回應判為 malformed，不是 transient**', async () => {
    // 判成 transient 會讓上層無限重試一個永遠不會成功的呼叫。
    const notJson = api([{ raw: 'not json at all' }])
    assert.equal((await notJson.api.authTest()).ok ? '' : 'malformed', 'malformed')

    const wrongShape = api([{ body: { ok: true, team_id: 42 } }])
    const result = await wrongShape.api.authTest()
    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.kind, 'malformed')
  })

  it('網路失敗判為 transient，且不帶出底層錯誤原文', async () => {
    // 底層的 error 可能含 request 的描述，而那個描述含 header。
    const impl = (async () => {
      throw new Error(`connect ECONNREFUSED while sending Authorization: Bearer ${TOKEN}`)
    }) as unknown as typeof fetch
    const client = new SlackApi({
      baseUrl: 'https://slack.example.com/api',
      token: new Secret(TOKEN),
      fetchImpl: impl,
    })
    const result = await client.authTest()
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'transient')
    assert.equal(result.error, 'network')
    assert.equal(JSON.stringify(result).includes(TOKEN), false, '憑證經由錯誤原文洩漏')
  })
})

describe('回應的解析', () => {
  it('auth.test 回傳身分 —— 那是「要偵測誰」的答案', async () => {
    const { api: client } = api([{ body: { ok: true, team_id: 'T012ABCDEF', user_id: 'U345GHIJKL' } }])
    const result = await client.authTest()
    assert.deepEqual(result, { ok: true, value: { teamId: 'T012ABCDEF', userId: 'U345GHIJKL' } })
  })

  it('訊息一律排成由舊到新 —— history 與 replies 的原始順序相反', async () => {
    // Slack 的 `conversations.history` 由新到舊，`replies` 由舊到新。統一在這裡，
    // 呼叫端不必記得哪個是哪個（而記錯的症狀是討論串上下顛倒，讀起來莫名其妙）。
    const { api: client } = api([
      {
        body: {
          ok: true,
          messages: [
            { ts: '3.0', user: 'U1', text: 'third' },
            { ts: '1.0', user: 'U1', text: 'first' },
            { ts: '2.0', user: 'U1', text: 'second' },
          ],
        },
      },
    ])
    const result = await client.conversationsHistory({ channel: 'C1', oldest: '0' })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(
      result.value.messages.map((m) => m.text),
      ['first', 'second', 'third'],
    )
  })

  it('形狀不合的單一訊息被跳過，其餘照常', async () => {
    const { api: client } = api([
      { body: { ok: true, messages: [{ ts: '1.0', text: 'ok' }, { notATs: true }, null, 'string'] } },
    ])
    const result = await client.conversationsHistory({ channel: 'C1', oldest: '0' })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.messages.length, 1)
  })

  it('游標只在非空時出現', async () => {
    const withCursor = api([
      { body: { ok: true, messages: [], response_metadata: { next_cursor: 'abc' } } },
    ])
    const first = await withCursor.api.conversationsHistory({ channel: 'C1', oldest: '0' })
    assert.equal(first.ok && first.value.nextCursor, 'abc')

    const emptyCursor = api([
      { body: { ok: true, messages: [], response_metadata: { next_cursor: '' } } },
    ])
    const second = await emptyCursor.api.conversationsHistory({ channel: 'C1', oldest: '0' })
    assert.equal(second.ok && second.value.nextCursor, undefined, '空字串不是游標')
  })

  it('頻道沒有 name 時以 id 代替，而不是丟掉整個頻道', async () => {
    const { api: client } = api([
      { body: { ok: true, channels: [{ id: 'D1' }, { id: 'C1', name: 'general' }, { name: 'no-id' }] } },
    ])
    const result = await client.usersConversations()
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.value.channels, [
      { id: 'D1', name: 'D1' },
      { id: 'C1', name: 'general' },
    ])
  })

  it('顯示名稱依 display_name → real_name → name 的順序取', async () => {
    const display = api([{ body: { ok: true, user: { name: 'handle', profile: { display_name: 'Ke' } } } }])
    assert.equal((await display.api.userDisplayName('U1')).ok && 'Ke', 'Ke')

    const real = api([{ body: { ok: true, user: { name: 'handle', profile: { real_name: 'Ke Wang' } } } }])
    const realResult = await real.api.userDisplayName('U1')
    assert.equal(realResult.ok ? realResult.value : '', 'Ke Wang')

    const handle = api([{ body: { ok: true, user: { name: 'handle', profile: {} } } }])
    const handleResult = await handle.api.userDisplayName('U1')
    assert.equal(handleResult.ok ? handleResult.value : '', 'handle')

    const empty = api([{ body: { ok: true, user: { profile: { display_name: '' } } } }])
    assert.equal((await empty.api.userDisplayName('U1')).ok, false, '空字串不算名字')
  })
})
