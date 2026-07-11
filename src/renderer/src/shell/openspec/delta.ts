/**
 * delta spec 的解析。
 *
 * core 的 `ChangeArtifact`（`kind: 'specs'`）回的是**原始 markdown**，沒有結構化的 delta
 * 資訊。而側欄要呈現的是「這條 requirement 是新增的還是改的」——那個動作寫在 section 標題裡：
 *
 * ```
 * ## ADDED Requirements        ← verb 從這裡來
 * ### Requirement: <名稱>      ← 一條 requirement
 * #### Scenario: <名稱>
 * - **WHEN** …                 ← BDD 關鍵字是 markdown 的 strong，交給 MarkdownView 上色
 * ```
 *
 * 這是純字串處理：不碰 DOM、不碰 IPC，因此可以用 `node:test` 直接驅動。
 *
 * **格式不符預期時降級為原樣呈現**（`fallback`），不拋錯、不顯示空白 —— delta spec 的格式
 * 不是我們控制的（它屬於 OpenSpec），一個我們沒見過的寫法不該讓整個側欄空掉。
 */

export type DeltaVerb = 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED'

const VERBS: readonly DeltaVerb[] = ['ADDED', 'MODIFIED', 'REMOVED', 'RENAMED']

export interface DeltaRequirement {
  verb: DeltaVerb
  name: string
  /** requirement 的內文（不含 `### Requirement:` 那行），仍是 markdown。 */
  body: string
}

export interface ParsedDelta {
  requirements: DeltaRequirement[]
  /**
   * 解析不出任何 requirement 時的原始內容。
   *
   * `requirements` 非空時為 `null`。呈現層看到它就原樣渲染 markdown。
   */
  fallback: string | null
}

/** `## ADDED Requirements` → `ADDED`。認不得的 section 標題回 `null`。 */
function verbOf(line: string): DeltaVerb | null {
  const match = /^##\s+([A-Z]+)\s+Requirements\s*$/.exec(line)
  if (!match) return null
  const verb = match[1] as DeltaVerb
  return VERBS.includes(verb) ? verb : null
}

/** `### Requirement: 使用者可登入` → `使用者可登入`。 */
function requirementName(line: string): string | null {
  const match = /^###\s+Requirement:\s*(.+?)\s*$/.exec(line)
  return match ? match[1] : null
}

export function parseDelta(content: string): ParsedDelta {
  const requirements: DeltaRequirement[] = []

  let verb: DeltaVerb | null = null
  let name: string | null = null
  let body: string[] = []

  const flush = (): void => {
    if (verb === null || name === null) return
    requirements.push({ verb, name, body: body.join('\n').trim() })
    name = null
    body = []
  }

  for (const line of content.split('\n')) {
    const nextVerb = verbOf(line)
    if (nextVerb) {
      flush()
      verb = nextVerb
      continue
    }

    const nextName = requirementName(line)
    if (nextName !== null) {
      flush()
      // requirement 出現在任何 `## <VERB> Requirements` 之前 —— 格式不合預期，動作未知。
      // 不猜（猜錯會讓使用者以為某條是新增的，其實是刪除的），整份降級。
      if (verb === null) return { requirements: [], fallback: content }
      name = nextName
      continue
    }

    if (name !== null) body.push(line)
  }

  flush()

  if (requirements.length === 0) return { requirements: [], fallback: content }
  return { requirements, fallback: null }
}
