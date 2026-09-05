import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { handleWorkerMessage } from './insights-worker'
import type { WorkerHandle } from './insights-service'
import { writeTranscriptFixture, type TranscriptFixtureFacts } from './transcript-fixture.testkit'
import { createInsightsService } from './insights'

const roots: string[] = []
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/** 在同一個行程裡跑掃描邏輯的假 worker —— 與真的 utilityProcess 走同一支 handleWorkerMessage。 */
function inlineWorker(): WorkerHandle {
  const listeners: { message: ((m: unknown) => void)[]; exit: ((c: number) => void)[] } = { message: [], exit: [] }
  return {
    postMessage: (message) => {
      const reply = handleWorkerMessage(message)
      if (reply) for (const l of listeners.message) l(reply)
    },
    on: ((event: string, cb: (arg: never) => void) => {
      if (event === 'message') listeners.message.push(cb as (m: unknown) => void)
      else {
        listeners.exit.push(cb as (c: number) => void)
        queueMicrotask(() => { for (const l of listeners.message) l({ type: 'ready' }) })
      }
    }) as WorkerHandle['on'],
    kill: () => {},
  }
}

function bed(): { facts: TranscriptFixtureFacts; service: ReturnType<typeof createInsightsService>; root: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'spekterm-insights-ipc-'))
  roots.push(root)
  const facts = writeTranscriptFixture(path.join(root, 'source'))
  const service = createInsightsService({
    projectsDir: () => facts.projectsDir,
    archiveRoot: () => path.join(root, 'archive'),
    spawn: inlineWorker,
  })
  return { facts, service, root }
}

describe('對話計量的 IPC', () => {
  it('7.1 掃描後拿得到彙總，且掃描前是空的', async () => {
    const b = bed()
    const before = b.service.snapshot()
    assert.equal(before.insights, null)
    assert.equal(before.sourceAvailable, null, '還沒掃過時「來源可不可用」是未知，不是 false')

    const after = await b.service.refresh()
    assert.equal(after.phase, 'idle')
    assert.equal(after.sourceAvailable, true)
    assert.ok(after.insights)
    assert.equal(after.insights.totals.messages, b.facts.userMessages)
  })

  it('7.2 送往 renderer 的任何內容都不含絕對路徑', async () => {
    const b = bed()
    const snapshot = await b.service.refresh()
    const dump = JSON.stringify(snapshot)
    assert.ok(!dump.includes(b.root), '不得含 fixture 的根路徑')
    assert.ok(!dump.includes('/fixture/'), '不得含來源的 cwd')
    assert.ok(!dump.includes(b.facts.projects[0].dirName), '來源目錄名本身就是一個換過字元的絕對路徑')
    for (const p of snapshot.insights?.projects ?? []) {
      assert.match(p.id, /^[0-9a-f]{8}$/)
    }
  })

  it('7.2 不含訊息內文的完整清單', async () => {
    const b = bed()
    const snapshot = await b.service.refresh()
    const dump = JSON.stringify(snapshot)
    // fixture 裡那則極長訊息（8001 字元）不得出現。
    assert.ok(!dump.includes('長'.repeat(50)), '長訊息的原文不得送出')
    // 只出現一次的短訊息也不得出現在「最常說的那幾句」。
    assert.ok(!(snapshot.insights?.phrases ?? []).some((p) => p.n < 3))
    // 出現的原文只可能來自兩個受限的位置，且各自守著上限。
    for (const phrase of snapshot.insights?.phrases ?? []) assert.ok(phrase.name.length <= 20)
    for (const category of snapshot.insights?.tone ?? []) {
      assert.ok(category.examples.length <= 9)
      for (const ex of category.examples) assert.ok(ex.length <= 46)
    }
  })

  it('7.2 錯誤是碼不是句子', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'spekterm-insights-err-'))
    roots.push(root)
    const facts = writeTranscriptFixture(path.join(root, 'source'))
    const service = createInsightsService({
      projectsDir: () => facts.projectsDir,
      // 指向一個檔案，使建立存檔目錄必定失敗。
      archiveRoot: () => path.join(facts.projectsDir, facts.projects[0].dirName, 'session-1.jsonl'),
      spawn: inlineWorker,
    })
    const snapshot = await service.refresh()
    assert.equal(snapshot.phase, 'failed')
    assert.equal(snapshot.error, 'scanFailed')
    assert.ok(!JSON.stringify(snapshot).includes(root))
  })

  it('7.1 來源不可用與「來源可用但沒有資料」是可區分的', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'spekterm-insights-none-'))
    roots.push(root)
    const missing = createInsightsService({
      projectsDir: () => path.join(root, 'nope', 'projects'),
      archiveRoot: () => path.join(root, 'archive'),
      spawn: inlineWorker,
    })
    const a = await missing.refresh()
    assert.equal(a.sourceAvailable, false)
    assert.equal(a.insights, null)

    const emptyRoot = mkdtempSync(path.join(tmpdir(), 'spekterm-insights-empty-'))
    roots.push(emptyRoot)
    const projectsDir = path.join(emptyRoot, 'projects')
    mkdirSync(projectsDir, { recursive: true })
    const empty = createInsightsService({
      projectsDir: () => projectsDir,
      archiveRoot: () => path.join(emptyRoot, 'archive'),
      spawn: inlineWorker,
    })
    const c = await empty.refresh()
    assert.equal(c.sourceAvailable, true, '空目錄是「可用但沒資料」，不是「不可用」')
    assert.equal(c.insights, null)
  })

  it('7.1 來源消失之後，彙總仍讀得到存檔', async () => {
    const b = bed()
    await b.service.refresh()
    rmSync(b.facts.projectsDir, { recursive: true })
    const after = await b.service.refresh()
    assert.equal(after.sourceAvailable, false)
    assert.ok(after.insights, '來源沒了，但存檔還在')
    assert.equal(after.insights.totals.messages, b.facts.userMessages)
  })
})
