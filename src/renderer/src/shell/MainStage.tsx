import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { type ContinuationBlock, continuationCommand } from './openspec/continuation'
import { useChanges } from './openspec/data'
import { VizOverlay, type VizKind } from './openspec/VizOverlay'
import type { FileRequest, OpenSpecRequest, OpenSpecTarget } from './openspec/nav'
import { PanelSwitch } from './side-panel/PanelSwitch'
import { SidePanel } from './side-panel/SidePanel'
import { SessionTabs } from './terminal/SessionTabs'
import { TerminalView } from './terminal/TerminalView'
import { useSessions } from './terminal/sessions'
import type { PanelIdentity, SpawnTarget, WorkspaceFolder } from './types'

interface MainStageProps {
  /** rail 的 focused folder —— 「駕駛」那半（header、session 分頁、terminal）。 */
  folder: WorkspaceFolder | null
  /** workspace 的所有 folder —— 來源指示器的下拉清單。 */
  folders: WorkspaceFolder[]
}

export function MainStage({ folder, folders }: MainStageProps): React.JSX.Element {
  const { t } = useTranslation()
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

  const sessions = useSessions()

  // **「駕駛」那半：focusedFolder。** header 的 name/path、session 分頁與 terminal 一律以它為準
  // —— 側欄指向另一個 repo 時，這一半完全不受影響（`side-panel-source`）。
  const focusedFolder = folder
  const folderSessions = focusedFolder ? sessions.forFolder(focusedFolder.id) : []
  const focusedId = focusedFolder ? sessions.focusedIdFor(focusedFolder.id) : null

  // **「讀」那半：panelFolder。** side panel 呈現 focused session 的側欄來源；沒有 session 時
  // 退回 focusedFolder。來源指向的 folder 已被移除時（`find` 找不到）同樣退回 focusedFolder ——
  // 那正是 session 自己的 folder（focused session 屬於 focusedFolder），與 spec 的 fallback 一致。
  const panelSourceId = sessions.panelSourceOf(focusedId)
  const panelFolder =
    (panelSourceId ? folders.find((candidate) => candidate.id === panelSourceId) : null) ??
    focusedFolder

  // 換側欄來源（切 rail focus 或改 panelSource 皆會改變 panelFolder）就把待處理的跨身分請求丟掉
  // —— 它是**上一個側欄來源**的座標。少了這步，切到新來源時側欄會停在「顯示某個 spec」的視圖，
  // 而那個 spec 屬於前一個 repo（側欄兩個面板都以 panelFolder.id 為 key 重新掛載，於是又把舊請求
  // 當成初始值套用了一次）。
  const [seenPanelFolder, setSeenPanelFolder] = useState<string | null>(panelFolder?.id ?? null)
  if ((panelFolder?.id ?? null) !== seenPanelFolder) {
    setSeenPanelFolder(panelFolder?.id ?? null)
    setFileRequest(null)
    setOpenSpecRequest(null)
  }

  const openSpecEnabled = panelFolder?.hasOpenSpec ?? false
  // 側欄來源若沒有 openspec/，OpenSpec 身分不可用 —— 由衍生值退回 Files，
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

  /**
   * **休眠的 session 於首次被顯示時才 spawn**（design D11）。
   *
   * 「被顯示」＝所屬 folder 被選中 **且** 它是該 folder 的 focused session —— 也就是下面那個
   * `active` 的判準。於是「重開 app 只起一個 claude」不是一條特例規則，而是這條規則的自然結果：
   * 啟動當下恰好只有一個 session 被顯示。
   *
   * 休眠與否在這裡判斷（`displayed` 是這一次渲染的狀態），不在 `wake` 裡從 ref 判斷 —— 那個 ref
   * 由 provider 的一個 effect 更新，而 effect 由內而外執行，這裡會早於它。
   */
  const displayed = focusedId ? folderSessions.find((s) => s.id === focusedId) : undefined
  const wake = sessions.wake
  useEffect(() => {
    if (displayed?.status === 'dormant' && !displayed.wakeError) wake(displayed.id)
  }, [displayed?.id, displayed?.status, displayed?.wakeError, wake])

  // 新 session 的初始錨定：新 session 建在 **focusedFolder**，該 folder 恰有一個 active change
  // 時錨定它，否則留空。多個候選之間不猜 —— 猜錯的側欄比沒有側欄更糟（design D3）。
  const { data: focusedChanges } = useChanges(focusedFolder?.hasOpenSpec ? focusedFolder.id : null)
  const soleActiveChangeForCreate =
    focusedChanges && focusedChanges.active.length === 1 ? focusedChanges.active[0].slug : undefined

  // 側欄「本 change」的衍生預設：以 **panelFolder**（側欄來源）為準 —— 側欄來源恰有一個 active
  // change 時就是它。跨 repo 時，這與「新 session 建在 focusedFolder」是兩個不同的 folder。
  const { data: panelChanges } = useChanges(panelFolder?.hasOpenSpec ? panelFolder.id : null)
  const soleActiveChangeForPanel =
    panelChanges && panelChanges.active.length === 1 ? panelChanges.active[0].slug : undefined

  const createSession = useCallback(
    (spawnTarget: SpawnTarget) => {
      if (!focusedFolder) return
      setSessionError(null)
      void sessions.create(focusedFolder.id, spawnTarget, soleActiveChangeForCreate).then(
        (outcome) => {
          if (outcome.status === 'failed') setSessionError(outcome.failure.message)
        },
      )
    },
    [focusedFolder, sessions, soleActiveChangeForCreate],
  )

  const focusSession = useCallback(
    (sessionId: string) => {
      if (!focusedFolder) return
      sessions.focus(focusedFolder.id, sessionId)
    },
    [focusedFolder, sessions],
  )

  /**
   * 側欄「本 change」看的是哪個 change。三層優先序：
   *
   * 1. **focused session 的錨定**（使用者在 Changes 點的那個；隸屬於 session 的側欄來源）。
   * 2. 沒有 session 時，panelFolder 層的檢視狀態（同樣是使用者點的）。
   * 3. **側欄來源恰有一個 active change 時，就是它。**
   *
   * 第 3 層是**衍生的預設值**，以 panelFolder 為準（見上 `soleActiveChangeForPanel`）。
   */
  const explicitAnchor = focusedId
    ? sessions.anchoredChangeOf(focusedId)
    : panelFolder
      ? (viewing.get(panelFolder.id) ?? null)
      : null

  const anchoredChange = explicitAnchor ?? soleActiveChangeForPanel ?? null

  const anchorChange = useCallback(
    (slug: string) => {
      if (focusedId) {
        sessions.anchorChange(focusedId, slug)
        return
      }
      if (!panelFolder) return
      setViewing((previous) => new Map(previous).set(panelFolder.id, slug))
    },
    [focusedId, panelFolder, sessions],
  )

  /**
   * 續寫入口能不能用 —— 三個條件全部成立才行（`artifact-continuation` 的 spec）。
   *
   * 條件的順序就是回報原因的優先序：先看有沒有對象，再看它是不是對的對象。
   */
  const continuationBlock: ContinuationBlock | null =
    !displayed || !focusedFolder
      ? 'noSession'
      : panelFolder?.id !== displayed.folderId
        ? 'foreignSource'
        : displayed.spawnTarget !== 'claude'
          ? 'notClaude'
          : displayed.status !== 'running'
            ? 'notRunning'
            : null

  /**
   * 把續寫指示送進 focused session 的 pty 並執行（`sendInput` 一併把焦點交還終端）。
   *
   * **目標恆為 focused session** —— 也就是畫面上那個終端。同一個 repo 有多個 claude 在跑也不
   * 構成歧義：側欄呈現的 change 就是 focused session 錨定的那一個（錨定是 per-session 的），
   * 而那行字會出現在使用者正看著的終端裡，送給了誰**在視覺上是自明的**（design D3）。
   */
  const continueArtifacts = useCallback(() => {
    if (!focusedId || !anchoredChange || continuationBlock) return
    sessions.sendInput(focusedId, continuationCommand(anchoredChange))
  }, [focusedId, anchoredChange, continuationBlock, sessions])

  /**
   * 來源指示器選了一個 folder：設定 focused session 的側欄來源。
   *
   * 只在有 focused session 時有效 —— 側欄來源是 per-session 的狀態，沒有 session 就沒地方存
   *（此時側欄本就退回 focusedFolder，見 `side-panel-source`）。
   */
  const changePanelSource = useCallback(
    (folderId: string) => {
      if (!focusedId) return
      sessions.setPanelSource(focusedId, folderId)
    },
    [focusedId, sessions],
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
    <main aria-label={t('stage.label')} className="flex h-full flex-col bg-stage">
      <header className="flex items-center gap-3 border-b border-hairline px-4 py-2 text-base">
        <span className={focusedFolder ? 'text-ink' : 'text-ink-faint'}>
          {focusedFolder ? focusedFolder.name : t('stage.noRepo')}
        </span>
        {focusedFolder && (
          <span className="truncate text-sm text-ink-faint">{focusedFolder.path}</span>
        )}

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
          aria-label={collapsed ? t('stage.expandSidePanel') : t('stage.collapseSidePanel')}
          title={collapsed ? t('stage.expandSidePanel') : t('stage.collapseSidePanel')}
          className="rounded border border-hairline px-2 py-1 text-sm text-ink-dim hover:text-accent"
        >
          {`▤ ${collapsed ? t('common.expand') : t('common.collapse')}`}
        </button>
      </header>

      {/* 分頁列只屬於當前選中的 repo（mockup 的 .session-tabs）。 */}
      {focusedFolder && (
        <SessionTabs
          sessions={folderSessions}
          focusedId={focusedId}
          onFocus={focusSession}
          onClose={sessions.close}
          onCreate={createSession}
          onRename={sessions.rename}
          onReorder={(fromIndex, toIndex) =>
            sessions.reorder(focusedFolder.id, fromIndex, toIndex)
          }
          error={sessionError}
        />
      )}

      <Group orientation="horizontal" className="flex-1">
        <Panel minSize="240px">
          <section aria-label={t('stage.terminal')} className="relative h-full bg-shell">
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
                  spawnTarget={session.spawnTarget}
                  status={session.status}
                  wakeError={session.wakeError}
                  active={session.folderId === focusedFolder?.id && session.id === focusedId}
                />
              ))}

            {!focusedId && (
              <div className="flex h-full items-center justify-center text-sm text-ink-faint">
                {focusedFolder ? t('stage.noSession') : t('stage.noRepo')}
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
          <section aria-label={t('openspec.sidePanel')} className="h-full overflow-hidden bg-panel">
            <SidePanel
              identity={activeIdentity}
              folder={panelFolder}
              folders={folders}
              sourceOwnerId={focusedFolder?.id ?? null}
              canSelectSource={focusedId !== null}
              onSelectSource={changePanelSource}
              anchoredChange={anchoredChange}
              onAnchor={anchorChange}
              continuationBlock={continuationBlock}
              onContinue={continueArtifacts}
              onOpenFile={openFileFromOpenSpec}
              onViewInOpenSpec={viewInOpenSpec}
              fileRequest={fileRequest}
              openSpecRequest={openSpecRequest}
              onOpenViz={setViz}
            />
          </section>
        </Panel>
      </Group>

      {viz && panelFolder && (
        <VizOverlay
          folderId={panelFolder.id}
          folderName={panelFolder.name}
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
