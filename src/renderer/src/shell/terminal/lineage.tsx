import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { sessionExists } from '../../../../shared/lineage/existence'
import { ContextMenu, type MenuItem } from '../files/dialogs'
import type { WorkspaceFolder } from '../types'
import { sessionTitle } from './session-badge'
import { useSessions, type SessionState } from './sessions'

/**
 * 交接關係在畫面上的呈現（`session-lineage`）：兩端的跳轉標示，以及「一個 session 存不存在」。
 *
 * **「存在」的規則只有一份**（`src/shared/lineage/existence.ts`）—— 主行程寫給 agent 的關係檔用
 * 的是同一個規則，於是畫面與 agent 看到的不會分歧。這裡只是把 renderer 的資料轉成它的輸入。
 */

interface LineageApi {
  /** 選中 session 所屬的 rail 項目並聚焦它。 */
  jumpTo(folderId: string | null, sessionId: string): void
  /** 某個 session 此刻存不存在。 */
  exists(session: SessionState): boolean
  /** rail 項目的名稱（`null` ＝ 全域，取自字典）。查無時回 `undefined`。 */
  itemName(folderId: string | null): string | undefined
}

const LineageContext = createContext<LineageApi | null>(null)

export function LineageProvider({
  folders,
  onSelectItem,
  children,
}: {
  folders: readonly WorkspaceFolder[]
  onSelectItem: (folderId: string | null) => void
  children: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  const sessions = useSessions()

  const jumpTo = useCallback(
    (folderId: string | null, sessionId: string) => {
      onSelectItem(folderId)
      sessions.focus(folderId, sessionId)
    },
    [onSelectItem, sessions],
  )

  const api = useMemo<LineageApi>(() => {
    const names = new Map(folders.map((folder) => [folder.id, folder.name]))
    return {
      jumpTo,
      exists: (session) =>
        sessionExists({
          inList: true,
          exited: session.status === 'exited',
          // 被移出 workspace 的 folder，其 session 可能仍在執行，但它已沒有 rail 入口 ——
          // 「畫面上點不到」與「關係中標為已關閉」要一致（`session-lineage`）。
          folderInWorkspace: session.folderId === null || names.has(session.folderId),
          provisional: false,
          ptyAlive: false,
        }),
      itemName: (folderId) => (folderId === null ? t('rail.globalName') : names.get(folderId)),
    }
  }, [folders, jumpTo, t])

  return <LineageContext.Provider value={api}>{children}</LineageContext.Provider>
}

export function useLineage(): LineageApi {
  const api = useContext(LineageContext)
  if (!api) throw new Error('useLineage must be used within LineageProvider')
  return api
}

/**
 * 一個 session 的兩個標示：來源（←）與子 session（→ N）。兩者皆不存在時不佔位。
 *
 * 畫面上只有圖示與數字（分頁的寬度塞不下句子），完整文字在 `aria-label`／`title`。**觸發標示
 * 不改變它所在的那一列的選取** —— 事件在這裡停止傳播。
 */
export function LineageMarkers({ session }: { session: SessionState }): React.JSX.Element | null {
  const { t } = useTranslation()
  const sessions = useSessions()
  const lineage = useLineage()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const all = sessions.all()
  const parentId = session.lineage?.parentId
  const parent = parentId ? all.find((candidate) => candidate.id === parentId) : undefined
  const parentAlive = parent !== undefined && lineage.exists(parent)
  const children = all.filter((candidate) => candidate.lineage?.parentId === session.id && lineage.exists(candidate))

  if (!session.lineage && children.length === 0) return null

  const describe = (target: SessionState): string =>
    t('lineage.item', { repo: lineage.itemName(target.folderId) ?? '', title: sessionTitle(target) })

  let source: { label: string; onActivate?: () => void } | null = null
  if (session.lineage) {
    if (parent && parentAlive) {
      source = {
        // **當前**的標籤 —— 母 session 改名之後，這裡跟著變。
        label: t('lineage.fromParent', { item: describe(parent) }),
        onActivate: () => lineage.jumpTo(parent.folderId, parent.id),
      }
    } else {
      // 快照。歸屬是三態，**未知不呈現為全域**。全域的名稱於此刻取自字典（不存字面值）。
      const origin = session.lineage.origin
      const repo =
        origin.kind === 'folder' ? origin.folderName : origin.kind === 'global' ? t('rail.globalName') : undefined
      const title = session.lineage.parentTitle
      source = {
        label:
          repo !== undefined && title
            ? t('lineage.fromClosed', { item: t('lineage.item', { repo, title }) })
            : repo !== undefined || title
              ? t('lineage.fromClosed', { item: repo ?? title })
              : t('lineage.fromUnknown'),
      }
    }
  }

  const stop = (event: React.SyntheticEvent): void => {
    event.stopPropagation()
  }

  const items: MenuItem[] = children.map((child) => ({
    label: describe(child),
    onSelect: () => {
      setMenu(null)
      lineage.jumpTo(child.folderId, child.id)
    },
  }))

  return (
    // **點擊也要停在這裡** —— 選單是這個 `<span>` 的子元件，React 的合成事件沿著元件樹冒泡
    // （與它畫在畫面哪裡無關），選一個子 session 的那次點擊會一路冒到這一列的 `onClick`，把焦點
    // 選回這一列的 session，蓋掉剛才的跳轉（探針抓到：選中項停在母 session 的 folder）。
    <span className="flex shrink-0 items-center gap-0.5 leading-none" onMouseDown={stop} onKeyDown={stop} onClick={stop}>
      {source && (
        <button
          type="button"
          aria-label={source.label}
          title={source.label}
          aria-disabled={source.onActivate ? undefined : 'true'}
          onClick={(event) => {
            event.stopPropagation()
            source?.onActivate?.()
          }}
          className={
            'rounded px-1 text-2xs leading-none ' +
            (source.onActivate ? 'cursor-pointer text-ink-faint hover:text-accent' : 'cursor-default text-ink-faint opacity-50')
          }
        >
          ←
        </button>
      )}
      {children.length > 0 && (
        <button
          type="button"
          aria-label={t('lineage.children', { count: children.length })}
          title={t('lineage.children', { count: children.length })}
          aria-haspopup="menu"
          onClick={(event) => {
            event.stopPropagation()
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
            setMenu({ x: rect.left, y: rect.bottom })
          }}
          className="cursor-pointer rounded px-1 text-2xs leading-none text-ink-faint hover:text-accent"
        >
          → {children.length}
        </button>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </span>
  )
}
