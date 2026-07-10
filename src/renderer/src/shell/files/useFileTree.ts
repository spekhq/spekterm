import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DirEntry, DirEntryKind, FsFailure } from '../types'
import { ROOT_PATH, joinRelPath, parentOf } from './paths'

export interface TreeRow {
  relPath: string
  name: string
  kind: DirEntryKind
  mtimeMs: number
  depth: number
  expanded: boolean
  loading: boolean
  error: string | null
}

interface TreeState {
  children: Record<string, DirEntry[]>
  expanded: Record<string, true>
  loading: Record<string, true>
  errors: Record<string, string>
}

/** 根目錄自第一幀起就在載入中 —— 於初始狀態表達，而非在 effect 裡同步 setState。 */
function initialState(folderId: string | null): TreeState {
  return {
    children: {},
    expanded: {},
    loading: folderId ? { [ROOT_PATH]: true } : {},
    errors: {},
  }
}

/** 目錄優先、其次名稱 —— 與雛型一致（`packages/` 在 `CLAUDE.md` 之前）。 */
const collator = new Intl.Collator('zh-TW', { numeric: true, sensitivity: 'base' })

function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    const aIsDir = a.kind === 'directory'
    const bIsDir = b.kind === 'directory'
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
    return collator.compare(a.name, b.name)
  })
}

function describeFailure(failure: FsFailure): string {
  if (failure.code === 'ESCAPES_ROOT') return '超出 workspace 邊界，無法展開'
  if (failure.code === 'NOT_FOUND') return '已不存在'
  if (failure.code === 'FOLDER_UNAVAILABLE') return 'folder 路徑已失效'
  return failure.message
}

/** 只走「可見的」展開目錄 —— 祖先收合的子樹雖然仍在快取中，但不該被畫出來，也不該被監看。 */
function buildRows(state: TreeState, dir: string, depth: number, rows: TreeRow[]): void {
  const entries = state.children[dir]
  if (!entries) return

  for (const entry of sortEntries(entries)) {
    const relPath = joinRelPath(dir, entry.name)
    const expanded = Boolean(state.expanded[relPath])

    rows.push({
      relPath,
      name: entry.name,
      kind: entry.kind,
      mtimeMs: entry.mtimeMs,
      depth,
      expanded,
      loading: Boolean(state.loading[relPath]),
      error: state.errors[relPath] ?? null,
    })

    if (expanded) buildRows(state, relPath, depth + 1, rows)
  }
}

function collectWatchTargets(rows: TreeRow[]): string[] {
  // 監看集合恆等於「可見且已展開」的目錄集合，加上永遠展開的根目錄。
  const targets = [ROOT_PATH]
  for (const row of rows) {
    if (row.expanded) targets.push(row.relPath)
  }
  return targets
}

export interface FileTreeState {
  rows: TreeRow[]
  visibleCount: number
  rootLoading: boolean
  rootError: string | null
  /** 點一列。目錄展開／收合；檔案交給 `onOpenFile`；symlink 先試著當目錄。 */
  activate: (row: TreeRow) => void
}

/**
 * 呼叫端須以 `folderId` 為 key 掛載本 hook 的宿主元件 —— 換 folder 等於換一棵樹，
 * 讓 React 重新掛載比用 effect 把狀態清空乾淨（後者會多渲染一次，順序也難以推理）。
 */
export function useFileTree(
  folderId: string | null,
  onOpenFile: (relPath: string) => void,
): FileTreeState {
  const [state, setState] = useState<TreeState>(() => initialState(folderId))

  /** 同一目錄的載入不重複發出；載入期間又被要求重載時，結束後補跑一次。 */
  const inFlight = useRef(new Set<string>())
  const rerun = useRef(new Set<string>())
  const watched = useRef(new Set<string>())

  /**
   * 重新列出某個目錄。**本函式不設定「載入中」狀態** —— 那是呼叫端（事件處理器）的事。
   * 如此一來，從 effect 呼叫它時不會有任何同步的 setState，只有 await 之後的更新。
   */
  const loadDir = useCallback(
    async (relPath: string): Promise<void> => {
      if (!folderId) return
      if (inFlight.current.has(relPath)) {
        // 載入途中又被要求重載（例如 watcher 連續送來事件）——記下來，這一輪結束後補跑。
        rerun.current.add(relPath)
        return
      }

      inFlight.current.add(relPath)

      try {
        do {
          rerun.current.delete(relPath)
          const result = await window.workspace.fs.listDir(folderId, relPath)

          setState((current) => {
            const loading = { ...current.loading }
            delete loading[relPath]

            if (!result.ok) {
              // 展開失敗的目錄不該停在「展開中」的樣子 —— 收回它並把原因掛在該列上。
              const expanded = { ...current.expanded }
              delete expanded[relPath]
              return {
                ...current,
                loading,
                expanded,
                errors: { ...current.errors, [relPath]: describeFailure(result) },
              }
            }

            const errors = { ...current.errors }
            delete errors[relPath]
            return {
              ...current,
              loading,
              errors,
              children: { ...current.children, [relPath]: result.value },
            }
          })
        } while (rerun.current.has(relPath))
      } finally {
        inFlight.current.delete(relPath)
        rerun.current.delete(relPath)
      }
    },
    [folderId],
  )

  const failTarget = useCallback((relPath: string, failure: FsFailure): void => {
    setState((current) => {
      const loading = { ...current.loading }
      delete loading[relPath]
      const expanded = { ...current.expanded }
      delete expanded[relPath]
      return { ...current, loading, expanded, errors: { ...current.errors, [relPath]: describeFailure(failure) } }
    })
  }, [])

  const rows = useMemo(() => {
    const collected: TreeRow[] = []
    buildRows(state, ROOT_PATH, 0, collected)
    return collected
  }, [state])

  const watchTargets = useMemo(() => collectWatchTargets(rows), [rows])
  // 以 JSON 當 effect 的相依 key，不用分隔符串接 —— Linux 的檔名可以含換行字元，
  // 用 `join('\n')` 再 `split` 會把一個目錄拆成兩個，對帳集合就算錯了。
  const watchKey = useMemo(() => JSON.stringify(watchTargets), [watchTargets])

  /**
   * 監看集合與展開集合對帳。展開的目錄開始監看，收合的目錄停止監看。
   *
   * **先訂閱、再列目錄。** 反過來的話，「列完」到「訂閱生效」之間的變更會兩頭落空 ——
   * 列目錄沒看到它，事件也還沒開始送。這個窗口在 agent 一邊寫檔、使用者一邊展開目錄時
   * 一點都不理論。訂閱之後才列，訂閱前的狀態由這次列目錄補齊，之後的由事件送達。
   *
   * 這也是每個目錄唯一的載入入口：首次展開、收合後再展開（背景校正）、以及根目錄的
   * 初次載入，都走這裡。
   */
  useEffect(() => {
    if (!folderId) return

    const desired = new Set<string>(JSON.parse(watchKey))
    const current = watched.current

    for (const target of desired) {
      if (!current.has(target)) {
        current.add(target)
        void window.workspace.fs.watch(folderId, target).then((result) => {
          if (result.ok) void loadDir(target)
          else failTarget(target, result)
        })
      }
    }
    for (const target of [...current]) {
      if (!desired.has(target)) {
        current.delete(target)
        void window.workspace.fs.unwatch(folderId, target)
      }
    }
  }, [failTarget, folderId, loadDir, watchKey])

  // 卸載（含換 folder 時的重新掛載）時，把這個 folder 的監看全部撤掉。
  useEffect(() => {
    if (!folderId) return
    // 整個 hook 生命週期共用同一個 Set 實例，因此在此處取得參照是安全的
    const targets = watched.current
    return () => {
      for (const target of targets) {
        void window.workspace.fs.unwatch(folderId, target)
      }
      targets.clear()
    }
  }, [folderId])

  // 磁碟變更 → 重新列出受影響的目錄。重新列出而非套用增量，是因為改名同時是
  // unlink + add，而增量套用要正確處理它們的順序；重新列出永遠得到當下的真相。
  useEffect(() => {
    if (!folderId) return

    return window.workspace.fs.onWatchEvent((batch) => {
      if (batch.folderId !== folderId) return

      const affected = new Set(batch.events.map((event) => parentOf(event.relPath)))
      for (const dir of affected) {
        if (watched.current.has(dir)) void loadDir(dir)
      }
    })
  }, [folderId, loadDir])

  const expandSymlink = useCallback(
    async (relPath: string): Promise<void> => {
      if (!folderId) return

      // symlink 指向什麼，只有問過檔案系統才知道。先當目錄試 —— 主行程會回報
      // NOT_A_DIRECTORY（其實是檔案）或 ESCAPES_ROOT（指向 workspace 之外）。
      const result = await window.workspace.fs.listDir(folderId, relPath)

      if (result.ok) {
        setState((current) => ({
          ...current,
          expanded: { ...current.expanded, [relPath]: true },
          children: { ...current.children, [relPath]: result.value },
        }))
        return
      }
      if (result.code === 'NOT_A_DIRECTORY') {
        onOpenFile(relPath)
        return
      }
      setState((current) => ({
        ...current,
        errors: { ...current.errors, [relPath]: describeFailure(result) },
      }))
    },
    [folderId, onOpenFile],
  )

  const activate = useCallback(
    (row: TreeRow): void => {
      if (row.kind === 'file') {
        onOpenFile(row.relPath)
        return
      }

      if (row.expanded) {
        setState((current) => {
          const expanded = { ...current.expanded }
          delete expanded[row.relPath]
          return { ...current, expanded }
        })
        return
      }

      if (row.kind === 'symlink' && !state.children[row.relPath]) {
        void expandSymlink(row.relPath)
        return
      }

      const cached = Boolean(state.children[row.relPath])

      // 首次展開才顯示「載入中」。已有快取時直接畫出來，背景再靜默對一次帳 ——
      // 收合期間該目錄未被監看（`ignoreInitial` 也不會補報），快取可能已經過期。
      //
      // 這裡**不**觸發載入：展開只改變狀態，載入由對帳的 effect 在訂閱成功之後發出。
      setState((current) => ({
        ...current,
        expanded: { ...current.expanded, [row.relPath]: true },
        loading: cached ? current.loading : { ...current.loading, [row.relPath]: true },
      }))
    },
    [expandSymlink, onOpenFile, state.children],
  )

  return {
    rows,
    visibleCount: rows.length,
    rootLoading: Boolean(state.loading[ROOT_PATH]),
    rootError: state.errors[ROOT_PATH] ?? null,
    activate,
  }
}
