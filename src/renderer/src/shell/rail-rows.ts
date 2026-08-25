/**
 * rail 拖曳的**列空間**與 folder 清單之間的換算。
 *
 * rail 上可命中的列 ＝ **folder ＋ 分界**（全域項目不算 —— 它不可拖曳、也不作為落點）：
 *
 * ```
 * row 0 … divider-1   置頂的 folder      folderIndex === row
 * row divider         分界（不是 folder）
 * row divider+1 …     未置頂的 folder    folderIndex === row - 1
 * ```
 *
 * **為什麼分界要佔一個真正的列**：只有這樣「置頂段的最後一格」與「其餘段的第一格」才各自
 * 到得了，兩個落點也才畫得出各自的插入指示線。連帶的好處是「有沒有移動」的判定留在列空間 ——
 * 一次**只改變置頂狀態、序位不變**的拖曳（把置頂段最後一個拖到分界之下）在列空間裡確實移動了
 * 一列，`useDragReorder` 既有的提交閘門因此放行；若以 folder 序位判定，它會被當成無操作而
 * **靜默丟失**。
 *
 * **這個模組獨立出來，是為了讓換算可被單元測試。** 這個 repo 在同一族的索引換算上已經栽過
 * 三次（拖曳落點、`Shift+↑`、`Shift+↓`），而每一次的失效都是靜默的。
 */

/** 被拖曳的那一列對應到哪一個 folder。分界本身不可拖曳，因此不會走到這裡。 */
export function rowToFolderIndex(row: number, divider: number): number {
  return row < divider ? row : row - 1
}

/** folder 的序位對應到哪一列。 */
export function folderIndexToRow(folderIndex: number, divider: number): number {
  return folderIndex < divider ? folderIndex : folderIndex + 1
}

export interface Placement {
  /** 移動後在 folder 清單中的序位。 */
  folderIndex: number
  /** 移動後的置頂狀態 —— 由落點推導，不是一個獨立的手勢。 */
  pinned: boolean
}

/**
 * 落點（列空間）→ `(folderIndex, pinned)`。
 *
 * `toRow` 是 `useDragReorder` 的 `onCommit` 交來的第二個參數，已是**移除被拖曳項目之後**的
 * 插入序位。分界在移除之後的位置因此可能前移一格。
 */
export function placeFromRow(fromRow: number, toRow: number, divider: number): Placement {
  const dividerAfterRemoval = divider - (fromRow < divider ? 1 : 0)
  const pinned = toRow <= dividerAfterRemoval
  return { folderIndex: pinned ? toRow : toRow - 1, pinned }
}

/**
 * 分界所在的列索引 ＝ 置頂的 folder 數。
 *
 * **推導也要集中在這裡，不只是換算。** 它有兩個呼叫端（rail 的拖曳、`Shift+↑↓`），而兩邊各自
 * 寫一次 `filter(...).length` 就是兩份會各自漂移的定義 —— `global-session` 明載這一族的換算
 * SHALL 集中於單一處。
 */
export function dividerRowOf(folders: readonly { pinned: boolean }[]): number {
  return folders.filter((folder) => folder.pinned).length
}
