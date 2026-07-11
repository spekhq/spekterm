import { useCallback, useRef, useState } from 'react'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { useChanges } from './openspec/data'
import { VizOverlay, type VizKind } from './openspec/VizOverlay'
import type { FileRequest, OpenSpecRequest, OpenSpecTarget } from './openspec/nav'
import { PanelSwitch } from './side-panel/PanelSwitch'
import { SidePanel } from './side-panel/SidePanel'
import { SessionTabs } from './terminal/SessionTabs'
import { TerminalView } from './terminal/TerminalView'
import { TitleConflictDialog } from './terminal/TitleConflictDialog'
import { useSessions } from './terminal/sessions'
import type { PanelIdentity, SpawnTarget, WorkspaceFolder } from './types'

interface MainStageProps {
  folder: WorkspaceFolder | null
}

export function MainStage({ folder }: MainStageProps): React.JSX.Element {
  const sidePanelRef = usePanelRef()
  const [collapsed, setCollapsed] = useState(false)
  // 預設身分是 OpenSpec —— 雛型的預設，也是這個工作台的主張：使用者加入一個有 openspec/ 的
  // repo，預期看到的是它的 spec 與 change，而不是一棵他在 IDE 裡已經看膩的檔案樹。
  // （Phase 2 曾暫設為 Files，理由是 OpenSpec 身分還沒有內容 —— 該理由已不復存在。）
  const [identity, setIdentity] = useState<PanelIdentity>('openspec')
  const [sessionError, setSessionError] = useState<string | null>(null)

  // 跨身分導航的請求（design D7）。nonce 讓「連續兩次跳到同一個目標」也能觸發。
  const [fileRequest, setFileRequest] = useState<FileRequest | null>(null)
  const [openSpecRequest, setOpenSpecRequest] = useState<OpenSpecRequest | null>(null)
  const nonce = useRef(0)

  /** 沒有任何 session 時，「本 change」看的是哪個 change —— 錨定無處可去，改由 folder 持有。 */
  const [viewing, setViewing] = useState<ReadonlyMap<string, string>>(() => new Map())

  /** 全視窗 overlay 的 Graph／Timeline（design D12）。null＝沒開。 */
  const [viz, setViz] = useState<VizKind | null>(null)

  // 換 folder 就把待處理的跨身分請求丟掉 —— 它是**上一個 repo** 的座標。
  //
  // 少了這步，切到新 repo 時側欄會停在「顯示某個 spec」的視圖，而那個 spec 屬於前一個 repo
  //（側欄的兩個面板都以 folder.id 為 key 重新掛載，於是又把舊請求當成初始值套用了一次）。
  const [seenFolder, setSeenFolder] = useState<string | null>(folder?.id ?? null)
  if ((folder?.id ?? null) !== seenFolder) {
    setSeenFolder(folder?.id ?? null)
    setFileRequest(null)
    setOpenSpecRequest(null)
  }

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

  const folderSessions = folder ? sessions.forFolder(folder.id) : []
  const focusedId = folder ? sessions.focusedIdFor(folder.id) : null
  // 使用者取了名字、而 pty 想改成別的 —— 由他裁決。同時至多一個（design D2）。
  const pending = folder ? sessions.pendingFor(folder.id) : null

  // 新 session 的初始錨定：該 folder **恰有一個** active change 時錨定它，否則留空。
  // 多個候選之間不猜 —— 猜錯的側欄比沒有側欄更糟（design D3）。
  const { data: changes } = useChanges(folder?.hasOpenSpec ? folder.id : null)
  const soleActiveChange =
    changes && changes.active.length === 1 ? changes.active[0].slug : undefined

  const createSession = useCallback(
    (spawnTarget: SpawnTarget) => {
      if (!folder) return
      setSessionError(null)
      void sessions.create(folder.id, spawnTarget, soleActiveChange).then((outcome) => {
        if (outcome.status === 'failed') setSessionError(outcome.failure.message)
      })
    },
    [folder, sessions, soleActiveChange],
  )

  const focusSession = useCallback(
    (sessionId: string) => {
      if (!folder) return
      sessions.focus(folder.id, sessionId)
    },
    [folder, sessions],
  )

  /**
   * 側欄「本 change」看的是哪個 change。三層優先序：
   *
   * 1. **focused session 的錨定**（使用者在 Changes 點的那個）。
   * 2. 沒有 session 時，folder 層的檢視狀態（同樣是使用者點的）。
   * 3. **該 folder 恰有一個 active change 時，就是它。**
   *
   * 第 3 層是**衍生的預設值，不是建立 session 時的快照**。原本只在 `sessions.create` 時帶入
   * 初始錨定 —— 於是「選了 repo 但還沒開 session」時側欄一片空白，即使那個 repo 只有一個
   * active change（實測踩到）。而且它還與資料載入賽跑：session 建得比 `useChanges` 回來還快，
   * 就什麼都錨不到。
   *
   * 「恰有一個」不算猜（design D3）—— 有多個候選時仍然留空，讓使用者自己挑。
   */
  const explicitAnchor = focusedId
    ? sessions.anchoredChangeOf(focusedId)
    : folder
      ? (viewing.get(folder.id) ?? null)
      : null

  const anchoredChange = explicitAnchor ?? soleActiveChange ?? null

  const anchorChange = useCallback(
    (slug: string) => {
      if (focusedId) {
        sessions.anchorChange(focusedId, slug)
        return
      }
      if (!folder) return
      setViewing((previous) => new Map(previous).set(folder.id, slug))
    },
    [focusedId, folder, sessions],
  )

  /** OpenSpec → Files：切到 Files 身分並開啟該檔。 */
  const openFileFromOpenSpec = useCallback(
    (relPath: string) => {
      nonce.current += 1
      setFileRequest({ target: relPath, nonce: nonce.current })
      setIdentity('files')
      expandSidePanel()
    },
    [expandSidePanel],
  )

  /**
   * Files → OpenSpec：切到 OpenSpec 身分並呈現該 spec／change。
   *
   * change 的錨定在**這裡**完成，不由 `OpenSpecPanel` 收到請求後回呼 —— 它是在渲染期間套用
   * 請求的，而在渲染期間呼叫父層的 setState 是不允許的。
   */
  const viewInOpenSpec = useCallback(
    (target: OpenSpecTarget) => {
      nonce.current += 1
      setOpenSpecRequest({ target, nonce: nonce.current })
      setIdentity('openspec')
      expandSidePanel()
      if (target.kind === 'change') anchorChange(target.slug)
    },
    [anchorChange, expandSidePanel],
  )

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
          onRename={sessions.rename}
          onReorder={(fromIndex, toIndex) => sessions.reorder(folder.id, fromIndex, toIndex)}
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

              **掛載順序刻意與「顯示順序」脫鉤**（以 id 穩定排序）。終端是疊在一起的、只有
              focused 的那個可見，DOM 的先後本來就沒有意義；但若讓它跟著拖曳排序走，React 會
              用 insertBefore **搬動 xterm 的 DOM 節點**，而 xterm 一旦被移動，畫面就會空掉
              （直到有新輸出或 resize 才重繪）—— 實測：拖曳後點回某個 session 是一片空白，
              隨便打個字才冒出來。
            */}
            {[...sessions.all()]
              .sort((a, b) => a.id.localeCompare(b.id))
              .map((session) => (
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

            {pending && (
              <TitleConflictDialog
                session={pending}
                onAccept={() => sessions.acceptPendingTitle(pending.id)}
                onKeep={() => sessions.keepCustomTitle(pending.id)}
              />
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
            <SidePanel
              identity={activeIdentity}
              folder={folder}
              anchoredChange={anchoredChange}
              onAnchor={anchorChange}
              onOpenFile={openFileFromOpenSpec}
              onViewInOpenSpec={viewInOpenSpec}
              fileRequest={fileRequest}
              openSpecRequest={openSpecRequest}
              onOpenViz={setViz}
            />
          </section>
        </Panel>
      </Group>

      {viz && folder && (
        <VizOverlay
          folderId={folder.id}
          folderName={folder.name}
          kind={viz}
          onChangeKind={setViz}
          onClose={() => setViz(null)}
          /*
            在圖上選一個 change＝關閉 overlay 並讓側欄**呈現**它 —— 不只是錨定。
            光呼叫 `anchorChange` 是不夠的：側欄可能正停在「瀏覽」視圖，於是使用者點完之後
            什麼也沒發生（實測被探針抓到）。走跨身分導航這條路，它會一併把視圖切回本 change。
          */
          onSelectChange={(slug) => {
            setViz(null)
            viewInOpenSpec({ kind: 'change', slug })
          }}
          onSelectSpec={(topic) => {
            setViz(null)
            viewInOpenSpec({ kind: 'spec', topic })
          }}
        />
      )}
    </main>
  )
}
