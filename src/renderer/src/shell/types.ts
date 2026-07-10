/**
 * renderer 不直接 import 主行程的模組 —— 它只認得 preload 白名單暴露的形狀。
 * 由 API 的回傳型別反推 DTO，能力若被移除，這裡會立刻編譯失敗。
 */
type WorkspaceFs = Window['workspace']['fs']

/** fs 呼叫的失敗以結果物件回報：Electron 的 IPC 序列化只保留 message，會丟掉 code。 */
export type FsFailure = Extract<Awaited<ReturnType<WorkspaceFs['listDir']>>, { ok: false }>

export type FsResult<T> = { ok: true; value: T } | FsFailure

export type WorkspaceFolder = Awaited<ReturnType<Window['workspace']['folders']['list']>>[number]

export type DirEntry = Extract<
  Awaited<ReturnType<WorkspaceFs['listDir']>>,
  { ok: true }
>['value'][number]

export type DirEntryKind = DirEntry['kind']

export type FileContent = Extract<
  Awaited<ReturnType<WorkspaceFs['readFile']>>,
  { ok: true }
>['value']

export type WatchBatch = Parameters<Parameters<WorkspaceFs['onWatchEvent']>[0]>[0]

export type WatchEvent = WatchBatch['events'][number]

/** side panel 的兩個同層互斥身分。 */
export type PanelIdentity = 'openspec' | 'files'
