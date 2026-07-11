import type { SpawnTarget } from '../types'
import type { SessionState } from './sessions'

const SPAWN_LABEL: Record<SpawnTarget, string> = {
  claude: 'claude',
  shell: 'shell',
}

/**
 * 分頁與 rail 共用的 session 標籤。
 *
 * mockup 用的是 branch 名 —— 但 branch 要等 Phase 5 的 git 整合才有。本 phase 只用得到
 * 手上的本地資訊：spawn 目標 + 該 folder 內的序號。
 */
export function sessionLabel(session: SessionState): string {
  return `${SPAWN_LABEL[session.spawnTarget]} ${session.ordinal}`
}

export function statusTitle(session: SessionState): string {
  if (session.status === 'running') return '運作中'
  return session.exitCode === 0 ? '已結束' : `已結束（代碼 ${session.exitCode ?? 0}）`
}

/**
 * 狀態燈。**本 phase 只反映 pty 存活／已結束** —— mockup 的 waiting／running 是 agent 的
 * 語意，需解析 agent 輸出才能得知，屬後續 phase。非零結束以 danger 呈現，好讓「claude 找
 * 不到」這類啟動失敗看得見（design D15）。
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
