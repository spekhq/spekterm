import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContextMenu, type MenuItem } from './files/dialogs'
import { SessionNameDialog } from './terminal/SessionNameDialog'
import { StatusDot, sessionLabel, sessionTitle, statusTitle } from './terminal/session-badge'
import { type SessionState, useSessions } from './terminal/sessions'
import { useDragReorder } from './useDragReorder'
import { useScrollIntoView } from './useScrollIntoView'
import { useSpawnMenu } from './terminal/useSpawnMenu'
import { type RailSelection, type SpawnTarget, type WorkspaceFolder, selectedFolderId } from './types'

interface WorkspaceRailProps {
  folders: WorkspaceFolder[]
  /** rail 上選中的項目。`null` ＝ 尚未選中任何項目（與「選中全域項目」互斥可辨，design D8）。 */
  selection: RailSelection | null
  onSelect: (id: string) => void
  /** 選中那個不隸屬任何 folder 的全域項目（`global-session`）。 */
  onSelectGlobal: () => void
  onAdd: () => void
  onRemove: (id: string) => void
  /** 把某個 folder 移到清單的第 `toIndex` 個位置。**以 id 指定，不以位置**（design D5）。 */
  onReorder: (id: string, toIndex: number) => void
}

// `cursor-pointer` 不是多餘的：瀏覽器的 UA 樣式給 `button` 一條 `cursor: default`，而 Tailwind v4
// 的 preflight **不再**把它改回 `pointer`（v3 會）—— 於是按鈕會蓋掉外層那一列設的 `cursor-pointer`，
// 滑鼠停在 ＋／✕ 上看到的是箭頭，儘管它們就在一列食指之中。
const ICON_BUTTON_CLASS =
  'shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-sm opacity-0 group-hover:opacity-100'

function FolderIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="h-4 w-4 shrink-0 text-ink-faint"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  )
}

/** 全域項目的圖示 —— 與資料夾明顯區隔（它不是一個 repo）。 */
function GlobeIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="h-4 w-4 shrink-0 text-ink-faint"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
    </svg>
  )
}

/**
 * rail 上一列所需的一切 —— **刻意不是 `WorkspaceFolder`**。
 *
 * rail 的項目集合不再等於 workspace 的 folder 清單（`global-session` 加了一個不隸屬任何 folder
 * 的固定項目），因此這一列吃的是「呈現一列需要什麼」，而不是「一個 folder 是什麼」。session
 * 子列、拖曳排序、右鍵選單與命名對話框於是**兩種項目完全共用**，不必抄第二份。
 */
interface RailItemView {
  /** session 的歸屬鍵：folder 識別碼，或 `null`（全域項目）。 */
  folderId: string | null
  name: string
  /** 標題列的 tooltip：folder 是它的路徑，全域項目是一句說明。 */
  title: string
  /** 副標（分支／警示）。全域項目沒有 —— 它沒有 repo 可讀。 */
  subtitle?: string
  /** 可否於其上建立 session（folder 路徑失效時為 false）。 */
  available: boolean
  /** 有值 ⇒ 呈現「路徑失效」徽章。全域項目恆無。 */
  missingPath?: string
  icon: React.JSX.Element
}

function RailRow({
  item,
  selected,
  sessions,
  focusedSessionId,
  expanded,
  onToggle,
  onSelect,
  onSelectSession,
  onCloseSession,
  onCreateSession,
  onRenameSession,
  onReorderSessions,
  onRemove,
  blockRef,
  headerRef,
  onDragStart,
  dropTarget,
  dropAtEnd,
  dragged,
}: {
  item: RailItemView
  selected: boolean
  sessions: SessionState[]
  focusedSessionId: string | null
  expanded: boolean
  onToggle: () => void
  onSelect: () => void
  onSelectSession: (sessionId: string) => void
  onCloseSession: (sessionId: string) => void
  onCreateSession: (spawnTarget: SpawnTarget) => void
  onRenameSession: (sessionId: string, name: string) => void
  onReorderSessions: (fromIndex: number, toIndex: number) => void
  /** 全域項目不可移除 —— 它不是 workspace 的成員（`global-session`）。 */
  onRemove?: () => void
  /** 整個 repo 區塊（含展開的 session 子列）—— repo 拖曳的命中判定以它為準（design D6）。 */
  blockRef?: (element: HTMLLIElement | null) => void
  /**
   * **標題列**的元素 —— 「捲入可視範圍」以它為目標，不以整個區塊。
   *
   * 區塊含展開的 session 子列，一個展開了數個 session 的 repo 可能比捲動容器**還高**，而
   * `scrollIntoView({ block: 'nearest' })` 對「已與 scrollport 相交但更高」的元素**不捲動**
   * —— 判準（目標完整落在容器內）於是永遠為假，與實作對錯無關。
   */
  headerRef?: (element: HTMLDivElement | null) => void
  /**
   * 掛在**標題列**上，不掛在整塊上：否則於 session 子列按下會同時啟動兩個拖曳（design D6）。
   * 全域項目不可拖曳排序，因此它不傳這個。
   */
  onDragStart?: (event: React.MouseEvent) => void
  dropTarget: boolean
  /** 指示線畫在這一列**之後**（此刻放開會落到 rail 的最後一格）。只有最後一列會拿到 true。 */
  dropAtEnd: boolean
  dragged: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  // 每個 folder 各持有自己的選單狀態 —— rail 上有很多列，共用一份會錨錯位置。
  const spawn = useSpawnMenu(onCreateSession)
  const [menu, setMenu] = useState<{ x: number; y: number; session: SessionState } | null>(null)
  const [renaming, setRenaming] = useState<SessionState | null>(null)
  const rowRefs = useRef(new Map<number, HTMLDivElement>())
  const rowScroll = useScrollIntoView()

  const rectOf = useCallback((index: number) => {
    return rowRefs.current.get(index)?.getBoundingClientRect() ?? null
  }, [])

  const reorder = useDragReorder(sessions.length, 'vertical', rectOf, onReorderSessions)

  /**
   * 這一列被選中時，把它的 focused session 子列捲進可視範圍。
   *
   * **同一顆 `Ctrl+Tab` 要捲兩個容器**：分頁列（橫向，在 `SessionTabs`）與 rail（縱向，這裡）
   * —— 一個展開了數個 session 的 repo，其子列很容易落在 rail 的視野之外。
   *
   * 只在 `selected` 時捲：否則切換選中的 repo 時，**每一列**都會搶著把自己的 focused 子列
   * 捲進視野，最後一個贏 —— 畫面會跳到一個使用者沒有選的地方。
   *
   * 以指標直接點這一塊裡的東西時不捲（`guard` 掛在 `<li>` 上）—— 但在**分頁列**點一個分頁
   * 時仍會捲，那是另一個容器，使用者還沒看到這裡的子列。
   */
  useEffect(() => {
    if (!selected || !focusedSessionId) return
    const index = sessions.findIndex((session) => session.id === focusedSessionId)
    if (index === -1) return
    rowScroll.scrollIntoView(rowRefs.current.get(index), { block: 'nearest' })
  }, [selected, focusedSessionId, sessions, rowScroll])

  const items: MenuItem[] = menu
    ? [
        {
          label: t('sessions.rename'),
          onSelect: () => {
            setRenaming(menu.session)
            setMenu(null)
          },
        },
        {
          label: t('sessions.close'),
          tone: 'danger',
          onSelect: () => {
            onCloseSession(menu.session.id)
            setMenu(null)
          },
        },
      ]
    : []

  return (
    <li
      ref={blockRef}
      {...rowScroll.guard}
      className={
        'group ' +
        // 插入指示：拖到這裡放開，就會插在它前面。畫在**整塊**上，因為命中判定也是整塊。
        (dropTarget ? 'border-t-2 border-t-accent ' : '') +
        // 插到最後一格 —— 少了它，「拖到 rail 最下面」這個落點沒有任何指示線。
        (dropAtEnd ? 'border-b-2 border-b-accent ' : '') +
        (dragged ? 'opacity-40 ' : '')
      }
    >
      <div
        ref={headerRef}
        role="button"
        tabIndex={0}
        /*
          **標題列一律有 `aria-label`，值為項目的名稱。**

          此前這一列只有 `title`（folder 的路徑）—— 螢幕閱讀器讀到的是一長串路徑，而不是使用者
          用來辨識它的名字。全域項目更是完全沒有可定位的標籤，而 `aria-label` 在這個 repo 裡
          **同時是探針的選擇器**（`probe:workspace` 以「移除按鈕」識別 folder 列，全域項目沒有
          那顆按鈕，於是它在探針眼中根本不存在）。
        */
        aria-label={item.name}
        /*
          **選中狀態要有一個可辨識的屬性，不能只靠 class。**

          它首先是無障礙的正確標記（rail 是一組互斥的選項，螢幕閱讀器要知道哪一個是當前的）；
          而它同時修掉一個**假綠**：探針此前以 `className.includes('bg-hover')` 判斷選中，而
          未選中的列帶著 `hover:bg-hover/60` —— **那個字串也包含 `bg-hover`**，於是判準恆回
          第一列。以它為期望值的斷言（「循環回全域項目」）因此不論實作對錯都通過。
        */
        aria-current={selected ? 'true' : undefined}
        onMouseDown={onDragStart}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onSelect()
        }}
        title={item.title}
        className={
          // select-none：拖曳時不該把名稱與分支反白選起來。
          'flex items-center gap-2 px-3 py-2 text-base select-none ' +
          // 靜止時是 pointer（食指）—— 這一列**點一下是有作用的**（選中這個 repo），而那是
          // 使用者在它身上最常做的事；拖曳是偶爾為之。游標宣告主要的可供性（design D8）。
          // 拖曳中的 grabbing 由 `index.css` 的 `body[data-dragging]` 全域覆蓋（它必須蓋過
          // 這裡的 pointer 與按鈕的 UA `default`，否則游標會在拖曳途中閃爍）。
          'cursor-pointer ' +
          (selected ? 'bg-hover text-ink' : 'text-ink-dim hover:bg-hover/60')
        }
      >
        {sessions.length > 0 ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={
              expanded
                ? t('rail.collapseSessions', { name: item.name })
                : t('rail.expandSessions', { name: item.name })
            }
            title={expanded ? t('rail.collapseTooltip') : t('rail.expandTooltip')}
            onClick={(event) => {
              // 展開／收合不該順手改變選中的 repo。
              event.stopPropagation()
              onToggle()
            }}
            className="w-3 shrink-0 cursor-pointer text-2xs text-ink-faint hover:text-ink"
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-3 shrink-0" aria-hidden="true" />
        )}

        {item.icon}

        <div className="min-w-0 flex-1">
          {/*
            名稱是使用者用來辨識 repo 的東西，必須是這一列視覺權重最高的元素。它一度是
            normal weight + 未選中時暗灰，於是雖然字級比副標大，卻被副標平分了注意力 ——
            字重與顏色比 px 更能解決「不夠突出」。
          */}
          <div className={`truncate font-bold ${selected ? 'text-accent' : 'text-ink'}`}>
            {item.name}
          </div>
          {item.subtitle && (
            <div className="truncate font-mono text-xs text-ink-faint">{item.subtitle}</div>
          )}
        </div>

        {sessions.length > 0 && (
          <span
            title={t('rail.sessionCount', { count: sessions.length })}
            className="shrink-0 rounded bg-hover px-1 text-2xs text-ink-faint"
          >
            {sessions.length}
          </span>
        )}

        {item.missingPath !== undefined && (
          <span
            title={t('rail.missingTooltip', { path: item.missingPath })}
            className="shrink-0 rounded border border-danger/40 px-1 text-2xs text-danger"
          >
            {t('rail.missingBadge')}
          </span>
        )}

        {/* 在 rail 上看得到 session，就該能在原地開一個 —— 不必先切到主舞台。 */}
        <button
          type="button"
          disabled={!item.available}
          aria-label={t('rail.newSessionIn', { name: item.name })}
          title={item.available ? t('sessions.new') : t('rail.newSessionDisabled')}
          onClick={spawn.open}
          className={`${ICON_BUTTON_CLASS} ${
            item.available ? 'text-ink-faint hover:text-accent' : 'text-ink-faint opacity-40'
          }`}
        >
          ＋
        </button>

        {/*
          這裡曾有一顆 `◈`。它的 onClick 裡**只有 stopPropagation()** —— 一顆長得像按鈕、
          按下去卻什麼都不發生的指示燈，會反覆消耗使用者的注意力去確認它是不是壞了。而且
          OpenSpec 身分的**真入口**是主舞台 header 的 PanelSwitch（那裡本來就有一個 ◈），
          雛型的 rail 裡從來沒有這顆。已移除 —— rail 不呈現不可操作的控制項。
        */}
        {onRemove && (
          <button
            type="button"
            aria-label={t('rail.removeFolder', { name: item.name })}
            title={t('rail.removeFolderTooltip', { name: item.name })}
            onClick={(event) => {
              event.stopPropagation()
              onRemove()
            }}
            className={`${ICON_BUTTON_CLASS} text-ink-faint hover:text-danger`}
          >
            ✕
          </button>
        )}
      </div>

      {expanded && sessions.length > 0 && (
        <ul aria-label={t('rail.folderSessions', { name: item.name })} className="pb-1">
          {sessions.map((session, index) => {
            const isFocused = session.id === focusedSessionId
            const label = sessionLabel(session)
            const full = sessionTitle(session)
            const dragging = reorder.drag?.fromIndex === index

            return (
              <li key={session.id} className="group/session">
                <div
                  ref={(el) => {
                    if (el) rowRefs.current.set(index, el)
                    else rowRefs.current.delete(index)
                  }}
                  role="button"
                  tabIndex={0}
                  onMouseDown={(event) => reorder.onMouseDown(index, event)}
                  onClick={() => onSelectSession(session.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') onSelectSession(session.id)
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setMenu({ x: event.clientX, y: event.clientY, session })
                  }}
                  title={`${full} — ${statusTitle(session)}`}
                  className={
                    // 縮排造出樹狀層次（mockup 的 .ws-session-row）
                    // select-none：拖曳時不該把標籤的文字反白選起來（實測體感很差）。
                    'flex items-center gap-2 py-1.5 pr-1 pl-9 text-xs select-none ' +
                    // 靜止時 pointer：點一下會切換 focused session —— 那才是主要的可供性
                    // （design D8）。拖曳中的 grabbing 由 `body[data-dragging]` 全域覆蓋。
                    'cursor-pointer ' +
                    // 插入指示：拖到這裡放開，就會插在它前面
                    (reorder.isDropTarget(index) ? 'border-t-2 border-t-accent ' : '') +
                    (reorder.dropAtEnd && index === sessions.length - 1
                      ? 'border-b-2 border-b-accent '
                      : '') +
                    (dragging ? 'opacity-40 ' : '') +
                    (isFocused ? 'bg-stage text-ink' : 'text-ink-dim hover:bg-hover/60')
                  }
                >
                  <StatusDot session={session} />
                  <span className="min-w-0 flex-1 truncate font-mono">{label}</span>

                  <button
                    type="button"
                    aria-label={t('sessions.closeSession', { label })}
                    title={t('sessions.closeSession', { label: full })}
                    onClick={(event) => {
                      event.stopPropagation()
                      onCloseSession(session.id)
                    }}
                    className="shrink-0 cursor-pointer rounded px-1 text-ink-faint opacity-0 group-hover/session:opacity-100 hover:text-danger"
                  >
                    ✕
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {spawn.menu}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
      {renaming && (
        <SessionNameDialog
          initialValue={sessionTitle(renaming)}
          onCancel={() => setRenaming(null)}
          onSubmit={(name) => {
            onRenameSession(renaming.id, name)
            setRenaming(null)
          }}
        />
      )}
    </li>
  )
}

export function WorkspaceRail({
  folders,
  selection,
  onSelect,
  onSelectGlobal,
  onAdd,
  onRemove,
  onReorder,
}: WorkspaceRailProps): React.JSX.Element {
  const { t } = useTranslation()
  const sessions = useSessions()
  // 預設展開；記錄的是「被收合的」，因此新出現的 folder 自然是展開的。
  const [collapsed, setCollapsed] = useState<ReadonlySet<string | null>>(() => new Set())
  /**
   * 每個 rail 項目的**標題列**元素，鍵為它的歸屬（`null` ＝ 全域項目）。
   *
   * 與 `blockRefs` 是兩份：那一份鍵為 folder 的**索引**、指向整個區塊，供拖曳的命中判定使用；
   * 這一份供「捲入可視範圍」使用，兩者的目標與座標系都不同（見 `RailRow.headerRef`）。
   */
  const headerRefs = useRef(new Map<string | null, HTMLDivElement>())
  const railScroll = useScrollIntoView()

  const blockRefs = useRef(new Map<number, HTMLLIElement>())
  // **量整個 `<li>`**（含展開的 session 子列），不是標題列 —— 那是使用者眼中「這個 repo 佔的
  // 地盤」，插入點以它判定才跟手（design D6）。
  const folderRectOf = useCallback((index: number) => {
    return blockRefs.current.get(index)?.getBoundingClientRect() ?? null
  }, [])

  // 拖曳給的是位置，但送出去的必須是**識別碼** —— 清單的權威在主行程（design D5）。
  //
  // 這裡曾經把 `folders` 存進 ref（於渲染期間指派）以求 callback 穩定。那是不必要的：
  // `useDragReorder` 明載 `onCommit` **不必穩定**（它變動時 window listener 於同一次 effect
  // flush 內拆掉重掛，中間送不進任何滑鼠事件），而渲染期間寫 ref 是 React 的違規動作。
  const commitFolderOrder = useCallback(
    (fromIndex: number, toIndex: number) => {
      const moved = folders[fromIndex]
      if (moved) onReorder(moved.id, toIndex)
    },
    [folders, onReorder],
  )

  const folderReorder = useDragReorder(
    folders.length,
    'vertical',
    folderRectOf,
    commitFolderOrder,
  )

  const toggle = useCallback((folderId: string | null) => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }, [])

  /**
   * 選中的項目改變時，把它捲進可視範圍。
   *
   * **在 effect 裡做，不在事件處理器裡** —— 順序改變（`Shift+↑↓`）之後元素的位置隨之改變，
   * 於同一輪更新中量測會得到舊位置。而副作用**絕不可寫進 `setState` 的 updater**：StrictMode
   * 會 double-invoke 它（這個 repo 為此付過一次「拖曳完全沒反應、且只有 dev 模式壞」的學費）。
   *
   * `block: 'nearest'` 讓「已完整可見就不捲動」成立，但**它不涵蓋滑鼠** —— 部分可見的元素
   * 它照樣會捲。以指標直接操作時的例外由 `useScrollIntoView` 承擔（`guard` 掛在 `<aside>` 上）。
   */
  useEffect(() => {
    if (!selection) return
    const key = selection.kind === 'global' ? null : selection.id
    railScroll.scrollIntoView(headerRefs.current.get(key), { block: 'nearest' })
  }, [selection, railScroll])

  /** 選中一個 rail 項目 —— `null` ＝ 全域項目。兩種歸屬共用一個入口，呼叫端不必各自分岔。 */
  const selectItem = useCallback(
    (folderId: string | null) => {
      if (folderId === null) onSelectGlobal()
      else onSelect(folderId)
    },
    [onSelect, onSelectGlobal],
  )

  // 點 session 子列＝選中它所屬的項目，並把它設為該項目的 focused session。
  const selectSession = useCallback(
    (folderId: string | null, sessionId: string) => {
      selectItem(folderId)
      sessions.focus(folderId, sessionId)
    },
    [selectItem, sessions],
  )

  // 自 rail 建立 session：必然要看到它，因此也選中該項目（create 內部會聚焦新 session）。
  const createSession = useCallback(
    (folderId: string | null, spawnTarget: SpawnTarget) => {
      selectItem(folderId)
      void sessions.create(folderId, spawnTarget)
    },
    [selectItem, sessions],
  )

  return (
    <aside
      aria-label={t('rail.label')}
      className="flex h-full min-w-0 flex-col overflow-hidden border-r border-hairline bg-rail"
      {...railScroll.guard}
    >
      {/* 標題不會自己截斷，於是它會撐住 rail 的 min-content —— 拖到最小寬度時就溢出到分界之外。 */}
      <h2 className="truncate px-3 pt-3 pb-2 text-xs tracking-widest text-ink-faint">
        {t('rail.heading')}
      </h2>

      <ul className="flex-1 overflow-y-auto">
        {/*
          全域項目恆為第一列，且**不進 `blockRefs`、不接 `onDragStart`** —— 它不是 workspace
          的成員，既不可被拖曳，也不作為別人的落點。這同時是 design D7 那條的實作：拖曳的落點
          索引以 **folder 清單**為基準，rail 比它多一列；把這一列算進去，每一次拖曳都會落錯一格
          （而 workspace 只有兩個 folder 時，夾制會讓那個錯誤看起來是對的）。
        */}
        <RailRow
          item={{
            folderId: null,
            name: t('rail.globalName'),
            title: t('rail.globalTooltip'),
            available: true,
            icon: <GlobeIcon />,
          }}
          selected={selection?.kind === 'global'}
          sessions={sessions.forFolder(null)}
          focusedSessionId={sessions.focusedIdFor(null)}
          expanded={!collapsed.has(null)}
          onToggle={() => toggle(null)}
          headerRef={(element) => {
            if (element) headerRefs.current.set(null, element)
            else headerRefs.current.delete(null)
          }}
          onSelect={onSelectGlobal}
          onSelectSession={(sessionId) => selectSession(null, sessionId)}
          onCloseSession={sessions.close}
          onCreateSession={(spawnTarget) => createSession(null, spawnTarget)}
          onRenameSession={sessions.rename}
          onReorderSessions={(fromIndex, toIndex) => sessions.reorder(null, fromIndex, toIndex)}
          dropTarget={false}
          dropAtEnd={false}
          dragged={false}
        />

        {/* 與 folder 清單的分隔 —— 使用者要一眼看出它與 repo 不是同一類東西。 */}
        <li aria-hidden="true" className="mx-3 my-1 border-t border-hairline" />

        {folders.length === 0 ? (
          <li className="px-3 py-6 text-sm text-ink-faint">{t('rail.empty')}</li>
        ) : (
          folders.map((folder, index) => (
            <RailRow
              key={folder.id}
              blockRef={(element) => {
                if (element) blockRefs.current.set(index, element)
                else blockRefs.current.delete(index)
              }}
              headerRef={(element) => {
                if (element) headerRefs.current.set(folder.id, element)
                else headerRefs.current.delete(folder.id)
              }}
              onDragStart={(event) => folderReorder.onMouseDown(index, event)}
              dropTarget={folderReorder.isDropTarget(index)}
              dropAtEnd={folderReorder.dropAtEnd && index === folders.length - 1}
              dragged={folderReorder.drag?.fromIndex === index}
              item={{
                folderId: folder.id,
                name: folder.name,
                title: folder.path,
                /*
                  副標只說**非常態**的事。「含有 `openspec/`」是常態 —— 每一列都喊一次的訊息
                  不傳達任何資訊，只是噪音。因此有 openspec 時它沉默，只在**缺少**時附註；
                  分支則是常時呈現的事實。
                */
                subtitle:
                  folder.status === 'missing'
                    ? t('rail.pathMissing')
                    : [folder.branch, folder.hasOpenSpec ? null : t('rail.noOpenspec')]
                        .filter(Boolean)
                        .join(' · '),
                available: folder.status === 'ok',
                missingPath: folder.status === 'missing' ? folder.path : undefined,
                icon: <FolderIcon />,
              }}
              selected={folder.id === selectedFolderId(selection)}
              sessions={sessions.forFolder(folder.id)}
              focusedSessionId={sessions.focusedIdFor(folder.id)}
              expanded={!collapsed.has(folder.id)}
              onToggle={() => toggle(folder.id)}
              onSelect={() => onSelect(folder.id)}
              onSelectSession={(sessionId) => selectSession(folder.id, sessionId)}
              onCloseSession={sessions.close}
              onCreateSession={(spawnTarget) => createSession(folder.id, spawnTarget)}
              onRenameSession={sessions.rename}
              onReorderSessions={(fromIndex, toIndex) =>
                sessions.reorder(folder.id, fromIndex, toIndex)
              }
              onRemove={() => onRemove(folder.id)}
            />
          ))
        )}
      </ul>

      <button
        type="button"
        onClick={onAdd}
        className="m-2 cursor-pointer rounded border border-dashed border-hairline px-3 py-2 text-sm text-ink-dim hover:border-accent/40 hover:text-accent"
      >
        {t('rail.addFolder')}
      </button>
    </aside>
  )
}
