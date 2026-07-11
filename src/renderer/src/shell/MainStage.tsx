import { useCallback, useState } from 'react'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { PanelSwitch } from './side-panel/PanelSwitch'
import { SidePanel } from './side-panel/SidePanel'
import { SessionTabs } from './terminal/SessionTabs'
import { TerminalView } from './terminal/TerminalView'
import { useSessions } from './terminal/sessions'
import type { PanelIdentity, SpawnTarget, WorkspaceFolder } from './types'

interface MainStageProps {
  folder: WorkspaceFolder | null
}

export function MainStage({ folder }: MainStageProps): React.JSX.Element {
  const sidePanelRef = usePanelRef()
  const [collapsed, setCollapsed] = useState(false)
  const [identity, setIdentity] = useState<PanelIdentity>('files')
  const [sessionError, setSessionError] = useState<string | null>(null)

  const sessions = useSessions()

  const openSpecEnabled = folder?.hasOpenSpec ?? false
  // 選中的 repo 若沒有 openspec/，OpenSpec 身分不可用 —— 由衍生值退回 Files，
  // 而不是用一個 effect 去改狀態（那會多渲染一次，且順序難以推理）。
  const activeIdentity: PanelIdentity =
    identity === 'openspec' && !openSpecEnabled ? 'files' : identity

  // 拖到最小寬度以下時 Panel 會自行收合，因此收合狀態以實際尺寸為準，不靠按鈕自行記帳
  const syncCollapsed = useCallback((size: { inPixels: number }) => {
    setCollapsed(size.inPixels === 0)
  }, [])

  const expandSidePanel = useCallback(() => {
    const panel = sidePanelRef.current
    if (panel?.isCollapsed()) panel.expand()
  }, [sidePanelRef])

  const toggleSidePanel = useCallback(() => {
    const panel = sidePanelRef.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
  }, [sidePanelRef])

  const selectIdentity = useCallback(
    (next: PanelIdentity) => {
      setIdentity(next)
      // 收合狀態下點任一身分，都該把面板帶回來（雛型的 togglePanel(true)）
      expandSidePanel()
    },
    [expandSidePanel],
  )

  const createSession = useCallback(
    (spawnTarget: SpawnTarget) => {
      if (!folder) return
      setSessionError(null)
      void sessions.create(folder.id, spawnTarget).then((outcome) => {
        if (outcome.status === 'failed') setSessionError(outcome.failure.message)
      })
    },
    [folder, sessions],
  )

  const focusSession = useCallback(
    (sessionId: string) => {
      if (!folder) return
      sessions.focus(folder.id, sessionId)
    },
    [folder, sessions],
  )

  const folderSessions = folder ? sessions.forFolder(folder.id) : []
  const focusedId = folder ? sessions.focusedIdFor(folder.id) : null

  return (
    <main aria-label="主舞台" className="flex h-full flex-col bg-stage">
      <header className="flex items-center gap-3 border-b border-hairline px-4 py-2 text-sm">
        <span className={folder ? 'text-ink' : 'text-ink-faint'}>
          {folder ? folder.name : '尚未選擇 repo'}
        </span>
        {folder && <span className="truncate text-xs text-ink-faint">{folder.path}</span>}

        <span className="flex-1" />

        <PanelSwitch
          active={activeIdentity}
          openSpecEnabled={openSpecEnabled}
          onSelect={selectIdentity}
        />

        <button
          type="button"
          onClick={toggleSidePanel}
          aria-expanded={!collapsed}
          aria-label={collapsed ? '展開 side panel' : '收合 side panel'}
          title={collapsed ? '展開 side panel' : '收合 side panel'}
          className="rounded border border-hairline px-2 py-1 text-xs text-ink-dim hover:text-accent"
        >
          {collapsed ? '▤ 展開' : '▤ 收合'}
        </button>
      </header>

      {/* 分頁列只屬於當前選中的 repo（mockup 的 .session-tabs）。 */}
      {folder && (
        <SessionTabs
          sessions={folderSessions}
          focusedId={focusedId}
          onFocus={focusSession}
          onClose={sessions.close}
          onCreate={createSession}
          error={sessionError}
        />
      )}

      <Group orientation="horizontal" className="flex-1">
        <Panel minSize="240px">
          <section aria-label="Terminal" className="relative h-full bg-shell">
            {/*
              **掛載所有 folder 的所有 session**，只讓當前 folder 的 focused 那一個顯示。
              若只掛載當前 folder 的，切走再切回時 xterm 實例已被卸載，scrollback 就沒了
              （design D7）。
            */}
            {sessions.all().map((session) => (
              <TerminalView
                key={session.id}
                sessionId={session.id}
                active={session.folderId === folder?.id && session.id === focusedId}
              />
            ))}

            {!focusedId && (
              <div className="flex h-full items-center justify-center text-xs text-ink-faint">
                {folder ? '以 + session 開一個終端' : '尚未選擇 repo'}
              </div>
            )}
          </section>
        </Panel>

        <Separator className="w-[3px] cursor-col-resize bg-hairline transition-colors hover:bg-accent" />

        <Panel
          collapsible
          collapsedSize={0}
          minSize="240px"
          defaultSize="34%"
          panelRef={sidePanelRef}
          onResize={syncCollapsed}
        >
          {/* 視覺分界由 Separator 提供；此處若再加 border-l，收合後會殘留一條 1px 的線 */}
          <section aria-label="Side panel" className="h-full overflow-hidden bg-panel">
            <SidePanel identity={activeIdentity} folder={folder} />
          </section>
        </Panel>
      </Group>
    </main>
  )
}
