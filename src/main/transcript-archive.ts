import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, type Dirent } from 'node:fs'
import path from 'node:path'

import { extractRows, type ArchiveRow, type ExtractStats } from './transcript-extract'

/**
 * 存檔的讀寫與增量掃描。
 *
 * ## 一個來源檔案一份存檔，路徑結構原樣鏡射
 *
 * 增量的單位是來源檔案，**存檔的單位因此也是來源檔案** —— 於是「重掃某個檔案」就是「覆寫對應的
 * 那一份」，而規格要求的「增量結果 SHALL 與全掃相同」在結構上成立，不必靠測試去釘。
 *
 * 其他候選都有一個沒有結構保證的不變式要維護：單一 append-only 大檔在重掃一個被改寫過的來源時
 * 舊列還留在裡面（只能靠寫入時去重補救）；按月分檔則因為 session 會跨月，「重掃一個檔案」要動到
 * 兩個月份檔。
 *
 * ## 每一份存檔自我描述，索引只是快取
 *
 * 每份存檔的第一行是 header（來源相對路徑、專案、session、出現過的 cwd、統計、來源當時的
 * size/mtime），其後是列。**於是索引可以完全由存檔本身重建** —— 索引損毀的代價是一次重掃，
 * 不是資料。
 *
 * 這條是承重的：存檔要保存**來源已經被刪除**的紀錄（來源預設只留 30 天，而那正是這個能力存在的
 * 理由）。若索引是唯一知道「有哪些存檔」的地方，索引一毀，那些沒有來源可對照的存檔就從此不會
 * 再被讀到 —— 資料還在磁碟上，但等於沒了。
 *
 * ## digest 先 stat 再讀
 *
 * 反過來（先讀、後 stat）會記下一個比實際讀到的還大的 size：該檔案之後若剛好不再成長
 * （session 就此結束），那一段列**永遠補不回來**，而來源 30 天後就被刪了。窗口很窄，
 * 但它丟掉的東西不可逆。
 */

const ARCHIVE_VERSION = 1
const ROWS_DIR = 'rows'
const SOURCE_EXT = '.jsonl'
const ARCHIVE_EXT = '.ndjson'
const DIR_MODE = 0o700
const FILE_MODE = 0o600

/** 存檔第一行的自我描述。 */
export interface ArchiveHeader {
  v: number
  /** 來源相對於 `projects/` 的路徑。 */
  src: string
  /** 來源目錄名。 */
  p: string
  /** session 識別。 */
  s: string
  /** 來源出現過的 cwd，依出現順序。 */
  cwds: string[]
  /** 來源當時的大小與 mtime —— 增量判定的依據。 */
  size: number
  mtime: number
  stats: ExtractStats
}

export interface ArchiveEntry {
  header: ArchiveHeader
  rows: ArchiveRow[]
}

export type ScanStatus = 'ok' | 'source-unavailable'

export interface ScanResult {
  status: ScanStatus
  /** 實際重讀並重寫的來源檔案數。 */
  scanned: number
  /** 因未變更而略過的來源檔案數。 */
  skipped: number
  /** 讀取失敗的來源檔案數（掃描仍完成）。 */
  unreadable: number
  /** 存檔中存在、但來源已消失的檔案數 —— 它們原地保留。 */
  orphaned: number
  /** 存檔中的列總數（含來源已消失者）。 */
  rows: number
  stats: ExtractStats
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function emptyStats(): ExtractStats {
  return { userTextBlocks: 0, nonUserInput: 0, malformed: 0 }
}

function addStats(into: ExtractStats, from: ExtractStats): void {
  into.userTextBlocks += from.userTextBlocks
  into.nonUserInput += from.nonUserInput
  into.malformed += from.malformed
}

/** 列出目錄樹裡符合副檔名的檔案，回傳相對於 `root` 的路徑。 */
function listFiles(root: string, ext: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith(ext)) out.push(path.relative(root, full))
    }
  }
  walk(root)
  return out.sort()
}

/** 來源相對路徑 → 存檔相對路徑。結構原樣鏡射，只換副檔名。 */
export function archivePathFor(sourceRel: string): string {
  return `${sourceRel.slice(0, -SOURCE_EXT.length)}${ARCHIVE_EXT}`
}

function parseHeader(line: string): ArchiveHeader | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(raw) || raw.v !== ARCHIVE_VERSION) return null
  if (typeof raw.src !== 'string' || typeof raw.p !== 'string' || typeof raw.s !== 'string') return null
  const cwds = Array.isArray(raw.cwds) ? raw.cwds.filter((c): c is string => typeof c === 'string') : []
  const stats = isRecord(raw.stats) ? raw.stats : {}
  return {
    v: ARCHIVE_VERSION,
    src: raw.src,
    p: raw.p,
    s: raw.s,
    cwds,
    size: typeof raw.size === 'number' ? raw.size : -1,
    mtime: typeof raw.mtime === 'number' ? raw.mtime : -1,
    stats: {
      userTextBlocks: typeof stats.userTextBlocks === 'number' ? stats.userTextBlocks : 0,
      nonUserInput: typeof stats.nonUserInput === 'number' ? stats.nonUserInput : 0,
      malformed: typeof stats.malformed === 'number' ? stats.malformed : 0,
    },
  }
}

/**
 * 讀出存檔中的一份。**損毀時回傳 `null`** —— 呼叫端據此重新萃取（若來源還在）或略過。
 * 損毀只影響它自己，不使整次掃描失敗。
 */
export function readArchiveFile(archiveRoot: string, archiveRel: string): ArchiveEntry | null {
  let text: string
  try {
    text = readFileSync(path.join(archiveRoot, ROWS_DIR, archiveRel), 'utf8')
  } catch {
    return null
  }
  const lines = text.split('\n').filter((l) => l.trim())
  if (lines.length === 0) return null
  const header = parseHeader(lines[0])
  if (!header) return null
  const rows: ArchiveRow[] = []
  for (const line of lines.slice(1)) {
    try {
      const row = JSON.parse(line) as ArchiveRow
      rows.push(row)
    } catch {
      return null // 一列壞掉就整份重來 —— 半份存檔比沒有存檔更難察覺
    }
  }
  return { header, rows }
}

function writeArchiveFile(archiveRoot: string, archiveRel: string, entry: ArchiveEntry): void {
  const full = path.join(archiveRoot, ROWS_DIR, archiveRel)
  mkdirSync(path.dirname(full), { recursive: true, mode: DIR_MODE })
  const body = [JSON.stringify(entry.header), ...entry.rows.map((r) => JSON.stringify(r))].join('\n')
  // 先寫到同目錄的暫存檔再 rename —— app 在覆寫中途被結束是常態，而半份存檔不會自己說它壞了。
  const tmp = `${full}.tmp`
  writeFileSync(tmp, `${body}\n`, { mode: FILE_MODE })
  renameSync(tmp, full)
}

/** 讀出整份存檔。來源已消失的部分照樣在裡面 —— 那正是它存在的理由。 */
export function readArchive(archiveRoot: string): ArchiveEntry[] {
  const rowsRoot = path.join(archiveRoot, ROWS_DIR)
  const out: ArchiveEntry[] = []
  for (const rel of listFiles(rowsRoot, ARCHIVE_EXT)) {
    const entry = readArchiveFile(archiveRoot, rel)
    if (entry) out.push(entry)
  }
  return out
}

export interface ScanOptions {
  /** 來源根，即 `<設定目錄>/projects`。 */
  projectsDir: string
  /** 存檔根，位於 userData 之下。 */
  archiveRoot: string
}

/**
 * 掃描一次。未變更的來源檔案不重讀；來源已消失的存檔原地保留。
 *
 * 對同一份來源，**多次增量掃描的結果與一次從零全掃相同** —— 因為兩者對每個來源檔案做的事
 * 完全一樣（整份重新萃取、整份覆寫），差別只在跳過哪些。
 */
export function scanTranscripts(options: ScanOptions): ScanResult {
  const { projectsDir, archiveRoot } = options
  const result: ScanResult = {
    status: 'ok',
    scanned: 0,
    skipped: 0,
    unreadable: 0,
    orphaned: 0,
    rows: 0,
    stats: emptyStats(),
  }

  let sourceAvailable: boolean
  try {
    sourceAvailable = statSync(projectsDir).isDirectory()
  } catch {
    sourceAvailable = false
  }
  if (!sourceAvailable) {
    // 來源不可用與「來源可用但沒有資料」是兩種狀態：前者是設定問題，後者本來就沒東西看。
    // 把兩者都呈現為空白，會讓一個設定問題看起來像沒有東西可看。
    result.status = 'source-unavailable'
    const existing = readArchive(archiveRoot)
    result.orphaned = existing.length
    for (const entry of existing) {
      result.rows += entry.rows.length
      addStats(result.stats, entry.header.stats)
    }
    return result
  }

  mkdirSync(path.join(archiveRoot, ROWS_DIR), { recursive: true, mode: DIR_MODE })

  const sourceFiles = listFiles(projectsDir, SOURCE_EXT)
  const seen = new Set<string>()

  for (const rel of sourceFiles) {
    const archiveRel = archivePathFor(rel)
    seen.add(archiveRel)

    // **先 stat 再讀。** 反過來會記下比實際讀到的還大的 size，而那一段列永遠補不回來。
    let size: number
    let mtime: number
    try {
      const st = statSync(path.join(projectsDir, rel))
      size = st.size
      // 不做 `Math.floor` —— 那只丟掉次毫秒的資訊，換不到任何東西。
      // 兩次 stat 同一個未變更的檔案，浮點值本來就相同。
      mtime = st.mtimeMs
    } catch {
      result.unreadable += 1
      continue
    }

    const existing = readArchiveFile(archiveRoot, archiveRel)
    if (existing && existing.header.size === size && existing.header.mtime === mtime) {
      result.skipped += 1
      result.rows += existing.rows.length
      addStats(result.stats, existing.header.stats)
      continue
    }

    let text: string
    try {
      text = readFileSync(path.join(projectsDir, rel), 'utf8')
    } catch {
      result.unreadable += 1
      // 讀不到就沿用既有的存檔（若有）—— 一次讀取失敗不該讓已經存下來的東西消失。
      if (existing) {
        result.rows += existing.rows.length
        addStats(result.stats, existing.header.stats)
      }
      continue
    }

    const segments = rel.split(path.sep)
    const projectDir = segments[0]
    const base = segments[segments.length - 1]
    const extracted = extractRows(text.split('\n'), {
      sessionId: base.slice(0, -SOURCE_EXT.length),
      projectDir,
      isSubagent: segments.includes('subagents'),
    })

    writeArchiveFile(archiveRoot, archiveRel, {
      header: {
        v: ARCHIVE_VERSION,
        src: rel,
        p: projectDir,
        s: base.slice(0, -SOURCE_EXT.length),
        cwds: extracted.cwds,
        size,
        mtime,
        stats: extracted.stats,
      },
      rows: extracted.rows,
    })
    result.scanned += 1
    result.rows += extracted.rows.length
    addStats(result.stats, extracted.stats)
  }

  // 來源已消失的存檔：**什麼都不做**。以來源檔案為單位讓「保留」變成不必寫的程式碼，
  // 而不是一條「記得不要刪」的規則。
  for (const rel of listFiles(path.join(archiveRoot, ROWS_DIR), ARCHIVE_EXT)) {
    if (seen.has(rel)) continue
    const entry = readArchiveFile(archiveRoot, rel)
    if (!entry) continue
    result.orphaned += 1
    result.rows += entry.rows.length
    addStats(result.stats, entry.header.stats)
  }

  return result
}
