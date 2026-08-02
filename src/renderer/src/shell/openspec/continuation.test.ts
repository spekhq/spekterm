import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { continuationBlockOf } from './continuation'

const RUNNING_CLAUDE = { spawnTarget: 'claude', status: 'running' } as const

describe('continuationBlockOf：續寫入口的條件', () => {
  it('條件全部成立時可用', () => {
    assert.equal(
      continuationBlockOf({
        displayed: { folderId: 'f-a', ...RUNNING_CLAUDE },
        panelFolderId: 'f-a',
      }),
      null,
    )
  })

  it('沒有 session 時回報 noSession', () => {
    assert.equal(continuationBlockOf({ panelFolderId: 'f-a' }), 'noSession')
  })

  it('側欄來源指向別的 repo 時回報 foreignSource', () => {
    assert.equal(
      continuationBlockOf({
        displayed: { folderId: 'f-a', ...RUNNING_CLAUDE },
        panelFolderId: 'f-b',
      }),
      'foreignSource',
    )
  })

  it('shell 目標回報 notClaude，休眠回報 notRunning', () => {
    assert.equal(
      continuationBlockOf({
        displayed: { folderId: 'f-a', spawnTarget: 'shell', status: 'running' },
        panelFolderId: 'f-a',
      }),
      'notClaude',
    )
    assert.equal(
      continuationBlockOf({
        displayed: { folderId: 'f-a', spawnTarget: 'claude', status: 'dormant' },
        panelFolderId: 'f-a',
      }),
      'notRunning',
    )
  })

  /**
   * **design D2 的坑，本 change 自陳最危險的一條。**
   *
   * 全域 session 的 `folderId` 是 `null`，而全域項目的側欄來源**預設也是缺席**。樸素的
   * `panelFolderId !== displayed.folderId` 是兩個缺席值的比較，其結果取決於兩端各自的
   * 正規化：一邊誤停用（少一顆按鈕），另一邊誤啟用 —— 把 change 識別碼送進一個站在家目錄的
   * agent，它會在家目錄建出一個同名的空 change。
   *
   * **對照組**：把 `continuationBlockOf` 的 `displayed.folderId === null` 那一行拿掉（讓它落回
   * `panelFolderId !== displayed.folderId` 的比較），下面兩條之中至少一條必須變紅。
   */
  describe('全域 session：條件 1 恆不成立，且不由缺席值的比較得出', () => {
    it('側欄來源指向某個 repo 時仍停用，且原因是 globalSession', () => {
      assert.equal(
        continuationBlockOf({
          displayed: { folderId: null, ...RUNNING_CLAUDE },
          panelFolderId: 'f-a',
        }),
        'globalSession',
      )
    })

    it('側欄來源亦未選定時仍停用 —— 不因兩者同為缺席而啟用', () => {
      const block = continuationBlockOf({
        displayed: { folderId: null, ...RUNNING_CLAUDE },
        panelFolderId: undefined,
      })
      assert.notEqual(block, null, '兩個缺席值不得被判定為「來源即自身」而啟用入口')
      assert.equal(block, 'globalSession')
    })

    it('回報的原因不是 foreignSource —— 那句說明對它是做不到的建議', () => {
      assert.notEqual(
        continuationBlockOf({
          displayed: { folderId: null, ...RUNNING_CLAUDE },
          panelFolderId: 'f-a',
        }),
        'foreignSource',
      )
    })
  })
})
