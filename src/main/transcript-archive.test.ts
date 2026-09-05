import assert from 'node:assert/strict'
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { archivePathFor, readArchive, readArchiveFile, scanTranscripts } from './transcript-archive'
import { writeTranscriptFixture, type TranscriptFixtureFacts } from './transcript-fixture.testkit'
import { delegateDirSuffix } from './insights-source'

const DELEGATE_SUFFIX = delegateDirSuffix()

const roots: string[] = []
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

interface Bed {
  facts: TranscriptFixtureFacts
  archiveRoot: string
  scan: () => ReturnType<typeof scanTranscripts>
}

function bed(): Bed {
  const root = mkdtempSync(path.join(tmpdir(), 'spekterm-archive-'))
  roots.push(root)
  const facts = writeTranscriptFixture(path.join(root, 'source'))
  const archiveRoot = path.join(root, 'archive')
  return {
    facts,
    archiveRoot,
    scan: () => scanTranscripts({ projectsDir: facts.projectsDir, archiveRoot, excludeDirSuffix: DELEGATE_SUFFIX }),
  }
}

function allRows(archiveRoot: string) {
  return readArchive(archiveRoot).flatMap((e) => e.rows)
}

function listArchiveFiles(archiveRoot: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else out.push(path.relative(path.join(archiveRoot, 'rows'), full))
    }
  }
  walk(path.join(archiveRoot, 'rows'))
  return out.sort()
}

describe('transcript 存檔與增量掃描', () => {
  it('4.1 一個來源檔案對應一份存檔，且以僅限擁有者的權限寫出', () => {
    const b = bed()
    const r = b.scan()
    assert.equal(r.status, 'ok')
    assert.equal(r.scanned, 4, '兩個專案共四份 transcript（含 subagent）')

    const archives = listArchiveFiles(b.archiveRoot)
    assert.equal(archives.length, 4)
    // 結構原樣鏡射，只換副檔名。
    assert.ok(archives.includes(archivePathFor(path.join(b.facts.projects[0].dirName, 'session-1.jsonl'))))
    assert.ok(archives.some((a) => a.includes(`subagents${path.sep}`)))

    if (process.platform !== 'win32') {
      const one = path.join(b.archiveRoot, 'rows', archives[0])
      assert.equal(statSync(one).mode & 0o777, 0o600)
      assert.equal(statSync(path.join(b.archiveRoot, 'rows')).mode & 0o777, 0o700)
    }
  })

  it('4.1 重掃同一個來源不殘留舊列', () => {
    const b = bed()
    b.scan()
    const rel = path.join(b.facts.projects[0].dirName, 'session-1.jsonl')
    const src = path.join(b.facts.projectsDir, rel)
    // 換成只有一行的內容，並確保 mtime 也變了。
    writeFileSync(src, `${JSON.stringify({ type: 'user', timestamp: '2026-02-02T00:00:00.000Z', cwd: b.facts.projects[0].cwd, message: { role: 'user', content: [{ type: 'text', text: '只剩這一句' }] } })}\n`)
    b.scan()
    const entry = readArchiveFile(b.archiveRoot, archivePathFor(rel))
    assert.ok(entry)
    assert.deepEqual(entry.rows.filter((r) => r.k === 'msg').map((r) => r.text), ['只剩這一句'])
  })

  it('4.2 存檔中不出現任何彙總結果', () => {
    const b = bed()
    b.scan()
    for (const file of listArchiveFiles(b.archiveRoot)) {
      const text = readFileSync(path.join(b.archiveRoot, 'rows', file), 'utf8')
      for (const banned of ['median', 'percentile', 'histogram', 'p90', 'buckets', 'average']) {
        assert.ok(!text.includes(banned), `${file} 裡出現了彙總的字眼：${banned}`)
      }
      // 每一行都必須是 header 或一筆列 —— 沒有跨列的計數。
      for (const line of text.split('\n').filter((l) => l.trim()).slice(1)) {
        const row = JSON.parse(line) as { k?: string }
        assert.ok(['msg', 'int', 'cmp', 'tool', 'use'].includes(row.k ?? ''), line)
      }
    }
  })

  it('4.3 未變更的來源不被重讀', () => {
    const b = bed()
    const first = b.scan()
    assert.equal(first.scanned, 4)
    assert.equal(first.skipped, 0)

    const second = b.scan()
    assert.equal(second.scanned, 0, '第二次不該重讀任何來源')
    assert.equal(second.skipped, 4)
    assert.equal(second.rows, first.rows)
  })

  it('4.4 被追加內容的檔案：新列出現，舊列不重複', () => {
    const b = bed()
    const first = b.scan()
    const rel = path.join(b.facts.projects[0].dirName, 'session-2.jsonl')
    const src = path.join(b.facts.projectsDir, rel)

    const before = readArchiveFile(b.archiveRoot, archivePathFor(rel))
    assert.ok(before)
    const beforeTexts = before.rows.filter((r) => r.k === 'msg').map((r) => r.text)

    appendFileSync(src, `${JSON.stringify({ type: 'user', timestamp: '2026-02-02T00:00:00.000Z', cwd: b.facts.projects[0].cwd, message: { role: 'user', content: [{ type: 'text', text: '追加的一句' }] } })}\n`)
    const second = b.scan()

    assert.equal(second.scanned, 1, '只有被追加的那一份要重讀')
    assert.equal(second.skipped, 3)
    const after = readArchiveFile(b.archiveRoot, archivePathFor(rel))
    assert.ok(after)
    const afterTexts = after.rows.filter((r) => r.k === 'msg').map((r) => r.text)
    assert.deepEqual(afterTexts, [...beforeTexts, '追加的一句'])
    assert.equal(second.rows, first.rows + 1)
  })

  it('4.5 多次增量掃描的結果與一次從零全掃相同', () => {
    const b = bed()
    // 增量：掃 → 動一份 → 再掃 → 追加另一份 → 再掃。
    b.scan()
    const rel = path.join(b.facts.projects[0].dirName, 'session-2.jsonl')
    appendFileSync(path.join(b.facts.projectsDir, rel), `${JSON.stringify({ type: 'user', timestamp: '2026-02-02T00:00:00.000Z', cwd: b.facts.projects[0].cwd, message: { role: 'user', content: [{ type: 'text', text: '增量新增' }] } })}\n`)
    b.scan()
    b.scan()
    const incremental = readArchive(b.archiveRoot)

    // 全掃：對同一份來源，從空的存檔掃一次。
    const freshRoot = path.join(path.dirname(b.archiveRoot), 'archive-fresh')
    scanTranscripts({ projectsDir: b.facts.projectsDir, archiveRoot: freshRoot, excludeDirSuffix: DELEGATE_SUFFIX })
    const full = readArchive(freshRoot)

    const norm = (entries: ReturnType<typeof readArchive>) =>
      entries
        .map((e) => `${e.header.src}\n${JSON.stringify(e.header.cwds)}\n${e.rows.map((r) => JSON.stringify(r)).join('\n')}`)
        .sort()
    assert.deepEqual(norm(incremental), norm(full))
  })

  it('4.6 來源檔案被刪除後，對應的存檔原地保留', () => {
    const b = bed()
    b.scan()
    const rel = path.join(b.facts.projects[0].dirName, 'session-2.jsonl')
    const kept = readArchiveFile(b.archiveRoot, archivePathFor(rel))
    assert.ok(kept)

    rmSync(path.join(b.facts.projectsDir, rel))
    const r = b.scan()
    assert.equal(r.orphaned, 1)

    const still = readArchiveFile(b.archiveRoot, archivePathFor(rel))
    assert.ok(still, '來源消失後存檔必須還在 —— 那正是這個能力存在的理由')
    assert.deepEqual(still.rows, kept.rows)
    // 而且讀得到：孤兒不能只是躺在磁碟上而不被聚合看見。
    assert.ok(readArchive(b.archiveRoot).some((e) => e.header.src === rel))
  })

  it('4.7 來源已刪除時，仍可用當初未規劃的欄位重算', () => {
    const b = bed()
    b.scan()
    rmSync(b.facts.projectsDir, { recursive: true })
    const r = b.scan()
    assert.equal(r.status, 'source-unavailable')

    // 「每則訊息的字元數中位數」當初沒有被存成彙總 —— 從列重算得出來。
    const lens = allRows(b.archiveRoot)
      .filter((row) => row.k === 'msg')
      .map((row) => row.text.length)
      .sort((x, y) => x - y)
    assert.ok(lens.length > 0, '來源沒了，但列還在')
    assert.equal(lens[lens.length - 1], b.facts.longestMessageChars)
    // 而且是任何欄位都可以重算 —— 例如「用了哪些 skill」。
    const skills = allRows(b.archiveRoot).flatMap((row) => (row.k === 'tool' && row.n === 'Skill' ? [row.a] : []))
    assert.deepEqual(skills, Object.keys(b.facts.skills))
  })

  it('4.8 單一存檔損毀只影響它自己', () => {
    const b = bed()
    b.scan()
    const rel = archivePathFor(path.join(b.facts.projects[0].dirName, 'session-1.jsonl'))
    const full = path.join(b.archiveRoot, 'rows', rel)
    const healthy = readArchiveFile(b.archiveRoot, rel)
    assert.ok(healthy)

    writeFileSync(full, '{ 這不是合法的 NDJSON\n亂七八糟\n')
    // 損毀的那一份讀出來是 null，而其餘照常。
    assert.equal(readArchiveFile(b.archiveRoot, rel), null)
    assert.equal(readArchive(b.archiveRoot).length, 3)

    const r = b.scan()
    assert.equal(r.status, 'ok', '掃描不得因一份存檔損毀而失敗')
    assert.equal(r.scanned, 1, '損毀的那一份要被重新萃取')
    const repaired = readArchiveFile(b.archiveRoot, rel)
    assert.ok(repaired)
    assert.deepEqual(repaired.rows, healthy.rows)
  })

  it('2.3 委派留下的紀錄不被讀入，也不進存檔', () => {
    const b = bed()
    const before = b.scan()

    // 造一個「編碼後以委派目錄名結尾」的來源專案目錄，內容是一則普通的 user 記錄 ——
    // **它與真的使用者訊息在內容上完全無法區分**，這正是必須看目錄而不是看內容的理由。
    const delegateDir = path.join(b.facts.projectsDir, `-home-someone--config-Spekterm${DELEGATE_SUFFIX}`)
    mkdirSync(delegateDir, { recursive: true })
    writeFileSync(
      path.join(delegateDir, 'ffffffff-0000-0000-0000-000000000000.jsonl'),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-09-05T00:00:00.000Z',
        cwd: '/home/someone/.config/Spekterm/spekterm-report-delegate',
        message: { role: 'user', content: '幫我看看我最近都怎麼跟 agent 說話' },
      }) + '\n',
    )

    const after2 = b.scan()
    assert.equal(after2.rows, before.rows, '委派的列不得進入存檔')
    assert.equal(after2.scanned, 0, '委派的檔案不得被掃描')
    assert.ok(
      !listArchiveFiles(b.archiveRoot).some((f) => f.includes(DELEGATE_SUFFIX)),
      '存檔中不得出現委派的專案目錄',
    )
  })

  it('2.4 已經落地的委派存檔會被刪除，不是留成永久孤兒', () => {
    const b = bed()
    b.scan()

    // 模擬「排除生效之前就落地的一份存檔」：直接寫進 rows/ 底下。
    // **只擋來源迴圈救不了它** —— 呈現走 readArchive()，而孤兒政策是原地保留。
    const dirName = `-home-someone--config-spekterm-dev${DELEGATE_SUFFIX}`
    const stale = path.join(b.archiveRoot, 'rows', dirName, 'stale.ndjson')
    mkdirSync(path.dirname(stale), { recursive: true })
    writeFileSync(
      stale,
      [
        JSON.stringify({ v: 1, src: `${dirName}/stale.jsonl`, p: dirName, s: 'stale', cwds: [], size: 1, mtime: 1, stats: { userTextBlocks: 1, nonUserInput: 0, malformed: 0 } }),
        JSON.stringify({ k: 'msg', t: 1, s: 'stale', p: dirName, text: '這一則不該被算成我說的話' }),
      ].join('\n') + '\n',
    )
    assert.ok(allRows(b.archiveRoot).some((r) => r.p === dirName), '前置：那份存檔確實在')

    const r = b.scan()
    assert.equal(r.purged, 1, '應被刪除的既有存檔數')
    assert.ok(!allRows(b.archiveRoot).some((r2) => r2.p === dirName), '刪除後不得再出現在存檔裡')
    assert.equal(r.orphaned, 0, '被刪除的不得同時被計為孤兒')
  })

  it('4.9 來源目錄不存在：掃描完成，狀態指出來源不可用', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'spekterm-archive-none-'))
    roots.push(root)
    const r = scanTranscripts({
      projectsDir: path.join(root, 'does-not-exist', 'projects'),
      archiveRoot: path.join(root, 'archive'),
      excludeDirSuffix: DELEGATE_SUFFIX,
    })
    assert.equal(r.status, 'source-unavailable')
    assert.equal(r.rows, 0)
  })

  it('4.9 來源可用但沒有資料：狀態是 ok，與「不可用」可區分', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'spekterm-archive-empty-'))
    roots.push(root)
    const projectsDir = path.join(root, 'source', 'projects')
    mkdirSync(projectsDir, { recursive: true })
    const r = scanTranscripts({ projectsDir, archiveRoot: path.join(root, 'archive'), excludeDirSuffix: DELEGATE_SUFFIX })
    assert.equal(r.status, 'ok', '空目錄不是「不可用」—— 兩者的處置完全不同')
    assert.equal(r.rows, 0)
    assert.equal(r.scanned, 0)
  })

  it('4.9 個別檔案讀不到：掃描完成，其餘照樣被萃取', () => {
    const b = bed()
    const rel = path.join(b.facts.projects[0].dirName, 'session-1.jsonl')
    const src = path.join(b.facts.projectsDir, rel)
    if (process.platform === 'win32') return
    chmodSync(src, 0o000)
    try {
      const r = b.scan()
      assert.equal(r.status, 'ok')
      assert.equal(r.unreadable, 1)
      assert.equal(r.scanned, 3, '其餘三份照樣被萃取')
    } finally {
      chmodSync(src, 0o600)
    }
  })

  it('mtime 相同但大小不同時仍會重讀（只比 mtime 會漏掉）', () => {
    const b = bed()
    b.scan()
    const rel = path.join(b.facts.projects[0].dirName, 'session-2.jsonl')
    const src = path.join(b.facts.projectsDir, rel)
    const archiveFile = path.join(b.archiveRoot, 'rows', archivePathFor(rel))

    const before = readArchiveFile(b.archiveRoot, archivePathFor(rel))
    assert.ok(before)
    appendFileSync(src, `${JSON.stringify({ type: 'user', timestamp: '2026-02-02T00:00:00.000Z', cwd: b.facts.projects[0].cwd, message: { role: 'user', content: [{ type: 'text', text: '大小變了' }] } })}\n`)

    // 造出「mtime 相同、size 不同」的狀態。
    //
    // **不要用 `utimesSync` 去把檔案的 mtime 改回舊值** —— 它收的是秒的浮點數，
    // 檔案系統存的是奈秒，回讀時可能落在目標值下方 1 奈秒。實測那樣寫這條測試會
    // 時綠時紅（六次裡四次紅），而症狀是差 1 毫秒。
    // 改成把**存檔記下的 mtime** 對齊檔案當下的值，size 留舊的：這才精確表達要驗的那件事。
    const lines = readFileSync(archiveFile, 'utf8').split('\n')
    const header = JSON.parse(lines[0]) as Record<string, unknown>
    header.mtime = statSync(src).mtimeMs
    writeFileSync(archiveFile, [JSON.stringify(header), ...lines.slice(1)].join('\n'))

    const patched = readArchiveFile(b.archiveRoot, archivePathFor(rel))
    assert.equal(patched?.header.mtime, statSync(src).mtimeMs, '前提沒成立：mtime 並未相同')
    assert.notEqual(patched?.header.size, statSync(src).size, '前提沒成立：size 應當不同')

    const r = b.scan()
    assert.equal(r.scanned, 1, '只比 mtime 的實作會把這次追加整段吃掉')
    const after = readArchiveFile(b.archiveRoot, archivePathFor(rel))
    assert.ok(after?.rows.some((row) => row.k === 'msg' && row.text === '大小變了'))
  })

  it('存檔自我描述，索引可完全由它重建', () => {
    const b = bed()
    b.scan()
    for (const entry of readArchive(b.archiveRoot)) {
      assert.ok(entry.header.src.endsWith('.jsonl'))
      assert.ok(entry.header.p.length > 0)
      assert.ok(entry.header.s.length > 0)
      assert.ok(entry.header.size >= 0 && entry.header.mtime >= 0)
    }
    // 沒有另一份索引檔 —— 存檔本身就是權威。
    assert.deepEqual(readdirSync(b.archiveRoot), ['rows'])
  })
})
