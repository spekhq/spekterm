import { useTranslation } from 'react-i18next'
import { useDirtyBuffers } from './files/dirty-buffers'
import { resolveAnchoredChange } from './openspec/anchor'
import { useChanges, useSpecs } from './openspec/data'
import { useSessionStatus } from './useSessionStatus'
import { usePanelCoordinate } from './panel-coordinate'
import { useSessions } from './terminal/sessions'
import { sessionTitle, statusTitle } from './terminal/session-badge'
import { type RailSelection, type SessionStatus, type WorkspaceFolder, selectedFolderId } from './types'

/**
 * 主視窗底部的狀態列 —— `docs/workspace-mockup.html` 早已定義（`.statusbar`），但從未實作。
 *
 * **它的價值不是新資訊，是「一個不會被終端寬度截斷的固定位置」。** 起因是使用者的 agent 自行
 * 繪製的狀態行在這個 app 裡會被截斷 —— 而那正是因為它與終端內容**共用同一個寬度**。把位置類的
 * 事實搬到殼層之後，那一行就可以縮短成只剩我們拿不到的東西（模型、用量）。
 *
 * **不照抄雛型的 `UTF-8` 與版本號兩格**：一個永遠顯示同一個值的欄位不傳遞任何資訊，只佔位置
 *（與移除 rail 那顆 `◈` 假按鈕、把「每列都喊一次的 OpenSpec」換成分支同源）。雛型對這條列的
 * 權威在於它的位置、高度與分段形式，不在於它填了什麼字（design D6）。
 *
 * **也不呈現 pty 當下的 cwd**：拿得到（主行程讀 `/proc/<pid>/cwd`），但常駐呈現要輪詢，而
 * session 掛在哪個 repo 本來就不隨 cwd 浮動 —— 對「我現在在哪」這個問題貢獻很低。
 */
export function StatusBar({
  folders,
  selection,
}: {
  folders: WorkspaceFolder[]
  /** rail 上選中的項目。`null` ＝ 尚未選中任何項目（design D8）。 */
  selection: RailSelection | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const sessions = useSessions()
  const panel = usePanelCoordinate()

  const folder = folders.find((candidate) => candidate.id === selectedFolderId(selection)) ?? null
  // **以 rail 項目的歸屬鍵取 session，不以 folder** —— 全域項目沒有 folder，用 folder 取會讓
  // 它的 session 完全不存在（focused 恆為 undefined ⇒ 整條列塌成「沒有 repo」的空狀態）。
  const itemKey: string | null = selection?.kind === 'folder' ? selection.id : null
  const focusedId = selection ? sessions.focusedIdFor(itemKey) : null
  const focused = focusedId ? sessions.all().find((s) => s.id === focusedId) : undefined

  // 側欄來源 —— 指向別的 repo 時才標示（相等是常態，標它等於每次都重複同一個值）。
  // **座標的鍵是 rail 上選中的 folder，不是 focused session**（`side-panel-source`）。
  const coordinate = panel.coordinateOf(selection)
  //
  // **先問這個項目有沒有自身 repo，不讓兩個缺席值互相比較。** 全域項目沒有「自身」，於是
  // 「來源即自身」這句話對它沒有意義 —— 只要它選定了來源就一律標示；未選定時不標示任何東西。
  const sourceIsForeign =
    coordinate.sourceFolderId !== undefined &&
    (folder === null || coordinate.sourceFolderId !== folder.id)
  const panelSource = sourceIsForeign
    ? (folders.find((candidate) => candidate.id === coordinate.sourceFolderId) ?? null)
    : null

  /**
   * 錨定的 change 與其進度。**解析走與側欄同一個函式**（`resolveAnchoredChange`）——
   * 此前這裡自己又實作了一次同一條規則，而「兩邊一致」只靠這行註解維持。錨定跨重啟存活而
   * slug 會被 `openspec archive` 改名，於是少了查表這一步，狀態列會印出一個**已不存在的**
   * change，而側欄那邊早已不呈現它（`status-bar`：兩處 SHALL NOT 對同一個問題給出兩個答案）。
   *
   * **錨定隸屬於 rail 上選中的項目，不是該 session** —— 於是同一個 folder 的多個 session 在此
   * 呈現同一個 change。那不構成歧義：這條列的其餘欄位（標籤、執行狀態、工作目錄）本就逐
   * session 而異，而 change 回答的是「這個 repo 我正在看哪一個」。
   *
   * **沒有 focused session 時整條列仍是空狀態** —— 座標在無 session 時依然存在，但這條
   * requirement 呈現的是「focused session 的脈絡」，少了 session 就沒有脈絡可言。以
   * `focused &&` 保持那個前提（`status-bar`）。
   */
  const anchorSource = panelSource?.id ?? folder?.id ?? null
  const { data: changes } = useChanges(focused && anchorSource ? anchorSource : null)
  // `focused &&` 這一層留在呼叫端 —— 它是 `status-bar` 自己的 requirement（沒有 focused session
  // 時整條脈絡為空狀態），不是錨定解析規則的一部分。
  const anchored = focused ? resolveAnchoredChange(coordinate.anchoredChange, changes) : null
  const anchoredInfo = anchored ? changes?.active.find((c) => c.slug === anchored) : undefined
  const stats = anchoredInfo?.taskStats ?? null

  // 主行程側的事實（cwd／git／agent 用量）。只對 focused 的那一個輪詢。
  const live = useSessionStatus(focused?.id ?? null)

  // git 分支優先取 cwd 實測到的那個 —— 使用者在終端裡 `cd` 出去之後，folder 的分支就不是他
  // 眼前的那個了。取不到（不是 git repo、或還沒第一個 tick）才退回 folder 的。
  const branch = live?.branch ?? folder?.branch ?? null

  // 未存檔的緩衝區 —— 算的是**側欄來源**那個 repo（編輯器就開在它上面）。
  // **為零時不呈現**：它是警示，恆常呈現就失去警示的作用。
  const dirtyBuffers = useDirtyBuffers()
  const unsaved = anchorSource ? dirtyBuffers.countFor(anchorSource) : 0

  const { data: specs } = useSpecs(focused && anchorSource ? anchorSource : null)
  const sessionCount = selection ? sessions.countFor(itemKey) : 0
  const totalSessions = sessions.all().length

  return (
    <footer
      aria-label={t('statusBar.label')}
      // 26px 與等寬字型來自雛型。`overflow-hidden` + 各段的 `truncate` 是「維持單行、不橫向捲動」
      // 的實作：這條列的高度是版面契約的一部分，它自己失控就沒有解決任何問題。
      className="flex h-[26px] shrink-0 items-center gap-4 overflow-hidden border-t border-hairline bg-shell px-3 font-mono text-2xs leading-none text-ink-faint"
    >
      {/*
        **空狀態的條件是「沒有 focused session」，不是「沒有 folder」** —— 自 `global-session`
        起這兩者不再等價：workspace 一個 folder 都沒有時，使用者仍可於全域項目擁有數個 session，
        而那時要呈現的是該 session 的脈絡，不是一句「沒有 repo」。
      */}
      {!focused ? (
        <span className="truncate">
          {selection ? t('statusBar.noSession') : t('statusBar.noRepo')}
        </span>
      ) : (
        <>
          {/*
            repo 與分支優先保留 —— `shrink-0` 讓右邊的欄位先被擠掉（spec：由右往左省略）。
            分支用 accent，與雛型的第一段一致。
          */}
          {/*
            全域 session 沒有所屬 repo —— 以全域身分標示取代**名稱**，SHALL NOT 呈現任何 folder
            的名稱。**但分支不隨之消失**：它衍生自該 session 的工作目錄而非其所屬 folder，
            `cd` 進任一 repo 之後照常呈現（那正是使用者當下最需要的欄位）。
            它與 repo 名稱同為「我打的字會送到哪裡」的第一個依據，因此享有同等的省略優先序
            （兩者都是 `shrink-0`）。
          */}
          <span className="shrink-0 text-ink-dim">
            {folder ? folder.name : t('rail.globalName')}
          </span>
          {branch && (
            <span className="shrink-0 text-accent">
              {live?.worktree
                ? t('statusBar.worktree', { name: live.worktree })
                : branch}
              {live?.dirty ? '*' : ''}
            </span>
          )}

          {live?.cwd && <span className="min-w-0 truncate">{shortenPath(live.cwd)}</span>}

          <span className="min-w-0 truncate">
            {sessionTitle(focused)}
            {focused.status !== 'running' && ` (${statusTitle(focused)})`}
          </span>

          <span className="shrink-0">
            {t('statusBar.sessions', { here: sessionCount, total: totalSessions })}
          </span>

          {anchored && (
            <span className="min-w-0 truncate">
              {stats
                ? t('statusBar.changeWithTasks', {
                    slug: anchored,
                    completed: stats.completed,
                    total: stats.total,
                  })
                : anchored}
            </span>
          )}

          {changes && specs && (
            <span className="shrink-0">
              {t('statusBar.openspecCounts', {
                specs: specs.length,
                active: changes.active.length,
              })}
            </span>
          )}

          {unsaved > 0 && (
            <span className="shrink-0 text-accent">{t('statusBar.unsaved', { count: unsaved })}</span>
          )}

          {panelSource && (
            <span className="min-w-0 truncate">
              {t('statusBar.panelSource', { name: panelSource.name })}
            </span>
          )}

          {/* agent 回報的用量 —— 每個欄位各自可缺席（實測 rate_limits 在全新 session 就沒有）。 */}
          <AgentSegments agent={live?.agent} />
        </>
      )}
    </footer>
  )
}

/**
 * 路徑過深時縮成末三段。狀態列是一條 26px 的單行，一個十層深的絕對路徑會把其餘欄位全部擠掉。
 */
function shortenPath(absolute: string): string {
  const home = absolute.startsWith('/home/') ? absolute.replace(/^\/home\/[^/]+/, '~') : absolute
  const parts = home.split('/')
  return parts.length > 4 ? `…/${parts.slice(-3).join('/')}` : home
}

/**
 * agent 自己回報的那幾段（模型、context 用量、花費、用量上限）。
 *
 * **每一段都獨立判斷存在與否** —— payload 的形狀不是固定的（實測：`rate_limits` 在還沒打過 API
 * 的 session 上根本不存在）。缺一段就少呈現一段，不得讓整條狀態列失效。
 *
 * context 的百分比**恆由 agent 提供的 window 大小算出**（或直接取它算好的）—— 我們不維護
 * 「模型 → context window 大小」的對照表，那種表會隨新模型過期，而它失效的樣子是一個看起來
 * 很正常的錯誤數字。
 */
function AgentSegments({ agent }: { agent?: SessionStatus['agent'] }): React.JSX.Element | null {
  const { t } = useTranslation()
  if (!agent) return null

  return (
    <>
      {/*
        模型 · effort · thinking 併成一段 —— 它們回答的是同一個問題（「現在是誰、用什麼力氣在想」），
        拆成三格會在一條 26px 的列上浪費三個間距。thinking 用一個記號而不是文字：它是布林，
        寫成 `thinking: on` 只是把一個記號拉長成兩個字。
      */}
      {agent.model && (
        <span className="min-w-0 truncate text-ink-dim">
          {agent.model}
          {agent.effort ? `·${agent.effort}` : ''}
          {agent.thinking ? '·✻' : ''}
        </span>
      )}
      {agent.contextPercent !== undefined && (
        <span className="shrink-0">
          {t('statusBar.context', { percent: Math.round(agent.contextPercent) })}
        </span>
      )}
      {/* 增刪行數：**兩者皆為 0 時整段不呈現** —— 還沒改過任何東西時，`+0 -0` 只是雜訊。 */}
      {(agent.linesAdded ?? 0) + (agent.linesRemoved ?? 0) > 0 && (
        <span className="shrink-0">
          <span className="text-green">+{agent.linesAdded ?? 0}</span>{' '}
          <span className="text-danger">-{agent.linesRemoved ?? 0}</span>
        </span>
      )}

      {agent.costUsd !== undefined && agent.costUsd > 0 && (
        <span className="shrink-0">{t('statusBar.cost', { usd: agent.costUsd.toFixed(2) })}</span>
      )}
      {agent.fiveHourPercent !== undefined && (
        <span className="shrink-0">
          {t('statusBar.fiveHour', { percent: Math.round(agent.fiveHourPercent) })}
          {formatReset(agent.fiveHourResetsAt, 'clock')}
        </span>
      )}
      {agent.sevenDayPercent !== undefined && (
        <span className="shrink-0">
          {t('statusBar.sevenDay', { percent: Math.round(agent.sevenDayPercent) })}
          {formatReset(agent.sevenDayResetsAt, 'dateClock')}
        </span>
      )}
    </>
  )
}

/**
 * 用量上限的重置時刻。`resets_at` 是 unix epoch 秒。
 *
 * **以使用者當地時區呈現**（`Intl` 的預設）—— 這與使用者自己的 statusline 腳本不同，那支腳本
 * 把時區釘在 Asia/Taipei，因為它無法假設執行它的機器在哪個時區。桌面 app 沒有這個問題：
 * 作業系統的時區就是使用者所在的時區。
 *
 * 5 小時的窗口在當天內重置 → 只給時:分；7 天的窗口在幾天後 → 補上月/日。
 */
function formatReset(epochSeconds: number | undefined, form: 'clock' | 'dateClock'): string {
  if (epochSeconds === undefined || epochSeconds <= 0) return ''
  const at = new Date(epochSeconds * 1000)
  if (Number.isNaN(at.getTime())) return ''

  const clock = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (form === 'clock') return `·↻${clock}`
  const date = at.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })
  return `·↻${date} ${clock}`
}
