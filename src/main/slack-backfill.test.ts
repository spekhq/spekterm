import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { SlackApi, SlackResult } from './slack-api'
import { type BackfillDeps, lookbackOldest, runBackfill } from './slack-backfill'
import type { IntakeDelivery, SlackMessage } from './slack-mention'

const SELF = 'U0SELF0000'
const OTHER = 'U0OTHER000'
const TEAM = 'T012ABCDEF'
const CHANNEL = 'C345GHIJKL'

const NOW_MS = 1_700_000_000_000
/** 回看範圍（7 天）之內與之外的兩個時間戳。 */
const INSIDE = `${Math.floor(NOW_MS / 1000) - 3600}.000100`
const OUTSIDE = `${Math.floor(NOW_MS / 1000) - 30 * 24 * 3600}.000100`

function mention(ts: string, text = `hey <@${SELF}> look`): SlackMessage {
  return { ts, user: OTHER, text }
}

interface StubOptions {
  channels?: { id: string; name: string }[]
  /** 每個頻道的歷史訊息。 */
  history?: Record<string, SlackMessage[]>
  /** 討論串（依起始 ts）。省略即回「只有那一則」。 */
  replies?: Record<string, SlackMessage[]>
  authFails?: 'auth' | 'transient'
  historyFails?: boolean
  /** 第 N 次（1 起算）`conversations.history` 回 429。 */
  rateLimitOnHistoryCall?: number
  /** 該 429 帶的 `Retry-After`（秒）。省略＝對端沒帶。 */
  retryAfterSeconds?: number
}

interface Harness {
  deps: BackfillDeps
  delivered: IntakeDelivery[]
  cursors: Record<string, string>
  identity: { teamId: string; userId: string }[]
  historyCalls: { channel: string; oldest: string }[]
  seen: Set<string>
}

function harness(options: StubOptions = {}, overrides: Partial<BackfillDeps> = {}): Harness {
  const delivered: IntakeDelivery[] = []
  const cursors: Record<string, string> = {}
  const identity: { teamId: string; userId: string }[] = []
  const historyCalls: { channel: string; oldest: string }[] = []
  const seen = new Set<string>()

  const api = {
    authTest: async (): Promise<SlackResult<{ teamId: string; userId: string }>> => {
      if (options.authFails !== undefined) {
        return { ok: false, kind: options.authFails, error: 'invalid_auth' }
      }
      return { ok: true, value: { teamId: TEAM, userId: SELF } }
    },
    usersConversations: async () => ({
      ok: true as const,
      value: { channels: options.channels ?? [{ id: CHANNEL, name: 'team-dev' }] },
    }),
    conversationsHistory: async (params: { channel: string; oldest: string }) => {
      historyCalls.push({ channel: params.channel, oldest: params.oldest })
      if (options.rateLimitOnHistoryCall === historyCalls.length) {
        return {
          ok: false as const,
          kind: 'rate_limited' as const,
          error: 'rate_limited',
          retryAfterSeconds: options.retryAfterSeconds,
        }
      }
      if (options.historyFails === true) {
        return { ok: false as const, kind: 'transient' as const, error: 'network' }
      }
      const all = options.history?.[params.channel] ?? []
      // **替身必須真的套用 `oldest`** —— 否則「回看範圍之外的提及不出現」會因為替身不篩而假綠。
      const messages = all.filter((m) => Number(m.ts) > Number(params.oldest))
      return { ok: true as const, value: { messages } }
    },
    conversationsReplies: async (params: { channel: string; ts: string }) => ({
      ok: true as const,
      value: { messages: options.replies?.[params.ts] ?? [] },
    }),
    userDisplayName: async (userId: string) => ({
      ok: true as const,
      value: userId === SELF ? 'kewang' : 'alice',
    }),
  } as unknown as SlackApi

  const deps: BackfillDeps = {
    api,
    cursorOf: (channelId) => cursors[channelId],
    advanceCursor: (channelId, ts) => {
      cursors[channelId] = ts
    },
    rememberIdentity: (teamId, userId) => identity.push({ teamId, userId }),
    alreadyDelivered: (id) => seen.has(id),
    deliver: async (delivery) => {
      delivered.push(delivery)
      seen.add(delivery.id)
    },
    lookbackDays: () => 7,
    maxPerRound: 50,
    now: () => NOW_MS,
    ...overrides,
  }

  return { deps, delivered, cursors, identity, historyCalls, seen }
}

describe('回看範圍', () => {
  it('起點是「現在減去天數」', () => {
    const oldest = lookbackOldest(NOW_MS, 7)
    assert.equal(Number(oldest), Math.floor(NOW_MS / 1000) - 7 * 24 * 3600)
  })

  it('**範圍之外的提及不出現，而範圍之內的同時出現**', async () => {
    // 兩則必須同時存在。只驗範圍之外那一則時，「回補整個沒有運作」會讓它全綠。
    const h = harness({ history: { [CHANNEL]: [mention(OUTSIDE), mention(INSIDE)] } })
    const outcome = await runBackfill(h.deps)

    assert.equal(outcome.delivered, 1)
    assert.equal(h.delivered.length, 1)
    assert.match(h.delivered[0].id, new RegExp(`${INSIDE}$`), '出現的應是範圍之內那一則')
  })

  it('有水位時以水位為起點，而非回看範圍', async () => {
    const h = harness({ history: { [CHANNEL]: [mention(INSIDE)] } })
    h.cursors[CHANNEL] = `${Math.floor(NOW_MS / 1000) - 60}.000000`
    await runBackfill(h.deps)

    assert.equal(h.historyCalls[0].oldest, h.cursors[CHANNEL] === undefined ? '' : h.historyCalls[0].oldest)
    assert.ok(
      Number(h.historyCalls[0].oldest) > Number(lookbackOldest(NOW_MS, 7)),
      '水位比回看範圍新時應以水位為起點',
    )
  })

  it('水位比回看範圍更舊時退回回看範圍 —— 不無界重掃', async () => {
    const h = harness({ history: { [CHANNEL]: [mention(INSIDE)] } })
    h.cursors[CHANNEL] = OUTSIDE
    await runBackfill(h.deps)
    assert.equal(h.historyCalls[0].oldest, lookbackOldest(NOW_MS, 7))
  })
})

describe('去重：問收件匣，不問自己的水位', () => {
  it('收件匣已有該識別碼時不再交付', async () => {
    const h = harness({ history: { [CHANNEL]: [mention(INSIDE)] } })
    await runBackfill(h.deps)
    assert.equal(h.delivered.length, 1, '前提：第一輪確實交付了')

    // **模擬水位遺失**（重裝、設定還原、設定檔損毀隔離）—— 那是會觸發重新推導的主要原因。
    delete h.cursors[CHANNEL]
    const second = await runBackfill(h.deps)

    assert.equal(second.delivered, 0, '不該再交付一次')
    assert.equal(h.delivered.length, 1)
    // **這條 THEN 是必要的**：少了它，「那則根本沒被重新看見」會讓整條假綠。
    assert.equal(h.historyCalls.length, 2, '第二輪確實重新取回並考慮過那一則')
    assert.equal(h.historyCalls[1].oldest, lookbackOldest(NOW_MS, 7), '水位確實遺失了')
  })

  it('收件匣的紀錄涵蓋已被接受或忽略的項目', async () => {
    // 收件匣的 `setState()` 只改狀態、不刪紀錄 —— 於是 `alreadyDelivered` 對那些項目仍為真。
    // 這裡以「seen 保留」模擬那個性質。
    const h = harness({ history: { [CHANNEL]: [mention(INSIDE)] } })
    await runBackfill(h.deps)
    // 使用者接受了它（狀態改變，紀錄仍在）。
    delete h.cursors[CHANNEL]

    const second = await runBackfill(h.deps)
    assert.equal(second.delivered, 0)
  })
})

describe('每輪的交付上限', () => {
  it('一輪不超過上限，其餘記為 deferred', async () => {
    const messages = Array.from({ length: 5 }, (_, i) =>
      mention(`${Math.floor(NOW_MS / 1000) - 100 + i}.000100`),
    )
    const h = harness({ history: { [CHANNEL]: messages } }, { maxPerRound: 2 })
    const outcome = await runBackfill(h.deps)

    assert.equal(outcome.delivered, 2)
    assert.equal(outcome.deferred, 3)
    assert.equal(h.delivered.length, 2)
  })

  it('**水位不前進過還沒交付的提及** —— 否則它們永遠不會被看到', async () => {
    const messages = Array.from({ length: 5 }, (_, i) =>
      mention(`${Math.floor(NOW_MS / 1000) - 100 + i}.000100`),
    )
    const h = harness({ history: { [CHANNEL]: messages } }, { maxPerRound: 2 })
    await runBackfill(h.deps)

    // 交付了前兩則 ⇒ 水位停在第 2 則（index 1），第 3 則仍在下一輪的範圍內。
    assert.equal(h.cursors[CHANNEL], messages[1].ts)

    const second = await runBackfill(h.deps)
    assert.equal(second.delivered, 2, '下一輪續作，不是從頭也不是跳過')
    assert.deepEqual(
      h.delivered.map((d) => d.id.split(':').at(-1)),
      [messages[0].ts, messages[1].ts, messages[2].ts, messages[3].ts],
    )
  })

  it('沒有候選時水位前進到看過的最新一則', async () => {
    const chatter = [{ ts: INSIDE, user: OTHER, text: 'nothing for me' }]
    const h = harness({ history: { [CHANNEL]: chatter } })
    await runBackfill(h.deps)
    assert.equal(h.cursors[CHANNEL], INSIDE, '掃過就該記下來，否則下一輪重掃')
  })
})

describe('身分與失敗', () => {
  it('身分自憑證推導並被記下', async () => {
    const h = harness({ history: { [CHANNEL]: [] } })
    await runBackfill(h.deps)
    assert.deepEqual(h.identity, [{ teamId: TEAM, userId: SELF }])
  })

  it('憑證失效時回報 auth，且不交付任何東西', async () => {
    const h = harness({ authFails: 'auth', history: { [CHANNEL]: [mention(INSIDE)] } })
    const outcome = await runBackfill(h.deps)

    assert.equal(outcome.failure?.kind, 'auth')
    assert.equal(outcome.delivered, 0)
    assert.equal(h.delivered.length, 0)
    assert.equal(h.historyCalls.length, 0, '憑證壞了就不該繼續打其他端點')
  })

  it('暫時性失敗回報 transient，水位不前進', async () => {
    const h = harness({ historyFails: true, history: { [CHANNEL]: [mention(INSIDE)] } })
    const outcome = await runBackfill(h.deps)

    assert.equal(outcome.failure?.kind, 'transient')
    assert.equal(h.cursors[CHANNEL], undefined, '取不到就不該假裝看過了')
  })

  it('**不拋錯** —— 失敗一律以回傳值呈現', async () => {
    // 一個 throw 會在某個 void 的呼叫點變成未捕捉的 rejection，而那在主行程裡是致命的
    // （主行程一死，它底下所有 pty 陪葬）。
    const h = harness({ authFails: 'transient' })
    await assert.doesNotReject(() => runBackfill(h.deps))
  })
})

describe('討論串裁切至被提及的那一則', () => {
  it('提及之後的回覆不進本文', async () => {
    const target = mention(INSIDE)
    const later = `${Number(INSIDE) + 100}`
    const h = harness({
      history: { [CHANNEL]: [target] },
      replies: {
        [INSIDE]: [
          { ts: `${Number(INSIDE) - 200}`, user: OTHER, text: 'BEFORE' },
          target,
          { ts: later, user: OTHER, text: 'AFTER' },
        ],
      },
    })
    await runBackfill(h.deps)

    assert.equal(h.delivered.length, 1)
    assert.match(h.delivered[0].body, /BEFORE/, '之前的內容要在')
    assert.equal(h.delivered[0].body.includes('AFTER'), false, '之後的回覆不該在')
  })

  it('取不到討論串時退回「只有那一則」，而不是讓整則消失', async () => {
    const h = harness({ history: { [CHANNEL]: [mention(INSIDE, `only <@${SELF}> here`)] } })
    await runBackfill(h.deps)
    assert.equal(h.delivered.length, 1)
    assert.match(h.delivered[0].body, /only @kewang here/)
  })
})

describe('對端要我們稍後再試', () => {
  const FOUR = [
    { id: 'C1', name: 'one' },
    { id: 'C2', name: 'two' },
    { id: 'C3', name: 'three' },
    { id: 'C4', name: 'four' },
  ]

  it('**該輪停止詢問其餘頻道 —— 呼叫數等於「到被拒為止」，而不是頻道總數**', async () => {
    // 「不再送註定失敗的請求」這件事在收件匣上看不見（那些請求本來就帶不回任何東西），
    // 可觀察的是**對端收到幾次**。
    const h = harness({ channels: FOUR, rateLimitOnHistoryCall: 2, retryAfterSeconds: 17 })
    const outcome = await runBackfill(h.deps)

    assert.equal(h.historyCalls.length, 2, '被拒之後不該再問第 3、4 個頻道')
    // **後半句是承重的**：少了它，一個「一個頻道都沒掃」的實作也會讓上一條通過。
    assert.notEqual(h.historyCalls.length, FOUR.length, '頻道總數是 4 —— 中止與跑完必須分得出來')
    assert.equal(outcome.rateLimited, true)
    assert.equal(outcome.retryAfterSeconds, 17)
  })

  it('對端沒帶 Retry-After 時仍然回報為速率上限', async () => {
    // 缺席**不代表不必退避** —— 等多久由上層的預設值決定，但「是這一類」必須傳達出去。
    const h = harness({ channels: FOUR, rateLimitOnHistoryCall: 1 })
    const outcome = await runBackfill(h.deps)

    assert.equal(outcome.rateLimited, true)
    assert.equal(outcome.retryAfterSeconds, undefined)
    assert.equal(outcome.failure?.kind, 'rate_limited')
  })

  it('**中止不使已完成的工作回退**', async () => {
    // 中止只是少送了註定失敗的請求。第一個頻道已經掃完、已經交付的部分與其水位不受影響 ——
    // 否則每次被限流都會讓下一輪重做一遍，而那是更多的請求，不是更少。
    const h = harness({
      channels: FOUR,
      history: { C1: [mention(INSIDE)] },
      rateLimitOnHistoryCall: 2,
    })
    const outcome = await runBackfill(h.deps)

    assert.equal(h.delivered.length, 1, '第一個頻道的那則照樣交付')
    assert.equal(h.cursors.C1, INSIDE, '已掃完的頻道水位照常前進')
    assert.equal(h.cursors.C2, undefined, '被拒的頻道水位不動')
    assert.equal(outcome.delivered, 1)
  })

  it('**速率上限不被先到的其他失敗遮掉**', async () => {
    // `failure` 是「先到的贏」。退避資訊若寄生在它上面，一個更早的網路錯誤就會讓 429
    // 永遠讀不到 —— 而症狀只是「偶爾沒有退避」，沒有任何東西會紅。
    const h = harness({
      channels: FOUR,
      rateLimitOnHistoryCall: 3,
      retryAfterSeconds: 9,
      // 第 1、2 次呼叫走這條：`historyFails` 對每一次都成立，所以第 3 次才是 429。
    })
    // 讓前兩次是別種失敗：以 override 包一層。
    const inner = h.deps.api.conversationsHistory.bind(h.deps.api)
    let calls = 0
    ;(h.deps.api as unknown as { conversationsHistory: typeof inner }).conversationsHistory = async (
      params,
    ) => {
      calls += 1
      if (calls <= 2) {
        void (await inner(params))
        return { ok: false as const, kind: 'transient' as const, error: 'network' }
      }
      return inner(params)
    }

    const outcome = await runBackfill(h.deps)

    assert.equal(outcome.failure?.kind, 'transient', '前提：先到的是網路錯誤')
    assert.equal(outcome.rateLimited, true, '而速率上限仍然傳達得出去')
    assert.equal(outcome.retryAfterSeconds, 9)
  })
})
