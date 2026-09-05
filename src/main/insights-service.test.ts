import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { ScanRunner, type WorkerHandle } from './insights-service'
import { handleWorkerMessage } from './insights-worker'
import { writeTranscriptFixture } from './transcript-fixture.testkit'
import { delegateDirSuffix } from './insights-source'

const DELEGATE_SUFFIX = delegateDirSuffix()

const roots: string[] = []
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/** 假的掃描行程：可以指定它怎麼回應，以及要不要提早結束。 */
function fakeWorker(behaviour: (self: Fake) => void): { handle: WorkerHandle; killed: () => number } {
  let killCount = 0
  const listeners = { message: [] as ((m: unknown) => void)[], exit: [] as ((c: number) => void)[] }
  const self: Fake = {
    emit: (m) => { for (const l of listeners.message) l(m) },
    exit: (c = 1) => { for (const l of listeners.exit) l(c) },
    received: [],
  }
  const handle: WorkerHandle = {
    postMessage: (m) => { self.received.push(m) },
    on: ((event: string, cb: (arg: never) => void) => {
      if (event === 'message') listeners.message.push(cb as (m: unknown) => void)
      else listeners.exit.push(cb as (c: number) => void)
      // 監聽掛好之後才讓它動 —— 真的行程也是先有 listener 才收得到 'ready'。
      if (event === 'exit') queueMicrotask(() => behaviour(self))
    }) as WorkerHandle['on'],
    kill: () => { killCount += 1 },
  }
  return { handle, killed: () => killCount }
}

interface Fake {
  emit: (message: unknown) => void
  exit: (code?: number) => void
  received: unknown[]
}

const REQ = { projectsDir: '/nowhere/projects', archiveRoot: '/nowhere/archive', excludeDirSuffix: DELEGATE_SUFFIX }

describe('掃描行程的生命週期', () => {
  it('5.1 收到 ready 後才送出掃描請求，並回報結果', async () => {
    const result = { status: 'ok', scanned: 1, skipped: 0, unreadable: 0, orphaned: 0, rows: 3, stats: { userTextBlocks: 1, nonUserInput: 0, malformed: 0 } } as const
    let fake: Fake | undefined
    const w = fakeWorker((self) => {
      fake = self
      self.emit({ type: 'ready' })
      self.emit({ type: 'done', result })
    })
    const runner = new ScanRunner({ spawn: () => w.handle })
    const outcome = await runner.run(REQ)
    assert.deepEqual(outcome, { ok: true, result, started: true })
    assert.deepEqual(fake?.received, [{ type: 'scan', request: REQ }])
    assert.equal(runner.status().phase, 'idle')
    assert.equal(w.killed(), 1, '結束後要收屍')
  })

  it('5.2 掃描行程只回傳錯誤碼，不回傳自然語言', () => {
    const bad = handleWorkerMessage({ type: 'scan', request: { projectsDir: 1 } })
    assert.deepEqual(bad, { type: 'error', code: 'scanFailed' })
    // 錯誤物件裡不得有可讀的句子 —— 文案在主行程或 renderer 依字典組。
    assert.deepEqual(Object.keys(bad ?? {}).sort(), ['code', 'type'])
    assert.equal(handleWorkerMessage({ type: 'unknown' }), null)
    assert.equal(handleWorkerMessage(null), null)
  })

  it('5.2 掃描本身失敗時回傳錯誤碼，且不外洩路徑', () => {
    // 來源不存在不是失敗（那是一種狀態）；這裡讓 archiveRoot 指向一個檔案，使寫入必定拋錯。
    const root = mkdtempSync(path.join(tmpdir(), 'spekterm-worker-'))
    roots.push(root)
    const facts = writeTranscriptFixture(path.join(root, 'source'))
    const archiveRoot = path.join(facts.projectsDir, facts.projects[0].dirName, 'session-1.jsonl')
    const out = handleWorkerMessage({ type: 'scan', request: { projectsDir: facts.projectsDir, archiveRoot, excludeDirSuffix: DELEGATE_SUFFIX } })
    assert.ok(out)
    assert.equal(out.type, 'error')
    assert.ok(!JSON.stringify(out).includes(root), '錯誤不得含絕對路徑')
  })

  it('5.3 重複觸發回報「進行中」而非排隊', async () => {
    let spawns = 0
    const pending: Fake[] = []
    const runner = new ScanRunner({
      spawn: () => {
        spawns += 1
        return fakeWorker((self) => { pending.push(self) }).handle
      },
      // **每一趟都注入逾時計時器。** 少了它，一個「什麼都不回」的 fake worker 會靠真實的
      // 五分鐘預設逾時才 resolve —— 測試照樣是綠的，只是整支跑五分鐘。實測踩過。
      setTimer: () => 1,
      clearTimer: () => {},
    })
    const first = runner.run(REQ)
    await Promise.resolve()
    const second = await runner.run(REQ)
    assert.deepEqual(second, { ok: true, result: null, started: false })
    assert.equal(spawns, 1, '第二次不得再起一個行程')
    assert.equal(runner.status().phase, 'running')

    const done = { status: 'ok', scanned: 0, skipped: 0, unreadable: 0, orphaned: 0, rows: 0, stats: { userTextBlocks: 0, nonUserInput: 0, malformed: 0 } } as const
    pending[0].emit({ type: 'ready' })
    pending[0].emit({ type: 'done', result: done })
    assert.equal((await first).ok, true)

    // 前一趟結束之後才允許下一趟。
    const thirdPromise = runner.run(REQ)
    await Promise.resolve()
    assert.equal(spawns, 2)
    pending[1].emit({ type: 'ready' })
    pending[1].emit({ type: 'done', result: done })
    assert.equal((await thirdPromise).started, true)
  })

  it('5.3 卡住時逾時，狀態是失敗而不是永遠進行中', async () => {
    let fire: (() => void) | undefined
    const runner = new ScanRunner({
      spawn: () => fakeWorker((self) => { self.emit({ type: 'ready' }) }).handle,
      setTimer: (fn) => { fire = fn; return 1 },
      clearTimer: () => {},
    })
    const p = runner.run(REQ)
    await Promise.resolve()
    assert.equal(runner.status().phase, 'running')
    fire?.()
    const outcome = await p
    assert.deepEqual(outcome, { ok: false, code: 'scanTimeout', started: true })
    assert.equal(runner.status().phase, 'failed', '不得永遠停在進行中')
    assert.equal(runner.status().error, 'scanTimeout')
  })

  it('5.3 行程在回報之前結束：主行程不受影響，狀態是失敗', async () => {
    const runner = new ScanRunner({ spawn: () => fakeWorker((self) => { self.exit(1) }).handle })
    const outcome = await runner.run(REQ)
    assert.deepEqual(outcome, { ok: false, code: 'workerExited', started: true })
    assert.equal(runner.status().phase, 'failed')
  })

  it('5.3 spawn 本身失敗也不拋到呼叫端', async () => {
    const runner = new ScanRunner({ spawn: () => { throw new Error('no process') } })
    const outcome = await runner.run(REQ)
    assert.deepEqual(outcome, { ok: false, code: 'workerExited', started: true })
    assert.equal(runner.status().phase, 'failed')
  })

  it('失敗之後仍可再跑，成功的結果會被記住', async () => {
    let mode: 'fail' | 'ok' = 'fail'
    const result = { status: 'ok', scanned: 2, skipped: 0, unreadable: 0, orphaned: 0, rows: 5, stats: { userTextBlocks: 2, nonUserInput: 1, malformed: 0 } } as const
    const runner = new ScanRunner({
      spawn: () => fakeWorker((self) => {
        if (mode === 'fail') self.exit(1)
        else { self.emit({ type: 'ready' }); self.emit({ type: 'done', result }) }
      }).handle,
    })
    assert.equal((await runner.run(REQ)).ok, false)
    assert.equal(runner.status().last, null)
    mode = 'ok'
    assert.equal((await runner.run(REQ)).ok, true)
    assert.equal(runner.status().phase, 'idle')
    assert.deepEqual(runner.status().last, result)
    assert.equal(runner.status().error, null)
  })

  it('2.5 少了排除值即拒絕 —— 不得讓 undefined 靜默穿過去', () => {
    // **這一行漏掉的後果是靜默的**：`undefined` 進去，排除整個失效，
    // 而掃描照樣回一個看起來完全正常的結果，然後委派的偽訊息被當成使用者輸入永久寫進存檔。
    const missing = handleWorkerMessage({ type: 'scan', request: { projectsDir: '/a', archiveRoot: '/b' } })
    assert.deepEqual(missing, { type: 'error', code: 'scanFailed' })
    const empty = handleWorkerMessage({ type: 'scan', request: { projectsDir: '/a', archiveRoot: '/b', excludeDirSuffix: '' } })
    assert.deepEqual(empty, { type: 'error', code: 'scanFailed' }, '空字串會匹配每一個目錄名，比漏掉更糟')
    const wrongType = handleWorkerMessage({ type: 'scan', request: { projectsDir: '/a', archiveRoot: '/b', excludeDirSuffix: 3 } })
    assert.deepEqual(wrongType, { type: 'error', code: 'scanFailed' })
  })

  it('掃描行程走真實的存檔路徑：訊息進、結果出', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'spekterm-worker-ok-'))
    roots.push(root)
    const facts = writeTranscriptFixture(path.join(root, 'source'))
    const out = handleWorkerMessage({
      type: 'scan',
      request: { projectsDir: facts.projectsDir, archiveRoot: path.join(root, 'archive'), excludeDirSuffix: DELEGATE_SUFFIX },
    })
    assert.ok(out && out.type === 'done')
    assert.equal(out.result.status, 'ok')
    assert.equal(out.result.scanned, 4)
  })
})
