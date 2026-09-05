import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import {
  aggregate,
  classifyLanguage,
  classifyTone,
  DEFAULT_TONE_RULES,
  percentile,
  type ToneRules,
} from './insights-aggregate'
import { readArchive, scanTranscripts } from './transcript-archive'
import type { ArchiveRow } from './transcript-extract'
import { writeTranscriptFixture, type TranscriptFixtureFacts } from './transcript-fixture.testkit'

const roots: string[] = []
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

function scanned(): { facts: TranscriptFixtureFacts; rows: ArchiveRow[]; projects: { dirName: string; cwds: string[] }[] } {
  const root = mkdtempSync(path.join(tmpdir(), 'spekterm-agg-'))
  roots.push(root)
  const facts = writeTranscriptFixture(path.join(root, 'source'))
  const archiveRoot = path.join(root, 'archive')
  scanTranscripts({ projectsDir: facts.projectsDir, archiveRoot })
  const entries = readArchive(archiveRoot)
  const byProject = new Map<string, string[]>()
  for (const e of entries) {
    const acc = byProject.get(e.header.p) ?? []
    for (const c of e.header.cwds) if (!acc.includes(c)) acc.push(c)
    byProject.set(e.header.p, acc)
  }
  void readFileSync
  void readdirSync
  return {
    facts,
    rows: entries.flatMap((e) => e.rows),
    projects: [...byProject].map(([dirName, cwds]) => ({ dirName, cwds })),
  }
}

const msg = (t: number, text: string, s = 's1', p = 'proj'): ArchiveRow => ({ k: 'msg', t, s, p, text })
const tool = (t: number, n: string, a?: string, s = 's1', p = 'proj'): ArchiveRow =>
  a === undefined ? { k: 'tool', t, s, p, n } : { k: 'tool', t, s, p, n, a }

describe('聚合與語言分類', () => {
  it('6.1/6.2 十一個視圖的資料都算得出來', () => {
    const { facts, rows, projects } = scanned()
    const view = aggregate(rows, { projects })
    assert.equal(view.totals.messages, facts.userMessages)
    assert.equal(view.totals.tools, facts.toolCalls)
    assert.equal(view.totals.interrupts, facts.interrupts)
    assert.equal(view.weekHeat.length, 7)
    assert.equal(view.weekHeat[0].length, 24)
    assert.ok(view.sitDown.count > 0)
    assert.ok(view.messageLength.count > 0)
    assert.ok(view.roundsPerSession.count > 0)
    assert.ok(view.interruptsDaily.length > 0)
    assert.equal(view.projects.length, facts.projects.length)
    assert.ok(view.bash.length > 0)
    assert.deepEqual(view.skills.map((s) => s.name), Object.keys(facts.skills))
    assert.equal(view.tone.length, DEFAULT_TONE_RULES.categories.length)
    assert.equal(view.language.zh + view.language.en, facts.userMessages)
    assert.ok(Array.isArray(view.phrases))
  })

  it('6.1 專案的名稱來自反查，且送出的是不可逆識別碼', () => {
    const { facts, rows, projects } = scanned()
    const view = aggregate(rows, { projects })
    const labels = view.projects.map((p) => p.label).sort()
    assert.deepEqual(labels, facts.projects.map((p) => p.label).sort())
    for (const p of view.projects) {
      assert.match(p.id, /^[0-9a-f]{8}$/)
      assert.ok(!JSON.stringify(p).includes('fixture'), '識別碼與名稱都不得洩漏路徑')
    }
  })

  it('6.3 以本機時區分組：跨 UTC 日期的那筆落在本機的小時', () => {
    const { facts, rows, projects } = scanned()
    if (facts.timezoneShape === 'no-offset') {
      // 機器跑在 UTC，造不出對比 —— 略過而非假裝通過。
      assert.equal(new Date().getTimezoneOffset(), 0)
      return
    }
    const view = aggregate(rows, { projects })
    const hour = facts.timezoneLocalHour
    const total = view.weekHeat.reduce((sum, row) => sum + row[hour], 0)
    assert.ok(total > 0, `本機 ${hour} 時應當有一筆，實際 0`)
    // 以 UTC 分組的話它會落在別的小時 —— 確認那個小時不是同一格。
    const utcHour = new Date(rows.find((r) => r.k === 'msg' && new Date(r.t).getHours() === hour)!.t).getUTCHours()
    assert.notEqual(utcHour, hour, 'fixture 的那筆沒有跨時區，這條測試沒有鑑別力')
  })

  it('6.3 逐日的鍵是本機日期，不是 UTC 日期', () => {
    // 本機 00:30（UTC+8 時 UTC 為前一天 16:30）。
    const local = new Date(2026, 0, 12, 0, 30, 0)
    const view = aggregate([{ k: 'int', t: local.getTime(), s: 's1', p: 'proj' }])
    assert.deepEqual(view.interruptsDaily.map((d) => d.date), ['2026-01-12'])
  })

  it('6.4 只回傳中位數與百分位，沒有平均數', () => {
    const rows = [...Array(10)].map((_, i) => msg(1000 + i, 'x'.repeat(10))).concat(msg(2000, 'y'.repeat(5000)))
    const view = aggregate(rows)
    assert.equal(view.messageLength.median, 10)
    assert.equal(view.messageLength.max, 5000)
    const dump = JSON.stringify(view)
    assert.ok(!dump.includes('"mean"') && !dump.includes('"average"'), '不得輸出平均數')
    assert.ok(!('mean' in view.messageLength))
  })

  it('6.5 切段：超過 30 分鐘才切，工具呼叫算活動', () => {
    const t0 = new Date(2026, 0, 12, 9, 0, 0).getTime()
    const min = 60_000
    const view = aggregate([
      msg(t0, '開始'),
      // agent 連跑工具 40 分鐘（每 20 分鐘一次）—— 不得被切開。
      tool(t0 + 20 * min, 'Bash', 'npm'),
      tool(t0 + 40 * min, 'Bash', 'npm'),
      // 隔 4 小時 —— 第二段。
      msg(t0 + 280 * min, '第二段'),
    ])
    assert.equal(view.totals.sitDowns, 2)
    assert.equal(view.sitDown.thresholdMinutes, 30)
    assert.equal(view.sitDown.max, 40, '連跑工具的那段長 40 分鐘，不是被切成兩段')
  })

  it('6.5 只算使用者訊息的話會多切一段（對照）', () => {
    const t0 = new Date(2026, 0, 12, 9, 0, 0).getTime()
    const min = 60_000
    // 同樣的事件，但拿掉工具 —— 兩則訊息相隔 40 分鐘就會變成兩段。
    const view = aggregate([msg(t0, '開始'), msg(t0 + 40 * min, '結束')])
    assert.equal(view.totals.sitDowns, 2)
  })

  it('6.6 skill 來自工具參數，與訊息開頭無關', () => {
    const view = aggregate([msg(1000, '幫我跑一下'), tool(1001, 'Skill', 'opsx:continue')])
    assert.deepEqual(view.skills, [{ name: 'opsx:continue', n: 1 }])
  })

  it('6.7 語氣可複選，判定依據與比對用的是同一份詞表', () => {
    assert.deepEqual(classifyTone('你可以幫我看一下嗎？').sort(), ['polite', 'question'])
    assert.deepEqual(classifyTone('好'), ['ack'])
    assert.deepEqual(classifyTone('繼續 spec'), ['imperative'])
    assert.deepEqual(classifyTone('看起來沒問題'), [], '排除詞要生效')
    assert.deepEqual(classifyTone('分別是客廳次臥'), [], '單字「別」不得命中糾錯')
    assert.deepEqual(classifyTone('不對，應該是另一個'), ['correction'])

    const view = aggregate([msg(1, '你可以幫我看一下嗎？')])
    const keys = view.tone.filter((t) => t.n > 0).map((t) => t.key).sort()
    assert.deepEqual(keys, ['polite', 'question'])
    // 每一類都帶著它的詞表 —— 畫面直接列這一份，因此說明不可能與比對分歧。
    for (const category of view.tone) {
      assert.ok(category.clauses.length > 0)
      for (const clause of category.clauses) assert.ok(clause.terms.length > 0)
    }
  })

  it('6.7 中英文互斥且相加為 100%，夾雜另計', () => {
    assert.deepEqual(classifyLanguage('全部都是中文'), { primary: 'zh', mixed: false })
    assert.deepEqual(classifyLanguage('all english here'), { primary: 'en', mixed: false })
    assert.deepEqual(classifyLanguage('跑 npm test'), { primary: 'en', mixed: true })

    const view = aggregate([msg(1, '全部中文'), msg(2, 'pure english'), msg(3, '跑 npm test')])
    assert.equal(view.language.zh + view.language.en, view.totals.messages)
    assert.equal(view.language.mixed, 1)
  })

  it('6.8 最常說的那幾句：長度上限與次數下限都生效', () => {
    const long = 'x'.repeat(25)
    const view = aggregate([
      msg(1, '好'), msg(2, '好'), msg(3, '好'),
      msg(4, '只出現一次'),
      msg(5, long), msg(6, long), msg(7, long),
    ])
    assert.deepEqual(view.phrases, [{ name: '好', n: 3 }])
    assert.deepEqual(view.phraseLimits, { maxChars: 20, minCount: 3 })
  })

  it('6.8b 每類例句至多 9 則、每則不超過 46 字元，且確實屬於該類', () => {
    const rows = [...Array(30)].map((_, i) => msg(1000 + i, `這樣可以嗎？第 ${i} 個問題`))
    rows.push(msg(9999, `這樣可以嗎？${'長'.repeat(60)}`))
    const view = aggregate(rows)
    const question = view.tone.find((t) => t.key === 'question')
    assert.ok(question)
    assert.ok(question.examples.length <= 9, `例句 ${question.examples.length} 則`)
    for (const ex of question.examples) {
      assert.ok(ex.length <= 46, `例句過長：${ex.length}`)
      assert.ok(classifyTone(ex).includes('question'), `例句不屬於該類：${ex}`)
    }
  })

  it('6.9 換一組規則對同一份資料重跑，全部期間一併重算', () => {
    const { rows, projects } = scanned()
    const before = aggregate(rows, { projects })
    const custom: ToneRules = {
      version: 1,
      categories: [{ key: 'shout', clauses: [{ kind: 'contains', terms: ['改'] }] }],
    }
    const after = aggregate(rows, { projects, rules: custom })
    assert.equal(after.tone.length, 1)
    assert.equal(after.tone[0].key, 'shout')
    assert.notDeepEqual(before.tone.map((t) => t.key), after.tone.map((t) => t.key))
    // 其他視圖不受影響 —— 規則只影響語氣。
    assert.equal(after.totals.messages, before.totals.messages)
  })

  it('6.10 時間範圍的篩選，與跨期比較', () => {
    const day1 = new Date(2026, 0, 12, 10, 0, 0).getTime()
    const day2 = new Date(2026, 0, 20, 10, 0, 0).getTime()
    const rows = [msg(day1, '第一期'), msg(day1 + 1000, '第一期又一句'), msg(day2, '第二期')]
    const all = aggregate(rows)
    const first = aggregate(rows, { to: day1 + 5000 })
    const second = aggregate(rows, { from: day2 - 5000 })
    assert.equal(all.totals.messages, 3)
    assert.equal(first.totals.messages, 2)
    assert.equal(second.totals.messages, 1)
    // 同一個指標在兩段期間可並列比較。
    assert.notEqual(first.messageLength.median, second.messageLength.median)
  })

  it('非使用者輸入的比例被回報（旗標失效的偵測訊號）', () => {
    const view = aggregate([msg(1, 'x')], { stats: { userTextBlocks: 10, nonUserInput: 4 } })
    assert.equal(view.nonUserInputRatio, 0.4)
    assert.equal(aggregate([msg(1, 'x')]).nonUserInputRatio, 0)
  })

  it('資料量大時不炸 —— 不得以展開運算子求 min/max', () => {
    // 真實資料是六十幾萬列。展開一個那麼大的陣列會 `RangeError: Maximum call stack size
    // exceeded`，而 fixture 只有二十列，完全看不出來 —— 這條是 dogfood 抓到的，補一個上界守衛。
    const many: ArchiveRow[] = Array.from({ length: 300_000 }, (_, i) => msg(1_000_000 + i, 'x'))
    const view = aggregate(many)
    assert.equal(view.totals.messages, 300_000)
    assert.deepEqual(view.range, { from: 1_000_000, to: 1_299_999 })
  })

  it('percentile 對空陣列不炸', () => {
    assert.equal(percentile([], 0.5), 0)
    assert.equal(percentile([1, 2, 3, 4], 0.5), 3)
  })
})
