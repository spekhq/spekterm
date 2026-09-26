import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { decidePeerName, isValidPeerName, peerPrefix, PEER_NAME_MAX_LENGTH } from './peer-name'

const ID = 'c463620e-cfbf-40e4-9732-685d0ea94b89'

describe('peerPrefix', () => {
  it('一般的 folder 名稱原樣保留', () => assert.equal(peerPrefix('spekterm'), 'spekterm'))
  it('CJK 保留', () => assert.equal(peerPrefix('簡報'), '簡報'))
  it('全域為固定字', () => assert.equal(peerPrefix(null), 'global'))
  it('沒有任何字母或數字時用代替字', () => assert.equal(peerPrefix('---'), 'session'))
  it('shell 特殊字元換成 -，收斂並去首尾', () => {
    assert.equal(peerPrefix('a"b $(touch x)'), 'a-b-touch-x')
  })
  it('首字不會是 _ 或 -', () => assert.equal(peerPrefix('_hidden'), 'hidden'))
})

describe('decidePeerName', () => {
  it('前綴加上識別碼的前 4 碼', () => {
    assert.equal(decidePeerName('spekterm', ID, []), 'spekterm-c463')
  })

  it('短碼相撞時延長，且不影響既有者', () => {
    const first = decidePeerName('spekterm', ID, [])
    const second = decidePeerName('spekterm', 'c4636299-0000-4000-8000-000000000000', [first])
    assert.equal(first, 'spekterm-c463')
    assert.equal(second, 'spekterm-c46362')
  })

  it('比較不分大小寫', () => {
    const name = decidePeerName('Spekterm', ID, ['spekterm-c463'])
    assert.notEqual(name.toLowerCase(), 'spekterm-c463')
  })

  it('超長的前綴被截短，總長不超過上限', () => {
    const name = decidePeerName('x'.repeat(200), ID, [])
    assert.ok([...name].length <= PEER_NAME_MAX_LENGTH)
    assert.ok(name.endsWith('-c463'))
  })

  it('截短之後不以 - 結尾於前綴', () => {
    const name = decidePeerName(`${'x'.repeat(58)}-yyyy`, ID, [])
    assert.ok(!name.includes('--'))
  })

  it('產生的名字都通過驗證', () => {
    for (const label of ['spekterm', '簡報', '---', 'a"b $(touch x)', null, 'x'.repeat(200)]) {
      assert.ok(isValidPeerName(decidePeerName(label, ID, [])), String(label))
    }
  })
})

describe('isValidPeerName', () => {
  it('拒絕字元集之外的值', () => {
    for (const bad of ['a b', 'a"b', '-flag', '', 'a$b', 'x'.repeat(65), 42, null]) {
      assert.equal(isValidPeerName(bad), false, String(bad))
    }
  })
  it('接受 CJK 與 _、-', () => assert.ok(isValidPeerName('簡報_a-c463')))
})
