import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { extractRows, type ArchiveRow, type ExtractStats } from './transcript-extract'
import { writeTranscriptFixture, type TranscriptFixtureFacts } from './transcript-fixture.testkit'

const roots: string[] = []
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

interface Extracted {
  facts: TranscriptFixtureFacts
  rows: ArchiveRow[]
  stats: ExtractStats
  /** 每一份來源檔案各自的萃取結果，鍵是相對 `projects/` 的路徑。 */
  byFile: Map<string, { rows: ArchiveRow[]; cwds: string[] }>
}

function runFixture(): Extracted {
  const root = mkdtempSync(path.join(tmpdir(), 'spekterm-extract-'))
  roots.push(root)
  const facts = writeTranscriptFixture(root)

  const rows: ArchiveRow[] = []
  const stats: ExtractStats = { userTextBlocks: 0, nonUserInput: 0, malformed: 0 }
  const byFile = new Map<string, { rows: ArchiveRow[]; cwds: string[] }>()

  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full)
        continue
      }
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue
      const rel = path.relative(facts.projectsDir, full)
      const result = extractRows(readFileSync(full, 'utf8').split('\n'), {
        sessionId: e.name.slice(0, -'.jsonl'.length),
        projectDir: rel.split(path.sep)[0],
        isSubagent: rel.includes(`subagents${path.sep}`),
      })
      byFile.set(rel, { rows: result.rows, cwds: result.cwds })
      rows.push(...result.rows)
      stats.userTextBlocks += result.stats.userTextBlocks
      stats.nonUserInput += result.stats.nonUserInput
      stats.malformed += result.stats.malformed
    }
  }
  walk(facts.projectsDir)
  return { facts, rows, stats, byFile }
}

const msgs = (rows: ArchiveRow[]) => rows.filter((r) => r.k === 'msg')
const tools = (rows: ArchiveRow[]) => rows.filter((r) => r.k === 'tool')

describe('transcript 萃取', () => {
  it('2.1 未知記錄類型被忽略且不拋錯', () => {
    const ctx = { sessionId: 's', projectDir: 'p', isSubagent: false }
    const base = extractRows(['{"type":"user","timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}'], ctx)
    const withUnknown = extractRows(
      [
        '{"type":"spekterm-brand-new-kind","note":"ignore me"}',
        '{"type":"user","timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}',
        '{"type":"another-unknown"}',
      ],
      ctx,
    )
    assert.deepEqual(withUnknown.rows, base.rows)
    assert.equal(withUnknown.stats.malformed, 0)
  })

  it('2.1 損毀的行只計入 malformed，不影響其他行', () => {
    const r = extractRows(
      ['{ not json', '{"type":"user","timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}'],
      { sessionId: 's', projectDir: 'p', isSubagent: false },
    )
    assert.equal(r.stats.malformed, 1)
    assert.equal(msgs(r.rows).length, 1)
  })

  it('2.2 role: user 的工具結果不產生使用者訊息列', () => {
    const { facts, rows } = runFixture()
    assert.equal(msgs(rows).length, facts.userMessages)
    const texts = msgs(rows).map((r) => r.text)
    assert.ok(!texts.some((t) => t.includes('src/foo.ts:1')), '工具結果的內容不該成為使用者訊息')
  })

  it('2.3 isMeta 不產生使用者訊息列，isCompactSummary 標示而非丟棄', () => {
    const { facts, rows } = runFixture()
    const texts = msgs(rows).map((r) => r.text).join('\n')
    assert.ok(!texts.includes('Base directory for this skill'))
    assert.ok(!texts.includes('Another Claude session sent'))
    assert.ok(!texts.includes('[Image: original'))
    // **無法從內文區分的那一筆** —— 它是這條 requirement 真正的載體。
    assert.ok(!texts.includes('把 C 也順便改一下'), 'isMeta 的判定必須看結構旗標，不是看內文長什麼樣')
    assert.equal(rows.filter((r) => r.k === 'cmp').length, facts.compactRecords)
  })

  it('2.4 中斷以 interruptedMessageId 判定；內文相同但無該欄位者是一般訊息', () => {
    const { facts, rows } = runFixture()
    assert.equal(rows.filter((r) => r.k === 'int').length, facts.interrupts)
    // **反例**：同樣的內文、沒有那個欄位 —— 它必須是一般訊息。
    // 這一則在真實資料裡一筆都沒有；少了它，比對英文文案的錯誤實作也會通過。
    const fake = msgs(rows).filter((r) => r.text.startsWith('[Request interrupted by user'))
    assert.equal(fake.length, facts.fakeInterrupts)
  })

  it('2.5 通篇只有通知者不產生列；夾雜者保留其餘內文', () => {
    const { rows } = runFixture()
    const texts = msgs(rows).map((r) => r.text)
    assert.ok(!texts.some((t) => t.includes('<task-notification>')), '通知不該留在內文裡')
    assert.ok(!texts.some((t) => t === ''), '純通知不得產生一列空內文的訊息')
    assert.ok(texts.includes('接著把 B 也修掉'), '夾雜時其餘內文必須保留')
  })

  it('2.6 slash command 還原；bash 輸入算使用者輸入、bash 輸出不算', () => {
    const { facts, rows } = runFixture()
    const texts = msgs(rows).map((r) => r.text)
    for (const cmd of facts.slashCommands) assert.ok(texts.includes(cmd), `找不到還原後的 ${cmd}`)
    for (const b of facts.bashInputs) assert.ok(texts.includes(b), `找不到還原後的 ${b}`)
    assert.ok(!texts.some((t) => t.includes('<command-name>')), 'slash 的 XML 不該留在內文裡')
    assert.ok(!texts.some((t) => t.includes('<bash-stdout>')), 'bash 輸出不是使用者輸入')
  })

  it('2.7 工具的辨識參數：Bash 取第一個 token、Skill 取名稱、Agent 取類型', () => {
    const { facts, rows } = runFixture()
    const byName: Record<string, number> = {}
    const heads: Record<string, number> = {}
    const skills: Record<string, number> = {}
    for (const r of tools(rows)) {
      byName[r.n] = (byName[r.n] ?? 0) + 1
      if (r.n === 'Bash' && r.a) heads[r.a] = (heads[r.a] ?? 0) + 1
      if (r.n === 'Skill' && r.a) skills[r.a] = (skills[r.a] ?? 0) + 1
    }
    assert.equal(tools(rows).length, facts.toolCalls)
    assert.deepEqual(byName, facts.toolsByName)
    assert.deepEqual(heads, facts.bashHeads)
    assert.deepEqual(skills, facts.skills)
    assert.ok(tools(rows).some((r) => r.n === 'Agent' && r.a === 'Explore'))
  })

  it('2.8 用量的四個欄位都被保存', () => {
    const { facts, rows } = runFixture()
    const usage = rows.filter((r) => r.k === 'use')
    assert.equal(usage.length, facts.usageRows)
    for (const u of usage) {
      for (const key of ['i', 'o', 'cr', 'cw'] as const) {
        assert.equal(typeof u[key], 'number', `用量缺少 ${key}`)
      }
    }
    assert.ok(usage.some((u) => u.cr > 0), 'cache_read 必須被保存 —— 它才是真正的輸入量')
  })

  it('2.9 使用者訊息的內文逐字保存（不是只留長度）', () => {
    const raw = '第一行  帶著空白\n第二行「標點」與 code `x = 1`'
    const r = extractRows(
      [JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: raw }] } })],
      { sessionId: 's', projectDir: 'p', isSubagent: false },
    )
    assert.equal(msgs(r.rows).length, 1)
    assert.equal(msgs(r.rows)[0].text, raw)
  })

  it('2.10 工具輸出與 assistant 的回覆都不進存檔', () => {
    const { rows } = runFixture()
    const dump = JSON.stringify(rows)
    assert.ok(!dump.includes('src/foo.ts:1'), '工具輸出不得進存檔 —— 那是使用者 repo 的內容')
    assert.ok(!dump.includes('想一下'), 'assistant 的 thinking 不進存檔')
    assert.equal(rows.some((r) => r.k === 'msg' && r.text === '好'), false, 'assistant 的回覆不是使用者訊息')
  })

  it('2.11 subagent：工具算它，使用者訊息不算它', () => {
    const { byFile } = runFixture()
    const subEntry = [...byFile.entries()].find(([f]) => f.includes(`subagents${path.sep}`))
    assert.ok(subEntry, '找不到 subagent 的檔案')
    const [, sub] = subEntry
    assert.equal(msgs(sub.rows).length, 0, 'orchestrator 寫給 subagent 的指令不是使用者打的')
    assert.ok(tools(sub.rows).length > 0, 'subagent 跑掉的工具是真的跑掉了')
    assert.ok(sub.rows.some((r) => r.k === 'use'), 'subagent 花掉的 token 也是真的花掉了')
  })

  it('2.12 統計「非使用者輸入」的比例，作為旗標失效的偵測訊號', () => {
    const { stats } = runFixture()
    assert.ok(stats.userTextBlocks > 0)
    assert.ok(stats.nonUserInput > 0)
    assert.ok(stats.nonUserInput < stats.userTextBlocks)
    // fixture 的 isMeta 有 4 筆、compact 1 筆、中斷 1 筆、純通知 1 筆、bash 輸出 1 筆。
    assert.equal(stats.nonUserInput, 8)
  })

  it('依序回報出現過的 cwd，讓專案根可以被反查', () => {
    const { facts, byFile } = runFixture()
    const s1 = byFile.get(path.join(facts.projects[0].dirName, 'session-1.jsonl'))
    assert.ok(s1)
    assert.ok(s1.cwds.length >= 3, `cwd 只有 ${s1.cwds.length} 種`)
    assert.equal(s1.cwds[0], facts.projects[0].cwd, '最早出現的 cwd 才是專案根')
    assert.notEqual(s1.cwds[s1.cwds.length - 1], facts.projects[0].cwd)
  })

  it('每一列都帶著 session 與專案的識別', () => {
    const { facts, rows } = runFixture()
    const projects = new Set(facts.projects.map((p) => p.dirName))
    for (const r of rows) {
      assert.ok(r.s.length > 0, '缺 session 識別')
      assert.ok(projects.has(r.p), `專案識別 ${r.p} 不在 fixture 的清單裡`)
      assert.ok(Number.isFinite(r.t) && r.t > 0, '缺時間')
    }
  })
})
