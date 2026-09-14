/**
 * 一個替身 Slack —— **真的 HTTPS 伺服器**，供 `probe:slack` 使用。
 *
 * ## 接縫是產品的端點設定，不是一個測試用的旁路
 *
 * 產品的端點是使用者可設定的（design D11），且 scheme **只認 `https:`**。替身因此必須是 https
 * —— 而不是把那條白名單放寬成「localhost 可以 http」。放寬它等於為了驗收而削弱一條
 * `secret-scope` 的 requirement，那是本 repo 明文禁止的方向（不為驗收在產品上開後門）。
 *
 * ## 自簽憑證怎麼被信任（實測的結論）
 *
 * - `--ignore-certificate-errors` **無效**。實測錯誤碼是 `DEPTH_ZERO_SELF_SIGNED_CERT`，
 *   那是 **Node 的** TLS 錯誤 —— 代表 Electron 主行程的全域 `fetch` 走 undici，
 *   **不是 Chromium 的網路堆疊**，所以 Chromium 的旗標碰不到它。
 * - `NODE_EXTRA_CA_CERTS` **有效**（同一個實驗換這個變數就通了）。
 *
 * 於是信任錨由**環境變數**交給被啟動的 app，產品程式碼一個字都不必知道驗收的存在。
 *
 * ## 它要能演出哪些情形
 *
 * 規格要求替身能演出：憑證失效、同一則提及被重複取回、討論串超過本文上限、標題超過欄位上限、
 * 提及落在回看範圍之外、連線中斷。**少了任何一種，對應的 scenario 就沒有載體。**
 */
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:https'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const STUB_TEAM = 'T0STUBTEAM'
export const STUB_SELF = 'U0STUBSELF'
export const STUB_OTHER = 'U0STUBMATE'
export const STUB_CHANNEL = 'C0STUBCHAN'
export const STUB_CHANNEL_NAME = 'stub-channel'

/** 產生一組自簽憑證。**openssl 缺席時明確失敗** —— 不要靜默改用別的路。 */
function makeCert() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'spekterm-slack-tls-')))
  const key = join(dir, 'key.pem')
  const cert = join(dir, 'cert.pem')
  const result = spawnSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', key, '-out', cert,
      '-days', '2', '-nodes',
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    throw new Error(
      `替身 Slack 需要 openssl 產生自簽憑證，但它失敗了（status=${result.status}）。\n` +
        '安裝：sudo apt install openssl\n' +
        `stderr: ${(result.stderr ?? '').slice(0, 400)}`,
    )
  }
  return { dir, key, cert }
}

/**
 * 一則訊息。`ts` 以「距現在幾秒之前」給，於是「回看範圍之內／之外」寫得出來而不必算絕對時間。
 */
export function stubMessage({ secondsAgo, text, user = STUB_OTHER }) {
  const ts = `${Math.floor(Date.now() / 1000) - secondsAgo}.000100`
  return { ts, user, text }
}

/** 一則提及使用者的訊息。 */
export function stubMention({ secondsAgo, text = 'take a look' }) {
  return stubMessage({ secondsAgo, text: `${text} <@${STUB_SELF}>` })
}

/**
 * 啟動替身。
 *
 * `state` 是可變的 —— probe 在段落之間改它，於是「憑證其後失效」這種情形寫得出來。
 */
export function startStubSlack({ port, state }) {
  const { dir, key, cert } = makeCert()
  const calls = []

  const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    const method = (req.url ?? '').split('/').pop() ?? ''
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      calls.push({ method, body, authorization: req.headers.authorization ?? '' })
      const payload = respond(method, body, state, calls)
      // **header 不能寫死** —— `Retry-After` 是 429 這一類**唯一可行動的部分**，
      // 而產品是從 header 讀它的（body 裡沒有）。
      res.writeHead(payload.status ?? 200, {
        'content-type': 'application/json',
        ...(payload.headers ?? {}),
      })
      res.end(JSON.stringify(payload.body))
    })
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        /** 產品要設定的端點。 */
        baseUrl: `https://127.0.0.1:${port}/api`,
        /** 要交給被啟動的 app 的環境變數 —— 見檔頭「自簽憑證怎麼被信任」。 */
        env: { NODE_EXTRA_CA_CERTS: cert },
        /** 收到過哪些呼叫（供斷言「憑證只走 header」之類）。 */
        calls,
        /** 可變的劇本 —— probe 在段落中途改它，於是「其後改名／其後失效」寫得出來。 */
        state,
        close: () =>
          new Promise((done) => {
            server.close(() => {
              rmSync(dir, { recursive: true, force: true })
              done()
            })
          }),
      })
    })
  })
}

function respond(method, body, state, calls) {
  if (state.authFails === true) {
    return { body: { ok: false, error: 'invalid_auth' } }
  }

  /**
   * 第 N 次 `conversations.history` 回 429。
   *
   * **以「第幾次」而不是「哪個頻道」指定**：要驗的是「被拒之後就不再問其餘頻道」，
   * 而那條斷言的可觀察面正是**呼叫次數**。用頻道 id 指定的話，被拒的那個頻道跳過之後
   * 其餘照問，次數仍然等於頻道總數 —— 斷言就沒有鑑別力了。
   */
  if (state.rateLimitOnHistoryCall !== undefined && method === 'conversations.history') {
    const nth = calls.filter((call) => call.method === 'conversations.history').length
    if (nth === state.rateLimitOnHistoryCall) {
      return {
        status: 429,
        headers:
          state.retryAfterSeconds === undefined
            ? {}
            : { 'retry-after': String(state.retryAfterSeconds) },
        body: { ok: false, error: 'ratelimited' },
      }
    }
  }

  switch (method) {
    case 'auth.test':
      return { body: { ok: true, team_id: STUB_TEAM, user_id: STUB_SELF } }

    case 'apps.connections.open':
      // **回一個連不上的位址**：即時路徑因此會降級，而那正是「斷線是降級不是錯誤」的載體。
      // 真的要驗即時路徑收得到事件的話要一個 wss 伺服器，那條缺口登記在規格裡。
      return { body: { ok: true, url: 'wss://127.0.0.1:1/link' } }

    case 'users.conversations':
      // **頻道數可覆寫**：驗「被拒之後不再問其餘頻道」時，一個頻道的劇本裡
      // 「中止」與「跑完」的結果完全相同 —— 斷言就沒有鑑別力了（同拖曳排序那條紀律：
      // 兩個項目時兩種語意看不出差別）。
      return {
        body: {
          ok: true,
          channels: state.channels ?? [{ id: STUB_CHANNEL, name: STUB_CHANNEL_NAME }],
        },
      }

    case 'conversations.history': {
      const oldest = Number(new URLSearchParams(body).get('oldest') ?? '0')
      // **替身必須真的套用 `oldest`** —— 不套用的話「回看範圍之外的提及不出現」會因為替身不篩
      // 而假綠（那條斷言會變成在測產品有沒有自己再篩一次，而它不該再篩）。
      const messages = (state.messages ?? []).filter((m) => Number(m.ts) > oldest)
      return { body: { ok: true, messages } }
    }

    case 'conversations.replies': {
      const ts = new URLSearchParams(body).get('ts') ?? ''
      return { body: { ok: true, messages: state.threads?.[ts] ?? [] } }
    }

    case 'users.info': {
      const user = new URLSearchParams(body).get('user') ?? ''
      const names = { [STUB_SELF]: 'stub-self', [STUB_OTHER]: 'stub-mate', ...(state.names ?? {}) }
      const name = names[user]
      if (name === undefined) return { body: { ok: false, error: 'user_not_found' } }
      return { body: { ok: true, user: { name, profile: { display_name: name } } } }
    }

    default:
      return { body: { ok: false, error: 'unknown_method' } }
  }
}

/** 把替身的端點寫進 app 的設定檔 —— 產品啟動時就會用它。 */
export function seedSlackSettings(profile, { baseUrl, lookbackDays = 7 }) {
  writeFileSync(
    join(profile, 'slack.json'),
    `${JSON.stringify({ version: 1, slack: { apiBaseUrl: baseUrl, lookbackDays } }, null, 2)}\n`,
    'utf8',
  )
}

/** 把一份使用者憑證寫進 app 的機密檔（權限比照產品：僅擁有者可讀寫）。 */
export function seedSlackToken(profile, token = 'xoxp-stub-token') {
  writeFileSync(
    join(profile, 'secrets.json'),
    `${JSON.stringify({ version: 1, secrets: { 'slack.userToken': token } }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
}
