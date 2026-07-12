import type { SpawnTarget } from '../types'
import type { SessionState } from './sessions'

const SPAWN_LABEL: Record<SpawnTarget, string> = {
  claude: 'claude',
  shell: 'shell',
}

/** 分頁列與 rail 都是窄的橫向空間，過長的標題必須讓位。 */
const MAX_LABEL = 28

/**
 * session 的**完整**身分，供 tooltip 使用。三層優先序：
 *
 * 1. **使用者親自取的名字** —— 他接管了命名權，誰也不能蓋過去（pty 想改名要先經確認）。
 * 2. **pty 以 OSC 序列宣告的標題** —— 跑在裡面的程式最清楚自己是誰（`claude` 會主動送這個，
 *    那正是終端模擬器的分頁會自動改名的機制）。**僅 `claude` 目標**：login shell 宣告的是它
 *    預設的 prompt 標題（`使用者@主機:/路徑`），對使用者零識別意義，且會讓分頁寬度在眼前
 *    突變 —— 它在 `sessions.tsx` 的 `setTitle()` 就被丟棄，`title` 因此恆為 `undefined`。
 * 3. **本地流水號** —— 兩者都沒有時的退路（login shell 恆走這條）。
 */
export function sessionTitle(session: SessionState): string {
  return (
    session.customTitle ?? session.title ?? `${SPAWN_LABEL[session.spawnTarget]} ${session.ordinal}`
  )
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
