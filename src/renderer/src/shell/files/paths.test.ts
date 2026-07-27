import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ROOT_PATH, joinRoot, parentOf, stripRoot } from './paths'

/**
 * 樹根前綴的換算（`side-panel-worktree`）。
 *
 * **這一組的核心是 `prefix === ROOT_PATH`（folder 自身）** —— 它是預設情形（絕大多數的使用時間），
 * 卻是最容易被 `if (prefix)` 之類的守衛誤殺的值：空字串是 falsy，一個看起來無害的短路就會讓
 * folder 自身走進「有前綴」的分支，於是每個路徑都多黏一段空字串或少掉一個分隔符。
 *
 * 另一半是**往返**（`stripRoot(joinRoot(x)) === x`）：兩種座標系並存時，真正會出事的不是單向的
 * 換算，而是某個消費端把已經剝過的值再剝一次、或把完整路徑當成樹內位址又接一次前綴。
 */
describe('樹根前綴的換算', () => {
  const WT = '.claude/worktrees/wt-a'

  describe('folder 自身（前綴為空字串）', () => {
    it('joinRoot 原樣回傳，不黏任何分隔符', () => {
      assert.equal(joinRoot(ROOT_PATH, 'lib/foo.ts'), 'lib/foo.ts')
      assert.equal(joinRoot(ROOT_PATH, 'README.md'), 'README.md')
    })

    it('joinRoot 對根本身回根，不變成一個裸的分隔符', () => {
      assert.equal(joinRoot(ROOT_PATH, ROOT_PATH), ROOT_PATH)
    })

    it('stripRoot 原樣回傳', () => {
      assert.equal(stripRoot(ROOT_PATH, 'lib/foo.ts'), 'lib/foo.ts')
      assert.equal(stripRoot(ROOT_PATH, ROOT_PATH), ROOT_PATH)
    })
  })

  describe('以某個工作目錄為根', () => {
    it('joinRoot 接上前綴', () => {
      assert.equal(joinRoot(WT, 'lib/foo.ts'), `${WT}/lib/foo.ts`)
    })

    it('joinRoot 對樹根本身回前綴自己 —— 而不是一個以分隔符結尾的路徑', () => {
      assert.equal(joinRoot(WT, ROOT_PATH), WT)
    })

    it('stripRoot 剝掉前綴', () => {
      assert.equal(stripRoot(WT, `${WT}/lib/foo.ts`), 'lib/foo.ts')
    })

    it('stripRoot 對前綴自己回樹根', () => {
      assert.equal(stripRoot(WT, WT), ROOT_PATH)
    })

    /**
     * 前綴比對必須以分隔符為界。少了那個 `/`，一個**兄弟目錄**會被誤判為在前綴之下，
     * 剝出來的位址指向一棵不存在的樹（`worktree-reverse-navigation` 對 `startsWith` 踩過同型的坑）。
     */
    it('stripRoot 不把名稱僅為前綴延伸的兄弟目錄當成在前綴之下', () => {
      assert.equal(stripRoot(WT, `${WT}-other/lib/foo.ts`), `${WT}-other/lib/foo.ts`)
    })

    it('stripRoot 對不在前綴之下的路徑原樣回傳，不靜默裁切', () => {
      assert.equal(stripRoot(WT, 'lib/foo.ts'), 'lib/foo.ts')
    })
  })

  describe('往返', () => {
    for (const prefix of [ROOT_PATH, WT]) {
      for (const inner of [ROOT_PATH, 'foo.ts', 'a/b/c.ts']) {
        it(`prefix=${JSON.stringify(prefix)} inner=${JSON.stringify(inner)}`, () => {
          assert.equal(stripRoot(prefix, joinRoot(prefix, inner)), inner)
        })
      }
    }
  })

  /**
   * 樹內的 `parentOf` 仍作用於**完整**路徑（它是權威座標系）。這裡釘住的是：一個位於工作目錄
   * 根之下的檔案，其父目錄是那個工作目錄本身 —— 而不是 folder 根。新增／重新命名的目標路徑
   * 由它推導，錯了會把檔案建到樹外去。
   */
  it('parentOf 在完整座標系下指向工作目錄自己', () => {
    assert.equal(parentOf(`${WT}/foo.ts`), WT)
    assert.equal(parentOf(WT), '.claude/worktrees')
  })
})
