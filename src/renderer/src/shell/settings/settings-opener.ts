import type { SettingsSection } from './SettingsDialog'

/**
 * Opens Settings at a section from outside the activity bar (`quick-replies` D5: the quick reply row's Edit button).
 * Settings' open state lives in `ActivityBar.tsx`, which subscribes once; anyone else only asks.
 */
const listeners = new Set<(section: SettingsSection) => void>()

export function openSettingsAt(section: SettingsSection): void {
  for (const listener of listeners) listener(section)
}

export function onOpenSettings(listener: (section: SettingsSection) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
