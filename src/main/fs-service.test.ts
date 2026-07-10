import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { FsBoundaryError } from './fs-boundary'
import { FsServiceError, listDir } from './fs-service'
import type { FolderLookup, WorkspaceFolder } from './workspace-store'

let base: string
let repo: string

/** 最小的 FolderLookup 替身：listDir 只需要 id / path / status。 */
function lookup(folders: Partial<WorkspaceFolder>[]): FolderLookup {
  return { list: () => folders as WorkspaceFolder[] }
}

function okFolder(): FolderLookup {
  return lookup([{ id: 'f1', path: repo, status: 'ok' }])
}

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'spek-fsservice-')))
  repo = path.join(base, 'repo')
  fs.mkdirSync(path.join(repo, 'sub'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'a-file.txt'), 'x')
  fs.symlinkSync(path.join(repo, 'a-file.txt'), path.join(repo, 'a-link'))
  fs.writeFileSync(path.join(repo, 'sub', 'nested.txt'), 'x')
})

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true })
})

describe('listDir 的正常路徑', () => {
  it('回報混合種類的目錄且不遞迴', async () => {
    const entries = await listDir(okFolder(), 'f1', '.')

    assert.deepEqual(entries, [
      { name: 'a-file.txt', kind: 'file' },
      { name: 'a-link', kind: 'symlink' },
      { name: 'sub', kind: 'directory' },
    ])
    assert.equal(
      entries.some((entry) => entry.name === 'nested.txt'),
      false,
      '不得包含子目錄之下的項目',
    )
  })

  it('以相對路徑列出子目錄', async () => {
    const entries = await listDir(okFolder(), 'f1', 'sub')
    assert.deepEqual(entries, [{ name: 'nested.txt', kind: 'file' }])
  })
})

describe('listDir 的拒絕條件', () => {
  it('未知的 folderId', async () => {
    await assert.rejects(listDir(okFolder(), 'nope', '.'), (error: unknown) => {
      assert.ok(error instanceof FsServiceError)
      assert.equal(error.code, 'UNKNOWN_FOLDER')
      return true
    })
  })

  it('folder 路徑失效', async () => {
    const store = lookup([{ id: 'f1', path: path.join(base, 'gone'), status: 'missing' }])
    await assert.rejects(listDir(store, 'f1', '.'), (error: unknown) => {
      assert.ok(error instanceof FsServiceError)
      assert.equal(error.code, 'FOLDER_UNAVAILABLE')
      return true
    })
  })

  it('目標是檔案而非目錄', async () => {
    await assert.rejects(listDir(okFolder(), 'f1', 'a-file.txt'), (error: unknown) => {
      assert.ok(error instanceof FsServiceError)
      assert.equal(error.code, 'NOT_A_DIRECTORY')
      return true
    })
  })

  it('目標不存在時回報錯誤而非空清單', async () => {
    await assert.rejects(listDir(okFolder(), 'f1', 'missing-dir'), (error: unknown) => {
      assert.ok(error instanceof FsBoundaryError)
      assert.equal(error.code, 'NOT_FOUND')
      return true
    })
  })

  it('絕對路徑與越界一律拒絕', async () => {
    await assert.rejects(listDir(okFolder(), 'f1', '/etc'), FsBoundaryError)
    await assert.rejects(listDir(okFolder(), 'f1', '../'), FsBoundaryError)
  })
})
