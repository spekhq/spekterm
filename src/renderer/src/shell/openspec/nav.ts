/**
 * side panel 兩個身分之間的交叉導覽（design D7）。
 *
 * side panel 一次只顯示一個身分，所以「從 spec 跳到它的 `.md` 檔」必然是一次**跨身分**的
 * 導航。兩個方向各有一個請求型別，都由 `MainStage` 承接 —— 它是 `PanelIdentity` 的擁有者。
 */

/** OpenSpec 身分中的一個目標。 */
export type OpenSpecTarget =
  | { kind: 'change'; slug: string }
  | { kind: 'spec'; topic: string }

/**
 * 請求帶著 `nonce`：使用者可能連續兩次要求跳到**同一個**目標（跳過去、切回來、再跳過去）。
 * 沒有 nonce 的話，第二次的 prop 與第一次全等，effect 不會再跑一次。
 */
export interface Request<T> {
  target: T
  nonce: number
}

export type OpenSpecRequest = Request<OpenSpecTarget>
export type FileRequest = Request<string>

/**
 * 由 `openspec/` 底下的檔案路徑反推它屬於哪個 spec 或 change。
 *
 * 不在 `openspec/` 之下、或不符合任何已知結構的路徑回 `null` —— 呼叫端據此決定要不要顯示
 * 「在 OpenSpec 中檢視」的入口。
 */
export function targetOfPath(relPath: string): OpenSpecTarget | null {
  const segments = relPath.split('/').filter((segment) => segment !== '')
  if (segments[0] !== 'openspec') return null

  // openspec/specs/<topic>/spec.md
  if (segments[1] === 'specs' && segments.length >= 3) {
    return { kind: 'spec', topic: segments[2] }
  }

  if (segments[1] === 'changes' && segments.length >= 3) {
    // openspec/changes/archive/<slug>/…
    if (segments[2] === 'archive') {
      return segments.length >= 4 ? { kind: 'change', slug: segments[3] } : null
    }
    // openspec/changes/<slug>/…
    return { kind: 'change', slug: segments[2] }
  }

  return null
}
