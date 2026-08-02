/**
 * renderer 不直接 import 主行程的模組 —— 它只認得 preload 白名單暴露的形狀。
 * 由 API 的回傳型別反推 DTO，能力若被移除，這裡會立刻編譯失敗。
 */
type WorkspaceFs = Window['workspace']['fs']

/** fs 呼叫的失敗以結果物件回報：Electron 的 IPC 序列化只保留 message，會丟掉 code。 */
export type FsFailure = Extract<Awaited<ReturnType<WorkspaceFs['listDir']>>, { ok: false }>

export type FsResult<T> = { ok: true; value: T } | FsFailure

export type WorkspaceFolder = Awaited<ReturnType<Window['workspace']['folders']['list']>>[number]

/**
 * 側欄座標：rail 上的每個項目各記著「我站在這裡時，側欄看什麼」（`side-panel-source`）。
 *
 * 與其他 DTO 同樣**自 preload 推導** —— 主行程日後在座標上加維度，會自己流穿到這裡。
 */
export type PanelSnapshot = Awaited<ReturnType<Window['workspace']['panel']['get']>>

export type PanelCoordinates = PanelSnapshot['coordinates']

export type PanelCoordinate = PanelCoordinates[string]

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

/**
 * rail 上「選中哪個項目」—— workspace 的某個 folder，或那個不隸屬任何 folder 的全域項目
 * （`global-session`）。`null` 表示**尚未選中任何項目**。
 *
 * **這是唯一刻意不沿用「`null` ＝ 全域」的地方**（design D8）：session 的歸屬以
 * `folderId: string | null` 表示，但在 rail 的選中狀態上，`null` 早已被「沒有選中」佔用。
 * 兩者若共用同一個缺席值，每一處以「有沒有選中」為條件的行為（快捷鍵的無操作條件、狀態列的
 * 空狀態）都會把使用者**明確選中**的全域項目誤判為「他還沒選」。
 *
 * 而 sentinel 字串在這裡同樣不可接受 —— 它會靜默流進每一個 `folders.find()`。
 */
export type RailSelection = { kind: 'global' } | { kind: 'folder'; id: string }

/** 便利建構子：`select(folderSelection(id))` 讀起來比字面物件清楚。 */
export function folderSelection(id: string): RailSelection {
  return { kind: 'folder', id }
}

/** 選中的若是 folder 就取其識別碼，否則為 `null`（未選中，或選中的是全域項目）。 */
export function selectedFolderId(selection: RailSelection | null): string | null {
  return selection?.kind === 'folder' ? selection.id : null
}

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
