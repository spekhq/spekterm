import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { validateName } from './names'

const OVERLAY_CLASS =
  'absolute inset-0 z-20 flex items-center justify-center bg-black/50 px-4 text-xs'
const CARD_CLASS = 'w-full rounded border border-hairline bg-panel p-3 shadow-lg'
const BUTTON_CLASS = 'rounded border border-hairline px-2 py-[3px] text-[11px] hover:bg-stage'

interface NameDialogProps {
  title: string
  /** 改名時帶入原名；新增時為空。 */
  initialValue?: string
  /** 主行程回報的失敗（例如 ALREADY_EXISTS）。介面驗證不足以預知它。 */
  serverError: string | null
  onSubmit: (name: string) => void
  onCancel: () => void
}

/** 新增與改名共用。名稱在送出之前就先驗一次，讓使用者不必等一趟 IPC 才知道不合法。 */
export function NameDialog({
  title,
  initialValue = '',
  serverError,
  onSubmit,
  onCancel,
}: NameDialogProps): React.JSX.Element {
  const [value, setValue] = useState(initialValue)
  const [touched, setTouched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const localError = touched ? validateName(value) : null
  const error = localError ?? serverError

  const submit = (): void => {
    setTouched(true)
    if (validateName(value)) return
    onSubmit(value)
  }

  return (
    <div className={OVERLAY_CLASS}>
      <div className={CARD_CLASS}>
        <p className="text-ink">{title}</p>
        <input
          ref={inputRef}
          value={value}
          aria-label={title}
          onChange={(event) => {
            setValue(event.target.value)
            setTouched(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
            if (event.key === 'Escape') onCancel()
          }}
          className="mt-2 w-full rounded border border-hairline bg-stage px-2 py-1 font-mono text-xs text-ink outline-none focus:border-accent"
        />
        {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={`${BUTTON_CLASS} text-ink-faint`}>
            取消
          </button>
          <button type="button" onClick={submit} className={`${BUTTON_CLASS} text-accent`}>
            確定
          </button>
        </div>
      </div>
    </div>
  )
}

interface ConfirmDeleteProps {
  relPath: string
  isDirectory: boolean
  /** 這個檔案（或這個目錄之下）有未存的變更，刪除會一併丟棄。 */
  hasUnsaved: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 刪除的唯一閘門。
 *
 * 沒有復原，因此這是一個明確的確認，而不是一個可以略過的 toast。目錄一律遞迴刪除，
 * 訊息必須說出這件事。
 */
export function ConfirmDelete({
  relPath,
  isDirectory,
  hasUnsaved,
  onConfirm,
  onCancel,
}: ConfirmDeleteProps): React.JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => confirmRef.current?.focus(), [])

  return (
    <div className={OVERLAY_CLASS}>
      <div className={CARD_CLASS}>
        <p className="text-ink">刪除「{relPath}」？</p>
        {isDirectory && (
          <p className="mt-1 text-[11px] text-ink-faint">
            這個目錄與其下的所有項目都會被移除。
          </p>
        )}
        {hasUnsaved && <p className="mt-1 text-[11px] text-danger">其中有未存的變更，會一併消失。</p>}
        <p className="mt-1 text-[11px] text-ink-faint">這個動作無法復原。</p>

        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={`${BUTTON_CLASS} text-ink-faint`}>
            取消
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onCancel()
            }}
            className={`${BUTTON_CLASS} text-danger`}
          >
            刪除
          </button>
        </div>
      </div>
    </div>
  )
}

export interface MenuItem {
  label: string
  onSelect: () => void
  tone?: 'danger'
}

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/** 選單邊緣與 viewport 之間的留白，避免緊貼邊界。 */
const MENU_MARGIN = 8

/** 樹上的操作入口。mockup 對此沉默，形式由本 change 定義（design D16）。 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // 掛載後量自己的尺寸，把位置夾進 viewport —— 否則貼著右／下緣的觸發點（例如 header 的
  // 「＋」在右上角）會讓選單溢出畫面外看不到。useLayoutEffect 在繪製前調整，不會閃一下。
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const left = Math.max(MENU_MARGIN, Math.min(x, window.innerWidth - rect.width - MENU_MARGIN))
    const top = Math.max(MENU_MARGIN, Math.min(y, window.innerHeight - rect.height - MENU_MARGIN))
    setPos({ left, top })
  }, [x, y])

  useEffect(() => {
    const dismiss = (): void => onClose()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    // **延一個 tick 才掛。** 開啟這個選單的那一次 click／contextmenu 會冒泡到 window，
    // 若當下就掛上 dismiss，它會被自己開啟的事件立刻關掉 —— React 19 對 trusted 的
    // discrete 事件會同步 flush effect，因此 listener 會在同一次事件的傳遞途中就生效
    //（實測：右鍵完全開不起來，因為 contextmenu 未 stopPropagation 而冒泡到 window）。
    const timer = setTimeout(() => {
      window.addEventListener('click', dismiss)
      window.addEventListener('contextmenu', dismiss)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('click', dismiss)
      window.removeEventListener('contextmenu', dismiss)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-30 min-w-[150px] rounded border border-hairline bg-panel py-1 text-xs shadow-lg"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={item.onSelect}
          className={`block w-full px-3 py-1 text-left hover:bg-hover ${
            item.tone === 'danger' ? 'text-danger' : 'text-ink-dim'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
