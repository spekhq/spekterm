import type { SpawnTarget } from '../types'
import type { SessionState } from './sessions'

const SPAWN_LABEL: Record<SpawnTarget, string> = {
  claude: 'claude',
  shell: 'shell',
}

/** 分頁列與 rail 都是窄的橫向空間，過長的標題必須讓位。 */
const MAX_LABEL = 28

/**
 * session 的**完整**身分，供 tooltip 使用。
 *
 * 優先採用 pty 以 OSC 序列宣告的終端標題 —— 跑在裡面的程式最清楚自己是誰（`claude` 會主動
 * 送這個，那正是終端模擬器的分頁會自動改名的機制）。pty 沒宣告時才退回本地流水號。
 */
export function sessionTitle(session: SessionState): string {
  return session.title ?? `${SPAWN_LABEL[session.spawnTarget]} ${session.ordinal}`
}

/** 呈現用的標籤：截斷是呈現上的取捨，完整標題仍可自 tooltip 取得（見 `sessionTitle`）。 */
export function sessionLabel(session: SessionState): string {
  const full = sessionTitle(session)
  return full.length > MAX_LABEL ? `${full.slice(0, MAX_LABEL - 1)}…` : full
}

export function statusTitle(session: SessionState): string {
  if (session.status === 'running') return '運作中'
  return session.exitCode === 0 ? '已結束' : `已結束（代碼 ${session.exitCode ?? 0}）`
}

/**
 * 狀態燈。**本 phase 只反映 pty 存活／已結束** —— mockup 的 waiting／running 是 agent 的
 * 語意，需解析 agent 輸出才能得知，屬後續 phase。非零結束以 danger 呈現，好讓「claude 找
 * 不到」這類啟動失敗看得見。
 */
export function StatusDot({ session }: { session: SessionState }): React.JSX.Element {
  const tone =
    session.status === 'running'
      ? 'bg-emerald-400'
      : session.exitCode === 0
        ? 'bg-ink-faint'
        : 'bg-danger'

  return <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} />
}
