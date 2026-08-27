/**
 * `build-info.mjs` 的型別 —— `electron.vite.config.ts` 是 TypeScript，而 `scripts/` 是純 JS。
 *
 * 這份宣告與實作**同名同目錄**，因此刪掉它 `npm run typecheck` 立刻紅（與 `i18next.d.ts`
 * 那種「拿掉之後沒有任何東西會紅」的 ambient declaration 不同）。
 */

export type BuildIdentity = {
  mode: 'build'
  version: string
  builtAt: string
  commit: string
  dirty: boolean
}

export type DevIdentity = { mode: 'development'; version: string }

export function buildIdentity(repoRoot: string, version: string, builtAt: string): BuildIdentity
export function devIdentity(version: string): DevIdentity
export function compareVersions(a: string, b: string): number
