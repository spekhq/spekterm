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

type WorkspaceOpenSpec = Window['workspace']['openspec']

/** 結果物件的成功值。OpenSpec 的每個 method 都回 `FsResult<T>`。 */
type OkValue<T> = T extends { ok: true; value: infer V } ? V : never

export type OverviewData = OkValue<Awaited<ReturnType<WorkspaceOpenSpec['getOverview']>>>

export type SpecSummary = OkValue<Awaited<ReturnType<WorkspaceOpenSpec['getSpecs']>>>[number]

export type SpecDetailView = OkValue<Awaited<ReturnType<WorkspaceOpenSpec['getSpec']>>>

export type SpecVersionView = OkValue<Awaited<ReturnType<WorkspaceOpenSpec['getSpecAtChange']>>>

/**
 * 一個可供選擇的工作目錄（Files 身分的樹根選擇器）。
 *
 * 與其他 DTO 同樣**自 preload 推導**而非重新宣告 —— 主行程日後在其上加欄位，會自己流穿到這裡。
 */
export type WorktreeOption = OkValue<
  Awaited<ReturnType<WorkspaceOpenSpec['getWorktrees']>>
>[number]

export type ChangesData = OkValue<Awaited<ReturnType<WorkspaceOpenSpec['getChanges']>>>

/** change 清單裡的一列。 */
export type ChangeInfo = ChangesData['active'][number]

export type ChangeDetailView = OkValue<Awaited<ReturnType<WorkspaceOpenSpec['getChange']>>>

export type ChangeArtifactView = ChangeDetailView['artifacts'][number]

export type ParsedTasks = NonNullable<ChangeArtifactView['tasks']>

export type DeltaSpecView = NonNullable<ChangeArtifactView['specs']>[number]

export type GraphData = OkValue<Awaited<ReturnType<WorkspaceOpenSpec['getGraphData']>>>

export type GraphNode = GraphData['nodes'][number]

export type GraphEdge = GraphData['edges'][number]

type WorkspaceTerminal = Window['workspace']['terminal']

/** 新 session 的 spawn 目標。同樣由白名單回推 —— renderer 不 import 主行程模組。 */
export type SpawnTarget = Parameters<WorkspaceTerminal['create']>[1]

/** focused session 的主行程側狀態（cwd／git／agent 用量）。同樣由白名單回推。 */
export type SessionStatus = Parameters<Parameters<WorkspaceTerminal['onStatus']>[0]>[0]

/** 終端外觀偏好（字型 family / size）。由白名單回推 —— renderer 不 import 主行程模組。 */
export type TerminalPreferences = Awaited<ReturnType<Window['workspace']['settings']['get']>>
