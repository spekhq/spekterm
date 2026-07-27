import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  SCROLLBACK_MAX_BYTES,
  SessionStore,
  clampScrollback,
  isUuid,
  parseSessions,
} from './session-store'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const UUID_C = '33333333-3333-4333-8333-333333333333'

let dir: string
let file: string
let snapshots: string

function store(): SessionStore {
  const created = new SessionStore(file, snapshots)
  created.load()
  return created
}

function write(content: string): void {
  fs.writeFileSync(file, content, 'utf8')
}

function corruptFiles(): string[] {
  return fs.readdirSync(dir).filter((entry) => entry.includes('.corrupt-'))
}

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'spek-sessions-')))
  file = path.join(dir, 'sessions.json')
  snapshots = path.join(dir, 'sessions')
  fs.mkdirSync(snapshots, { recursive: true })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('isUuid', () => {
  it('拒絕任何可以逸出命令或路徑的東西', () => {
    // 這不是型別檢查，是安全邊界：這些值會被拼進 `claude --resume <id>` 與
    // `<userData>/sessions/<id>.scrollback`。
    assert.equal(isUuid(UUID_A), true)
    assert.equal(isUuid('../../../../etc/passwd'), false)
    assert.equal(isUuid('11111111-1111-4111-8111-111111111111 && rm -rf /'), false)
    assert.equal(isUuid(`${UUID_A}\n`), false)
    assert.equal(isUuid(''), false)
    assert.equal(isUuid(undefined), false)
    assert.equal(isUuid(42), false)
  })
})

describe('parseSessions', () => {
  it('整份無法信任時回 null（版本不符 / 不是 JSON / 形狀不對）', () => {
    assert.equal(parseSessions('{ not json'), null)
    assert.equal(parseSessions(JSON.stringify({ version: 99, sessions: [] })), null)
    assert.equal(parseSessions(JSON.stringify({ version: 1, sessions: 'nope' })), null)
  })

  it('個別項目不合法時只丟棄該項，其餘照常回傳', () => {
    const parsed = parseSessions(
      JSON.stringify({
        version: 1,
        sessions: [
          { id: UUID_A, folderId: 'f1', spawnTarget: 'claude', ordinal: 1 },
          { id: 'not-a-uuid', folderId: 'f1', spawnTarget: 'shell', ordinal: 2 },
          { id: UUID_B, folderId: 'f1', spawnTarget: 'nonsense', ordinal: 3 },
          { id: UUID_C, folderId: 'f1', spawnTarget: 'shell', ordinal: 4 },
        ],
      }),
    )

    // 一個壞掉的 session 不該讓其餘所有 session 一起消失。
    assert.deepEqual(parsed?.map((session) => session.id), [UUID_A, UUID_C])
  })

  it('對話識別碼不合法時只丟棄那筆續接資訊，session 本身留著', () => {
    const parsed = parseSessions(
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: UUID_A,
            folderId: 'f1',
            spawnTarget: 'claude',
            ordinal: 1,
            claudeSessionId: '$(rm -rf /)',
          },
        ],
      }),
    )

    assert.equal(parsed?.length, 1)
    // session 還在（使用者的分頁不該因為一個壞欄位而消失），但那個值絕不會被拿去拼命令。
    assert.equal(parsed?.[0].claudeSessionId, undefined)
  })

  it('相對路徑的 cwd 無從解讀，丟棄後退回 folder 根目錄', () => {
    const parsed = parseSessions(
      JSON.stringify({
        version: 1,
        sessions: [
          { id: UUID_A, folderId: 'f1', spawnTarget: 'shell', ordinal: 1, cwd: '../elsewhere' },
        ],
      }),
    )
    assert.equal(parsed?.[0].cwd, undefined)
  })

  it('側欄來源（panelFolderId）被保留；空字串與非字串丟成 undefined', () => {
    const parsed = parseSessions(
      JSON.stringify({
        version: 1,
        sessions: [
          { id: UUID_A, folderId: 'f1', spawnTarget: 'shell', ordinal: 1, panelFolderId: 'f2' },
          { id: UUID_B, folderId: 'f1', spawnTarget: 'shell', ordinal: 2, panelFolderId: '' },
          { id: UUID_C, folderId: 'f1', spawnTarget: 'shell', ordinal: 3, panelFolderId: 123 },
        ],
      }),
    )
    assert.equal(parsed?.[0].panelFolderId, 'f2')
    assert.equal(parsed?.[1].panelFolderId, undefined)
    assert.equal(parsed?.[2].panelFolderId, undefined)
  })

  /**
   * 工作目錄識別碼是 core 算的路徑 sha1 前 8 碼。
   *
   * **格式在這裡就擋掉，不要讓損毀的值走到查表** —— 比照 `claudeSessionId` 的 `isUuid`。
   * 而格式不合**不丟棄整個 session**：它於 folder 根重建，與從未指定工作目錄的 session 一樣。
   */
  it('工作目錄識別碼（worktreeKey）被保留；格式不合者丟成 undefined 但不丟棄 session', () => {
    const parsed = parseSessions(
      JSON.stringify({
        version: 1,
        sessions: [
          { id: UUID_A, folderId: 'f1', spawnTarget: 'claude', ordinal: 1, worktreeKey: '0ceceaeb' },
          // 大寫、過長、含路徑、非字串 —— 一律丟棄那一筆，但 session 本身留著
          { id: UUID_B, folderId: 'f1', spawnTarget: 'shell', ordinal: 2, worktreeKey: '0CECEAEB' },
          { id: UUID_C, folderId: 'f1', spawnTarget: 'shell', ordinal: 3, worktreeKey: '../../etc' },
        ],
      }),
    )
    assert.equal(parsed?.length, 3, '格式不合不得使該 session 消失')
    assert.equal(parsed?.[0].worktreeKey, '0ceceaeb')
    assert.equal(parsed?.[1].worktreeKey, undefined)
    assert.equal(parsed?.[2].worktreeKey, undefined)
  })

  /**
   * 側欄的工作目錄（`panelWorktreeKey`）與 session 開啟的工作目錄（`worktreeKey`）是**兩個各自
   * 獨立的事實**：前者決定側欄讀哪一份原始碼，後者決定 pty 開在哪。
   *
   * 「在主工作目錄駕駛 agent、同時閱讀某個 worktree 的內容」是合法且有用的 —— 兩者若被合併成
   * 一個欄位，那個情境就表達不出來。兩個欄位型別相同、名字只差一個前綴，是本能力最容易看混的
   * 一對，故這裡以「兩者不同」為主要斷言。
   */
  it('側欄的工作目錄與 session 的工作目錄各自獨立保存，且可不相同', () => {
    const parsed = parseSessions(
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: UUID_A,
            folderId: 'f1',
            spawnTarget: 'claude',
            ordinal: 1,
            worktreeKey: '0ceceaeb',
            panelWorktreeKey: 'deadbeef',
          },
          // 側欄選了某個 worktree，而 session 本身開在 folder 根 —— 主線情境。
          { id: UUID_B, folderId: 'f1', spawnTarget: 'shell', ordinal: 2, panelWorktreeKey: 'cafe1234' },
        ],
      }),
    )

    assert.equal(parsed?.[0].worktreeKey, '0ceceaeb')
    assert.equal(parsed?.[0].panelWorktreeKey, 'deadbeef', '兩者不得互相覆寫')
    assert.equal(parsed?.[1].worktreeKey, undefined, 'session 開在 folder 根')
    assert.equal(parsed?.[1].panelWorktreeKey, 'cafe1234', '而側欄看著另一個工作目錄')
  })

  it('側欄的工作目錄識別碼格式不合時丟成 undefined，且不影響 session 自己的工作目錄', () => {
    const parsed = parseSessions(
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: UUID_A,
            folderId: 'f1',
            spawnTarget: 'claude',
            ordinal: 1,
            worktreeKey: '0ceceaeb',
            panelWorktreeKey: '../../etc',
          },
        ],
      }),
    )

    assert.equal(parsed?.length, 1, '格式不合不得使該 session 消失')
    assert.equal(parsed?.[0].panelWorktreeKey, undefined, '損毀的值不得走到查表')
    assert.equal(parsed?.[0].worktreeKey, '0ceceaeb', '兩筆各自獨立 —— 一筆損毀不牽連另一筆')
  })
})

describe('SessionStore 的損毀韌性', () => {
  it('無法解析時隔離原檔並以空清單啟動', () => {
    write('{ 損毀的內容')
    const kept = store()

    assert.deepEqual(kept.list(), [])
    // 原檔保留不刪 —— 使用者的資料不會因為我們讀不懂它而被無聲銷毀。
    assert.equal(corruptFiles().length, 1)
  })

  it('版本不符時同樣隔離，且不使應用程式無法啟動', () => {
    write(JSON.stringify({ version: 99, sessions: [] }))
    assert.deepEqual(store().list(), [])
    assert.equal(corruptFiles().length, 1)
  })

  it('檔案不存在是正常情形，不隔離也不報錯', () => {
    assert.deepEqual(store().list(), [])
    assert.equal(corruptFiles().length, 0)
  })
})

describe('SessionStore 的欄位歸屬', () => {
  it('replace 保留主行程自己的欄位（renderer 不送、也不該送 cwd 與對話識別碼）', () => {
    const kept = store()
    kept.replace([{ id: UUID_A, folderId: 'f1', spawnTarget: 'claude', ordinal: 1 }])
    kept.update(UUID_A, { claudeSessionId: UUID_B, cwd: '/tmp/somewhere' })

    // renderer 再送一次清單（它改了名字）—— 主行程的欄位不能被這一次覆寫掉。
    kept.replace([
      { id: UUID_A, folderId: 'f1', spawnTarget: 'claude', ordinal: 1, customTitle: '取個名字' },
    ])

    const [session] = kept.list()
    assert.equal(session.customTitle, '取個名字')
    assert.equal(session.claudeSessionId, UUID_B)
    assert.equal(session.cwd, '/tmp/somewhere')
  })

  it('對話識別碼早於 renderer 的第一次 persist 抵達時不得遺失', () => {
    // **這是一個真的時序漏洞**：新建 claude session 時，主行程在 create 回傳的當下就知道對話 id，
    // 而 renderer 要等 setState 之後才送清單過來。少了暫存，那個 id 會被靜默丟棄 —— 症狀是
    // 「每個 claude session 重開後都從新對話開始」，而且不會有任何錯誤訊息。
    const kept = store()
    kept.update(UUID_A, { claudeSessionId: UUID_B })
    kept.replace([{ id: UUID_A, folderId: 'f1', spawnTarget: 'claude', ordinal: 1 }])

    assert.equal(kept.list()[0].claudeSessionId, UUID_B)
  })

  it('replace 丟掉的 session 連同它的快照一併移除', () => {
    const kept = store()
    kept.replace([{ id: UUID_A, folderId: 'f1', spawnTarget: 'shell', ordinal: 1 }])
    kept.writeScrollback(UUID_A, 'hello')
    assert.equal(kept.readScrollback(UUID_A), 'hello')

    kept.replace([])
    assert.equal(kept.readScrollback(UUID_A), null)
    assert.equal(fs.existsSync(path.join(snapshots, `${UUID_A}.scrollback`)), false)
  })
})

describe('SessionStore 的快照', () => {
  it('非 UUID 的識別碼不得組成檔案路徑', () => {
    const kept = store()
    const escape = '../../../../tmp/spek-escape'

    kept.writeScrollback(escape, 'pwned')

    assert.equal(kept.readScrollback(escape), null)
    assert.equal(fs.existsSync('/tmp/spek-escape.scrollback'), false)
  })

  it('清掉沒有對應 session 的孤兒快照（crash 後可能殘留）', () => {
    fs.writeFileSync(path.join(snapshots, `${UUID_A}.scrollback`), 'orphan', 'utf8')
    fs.writeFileSync(path.join(snapshots, `${UUID_B}.scrollback`), 'kept', 'utf8')
    write(
      JSON.stringify({
        version: 1,
        sessions: [{ id: UUID_B, folderId: 'f1', spawnTarget: 'shell', ordinal: 1 }],
      }),
    )

    const kept = store()

    assert.equal(kept.readScrollback(UUID_A), null)
    assert.equal(kept.readScrollback(UUID_B), 'kept')
  })

  it('快照有體積上限，且切點落在換行之後', () => {
    const line = `${'x'.repeat(200)}\n`
    const huge = line.repeat(4000)
    assert.ok(Buffer.byteLength(huge) > SCROLLBACK_MAX_BYTES)

    const clamped = clampScrollback(huge)

    assert.ok(Buffer.byteLength(clamped) <= SCROLLBACK_MAX_BYTES)
    // 保留的是**尾端**（最近的內容才是使用者想看的），且不從一行中間切開。
    assert.ok(huge.endsWith(clamped))
    assert.ok(clamped.startsWith('x'))
  })

  it('沒超過上限的快照原封不動', () => {
    assert.equal(clampScrollback('short'), 'short')
  })
})

describe('SessionStore：已結束的 session 不得被復活', () => {
  it('一份過期的 debounce 清單不得把已結束的 session 寫回磁碟', () => {
    // renderer 的清單是 debounce 落盤的 —— 待寫入的那一份可能是在該 session 結束**之前**擷取的。
    // 使用者若剛好在這個窗口裡關掉 app，關窗時的 flush 會拿那份過期的清單去 replace()，
    // 把一個已經死掉的 session 寫回去，下次以休眠態重建回來。
    const kept = store()
    const alive = { id: UUID_A, folderId: 'f1', spawnTarget: 'claude' as const, ordinal: 1 }
    const dying = { id: UUID_B, folderId: 'f1', spawnTarget: 'shell' as const, ordinal: 2 }
    kept.replace([alive, dying])

    // pty 死了 —— 主行程立刻把它從持久化移除。
    kept.remove(UUID_B)
    assert.deepEqual(kept.list().map((s) => s.id), [UUID_A])

    // 但 renderer 那份「還活著的時候」擷取的清單此刻才落盤。
    kept.replace([alive, dying])

    assert.deepEqual(
      kept.list().map((s) => s.id),
      [UUID_A],
      '已結束的 session 不得因為一份過期的清單而復活',
    )
  })

  it('錨定的 change 跨 replace 保留', () => {
    const kept = store()
    kept.replace([
      { id: UUID_A, folderId: 'f1', spawnTarget: 'claude', ordinal: 1, anchoredChange: 'my-change' },
    ])
    assert.equal(kept.list()[0].anchoredChange, 'my-change')
  })

  it('側欄來源（panelFolderId）跨 replace 保留', () => {
    const kept = store()
    kept.replace([
      { id: UUID_A, folderId: 'f1', spawnTarget: 'claude', ordinal: 1, panelFolderId: 'f2' },
    ])
    assert.equal(kept.list()[0].panelFolderId, 'f2')
  })
})
