import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { decideAccept } from './intake-accept'
import { parseIntake } from './intake-schema'
import type { IntakeRecord } from './intake-store'

function record(overrides: Partial<IntakeRecord> = {}, verified: Record<string, unknown> = {}): IntakeRecord {
  const result = parseIntake(
    { id: 'a1', origin: { kind: 'slack', id: 'C1', label: '#dev' }, title: 't', body: 'b', actor: 'x' },
    'file',
  )
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('unreachable')
  return {
    adapter: 'file',
    id: 'a1',
    state: 'pending',
    digest: 'd',
    content: {
      verified: { ...result.value.verified, ...verified },
      authored: result.value.authored,
      receivedAt: 1,
    },
    ...overrides,
  }
}

const KNOWN = new Set(['A', 'B'])

describe('接受的判定：folder 由使用者確認的那一個決定（intake-inbox-usability）', () => {
  it('確認的 folder 在 workspace 中 ⇒ 以它為準', () => {
    assert.deepEqual(decideAccept({ record: record(), chosenFolderId: 'B', knownFolderIds: KNOWN, eventsEnabled: true }), {
      ok: true,
      folderId: 'B',
    })
  })

  it('未指明確認的 folder 的接受被拒絕，即使解析得出', () => {
    // 這個函式拿不到解析結果 —— 「退回」在結構上寫不出來。三種「沒有選」的形狀都要拒絕。
    for (const chosen of [undefined, '', null, 42]) {
      const result = decideAccept({ record: record(), chosenFolderId: chosen, knownFolderIds: KNOWN, eventsEnabled: true })
      assert.deepEqual(result, { ok: false, reason: 'unknown' }, `chosen=${String(chosen)}`)
    }
  })

  it('確認的 folder 已不在 workspace 時回 FOLDER_GONE', () => {
    assert.deepEqual(
      decideAccept({ record: record(), chosenFolderId: 'GONE', knownFolderIds: KNOWN, eventsEnabled: true }),
      { ok: false, reason: 'FOLDER_GONE' },
    )
  })

  it('帶著已解析目標者以使用者確認的 folder 為準', () => {
    // 交接的目標 A 是接收端解析出的；使用者改選 B 時，建立在 B。
    const handoff = record({ adapter: 'handoff' }, { targetFolderId: 'A' })
    const result = decideAccept({ record: handoff, chosenFolderId: 'B', knownFolderIds: KNOWN, eventsEnabled: true })
    assert.deepEqual(result, { ok: true, folderId: 'B' })
  })

  it('事件回報關閉 ⇒ 告知預填不會發生（排在 folder 的檢查之前）', () => {
    // 連 folder 都沒選也一樣 —— 那是「接受之前就要告知」的快速路徑。
    assert.deepEqual(decideAccept({ record: record(), chosenFolderId: '', knownFolderIds: KNOWN, eventsEnabled: false }), {
      ok: false,
      reason: 'prefillUnavailable',
    })
  })

  it('紀錄不存在或內容已過期 ⇒ unknown', () => {
    const args = { chosenFolderId: 'A', knownFolderIds: KNOWN, eventsEnabled: true }
    assert.deepEqual(decideAccept({ ...args, record: undefined }), { ok: false, reason: 'unknown' })
    assert.deepEqual(decideAccept({ ...args, record: record({ content: null }) }), { ok: false, reason: 'unknown' })
  })

  it('已建過 session 者帶回它的識別碼，由 renderer 判斷沿不沿用', () => {
    const result = decideAccept({
      record: record({ sessionId: 'S-old' }),
      chosenFolderId: 'A',
      knownFolderIds: KNOWN,
      eventsEnabled: true,
    })
    assert.deepEqual(result, { ok: true, folderId: 'A', existingSessionId: 'S-old' })
  })
})
