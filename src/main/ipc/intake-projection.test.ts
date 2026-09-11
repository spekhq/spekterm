import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { buildContext, buildPrompt, createNonce, writeContext } from '../intake-context'
import { parseIntake } from '../intake-schema'
import { IntakeService } from '../intake-service'
import { IntakeStore } from '../intake-store'
import { configureAgentEvents, prepareEventInjection } from '../agent-events'

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

    // 投影所依據的欄位集合 —— 與 `ipc/intake.ts` 的 `project()` 同源。
    const record = store.get('file', 'a1')
    assert.ok(record?.content)
    const projected = {
      id: record.id,
      adapter: record.adapter,
      state: record.state,
      originKind: record.content.verified.originKind,
      originId: record.content.verified.originId,
      originLabel: record.content.authored.originLabel,
      title: record.content.authored.title,
      actor: record.content.authored.actor,
      body: record.content.authored.body,
      receivedAt: record.content.receivedAt,
    }

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
    configureAgentEvents(temp())
    const contribution = prepareEventInjection('S-keys', true)
    assert.ok(contribution)
    assert.deepEqual(Object.keys(contribution.settings), ['hooks'])
  })
})
