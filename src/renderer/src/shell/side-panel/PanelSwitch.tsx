import type { PanelIdentity } from '../types'

interface PanelSwitchProps {
  active: PanelIdentity
  /** repo 沒有 `openspec/` 時，OpenSpec 身分不可用。Files 恆可用。 */
  openSpecEnabled: boolean
  onSelect: (identity: PanelIdentity) => void
}

interface TabProps {
  identity: PanelIdentity
  label: string
  icon: string
  active: boolean
  disabled: boolean
  title: string
  onSelect: (identity: PanelIdentity) => void
}

function Tab({
  identity,
  label,
  icon,
  active,
  disabled,
  title,
  onSelect,
}: TabProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      title={title}
      onClick={() => onSelect(identity)}
      className={[
        'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
        active ? 'bg-hover text-ink' : 'text-ink-dim',
        disabled ? 'cursor-not-allowed opacity-40' : 'hover:text-accent',
      ].join(' ')}
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

/**
 * OpenSpec 與 Files 是 side panel 的兩個同層級、互斥身分（雛型的 `#panel-switch`）。
 *
 * OpenSpec 是**條件式身分**：repo 沒有 `openspec/` 時停用 —— 使用者應在點擊之前就知道
 * 這個 repo 只能以 Files 身分使用。這正是「spek 以 OpenSpec 為核心，但版面不因缺少
 * OpenSpec 就殘廢」的體現。
 */
export function PanelSwitch({
  active,
  openSpecEnabled,
  onSelect,
}: PanelSwitchProps): React.JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="side panel 身分切換"
      className="flex items-center gap-[2px] rounded border border-hairline p-[2px]"
    >
      <Tab
        identity="openspec"
        label="OpenSpec"
        icon="◈"
        active={active === 'openspec'}
        disabled={!openSpecEnabled}
        title={
          openSpecEnabled
            ? 'OpenSpec：這個 repo 的 spec 與 change'
            : '這個 repo 沒有 openspec/，只能使用 Files 身分'
        }
        onSelect={onSelect}
      />
      <Tab
        identity="files"
        label="Files"
        icon="▤"
        active={active === 'files'}
        disabled={false}
        title="Files：這個 repo 的檔案樹"
        onSelect={onSelect}
      />
    </div>
  )
}
