import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'

import { aggregate, type Insights } from './insights-aggregate'
import { buildCorpus, type Corpus } from './report-corpus'
import { ReportRunner, parseClaims, type DelegateHandle, type ReportErrorCode } from './report-runner'
import { listReports, readReport, reportsRoot, saveReport, type Report, type ReportMeta } from './report-store'
import { verifyClaims } from './report-verify'
import { readArchive } from './transcript-archive'
import { encodeProjectDir, identifyProjects } from './transcript-project'

/**
 * 質性讀後感的服務層。**不 import electron** —— 與 `insights.ts` 同一條理由。
 *
 * 這一層把五件事串起來：組語料、委派、解析、**查證**、落盤。其中只有查證是不可省的 ——
 * 其餘都是把資料搬來搬去，而查證是這份報告唯一能被檢查的部分。
 */

export interface ReportRequest {
  from?: number
  to?: number
  /** 使用者是否已針對**這一次**送出給予授權。未授權即不送。 */
  authorized: boolean
}

/** 授權畫面要看的東西 —— **數字是截斷之後、實際將送出的那一份**。 */
export interface ReportPreview {
  from: number | null
  to: number | null
  truncated: boolean
  messages: number
  chars: number
  projects: number
  requestedModel: string
}

export type GenerateResult =
  | { ok: true; report: Report }
  | { ok: false; code: ReportErrorCode | 'notAuthorized' | 'busy' | 'noData' }

export interface ReportDeps {
  archiveRoot: () => string
  /**
   * 設定目錄的**一次**解析（見 `insights-source.ts` 的 `configDirs`）。
   *
   * `resolved` 用來算出委派留下的紀錄在哪，`explicit` 是傳給委派的值（沒明確指定時為
   * `undefined`，那時就不傳）。**兩者必須來自同一次呼叫** —— 各自解析的話，委派會把一份
   * 含完整語料的紀錄寫在我們不會去刪的位置，而畫面上只顯示「刪不掉」。
   */
  configDir: () => { explicit: string | undefined; resolved: string }
  /** 委派的工作目錄。與掃描的排除規則同一個來源。 */
  delegateCwd: () => string
  reportsDir: () => string
  requestedModel: () => string
  spawn: (options: { configDir: string | undefined }) => DelegateHandle
  /** 語料上限。**開這個旋鈕是為了驗得到「超過上限」那條 scenario** —— 見 `report-corpus.ts`。 */
  maxChars?: number
  timeoutMs?: number
  now?: () => number
}

/**
 * 委派的提示。**以英文撰寫** —— 產品原始碼的字串字面值不得含 CJK（`copy-language.test.mjs`
 * 走 AST 擋著），而這不是 UI 文案，不進字典。
 *
 * 提示要求它**只挑句子**，不提供日期與專案 —— 那些由我們從存檔填。
 */
function buildPrompt(insights: Insights, model: string): string {
  void model
  const facts = {
    userMessages: insights.totals.messages,
    sessions: insights.totals.sessions,
    toolCalls: insights.totals.tools,
    interrupts: insights.totals.interrupts,
    sitDowns: insights.totals.sitDowns,
    medianMessageChars: insights.messageLength.median,
    medianSitDownMinutes: insights.sitDown.median,
    topProjects: insights.projects.slice(0, 5).map((p) => ({ project: p.label, messages: p.messages })),
    topBash: insights.bash.slice(0, 8),
    cues: insights.cues.map((c) => ({ cue: c.key, n: c.n })),
    cuesMatchedNothing: insights.cuesNone,
    language: insights.language,
  }
  return [
    'You are reading one person\'s own prompts to their coding agent, in chronological order.',
    'Below the instructions is the corpus: one message per line, oldest first.',
    '',
    'Here are metrics already computed from the same data. Explain and interpret these numbers.',
    'Do NOT recount or re-estimate them:',
    JSON.stringify(facts),
    '',
    'Write observations about HOW this person talks to their agent: habits, patterns, what they',
    'do when things go wrong, how their requests are shaped, what changes over time.',
    '',
    'Output STRICT JSON and nothing else, in this exact shape:',
    '{"claims":[{"claim":"<one observation>","quote":"<verbatim excerpt from ONE message>"}]}',
    '',
    'Rules you must follow:',
    '- Every claim MUST carry a quote copied VERBATIM from a single message in the corpus.',
    '- A quote must not span two messages. Do not paraphrase, translate, or trim mid-word.',
    '- Keep each quote under 60 characters. Prefer short, distinctive lines.',
    '- Do NOT state dates or project names; they are filled in from our own records.',
    '- At most 20 claims. Fewer, well-supported claims are better than many weak ones.',
    '- A claim whose quote cannot be found verbatim will be discarded.',
    '',
    'CORPUS:',
  ].join('\n')
}

export function createReportService(deps: ReportDeps) {
  const runner = new ReportRunner({ spawn: deps.spawn, timeoutMs: deps.timeoutMs })
  const now = deps.now ?? (() => Date.now())

  const load = (range?: { from?: number; to?: number }): { corpus: Corpus; insights: Insights; identities: ReturnType<typeof identifyProjects> } => {
    const entries = readArchive(deps.archiveRoot())
    const rows = entries.flatMap((e) => e.rows)
    const projects = new Map<string, string[]>()
    for (const entry of entries) {
      const acc = projects.get(entry.header.p) ?? []
      for (const cwd of entry.header.cwds) if (!acc.includes(cwd)) acc.push(cwd)
      projects.set(entry.header.p, acc)
    }
    const identities = identifyProjects([...projects].map(([dirName, cwds]) => ({ dirName, cwds })))
    const corpus = buildCorpus(rows, { ...range, maxChars: deps.maxChars })
    const insights = aggregate(rows, {
      from: corpus.from ?? undefined,
      to: corpus.to ?? undefined,
      projects: [...projects].map(([dirName, cwds]) => ({ dirName, cwds })),
    })
    return { corpus, insights, identities }
  }

  /** 授權畫面看的數字。**與實際送出的那一份是同一組** —— 見規格。 */
  const preview = (range?: { from?: number; to?: number }): ReportPreview => {
    const { corpus } = load(range)
    return {
      from: corpus.from,
      to: corpus.to,
      truncated: corpus.truncated,
      messages: corpus.messages.length,
      chars: corpus.chars,
      projects: corpus.projects,
      requestedModel: deps.requestedModel(),
    }
  }

  /**
   * 刪掉委派留下的紀錄 —— 它是語料的第二份副本，落在我們的權限控制之外。
   *
   * **以委派的專案目錄為單位，不依賴該趟的 `sessionId`。** 兩個理由：
   * 失敗的那一趟**照樣寫了紀錄**（實測：無憑證的 `-p` exit 1、`is_error: true`，
   * 紀錄仍然產生），而失敗路徑上 `RunOutcome` 根本拿不到 `sessionId` —— 逾時、
   * 回覆無法解析、憑證錯誤三條路都是。以目錄為單位一併涵蓋它們。
   * 這個目錄是本應用程式在 userData 底下管理的**專屬**工作目錄所對應的專案目錄，
   * 其中不會有其他來源的紀錄。
   *
   * **刪完要回頭確認那個目錄真的空了，不能只看 `rmSync` 有沒有拋錯。**
   * `force: true` 對不存在的路徑不拋錯，於是「路徑一直算錯」會回報成「刪掉了」——
   * 而那正是這個回傳值要能分辨的兩種情況裡比較危險的那一個（每跑一趟就多留一份副本，
   * 活 30 天，而畫面上一切正常）。
   */
  const deleteDelegateRecords = (configDir: string): boolean => {
    const dir = path.join(configDir, 'projects', encodeProjectDir(deps.delegateCwd()))
    // **先確認它真的在那裡。** `rmSync({ force: true })` 對不存在的路徑不拋錯，
    // 於是只看有沒有拋的話，「路徑一直算錯」會被回報成「刪掉了」—— 而那是兩種情況裡
    // 危險的那一個：每跑一趟就在別處多留一份副本，活 30 天，而畫面上一切正常。
    if (!existsSync(dir)) return false
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      return false
    }
    return !existsSync(dir)
  }

  const generate = async (request: ReportRequest): Promise<GenerateResult> => {
    // 未授權即不送 —— 這道閘在最前面，它之後才有任何內容離開本機。
    if (!request.authorized) return { ok: false, code: 'notAuthorized' }
    if (runner.running) return { ok: false, code: 'busy' }

    const { corpus, insights, identities } = load(request)
    if (corpus.messages.length === 0) return { ok: false, code: 'noData' }

    const model = deps.requestedModel()
    const input = `${buildPrompt(insights, model)}\n${corpus.messages.map((m) => m.norm).join('\n')}\n`

    // **設定目錄解析一次，兩個衍生值。** `explicit` 交給委派（沒明確指定時不傳），
    // `resolved` 用來刪紀錄 —— 兩者同源，分歧表達不出來。
    const { explicit, resolved } = deps.configDir()

    const run = await runner.run(input, { configDir: explicit })
    // **`busy` 要在刪除之前早退。** 那代表這一趟根本沒有起委派，而另一趟正在跑 ——
    // 刪下去會把**它的**紀錄一併清掉。
    if (run === null) return { ok: false, code: 'busy' }

    // **刪除在失敗的早退之前。** 失敗的那一趟同樣留下了一份完整語料的副本，活 30 天，
    // 而沒有任何其他程式碼會去刪它。
    const deleted = deleteDelegateRecords(resolved)
    if (!run.ok) return { ok: false, code: run.code }

    const raw = parseClaims(run.outcome.result)
    if (raw === null) return { ok: false, code: 'unparsableReply' }

    const { claims, discarded } = verifyClaims(raw, corpus, identities)
    // **「全部被丟棄」不可與「成功但沒什麼好說的」混為一談。** 前者代表這趟完全沒有查證通過
    // 的內容，而它與一份短報告在畫面上長得一模一樣。
    if (claims.length === 0 && raw.length > 0) return { ok: false, code: 'allClaimsDiscarded' }

    const report: Report = {
      generatedAt: now(),
      from: corpus.from,
      to: corpus.to,
      truncated: corpus.truncated,
      messages: corpus.messages.length,
      chars: corpus.chars,
      projects: corpus.projects,
      requestedModel: model,
      discarded,
      costUsd: run.outcome.costUsd,
      delegateRecordDeleted: deleted,
      claims,
    }
    saveReport(deps.reportsDir(), report)
    return { ok: true, report }
  }

  return {
    preview,
    generate,
    list: (): ReportMeta[] => listReports(deps.reportsDir()),
    read: (name: string): Report | null => readReport(deps.reportsDir(), name),
    get running(): boolean {
      return runner.running
    },
  }
}

export type ReportService = ReturnType<typeof createReportService>
export { reportsRoot }
