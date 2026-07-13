import type { SessionState } from './sessions'

interface TitleConflictDialogProps {
  session: SessionState
  onAccept: () => void
  onKeep: () => void
}

const OVERLAY_CLASS =
  'absolute inset-0 z-20 flex items-center justify-center bg-black/50 px-4 text-sm'

const BUTTON_CLASS = 'rounded border border-hairline px-3 py-1 text-ink-dim hover:text-ink'

/**
 * 使用者已替這個 session 取了名字，而 pty 想把它改成別的。
 *
 * **不靜默覆蓋** —— 使用者接管了命名權，就由他裁決。同時只會有一個這樣的對話框：pty 若在
 * 裁決之前又送了新標題，只會取代掉待確認的那個名字（design D2）。
 */
export function TitleConflictDialog({
  session,
  onAccept,
  onKeep,
}: TitleConflictDialogProps): React.JSX.Element {
  return (
    <div className={OVERLAY_CLASS}>
      <div
        role="dialog"
        aria-label="session 改名確認"
        className="w-full max-w-sm rounded border border-hairline bg-panel p-4 shadow-lg"
      >
        <p className="text-ink">這個 session 想改名</p>

        <dl className="mt-3 space-y-1 text-xs">
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-ink-faint">你取的名字</dt>
            <dd className="min-w-0 truncate font-mono text-ink">{session.customTitle}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-ink-faint">它想改成</dt>
            <dd className="min-w-0 truncate font-mono text-accent">{session.pendingTitle}</dd>
          </div>
        </dl>

        <p className="mt-3 text-xs text-ink-faint">
          採用它的名稱之後，這個 session 之後的改名就不會再問你。
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onKeep} className={BUTTON_CLASS}>
            保留我的名字
          </button>
          <button
            type="button"
            onClick={onAccept}
            className={`${BUTTON_CLASS} border-accent/40 text-accent`}
          >
            採用它的名稱
          </button>
        </div>
      </div>
    </div>
  )
}
