import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type {
  ChangeDetailView,
  ChangesData,
  GraphData,
  SpecDetailView,
  SpecSummary,
  WorktreeOption,
} from '../types'
import { IpcAdapter, type OpenSpecApi } from './adapter'

interface OpenSpecContextValue {
  api: OpenSpecApi
  /** 每個 folder 的資料世代。agent 改了 `openspec/` 底下的檔案就 +1。 */
  revisions: ReadonlyMap<string, number>
}

const OpenSpecContext = createContext<OpenSpecContextValue | null>(null)

/**
 * OpenSpec 資料的所有者。
 *
 * **變更的訂閱集中在這裡，只掛一次。** 若讓每個 hook 各自 `onChanged`，側欄一開就是好幾個
 * IPC listener，而且它們彼此不知道對方也在重取。這裡把「主行程說某個 folder 變了」翻譯成一個
 * 單調遞增的 revision，hook 只要把它放進依賴陣列就會自己重取。
 *
 * **必須位於 `MainStage` 之上**：MainStage 需要知道當前 folder 的 active change 才能決定
 * 新 session 的錨定（design D3）。
 */
export function OpenSpecProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [revisions, setRevisions] = useState<ReadonlyMap<string, number>>(() => new Map())

  useEffect(() => {
    return window.workspace.openspec.onChanged((folderId) => {
      setRevisions((previous) => {
        const next = new Map(previous)
        next.set(folderId, (previous.get(folderId) ?? 0) + 1)
        return next
      })
    })
  }, [])

  const api = useMemo(() => new IpcAdapter(), [])
  const value = useMemo<OpenSpecContextValue>(() => ({ api, revisions }), [api, revisions])

  return <OpenSpecContext.Provider value={value}>{children}</OpenSpecContext.Provider>
}

function useOpenSpecContext(): OpenSpecContextValue {
  const value = useContext(OpenSpecContext)
  if (!value) throw new Error('the OpenSpec hooks must be used inside an OpenSpecProvider')
  return value
}

export interface AsyncData<T> {
  data: T | null
  loading: boolean
  error: string | null
}

const IDLE: AsyncData<never> = { data: null, loading: false, error: null }

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 取一份 OpenSpec 資料，並在該 folder 的內容變更時自動重取。
 *
 * `key` 是這次請求的完整識別（folder + topic/slug）。`null` 代表現在沒有東西可取。
 *
 * 兩個行為值得說明：
 *
 * - **key 變了就把資料清掉**（切 folder、換 change）。若沿用上一份，畫面會有一瞬間顯示的是
 *   **上一個 folder 的 change** —— 比 loading 更糟，因為它看起來像是真的。這裡用「渲染期間
 *   調整 state」而非 effect：effect 要等 commit 之後才跑，那一幀舊資料已經畫出去了。
 * - **重取時保留舊資料、不回到 loading。** agent 每存一次檔就閃一次「載入中…」，側欄會變成
 *   一塊閃爍的東西 —— 而使用者正在讀它。`loading` 因此只在「還沒有任何資料」時為真。
 */
function useOpenSpecData<T>(
  key: string | null,
  folderId: string | null,
  load: (api: OpenSpecApi) => Promise<T>,
): AsyncData<T> {
  const { api, revisions } = useOpenSpecContext()
  const revision = folderId ? (revisions.get(folderId) ?? 0) : 0

  const [state, setState] = useState<AsyncData<T>>(() => ({
    data: null,
    loading: key !== null,
    error: null,
  }))
  const [seenKey, setSeenKey] = useState(key)

  if (key !== seenKey) {
    setSeenKey(key)
    setState({ data: null, loading: key !== null, error: null })
  }

  useEffect(() => {
    if (key === null) return

    let cancelled = false

    load(api)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ data: null, loading: false, error: describe(error) })
      })

    return () => {
      cancelled = true
    }
  }, [api, key, revision, load])

  if (key === null) return IDLE
  return state
}

export function useSpecs(folderId: string | null): AsyncData<SpecSummary[]> {
  const load = useCallback(
    (api: OpenSpecApi) => api.getSpecs(folderId as string),
    [folderId],
  )
  return useOpenSpecData(folderId, folderId, load)
}

/**
 * 各工作目錄的 folder-relative 根 —— 反向交叉導覽的判定依據（`targetOfPath`）。
 *
 * 這個 hook 的消費者是 **Files 身分**（`FilesPanel`），而它與 OpenSpec 身分是互斥掛載的。
 * 之所以能在那裡呼叫，是因為 `OpenSpecProvider` 位於 `MainStage` **之上**（AppShell 層），
 * 兩個身分都在它的 context 之內 —— 不必把資料從別處灌進去，也自動跟著 revision 重取。
 *
 * **per-folder 取一次**：清單隨 `openspec:changed` 更新，切換檔案時不再有任何 IPC 往返。
 * 這正是 design D1 否決「把反推整個移進主行程」的性質（那條會把窗口放在每次開檔的熱路徑上）。
 */
export function useWorktreeRoots(folderId: string | null): AsyncData<string[]> {
  const load = useCallback(
    (api: OpenSpecApi) => api.getWorktreeRoots(folderId as string),
    [folderId],
  )
  return useOpenSpecData(folderId, folderId, load)
}

/**
 * 該 folder 所屬 repo **可供選擇**的工作目錄（Files 身分的樹根選擇器）。
 *
 * 與 `useWorktreeRoots` 並存而非取代它：那個回答「哪些根可用於定位 OpenSpec 內容」（反向交叉
 * 導覽，邊界外的與該問題無關故省略），這個回答「有哪些工作目錄、各自能不能瀏覽」（邊界外的必須
 * 在列且標示為不可瀏覽）。兩者同為一份掃描結果的投影，不會分歧。
 */
export function useWorktrees(folderId: string | null): AsyncData<WorktreeOption[]> {
  const load = useCallback((api: OpenSpecApi) => api.getWorktrees(folderId as string), [folderId])
  return useOpenSpecData(folderId, folderId, load)
}

export function useSpec(folderId: string | null, topic: string | null): AsyncData<SpecDetailView> {
  const load = useCallback(
    (api: OpenSpecApi) => api.getSpec(folderId as string, topic as string),
    [folderId, topic],
  )
  return useOpenSpecData(folderId && topic ? `${folderId}\u0000${topic}` : null, folderId, load)
}

export function useChanges(folderId: string | null): AsyncData<ChangesData> {
  const load = useCallback(
    (api: OpenSpecApi) => api.getChanges(folderId as string),
    [folderId],
  )
  return useOpenSpecData(folderId, folderId, load)
}

export function useChange(
  folderId: string | null,
  slug: string | null,
): AsyncData<ChangeDetailView> {
  const load = useCallback(
    (api: OpenSpecApi) => api.getChange(folderId as string, slug as string),
    [folderId, slug],
  )
  return useOpenSpecData(folderId && slug ? `${folderId}\u0000${slug}` : null, folderId, load)
}

export function useGraphData(folderId: string | null): AsyncData<GraphData> {
  const load = useCallback(
    (api: OpenSpecApi) => api.getGraphData(folderId as string),
    [folderId],
  )
  return useOpenSpecData(folderId, folderId, load)
}
