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

describe('了結的標記（intake-inbox-usability）', () => {
  it('已了結的項目狀態仍為已接受', () => {
    const file = tempFile()
    const store = new IntakeStore(file)
    store.add(intakeOf())
    store.setState('file', 'a1', 'accepted', 'session-7')
    store.settle('file', 'a1', 1234)

    const reloaded = new IntakeStore(file)
    reloaded.load()
    const record = reloaded.get('file', 'a1')
    // **狀態不變是這一條的重點** —— 了結若被做成第四種狀態，舊版會整筆丟棄它（連同去重鍵）。
    assert.equal(record?.state, 'accepted')
    assert.equal(record?.settledAt, 1234)
    assert.equal(record?.sessionId, 'session-7')
  })

  it('只對已接受者生效 —— 待處理與已忽略呼叫它無作用', () => {
    const file = tempFile()
    const store = new IntakeStore(file)
    store.add(intakeOf({ id: 'p1' }))
    store.add(intakeOf({ id: 'd1' }))
    store.setState('file', 'd1', 'dismissed')
    store.settle('file', 'p1', 1)
    store.settle('file', 'd1', 1)
    assert.equal(store.get('file', 'p1')?.settledAt, undefined)
    assert.equal(store.get('file', 'd1')?.settledAt, undefined)
  })

  it('已設過就不覆寫 —— 第一次了結的時刻才是事實', () => {
    const store = new IntakeStore(tempFile())
    store.add(intakeOf())
    store.setState('file', 'a1', 'accepted', 's')
    store.settle('file', 'a1', 10)
    store.settle('file', 'a1', 20)
    assert.equal(store.get('file', 'a1')?.settledAt, 10)
  })

  it('再次被接受時了結的標記被清除', () => {
    // 路徑：預填還沒發生時清除 → 逾時退回待處理 → 再次接受。少了清除，它一建立 session
    // 就從收件匣消失。
    const store = new IntakeStore(tempFile())
    store.add(intakeOf())
    store.setState('file', 'a1', 'accepted', 's1')
    store.settle('file', 'a1', 10)
    store.setState('file', 'a1', 'pending')
    assert.equal(store.get('file', 'a1')?.settledAt, 10, '前置：退回待處理不動它（那不是這一條要驗的）')
    store.setState('file', 'a1', 'accepted', 's2')
    assert.equal(store.get('file', 'a1')?.settledAt, undefined)
  })

  it('非數字的 settledAt 被丟棄，而該筆照常載入', () => {
    const parsed = parseIntakeFile(
      JSON.stringify({
        version: INTAKE_VERSION,
        entries: [{ adapter: 'file', id: 'a1', state: 'accepted', digest: 'd', settledAt: 'yesterday', content: null }],
      }),
    )
    assert.equal(parsed?.entries.length, 1)
    assert.equal(parsed?.entries[0].state, 'accepted')
    assert.equal('settledAt' in (parsed?.entries[0] ?? {}), false)
  })
})

describe('啟動時了結尚未送出的已開好項目（intake-inbox-usability）', () => {
  it('已接受未了結者被了結並落盤；已了結者保留原本的時刻；待處理與已忽略不動', () => {
    const file = tempFile()
    const store = new IntakeStore(file)
    for (const id of ['open', 'done', 'pend', 'gone']) store.add(intakeOf({ id }))
    store.setState('file', 'open', 'accepted', 's1')
    store.setState('file', 'done', 'accepted', 's2')
    store.settle('file', 'done', 10)
    store.setState('file', 'gone', 'dismissed')

    assert.equal(store.settleOpened(500), 1)

    const reloaded = new IntakeStore(file)
    reloaded.load()
    assert.equal(reloaded.get('file', 'open')?.settledAt, 500, '了結必須落盤')
    assert.equal(reloaded.get('file', 'open')?.state, 'accepted')
    assert.equal(reloaded.get('file', 'done')?.settledAt, 10, '第一次了結的時刻才是事實')
    assert.equal(reloaded.get('file', 'pend')?.settledAt, undefined)
    assert.equal(reloaded.get('file', 'gone')?.settledAt, undefined)
  })

  it('沒有東西可了結時不寫檔', () => {
    const file = tempFile()
    const store = new IntakeStore(file)
    store.add(intakeOf())
    const before = fs.statSync(file).mtimeMs
    const contents = fs.readFileSync(file, 'utf8')
    assert.equal(store.settleOpened(), 0)
    assert.equal(fs.readFileSync(file, 'utf8'), contents)
    assert.equal(fs.statSync(file).mtimeMs, before)
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

describe('交接的來源（handoff-lineage）', () => {
  const SESSION = 'c463620e-cfbf-40e4-9732-685d0ea94b89'
  function withSource(source: unknown) {
    const result = parseIntake(
      { id: 'h1', title: 't', body: 'b' },
      'handoff',
      {
        origin: { kind: 'handoff', id: 'f1', label: 'spekterm' },
        targetFolderId: 'f2',
        firstPartyBody: true,
        source: source as never,
      },
    )
    assert.equal(result.ok, true)
    if (!result.ok) throw new Error('unreachable')
    return result.value
  }

  for (const origin of [
    { kind: 'folder', folderId: 'f1', folderName: 'spekterm' },
    { kind: 'global' },
    { kind: 'unknown' },
  ] as const) {
    it(`歸屬 ${origin.kind} 寫入後重新載入不變`, () => {
      const file = tempFile()
      const store = new IntakeStore(file)
      store.add(withSource({ sessionId: SESSION, origin, title: 'Session 交接' }))
      const reloaded = new IntakeStore(file)
      reloaded.load()
      assert.deepEqual(reloaded.get('handoff', 'h1')?.content?.verified.source, {
        sessionId: SESSION,
        origin,
        title: 'Session 交接',
      })
    })
  }

  for (const [label, source] of [
    ['識別碼不是 UUID', { sessionId: '../../etc', origin: { kind: 'global' } }],
    ['歸屬的種類不認得', { sessionId: SESSION, origin: { kind: 'elsewhere' } }],
    ['folder 歸屬缺名稱', { sessionId: SESSION, origin: { kind: 'folder', folderId: 'f1' } }],
  ] as const) {
    it(`載入時丟棄不合法的來源（${label}），record 保留`, () => {
      const file = tempFile()
      const store = new IntakeStore(file)
      store.add(withSource({ sessionId: SESSION, origin: { kind: 'global' } }))
      // 直接改磁碟上的內容 —— 那才是不受信任的來源。
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      data.entries[0].content.verified.source = source
      fs.writeFileSync(file, JSON.stringify(data))

      const reloaded = new IntakeStore(file)
      reloaded.load()
      const record = reloaded.get('handoff', 'h1')
      assert.ok(record?.content, 'record 與內容仍在')
      assert.equal(record?.content?.verified.source, undefined)
    })
  }

  it('來源不進入內容摘要 —— 標題不同的同一份投遞仍是同一則', () => {
    const a = withSource({ sessionId: SESSION, origin: { kind: 'global' }, title: 'before' })
    const b = withSource({ sessionId: SESSION, origin: { kind: 'global' }, title: 'after' })
    assert.equal(digestOf(a.authored, a.verified), digestOf(b.authored, b.verified))
  })
})
