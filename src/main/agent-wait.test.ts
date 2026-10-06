import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { configureAgentEvents, prepareEventInjection } from './agent-events'
import { activeWaitSessions, clearWait, lastTranscriptPathOf, subscribeWait, waitStateOf } from './agent-wait'

const bases: string[] = []
after(() => {
  for (const base of bases) fs.rmSync(base, { recursive: true, force: true })
})

function configure(): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-wait-'))
  bases.push(base)
  configureAgentEvents(base)
  return base
}

/** 寫一則事件到該 session 的落點 —— 模擬注入的 hook。 */
function fire(base: string, sessionId: string, body: Record<string, unknown>): void {
  const dir = path.join(base, 'agent-events', sessionId)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${process.hrtime.bigint()}-x.json`)
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(body))
  fs.renameSync(`${file}.tmp`, file)
}

async function waitFor(label: string, predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.fail(`timed out waiting for: ${label}`)
}

describe('單一 drainer', () => {
  it('兩個訂閱者同時存在時事件不遺失', async () => {
    // 事件是**讀完即刪**的串流。兩個消費者各自 drain 同一個目錄會互相偷事件 ——
    // 而那正是 `agent-event-bridge` 的「事件的寫入與讀取不得遺失事件」要擋的。
    const base = configure()
    const sessionId = 'S1'
    prepareEventInjection(sessionId, true)

    const seenA: string[] = []
    const seenB: string[] = []
    const offA = subscribeWait(sessionId, (s) => {
      if (s.count > 0) seenA.push(s.state)
    })
    const offB = subscribeWait(sessionId, (s) => {
      if (s.count > 0) seenB.push(s.state)
    })

    assert.equal(activeWaitSessions(), 1, '兩個訂閱者只能有一個計時器')

    fire(base, sessionId, { hook_event_name: 'SessionStart' })
    await waitFor('兩個訂閱者都收到', () => seenA.length > 0 && seenB.length > 0)
    assert.deepEqual(seenA, seenB)

    offA()
    offB()
    clearWait(sessionId)
  })

  it('訂閱者全部離開後，該 session 的等待狀態仍保留', async () => {
    const base = configure()
    const sessionId = 'S2'
    prepareEventInjection(sessionId, true)

    const off = subscribeWait(sessionId, () => undefined)
    fire(base, sessionId, { hook_event_name: 'SessionStart' })
    await waitFor('狀態成為 ready', () => waitStateOf(sessionId) === 'ready')

    off()
    assert.equal(activeWaitSessions(), 0, '沒有訂閱者時不該還在輪詢')
    // **狀態屬於 session，不屬於訂閱。** 切走再切回不該退回未知 ——
    // 而重建它所需的事件早已被讀走刪掉。
    assert.equal(waitStateOf(sessionId), 'ready')

    clearWait(sessionId)
    assert.equal(waitStateOf(sessionId), 'unknown')
  })

  it('沒有人在看的 session 也求得出等待狀態', async () => {
    // 這是整個解耦的理由：預填要等 `ready`，而它發生在使用者還沒打開對話 view 的時候。
    const base = configure()
    const sessionId = 'S3'
    prepareEventInjection(sessionId, true)

    const off = subscribeWait(sessionId, () => undefined)
    fire(base, sessionId, { hook_event_name: 'SessionStart' })
    await waitFor('無觀察者仍求得出', () => waitStateOf(sessionId) === 'ready')
    off()
    clearWait(sessionId)
  })
})

describe('the last reported transcript location (session-hibernation)', () => {
  it('is kept per session after the event that carried it was consumed, and cleared with the session', async () => {
    // Every running claude session is drained whether or not its conversation view is open; a
    // relocation consumed with no view open must still be found by a view opened later.
    const base = configure()
    const sessionId = 'T1'
    prepareEventInjection(sessionId, true)
    const off = subscribeWait(sessionId, () => undefined)
    fire(base, sessionId, { hook_event_name: 'SessionStart', transcript_path: '/x/relocated.jsonl' })
    await waitFor('relocation recorded', () => lastTranscriptPathOf(sessionId) === '/x/relocated.jsonl')
    off()
    assert.equal(lastTranscriptPathOf(sessionId), '/x/relocated.jsonl', 'kept after the subscription ended')
    clearWait(sessionId)
    assert.equal(lastTranscriptPathOf(sessionId), null)
  })
})
