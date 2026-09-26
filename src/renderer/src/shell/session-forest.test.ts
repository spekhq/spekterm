import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildForest, childInsertIndex, moveBlock, siblingsOf, type ForestItem } from './session-forest'

const all = (items: ForestItem[]) => new Set(items.map((item) => item.id))
const rows = (items: ForestItem[], present = all(items)) =>
  buildForest(items, present).rows.map((row) => `${'  '.repeat(row.depth)}${row.id}`)

describe('buildForest', () => {
  it('子 session 縮排於母 session 之下', () => {
    assert.deepEqual(rows([{ id: 'P' }, { id: 'X' }, { id: 'C', parentId: 'P' }]), ['P', '  C', 'X'])
  })

  it('兄弟的次序取自單一順序（分頁列把 C2 拖到 C1 之前）', () => {
    assert.deepEqual(
      rows([{ id: 'P' }, { id: 'C2', parentId: 'P' }, { id: 'C1', parentId: 'P' }]),
      ['P', '  C2', '  C1'],
    )
  })

  it('子孫在單一順序中位於母節點之前，仍縮排於其下', () => {
    assert.deepEqual(rows([{ id: 'C', parentId: 'P' }, { id: 'P' }]), ['P', '  C'])
  })

  it('母 session 不存在（或屬於別的項目）時為根', () => {
    const items = [{ id: 'P' }, { id: 'C', parentId: 'P' }]
    assert.deepEqual(rows(items, new Set(['C'])), ['P', 'C'])
    assert.deepEqual(rows([{ id: 'C', parentId: 'elsewhere' }]), ['C'])
  })

  it('深度截斷於上限', () => {
    const chain = ['A', 'B', 'C', 'D', 'E'].map((id, i, list) => ({ id, parentId: i === 0 ? undefined : list[i - 1] }))
    assert.deepEqual(buildForest(chain, all(chain)).rows.map((row) => row.depth), [0, 1, 2, 3, 3])
  })

  it('互為來源與自指的 session 都被呈現（環上的為根）', () => {
    const items = [
      { id: 'A', parentId: 'B' },
      { id: 'B', parentId: 'A' },
      { id: 'S', parentId: 'S' },
    ]
    assert.deepEqual(new Set(buildForest(items, all(items)).rows.map((row) => row.id)), new Set(['A', 'B', 'S']))
  })
})

describe('moveBlock', () => {
  it('三個兄弟，往下拖第一個到最後', () => {
    const items = [{ id: 'P' }, { id: 'C1', parentId: 'P' }, { id: 'C2', parentId: 'P' }, { id: 'C3', parentId: 'P' }]
    const forest = buildForest(items, all(items))
    const order = items.map((item) => item.id)
    assert.deepEqual(moveBlock(order, forest, siblingsOf(forest, 'C1'), 0, 2), ['P', 'C2', 'C3', 'C1'])
  })

  it('帶子孫往下拖：P（帶 C）、X、Y ⇒ X、Y、P、C', () => {
    const items = [{ id: 'P' }, { id: 'C', parentId: 'P' }, { id: 'X' }, { id: 'Y' }]
    const forest = buildForest(items, all(items))
    assert.deepEqual(moveBlock(items.map((item) => item.id), forest, siblingsOf(forest, 'P'), 0, 2), ['X', 'Y', 'P', 'C'])
  })

  it('帶子孫往上拖：X、P（帶 C） ⇒ P、C、X', () => {
    const items = [{ id: 'X' }, { id: 'P' }, { id: 'C', parentId: 'P' }]
    const forest = buildForest(items, all(items))
    assert.deepEqual(moveBlock(items.map((item) => item.id), forest, siblingsOf(forest, 'P'), 1, 0), ['P', 'C', 'X'])
  })

  it('搬動子節點不改變別組的 session', () => {
    const items = [{ id: 'P' }, { id: 'C1', parentId: 'P' }, { id: 'X' }, { id: 'C2', parentId: 'P' }]
    const forest = buildForest(items, all(items))
    // C1、C2 佔據序位 1 與 3；X 留在序位 2。
    assert.deepEqual(moveBlock(items.map((item) => item.id), forest, siblingsOf(forest, 'C1'), 0, 1), ['P', 'C2', 'X', 'C1'])
  })

  it('from 等於 to 時不動', () => {
    const items = [{ id: 'A' }, { id: 'B' }]
    const forest = buildForest(items, all(items))
    assert.deepEqual(moveBlock(['A', 'B'], forest, siblingsOf(forest, 'A'), 1, 1), ['A', 'B'])
  })
})

describe('childInsertIndex', () => {
  it('放在母 session 最後一個子孫之後', () => {
    const items = [{ id: 'P' }, { id: 'C1', parentId: 'P' }, { id: 'X' }]
    assert.equal(childInsertIndex(items.map((item) => item.id), buildForest(items, all(items)), 'P'), 2)
  })

  it('子孫被拖到母節點之前時，仍放在母節點之後', () => {
    const items = [{ id: 'C1', parentId: 'P' }, { id: 'P' }, { id: 'X' }]
    assert.equal(childInsertIndex(items.map((item) => item.id), buildForest(items, all(items)), 'P'), 2)
  })
})
