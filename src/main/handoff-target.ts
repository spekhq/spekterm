import path from 'node:path'

/** 查表的定義域。**它與告知 agent 的那份清單取自同一個來源**（見 `handoff-service`）。 */
export type TargetCandidate = { id: string; name: string; path: string }

export type TargetResult =
  | { ok: true; folderId: string }
  | { ok: false; reason: 'NOT_FOUND' }
  | { ok: false; reason: 'AMBIGUOUS'; candidates: string[] }

/**
 * 把 agent 寫下的目標解析為一個 workspace folder。
 *
 * **完整相等，不做模糊比對。** 這條路徑上沒有使用者在看 —— 一個「猜得很有把握」的結果會讓
 * session 開在他沒有指名的 repo 裡，而他不會知道。前綴、子字串、最接近者一律不算命中。
 *
 * **先名稱、再絕對路徑。** 顯示名稱取自路徑的最後一段，**同名是真實可達的**；絕對路徑因此是
 * 歧義唯一的脫困路徑，而那件事一定要寫進自我介紹 —— agent 收不到任何回饋，它不會自己想到
 * 換一種寫法。
 *
 * **告知 agent 的清單只是這份定義域在注入那一刻的快照。** 清單其後可能縮小，於是**零命中是
 * 一個可達的正常結果**，不是異常 —— 任何「agent 只會送出解得開的目標」的推論都不成立。
 */
export function resolveTarget(target: string, candidates: readonly TargetCandidate[]): TargetResult {
  const wanted = target.trim()
  if (wanted === '') return { ok: false, reason: 'NOT_FOUND' }

  const byName = candidates.filter((candidate) => candidate.name.toLowerCase() === wanted.toLowerCase())
  if (byName.length === 1) return { ok: true, folderId: byName[0].id }
  if (byName.length > 1) {
    return { ok: false, reason: 'AMBIGUOUS', candidates: byName.map((candidate) => candidate.path) }
  }

  // 路徑比對正規化尾端的分隔符，但**不**解析 symlink：定義域是 workspace 清單裡的字面路徑，
  // 而那正是自我介紹交給 agent 的那一份。
  const normalized = path.normalize(wanted).replace(/[/\\]+$/, '')
  const byPath = candidates.filter(
    (candidate) => path.normalize(candidate.path).replace(/[/\\]+$/, '') === normalized,
  )
  if (byPath.length === 1) return { ok: true, folderId: byPath[0].id }
  if (byPath.length > 1) {
    return { ok: false, reason: 'AMBIGUOUS', candidates: byPath.map((candidate) => candidate.path) }
  }

  return { ok: false, reason: 'NOT_FOUND' }
}
