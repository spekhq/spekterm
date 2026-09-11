import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_BODY_LENGTH, normalizeAuthored, parseIntake } from './intake-schema'

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
