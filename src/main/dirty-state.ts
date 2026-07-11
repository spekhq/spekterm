/**
 * renderer 未存變更的快照，由 renderer 主動推送。
 *
 * **為什麼是推送而不是查詢**：`window.on('close')` 的 handler 是同步的 —— 要
 * `preventDefault()` 就得當下決定，不能等一次 IPC 往返。若在關閉的那一刻才去問 renderer，
 * 而 renderer 沒有回應（掛了、正在跑長任務），結果就是靜默丟棄使用者的變更，也就是這整條
 * requirement 要防的事（design D15）。
 *
 * 快照以 `webContents.id` 分格，因此多個視窗各自持有自己的 dirty 集合。
 */
export interface DirtyEntry {
  folderId: string
  /** folder 內的相對路徑。呈現於原生對話框，因此不含絕對路徑。 */
  relPath: string
  /** folder 的顯示名稱，供對話框列出「哪個 repo 的哪個檔案」。 */
  folderName: string
}

export class DirtyStateStore {
  readonly #byContents = new Map<number, DirtyEntry[]>()

  set(contentsId: number, entries: DirtyEntry[]): void {
    if (entries.length === 0) {
      this.#byContents.delete(contentsId)
      return
    }
    this.#byContents.set(contentsId, entries)
  }

  list(contentsId: number): DirtyEntry[] {
    return this.#byContents.get(contentsId) ?? []
  }

  release(contentsId: number): void {
    this.#byContents.delete(contentsId)
  }
}
