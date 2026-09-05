import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { encodeProjectDir, writeTranscriptFixture } from './transcript-fixture.testkit'

/**
 * fixture 產生器的自檢。
 *
 * **這裡刻意不重用產生器的任何計數邏輯** —— 它把寫出去的檔案重新讀回來、自己數一遍，再與
 * `facts` 比對。共用一份計數的話，產生器改了內容而忘了改 `facts`（或反之）兩邊會一起錯，
 * 而測試照樣是綠的：那正是這支測試存在的理由。
 */

const roots: string[] = []
function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'spekterm-transcript-fixture-'))
  roots.push(root)
  return { root, facts: writeTranscriptFixture(root) }
}

after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

interface Row {
  raw: Record<string, unknown>
  blocks: Record<string, unknown>[]
}

function readAll(projectsDir: string): { file: string; rows: Row[] }[] {
  const out: { file: string; rows: Row[] }[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile() && e.name.endsWith('.jsonl')) {
        const rows = readFileSync(full, 'utf8')
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => {
            const raw = JSON.parse(l) as Record<string, unknown>
            const msg = raw.message as Record<string, unknown> | undefined
            const content = msg?.content
            return { raw, blocks: Array.isArray(content) ? (content as Record<string, unknown>[]) : [] }
          })
        out.push({ file: path.relative(projectsDir, full), rows })
      }
    }
  }
  walk(projectsDir)
  return out
}

/** 產生器宣稱「使用者真的打了」的那些訊息 —— 這裡以規格的判準獨立重算一次。 */
function countUserMessages(files: { file: string; rows: Row[] }[]): number {
  let n = 0
  for (const f of files) {
    if (f.file.includes('subagents')) continue // subagent 的 user 記錄不是使用者打的
    for (const { raw, blocks } of f.rows) {
      if (raw.type !== 'user') continue
      if (raw.isMeta === true || raw.isCompactSummary === true) continue
      if (typeof raw.interruptedMessageId === 'string') continue
      for (const b of blocks) {
        if (b.type !== 'text') continue
        const text = String(b.text ?? '')
        if (text.includes('<bash-stdout>') || text.includes('<bash-stderr>')) continue
        const stripped = text.replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '').trim()
        if (!stripped) continue
        n += 1
      }
    }
  }
  return n
}

describe('transcript fixture 產生器', () => {
  it('把兩個專案寫到 projects/ 之下，目錄名是 cwd 的編碼', () => {
    const { facts } = makeFixture()
    assert.equal(path.basename(facts.projectsDir), 'projects')
    for (const p of facts.projects) {
      assert.equal(p.dirName, encodeProjectDir(p.cwd))
      assert.ok(statSync(path.join(facts.projectsDir, p.dirName)).isDirectory())
    }
    assert.equal(facts.projects.length, 2)
  })

  it('使用者訊息數與宣告一致（獨立重算）', () => {
    const { facts } = makeFixture()
    assert.equal(countUserMessages(readAll(facts.projectsDir)), facts.userMessages)
  })

  it('工具呼叫的總數與各別次數與宣告一致（含 subagent）', () => {
    const { facts } = makeFixture()
    const byName: Record<string, number> = {}
    const heads: Record<string, number> = {}
    const skills: Record<string, number> = {}
    let total = 0
    for (const f of readAll(facts.projectsDir)) {
      for (const { blocks } of f.rows) {
        for (const b of blocks) {
          if (b.type !== 'tool_use') continue
          total += 1
          const name = String(b.name)
          byName[name] = (byName[name] ?? 0) + 1
          const input = (b.input ?? {}) as Record<string, unknown>
          if (name === 'Bash') {
            const head = String(input.command ?? '').trim().split(/[\s|;&]/)[0]
            heads[head] = (heads[head] ?? 0) + 1
          }
          if (name === 'Skill') {
            const s = String(input.skill ?? '')
            skills[s] = (skills[s] ?? 0) + 1
          }
        }
      }
    }
    assert.equal(total, facts.toolCalls)
    assert.deepEqual(byName, facts.toolsByName)
    assert.deepEqual(heads, facts.bashHeads)
    assert.deepEqual(skills, facts.skills)
  })

  it('帶用量資訊的 assistant 記錄數與宣告一致', () => {
    const { facts } = makeFixture()
    let n = 0
    for (const f of readAll(facts.projectsDir)) {
      for (const { raw } of f.rows) {
        const msg = raw.message as Record<string, unknown> | undefined
        if (raw.type === 'assistant' && msg && typeof msg.usage === 'object' && msg.usage) n += 1
      }
    }
    assert.equal(n, facts.usageRows)
  })

  it('結構旗標各自的筆數與宣告一致', () => {
    const { facts } = makeFixture()
    let meta = 0
    let compact = 0
    let interrupted = 0
    let unknown = 0
    for (const f of readAll(facts.projectsDir)) {
      for (const { raw } of f.rows) {
        if (raw.isMeta === true) meta += 1
        if (raw.isCompactSummary === true) compact += 1
        if (typeof raw.interruptedMessageId === 'string') interrupted += 1
        if (raw.type !== 'user' && raw.type !== 'assistant' && raw.type !== 'summary') unknown += 1
      }
    }
    assert.equal(meta, facts.metaRecords)
    assert.equal(compact, facts.compactRecords)
    assert.equal(interrupted, facts.interrupts)
    assert.equal(unknown, facts.unknownTypeRecords)
  })

  it('造得出「內文像中斷但不帶結構欄位」的反例', () => {
    const { facts } = makeFixture()
    let fake = 0
    for (const f of readAll(facts.projectsDir)) {
      for (const { raw, blocks } of f.rows) {
        if (raw.type !== 'user' || typeof raw.interruptedMessageId === 'string') continue
        if (blocks.some((b) => String(b.text ?? '').startsWith('[Request interrupted by user'))) fake += 1
      }
    }
    // 這個反例在真實資料裡一筆都沒有 —— 沒有它，「中斷以結構欄位判定」在錯誤實作下也會通過。
    assert.equal(fake, facts.fakeInterrupts)
    assert.ok(fake > 0)
  })

  it('造得出「通篇只有通知」與「通知夾雜真實文字」兩種形態', () => {
    const { facts } = makeFixture()
    let pure = 0
    let mixed = 0
    for (const f of readAll(facts.projectsDir)) {
      for (const { raw, blocks } of f.rows) {
        if (raw.type !== 'user' || raw.isMeta === true) continue
        for (const b of blocks) {
          const text = String(b.text ?? '')
          if (!text.includes('<task-notification>')) continue
          const rest = text.replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '').trim()
          if (rest) mixed += 1
          else pure += 1
        }
      }
    }
    assert.equal(pure, facts.pureNotifications)
    assert.ok(mixed > 0, '夾雜的形態在真實資料中是 0 筆，fixture 必須自己造出來')
  })

  it('slash command 與 bash 輸入以未還原的原始形態存在', () => {
    const { facts } = makeFixture()
    const texts: string[] = []
    for (const f of readAll(facts.projectsDir)) {
      for (const { blocks } of f.rows) for (const b of blocks) if (b.type === 'text') texts.push(String(b.text ?? ''))
    }
    assert.ok(texts.some((t) => t.includes('<command-name>/opsx:continue</command-name>')))
    assert.ok(texts.some((t) => t.includes('<bash-input>ls -la</bash-input>')))
    assert.ok(texts.some((t) => t.includes('<bash-stdout>')))
    assert.equal(facts.slashCommands.length, 1)
    assert.equal(facts.bashInputs.length, 1)
  })

  it('有一支 session 的 cwd 中途改變，且專案根不是最後一個 cwd', () => {
    const { facts } = makeFixture()
    const proj = facts.projects[0]
    const file = path.join(facts.projectsDir, proj.dirName, 'session-1.jsonl')
    const cwds = readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => (JSON.parse(l) as Record<string, unknown>).cwd)
      .filter((c): c is string => typeof c === 'string')
    const distinct = [...new Set(cwds)]
    assert.ok(distinct.length >= 3, `cwd 只有 ${distinct.length} 種，反查的反例造不出來`)
    assert.notEqual(cwds[cwds.length - 1], proj.cwd, '最後一個 cwd 不該等於專案根，否則「取最後一個」的錯誤實作也會通過')
    assert.equal(encodeProjectDir(proj.cwd), proj.dirName)
  })

  it('subagent 的 transcript 在自己的子目錄裡', () => {
    const { facts } = makeFixture()
    const files = readAll(facts.projectsDir).map((f) => f.file)
    assert.ok(files.some((f) => f.includes(`subagents${path.sep}`)), files.join(', '))
  })

  it('最長訊息足以讓中位數與平均數拉開一個數量級', () => {
    const { facts } = makeFixture()
    const lens: number[] = []
    for (const f of readAll(facts.projectsDir)) {
      if (f.file.includes('subagents')) continue
      for (const { raw, blocks } of f.rows) {
        if (raw.type !== 'user' || raw.isMeta === true || raw.isCompactSummary === true) continue
        if (typeof raw.interruptedMessageId === 'string') continue
        for (const b of blocks) if (b.type === 'text') lens.push(String(b.text ?? '').length)
      }
    }
    lens.sort((a, b) => a - b)
    const median = lens[Math.floor(lens.length / 2)]
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length
    assert.equal(lens[lens.length - 1], facts.longestMessageChars)
    assert.ok(mean / median > 10, `平均 ${mean.toFixed(0)} 對中位數 ${median}，差距不足以讓「不得用平均數」那條驗得出來`)
  })

  it('時區形態要嘛造得出對比，要嘛誠實地宣告造不出來', () => {
    const { facts } = makeFixture()
    if (facts.timezoneShape === 'no-offset') {
      // 機器跑在 UTC，這條驗收沒有鑑別力 —— 宣告不可用比假裝通過好。
      assert.equal(new Date().getTimezoneOffset(), 0)
      return
    }
    assert.ok(facts.timezoneLocalHour === 0 || facts.timezoneLocalHour === 23, `localHour=${facts.timezoneLocalHour}`)
    const file = path.join(facts.projectsDir, facts.projects[0].dirName, 'session-1.jsonl')
    const hit = readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((r) => {
        const ts = r.timestamp
        if (typeof ts !== 'string') return false
        const d = new Date(ts)
        return d.getHours() === facts.timezoneLocalHour && d.getMinutes() === 30
      })
    assert.ok(hit, '宣告 available 卻找不到那筆記錄')
    const d = new Date(String(hit.timestamp))
    assert.notEqual(d.getUTCDate(), d.getDate(), '本機日期與 UTC 日期相同，這筆記錄沒有鑑別力')
  })

  it('兩次產生的內容逐位元組相同', () => {
    const a = makeFixture()
    const b = makeFixture()
    const dump = (root: string) =>
      readAll(path.join(root, 'projects'))
        .sort((x, y) => x.file.localeCompare(y.file))
        .map((f) => `${f.file}\n${f.rows.map((r) => JSON.stringify(r.raw)).join('\n')}`)
        .join('\n---\n')
    assert.equal(dump(a.root), dump(b.root))
    assert.deepEqual(a.facts.projects, b.facts.projects)
  })

  it('transcript 檔案以僅限擁有者的權限寫出', () => {
    const { facts } = makeFixture()
    if (process.platform === 'win32') return
    const file = path.join(facts.projectsDir, facts.projects[0].dirName, 'session-1.jsonl')
    assert.equal(statSync(file).mode & 0o777, 0o600)
  })
})
