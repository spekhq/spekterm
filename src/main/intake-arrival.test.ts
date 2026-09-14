import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { IntakeService, type DeliverOutcome } from './intake-service'
import { IntakeStore, type IntakeRecord } from './intake-store'

/**
 * 到達的通道 —— **成功路徑獨有**。
 *
 * 這一整支測試的存在理由是一個具體的陷阱：`DeliverOutcome.notify` 讀起來像是「要不要通知
 * 使用者」，實際上是「這則**拒絕**要不要讓使用者看到」，於是它在**成功**路徑上恆為 `false`、
 * 在**四條拒絕**路徑上為 `true`。把通知接到它身上，方向會整個反過來，而型別、既有測試與
 * 畫面全都不會有任何反應。
 *
 * 因此這裡逐一列出 `deliver()` 的**每一條**非成功返回路徑 —— 從原始碼數出來的，不是憑印象。
 */

const bases: string[] = []
after(() => {
  for (const base of bases) fs.rmSync(base, { recursive: true, force: true })
})

interface Harness {
  service: IntakeService
  store: IntakeStore
  arrivals: IntakeRecord[]
}

function harness(maxPending?: number): Harness {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-arrival-'))
  bases.push(base)
  const archive = path.join(base, 'intake')
  fs.mkdirSync(archive, { recursive: true })
  const store = new IntakeStore(path.join(base, 'intake.json'))
  const service = new IntakeService({ store, archiveRoot: archive, maxPending })
  const arrivals: IntakeRecord[] = []
  service.onArrival((record) => arrivals.push(record))
  return { service, store, arrivals }
}

function payload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'a1',
    origin: { kind: 'slack', id: 'C1', label: '#dev' },
    title: 'title',
    body: 'body text',
    ...overrides,
  })
}

describe('到達只在成功新增紀錄時發出', () => {
  it('成功的投遞發出恰好一次，且帶著那一筆紀錄', async () => {
    const h = harness()
    const outcome = await h.service.deliver(payload(), 'file')
    assert.equal(outcome.ok, true)
    assert.equal(h.arrivals.length, 1)
    assert.equal(h.arrivals[0].id, 'a1')
  })

  // 以下六條是 `deliver()` 的全部非成功返回路徑。**逐一列出而不是抽樣**：
  // 接到 `DeliverOutcome.notify` 的話，其中四條（欄位驗證失敗、識別碼不合法、
  // 內容不同的重複、容量上限）會變成「有到達」，而另外兩條不會 —— 一個抽樣的測試
  // 很可能剛好只抽到後兩條。

  it('**解析失敗（MALFORMED）不發出到達**', async () => {
    const h = harness()
    const outcome = await h.service.deliver('{ 這不是 JSON', 'file')
    assert.equal(outcome.code, 'MALFORMED')
    assert.equal(h.arrivals.length, 0)
  })

  it('**欄位驗證失敗不發出到達**', async () => {
    // **不要用「非字串的 title」當觸發** —— 它是 optional 欄位，白名單解析只是把它丟掉，
    // 投遞照樣成功。要讓 `parseIntake` 真的拒絕，得動必要欄位或長度上限。
    const h = harness()
    const outcome = await h.service.deliver(payload({ origin: 'not-an-object' }), 'file')
    assert.equal(outcome.ok, false)
    assert.equal(outcome.code, 'FIELD_TYPE')
    assert.equal(h.arrivals.length, 0)
  })

  it('**識別碼不合法（INVALID_ID）不發出到達**', async () => {
    const h = harness()
    const outcome = await h.service.deliver(payload({ id: '..' }), 'file')
    assert.equal(outcome.code, 'INVALID_ID')
    assert.equal(h.arrivals.length, 0)
  })

  it('**內容相同的重複不發出到達**', async () => {
    const h = harness()
    await h.service.deliver(payload(), 'file')
    assert.equal(h.arrivals.length, 1)
    const again = await h.service.deliver(payload(), 'file')
    assert.equal(again.code, 'DUPLICATE')
    assert.equal(h.arrivals.length, 1, '第二次不得再發出')
  })

  it('**內容不同的重複（識別碼搶佔）不發出到達**', async () => {
    const h = harness()
    await h.service.deliver(payload(), 'file')
    const seized = await h.service.deliver(payload({ title: '別的內容' }), 'file')
    assert.equal(seized.code, 'DUPLICATE')
    assert.equal(seized.notify, true, '前置：它是一則「可見的拒絕」')
    assert.equal(h.arrivals.length, 1, '但它不是一次到達')
  })

  it('**達到容量上限（CAPACITY）不發出到達**', async () => {
    const h = harness(1)
    await h.service.deliver(payload({ id: 'first' }), 'file')
    assert.equal(h.arrivals.length, 1)
    const full: DeliverOutcome = await h.service.deliver(payload({ id: 'second' }), 'file')
    assert.equal(full.code, 'CAPACITY')
    assert.equal(full.notify, true, '前置：它也是一則「可見的拒絕」')
    assert.equal(h.arrivals.length, 1)
  })
})

describe('到達與「有東西變了」是兩個不同的事件', () => {
  it('**拒絕會讓收件匣更新，但不是一次到達**', async () => {
    // 這條釘住的是「不要沿用 `subscribe()`」：那個通道對拒絕與到達一視同仁，
    // 而收件匣正需要它對兩者都觸發（拒絕要呈現在彙整裡）。
    const h = harness()
    let changes = 0
    h.service.subscribe(() => { changes += 1 })

    await h.service.deliver(payload({ id: '..' }), 'file')
    assert.ok(changes > 0, '拒絕必須讓收件匣更新')
    assert.equal(h.arrivals.length, 0, '但它不是一次到達')
  })
})

describe('既有的落盤狀態不構成到達', () => {
  it('**以已有待處理項目的狀態檔建構，不發出任何到達**', async () => {
    // D11：通知綁在「到達」而不是「存在待處理項目」。把觸發改寫成後者，這一條會變紅 ——
    // 而那個改寫在程式碼上更短，看起來像簡化。
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-arrival-seed-'))
    bases.push(base)
    const archive = path.join(base, 'intake')
    fs.mkdirSync(archive, { recursive: true })
    const file = path.join(base, 'intake.json')

    const seed = new IntakeStore(file)
    const seedService = new IntakeService({ store: seed, archiveRoot: archive })
    await seedService.deliver(payload({ id: 'p1' }), 'file')
    await seedService.deliver(payload({ id: 'p2' }), 'file')
    assert.equal(seed.pendingCount(), 2, '前置：狀態檔裡真的有兩則待處理項目')

    const reopened = new IntakeStore(file)
    reopened.load()
    const service = new IntakeService({ store: reopened, archiveRoot: archive })
    const arrivals: IntakeRecord[] = []
    service.onArrival((record) => arrivals.push(record))
    assert.equal(reopened.pendingCount(), 2, '前置：重開之後那兩則還在')

    // **等一拍再斷言。** 一個「開機時把待處理的也通知一遍」的實作大可以排在微任務或計時器裡，
    // 而建構之後立刻斷言對那種寫法完全沒有鑑別力 —— 這是對照組抓到的（`arrival-from-state`
    // 第一次跑的時候沒有變紅）。
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(arrivals.length, 0)
  })
})

describe('併發的同一份投遞只算一次到達', () => {
  it('**兩次 deliver 同時進行時，到達恰發出一次**', async () => {
    // 檔案 adapter 的「先監看、再掃描」是刻意的雙重讀取 —— 兩次 `deliver()` 可以都通過
    // 重複檢查（它與記錄之間隔著一個 await）。store 以主鍵覆寫所以只有一筆，但到達會發兩次，
    // 而那是使用者看得到的：計數說 N、合併的通知說 N+1。這是探針抓到的。
    const h = harness()
    await Promise.all([h.service.deliver(payload(), 'file'), h.service.deliver(payload(), 'file')])
    assert.equal(h.store.pendingCount(), 1, '前置：收件匣裡只有一筆')
    assert.equal(h.arrivals.length, 1)
  })
})

describe('併發的識別碼搶佔也只算一次到達', () => {
  it('**同時投遞同識別碼、不同內容時，到達恰發出一次**', async () => {
    // 只擋同內容是不夠的：後到的那一份會覆寫紀錄並再發一次到達，
    // 於是計數說 N、通知說 N+1。
    const h = harness()
    await Promise.all([
      h.service.deliver(payload(), 'file'),
      h.service.deliver(payload({ title: '別的內容' }), 'file'),
    ])
    assert.equal(h.store.pendingCount(), 1, '前置：收件匣裡只有一筆')
    assert.equal(h.arrivals.length, 1)
  })
})
