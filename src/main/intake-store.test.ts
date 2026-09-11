import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { IntakeStore, INTAKE_VERSION, digestOf, parseIntakeFile } from './intake-store'
import { parseIntake } from './intake-schema'

const bases: string[] = []
function tempFile(): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-store-'))
  bases.push(base)
  return path.join(base, 'intake.json')
}

after(() => {
  for (const base of bases) fs.rmSync(base, { recursive: true, force: true })
})

function intakeOf(overrides: Record<string, unknown> = {}) {
  const result = parseIntake(
    {
      id: 'a1',
      origin: { kind: 'slack', id: 'C1', label: '#dev' },
      title: 'title',
      body: 'body',
      actor: 'actor',
      ...overrides,
    },
    'file',
  )
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

describe('狀態與關聯跨重啟保留', () => {
  it('寫入後重新載入，狀態與 sessionId 皆不變', () => {
    const file = tempFile()
    const store = new IntakeStore(file)
    store.add(intakeOf())
    store.setState('file', 'a1', 'accepted', 'session-7')

    const reloaded = new IntakeStore(file)
    reloaded.load()
    const record = reloaded.get('file', 'a1')
    assert.equal(record?.state, 'accepted')
    assert.equal(record?.sessionId, 'session-7')
  })

  it('已忽略的狀態跨重啟保留（**非預設值**，這是它有鑑別力的理由）', () => {
    const file = tempFile()
    const store = new IntakeStore(file)
    store.add(intakeOf())
    store.setState('file', 'a1', 'dismissed')

    const reloaded = new IntakeStore(file)
    reloaded.load()
    assert.equal(reloaded.get('file', 'a1')?.state, 'dismissed')
  })

  it('已接受與待處理在同一次重啟後各自保持', () => {
    const file = tempFile()
    const store = new IntakeStore(file)
    store.add(intakeOf({ id: 'a1' }))
    store.add(intakeOf({ id: 'a2' }))
    store.setState('file', 'a1', 'accepted')

    const reloaded = new IntakeStore(file)
    reloaded.load()
    assert.equal(reloaded.get('file', 'a1')?.state, 'accepted')
    assert.equal(reloaded.get('file', 'a2')?.state, 'pending')
  })
})

describe('去重鍵與內容的保留期限分開', () => {
  it('內容清除之後，去重鍵仍在', () => {
    const file = tempFile()
    const store = new IntakeStore(file)
    store.add(intakeOf())
    store.setState('file', 'a1', 'accepted')
    store.expireContent('file', 'a1')

    const record = store.get('file', 'a1')
    assert.equal(record?.content, null)
    assert.equal(record?.state, 'accepted')

    const reloaded = new IntakeStore(file)
    reloaded.load()
    assert.ok(reloaded.get('file', 'a1'), '去重鍵必須跨重啟仍在')
    assert.equal(reloaded.get('file', 'a1')?.content, null)
  })

  it('主鍵含 adapter —— 不同 adapter 的相同識別碼互不衝突', () => {
    const file = tempFile()
    const store = new IntakeStore(file)
    store.add(intakeOf())
    const other = { ...intakeOf(), verified: { ...intakeOf().verified, adapter: 'slack' } }
    store.add(other)
    assert.equal(store.list().length, 2)
  })
})

describe('內容雜湊分辨重送與搶佔', () => {
  it('相同內容得到相同摘要', () => {
    const a = intakeOf()
    const b = intakeOf()
    assert.equal(digestOf(a.authored, a.verified), digestOf(b.authored, b.verified))
  })

  it('本文不同即摘要不同', () => {
    const a = intakeOf()
    const b = intakeOf({ body: 'different' })
    assert.notEqual(digestOf(a.authored, a.verified), digestOf(b.authored, b.verified))
  })

  it('標題不同即摘要不同', () => {
    const a = intakeOf()
    const b = intakeOf({ title: 'different' })
    assert.notEqual(digestOf(a.authored, a.verified), digestOf(b.authored, b.verified))
  })

  it('摘要不含抵達時間 —— 否則每一次重送都會被判成「內容不同」', () => {
    const a = intakeOf()
    const b = { ...intakeOf(), receivedAt: a.receivedAt + 10_000 }
    assert.equal(digestOf(a.authored, a.verified), digestOf(b.authored, b.verified))
  })
})

describe('落盤的解析是逐欄位白名單', () => {
  it('版本不符時整份視為未設定', () => {
    assert.equal(parseIntakeFile(JSON.stringify({ version: INTAKE_VERSION + 1, entries: [] })), null)
  })

  it('形狀不合的單筆被忽略，其餘照常載入', () => {
    const parsed = parseIntakeFile(
      JSON.stringify({
        version: INTAKE_VERSION,
        entries: [
          { adapter: 'file', id: 'good', state: 'pending', digest: 'd', content: null },
          { adapter: 'file', id: 'bad', state: 'nonsense', digest: 'd', content: null },
          { adapter: 42, id: 'worse', state: 'pending', digest: 'd', content: null },
        ],
      }),
    )
    assert.equal(parsed?.entries.length, 1)
    assert.equal(parsed?.entries[0].id, 'good')
  })

  it('未知欄位不會被帶進來', () => {
    const parsed = parseIntakeFile(
      JSON.stringify({
        version: INTAKE_VERSION,
        entries: [
          { adapter: 'file', id: 'a', state: 'pending', digest: 'd', content: null, sneaky: 'x' },
        ],
      }),
    )
    assert.equal(JSON.stringify(parsed).includes('sneaky'), false)
  })

  it('損毀的 JSON 回 null 而非拋出', () => {
    assert.equal(parseIntakeFile('{not json'), null)
  })
})
