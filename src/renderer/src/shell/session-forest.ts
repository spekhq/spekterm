/**
 * rail 上的 session 樹 —— **「順序 ＋ 關係」的純投影**（`handoff-lineage` design D4）。
 *
 * 一個 rail 項目的 session 只有**一份**順序（分頁列與 rail 共用，`workspace-layout`）。分頁列把它
 * 扁平地畫出來；rail 把它投影成樹：節點的母節點是它的交接來源，**但只在來源存在、而且屬於同一個
 * rail 項目時**；否則它是根。兄弟之間的次序取自那份順序中的相對位置。
 *
 * **這個模組獨立出來，是為了讓換算可被單元測試** —— 與 `rail-rows.ts` 同一個理由：這個 repo 在
 * 同一族的索引換算上已經栽過好幾次（拖曳落點差一格），而整塊移動會把差一格放大成整塊的長度。
 */

/** 縮排的深度上限。超過者以這一層呈現 —— rail 的寬度有下限，無上限的縮排會把標籤擠到看不見。 */
export const MAX_INDENT_DEPTH = 3

export interface ForestItem {
  id: string
  /** 交接來源的 session 識別碼（沒有來源時缺席）。 */
  parentId?: string
}

export interface ForestRow {
  id: string
  /** 顯示用的深度（已截斷於 `MAX_INDENT_DEPTH`）。 */
  depth: number
}

export interface Forest {
  /** 依 DFS 攤平、帶顯示深度的列。 */
  rows: ForestRow[]
  /** 每個節點在樹上的母節點（根沒有）。 */
  parentOf: Map<string, string>
  /** 每個節點的子節點（依順序）。根的「母節點」以 `ROOT` 表示。 */
  childrenOf: Map<string, string[]>
}

/** 頂層那一組兄弟的鍵。 */
export const ROOT = ''

/**
 * 建樹。
 *
 * @param items 這個 rail 項目的 session，**依單一順序**。
 * @param present 可以當母節點的 session（存在、且屬於這個 rail 項目）。不在其中的來源一律視為不在。
 */
export function buildForest(items: readonly ForestItem[], present: ReadonlySet<string>): Forest {
  const ids = new Set(items.map((item) => item.id))
  const declared = new Map<string, string>()
  for (const item of items) {
    // 自指（持久化的內容不受信任）當成根。
    if (item.parentId && item.parentId !== item.id && ids.has(item.parentId) && present.has(item.parentId)) {
      declared.set(item.id, item.parentId)
    }
  }

  // **環上的節點一律為根**（`session-lineage`「損毀的關係不使 session 從 rail 消失」）—— 否則環上
  // 沒有任何一個是根，DFS 從根出發永遠走不到它們，它們就靜默地不被呈現。
  const parentOf = new Map<string, string>()
  for (const item of items) {
    const seen = new Set<string>([item.id])
    let cursor = declared.get(item.id)
    let cyclic = false
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        cyclic = true
        break
      }
      seen.add(cursor)
      cursor = declared.get(cursor)
    }
    const parent = declared.get(item.id)
    if (parent !== undefined && !cyclic) parentOf.set(item.id, parent)
  }

  const childrenOf = new Map<string, string[]>([[ROOT, []]])
  for (const item of items) {
    const key = parentOf.get(item.id) ?? ROOT
    const list = childrenOf.get(key) ?? []
    list.push(item.id)
    childrenOf.set(key, list)
  }

  const rows: ForestRow[] = []
  const visit = (id: string, depth: number): void => {
    rows.push({ id, depth: Math.min(depth, MAX_INDENT_DEPTH) })
    for (const child of childrenOf.get(id) ?? []) visit(child, depth + 1)
  }
  for (const root of childrenOf.get(ROOT) ?? []) visit(root, 0)

  return { rows, parentOf, childrenOf }
}

/** 一個節點連同它所有子孫（DFS 次序）。 */
export function blockOf(forest: Forest, id: string): string[] {
  const out: string[] = []
  const visit = (node: string): void => {
    out.push(node)
    for (const child of forest.childrenOf.get(node) ?? []) visit(child)
  }
  visit(id)
  return out
}

/** 一個節點所在的那一組兄弟（依順序）。 */
export function siblingsOf(forest: Forest, id: string): string[] {
  return forest.childrenOf.get(forest.parentOf.get(id) ?? ROOT) ?? []
}

/**
 * rail 上的整塊移動，換算回單一順序。
 *
 * `from` 與 `to` 是**兄弟之間**的序位，語意與 `useDragReorder` 的 `onCommit` 相同（先移除、再插入
 * 之後的目標序位）。被移動的是**那個兄弟連同它的子孫**；那一組兄弟的所有整塊在單一順序中原本
 * 佔據的位置不變，只是依新的兄弟次序重新填入 —— 其餘 session（別組的、別的 rail 項目的）一個都不動。
 * 塊內的次序一律是 DFS（分頁列可能曾把子孫拖到母節點之前；經 rail 搬過一次就收斂回來）。
 */
export function moveBlock(order: readonly string[], forest: Forest, siblings: readonly string[], from: number, to: number): string[] {
  if (from === to || from < 0 || from >= siblings.length || to < 0 || to >= siblings.length) return [...order]
  const next = [...siblings]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)

  const sequence = next.flatMap((sibling) => blockOf(forest, sibling))
  const members = new Set(sequence)
  const result = [...order]
  let cursor = 0
  for (let index = 0; index < result.length; index += 1) {
    if (members.has(result[index])) {
      result[index] = sequence[cursor]
      cursor += 1
    }
  }
  return result
}

/**
 * 新的子 session 要插在單一順序中的哪個序位（`workspace-layout`）：「母 session 與它所有子孫」裡
 * **位置最後的那一個**之後。以「最後一個子孫」為準的話，分頁列曾把子孫拖到母節點之前時，新的
 * session 會落在母節點之前。
 */
export function childInsertIndex(order: readonly string[], forest: Forest, parentId: string): number {
  const block = new Set(blockOf(forest, parentId))
  let last = -1
  order.forEach((id, index) => {
    if (block.has(id)) last = index
  })
  return last === -1 ? order.length : last + 1
}
