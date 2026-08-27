import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type AnchorCandidates, resolveAnchoredChange } from './anchor'

const changes = (active: string[], archived: string[] = []): AnchorCandidates => ({
  active: active.map((slug) => ({ slug })),
  archived: archived.map((slug) => ({ slug })),
})

describe('resolveAnchoredChange：錨定的解析', () => {
  it('明確的錨定存在於 active 時用它', () => {
    assert.equal(resolveAnchoredChange('add-oauth', changes(['add-oauth', 'add-invoice'])), 'add-oauth')
  })

  it('明確的錨定落在 archived 時也算數', () => {
    // 使用者可以錨定一個已封存的 change（`openspec-panel`：可錨定已封存的 change），
    // 而主行程的查表同樣涵蓋 archived —— 兩邊的定義域必須一致。
    assert.equal(
      resolveAnchoredChange('2026-08-03-add-list-unsubscribe-header', changes([], ['2026-08-03-add-list-unsubscribe-header'])),
      '2026-08-03-add-list-unsubscribe-header',
    )
  })

  it('明確的錨定查無此項且恰有一個 active 時，退到衍生預設', () => {
    // 封存會把 slug 改名（`add-…` → `2026-08-03-add-…`），落盤的錨定於是永久失效。
    assert.equal(
      resolveAnchoredChange('add-list-unsubscribe-header', changes(['solo-change'], ['2026-08-03-add-list-unsubscribe-header'])),
      'solo-change',
    )
  })

  it('明確的錨定查無此項且 active 不只一個時，沒有可解析的 change', () => {
    assert.equal(resolveAnchoredChange('gone', changes(['a', 'b'])), null)
  })

  it('沒有明確的錨定時，恰一個 active 即為衍生預設', () => {
    assert.equal(resolveAnchoredChange(null, changes(['solo-change'])), 'solo-change')
    assert.equal(resolveAnchoredChange(undefined, changes(['solo-change'])), 'solo-change')
  })

  it('沒有明確的錨定且 active 不只一個時，不猜', () => {
    assert.equal(resolveAnchoredChange(null, changes(['a', 'b'])), null)
  })

  it('一個 active 都沒有時，沒有可解析的 change', () => {
    assert.equal(resolveAnchoredChange(null, changes([], ['old'])), null)
  })

  it('清單尚未載入時回傳「沒有」，不沿用未驗證的錨定', () => {
    // **這一條是整個修正的重點**：沿用的話，啟動當下就會先把 `unknown change slug: …` 閃一次。
    assert.equal(resolveAnchoredChange('add-oauth', null), null)
    assert.equal(resolveAnchoredChange('add-oauth', undefined), null)
  })
})
