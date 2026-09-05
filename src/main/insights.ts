import { aggregate, type Insights } from './insights-aggregate'
import { ScanRunner, type WorkerHandle } from './insights-service'
import { readArchive } from './transcript-archive'

/**
 * 對話計量的服務層：掃描的觸發、狀態，以及把存檔聚合成畫面要的數字。
 *
 * **不 import `electron`。** 它在單元測試裡 import 不起來，而這一層的每一條規格
 * （來源可不可用、錯誤是碼不是句子、送出的東西不含路徑）都值得用單元測試釘住。
 * 需要 Electron 的只有兩件事：起一個 `utilityProcess`，以及註冊 IPC handler ——
 * 兩者都在 `ipc/insights.ts`。
 */

export type InsightsPhase = 'idle' | 'running' | 'failed'

export interface InsightsSnapshot {
  phase: InsightsPhase
  /** 來源是否可用。`null` 表示還沒掃過。 */
  sourceAvailable: boolean | null
  /** 錯誤碼（不是文案）。 */
  error: string | null
  insights: Insights | null
}

export interface InsightsDeps {
  projectsDir: () => string
  archiveRoot: () => string
  /**
   * 怎麼起一個掃描行程。**這一層刻意不知道 `utilityProcess` 的存在** ——
   * 它管的是「一個會送訊息、會結束的東西」，而 `electron` 在單元測試裡 import 不起來。
   * 產品的實作在 `ipc/insights.ts`。
   */
  spawn: () => WorkerHandle
}

export function createInsightsService(deps: InsightsDeps) {
  const runner = new ScanRunner({ spawn: deps.spawn })
  let sourceAvailable: boolean | null = null

  const snapshot = (range?: { from?: number; to?: number }): InsightsSnapshot => {
    const status = runner.status()
    const entries = readArchive(deps.archiveRoot())
    const rows = entries.flatMap((e) => e.rows)
    const projects = new Map<string, string[]>()
    const stats = { userTextBlocks: 0, nonUserInput: 0 }
    for (const entry of entries) {
      const acc = projects.get(entry.header.p) ?? []
      for (const cwd of entry.header.cwds) if (!acc.includes(cwd)) acc.push(cwd)
      projects.set(entry.header.p, acc)
      stats.userTextBlocks += entry.header.stats.userTextBlocks
      stats.nonUserInput += entry.header.stats.nonUserInput
    }
    return {
      phase: status.phase,
      sourceAvailable,
      error: status.error,
      insights: rows.length
        ? aggregate(rows, {
            projects: [...projects].map(([dirName, cwds]) => ({ dirName, cwds })),
            stats,
            from: range?.from,
            to: range?.to,
          })
        : null,
    }
  }

  const refresh = async (range?: { from?: number; to?: number }): Promise<InsightsSnapshot> => {
    const outcome = await runner.run({ projectsDir: deps.projectsDir(), archiveRoot: deps.archiveRoot() })
    if (outcome.ok && outcome.result) sourceAvailable = outcome.result.status === 'ok'
    return snapshot(range)
  }

  return { snapshot, refresh, status: () => runner.status() }
}

export type InsightsService = ReturnType<typeof createInsightsService>
