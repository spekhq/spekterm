import { scanOpenSpec } from '@spekjs/core'

/**
 * 主行程掃描一個 repo 後的摘要。
 * 刻意只留計數與 schema —— Phase 0 的職責是證明 core 可被主行程直接使用，
 * 完整結構的傳遞（IPC → renderer 側欄）屬後續 Phase。
 */
export interface ScanSummary {
  repoPath: string
  specCount: number
  activeChangeCount: number
  archivedChangeCount: number
  defaultSchema: string | null
}

/**
 * 直接呼叫 core 的掃描函式取得 OpenSpec 結構。
 *
 * 這就是 PRD §8.1 的核心論證：core 是純 Node.js 模組，主行程以行程內函式呼叫
 * 取得結果，不需要 HTTP server（`spek` 的 Web 版才需要）也不委派給外部行程。
 *
 * 這裡以解構取出四個欄位而非整包轉手：欄位若不存在，`.length` 會立刻拋錯，
 * 讓 core 的合約變動在啟動時就暴露，而不是靜靜地變成 `undefined`。
 */
export async function scanRepo(repoPath: string): Promise<ScanSummary> {
  const { specs, activeChanges, archivedChanges, defaultSchema } = await scanOpenSpec(repoPath)

  return {
    repoPath,
    specCount: specs.length,
    activeChangeCount: activeChanges.length,
    archivedChangeCount: archivedChanges.length,
    defaultSchema,
  }
}

/** 單行摘要，人可讀、腳本亦可解析。 */
export function formatScanSummary(summary: ScanSummary): string {
  const { repoPath, specCount, activeChangeCount, archivedChangeCount, defaultSchema } = summary

  return (
    `[openspec] scan ${repoPath}` +
    ` specs=${specCount}` +
    ` activeChanges=${activeChangeCount}` +
    ` archivedChanges=${archivedChangeCount}` +
    ` defaultSchema=${defaultSchema ?? '(none)'}`
  )
}
