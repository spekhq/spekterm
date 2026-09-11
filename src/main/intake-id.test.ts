import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_ID_BYTES, intakeFileStem, intakeIdFromStem, isValidIntakeId } from './intake-id'

describe('識別碼的三段驗證', () => {
  it('乾淨的識別碼通過（其餘測試的對照）', () => {
    assert.equal(isValidIntakeId('slack-C123.1699'), true)
  })

  it('字元集：路徑分隔字元被拒絕', () => {
    assert.equal(isValidIntakeId('a/b'), false)
    assert.equal(isValidIntakeId('a\\b'), false)
  })

  it('整串否決：雙點被拒絕 —— 而它通得過字元集白名單', () => {
    // **這條是第二段存在的全部理由。** 白名單含點號（`C123.1699` 需要），
    // 於是「只留字元集白名單」的實作會放行 `..`。
    assert.equal(/^[A-Za-z0-9._:@+-]+$/.test('..'), true)
    assert.equal(isValidIntakeId('..'), false)
    assert.equal(isValidIntakeId('.'), false)
  })

  it('空字串被拒絕', () => {
    assert.equal(isValidIntakeId(''), false)
  })

  it('非字串被拒絕', () => {
    assert.equal(isValidIntakeId(42), false)
    assert.equal(isValidIntakeId(null), false)
  })

  it('長度上限：恰好上限通過、超過一個位元組被拒絕', () => {
    assert.equal(isValidIntakeId('a'.repeat(MAX_ID_BYTES)), true)
    assert.equal(isValidIntakeId('a'.repeat(MAX_ID_BYTES + 1)), false)
  })

  it('上限以**編碼後的檔名**為尺度，留在 NAME_MAX 之內', () => {
    const stem = intakeFileStem('a'.repeat(MAX_ID_BYTES))
    assert.ok(stem.length + '.json'.length <= 255, `${stem.length + 5} > 255`)
  })
})

describe('檔名的編碼', () => {
  it('輸出字母表只有 0-9a-f —— 沒有大小寫變體、沒有結合字元', () => {
    assert.match(intakeFileStem('Foo.Bar-42'), /^[0-9a-f]+$/)
  })

  it('僅大小寫不同的兩個識別碼得到不同的檔名', () => {
    // 直接用原文當檔名時，這兩者在 macOS APFS 上是**同一個檔案** ——
    // 使用者審 A 的標題、agent 讀 B 的內容。
    assert.notEqual(intakeFileStem('Foo'), intakeFileStem('foo'))
  })

  it('編碼是可逆的（診斷時看得懂）', () => {
    const id = 'slack-C123.1699@x+y:z'
    assert.equal(intakeIdFromStem(intakeFileStem(id)), id)
  })

  it('零碰撞：不同識別碼恆得到不同檔名', () => {
    const ids = ['a', 'aa', 'A', 'a.b', 'a-b', 'ab', 'b']
    const stems = new Set(ids.map(intakeFileStem))
    assert.equal(stems.size, ids.length)
  })

  it('反解對非法格式回 null', () => {
    assert.equal(intakeIdFromStem('zz'), null)
    assert.equal(intakeIdFromStem('abc'), null)
  })
})
