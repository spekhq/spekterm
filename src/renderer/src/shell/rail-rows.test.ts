import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { folderIndexToRow, placeFromRow, rowToFolderIndex } from './rail-rows'

/**
 * 列空間 ↔ folder 序位的換算。
 *
 * **這一族的失效全部是靜默的**，而這個 repo 已經栽過三次（拖曳落點、`Shift+↑`、`Shift+↓`）。
 * 每一次的共同點都是「兩個項目時看不出來」，因此下面一律用**至少三個** folder，且置頂與未置頂
 * 兩段各自至少兩個。
 */

/**
 * 拖曳的一次完整換算：從「被拖曳的 folder 序位」與「落在哪一列」，算出新的序位與置頂狀態。
 *
 * `toRow` 比照 `useDragReorder.onCommit` 交來的第二個參數（移除之後的插入序位）。
 */
function move(
  pinnedCount: number,
  fromFolderIndex: number,
  toRow: number,
): { folderIndex: number; pinned: boolean } {
  const fromRow = folderIndexToRow(fromFolderIndex, pinnedCount)
  return placeFromRow(fromRow, toRow, pinnedCount)
}

describe('列空間與 folder 序位的對應', () => {
  it('置頂者的列索引等於序位，未置頂者相差一位（分界佔掉一列）', () => {
    // 2 置頂 + 2 未置頂 ⇒ 列：[p0] [p1] [分界@2] [u0@3] [u1@4]
    assert.equal(folderIndexToRow(0, 2), 0)
    assert.equal(folderIndexToRow(1, 2), 1)
    assert.equal(folderIndexToRow(2, 2), 3, '第一個未置頂者跳過分界那一列')
    assert.equal(folderIndexToRow(3, 2), 4)

    assert.equal(rowToFolderIndex(0, 2), 0)
    assert.equal(rowToFolderIndex(3, 2), 2)
    assert.equal(rowToFolderIndex(4, 2), 3)
  })

  it('偏移量隨置頂數變動，不是常數', () => {
    // 一個寫死的「加一」在「沒有任何 folder 被置頂」時完全正確 —— 那正是它難被發現的原因。
    assert.equal(folderIndexToRow(0, 0), 1, '沒有置頂者：分界在第 0 列，所有 folder 都往後一格')
    assert.equal(folderIndexToRow(0, 3), 0, '全部置頂：分界在最後，前面的 folder 不偏移')
  })
})

describe('落點推導出的置頂狀態', () => {
  it('把未置頂的 repo 拖到分界之上 ⇒ 置頂', () => {
    // 2 置頂 + 2 未置頂，拖第一個未置頂者（序位 2）到分界之前。
    // 移除之後分界仍在列 2，插在列 2 ＝ 置頂段的最後一格。
    assert.deepEqual(move(2, 2, 2), { folderIndex: 2, pinned: true })
  })

  it('把置頂段最後一個拖到分界之下 ⇒ 取消置頂，且**序位不變**', () => {
    // 2 置頂 + 2 未置頂，拖 p1（序位 1、列 1）。移除之後分界前移到列 1，插在列 2 ＝ 分界之下。
    const result = move(2, 1, 2)
    assert.deepEqual(result, { folderIndex: 1, pinned: false })
    // **這一條是整個換算最要緊的性質**：序位前後同值，只有置頂狀態變了。任何以 folder 序位
    // 判定「有沒有移動」的閘門都會把它吞掉 —— 而在列空間裡它確實移動了一列（1 → 2）。
    assert.equal(result.folderIndex, 1, '序位不變')
  })

  it('沒有任何置頂者時，拖到最上面 ⇒ 置頂', () => {
    // 分界是第 0 列，它上面只有全域項目（不參與命中）。
    assert.deepEqual(move(0, 2, 0), { folderIndex: 0, pinned: true })
  })

  it('沒有任何置頂者時，拖到分界之下的第一格 ⇒ 仍未置頂', () => {
    assert.deepEqual(move(0, 2, 1), { folderIndex: 0, pinned: false })
  })

  it('全部置頂時，拖到最後 ⇒ 取消置頂並落在末端', () => {
    // 3 個全置頂 ⇒ 列：[p0] [p1] [p2] [分界@3]。拖 p0 到列 3（分界之後）。
    assert.deepEqual(move(3, 0, 3), { folderIndex: 2, pinned: false })
  })

  it('段內移動不改變置頂狀態', () => {
    // 2 置頂 + 2 未置頂。置頂段內：p0 → p1 之後。
    assert.deepEqual(move(2, 0, 1), { folderIndex: 1, pinned: true })
    // 其餘段內：u0（序位 2、列 3）→ u1 之後（列 4）。
    assert.deepEqual(move(2, 2, 4), { folderIndex: 3, pinned: false })
  })

  it('只有一個 folder 時兩個方向都跨得過分界', () => {
    // 未置頂 ⇒ 列：[分界@0] [u0@1]。往上一格 ＝ 列 0 ＝ 置頂。
    assert.deepEqual(move(0, 0, 0), { folderIndex: 0, pinned: true })
    // 置頂 ⇒ 列：[p0@0] [分界@1]。往下一格 ＝ 列 1 ＝ 取消置頂。
    assert.deepEqual(move(1, 0, 1), { folderIndex: 0, pinned: false })
  })

  it('往下跨段時序位不多跳一格', () => {
    // 3 置頂 + 2 未置頂 ⇒ 列：[p0][p1][p2][分界@3][u0@4][u1@5]
    // 拖 p0（列 0）到 u0 之後（移除後分界在列 2，u0 在列 3，插在列 4）。
    assert.deepEqual(move(3, 0, 4), { folderIndex: 3, pinned: false })
  })
})
