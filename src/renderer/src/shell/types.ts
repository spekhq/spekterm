/**
 * renderer 不直接 import 主行程的模組 —— 它只認得 preload 白名單暴露的形狀。
 * 由 API 的回傳型別反推 DTO，能力若被移除，這裡會立刻編譯失敗。
 */
export type WorkspaceFolder = Awaited<
  ReturnType<Window['workspace']['folders']['list']>
>[number]

export type DirEntry = Awaited<ReturnType<Window['workspace']['fs']['listDir']>>[number]
