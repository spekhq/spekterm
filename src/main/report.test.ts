import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { delegateDirSuffix, resolveDelegateCwd } from './insights-source'
import { buildCorpus, normalizeForMatch } from './report-corpus'
import { createReportService } from './report'
import { ReportRunner, delegateArgs, delegateEnv, parseClaims, parseDelegateOutput, type DelegateHandle } from './report-runner'
import { listReports, readReport } from './report-store'
import { verifyClaims, type RawClaim } from './report-verify'
import { scanTranscripts } from './transcript-archive'
import { writeTranscriptFixture } from './transcript-fixture.testkit'
import { encodeProjectDir, identifyProjects } from './transcript-project'
import type { ArchiveRow } from './transcript-extract'
import en from '../shared/i18n/en.json' with { type: 'json' }

const roots: string[] = []
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

// 目錄名必須真的是 cwd 的編碼 —— 反查不到時 label 會是 null（那是規格要的行為）。
const PROJ_CWD = '/fixture/proj'
const PROJ_DIR = encodeProjectDir(PROJ_CWD)
const msg = (t: number, text: string, p = PROJ_DIR): ArchiveRow => ({ k: 'msg', t, s: 's1', p, text })
const IDS = identifyProjects([{ dirName: PROJ_DIR, cwds: [PROJ_CWD] }])

/** 一個可控的替身委派。**真實委派不進驗收** —— 見規格「真實委派無自動化驗收載體」。 */
function fakeDelegate(opts: {
  stdout?: string
  exitCode?: number
  throwOnSpawn?: boolean
  never?: boolean
  /** 記下送出去的內容 —— 「報告吃已算好的數字」那條靠它。 */
  sent?: string[]
  /** 記下委派被起了幾次 —— 「切分頁／啟動不觸發委派」那條靠它。 */
  spawns?: { n: number }
  /**
   * 記下每一趟 `spawn` 收到的 `configDir`。
   *
   * **這是「傳給委派的值與刪除用的值同源」唯一的載體** —— 接線在 `index.ts`，
   * 那支 import electron，`node:test` 進不去。純函式層只證明得了「參數原樣回傳」。
   */
  configDirs?: (string | undefined)[]
}) {
  return (options: { configDir: string | undefined }): DelegateHandle => {
    if (opts.spawns) opts.spawns.n += 1
    opts.configDirs?.push(options.configDir)
    if (opts.throwOnSpawn) throw new Error('ENOENT')
    let onOut: ((c: string) => void) | null = null
    let onExit: ((c: number | null) => void) | null = null
    return {
      send: (input) => {
        opts.sent?.push(input)
        if (opts.never) return
        queueMicrotask(() => {
          if (opts.stdout) onOut?.(opts.stdout)
          onExit?.(opts.exitCode ?? 0)
        })
      },
      onStdout: (l) => (onOut = l),
      onExit: (l) => (onExit = l),
      onError: () => {},
      kill: () => {},
    }
  }
}

const ok = (claims: RawClaim[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    result: JSON.stringify({ claims }),
    is_error: false,
    subtype: 'success',
    session_id: 'ffffffff-0000-4000-8000-000000000000',
    total_cost_usd: 0.42,
    permission_denials: [],
    ...extra,
  })

describe('3.1 語料：自最舊端截斷，不抽樣', () => {
  const rows = [msg(1000, 'aaaa'), msg(2000, 'bbbb'), msg(3000, 'cccc'), msg(4000, 'dddd')]

  it('未超限時全收，涵蓋期間就是首尾', () => {
    const c = buildCorpus(rows)
    assert.equal(c.messages.length, 4)
    assert.equal(c.from, 1000)
    assert.equal(c.to, 4000)
    assert.equal(c.truncated, false)
  })

  it('超限時自最舊端截斷，涵蓋期間隨之縮小', () => {
    const c = buildCorpus(rows, { maxChars: 9 })
    assert.ok(c.truncated)
    assert.ok(c.from !== null && c.from > 1000, `截斷後的最舊一則要比未截斷的新：${c.from}`)
    assert.equal(c.to, 4000, '最新的一則必須留著')
    // **不是抽樣**：留下來的是連續的一段，而不是散落的幾則。
    const times = c.messages.map((m) => m.t)
    assert.deepEqual(times, [...times].sort((a, b) => a - b))
    assert.deepEqual(times, rows.map((r) => (r.k === 'msg' ? r.t : 0)).filter((t) => t >= times[0]))
  })
})

describe('3.2 正規化只有一個定義，兩側套用同一個', () => {
  it('語料含換行與全形空白，引用是收斂後的形式，仍然對得上', () => {
    const corpus = buildCorpus([msg(1, '把 A\n  改好，　然後跑 test')])
    const r = verifyClaims([{ claim: 'c', quote: '把 A 改好，　然後跑 test' }], corpus, IDS)
    assert.equal(r.claims.length, 1, '正規化兩側不一致的話這裡會是 0，而那會被包裝成「全部被丟棄」')
    assert.equal(r.discarded, 0)
  })

  it('normalizeForMatch 收斂連續空白並去頭尾', () => {
    assert.equal(normalizeForMatch('  a \n\t b  '), 'a b')
  })
})

describe('3.3 查證：找不到就丟棄，metadata 由存檔填', () => {
  const corpus = buildCorpus([msg(1000, '繼續', 'proj'), msg(2000, '把 A 改好'), msg(3000, '繼續')])

  it('引用不存在於語料的論斷被丟棄', () => {
    const r = verifyClaims([{ claim: '他很有禮貌', quote: '麻煩您撥冗處理' }], corpus, IDS)
    assert.deepEqual(r.claims, [])
    assert.equal(r.discarded, 1)
  })

  it('引用存在的論斷被保留', () => {
    const r = verifyClaims([{ claim: '他常說繼續', quote: '繼續' }], corpus, IDS)
    assert.equal(r.claims.length, 1)
    assert.equal(r.discarded, 0)
  })

  it('跨越兩則訊息邊界的引用不通過查證', () => {
    // 串接後的語料裡「繼續\n把 A 改好」找得到；以單一則為單位就找不到。
    const r = verifyClaims([{ claim: 'x', quote: '繼續 把 A 改好' }], corpus, IDS)
    assert.deepEqual(r.claims, [])
    assert.equal(r.discarded, 1)
  })

  it('命中多則時取最早的一則，並記錄則數', () => {
    const r = verifyClaims([{ claim: 'x', quote: '繼續' }], corpus, IDS)
    assert.equal(r.claims[0].occurrences, 2)
    assert.equal(r.claims[0].date, new Date(1000).toISOString().slice(0, 10).length === 10 ? r.claims[0].date : '')
    // 取的是 t=1000 那一則 —— 以本機日期呈現。
    const d = new Date(1000)
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    assert.equal(r.claims[0].date, expected)
  })

  it('委派提供的歸屬不被採信 —— 它根本沒有欄位可以提供', () => {
    const r = verifyClaims(
      [{ claim: 'x', quote: '把 A 改好', date: '1999-01-01', project: 'not-a-real-repo' } as RawClaim],
      corpus,
      IDS,
    )
    assert.equal(r.claims.length, 1)
    assert.notEqual(r.claims[0].date, '1999-01-01')
    assert.equal(r.claims[0].projectLabel, 'proj')
  })
})

describe('3.5 上限與順序', () => {
  it('先查證後截取：25 條進、8 條查不到 → 丟棄數是 8 不是 20', () => {
    const corpus = buildCorpus(Array.from({ length: 30 }, (_, i) => msg(1000 + i, `第 ${i} 句`)))
    const raw: RawClaim[] = [
      ...Array.from({ length: 17 }, (_, i) => ({ claim: `c${i}`, quote: `第 ${i} 句` })),
      ...Array.from({ length: 8 }, (_, i) => ({ claim: `bad${i}`, quote: `這句話不存在 ${i}` })),
    ]
    const r = verifyClaims(raw, corpus, IDS)
    assert.equal(r.discarded, 8, '丟棄數只計查證失敗，不含被 20 條上限截掉的')
    assert.equal(r.claims.length, 17)
  })

  it('超過 20 條時截取前 20，而丟棄數不因此膨脹', () => {
    const corpus = buildCorpus(Array.from({ length: 30 }, (_, i) => msg(1000 + i, `第 ${i} 句`)))
    const raw = Array.from({ length: 25 }, (_, i) => ({ claim: `c${i}`, quote: `第 ${i} 句` }))
    const r = verifyClaims(raw, corpus, IDS)
    assert.equal(r.claims.length, 20)
    assert.equal(r.discarded, 0)
  })

  it('引用超過 60 字元即丟棄', () => {
    const corpus = buildCorpus([msg(1, 'x'.repeat(150))])
    const r = verifyClaims([{ claim: 'c', quote: 'x'.repeat(61) }], corpus, IDS)
    assert.equal(r.claims.length, 0)
    assert.equal(r.discarded, 1)
  })

  it('長訊息不成為引用的來源 —— 否則前兩處的上限會被繞過', () => {
    // 一則 3,000 字元的訊息若可被引用，20 條各引 60 字元就把它重建了 1,200 字元出來。
    const corpus = buildCorpus([msg(1, `開頭${'長'.repeat(3000)}`)])
    const r = verifyClaims([{ claim: 'c', quote: '開頭' }], corpus, IDS)
    assert.equal(r.claims.length, 0, '取自超過 200 字元訊息的引用要被丟棄')
    assert.equal(r.discarded, 1)
  })
})

describe('3.7 / 3.8 委派的生命週期與解析', () => {
  it('單一併發：跑到一半再叫一次回 null，不排隊', async () => {
    const runner = new ReportRunner({ spawn: fakeDelegate({ never: true }), timeoutMs: 50 })
    const first = runner.run('x', { configDir: undefined })
    assert.equal(await runner.run('y', { configDir: undefined }), null)
    await first
  })

  it('逾時與成功可區分', async () => {
    const runner = new ReportRunner({ spawn: fakeDelegate({ never: true }), timeoutMs: 20 })
    assert.deepEqual(await runner.run('x', { configDir: undefined }), { ok: false, code: 'delegateTimeout' })
  })

  it('CLI 不存在', async () => {
    const runner = new ReportRunner({ spawn: fakeDelegate({ throwOnSpawn: true }) })
    assert.deepEqual(await runner.run('x', { configDir: undefined }), { ok: false, code: 'cliMissing' })
  })

  it('行程非零結束且無輸出 → delegateFailed', async () => {
    const runner = new ReportRunner({ spawn: fakeDelegate({ exitCode: 1 }), timeoutMs: 500 })
    assert.deepEqual(await runner.run('x', { configDir: undefined }), { ok: false, code: 'delegateFailed' })
  })

  it('權限拒絕紀錄非空 → toolUseAttempted（工具其實沒關掉唯一的訊號）', () => {
    const out = parseDelegateOutput(ok([], { permission_denials: [{ tool_name: 'Bash' }] }))
    assert.deepEqual(out, { ok: false, code: 'toolUseAttempted' })
  })

  it('is_error / subtype 非 success → delegateFailed', () => {
    assert.deepEqual(parseDelegateOutput(ok([], { is_error: true })), { ok: false, code: 'delegateFailed' })
    assert.deepEqual(parseDelegateOutput(ok([], { subtype: 'error_max_turns' })), { ok: false, code: 'delegateFailed' })
  })

  it('非 JSON 的輸出 → unparsableReply', () => {
    assert.deepEqual(parseDelegateOutput('not json at all'), { ok: false, code: 'unparsableReply' })
  })

  it('回覆包在 markdown 圍籬裡仍解析得出來', () => {
    const claims = parseClaims('```json\n{"claims":[{"claim":"a","quote":"b"}]}\n```')
    assert.deepEqual(claims, [{ claim: 'a', quote: 'b' }])
  })

  it('形狀不對的回覆 → null（整份失敗，不產半份）', () => {
    assert.equal(parseClaims('{"claims":[{"claim":"a"}]}'), null)
    assert.equal(parseClaims('nope'), null)
  })
})

// ── 服務層：走真實的存檔與檔案系統 ────────────────────────────────────────
function bed(stdout?: string, extra: Partial<Parameters<typeof createReportService>[0]> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'spekterm-report-'))
  roots.push(root)
  const userData = path.join(root, 'userData')
  const facts = writeTranscriptFixture(path.join(root, 'source'), resolveDelegateCwd(userData))
  const archiveRoot = path.join(root, 'archive')
  scanTranscripts({ projectsDir: facts.projectsDir, archiveRoot, excludeDirSuffix: delegateDirSuffix() })
  const reportsDir = path.join(userData, 'conversation-reports')
  const service = createReportService({
    archiveRoot: () => archiveRoot,
    configDir: () => ({ explicit: facts.configDir, resolved: facts.configDir }),
    delegateCwd: () => resolveDelegateCwd(userData),
    reportsDir: () => reportsDir,
    requestedModel: () => 'claude-sonnet-5',
    spawn: fakeDelegate({ stdout }),
    timeoutMs: 2000,
    ...extra,
  })
  return { root, facts, service, reportsDir, archiveRoot }
}

describe('報告的產生（服務層）', () => {
  it('未授權則不送出，也不產生報告', async () => {
    const b = bed(ok([{ claim: 'c', quote: '把 A 改好' }]))
    const r = await b.service.generate({ authorized: false })
    assert.deepEqual(r, { ok: false, code: 'notAuthorized' })
    assert.deepEqual(listReports(b.reportsDir), [])
  })

  it('3.6 報告不含來源目錄名（它是一個換過字元的絕對路徑）', async () => {
    const b = bed(ok([{ claim: 'c', quote: '把 A 改好' }]))
    const r = await b.service.generate({ authorized: true })
    assert.ok(r.ok, JSON.stringify(r))
    const dump = JSON.stringify(r.report)
    for (const p of b.facts.projects) {
      assert.ok(!dump.includes(p.dirName), `報告不得含來源目錄名：${p.dirName}`)
    }
    assert.ok(!dump.includes('/fixture/'), '不得含 cwd')
    for (const c of r.report.claims) assert.match(c.projectId, /^[0-9a-f]{8}$/)
  })

  it('3.13 報告記錄產生條件，且模型取自請求端', async () => {
    const b = bed(ok([{ claim: 'c', quote: '把 A 改好' }]))
    const r = await b.service.generate({ authorized: true })
    assert.ok(r.ok)
    assert.equal(r.report.requestedModel, 'claude-sonnet-5')
    assert.equal(r.report.costUsd, 0.42)
    assert.equal(typeof r.report.generatedAt, 'number')
    assert.equal(typeof r.report.messages, 'number')
    assert.equal(typeof r.report.discarded, 'number')
    assert.equal(typeof r.report.delegateRecordDeleted, 'boolean')
  })

  it('3.10 歷次並存，且權限僅限擁有者', async () => {
    let t = 1_000_000
    const b = bed(ok([{ claim: 'c', quote: '把 A 改好' }]), { now: () => (t += 1000) })
    await b.service.generate({ authorized: true })
    await b.service.generate({ authorized: true })
    const list = listReports(b.reportsDir)
    assert.equal(list.length, 2, '新報告不得覆蓋舊報告')
    assert.equal(list[0].generatedAt > list[1].generatedAt, true, '新到舊')
    assert.equal(statSync(b.reportsDir).mode & 0o777, 0o700)
    const first = readReport(b.reportsDir, `${list[0].generatedAt}.json`)
    assert.ok(first && first.claims.length > 0)
  })

  it('3.9 委派留下的紀錄被刪除，且結果記進報告', async () => {
    const b = bed(ok([{ claim: 'c', quote: '把 A 改好' }]))
    const delegateFile = path.join(
      b.facts.configDir,
      'projects',
      b.facts.delegateDirName ?? '',
      'ffffffff-0000-4000-8000-000000000000.jsonl',
    )
    // 前置：先造出那一份「語料的第二份副本」。
    const { writeFileSync } = await import('node:fs')
    writeFileSync(delegateFile, '{"type":"user"}\n')
    assert.ok(statSync(delegateFile).isFile(), '前置：檔案確實在')

    const r = await b.service.generate({ authorized: true })
    assert.ok(r.ok)
    assert.equal(r.report.delegateRecordDeleted, true)
    assert.throws(() => statSync(delegateFile), '刪除後不得還在')
  })

  it('3.11 全部論斷被丟棄與「成功但很短」可區分', async () => {
    const b = bed(ok([{ claim: 'c', quote: '這句話語料裡沒有' }]))
    const r = await b.service.generate({ authorized: true })
    assert.deepEqual(r, { ok: false, code: 'allClaimsDiscarded' })
    assert.deepEqual(listReports(b.reportsDir), [], '失敗不得留下半份報告')
  })

  it('3.8 解析失敗不產出半份報告', async () => {
    const b = bed(JSON.stringify({ result: 'I think you are great!', is_error: false, subtype: 'success', permission_denials: [] }))
    const r = await b.service.generate({ authorized: true })
    assert.deepEqual(r, { ok: false, code: 'unparsableReply' })
    assert.deepEqual(listReports(b.reportsDir), [])
  })

  it('3.12 失敗的回傳不含外部行程輸出的絕對路徑', async () => {
    const leak = '/home/someone/.claude/projects/-home-someone-secret/session.jsonl'
    const b = bed(`Traceback: cannot read ${leak}`)
    const r = await b.service.generate({ authorized: true })
    assert.equal(r.ok, false)
    assert.ok(!JSON.stringify(r).includes(leak), '錯誤碼裡沒有路徑可放')
    assert.ok(!JSON.stringify(r).includes('/home/'))
  })

  it('授權畫面的數字＝實際將送出的那一份', async () => {
    const b = bed(ok([]))
    const p = b.service.preview()
    const r = await b.service.generate({ authorized: true })
    assert.ok(r.ok)
    assert.equal(p.messages, r.report.messages)
    assert.equal(p.chars, r.report.chars)
    assert.equal(p.from, r.report.from)
    assert.equal(p.to, r.report.to)
    assert.equal(p.truncated, r.report.truncated)
  })

  it('語料超過上限時亦然 —— 那才是這條 scenario 的 WHEN', async () => {
    // **上面那條在 `truncated === false` 下比的是 `false === false`。** 該 scenario 的
    // WHEN 是「使用者要求的範圍其語料超過上限」，而 fixture 遠低於 600,000 字元的預設值 ——
    // 沒有這個旋鈕，那條斷言永遠落在規格不在乎的那一側。
    const b = bed(ok([]), { maxChars: 40 })
    const p = b.service.preview()
    assert.equal(p.truncated, true, '前置：這一份確實被截斷了')
    const r = await b.service.generate({ authorized: true })
    assert.ok(r.ok)
    assert.equal(r.report.truncated, true)
    assert.equal(p.messages, r.report.messages)
    assert.equal(p.chars, r.report.chars)
    assert.equal(p.from, r.report.from)
    assert.equal(p.to, r.report.to)
  })
})

describe('4.1 委派的參數與排除規則對得起來', () => {
  it('關閉工具、結構化輸出、非互動、記得下來的模型', () => {
    const args = delegateArgs('claude-sonnet-5')
    assert.ok(args.includes('-p'), '非互動模式')
    assert.equal(args[args.indexOf('--output-format') + 1], 'json')
    assert.equal(args[args.indexOf('--model') + 1], 'claude-sonnet-5')
    assert.equal(args[args.indexOf('--allowed-tools') + 1], '', '工具一律關閉')
  })

  it('跨兩端的等式：委派 cwd 編碼後，命中掃描實際使用的排除判定', () => {
    // **兩端讀同一個常數的斷言在結構上不可能紅。** 這裡走的是完整的一圈：
    // userData → resolveDelegateCwd（spawn 用的）→ encodeProjectDir（Claude Code 的規則）
    // → 是否被 delegateDirSuffix（掃描用的）命中。
    for (const userData of ['/home/me/.config/Spekterm', '/home/me/.config/spekterm-dev', '/tmp/probe-profile-xyz']) {
      const cwd = resolveDelegateCwd(userData)
      assert.ok(
        encodeProjectDir(cwd).endsWith(delegateDirSuffix()),
        `spawn 的 cwd 與掃描的排除規則漂移了：${cwd}`,
      )
    }
  })
})

describe('5.4 六種失敗在畫面上彼此可區分', () => {
  it('每個錯誤碼都有相異且非空的文案', () => {
    // **`t()` 對缺少的 key 回傳 key 字面**，畫面上會出現 `insights.report.error.xxx`，
    // 而型別檢查與探針都不會紅。這條守的就是那個。
    const codes = [
      'cliMissing', 'delegateFailed', 'delegateTimeout',
      'unparsableReply', 'allClaimsDiscarded', 'toolUseAttempted',
      'notAuthorized', 'busy', 'noData',
    ] as const
    const copy = en.insights.report.error as Record<string, string>
    const seen = new Set<string>()
    for (const code of codes) {
      const text = copy[code]
      assert.ok(text && text.length > 0, `缺少文案：${code}`)
      assert.ok(!seen.has(text), `文案重複，兩種失敗在畫面上分不出來：${code}`)
      seen.add(text)
    }
  })

  it('「全部被丟棄」的文案明說它不是一份空報告', () => {
    // 前者代表這趟完全沒有查證通過的內容，而它與一份短報告在畫面上長得一模一樣。
    assert.match(en.insights.report.error.allClaimsDiscarded, /not an empty reading/i)
  })
})

describe('對照表核對時補上的四條載體', () => {
  it('建立服務不觸發委派 —— 只有 generate 才會', async () => {
    // 一趟委派會產生實際費用。建立服務、列清單、看預覽都不得起它。
    const spawns = { n: 0 }
    const b = bed(undefined, { spawn: fakeDelegate({ stdout: ok([]), spawns }) })
    b.service.list()
    b.service.preview()
    assert.equal(spawns.n, 0, '建立、列清單、預覽都不得起委派')
    await b.service.generate({ authorized: true })
    assert.equal(spawns.n, 1, '只有 generate 才起它')
  })

  it('報告吃已算好的彙總數字，不叫委派自己重估', async () => {
    const sent: string[] = []
    const b = bed(undefined, { spawn: fakeDelegate({ stdout: ok([]), sent }) })
    await b.service.generate({ authorized: true })
    assert.equal(sent.length, 1)
    const prompt = sent[0]
    // 送出去的內容裡要帶著彙總量，且明說不要重數 —— 否則兩個分頁會各講各的數字。
    assert.match(prompt, /"userMessages":\s*\d+/)
    assert.match(prompt, /Do NOT recount/)
    // 而彙總量要等於儀表板同期間算出來的那一個。
    assert.ok(prompt.includes(`"userMessages":${b.facts.userMessages}`), prompt.slice(0, 400))
  })

  it('未授權時委派根本不會被起 —— 授權閘在最前面', async () => {
    const spawns = { n: 0 }
    const b = bed(undefined, { spawn: fakeDelegate({ stdout: ok([]), spawns }) })
    await b.service.generate({ authorized: false })
    assert.equal(spawns.n, 0, '未授權即不得有任何內容離開本機')
  })

  it('委派紀錄刪不掉時據實記錄，不謊報為已刪除', async () => {
    // `rmSync({ force: true })` 對不存在的路徑不拋錯 —— 只看它有沒有拋，
    // 「路徑一直算錯」會被回報成「刪掉了」，而那是每跑一趟就多留一份副本的那個情況。
    // 委派的 cwd 算錯 ⇒ 那個 session 的紀錄不在我們找的地方，而真正的那一份還躺著。
    const b = bed(ok([{ claim: 'c', quote: '把 A 改好' }]), { delegateCwd: () => '/nowhere/that/exists' })
    const r = await b.service.generate({ authorized: true })
    assert.ok(r.ok)
    assert.equal(r.report.delegateRecordDeleted, false, '找不到那一份就不得回報為已刪除')
  })
})

describe('4.2 委派的環境是白名單', () => {
  // **注入的集合分三類，缺一則對應的 scenario 沒有被驗到。**
  /** (a) 已知的憑證與計費歸屬變數。 */
  const CREDENTIALS = {
    ANTHROPIC_API_KEY: 'sk-not-a-real-key',
    ANTHROPIC_AUTH_TOKEN: 'bearer-not-real',
    ANTHROPIC_BASE_URL: 'https://gateway.invalid',
    ANTHROPIC_PROFILE: 'some-profile',
    CLAUDE_CODE_USE_BEDROCK: '1',
  }
  /** (b) 巢狀 Claude Code 的標記 —— 自一個 agent session 之內啟動時實測會有的那些。 */
  const NESTED = {
    CLAUDECODE: '1',
    CLAUDE_CODE_CHILD_SESSION: 'yes',
    CLAUDE_CODE_MESSAGING_SOCKET: '/run/user/1000/parent.sock',
    CLAUDE_CODE_MESSAGING_TOKEN: 'parent-token',
    CLAUDE_CODE_SESSION_ID: 'parent-session',
    CLAUDE_CODE_EXECPATH: '/opt/claude',
    CLAUDE_PID: '4242',
  }
  /**
   * (c) **白名單與任何合理的剝除清單「都沒有」的名字。**
   *
   * 少了這一類，白名單與「一份明確剝掉已知名字的剝除清單」對其餘輸入會產生**完全相同**
   * 的鍵集合 —— 於是 design D1 的整個論點（白名單 vs 剝除清單）根本沒有被驗到。
   * 最後兩個是**發明出來的**：「連今天還不存在的名字也擋得住」只有發明一個才驗得到。
   */
  const NEITHER = {
    TERM: 'xterm-256color',
    XDG_CONFIG_HOME: '/home/u/.config',
    NODE_OPTIONS: '--inspect',
    ANTHROPIC_FUTURE_CREDENTIAL_2027: 'invented-for-this-test',
    SPEKTERM_NOT_A_REAL_VARIABLE: 'invented-for-this-test',
  }
  /** 白名單上的東西，用來確認它們真的過得去。 */
  const ALLOWED = {
    HOME: '/home/u',
    PATH: '/usr/bin',
    CLAUDE_CODE_OAUTH_TOKEN: 'subscription-token',
    LANG: 'zh_TW.UTF-8',
    HTTPS_PROXY: 'http://proxy.internal:3128',
  }

  const build = (configDir: string | undefined = undefined, userEnvExtra: Record<string, string> = {}) =>
    delegateEnv({
      processEnv: { ...ALLOWED, ...CREDENTIALS, ...NESTED, ...NEITHER },
      // **兩條路徑都要放** —— 憑證可能來自主行程的環境，也可能來自使用者的 login shell。
      userEnv: { ...CREDENTIALS, ...NESTED, ...NEITHER, ...userEnvExtra },
      configDir,
    })

  it('輸出的鍵集合等於預期集合 —— 不是「不含這幾個名字」', () => {
    // **這個陣列是字面值，不是從實作 import 的常數。** 寫成 `[...ALLOWLIST, …]` 就是
    // 「兩端讀同一個常數」—— 往白名單加一個憑證名字照樣全綠。
    assert.deepEqual(Object.keys(build()).sort(), [
      'CLAUDE_CODE_OAUTH_TOKEN',
      'HOME',
      'HTTPS_PROXY',
      'LANG',
      'PATH',
    ])
  })

  it('已知的憑證與計費歸屬變數不進入委派', () => {
    const env = build()
    for (const key of Object.keys(CREDENTIALS)) assert.equal(env[key], undefined, key)
  })

  it('隸屬於某個 Claude Code session 的標記不進入委派', () => {
    const env = build()
    for (const key of Object.keys(NESTED)) assert.equal(env[key], undefined, key)
  })

  it('白名單與剝除清單皆未涵蓋的名字也不進入委派', () => {
    const env = build()
    for (const key of Object.keys(NEITHER)) assert.equal(env[key], undefined, key)
  })

  it('委派仍取得執行所需的環境（HOME / PATH）', () => {
    const env = build()
    assert.equal(env.HOME, '/home/u')
    assert.equal(env.PATH, '/usr/bin')
  })

  it('PATH 取 processEnv 那一份，userEnv 的不勝出', () => {
    // `getUserEnv()` 結構上不含 PATH，但這條釘住的是「就算有也不採用」——
    // `process.env.PATH` 是使用者路徑前置後的**超集**，讓原始版蓋回去會丟掉產物注入的項目。
    assert.equal(build(undefined, { PATH: '/should/not/win' }).PATH, '/usr/bin')
  })

  it('使用者自身訂閱登入的 token 仍然可用', () => {
    assert.equal(build().CLAUDE_CODE_OAUTH_TOKEN, 'subscription-token')
  })

  it('使用者未指定設定目錄時不傳入任何值', () => {
    // 環境裡**有**一個 CLAUDE_CONFIG_DIR（`NEITHER` 沒有它，這裡另外塞）也不得漏進去。
    const env = delegateEnv({
      processEnv: { ...ALLOWED, CLAUDE_CONFIG_DIR: '/from/process' },
      userEnv: { CLAUDE_CONFIG_DIR: '/from/shell' },
      configDir: undefined,
    })
    assert.equal(env.CLAUDE_CONFIG_DIR, undefined, '合成預設值會讓 claude 找不到既有設定')
  })

  it('明確指定時傳入該值，且環境裡的不同值不勝出', () => {
    const env = delegateEnv({
      processEnv: { ...ALLOWED, CLAUDE_CONFIG_DIR: '/from/process' },
      userEnv: { CLAUDE_CONFIG_DIR: '/from/shell' },
      configDir: '/resolved/once',
    })
    assert.equal(env.CLAUDE_CONFIG_DIR, '/resolved/once')
  })
})

describe('4.6 / 2.3 接縫與失敗路徑', () => {
  it('傳給委派的設定目錄＝服務用來刪紀錄的那一份（接線的唯一載體）', async () => {
    const configDirs: (string | undefined)[] = []
    const b = bed(ok([{ claim: 'c', quote: '把 A 改好' }]), { spawn: fakeDelegate({ stdout: ok([{ claim: 'c', quote: '把 A 改好' }]), configDirs }) })
    await b.service.generate({ authorized: true })
    assert.deepEqual(configDirs, [b.facts.configDir], 'spawn 收到的必須是同一次解析的結果')
  })

  it('委派失敗時同樣刪掉語料副本 —— 失敗路徑上根本拿不到 sessionId', async () => {
    const b = bed('not json at all')
    const dir = path.join(b.facts.configDir, 'projects', b.facts.delegateDirName ?? '')
    const leftover = path.join(dir, 'aaaaaaaa-0000-4000-8000-000000000000.jsonl')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(leftover, '{"type":"user"}\n')
    assert.ok(statSync(leftover).isFile(), '前置：那一份副本確實在')

    const r = await b.service.generate({ authorized: true })
    assert.equal(r.ok, false, '前置：這一趟確實失敗了')
    assert.throws(() => statSync(leftover), '失敗的那一趟同樣留下了紀錄，同樣要刪')
  })
})
