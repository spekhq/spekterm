import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_BODY_LENGTH, MAX_FIRST_PARTY_BODY_LENGTH, MAX_FIELD_LENGTH, normalizeAuthored, parseIntake } from './intake-schema'

const ADAPTER = 'file'

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'slack-C123.1699',
    origin: { kind: 'slack', id: 'C123', label: '#dev' },
    title: 'README typo',
    body: 'the link in README is broken',
    actor: 'someone',
    raw: { blocks: [{ text: 'source specific' }] },
    ...overrides,
  }
}

describe('parseIntake 的欄位分組', () => {
  it('解析結果上不存在來源專屬原始內容的欄位', () => {
    const result = parseIntake(payload(), ADAPTER)
    assert.equal(result.ok, true)
    if (!result.ok) return
    // 型別上就沒有它；這條測試釘住的是**執行期也不會被順手帶過去**。
    assert.equal('raw' in (result.value as unknown as Record<string, unknown>), false)
    assert.equal(JSON.stringify(result.value).includes('source specific'), false)
  })

  it('adapter 由呼叫端供應，payload 自稱的來源不被採信', () => {
    const result = parseIntake(payload({ source: 'slack', adapter: 'slack' }), ADAPTER)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.verified.adapter, ADAPTER)
  })

  it('不認得的來源種類仍然放行', () => {
    const result = parseIntake(payload({ origin: { kind: 'tempest', id: 'X1' } }), ADAPTER)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.verified.originKind, 'tempest')
  })
})

describe('parseIntake 對畸形輸入', () => {
  const cases: Array<[string, unknown]> = [
    ['非物件', 'not an object'],
    ['陣列', []],
    ['null', null],
    ['缺 id', payload({ id: undefined })],
    ['id 非字串', payload({ id: 42 })],
    ['缺 origin', payload({ origin: undefined })],
    ['origin.id 非字串', payload({ origin: { kind: 'slack', id: 7 } })],
    ['缺 body', payload({ body: undefined })],
    ['body 非字串', payload({ body: { text: 'x' } })],
  ]

  for (const [name, input] of cases) {
    it(`${name} 被拒絕且不拋出`, () => {
      const result = parseIntake(input, ADAPTER)
      assert.equal(result.ok, false)
    })
  }

  it('本文超過長度上限被拒絕', () => {
    const result = parseIntake(payload({ body: 'x'.repeat(MAX_BODY_LENGTH + 1) }), ADAPTER)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'TOO_LONG')
  })

  it('未知欄位被丟棄而非保留', () => {
    const result = parseIntake(payload({ surprise: 'kept?' }), ADAPTER)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(JSON.stringify(result.value).includes('kept?'), false)
  })
})

describe('normalizeAuthored 是白名單', () => {
  it('保留換行，移除其餘控制字元', () => {
    assert.equal(normalizeAuthored('a\nb\tcd'), 'a\nbcd')
  })

  it('移除雙向文字覆寫與零寬字元', () => {
    assert.equal(normalizeAuthored('a‮b​c﻿d'), 'abcd')
  })

  it('移除 tag 字元（隱形文字注入）', () => {
    assert.equal(normalizeAuthored('a\u{E0041}\u{E0042}b'), 'ab')
  })

  it('保留補充平面的可見字元', () => {
    assert.equal(normalizeAuthored('a😀b'), 'a😀b')
  })

  it('正規化在攝入發生，於是解析結果本身已經是乾淨的', () => {
    const result = parseIntake(payload({ body: 'hello‮world', title: 'title' }), ADAPTER)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.authored.body, 'helloworld')
    assert.equal(result.value.authored.title, 'title')
  })

  it('長度以正規化之後判定 —— 一串不可見字元推不過上限', () => {
    const body = 'x'.repeat(MAX_BODY_LENGTH) + '​'.repeat(50)
    const result = parseIntake(payload({ body }), ADAPTER)
    assert.equal(result.ok, true)
  })
})

describe('本文是否為第三方撰寫', () => {
  it('沒有 provenance 時不存在 —— 共用落點的投遞永遠是第三方的', () => {
    const result = parseIntake(payload({ firstPartyBody: true }), ADAPTER)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.verified.firstPartyBody, undefined)
  })
})

/**
 * 本文長度上限的分流 —— **六格都要驗**。
 *
 * 只驗「first-party 的長本文會過」是不夠的：那一格對一個**把上限整個拿掉**的實作同樣為綠。
 * 要有鑑別力，得同時釘住「第三方那兩格一個字都沒變」與「first-party 仍然有它自己的上限」。
 */
describe('本文長度上限依 firstPartyBody 分流', () => {
  const firstParty = { origin: { kind: 'session', id: 'f1', label: 'repo' }, targetFolderId: 'f1', firstPartyBody: true }
  const thirdParty = { origin: { kind: 'session', id: 'f1', label: 'repo' }, targetFolderId: 'f1' }

  it('第三方：未超過其上限時通過', () => {
    const r = parseIntake(payload({ body: 'x'.repeat(MAX_BODY_LENGTH) }), ADAPTER, thirdParty)
    assert.equal(r.ok, true)
  })

  it('第三方：超過其上限時被拒 —— 與本 change 之前逐字相同', () => {
    const r = parseIntake(payload({ body: 'x'.repeat(MAX_BODY_LENGTH + 1) }), ADAPTER, thirdParty)
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'TOO_LONG')
    assert.equal(r.detail, 'body')
  })

  it('first-party：超過第三方的上限但未超過自己的，通過', () => {
    const r = parseIntake(payload({ body: 'x'.repeat(MAX_BODY_LENGTH + 1) }), ADAPTER, firstParty)
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.value.authored.body.length, MAX_BODY_LENGTH + 1)
  })

  it('first-party：恰在自己的上限上，通過', () => {
    const r = parseIntake(payload({ body: 'x'.repeat(MAX_FIRST_PARTY_BODY_LENGTH) }), ADAPTER, firstParty)
    assert.equal(r.ok, true)
  })

  it('first-party：超過自己的上限時仍然被拒 —— 依據換了，上限沒有消失', () => {
    const r = parseIntake(payload({ body: 'x'.repeat(MAX_FIRST_PARTY_BODY_LENGTH + 1) }), ADAPTER, firstParty)
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'TOO_LONG')
    assert.equal(r.detail, 'body')
  })

  it('title 的上限不分流 —— 它是清單裡的一行，那是呈現預算', () => {
    const r = parseIntake(payload({ title: 't'.repeat(MAX_FIELD_LENGTH + 1) }), ADAPTER, firstParty)
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'TOO_LONG')
    assert.equal(r.detail, 'title')
  })

  it('兩個上限的尺度相同 —— 都以正規化之後的長度判定', () => {
    // 零寬字元被正規化剝掉之後就在上限之內。
    const body = 'x'.repeat(MAX_FIRST_PARTY_BODY_LENGTH) + '\u200b'.repeat(50)
    const r = parseIntake(payload({ body }), ADAPTER, firstParty)
    assert.equal(r.ok, true)
  })
})

describe('發生時間（intake-inbox-usability）', () => {
  it('宣告了不可解析的發生時間的投遞被拒絕', () => {
    // 非字串、亂字串、不帶時區（會被當成本機時間 —— 同一份投遞在不同時區呈現成不同時刻）、
    // 以及 Date.parse 自己會吃的非 ISO 格式。
    for (const occurredAt of [1726912345, 'yesterday', '2026-09-22T07:41:00', 'Sep 22 2026 07:41', '2026-13-45T99:99:00Z']) {
      const result = parseIntake(payload({ occurredAt }), ADAPTER)
      assert.equal(result.ok, false, `occurredAt=${String(occurredAt)} 應被拒絕`)
      if (result.ok) continue
      assert.equal(result.code, 'FIELD_TYPE')
      assert.equal(result.detail, 'occurredAt')
    }
  })

  it('未宣告發生時間的投遞照常進入收件匣', () => {
    const result = parseIntake(payload(), ADAPTER)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal('occurredAt' in result.value.authored, false)
  })

  it('可解析者存成對應的毫秒值，時區被正確套用', () => {
    const utc = parseIntake(payload({ occurredAt: '2026-09-22T07:41:00Z' }), ADAPTER)
    const taipei = parseIntake(payload({ occurredAt: '2026-09-22T15:41:00.500+08:00' }), ADAPTER)
    assert.ok(utc.ok && taipei.ok)
    if (!utc.ok || !taipei.ok) return
    assert.equal(utc.value.authored.occurredAt, Date.UTC(2026, 8, 22, 7, 41))
    assert.equal(taipei.value.authored.occurredAt, Date.UTC(2026, 8, 22, 7, 41, 0, 500))
  })
})
