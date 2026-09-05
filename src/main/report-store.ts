import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { VerifiedClaim } from './report-verify'

/**
 * 報告的落盤與讀取。
 *
 * ## 歷次並存
 *
 * 一份會被下一份覆蓋的讀後感回答不了「三個月前的我跟現在差在哪」—— 而那正是質性讀法唯一
 * 有價值的地方。因此每一趟寫一份新檔，以產生時間命名。
 *
 * ## 權限與存檔相同
 *
 * 報告含使用者訊息的引用。理由與 `conversation-archive` 對存檔的要求一字不差。
 */

const DIR_MODE = 0o700
const FILE_MODE = 0o600
const REPORT_EXT = '.json'

export interface ReportMeta {
  /** 產生時間（epoch ms）。同時是檔名。 */
  generatedAt: number
  /** **實際**涵蓋的期間 —— 不是使用者要求的那一段。 */
  from: number | null
  to: number | null
  /** 語料是否因超過上限而被截斷。 */
  truncated: boolean
  /** 語料的則數與字元數。 */
  messages: number
  chars: number
  projects: number
  /**
   * **本應用程式請求的**模型。實際生效的可能因回退或設定而不同 ——
   * 把一個推測寫成事實，正是這份 metadata 要避免的東西。
   */
  requestedModel: string
  /** 查證失敗而被丟棄的條數。**這是這份報告可信度的指標，不得隱藏。** */
  discarded: number
  /** 該趟的費用。使用者按下按鈕時無法預估它。 */
  costUsd: number | null
  /**
   * 委派留下的紀錄有沒有被刪掉。
   *
   * 藏起來會讓「路徑一直算錯，每趟都留一份副本」與「偶爾刪不掉」在畫面上完全相同，
   * 而前者是一個持續累積的隱私問題。
   */
  delegateRecordDeleted: boolean
}

export interface Report extends ReportMeta {
  claims: VerifiedClaim[]
}

export function reportsRoot(userDataDir: string): string {
  return path.join(userDataDir, 'conversation-reports')
}

export function saveReport(root: string, report: Report): string {
  mkdirSync(root, { recursive: true, mode: DIR_MODE })
  const name = `${report.generatedAt}${REPORT_EXT}`
  const full = path.join(root, name)
  // 先寫暫存再 rename —— app 在寫入中途被結束是常態，而半份報告不會自己說它壞了。
  const tmp = `${full}.tmp`
  writeFileSync(tmp, `${JSON.stringify(report)}\n`, { mode: FILE_MODE })
  renameSync(tmp, full)
  return name
}

/** 依產生時間新到舊列出。壞掉的一份只影響它自己 —— 比照存檔的既有立場。 */
export function listReports(root: string): ReportMeta[] {
  let names: string[]
  try {
    names = readdirSync(root).filter((n) => n.endsWith(REPORT_EXT))
  } catch {
    return []
  }
  const out: ReportMeta[] = []
  for (const name of names) {
    const report = readReport(root, name)
    if (report) out.push(stripClaims(report))
  }
  return out.sort((a, b) => b.generatedAt - a.generatedAt)
}

export function readReport(root: string, name: string): Report | null {
  // 檔名只能是我們寫出去的那個形態 —— 它來自 renderer。
  if (!/^\d+\.json$/.test(name)) return null
  try {
    const raw = JSON.parse(readFileSync(path.join(root, name), 'utf8')) as Report
    if (typeof raw?.generatedAt !== 'number' || !Array.isArray(raw.claims)) return null
    return raw
  } catch {
    return null
  }
}

function stripClaims(report: Report): ReportMeta {
  const { claims: _claims, ...meta } = report
  return meta
}
