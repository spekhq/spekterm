import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { FsBoundaryError } from './fs-boundary'
import { FsServiceError } from './fs-service'
import { type WatchBatch, WatchService } from './watch-service'
import type { FolderLookup, WorkspaceFolder } from './workspace-store'

let base: string
let repo: string
let outside: string
let batches: WatchBatch[]
let service: WatchService

function lookup(folders: Partial<WorkspaceFolder>[]): FolderLookup {
  return { list: () => folders as WorkspaceFolder[] }
}

function okFolder(): FolderLookup {
  return lookup([{ id: 'f1', path: repo, status: 'ok' }])
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** chokidar 的 add 是非同步的；變更檔案之前必須讓它完成初次掃描。 */
const READY_MS = 300

/** 事件經過主行程的合批（debounce）才會送出，因此輪詢等待而非一次檢查。 */
async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 3000, label = 'condition' }: { timeoutMs?: number; label?: string } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await delay(20)
  }
  throw new Error(`等待逾時：${label}（已收到 ${JSON.stringify(batches)}）`)
}

function events(): { type: string; relPath: string }[] {
  return batches.flatMap((batch) => batch.events)
}

function hasEvent(type: string, relPath: string): boolean {
  return events().some((event) => event.type === type && event.relPath === relPath)
}

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'spek-watch-')))
  repo = path.join(base, 'repo')
  outside = path.join(base, 'outside')
  fs.mkdirSync(path.join(repo, 'sub', 'deep'), { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(repo, 'existing.txt'), 'x')

  batches = []
  service = new WatchService(okFolder(), (batch) => batches.push(batch), 10)
})

afterEach(async () => {
  await service.dispose()
  fs.rmSync(base, { recursive: true, force: true })
})

describe('WatchService 的事件', () => {
  it('監看中的目錄新增檔案時推送 add 事件', async () => {
    await service.watch('f1', '.')
    await delay(READY_MS)

    fs.writeFileSync(path.join(repo, 'created.txt'), 'x')

    await waitFor(() => hasEvent('add', 'created.txt'), { label: 'add created.txt' })
  })

  it('刪除檔案時推送 unlink 事件', async () => {
    await service.watch('f1', '.')
    await delay(READY_MS)

    fs.rmSync(path.join(repo, 'existing.txt'))

    await waitFor(() => hasEvent('unlink', 'existing.txt'), { label: 'unlink existing.txt' })
  })

  it('事件以相對路徑表達，不含絕對路徑', async () => {
    await service.watch('f1', 'sub')
    await delay(READY_MS)

    fs.writeFileSync(path.join(repo, 'sub', 'child.txt'), 'x')

    await waitFor(() => hasEvent('add', 'sub/child.txt'), { label: 'add sub/child.txt' })

    for (const event of events()) {
      assert.equal(path.isAbsolute(event.relPath), false, `${event.relPath} 不得為絕對路徑`)
      assert.equal(
        event.relPath.includes(base),
        false,
        `${event.relPath} 不得洩漏 folder 之外的路徑資訊`,
      )
    }
  })

  it('合批：一次寫入多個檔案只推送一個批次', async () => {
    await service.watch('f1', '.')
    await delay(READY_MS)

    for (let index = 0; index < 5; index += 1) {
      fs.writeFileSync(path.join(repo, `batch-${index}.txt`), 'x')
    }

    await waitFor(() => events().filter((event) => event.type === 'add').length >= 5, {
      label: '五個 add 事件',
    })
    assert.ok(batches.length < 5, `應合批推送，實際推送 ${batches.length} 次`)
  })
})

describe('WatchService 的監看範圍', () => {
  it('未被監看的子目錄的變更不產生事件（depth: 0）', async () => {
    await service.watch('f1', '.')
    await delay(READY_MS)

    fs.writeFileSync(path.join(repo, 'sub', 'deep', 'hidden.txt'), 'x')
    // 對照：root 的直接子項目確實會產生事件，證明 watcher 本身是活的
    fs.writeFileSync(path.join(repo, 'visible.txt'), 'x')

    await waitFor(() => hasEvent('add', 'visible.txt'), { label: 'add visible.txt' })
    assert.equal(
      events().some((event) => event.relPath.includes('hidden.txt')),
      false,
      '未展開的子目錄不該被監看',
    )
  })

  it('取消監看後不再收到該目錄的事件', async () => {
    await service.watch('f1', 'sub')
    await delay(READY_MS)

    service.unwatch('f1', 'sub')
    await delay(READY_MS)

    fs.writeFileSync(path.join(repo, 'sub', 'after-unwatch.txt'), 'x')
    await delay(READY_MS)

    assert.equal(events().length, 0, `取消監看後不該再有事件，實際 ${JSON.stringify(events())}`)
  })

  it('重複監看同一目錄不重複建立', async () => {
    await service.watch('f1', 'sub')
    await service.watch('f1', 'sub')
    await service.watch('f1', './sub')

    assert.equal(service.watchedCount, 1)
  })

  it('監看多個目錄後，watchedCount 反映實際數量', async () => {
    await service.watch('f1', '.')
    await service.watch('f1', 'sub')

    assert.equal(service.watchedCount, 2)
  })
})

describe('WatchService 的邊界', () => {
  it('拒絕監看指向 folder 之外的 symlink 目錄', async () => {
    fs.symlinkSync(outside, path.join(repo, 'escape-link'))

    await assert.rejects(service.watch('f1', 'escape-link'), (error: unknown) => {
      assert.ok(error instanceof FsBoundaryError)
      assert.equal(error.code, 'ESCAPES_ROOT')
      return true
    })
    assert.equal(service.watchedCount, 0)
  })

  it('拒絕絕對路徑與上層參照', async () => {
    await assert.rejects(service.watch('f1', '/etc'), FsBoundaryError)
    await assert.rejects(service.watch('f1', '../outside'), FsBoundaryError)
  })

  it('拒絕未知的 folderId', async () => {
    await assert.rejects(service.watch('nope', '.'), (error: unknown) => {
      assert.ok(error instanceof FsServiceError)
      assert.equal(error.code, 'UNKNOWN_FOLDER')
      return true
    })
  })

  it('folder 之內指向外部的 symlink，其目標的變更不產生事件', async () => {
    // followSymlinks 的預設為 true。若沿用預設，watcher 會跟著 symlink 走出 folder。
    fs.symlinkSync(outside, path.join(repo, 'escape-link'))

    await service.watch('f1', '.')
    await delay(READY_MS)

    fs.writeFileSync(path.join(outside, 'secret.txt'), 'x')
    fs.writeFileSync(path.join(repo, 'visible.txt'), 'x')

    await waitFor(() => hasEvent('add', 'visible.txt'), { label: 'add visible.txt' })
    assert.equal(
      events().some((event) => event.relPath.includes('secret.txt')),
      false,
      'watcher 不得跟隨 symlink 走出 workspace folder',
    )
  })
})

describe('WatchService 對 folder 內 symlink 目錄的別名處理', () => {
  // 樹上是兩個節點，磁碟上是同一個目錄。chokidar 只認絕對路徑，因此訂閱與監看必須分層。
  function linkToSub(): string {
    fs.symlinkSync(path.join(repo, 'sub'), path.join(repo, 'link-to-sub'))
    return 'link-to-sub'
  }

  it('經 symlink 節點監看時，事件以該節點的路徑表達', async () => {
    linkToSub()
    await service.watch('f1', 'link-to-sub')
    await delay(READY_MS)

    fs.writeFileSync(path.join(repo, 'sub', 'new.txt'), 'x')

    await waitFor(() => hasEvent('add', 'link-to-sub/new.txt'), {
      label: 'add link-to-sub/new.txt',
    })
    assert.equal(
      hasEvent('add', 'sub/new.txt'),
      false,
      'renderer 只認得它訂閱的那個節點，不該收到真實路徑',
    )
  })

  it('同一目錄被兩個節點訂閱時，事件同時派送給兩者', async () => {
    linkToSub()
    await service.watch('f1', 'sub')
    await service.watch('f1', 'link-to-sub')
    await delay(READY_MS)

    fs.writeFileSync(path.join(repo, 'sub', 'both.txt'), 'x')

    await waitFor(() => hasEvent('add', 'sub/both.txt') && hasEvent('add', 'link-to-sub/both.txt'), {
      label: '兩個節點都收到事件',
    })
  })

  it('別名只佔一個 chokidar 監看路徑', async () => {
    linkToSub()
    await service.watch('f1', 'sub')
    await service.watch('f1', 'link-to-sub')

    assert.equal(service.watchedCount, 2, '樹上兩個節點')
    assert.equal(service.watchedPathCount, 1, '磁碟上一個目錄')
  })

  it('收合其中一個別名，不得停掉另一個節點的監看', async () => {
    linkToSub()
    await service.watch('f1', 'sub')
    await service.watch('f1', 'link-to-sub')
    await delay(READY_MS)

    service.unwatch('f1', 'link-to-sub')
    await delay(READY_MS)

    fs.writeFileSync(path.join(repo, 'sub', 'after.txt'), 'x')

    await waitFor(() => hasEvent('add', 'sub/after.txt'), { label: 'sub 仍在監看' })
    assert.equal(
      hasEvent('add', 'link-to-sub/after.txt'),
      false,
      '已收合的節點不該再收到事件',
    )
  })

  it('最後一個訂閱者離開時，該絕對路徑才真正停止監看', async () => {
    linkToSub()
    await service.watch('f1', 'sub')
    await service.watch('f1', 'link-to-sub')

    service.unwatch('f1', 'link-to-sub')
    assert.equal(service.watchedPathCount, 1)

    service.unwatch('f1', 'sub')
    assert.equal(service.watchedPathCount, 0)
    assert.equal(service.watchedCount, 0)
  })
})

describe('WatchService 的釋放契約', () => {
  it('unwatchAll 之後不再推送事件', async () => {
    await service.watch('f1', '.')
    await delay(READY_MS)

    await service.unwatchAll()
    assert.equal(service.watchedCount, 0)

    batches = []
    fs.writeFileSync(path.join(repo, 'after-dispose.txt'), 'x')
    await delay(READY_MS)

    assert.equal(batches.length, 0)
  })

  it('releaseFolder 只釋放該 folder', async () => {
    await service.watch('f1', '.')
    await service.watch('f1', 'sub')
    assert.equal(service.watchedCount, 2)

    await service.releaseFolder('f1')
    assert.equal(service.watchedCount, 0)
  })

  it('最後一個目錄被取消監看時，watcher 一併關閉', async () => {
    await service.watch('f1', '.')
    service.unwatch('f1', '.')

    assert.equal(service.watchedCount, 0)

    // 關閉之後仍可重新監看，不應留下損壞的狀態
    await service.watch('f1', '.')
    assert.equal(service.watchedCount, 1)
  })

  it('反覆 unwatchAll 不累積 watcher（模擬 renderer 反覆重新載入）', async () => {
    for (let round = 0; round < 3; round += 1) {
      await service.watch('f1', '.')
      await service.watch('f1', 'sub')
      assert.equal(service.watchedCount, 2)
      await service.unwatchAll()
      assert.equal(service.watchedCount, 0)
    }
  })

  it('dispose 之後 watchedCount 歸零', async () => {
    await service.watch('f1', '.')
    await service.dispose()

    assert.equal(service.watchedCount, 0)
  })
})
