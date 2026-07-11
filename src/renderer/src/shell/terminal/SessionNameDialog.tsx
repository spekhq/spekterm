import { useEffect, useRef, useState } from 'react'

interface SessionNameDialogProps {
  initialValue: string
  onSubmit: (name: string) => void
  onCancel: () => void
}

const OVERLAY_CLASS =
  'absolute inset-0 z-20 flex items-center justify-center bg-black/50 px-4 text-xs'
const BUTTON_CLASS = 'rounded border border-hairline px-2 py-[3px] text-[12px] hover:bg-stage'

/**
 * 替 session 取名。
 *
 * **不能重用 `files` 的 `NameDialog`** —— 那一個套的是**檔案名稱**的驗證（禁止 `/`、`..`、
 * Windows 保留字…）。session 的名字是自由文字，使用者大可叫它「fix: bug #3」，套上檔名規則
 * 會把完全合法的名字擋掉。
 *
 * 清空即送出＝**放棄命名權**，標籤回到跟隨 pty 宣告的標題。
 */
export function SessionNameDialog({
  initialValue,
  onSubmit,
  onCancel,
}: SessionNameDialogProps): React.JSX.Element {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <div className={OVERLAY_CLASS}>
      <div
        role="dialog"
        aria-label="重新命名 session"
        className="w-full max-w-sm rounded border border-hairline bg-panel p-3 shadow-lg"
      >
        <p className="text-ink">重新命名 session</p>

        <input
          ref={inputRef}
          value={value}
          aria-label="session 名稱"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSubmit(value)
            if (event.key === 'Escape') onCancel()
          }}
          className="mt-2 w-full rounded border border-hairline bg-stage px-2 py-1 font-mono text-ink outline-none focus:border-accent/50"
        />

        <p className="mt-1 text-[12px] text-ink-faint">
          清空即回到跟隨 pty 宣告的名稱。取名之後，pty 想改名會先問過你。
        </p>

        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={BUTTON_CLASS}>
            取消
          </button>
          <button
            type="button"
            onClick={() => onSubmit(value)}
            className={`${BUTTON_CLASS} border-accent/40 text-accent`}
          >
            確定
          </button>
        </div>
      </div>
    </div>
  )
}
