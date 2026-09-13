import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_BODY_LENGTH, MAX_FIELD_LENGTH, parseIntake } from './intake-schema'
import { isValidIntakeId } from './intake-id'
import {
  type MentionInput,
  type SlackMessage,
  buildDelivery,
  intakeIdOf,
  isCapturedMention,
  mentionsUser,
  truncateToCodeUnits,
} from './slack-mention'

const SELF = 'U0SELF0000'
const OTHER = 'U0OTHER000'

function message(overrides: Partial<SlackMessage> = {}): SlackMessage {
  return { ts: '1699999999.000100', user: OTHER, text: `hey <@${SELF}> look`, ...overrides }
}

function input(overrides: Partial<MentionInput> = {}): MentionInput {
  const msg = overrides.message ?? message()
  return {
    teamId: 'T012ABCDEF',
    channelId: 'C345GHIJKL',
    channelName: 'team-dev',
    message: msg,
    thread: overrides.thread ?? [msg],
    names: { [SELF]: 'kewang', [OTHER]: 'alice' },
    ...overrides,
  }
}

describe('mentionsUser：判準是 <@id> 的形式', () => {
  it('認得標準與舊形式', () => {
    assert.equal(mentionsUser(`hi <@${SELF}>`, SELF), true)
    assert.equal(mentionsUser(`hi <@${SELF}|kewang>`, SELF), true)
    assert.equal(mentionsUser(`hi <@W0SELF0000>`, 'W0SELF0000'), true, 'W 開頭的 enterprise id')
  })

  it('不以顯示名稱的子字串判定', () => {
    // **「訊息裡提到了我的名字」與「有人 tag 我」是不同的事**，而顯示名稱也會撞名。
    assert.equal(mentionsUser('kewang should look at this', SELF), false)
    assert.equal(mentionsUser(`<@${OTHER}> please ask kewang`, SELF), false)
  })

  it('沒有本文時為否', () => {
    assert.equal(mentionsUser(undefined, SELF), false)
  })
})

describe('isCapturedMention：自己 tag 自己**也算**', () => {
  it('別人 tag 我算，我 tag 自己也算，沒 tag 的不算', () => {
    // **第一版排除了「自己發的」，而那條裁決被改掉了。** 失效方向不對稱：
    // 收了而使用者不想要 ⇒ 他按一下忽略；**不收而他想要 ⇒ 他 tag 了自己，什麼都沒發生**，
    // 而那與「功能壞了」在畫面上完全相同。拿 Slack 當待辦捕捉是很常見的用法。
    assert.equal(isCapturedMention(message({ user: OTHER }), SELF), true)
    assert.equal(isCapturedMention(message({ user: SELF }), SELF), true, '自己 tag 自己要收')
    assert.equal(isCapturedMention(message({ text: 'no mention here' }), SELF), false)
  })

  it('**同一批**三則訊息，只有沒 tag 的那一則不成立', () => {
    // 三則必須一起驗。那條否決單獨驗時，「整條管線沒有接上」會讓它全綠 ——
    // 一個什麼都不產生的實作完美滿足「不產生任何 intake」。
    const batch = [
      message({ ts: '1.1', user: SELF }),
      message({ ts: '1.2', text: 'unrelated chatter' }),
      message({ ts: '1.3', user: OTHER }),
    ]
    const hits = batch.filter((m) => isCapturedMention(m, SELF))
    assert.deepEqual(
      hits.map((m) => m.ts),
      ['1.1', '1.3'],
    )
  })
})

describe('識別碼', () => {
  it('形狀為 slack:team:channel:ts，且通過收件匣的驗證', () => {
    const id = intakeIdOf({ teamId: 'T012ABCDEF', channelId: 'C345GHIJKL', ts: '1699999999.000100' })
    assert.equal(id, 'slack:T012ABCDEF:C345GHIJKL:1699999999.000100')
    assert.equal(isValidIntakeId(id), true, '收件匣的字元集必須容得下它')
  })

  it('同一討論串的兩次提及產生相異識別碼', () => {
    // **以訊息而非討論串為單位** —— thread-scoped 的識別碼會讓第二次被 tag 靜默消失。
    const first = intakeIdOf({ teamId: 'T1', channelId: 'C1', ts: '1.1' })
    const second = intakeIdOf({ teamId: 'T1', channelId: 'C1', ts: '2.2' })
    assert.notEqual(first, second)
  })

  it('工作區不同時識別碼相異 —— 頻道 id 跨工作區不保證相異', () => {
    assert.notEqual(
      intakeIdOf({ teamId: 'T1', channelId: 'C1', ts: '1.1' }),
      intakeIdOf({ teamId: 'T2', channelId: 'C1', ts: '1.1' }),
    )
  })
})

describe('buildDelivery：投遞內容', () => {
  it('產出的投遞被收件匣接受', () => {
    // **端到端的形狀檢查**：不是「我覺得欄位齊了」，而是收件匣自己的解析器說它合法。
    const parsed = parseIntake(buildDelivery(input()), 'file')
    assert.equal(parsed.ok, true, parsed.ok ? '' : `被拒絕：${parsed.code} ${parsed.detail ?? ''}`)
  })

  it('提及被解析成顯示名稱 —— 使用者不該讀到一串 id', () => {
    const delivery = buildDelivery(input())
    assert.match(delivery.body, /@kewang/)
    assert.equal(delivery.body.includes(`<@${SELF}>`), false)
    assert.match(delivery.title, /@kewang/)
  })

  it('發話者與頻道以名稱呈現', () => {
    const delivery = buildDelivery(input())
    assert.equal(delivery.actor, 'alice')
    assert.equal(delivery.origin.label, 'team-dev')
    assert.equal(delivery.origin.id, 'C345GHIJKL', '識別碼仍是接收端可驗證的那一個')
  })

  it('查不到顯示名稱時保留 id，而不是留空', () => {
    const delivery = buildDelivery(input({ names: {} }))
    assert.equal(delivery.actor, OTHER, '至少要指出那裡有一個人')
    assert.match(delivery.body, new RegExp(`<@${SELF}>`), '查不到就保留原形')
  })

  it('本文包含整條討論串，順序不變', () => {
    const mention = message({ ts: '3.0', text: `so <@${SELF}> what do you think` })
    const delivery = buildDelivery(
      input({
        message: mention,
        thread: [
          message({ ts: '1.0', text: 'first' }),
          message({ ts: '2.0', text: 'second' }),
          mention,
        ],
      }),
    )
    const firstAt = delivery.body.indexOf('first')
    const secondAt = delivery.body.indexOf('second')
    const mentionAt = delivery.body.indexOf('what do you think')
    assert.ok(firstAt >= 0 && secondAt > firstAt && mentionAt > secondAt, delivery.body)
  })
})

describe('截斷', () => {
  it('依 code point 切，不切出半個 surrogate', () => {
    // 依 code unit 切會把補充平面的字元切成半個 surrogate —— 那是一個無效的字串，
    // 而收件匣的正規化白名單是逐 code point 的，它會把那個半截字元留下來。
    const emoji = '😀'.repeat(10)
    const cut = truncateToCodeUnits(emoji, 5)
    assert.equal(cut.length, 4, '5 個 code unit 只放得下 2 個 emoji')
    assert.equal([...cut].length, 2)
    assert.equal(cut, '😀😀')
  })

  it('過長的討論串被截斷而非被拒絕，且說明在本文之內', () => {
    const long = message({ ts: '9.0', text: `x`.repeat(200) + ` <@${SELF}>` })
    const thread = Array.from({ length: 60 }, (_, i) => message({ ts: `${i}.0`, text: 'y'.repeat(200) }))
    const delivery = buildDelivery(input({ message: long, thread: [...thread, long] }))

    assert.ok(delivery.body.length <= MAX_BODY_LENGTH, `本文長度 ${delivery.body.length}`)
    assert.match(delivery.body, /left out/, '截斷的說明必須在本文字串之內')
    const parsed = parseIntake(delivery, 'file')
    assert.equal(parsed.ok, true, '截斷之後必須被收件匣接受')
  })

  it('截斷保留最接近被提及那一則的內容', () => {
    const long = message({ ts: '9.0', text: `NEEDLE <@${SELF}>` })
    const thread = Array.from({ length: 60 }, (_, i) => message({ ts: `${i}.0`, text: 'y'.repeat(200) }))
    const delivery = buildDelivery(input({ message: long, thread: [...thread, long] }))

    assert.match(delivery.body, /NEEDLE/, '被提及的那一則必須留在本文裡')
  })

  it('**過長的標題不使整則被拒絕**', () => {
    // `MAX_FIELD_LENGTH` 是 200，而 Slack 訊息的第一行很容易超過 —— 只截本文的話，
    // 症狀是某些提及永遠進不了收件匣，而使用者只看到一則看不懂的拒絕。
    const long = message({ ts: '9.0', text: 'T'.repeat(500) + ` <@${SELF}>` })
    const delivery = buildDelivery(input({ message: long, thread: [long] }))

    assert.ok(delivery.title.length <= MAX_FIELD_LENGTH, `標題長度 ${delivery.title.length}`)
    const parsed = parseIntake(delivery, 'file')
    assert.equal(parsed.ok, true, parsed.ok ? '' : `被拒絕：${parsed.code} ${parsed.detail ?? ''}`)
  })

  it('過長的頻道名稱與發話者名稱同樣不使整則被拒絕', () => {
    const delivery = buildDelivery(
      input({
        channelName: 'c'.repeat(500),
        names: { [OTHER]: 'a'.repeat(500), [SELF]: 'kewang' },
      }),
    )
    assert.ok(delivery.origin.label.length <= MAX_FIELD_LENGTH)
    assert.ok(delivery.actor.length <= MAX_FIELD_LENGTH)
    const parsed = parseIntake(delivery, 'file')
    assert.equal(parsed.ok, true, parsed.ok ? '' : `被拒絕：${parsed.code} ${parsed.detail ?? ''}`)
  })
})

describe('上界固定為被提及的那一則 —— 本模組拿不到時鐘', () => {
  it('討論串其後新增的回覆不改變輸出', () => {
    const mention = message({ ts: '3.0' })
    const before = [message({ ts: '1.0', text: 'first' }), mention]
    const first = buildDelivery(input({ message: mention, thread: before }))

    // 呼叫端**應該**只餵到被提及的那一則為止。本模組不知道「現在」，所以「取到現在為止」
    // 在這裡表達不出來 —— 這條釘住的是：只要輸入相同，輸出就相同。
    const again = buildDelivery(input({ message: mention, thread: before }))
    assert.equal(again.body, first.body)
    assert.equal(again.title, first.title)
    assert.equal(again.actor, first.actor)
    assert.equal(again.origin.label, first.origin.label)
  })
})
