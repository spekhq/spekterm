/**
 * Automatic hibernation settings shared by the main process and the renderer (`session-hibernation`,
 * `terminal-preferences`).
 */

/** Unset preference = 24 hours. */
export const DEFAULT_AUTO_HIBERNATE_SECONDS = 24 * 60 * 60

/** The choices Settings offers, in seconds. `0` = off. */
export const AUTO_HIBERNATE_PRESETS = [0, 4 * 60 * 60, 24 * 60 * 60, 3 * 24 * 60 * 60, 7 * 24 * 60 * 60] as const

/**
 * The threshold in effect, in seconds; `0` = off.
 *
 * The store already drops anything that is not a non-negative whole number, so the only case left
 * here is "unset", which means the default — not off.
 */
export function effectiveHibernateSeconds(stored: number | undefined): number {
  return stored ?? DEFAULT_AUTO_HIBERNATE_SECONDS
}
