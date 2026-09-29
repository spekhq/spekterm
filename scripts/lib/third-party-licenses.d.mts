/**
 * `third-party-licenses.mjs` 的型別 —— `electron.vite.config.ts` 只用得到收集端的這幾個函式。
 *
 * 與實作同名同目錄（同 `build-info.d.mts`），刪掉它 `npm run typecheck` 立刻紅。
 */

export function packageRootOf(moduleId: string): string | null
export function packageRootsOf(moduleIds: Iterable<string>): string[]
export function legalCommentsOf(source: string): string[]
