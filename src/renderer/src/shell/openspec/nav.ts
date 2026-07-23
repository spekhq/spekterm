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

function segmentsOf(relPath: string): string[] {
  return relPath.split('/').filter((segment) => segment !== '')
}

/** `segments` 是否落在 `root` 之下 —— **逐段比對，不是字串前綴**（見 `targetOfPath`）。 */
function isUnder(segments: readonly string[], root: readonly string[]): boolean {
  return root.every((expected, index) => segments[index] === expected)
}

/**
 * 一個工作目錄**之內**的相對路徑 → 它代表的 spec 或 change。
 *
 * 這是原本 `targetOfPath` 的全部內容；抽出來是因為現在要對每個工作目錄根各試一次。
 */
function structureOf(segments: readonly string[]): OpenSpecTarget | null {
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

/**
 * 由**某個工作目錄**的 `openspec/` 底下的檔案路徑，反推它屬於哪個 spec 或 change。
 *
 * `worktreeRoots` 是該 folder 所屬 repo 各工作目錄的 folder-relative 根（主行程供應）——
 * folder 自身是**空字串**，於是既有的 `openspec/…` 路徑仍走同一條規則，不是特例。
 * 不落在任何工作目錄的 `openspec/` 之下、或不符合已知結構的路徑回 `null`，呼叫端據此決定
 * 要不要顯示「View in OpenSpec」入口。
 *
 * **三個會靜默失敗的地方（全部實測，見 design D1／D7）：**
 *
 * 1. **逐一嘗試每個根，不是「挑最長的那個」就放棄。** 兩者在正常佈局下同解，但工作目錄開在
 *    病態位置時（例如 `<repo>/openspec/wt`），最長的那個剝出來可能不成立，而較短的成立。
 *    由長至短只是 tie-break（工作目錄可能巢狀，較深的才是它真正的歸屬）。
 * 2. **比對逐段進行，不可用 `relPath.startsWith(root)`。** 清單中兩個根互為字串前綴時
 *    （`…/wt` 與 `…/wt-a`），較短的會先命中並剝出 `-a/openspec/…` —— 首段不是 `openspec`，
 *    於是整條路徑被判為 `null`。這與 `fs-boundary.ts` 那條「用 `path.relative`、絕不用
 *    `startsWith`」同源。
 * 3. **剝根之後仍必須要求首段是 `openspec`。** 少了它，`docs/openspec/changes/x/…` 這種
 *    「結構相同但不在任何工作目錄的 openspec 底下」的檔案會被誤判 —— 而空字串是每個路徑的
 *    前綴，folder 自身那個根對**所有**路徑都命中，這條要求是唯一擋住它的東西。
 */
export function targetOfPath(
  relPath: string,
  worktreeRoots: readonly string[],
): OpenSpecTarget | null {
  const segments = segmentsOf(relPath)
  const roots = worktreeRoots
    .map(segmentsOf)
    .sort((a, b) => b.length - a.length)

  for (const root of roots) {
    if (!isUnder(segments, root)) continue
    const target = structureOf(segments.slice(root.length))
    if (target) return target
  }

  return null
}
