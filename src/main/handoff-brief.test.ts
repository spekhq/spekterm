import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { configureTicketLineage, handoffTickets, ticketResolutionFor } from './handoff-ticket'
import type { Intake } from './intake-schema'
import { IntakeStore } from './intake-store'
import { createSession } from './session-create'
import { readBriefFor } from './handoff-brief'
import { parseLineage, SessionStore } from './session-store'

/**
 * 交接單（`handoff-brief`）：建立當下保存、壽命等於 session、與收件匣的保留期限脫鉤。
 */

const PARENT = 'c463620e-cfbf-40e4-9732-685d0ea94b89'
/** 含會被正規化改動的字元之外的一般字元即可 —— 這裡驗的是「取的是 record 上那一份」，正規化由 intake-schema 自己的測試負責。 */
const BODY = 'HANDOFF-BODY-HEAD\n做這件事\n<b>not html</b>\nHANDOFF-BODY-TAIL'

function handoffIntake(id: string, firstPartyBody = true): Intake {
  return {
    id,
    verified: {
      adapter: 'handoff',
      originKind: 'handoff',
      originId: PARENT,
      ...(firstPartyBody ? { firstPartyBody: true } : {}),
      source: { sessionId: PARENT, origin: { kind: 'folder', folderId: 'f1', folderName: 'alpha' }, title: 'parent' },
    },
    authored: { title: 'HANDOFF-TITLE', body: BODY, actor: 'agent', originLabel: 'alpha' },
    receivedAt: 1_790_000_000_000,
  }
}

let dir: string
let sessions: SessionStore
let intake: IntakeStore

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), 'handoff-brief-'))
  sessions = new SessionStore(path.join(dir, 'sessions.json'), path.join(dir, 'sessions'))
  sessions.load()
  intake = new IntakeStore(path.join(dir, 'intake.json'))
  intake.load()
  configureTicketLineage(({ adapter, id }) => ticketResolutionFor(intake.get(adapter, id)))
})

afterEach(() => {
  configureTicketLineage(null)
  fs.rmSync(dir, { recursive: true, force: true })
})

async function createFor(id: string): Promise<string> {
  const ticket = handoffTickets.issue({ adapter: 'handoff', id, folderId: 'f2' })
  const result = await createSession({
    sessions,
    folderId: 'f2',
    target: 'claude',
    railLabel: 'beta',
    ticket,
    spawn: async (sessionId) => ({ sessionId }),
  })
  return result.sessionId
}

describe('交接單於建立當下保存（handoff-brief）', () => {
  it('標題與到達時間進 lineage，本文另存且逐字元等於 record 上的本文', async () => {
    intake.add(handoffIntake('h1'))
    const sessionId = await createFor('h1')
    const lineage = sessions.view().find((v) => v.session.id === sessionId)?.session.lineage
    assert.deepEqual(lineage?.brief, { title: 'HANDOFF-TITLE', receivedAt: 1_790_000_000_000 })
    assert.equal(sessions.readHandoffBrief(sessionId)?.body, BODY)
    // 本文**不在** sessions 清單裡（它會隨每次整份重寫一起寫）。
    assert.ok(!JSON.stringify(sessions.view()).includes('HANDOFF-BODY-HEAD'))
  })

  it('spawn 的那一刻交接單已經在磁碟上', async () => {
    intake.add(handoffIntake('h1'))
    let seenAtSpawn: string | undefined
    const ticket = handoffTickets.issue({ adapter: 'handoff', id: 'h1', folderId: 'f2' })
    await createSession({
      sessions,
      folderId: 'f2',
      target: 'claude',
      railLabel: 'beta',
      ticket,
      spawn: async (sessionId) => {
        seenAtSpawn = sessions.readHandoffBrief(sessionId)?.body
        return { sessionId }
      },
    })
    assert.equal(seenAtSpawn, BODY)
  })

  it('收件匣移除了內容（expireContent）之後，交接單不變 —— 它是快照，不是以主鍵回查', async () => {
    // **這是這條 requirement 唯一有鑑別力的載體**：產品程式碼目前沒有呼叫 `expireContent`，
    // 於是任何經過 UI 的載體對「以主鍵回查」的錯誤實作都是綠的（design D3）。
    intake.add(handoffIntake('h1'))
    const sessionId = await createFor('h1')
    intake.expireContent('handoff', 'h1')
    assert.equal(intake.get('handoff', 'h1')?.content, null, '前置：內容真的被移除了')
    assert.equal(sessions.readHandoffBrief(sessionId)?.body, BODY)
  })

  it('收件匣了結之後，交接單不變', async () => {
    intake.add(handoffIntake('h1'))
    const sessionId = await createFor('h1')
    intake.settle('handoff', 'h1')
    assert.equal(sessions.readHandoffBrief(sessionId)?.body, BODY)
  })

  it('第三方本文不產生交接單', async () => {
    intake.add(handoffIntake('h3', false))
    const sessionId = await createFor('h3')
    const lineage = sessions.view().find((v) => v.session.id === sessionId)?.session.lineage
    assert.ok(lineage, '前置：仍有來源')
    assert.equal(lineage.brief, undefined)
    assert.equal(sessions.readHandoffBrief(sessionId), null)
  })
})

describe('交接單的壽命等於 session（handoff-brief）', () => {
  it('關閉（remove）之後交接單不在磁碟上 —— 即使它還只在暫定紀錄裡', async () => {
    intake.add(handoffIntake('h1'))
    const sessionId = await createFor('h1')
    const file = path.join(dir, 'sessions', `${sessionId}.handoff.json`)
    assert.ok(fs.existsSync(file), '前置：檔案存在')
    sessions.remove(sessionId)
    assert.ok(!fs.existsSync(file))
  })

  it('被 renderer 的清單拿掉之後（replace）交接單一併刪除', async () => {
    intake.add(handoffIntake('h1'))
    const sessionId = await createFor('h1')
    sessions.replace([{ id: sessionId, folderId: 'f2', spawnTarget: 'claude', ordinal: 1 }])
    assert.ok(sessions.readHandoffBrief(sessionId), '前置：認領之後仍在')
    sessions.replace([])
    assert.equal(sessions.readHandoffBrief(sessionId), null)
  })

  it('孤兒被 prune 清掉，但暫定紀錄的不算孤兒', async () => {
    // **對照組**：把 prune 的「已知 session」改回只看 `#sessions` → 第二個斷言必須變紅。
    intake.add(handoffIntake('h1'))
    const sessionId = await createFor('h1')
    const orphan = path.join(dir, 'sessions', 'd0d0d0d0-0000-4000-8000-000000000000.handoff.json')
    fs.writeFileSync(orphan, JSON.stringify({ body: 'x' }))
    sessions.pruneScrollback()
    assert.ok(!fs.existsSync(orphan), '孤兒被清掉')
    assert.equal(sessions.readHandoffBrief(sessionId)?.body, BODY, '暫定紀錄的交接單不被當成孤兒')
  })
})

describe('損毀的交接單', () => {
  it('lineage 裡壞掉的 brief 被丟棄，來源照留', () => {
    const parsed = parseLineage({
      parentId: PARENT,
      origin: { kind: 'global' },
      brief: { title: 42, receivedAt: 'nope' },
    })
    assert.ok(parsed, '來源照留')
    assert.equal(parsed.brief, undefined)
  })

  it('本文檔損毀時讀回 null，session 與來源照留', async () => {
    intake.add(handoffIntake('h1'))
    const sessionId = await createFor('h1')
    fs.writeFileSync(path.join(dir, 'sessions', `${sessionId}.handoff.json`), '{not json')
    assert.equal(sessions.readHandoffBrief(sessionId), null)
    assert.ok(sessions.view().find((v) => v.session.id === sessionId)?.session.lineage?.brief)
  })
})

describe('交接單只經以 session 識別碼查詢的通道送出（handoff-brief）', () => {
  it('存在且帶交接單 ⇒ 本文；不存在、非字串、沒有交接單 ⇒ null', async () => {
    intake.add(handoffIntake('h1'))
    const sessionId = await createFor('h1')
    assert.equal(readBriefFor(sessions, sessionId)?.body, BODY)
    assert.equal(readBriefFor(sessions, 'd0d0d0d0-0000-4000-8000-000000000000'), null)
    assert.equal(readBriefFor(sessions, { id: sessionId }), null)
    const plain = await createSession({
      sessions,
      folderId: 'f2',
      target: 'claude',
      railLabel: 'beta',
      ticket: undefined,
      spawn: async (id) => ({ sessionId: id }),
    })
    assert.equal(readBriefFor(sessions, plain.sessionId), null)
  })

  it('session 清單（restore 的來源）不含本文', async () => {
    intake.add(handoffIntake('h1'))
    const sessionId = await createFor('h1')
    sessions.replace([{ id: sessionId, folderId: 'f2', spawnTarget: 'claude', ordinal: 1 }])
    assert.ok(!JSON.stringify(sessions.list()).includes('HANDOFF-BODY-HEAD'))
    assert.ok(!fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8').includes('HANDOFF-BODY-HEAD'))
  })
})

describe('完成狀態是主行程擁有的欄位（handoff-completion）', () => {
  it('renderer 的持久化覆寫不了它，且跨 load 保留', async () => {
    intake.add(handoffIntake('h1'))
    const sessionId = await createFor('h1')
    assert.equal(sessions.setCompletion(sessionId, { reportedAt: 5, settled: true }), true, '暫定紀錄也寫得進去')
    // renderer 送來的清單即使帶著一個假的 completion，也不會被採用（型別上它根本不在 RendererSession 裡）。
    sessions.replace([
      { id: sessionId, folderId: 'f2', spawnTarget: 'claude', ordinal: 1, completion: { reportedAt: 9, settled: false } } as never,
    ])
    assert.deepEqual(sessions.list()[0]?.completion, { reportedAt: 5, settled: true })

    const reloaded = new SessionStore(path.join(dir, 'sessions.json'), path.join(dir, 'sessions'))
    reloaded.load()
    assert.deepEqual(reloaded.list()[0]?.completion, { reportedAt: 5, settled: true })
  })

  it('損毀的完成狀態被丟棄，session 仍在', async () => {
    intake.add(handoffIntake('h1'))
    const sessionId = await createFor('h1')
    sessions.replace([{ id: sessionId, folderId: 'f2', spawnTarget: 'claude', ordinal: 1 }])
    const file = path.join(dir, 'sessions.json')
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    data.sessions[0].completion = { reportedAt: 'soon', settled: 'yes' }
    fs.writeFileSync(file, JSON.stringify(data))
    const reloaded = new SessionStore(file, path.join(dir, 'sessions'))
    reloaded.load()
    assert.equal(reloaded.list().length, 1)
    assert.equal(reloaded.list()[0]?.completion, undefined)
  })

  it('寫入完成狀態會發出變更通知（關係檔與畫面據此更新）', async () => {
    intake.add(handoffIntake('h1'))
    const sessionId = await createFor('h1')
    let emitted = 0
    sessions.subscribe(() => emitted++)
    sessions.setCompletion(sessionId, { reportedAt: 5, settled: false })
    assert.ok(emitted > 0)
  })
})
