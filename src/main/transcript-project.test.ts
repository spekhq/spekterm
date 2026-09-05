import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after } from 'node:test'

import { extractRows } from './transcript-extract'
import { writeTranscriptFixture } from './transcript-fixture.testkit'
import { isWorktreeKey } from './worktree-key'
import { encodeProjectDir, findProjectRoot, identifyProjects } from './transcript-project'

const roots: string[] = []
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

describe('transcript 專案識別', () => {
  it('3.1 走 fixture 的真實路徑：cwd 由萃取收集，反查得到正確的專案名', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'spekterm-project-'))
    roots.push(root)
    const facts = writeTranscriptFixture(root)

    // 與掃描器一樣：逐份 transcript 萃取，把出現過的 cwd 依序併起來。
    const cwdsByProject = new Map<string, string[]>()
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) { walk(full); continue }
        if (!e.isFile() || !e.name.endsWith('.jsonl')) continue
        const rel = path.relative(facts.projectsDir, full)
        const dirName = rel.split(path.sep)[0]
        const { cwds } = extractRows(readFileSync(full, 'utf8').split('\n'), {
          sessionId: e.name.slice(0, -'.jsonl'.length),
          projectDir: dirName,
          isSubagent: rel.includes(`subagents${path.sep}`),
        })
        const acc = cwdsByProject.get(dirName) ?? []
        for (const c of cwds) if (!acc.includes(c)) acc.push(c)
        cwdsByProject.set(dirName, acc)
      }
    }
    walk(facts.projectsDir)

    const map = identifyProjects([...cwdsByProject].map(([dirName, cwds]) => ({ dirName, cwds })))
    for (const p of facts.projects) {
      assert.equal(map.get(p.dirName)?.label, p.label, `${p.dirName} 的名字反查錯了`)
      assert.ok(isWorktreeKey(map.get(p.dirName)?.id ?? ''))
    }
    // fixture 的 session 1 中途跑去 /tmp/scratchpad —— 那不該成為專案名。
    assert.ok(cwdsByProject.get(facts.projects[0].dirName)?.includes('/tmp/scratchpad'))
  })

  it('3.1 編碼規則：非英數字元一律換成 -', () => {
    assert.equal(encodeProjectDir('/home/me/git/spekterm'), '-home-me-git-spekterm')
    assert.equal(encodeProjectDir('/a/b_c.d'), '-a-b-c-d')
    assert.equal(encodeProjectDir('/家/專案'), '-----')
  })

  it('3.1 反查取「編碼後等於目錄名」的 cwd，不是最後一個', () => {
    const root = '/home/me/git/spekterm'
    const dirName = encodeProjectDir(root)
    // 真實形狀：session 中途 cd 到暫存目錄，最後停在子目錄。
    const cwds = [root, '/tmp/xyz/scratchpad', `${root}/openspec/changes/foo`]
    assert.equal(findProjectRoot(dirName, cwds), root)
    // 對照：取最後一個會得到子目錄，取「含目錄名前綴」也會誤中子目錄。
    assert.notEqual(cwds[cwds.length - 1], root)
  })

  it('3.1 編碼非單射時取最早出現的那一個', () => {
    // `/a/foo-bar` 與 `/a/foo/bar` 編碼後相同 —— 目錄名由起始 cwd 生成，而它必然最早出現。
    const a = '/a/foo-bar'
    const b = '/a/foo/bar'
    assert.equal(encodeProjectDir(a), encodeProjectDir(b))
    assert.equal(findProjectRoot(encodeProjectDir(a), [a, b]), a)
    assert.equal(findProjectRoot(encodeProjectDir(a), [b, a]), b)
  })

  it('3.2 識別碼是不可逆雜湊，且與 worktreeKey 同格式', () => {
    const dirName = encodeProjectDir('/home/me/git/spekterm')
    const [{ id }] = [...identifyProjects([{ dirName, cwds: [] }]).values()]
    assert.ok(isWorktreeKey(id), id)
    assert.ok(!id.includes('home'), '識別碼不得含路徑的任何片段')
    assert.ok(!id.includes('spekterm'))
    // 同一個目錄名每次結果相同，不同目錄名結果相異。
    const again = [...identifyProjects([{ dirName, cwds: [] }]).values()][0].id
    assert.equal(again, id)
    const other = [...identifyProjects([{ dirName: encodeProjectDir('/home/me/git/spek'), cwds: [] }]).values()][0].id
    assert.notEqual(other, id)
  })

  it('3.2 顯示名稱是專案根的 basename', () => {
    const root = '/home/me/git/spekterm'
    const dirName = encodeProjectDir(root)
    const got = identifyProjects([{ dirName, cwds: [root, '/tmp/scratch'] }]).get(dirName)
    assert.equal(got?.label, 'spekterm')
  })

  it('3.2 basename 撞名時以父層消歧', () => {
    const a = '/home/me/work/billing-service'
    const b = '/home/me/archive/billing-service'
    const c = '/home/me/git/spekterm'
    const map = identifyProjects([
      { dirName: encodeProjectDir(a), cwds: [a] },
      { dirName: encodeProjectDir(b), cwds: [b] },
      { dirName: encodeProjectDir(c), cwds: [c] },
    ])
    assert.equal(map.get(encodeProjectDir(a))?.label, 'work/billing-service')
    assert.equal(map.get(encodeProjectDir(b))?.label, 'archive/billing-service')
    // 沒有撞名的那一個不該被連累。
    assert.equal(map.get(encodeProjectDir(c))?.label, 'spekterm')
  })

  it('3.2 找不到相符的 cwd 時回傳 null，不猜', () => {
    const dirName = encodeProjectDir('/home/me/git/spekterm')
    // 只剩下無關的 cwd（例如記錄被裁切、或只剩沒有 cwd 的行）。
    const got = identifyProjects([{ dirName, cwds: ['/tmp/elsewhere'] }]).get(dirName)
    assert.equal(got?.label, null, '少一個名字，好過給一個錯的')
    assert.ok(isWorktreeKey(got?.id ?? ''), '識別碼仍然要有 —— 資料還是要歸屬得出去')
  })

  it('3.2 反查不到的專案不參與撞名消歧', () => {
    const a = '/home/me/work/x'
    const map = identifyProjects([
      { dirName: encodeProjectDir(a), cwds: [a] },
      { dirName: 'orphan-dir', cwds: [] },
    ])
    assert.equal(map.get(encodeProjectDir(a))?.label, 'x')
    assert.equal(map.get('orphan-dir')?.label, null)
  })
})
