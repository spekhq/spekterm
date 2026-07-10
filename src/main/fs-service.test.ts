import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { FsBoundaryError } from './fs-boundary'
import {
  BINARY_SNIFF_BYTES,
  FsServiceError,
  MAX_READ_FILE_BYTES,
  listDir,
  readFile,
} from './fs-service'
import type { FolderLookup, WorkspaceFolder } from './workspace-store'

let base: string
let repo: string

/** 最小的 FolderLookup 替身：fs-service 只需要 id / path / status。 */
function lookup(folders: Partial<WorkspaceFolder>[]): FolderLookup {
  return { list: () => folders as WorkspaceFolder[] }
}

function okFolder(): FolderLookup {
  return lookup([{ id: 'f1', path: repo, status: 'ok' }])
}

/** 忽略 mtimeMs 的比對 —— 時間戳因執行而異，形狀才是契約。 */
function shapeOf(entries: { name: string; kind: string; mtimeMs: number }[]): unknown[] {
  return entries.map(({ name, kind }) => ({ name, kind }))
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

    assert.deepEqual(shapeOf(entries), [
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
    assert.deepEqual(shapeOf(entries), [{ name: 'nested.txt', kind: 'file' }])
  })

  it('每個項目帶有數值時間戳，而非已格式化的字串', async () => {
    const entries = await listDir(okFolder(), 'f1', '.')

    for (const entry of entries) {
      assert.equal(typeof entry.mtimeMs, 'number', `${entry.name} 的 mtimeMs 應為數字`)
      assert.ok(entry.mtimeMs > 0, `${entry.name} 的 mtimeMs 應為正數`)
    }
  })

  it('時間戳反映實際的修改時間', async () => {
    const target = path.join(repo, 'a-file.txt')
    const past = new Date('2020-01-02T03:04:05Z')
    fs.utimesSync(target, past, past)

    const entries = await listDir(okFolder(), 'f1', '.')
    const entry = entries.find((candidate) => candidate.name === 'a-file.txt')

    assert.ok(entry)
    assert.equal(entry.mtimeMs, past.getTime())
  })

  it('symlink 的時間戳取自 symlink 自身，而非其目標', async () => {
    // 種類以 lstat 語意判定，時間戳若改用 stat 就會與種類不一致。
    const past = new Date('2020-01-02T03:04:05Z')
    fs.lutimesSync(path.join(repo, 'a-link'), past, past)

    const entries = await listDir(okFolder(), 'f1', '.')
    const link = entries.find((candidate) => candidate.name === 'a-link')

    assert.ok(link)
    assert.equal(link.kind, 'symlink')
    assert.equal(link.mtimeMs, past.getTime())
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

describe('readFile 的正常路徑', () => {
  it('回傳文字內容、大小與時間戳', async () => {
    fs.writeFileSync(path.join(repo, 'hello.txt'), 'hello\nworld\n')

    const file = await readFile(okFolder(), 'f1', 'hello.txt')

    assert.equal(file.text, 'hello\nworld\n')
    assert.equal(file.size, 12)
    assert.equal(typeof file.mtimeMs, 'number')
  })

  it('去除 UTF-8 BOM', async () => {
    fs.writeFileSync(path.join(repo, 'bom.txt'), Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x62]))

    const file = await readFile(okFolder(), 'f1', 'bom.txt')

    assert.equal(file.text, 'ab', 'BOM 不該出現在內容的第一個字元')
  })

  it('讀取剛好等於上限的檔案', async () => {
    fs.writeFileSync(path.join(repo, 'exact.txt'), Buffer.alloc(MAX_READ_FILE_BYTES, 0x61))

    const file = await readFile(okFolder(), 'f1', 'exact.txt')

    assert.equal(file.size, MAX_READ_FILE_BYTES, '上限本身應被接受，拒絕的是「超過」')
  })

  it('經 symlink 讀取 folder 內的檔案', async () => {
    const file = await readFile(okFolder(), 'f1', 'a-link')
    assert.equal(file.text, 'x')
  })
})

describe('readFile 的拒絕條件', () => {
  it('超過上限的檔案被拒絕，並回報大小與上限', async () => {
    fs.writeFileSync(path.join(repo, 'big.txt'), Buffer.alloc(MAX_READ_FILE_BYTES + 1, 0x61))

    await assert.rejects(readFile(okFolder(), 'f1', 'big.txt'), (error: unknown) => {
      assert.ok(error instanceof FsServiceError)
      assert.equal(error.code, 'TOO_LARGE')
      assert.equal(error.detail?.limit, MAX_READ_FILE_BYTES)
      assert.equal(error.detail?.size, MAX_READ_FILE_BYTES + 1)
      return true
    })
  })

  it('上限低於 Monaco 停止語法標記的門檻（20 MB）', () => {
    // 否則「檢視器提供語法高亮」對某些被我們接受的檔案就是假的。
    assert.ok(
      MAX_READ_FILE_BYTES < 20 * 1024 * 1024,
      '上限必須留在 Monaco 的 LARGE_FILE_SIZE_THRESHOLD 之下',
    )
  })

  it('NUL 出現在取樣範圍之內即視為二進位', async () => {
    // git 的判準：前 8000 bytes 內含 NUL。此處放在最後一個 byte（offset 7999）。
    const buffer = Buffer.alloc(20_000, 0x61)
    buffer[BINARY_SNIFF_BYTES - 1] = 0
    fs.writeFileSync(path.join(repo, 'binary.bin'), buffer)

    await assert.rejects(readFile(okFolder(), 'f1', 'binary.bin'), (error: unknown) => {
      assert.ok(error instanceof FsServiceError)
      assert.equal(error.code, 'BINARY')
      return true
    })
  })

  it('NUL 出現在取樣範圍之外則視為文字', async () => {
    // 對照組。少了它，「取樣長度」這個參數形同虛設 —— 全檔掃描也會通過上一個測試。
    const buffer = Buffer.alloc(20_000, 0x61)
    buffer[BINARY_SNIFF_BYTES + 1000] = 0
    fs.writeFileSync(path.join(repo, 'late-nul.txt'), buffer)

    const file = await readFile(okFolder(), 'f1', 'late-nul.txt')

    assert.equal(file.size, 20_000)
  })

  it('目標是目錄', async () => {
    await assert.rejects(readFile(okFolder(), 'f1', 'sub'), (error: unknown) => {
      assert.ok(error instanceof FsServiceError)
      assert.equal(error.code, 'NOT_A_FILE')
      return true
    })
  })

  it('絕對路徑、上層參照與 symlink 逃逸一律拒絕', async () => {
    const outside = path.join(base, 'outside.txt')
    fs.writeFileSync(outside, 'secret')
    fs.symlinkSync(outside, path.join(repo, 'escape-link'))

    await assert.rejects(readFile(okFolder(), 'f1', '/etc/passwd'), FsBoundaryError)
    await assert.rejects(readFile(okFolder(), 'f1', '../outside.txt'), FsBoundaryError)
    await assert.rejects(readFile(okFolder(), 'f1', 'escape-link'), (error: unknown) => {
      assert.ok(error instanceof FsBoundaryError)
      assert.equal(error.code, 'ESCAPES_ROOT')
      return true
    })
  })

  it('未知的 folderId', async () => {
    await assert.rejects(readFile(okFolder(), 'nope', 'a-file.txt'), (error: unknown) => {
      assert.ok(error instanceof FsServiceError)
      assert.equal(error.code, 'UNKNOWN_FOLDER')
      return true
    })
  })
})
