import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { t } from '@shared/i18n'
import { useWorktreeRoots } from '../openspec/data'
import type { FileRequest, OpenSpecTarget } from '../openspec/nav'
import { targetOfPath } from '../openspec/nav'
import type { FsFailure, FsResult, WorkspaceFolder, WorktreeOption } from '../types'
import { ConfirmDelete, ContextMenu, type MenuItem, NameDialog } from './dialogs'
import { FileTree } from './FileTree'
import { FileViewer } from './FileViewer'
import { WorktreePicker } from './WorktreePicker'
import { useNow } from '../useNow'
import { useDirtyBuffers } from './dirty-buffers'
import { ROOT_PATH, baseNameOf, joinRelPath, parentOf, stripRoot } from './paths'
import { type TreeRow, useFileTree, describeFailure } from './useFileTree'

/** 檔案操作的失敗要說得出原因。UI 讀 `code`，不解析錯誤訊息。 */
function describeOperationFailure(failure: FsFailure): string {
  switch (failure.code) {
    case 'ALREADY_EXISTS':
      return t('files.failure.alreadyExists')
    case 'INVALID_NAME':
      return t('files.failure.invalidName')
    case 'NOT_FOUND':
      return t('files.failure.notFound')
    case 'ESCAPES_ROOT':
      return t('files.failure.escapesRoot')
    case 'PROTECTED_ROOT':
      return t('files.failure.protectedRoot')
    default:
      return failure.message
  }
}

/** 穩定的空陣列 —— 每次渲染新造一個會讓下游的依賴比較失效。 */
const EMPTY_ROOTS: readonly string[] = []
const EMPTY_WORKTREES: WorktreeOption[] = []

type Dialog =
  | { kind: 'newFile' | 'newDirectory'; parent: string }
  | { kind: 'rename'; target: string }

interface MenuState {
  /** `null` 代表 folder 的根目錄 —— 它在樹上沒有對應的列。 */
  row: TreeRow | null
  x: number
  y: number
}

interface FilesPanelProps {
  folder: WorkspaceFolder | null
  /** 自 OpenSpec 身分跳過來要開的檔案（design D7 的跨身分導航）。 */
  request?: FileRequest | null
  /** 跳回 OpenSpec 身分。該 folder 沒有 `openspec/` 時為 null —— 那個身分本來就停用。 */
  onViewInOpenSpec?: ((target: OpenSpecTarget) => void) | null
  /**
   * 檔案樹的根（`side-panel-worktree`）。空字串 ＝ folder 自身。
   *
   * **由呼叫端解析並用於 key** —— 換工作目錄等於換一棵樹，而查表需要一次非同步的清單，
   * 在這裡解析會讓樹先以 folder 根建起來、清單到達後再整棵換掉。
   */
  rootPrefix?: string
  /** 可供選擇的工作目錄。恰一筆時選擇器不呈現。 */
  worktrees?: WorktreeOption[]
  /** 當前選定者的識別碼；`undefined` ＝ folder 自身。 */
  worktreeKey?: string
  /** 使用者經選擇器切換工作目錄。 */
  onSelectWorktree?: (worktreeKey: string | undefined) => void
  /** 有 focused session 才能改工作目錄（per-session 狀態）。 */
}

/**
 * side panel 的 Files 身分。
 *
 * 它有兩個**狀態**（樹、單一檔案），不是兩個並列的區域 —— side panel 的寬度不足以
 * 同時容納兩者。換頁而非開新 tab：主舞台屬於 terminal，檔案檢視是它旁邊的上下文。
 *
 * `useFileTree` 一律保持掛載（即使正在看檔案）—— 監看集合由它持有，卸載它會連帶撤掉
 * 檔案所在目錄的監看，檢視器就再也收不到「檔案已變更」。
 *
 * 呼叫端以 `folder.id` 為 key 掛載本元件，因此換 folder 時展開狀態與開啟的檔案
 * 隨重新掛載自然歸零。**未存的變更不在此列** —— 它們由 `DirtyBuffersProvider` 持有，
 * 位於本元件之上（design D9）。
 */
export function FilesPanel({
  folder,
  request = null,
  onViewInOpenSpec = null,
  rootPrefix = ROOT_PATH,
  worktrees = EMPTY_WORKTREES,
  worktreeKey,
  onSelectWorktree,
}: FilesPanelProps): React.JSX.Element {
  const { t } = useTranslation()

  // 反向交叉導覽的判定依據：該 repo 各工作目錄的 folder-relative 根。
  //
  // **清單抵達之前不呈現入口**（`data` 為 null → 空陣列 → `targetOfPath` 恆為 null）。
  // 它是一次 per-folder 的 IPC，於是首次進入 Files 身分時入口會晚一拍出現 —— 那是可接受的
  // 窗口，換來的是「切換檔案時零 IPC 往返」（design D1）。
  //
  // **沒有 `openspec/` 的 folder 不取**：入口的 gate 本來就是 `hasOpenSpec`（`SidePanel` 於該
  // 情形傳 `onViewInOpenSpec = null`），清單取了也用不到 —— 而取它會走 `#scan`，那條路上
  // core 會 spawn `git worktree list`。此前只用 Files 身分的 folder 不會付這個成本。
  const worktreeRoots =
    useWorktreeRoots(folder?.hasOpenSpec ? folder.id : null).data ?? EMPTY_ROOTS

  // 自 OpenSpec 身分跳過來的請求，**初始值就要套用**。
  //
  // 這個元件在切到 Files 身分的那一刻才第一次掛載（在那之前 SidePanel 渲染的是 OpenSpecPanel）
  // —— 若只在「nonce 變了」時才開檔，首次掛載會把 seenNonce 直接初始化成當下的 nonce，
  // 兩者相等，於是**跳過去的那一次永遠不會開檔**（已實測：探針點了「在 Files 中開啟」，
  // 身分切過去了，但畫面停在檔案樹）。
  const [openPath, setOpenPath] = useState<string | null>(request?.target ?? null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [pendingDelete, setPendingDelete] = useState<TreeRow | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const now = useNow()

  // 已掛載時的後續請求依 nonce 觸發（同一個檔案可能被連續要求開兩次）。在渲染期間調整自己的
  // state，不用 effect：effect 要等 commit 之後才跑，那一幀會先閃一下樹。
  const requestNonce = request?.nonce ?? null
  const [seenNonce, setSeenNonce] = useState(requestNonce)

  if (requestNonce !== seenNonce) {
    setSeenNonce(requestNonce)
    if (request) setOpenPath(request.target)
  }

  const dirty = useDirtyBuffers()
  const folderId = folder?.id ?? ''

  const openFile = useCallback((relPath: string) => setOpenPath(relPath), [])
  const tree = useFileTree(folder?.id ?? null, rootPrefix, openFile)

  /**
   * **使用者主動**切換工作目錄 —— 關閉開啟中的檔案，回到樹。
   *
   * 觸發點是選擇器的選取事件，**不是工作目錄狀態的變更**：跨身分導覽也會切換工作目錄，而它
   * 緊接著就要開一個檔案，兩者若共用觸發點會變成「開了又關」（design D7）。
   */
  const selectWorktree = useCallback(
    (key: string | undefined) => {
      setOpenPath(null)
      onSelectWorktree?.(key)
    },
    [onSelectWorktree],
  )

  const closeMenu = useCallback(() => setMenu(null), [])
  const closeDialog = useCallback(() => {
    setDialog(null)
    setServerError(null)
  }, [])

  const openContextMenu = useCallback((row: TreeRow, x: number, y: number) => {
    setMenu({ row, x, y })
  }, [])

  /** 統一處理失敗：留在對話框裡把原因說出來，而不是靜默關閉。 */
  const run = useCallback(
    async (result: Promise<FsResult<void>>, onSuccess: () => void): Promise<void> => {
      const outcome = await result
      if (!outcome.ok) {
        setServerError(describeOperationFailure(outcome))
        return
      }
      setServerError(null)
      onSuccess()
    },
    [],
  )

  const submitDialog = useCallback(
    (name: string): void => {
      if (!folder || !dialog) return

      if (dialog.kind === 'rename') {
        const to = joinRelPath(parentOf(dialog.target), name)
        void run(window.workspace.fs.rename(folder.id, dialog.target, to), () => {
          // 未存的變更跟著新的路徑走；改到目錄時，其下的 buffer 一併重寫。
          dirty.moveBuffer(folder.id, dialog.target, to)
          if (openPath === dialog.target) setOpenPath(to)
          else if (openPath?.startsWith(`${dialog.target}/`)) {
            setOpenPath(`${to}${openPath.slice(dialog.target.length)}`)
          }
          closeDialog()
        })
        return
      }

      const relPath = joinRelPath(dialog.parent, name)
      const create =
        dialog.kind === 'newFile'
          ? window.workspace.fs.createFile(folder.id, relPath)
          : window.workspace.fs.createDirectory(folder.id, relPath)

      void run(create, closeDialog)
    },
    [closeDialog, dialog, dirty, folder, openPath, run],
  )

  const confirmDelete = useCallback((): void => {
    if (!folder || !pendingDelete) return
    const { relPath } = pendingDelete

    void run(window.workspace.fs.deleteEntry(folder.id, relPath), () => {
      // 目標沒了，它底下的未存變更也就沒有歸宿。
      dirty.discardUnder(folder.id, relPath)
      if (openPath === relPath || openPath?.startsWith(`${relPath}/`)) setOpenPath(null)
      setPendingDelete(null)
    })
  }, [dirty, folder, openPath, pendingDelete, run])

  if (!folder) {
    return (
      <section
        aria-label={t('files.label')}
        className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-faint"
      >
        {t('stage.noRepoHint')}
      </section>
    )
  }

  const dirtyCount = dirty.countFor(folderId)

  // 目錄的新增目標是它自己，檔案的新增目標是它的父目錄。根目錄由 header 的入口負責。
  const menuItems = ((): MenuItem[] => {
    if (!menu) return []
    const row = menu.row
    // 根層的新增以**當前樹根**為目標，不是 folder 根 —— 否則選定工作目錄後，於根新增的檔案會
    // 落在當下可見的樹之外，使用者看到的是「按了沒反應」（`file-operations` 的 delta）。
    const parent = row === null ? rootPrefix : row.kind === 'directory' ? row.relPath : parentOf(row.relPath)

    const items: MenuItem[] = [
      {
        label: t('files.newFile'),
        onSelect: () => {
          setDialog({ kind: 'newFile', parent })
          closeMenu()
        },
      },
      {
        label: t('files.newDirectory'),
        onSelect: () => {
          setDialog({ kind: 'newDirectory', parent })
          closeMenu()
        },
      },
    ]

    if (row) {
      items.push(
        {
          label: t('files.rename'),
          onSelect: () => {
            setDialog({ kind: 'rename', target: row.relPath })
            closeMenu()
          },
        },
        {
          label: t('common.delete'),
          tone: 'danger',
          onSelect: () => {
            setPendingDelete(row)
            closeMenu()
          },
        },
      )
    }

    return items
  })()

  return (
    <section aria-label={t('files.label')} className="relative flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-hairline px-3 py-2 text-sm">
        <nav
          aria-label={t('files.pathNav')}
          className="flex min-w-0 flex-1 items-center truncate text-ink-faint"
        >
          <span className="shrink-0">{folder.name}</span>
          <span className="px-1">/</span>
          {/* 工作目錄在概念上正介於 repo 與檔案路徑之間 —— 放在這裡，它自己就說明了
              「路徑自這裡算起」。恰一筆時 `WorktreePicker` 回 null，麵包屑退回原樣。 */}
          <WorktreePicker
            worktrees={worktrees}
            selectedKey={worktreeKey}
            onSelect={selectWorktree}
          />
          {worktrees.length > 1 && <span className="px-1">/</span>}
          {openPath === null ? (
            <span className="text-ink">{t('files.breadcrumbRoot')}</span>
          ) : (
            <>
              {/* `aria-label` 不只是無障礙 —— 麵包屑裡現在有兩顆按鈕（工作目錄選擇器排在前面），
                  「nav 裡的第一個 button」不再指向這一顆。 */}
              <button
                type="button"
                aria-label={t('files.backToTree')}
                onClick={() => setOpenPath(null)}
                className="shrink-0 text-ink-dim underline decoration-dotted underline-offset-2 hover:text-accent"
              >
                {t('files.breadcrumbRoot')}
              </button>
              <span className="px-1">/</span>
              {/* 顯示剝掉樹根前綴，**`title` 留完整路徑** —— 它同時是探針的選擇器，而對使用者
                  而言 title 的作用本來就是「看完整位置」，兩邊在此不衝突（design D6）。 */}
              <span className="truncate text-ink" title={openPath}>
                {stripRoot(rootPrefix, openPath)}
              </span>
            </>
          )}
        </nav>

        {/* 未存的檔案可能藏在一個尚未展開的目錄裡，樹上的標記那時看不到。 */}
        {dirtyCount > 0 && (
          <span className="shrink-0 text-2xs text-accent" title={t('files.unsaved')}>
            ● {dirtyCount}
          </span>
        )}

        {openPath === null ? (
          <>
            <span className="shrink-0 font-mono text-2xs text-ink-faint">
              {t('files.itemCount', { count: tree.visibleCount })}
            </span>
            {/* 根目錄在樹上沒有列可以右鍵，因此入口在這裡。 */}
            <button
              type="button"
              aria-label={t('files.newAtRoot')}
              title={t('files.newAtRoot')}
              onClick={(event) => {
                event.stopPropagation()
                setMenu({ row: null, x: event.clientX, y: event.clientY })
              }}
              className="shrink-0 rounded border border-hairline px-2 py-[2px] text-xs text-ink-dim hover:text-accent"
            >
              ＋
            </button>
          </>
        ) : (
          <>
            {/* 開著的是某個工作目錄的 openspec/ 底下的檔案 —— 提供跳回 OpenSpec 身分的入口。 */}
            {onViewInOpenSpec &&
              (() => {
                const target = targetOfPath(openPath, worktreeRoots)
                if (!target) return null
                return (
                  <button
                    type="button"
                    onClick={() => onViewInOpenSpec(target)}
                    aria-label={t('files.viewInOpenSpec')}
                    title={t('files.viewInOpenSpec')}
                    className="shrink-0 rounded border border-hairline px-2 py-[2px] text-xs text-ink-dim hover:border-accent hover:text-accent"
                  >
                    ◈
                  </button>
                )
              })()}

            <button
              type="button"
              onClick={() => setOpenPath(null)}
              className="shrink-0 rounded border border-hairline px-2 py-[2px] text-xs text-ink-dim hover:text-accent"
            >
              {t('common.back')}
            </button>
          </>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {openPath === null ? (
          <div className="h-full overflow-auto px-1 py-1">
            {tree.rootError ? (
              <p className="px-3 py-2 text-sm text-danger">{describeFailure(tree.rootError)}</p>
            ) : tree.rootLoading && tree.rows.length === 0 ? (
              <p className="px-3 py-2 text-sm text-ink-faint">{t('common.loading')}</p>
            ) : (
              <FileTree
                rows={tree.rows}
                now={now}
                dirtyPaths={dirty.pathsFor(folderId)}
                onActivate={tree.activate}
                onContextMenu={openContextMenu}
              />
            )}
          </div>
        ) : (
          // key：換檔案等於換一份內容，讓它重新掛載而非在 effect 裡把狀態清乾淨
          <FileViewer key={openPath} folderId={folder.id} relPath={openPath} />
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}

      {dialog && (
        <NameDialog
          title={
            dialog.kind === 'rename'
              ? t('files.rename')
              : dialog.kind === 'newFile'
                ? t('files.newFile')
                : t('files.newDirectory')
          }
          initialValue={dialog.kind === 'rename' ? baseNameOf(dialog.target) : ''}
          serverError={serverError}
          onSubmit={submitDialog}
          onCancel={closeDialog}
        />
      )}

      {pendingDelete && (
        <ConfirmDelete
          relPath={pendingDelete.relPath}
          isDirectory={pendingDelete.kind === 'directory'}
          hasUnsaved={dirty.hasUnsavedUnder(folderId, pendingDelete.relPath)}
          onConfirm={confirmDelete}
          onCancel={() => {
            setPendingDelete(null)
            setServerError(null)
          }}
        />
      )}

      {serverError && !dialog && (
        <p className="border-t border-hairline px-3 py-2 text-xs text-danger">{serverError}</p>
      )}
    </section>
  )
}
