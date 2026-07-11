import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseDelta } from './delta'

describe('parseDelta', () => {
  it('自 section 標題推導 delta 動作', () => {
    const parsed = parseDelta(
      [
        '## ADDED Requirements',
        '',
        '### Requirement: 使用者可登入',
        '',
        '系統 SHALL 允許登入。',
        '',
        '#### Scenario: 正確的密碼',
        '',
        '- **WHEN** 密碼正確',
        '- **THEN** 登入成功',
      ].join('\n'),
    )

    assert.equal(parsed.fallback, null)
    assert.equal(parsed.requirements.length, 1)
    assert.equal(parsed.requirements[0].verb, 'ADDED')
    assert.equal(parsed.requirements[0].name, '使用者可登入')
    assert.match(parsed.requirements[0].body, /系統 SHALL 允許登入。/)
    // BDD 的原文留在 body 裡 —— 上色由 markdown 的 strong 負責，不在這裡做第二個 parser。
    assert.match(parsed.requirements[0].body, /- \*\*WHEN\*\* 密碼正確/)
  })

  it('一份 delta 可含多個 section 與多條 requirement', () => {
    const parsed = parseDelta(
      [
        '## ADDED Requirements',
        '',
        '### Requirement: 甲',
        '內容甲。',
        '',
        '### Requirement: 乙',
        '內容乙。',
        '',
        '## MODIFIED Requirements',
        '',
        '### Requirement: 丙',
        '內容丙。',
        '',
        '## REMOVED Requirements',
        '',
        '### Requirement: 丁',
        '**Reason**: 不再需要',
        '',
        '## RENAMED Requirements',
        '',
        '### Requirement: 戊',
        'FROM: 舊名',
        'TO: 新名',
      ].join('\n'),
    )

    assert.equal(parsed.fallback, null)
    assert.deepEqual(
      parsed.requirements.map((requirement) => [requirement.verb, requirement.name]),
      [
        ['ADDED', '甲'],
        ['ADDED', '乙'],
        ['MODIFIED', '丙'],
        ['REMOVED', '丁'],
        ['RENAMED', '戊'],
      ],
    )
    assert.match(parsed.requirements[3].body, /不再需要/)
  })

  it('requirement 的內文不含它自己的標題行', () => {
    const parsed = parseDelta(
      ['## ADDED Requirements', '', '### Requirement: 甲', '', '內容。'].join('\n'),
    )

    assert.equal(parsed.requirements[0].body, '內容。')
    assert.ok(!parsed.requirements[0].body.includes('### Requirement'))
  })

  it('沒有任何 requirement 時降級為原樣呈現', () => {
    const raw = '## ADDED Requirements\n\n這份 delta 還沒寫完。\n'
    const parsed = parseDelta(raw)

    assert.deepEqual(parsed.requirements, [])
    assert.equal(parsed.fallback, raw)
  })

  it('requirement 出現在任何 section 標題之前時，不猜它的動作', () => {
    // 動作未知就整份降級 —— 猜錯會讓使用者以為某條是新增的，其實可能是刪除的。
    const raw = '### Requirement: 沒有 section 標題的孤兒\n\n內容。\n'
    const parsed = parseDelta(raw)

    assert.deepEqual(parsed.requirements, [])
    assert.equal(parsed.fallback, raw)
  })

  it('認不得的 section 標題不被當成 delta 動作', () => {
    const raw = '## SOMETHING Requirements\n\n### Requirement: 甲\n\n內容。\n'
    const parsed = parseDelta(raw)

    assert.deepEqual(parsed.requirements, [])
    assert.equal(parsed.fallback, raw)
  })

  it('空內容降級而非拋錯', () => {
    const parsed = parseDelta('')
    assert.deepEqual(parsed.requirements, [])
    assert.equal(parsed.fallback, '')
  })
})
