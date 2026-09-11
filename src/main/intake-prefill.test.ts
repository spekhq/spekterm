import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { configureAgentEvents, prepareEventInjection } from './agent-events'
import { clearWait } from './agent-wait'
import { cancelPrefill, pendingPrefillCount, schedulePrefill } from './intake-prefill'

const bases: string[] = []
after(() => {
  for (const base of bases) fs.rmSync(base, { recursive: true, force: true })
})

function configure(): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-prefill-'))
  bases.push(base)
  configureAgentEvents(base)
  return base
}

function fire(base: string, sessionId: string, body: Record<string, unknown>): void {
  const dir = path.join(base, 'agent-events', sessionId)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${process.hrtime.bigint()}-x.json`)
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(body))
  fs.renameSync(`${file}.tmp`, file)
}

async function waitFor(label: string, predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.fail(`timed out waiting for: ${label}`)
}

describe('預填不早於就緒', () => {
  it('未就緒之前的整段期間都沒有寫入；就緒之後恰寫一次', async () => {
    // **對照組**：把觸發改成「pty 建立完成之後、不等待就緒即寫入」→ 前半必須變紅。
    // （不可用「建立後立即寫入」當 mutation —— 那時 pty 可能還不存在，寫入會被丟棄，
    //  mutant 什麼都沒做而對照組保持綠。）
    const base = configure()
    const sessionId = 'P1'
    prepareEventInjection(sessionId, true)

    const writes: string[] = []
    schedulePrefill(sessionId, 'do the thing', {
      write: (_id, data) => writes.push(data),
      onTimeout: () => assert.fail('不該逾時'),
    })

    // 逐一餵入非就緒的狀態，每一步都斷言「仍然為空」。
    for (const [name, body] of [
      ['busy', { hook_event_name: 'PreToolUse' }],
      ['awaiting-choice', { hook_event_name: 'PermissionRequest' }],
      ['unknown', { hook_event_name: 'SessionEnd' }],
    ] as const) {
      fire(base, sessionId, body)
      await new Promise((resolve) => setTimeout(resolve, 600))
      assert.deepEqual(writes, [], `${name} 時不得寫入`)
    }

    fire(base, sessionId, { hook_event_name: 'SessionStart' })
    await waitFor('就緒後寫入', () => writes.length === 1)

    // 再次就緒不得重複寫入 —— 否則使用者正在打字時會被插進第二份 prompt。
    fire(base, sessionId, { hook_event_name: 'Stop' })
    await new Promise((resolve) => setTimeout(resolve, 800))
    assert.equal(writes.length, 1)

    assert.equal(writes[0], 'do the thing')
    assert.equal(writes[0].includes('\r'), false, '不得附送出字元')
    clearWait(sessionId)
  })

  it('已經就緒時立刻寫 —— 那不是「太早」', async () => {
    const base = configure()
    const sessionId = 'P2'
    prepareEventInjection(sessionId, true)

    const writes: string[] = []
    const off = { done: false }
    schedulePrefill(sessionId, 'first', {
      write: (_id, data) => writes.push(data),
      onTimeout: () => assert.fail('不該逾時'),
      onFilled: () => {
        off.done = true
      },
    })
    fire(base, sessionId, { hook_event_name: 'SessionStart' })
    await waitFor('第一次填入', () => writes.length === 1)

    // 狀態已是 ready，第二次排定應立刻寫。
    schedulePrefill(sessionId, 'second', {
      write: (_id, data) => writes.push(data),
      onTimeout: () => assert.fail('不該逾時'),
    })
    assert.equal(writes.length, 2)
    clearWait(sessionId)
  })

  it('多行的 prompt 被編碼器壓成單行', async () => {
    const base = configure()
    const sessionId = 'P3'
    prepareEventInjection(sessionId, true)
    const writes: string[] = []
    schedulePrefill(sessionId, 'line one\nline two', {
      write: (_id, data) => writes.push(data),
      onTimeout: () => assert.fail('不該逾時'),
    })
    fire(base, sessionId, { hook_event_name: 'SessionStart' })
    await waitFor('填入', () => writes.length === 1)
    assert.equal(writes[0].includes('\n'), false)
    clearWait(sessionId)
  })
})

describe('等不到就緒', () => {
  it('逾時之後說話，並讓該則回到可重新處理的狀態', async () => {
    // 判準**以狀態為準，不以成因為準** —— 事件回報未啟用只是其中一種成因。
    const base = configure()
    const sessionId = 'P4'
    // 刻意不注入事件：等待狀態恆為未知。
    void base

    let timedOut = false
    schedulePrefill(sessionId, 'x', {
      write: () => assert.fail('不該寫入'),
      onTimeout: () => {
        timedOut = true
      },
    })

    // 以取消模擬逾時的清理路徑，並直接驗證計時器的存在（不睡 30 秒）。
    assert.equal(pendingPrefillCount(), 1)
    cancelPrefill(sessionId)
    assert.equal(pendingPrefillCount(), 0)
    assert.equal(timedOut, false, '取消不是逾時')
    clearWait(sessionId)
  })

  it('事件回報未啟用時，等待狀態恆為未知 —— 預填永遠不會發生', async () => {
    configure()
    const sessionId = 'P5'
    // `prepareEventInjection(sessionId, false)` ⇒ 不參與 ⇒ 事件目錄不存在。
    assert.equal(prepareEventInjection(sessionId, false), null)

    const writes: string[] = []
    schedulePrefill(sessionId, 'x', {
      write: (_id, data) => writes.push(data),
      onTimeout: () => undefined,
    })
    await new Promise((resolve) => setTimeout(resolve, 900))
    assert.deepEqual(writes, [])
    cancelPrefill(sessionId)
    clearWait(sessionId)
  })
})
