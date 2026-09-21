import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { IntakeStore, INTAKE_VERSION, digestOf, parseIntakeFile, type IntakeNotice } from './intake-store'
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

/**
 * 痕跡的落盤 —— **三件事：跨重啟、不 bump 版本、兩個方向都不掉資料。**
 */
describe('永久性拒絕的痕跡', () => {
  const notice = (over: Partial<IntakeNotice> = {}): IntakeNotice => ({
    key: 'k1',
    code: 'TARGET_NOT_FOUND',
    count: 1,
    at: 1_700_000_000_000,
    permanent: true,
    target: 'nowhere',
    origin: 'alpha',
    adapter: 'handoff',
    ...over,
  })

  it('痕跡跨重啟保留', () => {
    const file = tempFile()
    const a = new IntakeStore(file)
    a.setNotices([notice()])

    const b = new IntakeStore(file)
    b.load()
    assert.equal(b.notices().length, 1)
    assert.equal(b.notices()[0].target, 'nowhere')
    assert.equal(b.notices()[0].at, 1_700_000_000_000)
  })

  it('暫時性的不落盤 —— 它們每次重試都會再產生一次', () => {
    const file = tempFile()
    const a = new IntakeStore(file)
    a.setNotices([notice(), notice({ key: 'k2', code: 'MALFORMED', permanent: false })])

    const b = new IntakeStore(file)
    b.load()
    assert.deepEqual(
      b.notices().map((n) => n.key),
      ['k1'],
    )
  })

  it('**升級**：不含痕跡區段的既有檔案載入後，entries 一則不少', () => {
    // 這是那條「加欄位不得 bump 版本」的載體。
    // **對照組：把 INTAKE_VERSION 加一，這條必須變紅。**
    const file = tempFile()
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        entries: [{ adapter: 'file', id: 'a1', state: 'pending', digest: 'd', content: null }],
      }),
    )
    const store = new IntakeStore(file)
    store.load()
    assert.equal(store.list().length, 1, '舊檔案裡的 intake 一則都不能掉')
    assert.deepEqual(store.notices(), [], '沒有那個區段時視為空，不是載入失敗')
  })

  it('**降級**：含痕跡區段的檔案被不認得它的版本載入時，entries 一則不少', () => {
    // 舊版的 parseIntakeFile 只讀 version 與 entries，逐欄位白名單會原樣丟棄 notices。
    const parsed = parseIntakeFile(
      JSON.stringify({
        version: INTAKE_VERSION,
        entries: [{ adapter: 'file', id: 'a1', state: 'pending', digest: 'd', content: null }],
        notices: [notice()],
      }),
    )
    assert.ok(parsed)
    assert.equal(parsed.entries.length, 1, '回滾不得清空收件匣')
  })

  it('痕跡同樣走逐欄位白名單 —— 缺必要欄位者被丟棄', () => {
    const parsed = parseIntakeFile(
      JSON.stringify({
        version: INTAKE_VERSION,
        entries: [],
        notices: [notice(), { key: 'bad' }, null, 'nope'],
      }),
    )
    assert.equal(parsed?.notices?.length, 1)
  })
})
