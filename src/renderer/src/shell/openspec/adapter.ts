import type {
  ChangeDetailView,
  ChangesData,
  GraphData,
  OverviewData,
  SpecDetailView,
  SpecSummary,
  SpecVersionView,
} from '../types'

/**
 * 側欄取得 OpenSpec 資料的唯一介面。
 *
 * **形狀刻意對齊 `spek` 前端既有的 `ApiAdapter`**（`packages/web/src/api/types.ts`）——
 * 那邊已經有 Fetch／postMessage／Static 三個實作，用同一組 method 名餵同一批視圖。差別只在
 * 我們的每個 method 都以 `folderId` 起頭：workspace 同時開著多個 repo，而 spek 的 web 一次
 * 只看一個。
 *
 * 之所以在**不抽出 `@spekjs/ui`** 的情況下仍照它的形狀（`openspec-side-panel` 的 design D1）：
 * 側欄的 UI 是為 320–620px 窄欄自刻的、與 spek 的全寬頁面不是同一個東西，但**接縫是同一個**。
 * 日後若真要接 `@spekjs/ui`，換的是 UI，不是這層。
 *
 * 失敗一律轉成 rejected promise —— IPC 上是結果物件（Electron 序列化 Error 會丟掉 `code`），
 * 到了呈現層則回歸例外，讓 hook 以單一的 error state 承接。
 */
export interface OpenSpecApi {
  getOverview(folderId: string): Promise<OverviewData>
  getSpecs(folderId: string): Promise<SpecSummary[]>
  getSpec(folderId: string, topic: string): Promise<SpecDetailView>
  getSpecAtChange(folderId: string, topic: string, slug: string): Promise<SpecVersionView>
  getChanges(folderId: string): Promise<ChangesData>
  getChange(folderId: string, slug: string): Promise<ChangeDetailView>
  getGraphData(folderId: string): Promise<GraphData>
  /** 各工作目錄的 folder-relative 根（folder 自身為空字串）。供反向交叉導覽的判定。 */
  getWorktreeRoots(folderId: string): Promise<string[]>
}

export class OpenSpecError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'OpenSpecError'
  }
}

async function unwrap<T>(
  result: Promise<{ ok: true; value: T } | { ok: false; code: string; message: string }>,
): Promise<T> {
  const outcome = await result
  if (!outcome.ok) throw new OpenSpecError(outcome.code, outcome.message)
  return outcome.value
}

/** 走 `openspec.*` IPC 的實作。renderer 只認得 preload 白名單暴露的形狀。 */
export class IpcAdapter implements OpenSpecApi {
  getOverview(folderId: string): Promise<OverviewData> {
    return unwrap(window.workspace.openspec.getOverview(folderId))
  }

  getSpecs(folderId: string): Promise<SpecSummary[]> {
    return unwrap(window.workspace.openspec.getSpecs(folderId))
  }

  getSpec(folderId: string, topic: string): Promise<SpecDetailView> {
    return unwrap(window.workspace.openspec.getSpec(folderId, topic))
  }

  getSpecAtChange(folderId: string, topic: string, slug: string): Promise<SpecVersionView> {
    return unwrap(window.workspace.openspec.getSpecAtChange(folderId, topic, slug))
  }

  getChanges(folderId: string): Promise<ChangesData> {
    return unwrap(window.workspace.openspec.getChanges(folderId))
  }

  getChange(folderId: string, slug: string): Promise<ChangeDetailView> {
    return unwrap(window.workspace.openspec.getChange(folderId, slug))
  }

  getGraphData(folderId: string): Promise<GraphData> {
    return unwrap(window.workspace.openspec.getGraphData(folderId))
  }

  getWorktreeRoots(folderId: string): Promise<string[]> {
    return unwrap(window.workspace.openspec.getWorktreeRoots(folderId))
  }
}
