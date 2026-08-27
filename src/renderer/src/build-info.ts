/**
 * 建置身分的**唯一**消費點（見 `build-identity`）。
 *
 * ## 為什麼在 `src/renderer/src/` 而不是 `src/shared/`
 *
 * `src/shared` 的契約是「main 與 renderer 都解析得到」（`@shared` alias 同時掛在
 * main / preload / renderer），而 `__BUILD_INFO__` 的 define **只注入 renderer**。
 * 一個帶 `declare const` 的模組住在那裡是一把上了膛的槍：日後任何 main／preload 的 import
 * **型別檢查會過、bundle 也會過**，執行期 `ReferenceError` 打死主行程 —— 而主行程一死，
 * 所有 pty 陪葬。
 *
 * ## 為什麼沒有 fallback
 *
 * 注入若沒生效，這個模組載入即拋錯、app 開不起來。**這是刻意的**：一個「注入失敗就顯示空白」
 * 的設計，其失效方式正是這條能力存在的理由（換版之後行為沒變，而你分不出是修正沒生效還是
 * 根本還在跑舊的）。
 */

export type BuildInfo =
  | { mode: 'build'; version: string; builtAt: string; commit: string; dirty: boolean }
  | { mode: 'development'; version: string }

declare const __BUILD_INFO__: BuildInfo

export const buildInfo: BuildInfo = __BUILD_INFO__
