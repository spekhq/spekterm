import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { SlackApi, SlackResult } from './slack-api'
import type { BackfillDeps } from './slack-backfill'
import { runBackfill } from './slack-backfill'
import type { IntakeDelivery, SlackMessage } from './slack-mention'
import { type RealtimeSocket, SlackRealtime, ackFor, mentionFromEnvelope } from './slack-realtime'

const SELF = 'U0SELF0000'
const OTHER = 'U0OTHER000'
const TEAM = 'T012ABCDEF'
const CHANNEL = 'C345GHIJKL'
const CHANNEL_NAME = 'team-dev'
const NOW_MS = 1_700_000_000_000
const TS = `${Math.floor(NOW_MS / 1000) - 60}.000100`

function envelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'events_api',
    envelope_id: 'env-1',
    payload: {
      event: { type: 'message', channel: CHANNEL, ts: TS, user: OTHER, text: `hi <@${SELF}>`, ...overrides },
    },
  })
}

/** 一條可驅動的 WebSocket 替身。 */
function socketStub(): { socket: RealtimeSocket; sent: string[]; fire: (type: 'message' | 'close' | 'error', data?: unknown) => void } {
  const handlers: Record<string, ((event: { data?: unknown }) => void)[]> = {}
  const sent: string[] = []
  const socket: RealtimeSocket = {
    send: (data) => sent.push(data),
    close: () => {},
    addEventListener: (type, handler) => {
      handlers[type] ??= []
      handlers[type].push(handler)
    },
  }
  return {
    socket,
    sent,
    fire: (type, data) => {
      for (const handler of handlers[type] ?? []) handler({ data })
    },
  }
}

interface Harness {
  backfill: BackfillDeps
  delivered: IntakeDelivery[]
  degraded: string[]
  api: SlackApi
}

function harness(history: SlackMessage[] = []): Harness {
  const delivered: IntakeDelivery[] = []
  const seen = new Set<string>()
  const degraded: string[] = []

  const api = {
    authTest: async (): Promise<SlackResult<{ teamId: string; userId: string }>> => ({
      ok: true,
      value: { teamId: TEAM, userId: SELF },
    }),
    appsConnectionsOpen: async (): Promise<SlackResult<string>> => ({
      ok: true,
      value: 'wss://wss.example.com/link',
    }),
    usersConversations: async () => ({
      ok: true as const,
      value: { channels: [{ id: CHANNEL, name: CHANNEL_NAME }] },
    }),
    conversationsHistory: async (params: { oldest: string }) => ({
      ok: true as const,
      value: { messages: history.filter((m) => Number(m.ts) > Number(params.oldest)) },
    }),
    conversationsReplies: async () => ({ ok: true as const, value: { messages: [] } }),
    userDisplayName: async (userId: string) => ({
      ok: true as const,
      value: userId === SELF ? 'kewang' : 'alice',
    }),
  } as unknown as SlackApi

  const cursors: Record<string, string> = {}
  const backfill: BackfillDeps = {
    api,
    cursorOf: (id) => cursors[id],
    advanceCursor: (id, ts) => {
      cursors[id] = ts
    },
    rememberIdentity: () => {},
    alreadyDelivered: (id) => seen.has(id),
    deliver: async (delivery) => {
      delivered.push(delivery)
      seen.add(delivery.id)
    },
    lookbackDays: () => 7,
    maxPerRound: 50,
    now: () => NOW_MS,
  }

  return { backfill, delivered, degraded, api }
}

describe('mentionFromEnvelope：純函式', () => {
  it('挖出別人提及使用者的那一則', () => {
    const found = mentionFromEnvelope(JSON.parse(envelope()), SELF)
    assert.deepEqual(found, { channelId: CHANNEL, message: { ts: TS, user: OTHER, text: `hi <@${SELF}>` } })
  })

  it('自己發的、沒提及的、非 message 型別、有 subtype 的都不算', () => {
    assert.equal(mentionFromEnvelope(JSON.parse(envelope({ user: SELF })), SELF), null)
    assert.equal(mentionFromEnvelope(JSON.parse(envelope({ text: 'nothing' })), SELF), null)
    assert.equal(mentionFromEnvelope(JSON.parse(envelope({ type: 'reaction_added' })), SELF), null)
    // 編輯／刪除不是一則新訊息。
    assert.equal(mentionFromEnvelope(JSON.parse(envelope({ subtype: 'message_changed' })), SELF), null)
  })

  it('**不認得的形狀一律回 null，不拋錯**', () => {
    // Slack 隨時會加新的事件型別。把它當失敗會讓一條正常的連線被判定為壞掉。
    for (const bad of [null, 42, {}, { payload: 1 }, { payload: { event: 'x' } }]) {
      assert.equal(mentionFromEnvelope(bad, SELF), null)
    }
  })
})

describe('ack', () => {
  it('events_api 要 ack，且帶 envelope_id', () => {
    assert.equal(ackFor(JSON.parse(envelope())), JSON.stringify({ envelope_id: 'env-1' }))
  })

  it('hello 與 disconnect 不 ack', () => {
    assert.equal(ackFor({ type: 'hello' }), null)
    assert.equal(ackFor({ type: 'disconnect', envelope_id: 'x' }), null)
  })

  it('缺 envelope_id 時不 ack（送一個沒有 id 的 ack 是無意義的）', () => {
    assert.equal(ackFor({ type: 'events_api' }), null)
  })
})

describe('SlackRealtime', () => {
  it('收到提及後交付，且**先 ack**', async () => {
    const h = harness()
    const stub = socketStub()
    const realtime = new SlackRealtime({
      connections: h.api,
      backfill: h.backfill,
      channelNameOf: () => CHANNEL_NAME,
      openSocket: () => stub.socket,
      onDegraded: (failure) => h.degraded.push(failure.error),
    })

    assert.equal(await realtime.start({ teamId: TEAM, selfUserId: SELF }), true)
    stub.fire('message', envelope())
    await realtime.stop()

    // **ack 要先做，而且與我們是否關心那則事件無關** —— 不 ack 的信封 Slack 會重送。
    assert.deepEqual(stub.sent, [JSON.stringify({ envelope_id: 'env-1' })])
    assert.equal(h.delivered.length, 1)
    assert.deepEqual(h.degraded, [])
  })

  it('不關心的事件也照樣 ack', async () => {
    const h = harness()
    const stub = socketStub()
    const realtime = new SlackRealtime({
      connections: h.api,
      backfill: h.backfill,
      channelNameOf: () => CHANNEL_NAME,
      openSocket: () => stub.socket,
    })
    await realtime.start({ teamId: TEAM, selfUserId: SELF })
    stub.fire('message', envelope({ text: 'chatter with no mention' }))
    await realtime.stop()

    assert.equal(stub.sent.length, 1, '沒 ack 的話 Slack 會重送')
    assert.equal(h.delivered.length, 0)
  })

  it('開不了連線只是降級 —— 回 false，不拋錯', async () => {
    const h = harness()
    const api = {
      ...h.api,
      appsConnectionsOpen: async (): Promise<SlackResult<string>> => ({
        ok: false,
        kind: 'auth',
        error: 'not_allowed_token_type',
      }),
    } as unknown as SlackApi
    const realtime = new SlackRealtime({
      connections: api,
      backfill: h.backfill,
      channelNameOf: () => CHANNEL_NAME,
      openSocket: () => socketStub().socket,
      onDegraded: (failure) => h.degraded.push(failure.error),
    })

    assert.equal(await realtime.start({ teamId: TEAM, selfUserId: SELF }), false)
    assert.deepEqual(h.degraded, ['not_allowed_token_type'])
  })

  it('斷線回報為降級，而不是錯誤', async () => {
    const h = harness()
    const stub = socketStub()
    const realtime = new SlackRealtime({
      connections: h.api,
      backfill: h.backfill,
      channelNameOf: () => CHANNEL_NAME,
      openSocket: () => stub.socket,
      onDegraded: (failure) => h.degraded.push(failure.error),
    })
    await realtime.start({ teamId: TEAM, selfUserId: SELF })
    stub.fire('close')
    await realtime.stop()

    assert.deepEqual(h.degraded, ['disconnected'])
  })

  it('看不懂的內容略過，不把連線判死', async () => {
    const h = harness()
    const stub = socketStub()
    const realtime = new SlackRealtime({
      connections: h.api,
      backfill: h.backfill,
      channelNameOf: () => CHANNEL_NAME,
      openSocket: () => stub.socket,
      onDegraded: (failure) => h.degraded.push(failure.error),
    })
    await realtime.start({ teamId: TEAM, selfUserId: SELF })
    stub.fire('message', 'not json at all')
    stub.fire('message', envelope())
    await realtime.stop()

    assert.equal(h.delivered.length, 1, '壞掉的那一則不該影響下一則')
    assert.deepEqual(h.degraded, [])
  })

  it('stop() 之後不再處理事件', async () => {
    const h = harness()
    const stub = socketStub()
    const realtime = new SlackRealtime({
      connections: h.api,
      backfill: h.backfill,
      channelNameOf: () => CHANNEL_NAME,
      openSocket: () => stub.socket,
    })
    await realtime.start({ teamId: TEAM, selfUserId: SELF })
    await realtime.stop()
    stub.fire('message', envelope())

    assert.equal(h.delivered.length, 0)
  })
})

describe('兩條路徑的產出必須一致（design D1 的載體）', () => {
  it('**同一則提及，回補與即時產出逐欄位相同的投遞**', async () => {
    // D1 承諾「即時只是把同一件事提早送到」。若兩條路徑各自組內容，先到的那一條會定案，
    // 而使用者讀到的與另一條會產出的**不同** —— 那是一個難查的不一致，且沒有東西會紅。
    const mention: SlackMessage = { ts: TS, user: OTHER, text: `hi <@${SELF}>` }

    const viaBackfill = harness([mention])
    await runBackfill(viaBackfill.backfill)

    const viaRealtime = harness()
    const stub = socketStub()
    const realtime = new SlackRealtime({
      connections: viaRealtime.api,
      backfill: viaRealtime.backfill,
      channelNameOf: () => CHANNEL_NAME,
      openSocket: () => stub.socket,
    })
    await realtime.start({ teamId: TEAM, selfUserId: SELF })
    stub.fire('message', envelope())
    await realtime.stop()

    assert.equal(viaBackfill.delivered.length, 1, '前提：回補確實交付了')
    assert.equal(viaRealtime.delivered.length, 1, '前提：即時確實交付了')
    // **逐欄位相同** —— 那正是收件匣去重摘要涵蓋的那組欄位。
    assert.deepEqual(viaRealtime.delivered[0], viaBackfill.delivered[0])
  })

  it('頻道名稱查不到時才退回 id —— 那是最後手段，不是預設', async () => {
    const h = harness()
    const stub = socketStub()
    const realtime = new SlackRealtime({
      connections: h.api,
      backfill: h.backfill,
      channelNameOf: () => undefined,
      openSocket: () => stub.socket,
    })
    await realtime.start({ teamId: TEAM, selfUserId: SELF })
    stub.fire('message', envelope())
    await realtime.stop()

    assert.equal(h.delivered[0].origin.label, CHANNEL, '查不到就用 id，不留空')
  })
})
