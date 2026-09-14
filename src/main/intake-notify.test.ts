import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildPayload,
  FIELD_MAX,
  IntakeNotifier,
  reduceForNotification,
  type NotifyBackend,
  type NotifyClock,
  type NotifyPayload,
} from './intake-notify'
import { parseIntake } from './intake-schema'
import type { IntakeRecord } from './intake-store'

/** 可控時鐘 —— 驗收不必真的等，而「等一個真實的窗」會讓判準落在兩個都非 0 的數字之間。 */
function fakeClock(): NotifyClock & { advance: (ms: number) => void } {
  let now = 0
  const timers: { at: number; fn: () => void; cancelled: boolean }[] = []
  return {
    now: () => now,
    after: (ms, fn) => {
      const timer = { at: now + ms, fn, cancelled: false }
      timers.push(timer)
      return () => { timer.cancelled = true }
    },
    advance: (ms) => {
      const target = now + ms
      for (;;) {
        const due = timers
          .filter((timer) => !timer.cancelled && timer.at <= target)
          .sort((a, b) => a.at - b.at)[0]
        if (!due) break
        due.cancelled = true
        now = due.at
        due.fn()
      }
      now = target
    },
  }
}

function recorder(usable = true): NotifyBackend & { sent: NotifyPayload[] } {
  const sent: NotifyPayload[] = []
  return {
    sent,
    present: (payload) => { sent.push(payload) },
    usable: () => usable,
    onActivate: () => {},
  }
}

function record(overrides: Record<string, unknown> = {}): IntakeRecord {
  const parsed = parseIntake(
    {
      id: 'a1',
      origin: { kind: 'slack', id: 'C0ENG', label: '#engineering' },
      title: 'the link in README is broken',
      actor: 'alex',
      body: 'body text',
      ...overrides,
    },
    'file',
  )
  assert.equal(parsed.ok, true)
  if (!parsed.ok) throw new Error('unreachable')
  const intake = parsed.value
  return {
    adapter: 'file',
    id: intake.id,
    state: 'pending',
    digest: 'd',
    content: { verified: intake.verified, authored: intake.authored, receivedAt: 0 },
  }
}

describe('合併是固定窗口', () => {
  it('單一到達發出一則', () => {
    const clock = fakeClock()
    const backend = recorder()
    const notifier = new IntakeNotifier({ backend, clock, windowMs: 1000 })
    notifier.arrived(record())
    assert.equal(backend.sent.length, 0, '窗到期之前不發')
    clock.advance(1000)
    assert.equal(backend.sent.length, 1)
  })

  it('窗內十則合併為一則', () => {
    const clock = fakeClock()
    const backend = recorder()
    const notifier = new IntakeNotifier({ backend, clock, windowMs: 1000 })
    for (let i = 0; i < 10; i += 1) {
      notifier.arrived(record({ id: `a${i}` }))
      clock.advance(50)
    }
    clock.advance(1000)
    assert.equal(backend.sent.length, 1)
    assert.ok(backend.sent[0].title.includes('10'), '合併的那一則陳述數量')
  })

  it('**持續到達時通知不被無限延後**', () => {
    // 這是這條 requirement 的重心，也是整份 change 唯一分辨得出 debounce 的斷言。
    //
    // **判準落在 0 與非 0 之間**：debounce 的計時器被每一次到達往後推，於是在這個節奏下
    // 它永遠不會到期 —— 結果是 0（或最後一次 advance 收尾時的 1）。固定窗口則每個窗各發一則。
    const clock = fakeClock()
    const backend = recorder()
    const notifier = new IntakeNotifier({ backend, clock, windowMs: 1000, burstMax: 100 })

    // 以短於窗長的間隔持續到達，跨越數個窗。
    for (let i = 0; i < 12; i += 1) {
      notifier.arrived(record({ id: `a${i}` }))
      clock.advance(800)
    }

    assert.ok(
      backend.sent.length >= 3,
      `持續到達了 12 則、跨越約 9 個窗，卻只發出 ${backend.sent.length} 則`,
    )
  })
})

describe('窗與窗之間的總量有界', () => {
  it('**逾越上界之後不再各自發出，打開收件匣即重置**', () => {
    const clock = fakeClock()
    const backend = recorder()
    const notifier = new IntakeNotifier({
      backend,
      clock,
      windowMs: 1000,
      burstWindowMs: 100_000,
      burstMax: 3,
    })

    // 以「每個窗恰好一則」的節奏 —— 合併完全不介入，這正是合併擋不住的那個形狀。
    for (let i = 0; i < 6; i += 1) {
      notifier.arrived(record({ id: `a${i}` }))
      clock.advance(1500)
    }
    assert.equal(backend.sent.length, 3, '逾越上界之後不再發出')

    notifier.inboxOpened()
    notifier.arrived(record({ id: 'after' }))
    clock.advance(1500)
    assert.equal(backend.sent.length, 4, '使用者已經知道了 ⇒ 重置')
  })
})

describe('通知不可用時靜默降級', () => {
  it('後端回報不可用 ⇒ 不發出、不拋錯', () => {
    const clock = fakeClock()
    const backend = recorder(false)
    const notifier = new IntakeNotifier({ backend, clock, windowMs: 1000 })
    notifier.arrived(record())
    clock.advance(1000)
    assert.equal(backend.sent.length, 0)
  })
})

describe('通知的文字', () => {
  it('**標題不含投遞提供的任何值**', () => {
    const payload = buildPayload([
      record({ title: 'TITLE-MARKER', actor: 'ACTOR-MARKER', origin: { kind: 'slack', id: 'C1', label: 'LABEL-MARKER' } }),
    ])
    assert.equal(payload.title.includes('TITLE-MARKER'), false)
    assert.equal(payload.title.includes('ACTOR-MARKER'), false)
    assert.equal(payload.title.includes('LABEL-MARKER'), false)
    // 反向的錨：那些值確實走到了內文，否則上面三條對一個什麼都不放的實作照樣成立。
    assert.ok(payload.body.includes('TITLE-MARKER'))
    assert.ok(payload.body.includes('ACTOR-MARKER'))
    assert.ok(payload.body.includes('LABEL-MARKER'))
  })

  it('**合併的那一則不含任何第三方文字**', () => {
    const payload = buildPayload([
      record({ id: 'a', title: 'TITLE-MARKER-A', actor: 'ACTOR-A' }),
      record({ id: 'b', title: 'TITLE-MARKER-B', actor: 'ACTOR-B' }),
    ])
    const whole = `${payload.title}\n${payload.body}`
    for (const marker of ['TITLE-MARKER-A', 'TITLE-MARKER-B', 'ACTOR-A', 'ACTOR-B']) {
      assert.equal(whole.includes(marker), false, marker)
    }
  })

  it('**通知不含路徑、folder 名稱或識別碼**', () => {
    const payload = buildPayload([record({ id: 'ID-MARKER' })])
    const whole = `${payload.title}\n${payload.body}`
    assert.equal(whole.includes('ID-MARKER'), false, 'intake 的識別碼不得出現')
    assert.equal(/[\\/][A-Za-z0-9._-]+[\\/]/.test(whole), false, '不得含路徑形狀')
  })

  it('**僅存在於原始投遞的內容不進入通知**', () => {
    // 結構上不可達（紀錄型別不攜帶原始內容），但字元集或型別放寬時它會回來。
    const payload = buildPayload([record({ raw: { note: 'SOURCE-ONLY-MARKER' } })])
    assert.equal(`${payload.title}${payload.body}`.includes('SOURCE-ONLY-MARKER'), false)
  })

  it('系統文案不依 adapter 而異', () => {
    const fromFile = buildPayload([record()])
    const slack = { ...record(), adapter: 'slack' }
    assert.equal(buildPayload([slack]).title, fromFile.title)
  })
})

describe('第三方欄位進入通知之前的縮減', () => {
  it('**會被詮釋為標記的字元被移除**', () => {
    const out = reduceForNotification('BEFORE <b>BOLD</b> & <i>x</i> AFTER')
    for (const ch of ['<', '>', '&']) assert.equal(out.includes(ch), false, ch)
    assert.ok(out.includes('BEFORE') && out.includes('AFTER'), '其餘文字保留')
  })

  it('**URL 的形狀被替換掉**', () => {
    for (const url of [
      'https://evil.example/beacon',
      'www.evil.example/x',
      'evil.example/x',
      'http://a.b/c?d=e',
    ]) {
      const out = reduceForNotification(`BEFORE ${url} AFTER`)
      assert.equal(out.includes('evil.example'), false, url)
      assert.equal(out.includes('a.b'), false, url)
      assert.ok(out.includes('BEFORE') && out.includes('AFTER'), url)
    }
  })

  it('超過上限即截短', () => {
    const out = reduceForNotification('x'.repeat(FIELD_MAX + 50))
    assert.ok([...out].length <= FIELD_MAX + 1, `得到 ${[...out].length}`)
  })

  it('**縮減吃的是已正規化的值** —— 不可列印字元早已不在', () => {
    // **不可以把那些字元寫成字面值** —— lint 的 no-irregular-whitespace 會擋它，而更根本的
    // 理由與「不要寫字面 NUL」同族：一個看不見的位元組在原始碼裡沒有人讀得出來。
    const ZERO_WIDTH = '\u200b'
    const BIDI = '\u202e'
    const BELL = '\u0007'
    const built = record({ title: `A${ZERO_WIDTH}B${BIDI}C${BELL}D` })
    const payload = buildPayload([built])
    for (const ch of [ZERO_WIDTH, BIDI, BELL]) {
      assert.equal(payload.body.includes(ch), false, JSON.stringify(ch))
    }
    assert.ok(payload.body.includes('ABCD'), '正規化之後它們就是相連的')
  })
})
