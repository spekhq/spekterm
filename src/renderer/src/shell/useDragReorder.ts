import { useCallback, useEffect, useRef, useState } from 'react'

/** 小於這個位移就當作點擊，不算拖曳 —— 否則每次點分頁都會被誤判成一次排序。 */
const DRAG_THRESHOLD_PX = 4

export interface DragState {
  /** 正在被拖的項目在該群組內的序位。 */
  fromIndex: number
  /**
   * 此刻放開的話，會插入到**哪個序位之前**（`0`…`count`；`count` ＝ 插到最後）。
   *
   * **這是「插入點」，不是「提交用的目標序位」——兩者在往下拖時差一格。** 提交端一律是
   * 「先移除、再插入」（`splice(from, 1)` → `splice(to, 0, moved)`），而移除會讓**被拖項目
   * 之後**的每一個元素前移一格。於是插入點 3（「插在第 3 個之前」）在移除之後，實際對應的
   * 目標序位是 2。
   *
   * 換算在 `commitIndex()` 一處完成，state 裡保存的**永遠是插入點** —— 指示線畫的也是它，
   * 兩者必須是同一個東西，否則畫面說「插在這裡」而東西落在別處（實測：把 repo 拖到第二個
   * repo 的下半部，它會飛到清單最後）。
   */
  insertAt: number
}

interface DragReorder {
  /** 掛在每個可拖曳項目的 `onMouseDown` 上。 */
  onMouseDown: (index: number, event: React.MouseEvent) => void
  /** 拖曳中的狀態；未拖曳時為 `null`。 */
  drag: DragState | null
  /** 指示線畫在這個項目**之前**（此刻放開就會落在那裡）。 */
  isDropTarget: (index: number) => boolean
  /** 指示線畫在**最後一個項目之後**（＝放開會落到清單末端）。 */
  dropAtEnd: boolean
  /** 是否正在拖曳（供切換游標樣式）。 */
  dragging: boolean
}

/** 插入點 → 提交用的目標序位（見 `DragState.insertAt`）。 */
function commitIndex(fromIndex: number, insertAt: number): number {
  return insertAt > fromIndex ? insertAt - 1 : insertAt
}

/**
 * 以**滑鼠事件**實作的拖曳排序，不用 HTML5 drag-and-drop。
 *
 * HTML5 DnD 在 CDP 下要走 `Input.setInterceptDrags` + `dispatchDragEvent` 那一套，與探針既有
 * 的 `dragMouse`（真滑鼠序列）格格不入。用滑鼠事件自己做，驗收就能送真拖曳（design D3）。
 *
 * listener 掛在 `window` 上 —— 拖曳中滑鼠會離開元素本身，掛在元素上會半途斷掉。
 *
 * @param count 群組內的項目數
 * @param axis 分頁列是水平的，rail 的子列是垂直的
 * @param rectOf 取得第 n 個項目的 DOMRect（呼叫端才知道自己的 DOM）
 * @param onCommit 放開時提交（僅在序位真的改變時呼叫）
 *
 * `rectOf` 與 `onCommit` **不必是穩定的 callback**（此處曾宣稱必須，那是假的）：它們變動時
 * window listener 會被拆掉重掛，而 cleanup 與重掛發生在**同一次 effect flush 之內** ——
 * JS 是單執行緒的，兩者之間送不進任何滑鼠事件。
 */
export function useDragReorder(
  count: number,
  axis: 'horizontal' | 'vertical',
  rectOf: (index: number) => DOMRect | null,
  onCommit: (fromIndex: number, toIndex: number) => void,
): DragReorder {
  const [drag, setDrag] = useState<DragState | null>(null)
  const origin = useRef<{ x: number; y: number; fromIndex: number } | null>(null)
  const started = useRef(false)
  /**
   * 拖曳狀態的第二份，存在 ref 裡。
   *
   * **提交不能寫在 `setDrag` 的 updater 裡。** state updater 必須是純函式，而 StrictMode
   * （只在 dev 生效）會刻意 double-invoke 它來揪出不純的 updater —— 把 `onCommit` 寫在裡面，
   * 排序就會被套用**兩次**（交換兩次＝回到原位，看起來像「拖曳完全沒反應」）。實測：dev 模式
   * 拖曳失效、build 模式正常，正是 StrictMode 抓到了這個違規。
   */
  const dragRef = useRef<DragState | null>(null)

  const onMouseDown = useCallback((index: number, event: React.MouseEvent) => {
    if (event.button !== 0) return
    origin.current = { x: event.clientX, y: event.clientY, fromIndex: index }
    started.current = false
  }, [])

  // **listener 一律掛著，不由 state 驅動掛載。**
  //
  // 若改成「mousedown 時 setPressed(true) → effect 掛 listener」，那麼 mousedown 與 listener
  // 真正掛上之間就隔了一整個 React 渲染週期 —— 落在那個窗口裡的 mousemove 會**直接丟失**。
  // 實測：dev 模式因此拖曳完全失效，build 模式僥倖趕上（探針一邊過一邊不過才抓到）。
  // 與「先訂閱、再列目錄」同源：**訂閱要早於會產生事件的那個動作。**
  //
  // 代價是 window 上常駐兩個 listener（分頁列與 rail 各一），但 handler 第一行就以 ref
  // 判斷是否在拖曳，未拖曳時是一次比較就返回。
  useEffect(() => {
    /**
     * 此刻放開的話，會插入到哪個序位**之前**（`0`…`count`）。
     *
     * 以各項目的中線判定：游標在某個項目的中線之前 → 插在它之前。全部都在游標之前（游標拖到
     * 了清單末端之後）→ 回傳 `count`，也就是「插到最後」。
     *
     * **末端必須是 `count`，不是 `count - 1`。** 回 `count - 1` 會讓「拖到最下面」變成「插在
     * 最後一個項目之前」—— 使用者永遠拖不到真正的最後一格。
     */
    const insertAtFor = (x: number, y: number): number => {
      for (let index = 0; index < count; index++) {
        const rect = rectOf(index)
        if (!rect) continue
        const middle =
          axis === 'horizontal' ? rect.left + rect.width / 2 : rect.top + rect.height / 2
        const position = axis === 'horizontal' ? x : y
        if (position < middle) return index
      }
      return count
    }

    const onMove = (event: MouseEvent): void => {
      const from = origin.current
      if (!from) return

      const moved = Math.hypot(event.clientX - from.x, event.clientY - from.y)
      if (!started.current && moved < DRAG_THRESHOLD_PX) return
      started.current = true

      const next = {
        fromIndex: from.fromIndex,
        insertAt: insertAtFor(event.clientX, event.clientY),
      }
      dragRef.current = next
      setDrag(next)
    }

    const onUp = (): void => {
      const from = origin.current
      if (!from) return
      origin.current = null

      const current = dragRef.current
      dragRef.current = null
      const dragged = started.current
      started.current = false
      setDrag(null)

      // 沒有真的移動 —— 這是一次點擊，交給元素自己的 onClick 處理，順序不動。
      if (!dragged || !current) return

      // **提交在 updater 之外**：updater 必須是純函式（見 dragRef 的註解）。
      const toIndex = commitIndex(current.fromIndex, current.insertAt)
      if (toIndex !== current.fromIndex) {
        onCommit(current.fromIndex, toIndex)
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [count, axis, rectOf, onCommit])

  // 拖曳期間整份文件都用 grabbing 游標、且禁止選取。
  //
  // 兩者都必須是**全域**的：滑鼠會離開被拖的元素、掃過旁邊的東西 —— 只在元素自己身上設，
  // 游標會在半途變回箭頭，而滑過的文字會被反白選起來（實測體感很差）。
  //
  // **游標不能只設在 `body.style` 上。** `cursor` 雖是可繼承屬性，但**元素自己的宣告會贏過
  // 繼承來的值** —— 而這條路徑上滿地都是自己宣告了 `cursor` 的元素：可拖曳的列與分頁靜止時是
  // `cursor-pointer`，`<button>` 更有一條 UA 的 `cursor: default`（Tailwind v4 的 preflight
  // 不再把它改回 pointer）。repo 的拖曳判定又刻意涵蓋整個區塊（含 session 子列與那幾顆圖示鈕），
  // 游標一定會掃過它們 —— 只設 body 的話，游標會在「握拳」與「食指」之間閃爍。
  //
  // 因此改以 `data-dragging` 標記在 body 上，由 `index.css` 的一條 `!important` 規則覆蓋**整棵
  // 子樹**。這樣呼叫端也不必再自己維護「拖曳中要換游標」的分支 —— 少一個會被忘記的地方。
  useEffect(() => {
    if (!drag) return

    const body = document.body
    const previousSelect = body.style.userSelect
    body.dataset.dragging = 'true'
    body.style.userSelect = 'none'

    return () => {
      delete body.dataset.dragging
      body.style.userSelect = previousSelect
    }
  }, [drag])

  // 指示線只在「放開真的會改變順序」時出現。拖在自己原本的位置上（插入點 ＝ 自己、或自己的
  // 下一格）時放開是無操作 —— 這時畫一條線等於騙人。
  const willMove = drag !== null && commitIndex(drag.fromIndex, drag.insertAt) !== drag.fromIndex

  const isDropTarget = useCallback(
    (index: number) => willMove && drag !== null && drag.insertAt === index,
    [drag, willMove],
  )

  return {
    onMouseDown,
    drag,
    isDropTarget,
    dropAtEnd: willMove && drag !== null && drag.insertAt === count,
    dragging: drag !== null,
  }
}
