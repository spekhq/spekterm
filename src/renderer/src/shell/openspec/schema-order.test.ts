import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fallbackReason } from './schema-order'

describe('fallbackReason', () => {
  it('權威順序可用時不說話', () => {
    // 三條 scenario 裡唯一擋得住「一律顯示」那種實作的一條。
    assert.equal(fallbackReason('active', ['proposal', 'design', 'specs', 'tasks']), null)
    assert.equal(fallbackReason('active', ['proposal']), null)
  })

  it('已封存的 change 說「未被追蹤」', () => {
    // core 只對進行中的 change 查詢權威順序，所以封存的一律走退路 —— 常態而非偶發。
    assert.equal(fallbackReason('archived', undefined), 'archived')
    assert.equal(fallbackReason('archived', []), 'archived')
  })

  it('進行中但取不到時說「不可得」，且不指出成因', () => {
    assert.equal(fallbackReason('active', undefined), 'unavailable')
    assert.equal(fallbackReason('active', []), 'unavailable')
  })

  it('空陣列與 undefined 一樣算取不到', () => {
    // core 的 `resolveSchemaOrder` 對不到任何 id 時回 null（→ undefined），但空陣列同樣代表
    // 「沒有可用的順序」—— 兩者若分歧，其中一條路會靜默地不顯示說明。
    assert.equal(fallbackReason('active', []), fallbackReason('active', undefined))
    assert.equal(fallbackReason('archived', []), fallbackReason('archived', undefined))
  })

  it('權威順序優先於狀態：archived 若真的取得順序，也不說話', () => {
    // 今天走不到（core 不對 archived 查詢），但這條釘住優先序 —— 若哪天 core 開始追蹤封存的
    // change，這裡不該還在說「未被追蹤」。
    assert.equal(fallbackReason('archived', ['proposal', 'tasks']), null)
  })
})
