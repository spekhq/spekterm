import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { PanelCoordinate, PanelCoordinates, RailSelection } from './types'

/**
 * 側欄座標：rail 上的每個項目各記著「我站在這裡時，側欄看什麼」。
 *
 * 三個維度 —— 來源 repo、工作目錄、錨定的 change —— **隸屬於 rail 的項目，不隸屬於任何 session**
 * （`side-panel-source`）。這是 `side-panel-repo-anchor` 那個 per-session 粒度的改基：後者把
 * 「沒有 session」定義成一個唯讀的 fallback，於是尚無 session 的 folder 連側欄要讀哪個 repo
 * 都選不了 —— 而側欄是一個**閱讀**工具，不該需要先開一個 terminal 才能用。
 *
 * **「rail 上的項目」今日恰為 folder**，鍵因此就是 folder id。刻意以「項目」措辭：rail 的項目
 * 集合日後可能擴充（issue #5 要把 linked worktree 列為一級項目），屆時鍵空間是擴充而非重做。
 */
export interface PanelCoordinateApi {
  /** 某個 rail 項目的座標。未選中任何項目、或從未改動過時回傳空座標（三個維度皆 undefined）。 */
  coordinateOf(item: RailSelection | null): PanelCoordinate
  /**
   * 設定側欄來源 repo。
   *
   * **一併重置工作目錄與錨定的 change** —— 那兩個維度隸屬於**來源 repo**（工作目錄識別碼與
   * change slug 都是某個 repo 內部的座標），沿用舊 repo 的值，新 repo 查無此項，檔案樹會對著
   * 一個不存在的根、本 change 視圖會對著一個不存在的 change 呈現空狀態，看起來像壞掉。
   */
  setSource(item: RailSelection, sourceFolderId: string | null): void
  /**
   * 設定 Files 身分的樹根工作目錄。`undefined` ＝ folder 自身。
   *
   * **不重置錨定** —— 換工作目錄沒有換 repo，同一個 change 照樣存在。
   */
  setWorktree(item: RailSelection, worktreeKey: string | undefined): void
  /** 錨定一個 change。`null` 解除錨定，交還給衍生預設。 */
  setAnchor(item: RailSelection, slug: string | null): void
}

const EMPTY: PanelCoordinate = {}

function isEmpty(coordinate: PanelCoordinate): boolean {
  return (
    coordinate.sourceFolderId === undefined &&
    coordinate.worktreeKey === undefined &&
    coordinate.anchoredChange === undefined
  )
}

const PanelCoordinateContext = createContext<PanelCoordinateApi | null>(null)

export function PanelCoordinateProvider({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [coordinates, setCoordinates] = useState<PanelCoordinates>({})
  /**
   * 全域項目的座標 —— **獨立的 state，不是 `coordinates` 的一個鍵**（design D1c）。
   * folder 識別碼不受格式約束，共用鍵空間就可能碰撞；分開之後那個碰撞表達不出來。
   */
  const [globalCoordinate, setGlobalCoordinate] = useState<PanelCoordinate>(EMPTY)

  /**
   * 重建尚未完成時，**不可以把座標寫回磁碟** —— 首次渲染時它是空的。
   *
   * 少了這道閘，落盤的 effect 會在磁碟資料讀回來**之前**就送出一份空 map，把上一次的座標
   * 全部抹掉。而且是靜默的：沒有錯誤、沒有訊息，只有「重開之後側欄回到預設」。
   * （`SessionsProvider` 為同一個坑付過代價。）
   */
  const [restored, setRestored] = useState(false)
  const restoredRef = useRef(false)
  /** 使用者在 restore 回來之前就動過的項目 —— 合併時它們優先。 */
  const touched = useRef(new Set<string | null>())

  useEffect(() => {
    // **StrictMode 會把 effect 跑兩次（且只在 dev）。** 少了這道 ref，合併規則會被套用兩次。
    if (restoredRef.current) return
    restoredRef.current = true

    void window.workspace.panel
      .get()
      .then((persisted) => {
        // **合併，不是覆蓋。**
        //
        // restore 是一次非同步的 IPC —— 使用者完全可能在它回來之前就開了來源指示器選了一個
        // repo。直接 `setCoordinates(persisted)` 會讓那次選擇**憑空消失**，而側欄已經切過去了。
        setCoordinates((previous) => {
          const merged: PanelCoordinates = { ...persisted.coordinates }
          for (const [key, coordinate] of Object.entries(previous)) {
            if (touched.current.has(key)) merged[key] = coordinate
          }
          return merged
        })
        // 全域座標同樣不可覆蓋使用者在 restore 途中做的選擇。
        setGlobalCoordinate((previous) =>
          touched.current.has(null) ? previous : (persisted.global ?? EMPTY),
        )
      })
      .catch((error) => {
        console.error(`[panel] restore failed: ${String(error)}`)
      })
      .finally(() => {
        // 無論成敗都要開閘 —— 否則落盤永遠不會發生，使用者接下來做的一切都不會被記住。
        setRestored(true)
      })
  }, [])

  useEffect(() => {
    if (!restored) return
    window.workspace.panel.persist({
      coordinates,
      global: isEmpty(globalCoordinate) ? undefined : globalCoordinate,
    })
  }, [coordinates, globalCoordinate, restored])

  /** 兩個座標是否等值 —— 相等時不更新 state（避免多一次無意義的渲染與落盤）。 */
  const same = (a: PanelCoordinate, b: PanelCoordinate): boolean =>
    a.sourceFolderId === b.sourceFolderId &&
    a.worktreeKey === b.worktreeKey &&
    a.anchoredChange === b.anchoredChange

  /**
   * 就地改一個項目的座標。空座標不佔位 —— 它與「沒有這一筆」語意相同。
   *
   * 依 rail 項目的種類分派到兩個 state：folder 進 map，全域進它自己的欄位。
   */
  const update = useCallback(
    (item: RailSelection, change: (previous: PanelCoordinate) => PanelCoordinate) => {
      if (item.kind === 'global') {
        touched.current.add(null)
        setGlobalCoordinate((before) => {
          const after = change(before)
          return same(after, before) ? before : after
        })
        return
      }

      const itemId = item.id
      touched.current.add(itemId)
      setCoordinates((previous) => {
        const before = previous[itemId] ?? EMPTY
        const after = change(before)
        if (same(after, before)) return previous

        const next = { ...previous }
        if (isEmpty(after)) delete next[itemId]
        else next[itemId] = after
        return next
      })
    },
    [],
  )

  const setSource = useCallback(
    (item: RailSelection, sourceFolderId: string | null) => {
      // 指回自身即清除該維度 —— 同一個邏輯狀態只有一種表示（比照工作目錄的「省略即 folder 自身」）。
      // **`null` ＝ 明確清除來源**：全域項目沒有「自身」可指回，而「未選定」是它的預設狀態，
      // 也是兩條空狀態要求唯一的入口 —— 少了這條路，使用者選了來源之後就再也回不去。
      const source =
        sourceFolderId === null || (item.kind === 'folder' && sourceFolderId === item.id)
          ? undefined
          : sourceFolderId
      // 換 repo ⇒ 另外兩個維度一併歸零（見介面上的說明）。以整個換掉而非 spread 表達，
      // 讓「重置」在程式碼裡是看得見的，而不是靠讀者注意到少了兩個欄位。
      update(item, (previous) =>
        previous.sourceFolderId === source ? previous : { sourceFolderId: source },
      )
    },
    [update],
  )

  const setWorktree = useCallback(
    (item: RailSelection, worktreeKey: string | undefined) => {
      update(item, (previous) => ({ ...previous, worktreeKey }))
    },
    [update],
  )

  const setAnchor = useCallback(
    (item: RailSelection, slug: string | null) => {
      update(item, (previous) => ({ ...previous, anchoredChange: slug ?? undefined }))
    },
    [update],
  )

  const api = useMemo<PanelCoordinateApi>(
    () => ({
      coordinateOf: (item) => {
        if (!item) return EMPTY
        return item.kind === 'global' ? globalCoordinate : (coordinates[item.id] ?? EMPTY)
      },
      setSource,
      setWorktree,
      setAnchor,
    }),
    [coordinates, globalCoordinate, setSource, setWorktree, setAnchor],
  )

  return (
    <PanelCoordinateContext.Provider value={api}>{children}</PanelCoordinateContext.Provider>
  )
}

export function usePanelCoordinate(): PanelCoordinateApi {
  const api = useContext(PanelCoordinateContext)
  if (!api) throw new Error('usePanelCoordinate must be used inside a PanelCoordinateProvider')
  return api
}
