import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { IntakeService } from './intake-service'
import { IntakeSource, MAX_DELIVERY_BYTES } from './intake-source'
import { IntakeStore } from './intake-store'

const bases: string[] = []
const sources: IntakeSource[] = []

interface Harness {
  inbox: string
  service: IntakeService
  store: IntakeStore
}

function harness(maxPending?: number): Harness {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-source-'))
  bases.push(base)
  const inbox = path.join(base, 'inbox')
  const archive = path.join(base, 'intake')
  fs.mkdirSync(archive, { recursive: true })
  const store = new IntakeStore(path.join(base, 'intake.json'))
  const service = new IntakeService({ store, archiveRoot: archive, maxPending })
  return { inbox, service, store }
}

async function startSource(h: Harness): Promise<IntakeSource> {
  const source = new IntakeSource({ root: h.inbox, adapter: 'file', service: h.service })
  sources.push(source)
  await source.start()
  return source
}

function payload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'a1',
    origin: { kind: 'slack', id: 'C1', label: '#dev' },
    title: 'title',
    body: 'body',
    actor: 'actor',
    raw: { note: 'source specific' },
    ...overrides,
  })
}

function drop(inbox: string, name: string, contents: string): string {
  fs.mkdirSync(inbox, { recursive: true })
  const target = path.join(inbox, name)
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, contents)
  fs.renameSync(tmp, target)
  return target
}

/** 等待一個條件成立。**不是固定睡眠** —— 逾時即失敗並說出觀察到的值。 */
async function waitFor(label: string, predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.fail(`timed out waiting for: ${label}`)
}

after(async () => {
  for (const source of sources) await source.dispose()
  for (const base of bases) fs.rmSync(base, { recursive: true, force: true })
})

describe('兩個入口：先建立監看、再掃描', () => {
  it('落點中先有檔案才啟動時，該 intake 進得來', async () => {
    // **對照組**：移除 `start()` 裡的 `scan()` → 這條必須變紅。
    // `createWatcher` 的 `ignoreInitial: true` 是寫死且不可覆寫的，
    // 於是「app 關著時投遞」的東西只有掃描看得到。
    const h = harness()
    drop(h.inbox, 'x.json', payload())
    await startSource(h)
    assert.equal(h.store.get('file', 'a1')?.state, 'pending')
  })

  it('啟動後才投遞的檔案由監看接手', async () => {
    const h = harness()
    await startSource(h)
    drop(h.inbox, 'y.json', payload({ id: 'b1' }))
    await waitFor('watcher 收到新增', () => h.store.get('file', 'b1') !== undefined)
  })

  it('兩條入口對畸形投遞的處置相同', async () => {
    // fixture **三種**，而第三種是關鍵：前兩種都走驗證分支，
    // **一個跳過去重的掃描器會全綠** —— 而那正是最可能發生的 bug。
    const cases: Array<[string, string]> = [
      ['非法識別碼', payload({ id: '..' })],
      ['超出大小上限', payload({ body: 'x'.repeat(MAX_DELIVERY_BYTES) })],
      ['已存在的識別碼', payload({ id: 'dup' })],
    ]

    for (const [name, contents] of cases) {
      // 啟動前已存在
      const before = harness()
      before.store.add({
        id: 'dup',
        verified: { adapter: 'file', originKind: 'slack', originId: 'C1' },
        authored: { title: 'x', body: 'x', actor: 'x', originLabel: 'x' },
        receivedAt: 0,
      })
      const beforeCount = before.store.list().length
      drop(before.inbox, 'a.json', contents)
      await startSource(before)

      // 啟動後才投遞
      const afterH = harness()
      afterH.store.add({
        id: 'dup',
        verified: { adapter: 'file', originKind: 'slack', originId: 'C1' },
        authored: { title: 'x', body: 'x', actor: 'x', originLabel: 'x' },
        receivedAt: 0,
      })
      await startSource(afterH)
      drop(afterH.inbox, 'a.json', contents)
      await waitFor(`${name} 被處理`, () => fs.readdirSync(afterH.inbox).length === 0)

      assert.equal(before.store.list().length, beforeCount, `${name}：啟動前`)
      assert.equal(afterH.store.list().length, beforeCount, `${name}：啟動後`)
    }
  })
})

describe('副檔名、大小、與解析失敗的處置', () => {
  it('只採納 .json，其他副檔名不被讀取', async () => {
    const h = harness()
    drop(h.inbox, 'x.txt', payload())
    drop(h.inbox, 'x.json.tmp', payload({ id: 'tmp1' }))
    await startSource(h)
    assert.equal(h.store.list().length, 0)
    assert.equal(fs.readdirSync(h.inbox).length, 2, '未採納的項目仍原封留著')
  })

  it('超出大小上限的投遞不被解析，且被消費掉', async () => {
    const h = harness()
    drop(h.inbox, 'big.json', 'x'.repeat(MAX_DELIVERY_BYTES + 10))
    await startSource(h)
    assert.equal(h.store.list().length, 0)
    assert.deepEqual(fs.readdirSync(h.inbox), [])
    assert.equal(h.service.notices()[0]?.code, 'TOO_LARGE')
  })

  it('寫到一半的同一份檔案：不被消費，補完之後被採納', async () => {
    // **同一份檔案的兩種處置** —— 不是兩個不同的 fixture。
    // 對照組：改成解析失敗即刪除或改名 → 「補完後出現」必須變紅。
    const h = harness()
    const full = payload({ id: 'half' })
    const target = drop(h.inbox, 'half.json', full.slice(0, Math.floor(full.length / 2)))
    await startSource(h)

    assert.equal(h.store.list().length, 0)
    assert.ok(fs.existsSync(target), '解析失敗的項目必須原封留在落點')

    fs.writeFileSync(target, full)
    await waitFor('補完後被採納', () => h.store.get('file', 'half') !== undefined)
  })

  it('解析失敗不阻斷其後的項目 —— 順序由呼叫建立', async () => {
    // **順序不可靠 readdir 或 watcher 的到達順序。** 砍掉隔離目錄之後，
    // 「原封不動」與「從來沒有被處理過」在磁碟上完全相同，排序反過來這條就什麼都沒測到。
    const h = harness()
    const bad = await h.service.deliver('{not json', 'file')
    assert.equal(bad.consume, false)
    const good = await h.service.deliver(payload({ id: 'after-bad' }), 'file')
    assert.equal(good.ok, true)
    assert.ok(h.store.get('file', 'after-bad'))
  })
})

describe('永久性與暫時性拒絕的去向', () => {
  it('永久性拒絕被消費，其後的啟動不再重複處理', async () => {
    const h = harness()
    drop(h.inbox, 'bad.json', payload({ id: '..' }))
    await startSource(h)
    assert.deepEqual(fs.readdirSync(h.inbox), [], '永久性拒絕必須被消費')
  })

  it('暫時性拒絕原封留在落點，並於上限解除後被重新處理', async () => {
    // 對照組：把暫時性也消費掉 → 「上限解除後進得來」必須變紅。
    const h = harness(1)
    const first = await h.service.deliver(payload({ id: 'first' }), 'file')
    assert.equal(first.ok, true)

    const source = await startSource(h)
    drop(h.inbox, 'second.json', payload({ id: 'second' }))
    await waitFor('capacity 拒絕已發生', () =>
      h.service.notices().some((n) => n.code === 'CAPACITY'),
    )
    assert.equal(fs.readdirSync(h.inbox).length, 1, '暫時性拒絕必須留在落點')

    h.store.setState('file', 'first', 'accepted')
    await source.scan()
    assert.ok(h.store.get('file', 'second'), '上限解除後必須進得來')
  })
})

describe('去重', () => {
  it('adapter 由接收端決定，payload 自稱的來源不被採信', async () => {
    const h = harness()
    await h.service.deliver(payload({ source: 'slack', adapter: 'slack' }), 'file')
    assert.ok(h.store.get('file', 'a1'))
    assert.equal(h.store.get('slack', 'a1'), undefined)
  })

  it('不同 adapter 的相同識別碼互不衝突', async () => {
    const h = harness()
    await h.service.deliver(payload(), 'file')
    await h.service.deliver(payload(), 'slack')
    assert.equal(h.store.list().length, 2)
  })

  it('內容相同的重複：靜默', async () => {
    // 對照組：改成一律呈現 → 這條必須變紅。
    const h = harness()
    const contents = payload()
    await h.service.deliver(contents, 'file')
    const again = await h.service.deliver(contents, 'file')
    assert.equal(again.ok, false)
    assert.equal(again.notify, false)
    assert.deepEqual(h.service.notices(), [])
    assert.equal(h.store.list().length, 1)
  })

  it('內容不同的重複：拒絕、可見、且既有那則不被取代', async () => {
    // 對照組：改成一律靜默 → 這條必須變紅。
    const h = harness()
    await h.service.deliver(payload({ body: 'first' }), 'file')
    const second = await h.service.deliver(payload({ body: 'second' }), 'file')
    assert.equal(second.notify, true)
    assert.equal(h.service.notices().some((n) => n.code === 'DUPLICATE'), true)
    assert.equal(h.store.get('file', 'a1')?.content?.authored.body, 'first')
  })

  it('已接受的識別碼仍參與去重', async () => {
    const h = harness()
    await h.service.deliver(payload(), 'file')
    h.store.setState('file', 'a1', 'accepted')
    await h.service.deliver(payload({ body: 'changed' }), 'file')
    assert.equal(h.store.list().length, 1)
  })

  it('內容過期之後去重仍然有效', async () => {
    const h = harness()
    await h.service.deliver(payload(), 'file')
    h.store.setState('file', 'a1', 'accepted')
    h.store.expireContent('file', 'a1')
    assert.equal(h.store.get('file', 'a1')?.content, null)

    const again = await h.service.deliver(payload(), 'file')
    assert.equal(again.ok, false)
    assert.equal(again.code, 'DUPLICATE')
  })
})

describe('拒絕與警示有界', () => {
  it('同一主鍵的重複拒絕合併為一則並累加次數', async () => {
    const h = harness()
    await h.service.deliver(payload({ body: 'first' }), 'file')
    for (let i = 0; i < 5; i += 1) {
      await h.service.deliver(payload({ body: `variant-${i}` }), 'file')
    }
    const duplicates = h.service.notices().filter((n) => n.code === 'DUPLICATE')
    assert.equal(duplicates.length, 1, '必須合併為一則')
    assert.equal(duplicates[0].count, 5)
  })

  it('警示總數有上限', async () => {
    const h = harness()
    for (let i = 0; i < 40; i += 1) {
      await h.service.deliver(JSON.stringify({ id: `x${i}`, origin: { kind: 'k', id: 'i' } }), 'file')
    }
    assert.ok(h.service.notices().length <= 21, `實際 ${h.service.notices().length}`)
  })
})

describe('投遞的處理不阻塞主行程', () => {
  it('啟動掃描分批，每批之間讓出 event loop', async () => {
    const h = harness()
    for (let i = 0; i < 45; i += 1) drop(h.inbox, `n${i}.json`, payload({ id: `n${i}` }))

    let ticks = 0
    const timer = setInterval(() => {
      ticks += 1
    }, 1)
    await startSource(h)
    clearInterval(timer)

    assert.equal(h.store.list().length, 45)
    assert.ok(ticks > 0, 'event loop 必須在掃描期間轉得動')
  })
})

describe('保存失敗不得靜默', () => {
  it('保存處不存在時：投遞檔留在落點，且不會變成未捕捉的 rejection', async () => {
    // **dogfood 第一次投遞就踩到這個。** 保存處的目錄從未被建立 ⇒ `resolveNewWithin` 丟
    // `NOT_FOUND` ⇒ `deliver()` reject ⇒ 而呼叫端沒有 catch，於是投遞檔留在落點、
    // 收件匣空著、log 裡什麼都沒有 —— **三個地方都看不出發生了什麼事**。
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-nosave-'))
    bases.push(base)
    const inbox = path.join(base, 'inbox')
    const store = new IntakeStore(path.join(base, 'intake.json'))
    // 刻意不建立 archiveRoot。
    const service = new IntakeService({ store, archiveRoot: path.join(base, 'missing') })

    const errors: string[] = []
    const original = console.error
    console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '))
    try {
      drop(inbox, 'x.json', payload())
      const source = new IntakeSource({ root: inbox, adapter: 'file', service })
      sources.push(source)
      await source.start()
    } finally {
      console.error = original
    }

    assert.equal(store.list().length, 0)
    assert.equal(fs.readdirSync(inbox).length, 1, '投遞檔必須留在落點')
    assert.ok(
      errors.some((line) => line.includes('[intake] delivery failed')),
      `失敗必須說話，實際的輸出：${JSON.stringify(errors)}`,
    )
  })
})
