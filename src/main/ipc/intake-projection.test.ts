import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { buildContext, buildPrompt, createNonce, writeContext } from '../intake-context'
import { parseIntake } from '../intake-schema'
import { listView, project } from '../intake-projection'
import type { RoutingConfig } from '../intake-routing'
import { IntakeService } from '../intake-service'
import { IntakeStore, type IntakeRecord } from '../intake-store'
import { configureAgentEvents, prepareEventInjection } from '../agent-events'
import { composeInjection } from '../agent-injection'

/**
 * 送往 renderer 的投影，與「交給 agent 的檔案不在 workspace 之內」。
 *
 * 這裡刻意不去啟動 Electron 的 `ipcMain` —— 要驗的是**投影的形狀**與**寫入的落點**，
 * 兩者都是純粹的資料性質。跨行程的那一半（畫面上的文字 vs 磁碟上的檔案）由 probe 承擔，
 * 而那是唯一看得見「呈現與交付分岔」的載體。
 */

const bases: string[] = []
after(() => {
  for (const base of bases) fs.rmSync(base, { recursive: true, force: true })
})

function temp(): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-projection-'))
  bases.push(base)
  return base
}

function ingested(overrides: Record<string, unknown> = {}) {
  const result = parseIntake(
    {
      id: 'a1',
      origin: { kind: 'slack', id: 'C1', label: '#dev' },
      title: 'title',
      body: 'body text',
      actor: 'actor',
      raw: { note: 'SOURCE-ONLY-MARKER' },
      ...overrides,
    },
    'file',
  )
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

describe('送往 renderer 的東西不含任何路徑', () => {
  it('收件匣的快照裡沒有絕對路徑', async () => {
    // **對照組**：故意把保存處或 context 檔的路徑放進投影 → 這條必須變紅。
    const base = temp()
    const archive = path.join(base, 'intake')
    fs.mkdirSync(archive, { recursive: true })
    const store = new IntakeStore(path.join(base, 'intake.json'))
    const service = new IntakeService({ store, archiveRoot: archive })

    await service.deliver(JSON.stringify({
      id: 'a1',
      origin: { kind: 'slack', id: 'C1', label: '#dev' },
      title: 'title',
      body: 'body text',
    }), 'file')

    // **量的是被出貨的那一份投影**（`intake-projection.ts`）。此前這裡是一份手抄的複本，
    // 註解寫著「與 project() 同源」—— 而它從未被 `npm test` 執行過。
    const projected = listView(store.list(), { rules: [], fallbackFolderId: 'f1' }, new Set(['f1']))
    assert.equal(projected.length, 1, '前置：確實投影出那一則')
    assert.ok(projected[0].body.includes('body text'), '前置：本文確實在投影裡（否則「不含路徑」恆真）')

    const serialized = JSON.stringify(projected)
    assert.equal(serialized.includes(base), false, '不得含 userData 之下的任何路徑')
    assert.equal(serialized.includes(path.sep + 'intake'), false)
    assert.equal(serialized.includes('SOURCE-ONLY-MARKER'), false, '原始內容不得出現在投影中')
  })
})

describe('交給 agent 的檔案不在使用者的工作目錄之內', () => {
  it('目標 folder 的遞迴快照（含隱藏項目）前後逐位元組相同', async () => {
    const base = temp()
    const folder = path.join(base, 'repo')
    fs.mkdirSync(path.join(folder, '.hidden'), { recursive: true })
    fs.writeFileSync(path.join(folder, 'README.md'), 'readme')
    fs.writeFileSync(path.join(folder, '.hidden', 'x'), 'hidden')

    const snapshot = (): string => {
      const walk = (dir: string): string[] =>
        fs
          .readdirSync(dir, { withFileTypes: true })
          .sort((a, b) => a.name.localeCompare(b.name))
          .flatMap((entry) => {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) return walk(full)
            return [`${path.relative(folder, full)}:${fs.readFileSync(full, 'utf8')}`]
          })
      return walk(folder).join('\n')
    }

    const before = snapshot()

    const contextRoot = path.join(base, 'intake')
    fs.mkdirSync(contextRoot, { recursive: true })
    const intake = ingested()
    const nonce = createNonce()
    const target = await writeContext(contextRoot, intake.id, buildContext(intake.authored.body, nonce))

    // **否定斷言旁邊綁一條正面的**：檔案確實被交付了，否則「folder 沒變」對一個
    // 什麼都沒做的實作也成立。
    assert.ok(fs.existsSync(target), 'context 檔必須確實產生')
    assert.ok(fs.readFileSync(target, 'utf8').includes('body text'))
    assert.ok(buildPrompt(target, nonce).includes(target), 'prompt 必須引用它')

    assert.equal(snapshot(), before, '目標 folder 一個位元組都不該變')
  })

  it('本文不出現在啟動 agent 的命令列上', () => {
    // 啟動路徑只吃對話識別碼與注入設定的位置；本文走檔案。
    const intake = ingested({ body: 'quotes " and \' and a newline\nhere' })
    const nonce = createNonce()
    const prompt = buildPrompt('/tmp/ctx.md', nonce)
    assert.equal(prompt.includes(intake.authored.body), false)
  })
})

describe('事件回報未啟用時，等待狀態求不出來', () => {
  it('偏好關閉 ⇒ 不注入 ⇒ 預填的閘永遠不會開', () => {
    // 這就是「接受之前先告知」那條 requirement 的成因。
    assert.equal(prepareEventInjection('S-off', false), null)
  })
})

describe('注入設定的頂層欄位', () => {
  it('注入設定的頂層欄位未因本能力而增加', () => {
    // **白名單形式，不是「不含 permissions」那種黑名單** —— 後者只擋得住列舉得出來的東西，
    // 而且今日恆真。這一條的價值在回歸線：往注入設定加任何頂層欄位都會紅。
    // 注入需要一個落點 —— 沒有它 `prepareEventInjection` 一律回 null（那是「不參與」，
    // 不是「沒有欄位」）。
    //
    // **量的是合成之後寫給 agent 的那一份設定，不是單一貢獻的片段。** hooks 自
    // `agent-initiated-handoff` 起改由貢獻的獨立欄位交給合成器、再由合成器組回
    // `settings.hooks` —— 此前這裡量的是貢獻的 `settings`，於是那次搬家之後它恆為空，
    // 而這個檔案當時不在 `npm test` 的 glob 裡，沒有人看到它紅。
    configureAgentEvents(temp())
    const contribution = prepareEventInjection('S-keys', true)
    assert.ok(contribution)
    const settingsFile = path.join(temp(), 'settings.json')
    assert.ok(composeInjection(settingsFile, [contribution]))
    const written = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, unknown>
    assert.deepEqual(Object.keys(written), ['hooks'])
  })
})

/** 以指定欄位造一筆落盤紀錄 —— 投影只讀紀錄，不經 store。 */
function record(
  overrides: Partial<IntakeRecord> & { receivedAt?: number; originId?: string; occurredAt?: number } = {},
): IntakeRecord {
  const { receivedAt = 1000, originId = 'C1', occurredAt, ...rest } = overrides
  const intake = ingested({ id: rest.id ?? 'a1', origin: { kind: 'slack', id: originId, label: '#dev' } })
  return {
    adapter: 'file',
    id: intake.id,
    state: 'pending',
    digest: 'd',
    content: {
      verified: intake.verified,
      authored: { ...intake.authored, ...(occurredAt !== undefined ? { occurredAt } : {}) },
      receivedAt,
    },
    ...rest,
  }
}

const ROUTE_TO_A: RoutingConfig = {
  rules: [{ id: 'r', criterion: 'originId', contains: 'C1', folderId: 'A' }],
  fallbackFolderId: null,
}

describe('投影：已接受者開在哪裡由 session 說了算（intake-inbox-usability）', () => {
  it('已接受者沒有 folderId —— 規則改指別處也一樣', () => {
    const accepted = record({ state: 'accepted', sessionId: 's1' })
    const known = new Set(['A', 'B'])
    assert.equal(project(accepted, ROUTE_TO_A, known).folderId, undefined)
    const rerouted: RoutingConfig = { ...ROUTE_TO_A, rules: [{ ...ROUTE_TO_A.rules[0], folderId: 'B' }] }
    assert.equal(project(accepted, rerouted, known).folderId, undefined)
    // 對照：同一筆紀錄在待處理時確實會求出 folder —— 否則上面兩條恆真。
    assert.equal(project({ ...accepted, state: 'pending' }, ROUTE_TO_A, known).folderId, 'A')
  })

  it('解析不出時不帶 folderId（NO_MATCH 與 FOLDER_GONE）', () => {
    const noMatch = project(record({ originId: 'OTHER' }), ROUTE_TO_A, new Set(['A']))
    assert.equal(noMatch.unresolved, 'NO_MATCH')
    assert.equal('folderId' in noMatch, false)
    // FOLDER_GONE 的解析結果本身帶著那個不可用的 folder —— 它不得被轉交成預選值。
    const gone = project(record(), ROUTE_TO_A, new Set(['B']))
    assert.equal(gone.unresolved, 'FOLDER_GONE')
    assert.equal('folderId' in gone, false)
  })
})

describe('清單：篩選與順序（intake-inbox-usability）', () => {
  it('已了結者不在清單中，未了結的已接受者仍在', () => {
    const list = listView(
      [
        record({ id: 'open', state: 'accepted', sessionId: 's1' }),
        record({ id: 'done', state: 'accepted', sessionId: 's2', settledAt: 5 }),
        record({ id: 'gone', state: 'dismissed' }),
      ],
      ROUTE_TO_A,
      new Set(['A']),
    )
    assert.deepEqual(list.map((item) => item.id), ['open'])
  })

  it('以打亂的落盤順序種入，輸出為到達時間由新到舊', () => {
    // 落盤順序既不是由舊到新、也不是由新到舊 —— 否則「反轉插入順序」這個錯誤實作照樣綠。
    const list = listView(
      [
        record({ id: 'middle', receivedAt: 2000 }),
        record({ id: 'oldest', receivedAt: 1000 }),
        record({ id: 'newest', receivedAt: 3000 }),
      ],
      ROUTE_TO_A,
      new Set(['A']),
    )
    assert.deepEqual(list.map((item) => item.id), ['newest', 'middle', 'oldest'])
  })

  it('回補的形狀：到達時間相同、發生時間各異 ⇒ 依發生時間由新到舊', () => {
    // 同一次回補進來的，到達時間幾乎相同 —— 依它排序等於沒有排序。落盤順序也打亂。
    const list = listView(
      [
        record({ id: 'monday', receivedAt: 9000, occurredAt: 1000 }),
        record({ id: 'wednesday', receivedAt: 9000, occurredAt: 3000 }),
        record({ id: 'tuesday', receivedAt: 9000, occurredAt: 2000 }),
      ],
      ROUTE_TO_A,
      new Set(['A']),
    )
    assert.deepEqual(list.map((item) => item.id), ['wednesday', 'tuesday', 'monday'])
    assert.deepEqual(list.map((item) => item.occurredAt), [3000, 2000, 1000])
  })

  it('宣告未來時刻者的有效時間為到達時間 —— 釘不上最上面', () => {
    const list = listView(
      [record({ id: 'honest', receivedAt: 5000, occurredAt: 4000 }), record({ id: 'future', receivedAt: 1000, occurredAt: 99_999 })],
      ROUTE_TO_A,
      new Set(['A']),
    )
    assert.deepEqual(list.map((item) => item.id), ['honest', 'future'])
    assert.equal(list[1].occurredAt, 1000)
  })

  it('沒有宣告發生時間者以到達時間代之', () => {
    const [item] = listView([record({ id: 'plain', receivedAt: 4242 })], ROUTE_TO_A, new Set(['A']))
    assert.equal(item.occurredAt, 4242)
  })

  it('內容已過期者排在最後', () => {
    const list = listView(
      [record({ id: 'expired', state: 'accepted', sessionId: 's', content: null }), record({ id: 'fresh', receivedAt: 10 })],
      ROUTE_TO_A,
      new Set(['A']),
    )
    assert.deepEqual(list.map((item) => item.id), ['fresh', 'expired'])
  })
})
