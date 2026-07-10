const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  className: 'h-5 w-5',
} as const

interface ActivityItem {
  id: string
  label: string
  enabled: boolean
  icon: React.JSX.Element
  atBottom?: boolean
}

/**
 * 雛型的四個入口全部保留位置，讓版面比例自第一天起就一致。
 * 尚未實作的入口停用並說明原因 —— 點了沒反應會被當成壞掉。
 */
const ITEMS: ActivityItem[] = [
  {
    id: 'sessions',
    label: 'Sessions',
    enabled: true,
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3" y="3" width="7" height="9" />
        <rect x="14" y="3" width="7" height="5" />
        <rect x="14" y="12" width="7" height="9" />
        <rect x="3" y="16" width="7" height="5" />
      </svg>
    ),
  },
  {
    id: 'handoffs',
    label: 'Handoffs',
    enabled: false,
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
    ),
  },
  {
    id: 'search',
    label: '搜尋',
    enabled: false,
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3-3" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: '設定',
    enabled: false,
    atBottom: true,
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
]

export function ActivityBar(): React.JSX.Element {
  return (
    <nav
      aria-label="活動列"
      className="flex h-full flex-col items-center gap-1 bg-shell px-2 py-3"
    >
      {ITEMS.map((item) => (
        <div key={item.id} className={item.atBottom ? 'mt-auto' : undefined}>
          <button
            type="button"
            disabled={!item.enabled}
            aria-current={item.enabled ? 'page' : undefined}
            title={item.enabled ? item.label : `${item.label} — 尚未可用，規劃於後續 Phase`}
            className={
              'flex h-9 w-9 items-center justify-center rounded-md transition-colors ' +
              (item.enabled
                ? 'bg-accent/10 text-accent'
                : 'text-ink-faint opacity-40 hover:bg-transparent')
            }
          >
            {item.icon}
            <span className="sr-only">{item.label}</span>
          </button>
        </div>
      ))}
    </nav>
  )
}
