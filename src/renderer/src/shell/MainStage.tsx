import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import {
  type ContinuationBlock,
  continuationBlockOf,
  continuationCommand,
} from './openspec/continuation'
import { useChanges, useWorktrees } from './openspec/data'
import { VizOverlay, type VizKind } from './openspec/VizOverlay'
import type { FileRequest, OpenSpecRequest, OpenSpecTarget } from './openspec/nav'
import { usePanelCoordinate } from './panel-coordinate'
import { PanelSwitch } from './side-panel/PanelSwitch'
import { SidePanel } from './side-panel/SidePanel'
import { SessionTabs } from './terminal/SessionTabs'
import { TerminalView } from './terminal/TerminalView'
import { useSessions } from './terminal/sessions'
import { folderSelection } from './types'
import type {
  PanelIdentity,
  RailSelection,
  SpawnTarget,
  WorkspaceFolder,
  WorktreeOption,
} from './types'

/** 穩定的空陣列 —— 每次渲染新造一個會讓下游的依賴比較失效。 */
const EMPTY_WORKTREES: WorktreeOption[] = []

interface MainStageProps {
  /**
   * rail 上選中的項目 —— 「駕駛」那半（header、session 分頁、terminal）以它為準。
   * `null` ＝ 尚未選中任何項目（與「選中全域項目」互斥可辨，design D8）。
   */
  selection: RailSelection | null
  /** workspace 的所有 folder —— 來源指示器的下拉清單。 */
  folders: WorkspaceFolder[]
}

export function MainStage({ selection, folders }: MainStageProps): React.JSX.Element {
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

  /** 全視窗 overlay 的 Graph／Timeline（design D12）。null＝沒開。 */
  const [viz, setViz] = useState<VizKind | null>(null)

  const sessions = useSessions()
  const panel = usePanelCoordinate()

  // **「駕駛」那半：當前選中的 rail 項目。** header、session 分頁與 terminal 一律以它為準
  // —— 側欄指向另一個 repo 時，這一半完全不受影響（`side-panel-source`）。
  //
  // 選中的可能是**全域項目**（不隸屬任何 folder，`global-session`），因此這裡有兩個變數而不是
  // 一個：`itemKey` 是 session 的歸屬鍵（`null` ＝ 全域），`focusedFolder` 只有選中 folder 時
  // 才有值 —— header 的名稱與路徑要用它。
  const focusedFolder =
    selection?.kind === 'folder'
      ? (folders.find((candidate) => candidate.id === selection.id) ?? null)
      : null
  const itemKey: string | null = selection?.kind === 'folder' ? selection.id : null
  const folderSessions = selection ? sessions.forFolder(itemKey) : []
  const focusedId = selection ? sessions.focusedIdFor(itemKey) : null

  // **「讀」那半：panelFolder。** side panel 呈現 rail 上選中之項目的側欄座標所指的 repo
  // （`side-panel-source`）—— **與有沒有 session 無關**。座標未曾改動時（`sourceFolderId` 省略）
  // 即為該 folder 自身；來源指向的 folder 已被移除時（`find` 找不到）同樣退回自身 —— 持久化的
  // 座標不保證重開後仍然有效，那是 spec 明文要求的降級。
  const coordinate = panel.coordinateOf(selection)
  const panelFolder =
    (coordinate.sourceFolderId
      ? folders.find((candidate) => candidate.id === coordinate.sourceFolderId)
      : null) ?? focusedFolder

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

  /*
    **來源未選定時 OpenSpec 身分可用**（design D11）。此前這裡是 `panelFolder?.hasOpenSpec ?? false`
    —— 全域項目沒有 panelFolder ⇒ 恆為 false ⇒ 身分被停用並強制退回 Files，而 Files 在同一個
    狀態下也是空的，於是側欄整塊沒有任何入口，使用者無從得知「選一個 repo 就有了」。

    停用的條件因此收窄為「**來源已選定，且**該 repo 不含 `openspec/`」—— 那是該 repo 的性質；
    而「還沒選」是一個尚未作出的選擇，它要呈現的正是引導使用者去選的空狀態。
  */
  const openSpecEnabled = panelFolder ? panelFolder.hasOpenSpec : true
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

  // 側欄「本 change」的衍生預設：以 **panelFolder**（側欄來源）為準 —— 側欄來源恰有一個 active
  // change 時就是它。
  //
  // **它是動態的，不會被固化為明確的錨定**（`openspec-panel`）：active change 變成兩個時，
  // 這個預設就讓位給空狀態。此前「建立 session 的那一刻恰好只有一個」會把它固化進該 session，
  // 而那個分界在座標改基為 per-folder 之後撐不住了 —— 開一個 terminal 為什麼要決定側欄看什麼？
  // 統一為動態之後規則只有一條，也不需要「何時固化」那個沒有自明答案的額外裁決。
  const { data: panelChanges } = useChanges(panelFolder?.hasOpenSpec ? panelFolder.id : null)
  const soleActiveChangeForPanel =
    panelChanges && panelChanges.active.length === 1 ? panelChanges.active[0].slug : undefined

  // 側欄來源的工作目錄清單 —— 跨身分導覽要靠它判定「這個檔案屬於哪個工作目錄」。
  //
  // **不以 `hasOpenSpec` gate**（design D12）：工作目錄選擇器必須對「有 worktree 但沒有
  // `openspec/`」的 repo 也出現，否則使用者無從分辨那是刻意的限制還是壞了。代價是那些 folder
  // 首次進入 Files 身分時走一次掃描 —— 已裁決接受（結果為 per-folder 快取，成本一次性）。
  const { data: panelWorktreeData } = useWorktrees(panelFolder?.id ?? null)
  const panelWorktrees = panelWorktreeData ?? EMPTY_WORKTREES

  // **gate 在 `selection`，不在 `focusedFolder`。** 後者對全域項目是 `null`，於是這顆按鈕會
  // 靜默地什麼都不做 —— 沒有錯誤、沒有訊息。編譯器對此完全無感（兩者都是合法的 falsy 判斷）。
  const createSession = useCallback(
    (spawnTarget: SpawnTarget) => {
      if (!selection) return
      setSessionError(null)
      void sessions.create(itemKey, spawnTarget).then((outcome) => {
        if (outcome.status === 'failed') setSessionError(outcome.failure.message)
      })
    },
    [selection, itemKey, sessions],
  )

  const focusSession = useCallback(
    (sessionId: string) => {
      if (!selection) return
      sessions.focus(itemKey, sessionId)
    },
    [selection, itemKey, sessions],
  )

  /**
   * 側欄「本 change」看的是哪個 change。兩層優先序：
   *
   * 1. **座標中明確的錨定**（使用者在 Changes 樹、Graph／Timeline 或開 session 入口選的那個）。
   * 2. **側欄來源恰有一個 active change 時，就是它** —— 衍生的預設值，動態解析。
   *
   * 此前這裡是**三層**：有 session 走 session 的錨定，沒有 session 走一個 per-folder 的
   * `viewing` map。那個 map 是「per-session 回答不了沒有 session」的具體化 —— 座標改基之後
   * 它無事可做，已刪除。
   */
  const explicitAnchor = coordinate.anchoredChange ?? null

  const anchoredChange = explicitAnchor ?? soleActiveChangeForPanel ?? null

  const anchorChange = useCallback(
    (slug: string) => {
      if (!selection) return
      panel.setAnchor(selection, slug)
    },
    [selection, panel],
  )

  /**
   * 續寫入口能不能用 —— 三個條件全部成立才行（`artifact-continuation` 的 spec）。
   *
   * 條件的順序就是回報原因的優先序：先看有沒有對象，再看它是不是對的對象。
   */
  const continuationBlock: ContinuationBlock | null = continuationBlockOf({
    displayed,
    panelFolderId: panelFolder?.id,
  })

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
   * 於當前呈現的 change 之來源工作目錄開一個 claude session，**並錨定該 change**。
   *
   * **錨定是承重的，不是順手**：新 session 成為 focused 之後，側欄呈現的 change 由它的錨定決定。
   * 不錨定的話會落入「尚無錨定」的空狀態（衍生預設只在該 repo 恰有一個 active change 時成立，
   * 而「一個 change 一個 worktree」的工作流下通常不只一個）—— 續寫入口連呈現的機會都沒有，
   * 使用者按了一顆按鈕卻看見側欄變空白。
   *
   * **只開 session，不送續寫指示**：兩件可各自失敗的事併成一次點擊時，使用者無從得知壞的是哪一件。
   */
  const openSessionInChangeWorktree = useCallback(
    (worktreeKey: string) => {
      if (!panelFolder || !anchoredChange) return
      setSessionError(null)
      // **錨定寫進 `panelFolder` 的座標，不是 focusedFolder 的。** 側欄來源即 focused folder 時
      // 那是同一筆（該 change 本來就已經是它的錨定，否則側欄不會正在呈現它），此舉等於不變；
      // 指向另一個 repo 時，使用者切 rail focus 過去讀到的正是 panelFolder 那一筆 —— 沒有這步，
      // 他會落入「尚無錨定」的空狀態，續寫入口連呈現的機會都沒有。
      //
      // 這是本 change 唯一的**跨項目寫入**，而它是正當的：使用者的動作本身就是關於那個 repo 的
      // （他剛在那裡開了一個 session 去做這個 change），不是一次無來由的繼承。
      panel.setAnchor(folderSelection(panelFolder.id), anchoredChange)
      void sessions.create(panelFolder.id, 'claude', { worktreeKey }).then((outcome) => {
        if (outcome.status === 'failed') setSessionError(outcome.failure.message)
      })
    },
    [panelFolder, anchoredChange, panel, sessions],
  )

  /**
   * 來源指示器選了一個 folder：設定 **rail 上選中之項目**的側欄來源。
   *
   * **不以「有沒有 session」為條件** —— 座標隸屬於 rail 的項目，而側欄是一個閱讀工具，不該
   * 需要先開一個 terminal 才能選要讀什麼（`side-panel-source`）。
   */
  const changePanelSource = useCallback(
    (folderId: string | null) => {
      if (!selection) return
      panel.setSource(selection, folderId)
    },
    [selection, panel],
  )

  /** 側欄的工作目錄：Files 身分以哪個工作目錄為樹根。省略＝ folder 自身。 */
  const panelWorktreeKey = coordinate.worktreeKey

  /** 選擇器選了一個工作目錄。與側欄來源同理 —— 同樣不以 session 的存在為前提。 */
  const changePanelWorktree = useCallback(
    (worktreeKey: string | undefined) => {
      if (!selection) return
      panel.setWorktree(selection, worktreeKey)
    },
    [selection, panel],
  )

  /**
   * OpenSpec → Files：切到 Files 身分並開啟該檔。
   *
   * **目標所屬的工作目錄一併切換**（`side-panel-worktree`）—— 否則會把使用者送到一棵不含該檔案
   * 的樹上，麵包屑與樹的內容自相矛盾。切換在**這裡**完成，不由 `FilesPanel` 收到請求後回呼：
   * 它是在渲染期間套用請求的，而渲染期間不得呼叫父層的 setState（與 `viewInOpenSpec` 對錨定的
   * 處理同一條理由）。
   *
   * 歸屬以**最長相符根**判定 —— 工作目錄的根可能互為前綴（例如 `…/wt` 與 `…/wt-a`），取第一個
   * 命中會把後者的檔案誤判為前者的。
   */
  const openFileFromOpenSpec = useCallback(
    (relPath: string) => {
      const owner = [...panelWorktrees]
        .filter((option) => option.relPath !== null && option.relPath !== '')
        .sort((a, b) => (b.relPath as string).length - (a.relPath as string).length)
        .find((option) => relPath.startsWith(`${option.relPath}/`))

      // **無條件切換，不再包在「有沒有 session」裡。** `side-panel-worktree` 的「自 OpenSpec
      // 跳往檔案時工作目錄一併切換」是一條無條件的 SHALL，而此處原本的 `if (focusedId)` 讓它
      // 在無 session 時完全沒有兌現 —— 零覆蓋，因為探針一律先建 session。
      if (selection) panel.setWorktree(selection, owner?.key)

      nonce.current += 1
      setFileRequest({ target: relPath, nonce: nonce.current })
      setIdentity('files')
      expandSidePanel()
    },
    [expandSidePanel, selection, panel, panelWorktrees],
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
        {/*
          全域項目沒有名稱與路徑可呈現 —— 但它**已經被選中了**，因此不得沿用「尚未選擇 repo」
          那句（那在叫使用者去做一件他剛做完的事）。
        */}
        <span className={selection ? 'text-ink' : 'text-ink-faint'}>
          {focusedFolder ? focusedFolder.name : selection ? t('rail.globalName') : t('stage.noRepo')}
        </span>
        {focusedFolder ? (
          <span className="truncate text-sm text-ink-faint">{focusedFolder.path}</span>
        ) : (
          selection && <span className="truncate text-sm text-ink-faint">{t('stage.globalHint')}</span>
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

      {/* 分頁列只屬於當前選中的 rail 項目（mockup 的 .session-tabs）—— 全域項目也有它自己的。 */}
      {selection && (
        <SessionTabs
          sessions={folderSessions}
          focusedId={focusedId}
          onFocus={focusSession}
          onClose={sessions.close}
          onCreate={createSession}
          onRename={sessions.rename}
          onReorder={(fromIndex, toIndex) => sessions.reorder(itemKey, fromIndex, toIndex)}
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
                  /*
                    **以歸屬鍵比較，不是 `session.folderId === focusedFolder?.id`。** 後者對全域
                    session 是 `null === undefined` ⇒ 恆為 false ⇒ 它的終端永遠不是 active，
                    而依「休眠的 session 於首次被顯示時才啟動 pty」，那等於**休眠的全域 session
                    永遠不會被喚醒** —— 畫面上只是一片空白，沒有任何錯誤。編譯器攔不到這一行
                    （`string | null` 與 `string | undefined` 的 `===` 合法），是 grep 找到的。
                  */
                  active={
                    selection !== null && session.folderId === itemKey && session.id === focusedId
                  }
                />
              ))}

            {!focusedId && (
              <div className="flex h-full items-center justify-center text-sm text-ink-faint">
                {selection ? t('stage.noSession') : t('stage.noRepo')}
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
              itemSelected={selection !== null}
              onSelectSource={changePanelSource}
              anchoredChange={anchoredChange}
              onAnchor={anchorChange}
              continuationBlock={continuationBlock}
              sessionWorktreeKey={displayed?.worktreeKey}
              panelWorktreeKey={panelWorktreeKey}
              onSelectWorktree={changePanelWorktree}
              onContinue={continueArtifacts}
              onOpenSessionHere={openSessionInChangeWorktree}
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
