import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { enumerateFiles } from './file-enumeration'
import { FsBoundaryError } from './fs-boundary'
import {
  BINARY_SNIFF_BYTES,
  FsServiceError,
  MAX_READ_FILE_BYTES,
  createDirectory,
  createFile,
  deleteEntry,
  listDir,
  listFiles,
  readFile,
  rename,
  validateName,
  writeFile,
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

/** 錯誤碼是契約，訊息不是。FsServiceError 與 FsBoundaryError 都以 `code` 表達失敗。 */
async function rejectsWithCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    const typed = error as FsServiceError | FsBoundaryError
    assert.ok(
      typed instanceof FsServiceError || typed instanceof FsBoundaryError,
      `expected a typed fs error, got ${String(error)}`,
    )
    assert.equal(typed.code, code)
    return true
  })
}

/** folder 之外的一塊地。beforeEach 只建了 repo/，越界的測試需要它。 */
function outsideDir(): string {
  const outside = path.join(base, 'outside')
  fs.mkdirSync(outside, { recursive: true })
  return outside
}

describe('validateName', () => {
  it('接受一般的檔名', () => {
    for (const name of ['a.txt', 'my notes.txt', 'fs-boundary.ts', '.gitignore', 'A_b-c.1']) {
      assert.doesNotThrow(() => validateName(name), name)
    }
  })

  it('拒絕空名稱與相對路徑記號', () => {
    for (const name of ['', '.', '..']) {
      assert.throws(() => validateName(name), { code: 'INVALID_NAME' }, name)
    }
  })

  it('拒絕路徑分隔符', () => {
    for (const name of ['a/b', 'a\\b']) {
      assert.throws(() => validateName(name), { code: 'INVALID_NAME' }, name)
    }
  })

  // 以碼位建構，避免把控制字元本身寫進原始碼。
  it('拒絕 NUL 與控制字元', () => {
    for (const codePoint of [0x00, 0x01, 0x1f, 0x7f]) {
      const name = `a${String.fromCharCode(codePoint)}b`
      assert.throws(() => validateName(name), { code: 'INVALID_NAME' }, `U+${codePoint}`)
    }
  })

  // 這幾條在 Linux 上都是合法檔名。擋它們是為了不製造一個只在 Windows 壞掉的 repo。
  it('拒絕其他平台無法開啟的名稱', () => {
    for (const name of ['a:b', 'a?b', 'a*b', 'a|b', 'a<b', 'a>b', 'a"b']) {
      assert.throws(() => validateName(name), { code: 'INVALID_NAME' }, name)
    }
    for (const name of ['x.', 'x ', 'CON', 'con', 'con.txt', 'AUX', 'COM1', 'lpt9.md']) {
      assert.throws(() => validateName(name), { code: 'INVALID_NAME' }, name)
    }
  })
})

describe('writeFile', () => {
  it('覆寫既有檔案並回報新的 mtime', async () => {
    const result = await writeFile(okFolder(), 'f1', 'a-file.txt', 'updated')
    assert.equal(fs.readFileSync(path.join(repo, 'a-file.txt'), 'utf8'), 'updated')
    assert.equal(typeof result.mtimeMs, 'number')
    assert.equal(result.size, 'updated'.length)
  })

  it('目標不存在時拒絕，且不建立檔案', async () => {
    await rejectsWithCode(writeFile(okFolder(), 'f1', 'nope.txt', 'x'), 'NOT_FOUND')
    assert.equal(fs.existsSync(path.join(repo, 'nope.txt')), false)
  })

  it('目標是目錄時拒絕', async () => {
    await rejectsWithCode(writeFile(okFolder(), 'f1', 'sub', 'x'), 'NOT_A_FILE')
  })

  it('拒絕逃逸出邊界的路徑', async () => {
    const outside = outsideDir()
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET')
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(repo, 'escape'))

    await rejectsWithCode(writeFile(okFolder(), 'f1', '../outside/secret.txt', 'x'), 'ESCAPES_ROOT')
    await rejectsWithCode(writeFile(okFolder(), 'f1', 'escape', 'x'), 'ESCAPES_ROOT')
    assert.equal(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'SECRET')
  })

  // design D5：就地寫入。「暫存檔 + 改名」會讓這條失敗。
  it('寫入 folder 內的 symlink 時保留連結，更新其目標', async () => {
    await writeFile(okFolder(), 'f1', 'a-link', 'through-link')
    assert.equal(fs.lstatSync(path.join(repo, 'a-link')).isSymbolicLink(), true)
    assert.equal(fs.readFileSync(path.join(repo, 'a-file.txt'), 'utf8'), 'through-link')
  })

  it('mtime 與基準不符時回報 CONFLICT 並附上磁碟的 mtime', async () => {
    const target = path.join(repo, 'a-file.txt')
    fs.writeFileSync(target, 'from-agent')
    fs.utimesSync(target, new Date(1_000), new Date(2_000))

    await assert.rejects(writeFile(okFolder(), 'f1', 'a-file.txt', 'mine', 1_234), (error) => {
      assert.ok(error instanceof FsServiceError)
      assert.equal(error.code, 'CONFLICT')
      assert.equal(error.detail?.diskMtimeMs, 2_000)
      return true
    })
  })

  // 不帶 O_TRUNC 的理由：被拒絕的寫入不得先把檔案清空。
  it('CONFLICT 時檔案內容原封不動', async () => {
    const target = path.join(repo, 'a-file.txt')
    fs.writeFileSync(target, 'from-agent')
    fs.utimesSync(target, new Date(1_000), new Date(2_000))

    await rejectsWithCode(writeFile(okFolder(), 'f1', 'a-file.txt', 'mine', 1_234), 'CONFLICT')
    assert.equal(fs.readFileSync(target, 'utf8'), 'from-agent')
  })

  it('基準相符時寫入', async () => {
    const target = path.join(repo, 'a-file.txt')
    const { mtimeMs } = fs.statSync(target)
    await writeFile(okFolder(), 'f1', 'a-file.txt', 'mine', mtimeMs)
    assert.equal(fs.readFileSync(target, 'utf8'), 'mine')
  })

  it('省略基準時直接覆寫', async () => {
    const target = path.join(repo, 'a-file.txt')
    fs.utimesSync(target, new Date(1_000), new Date(2_000))
    await writeFile(okFolder(), 'f1', 'a-file.txt', 'forced')
    assert.equal(fs.readFileSync(target, 'utf8'), 'forced')
  })
})

describe('createFile', () => {
  it('建立空的普通檔案', async () => {
    await createFile(okFolder(), 'f1', 'sub/new.txt')
    assert.equal(fs.readFileSync(path.join(repo, 'sub', 'new.txt'), 'utf8'), '')
  })

  it('目標已存在時拒絕', async () => {
    await rejectsWithCode(createFile(okFolder(), 'f1', 'a-file.txt'), 'ALREADY_EXISTS')
    assert.equal(fs.readFileSync(path.join(repo, 'a-file.txt'), 'utf8'), 'x')
  })

  // O_EXCL 的存在性判定看連結本身，因此不會寫穿它（design D6）。
  it('目標是既有的 symlink 時拒絕，不觸碰其目標', async () => {
    await rejectsWithCode(createFile(okFolder(), 'f1', 'a-link'), 'ALREADY_EXISTS')
    assert.equal(fs.lstatSync(path.join(repo, 'a-link')).isSymbolicLink(), true)
    assert.equal(fs.readFileSync(path.join(repo, 'a-file.txt'), 'utf8'), 'x')
  })

  it('父目錄不存在時拒絕，不自動建立中間目錄', async () => {
    await rejectsWithCode(createFile(okFolder(), 'f1', 'deep/nested/x.txt'), 'NOT_FOUND')
    assert.equal(fs.existsSync(path.join(repo, 'deep')), false)
  })

  it('名稱不合法時拒絕', async () => {
    await rejectsWithCode(createFile(okFolder(), 'f1', 'sub/CON'), 'INVALID_NAME')
    await rejectsWithCode(createFile(okFolder(), 'f1', 'sub/bad:name'), 'INVALID_NAME')
  })

  it('拒絕逃逸出邊界的路徑', async () => {
    outsideDir()
    await rejectsWithCode(createFile(okFolder(), 'f1', '../outside/new.txt'), 'ESCAPES_ROOT')
    assert.equal(fs.existsSync(path.join(base, 'outside', 'new.txt')), false)
  })
})

describe('createDirectory', () => {
  it('建立目錄', async () => {
    await createDirectory(okFolder(), 'f1', 'sub/deep')
    assert.equal(fs.statSync(path.join(repo, 'sub', 'deep')).isDirectory(), true)
  })

  it('目標已存在時拒絕', async () => {
    await rejectsWithCode(createDirectory(okFolder(), 'f1', 'sub'), 'ALREADY_EXISTS')
  })

  it('父目錄不存在時拒絕', async () => {
    await rejectsWithCode(createDirectory(okFolder(), 'f1', 'deep/nested'), 'NOT_FOUND')
  })
})

describe('deleteEntry', () => {
  it('刪除檔案', async () => {
    await deleteEntry(okFolder(), 'f1', 'a-file.txt')
    assert.equal(fs.existsSync(path.join(repo, 'a-file.txt')), false)
  })

  it('遞迴刪除非空目錄', async () => {
    await deleteEntry(okFolder(), 'f1', 'sub')
    assert.equal(fs.existsSync(path.join(repo, 'sub')), false)
  })

  // 拿 realPath 去刪，這裡刪掉的會是 a-file.txt 而不是 a-link。
  it('刪除 symlink 時刪的是連結本身，不是它的目標', async () => {
    await deleteEntry(okFolder(), 'f1', 'a-link')
    assert.equal(fs.existsSync(path.join(repo, 'a-link')), false)
    assert.equal(fs.readFileSync(path.join(repo, 'a-file.txt'), 'utf8'), 'x')
  })

  it('遞迴刪除不跟隨其中的 symlink', async () => {
    const outside = outsideDir()
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'KEEP')
    fs.symlinkSync(outside, path.join(repo, 'sub', 'link-out'))

    await deleteEntry(okFolder(), 'f1', 'sub')
    assert.equal(fs.existsSync(path.join(repo, 'sub')), false)
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'KEEP')
  })

  it('拒絕刪除指向邊界外的 symlink', async () => {
    const outside = outsideDir()
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET')
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(repo, 'escape'))

    await rejectsWithCode(deleteEntry(okFolder(), 'f1', 'escape'), 'ESCAPES_ROOT')
    assert.equal(fs.lstatSync(path.join(repo, 'escape')).isSymbolicLink(), true)
  })

  it('拒絕刪除 folder 根目錄自身', async () => {
    await rejectsWithCode(deleteEntry(okFolder(), 'f1', '.'), 'PROTECTED_ROOT')
    assert.equal(fs.existsSync(repo), true)
  })
})

describe('rename', () => {
  it('變更檔案名稱', async () => {
    await rename(okFolder(), 'f1', 'a-file.txt', 'renamed.txt')
    assert.equal(fs.existsSync(path.join(repo, 'a-file.txt')), false)
    assert.equal(fs.readFileSync(path.join(repo, 'renamed.txt'), 'utf8'), 'x')
  })

  it('移動至另一個目錄', async () => {
    await rename(okFolder(), 'f1', 'a-file.txt', 'sub/moved.txt')
    assert.equal(fs.readFileSync(path.join(repo, 'sub', 'moved.txt'), 'utf8'), 'x')
  })

  // rename 會無聲覆蓋既有目標（已實測）。這條測試釘住那道事前檢查。
  it('目標已存在時拒絕，且既有目標不被覆蓋', async () => {
    fs.writeFileSync(path.join(repo, 'other.txt'), 'OTHER')
    await rejectsWithCode(rename(okFolder(), 'f1', 'a-file.txt', 'other.txt'), 'ALREADY_EXISTS')
    assert.equal(fs.readFileSync(path.join(repo, 'other.txt'), 'utf8'), 'OTHER')
    assert.equal(fs.existsSync(path.join(repo, 'a-file.txt')), true)
  })

  it('搬動 symlink 時搬的是連結本身', async () => {
    await rename(okFolder(), 'f1', 'a-link', 'moved-link')
    assert.equal(fs.lstatSync(path.join(repo, 'moved-link')).isSymbolicLink(), true)
    assert.equal(fs.existsSync(path.join(repo, 'a-file.txt')), true)
  })

  it('拒絕來源為指向邊界外的 symlink', async () => {
    const outside = outsideDir()
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET')
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(repo, 'escape'))

    await rejectsWithCode(rename(okFolder(), 'f1', 'escape', 'docs'), 'ESCAPES_ROOT')
    assert.equal(fs.existsSync(path.join(repo, 'docs')), false)
  })

  it('拒絕目標逃逸出邊界', async () => {
    outsideDir()
    await rejectsWithCode(rename(okFolder(), 'f1', 'a-file.txt', '../outside/x.txt'), 'ESCAPES_ROOT')
    assert.equal(fs.existsSync(path.join(repo, 'a-file.txt')), true)
  })

  it('拒絕不合法的目標名稱', async () => {
    await rejectsWithCode(rename(okFolder(), 'f1', 'a-file.txt', 'NUL'), 'INVALID_NAME')
  })

  it('拒絕改名 folder 根目錄自身', async () => {
    await rejectsWithCode(rename(okFolder(), 'f1', '.', 'newname'), 'PROTECTED_ROOT')
  })
})

// ── listFiles ───────────────────────────────────────────────────────────────
//
// 這一組的每一條「排除」與「不跟隨」都有對照組（把實作退回天真的版本必須變紅）——
// 少了它們，這些防線只是註解。對照組的執行紀錄見 change 的 tasks.md。

/** 在指定目錄跑 git，並關掉會污染輸出比對的顏色與使用者設定。 */
function git(cwd: string, args: string[]): void {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'color.ui=false', ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

describe('listFiles 的座標系與種類', () => {
  it('回傳 folder-relative 路徑，且可直接餵給 readFile', async () => {
    const files = await listFiles(okFolder(), 'f1', 'sub')

    // **不是** 'nested.txt'（相對於目標目錄）—— 見 design D10。
    assert.deepEqual(files, ['sub/nested.txt'])

    const content = await readFile(okFolder(), 'f1', files[0])
    assert.equal(content.text, 'x')
  })

  it('遞迴涵蓋各層，且清單不含目錄', async () => {
    fs.mkdirSync(path.join(repo, 'sub', 'deep', 'deeper'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'sub', 'deep', 'deeper', 'bottom.txt'), 'x')

    const files = await listFiles(okFolder(), 'f1', '.')

    assert.ok(files.includes('sub/deep/deeper/bottom.txt'))
    // 'sub'、'sub/deep' 是目錄，不得出現。
    assert.ok(!files.some((f) => f === 'sub' || f === 'sub/deep'))
  })
})

describe('listFiles 與符號連結', () => {
  it('不跟隨指向 folder 之外的 symlink 目錄', async () => {
    const outside = path.join(base, 'outside')
    fs.mkdirSync(outside, { recursive: true })
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'x')
    fs.symlinkSync(outside, path.join(repo, 'escape-link'))

    const files = await listFiles(okFolder(), 'f1', '.')

    // 邊界的包含判定是**字面**比較 —— 'escape-link/secret.txt' 必定通過它。
    // 唯一擋得住的是「不下鑽 symlink」。
    assert.ok(!files.some((f) => f.includes('secret.txt')), JSON.stringify(files))
  })

  it('folder 之內的 symlink 目錄不使同一檔案重複出現', async () => {
    fs.symlinkSync(path.join(repo, 'sub'), path.join(repo, 'sub-link'))

    const files = await listFiles(okFolder(), 'f1', '.')

    assert.equal(files.filter((f) => f.endsWith('nested.txt')).length, 1, JSON.stringify(files))
  })
})

describe('listFiles 的邊界', () => {
  it('拒絕絕對路徑', async () => {
    await assert.rejects(listFiles(okFolder(), 'f1', '/etc'), FsBoundaryError)
  })

  it('拒絕以 .. 逃逸', async () => {
    await assert.rejects(listFiles(okFolder(), 'f1', '../outside'), FsBoundaryError)
  })

  it('拒絕經 symlink 逃逸的目標', async () => {
    const outside = path.join(base, 'outside')
    fs.mkdirSync(outside, { recursive: true })
    fs.symlinkSync(outside, path.join(repo, 'escape-link'))

    await assert.rejects(listFiles(okFolder(), 'f1', 'escape-link'), FsBoundaryError)
  })

  it('拒絕未註冊的 folderId', async () => {
    await rejectsWithCode(listFiles(okFolder(), 'nope', '.'), 'UNKNOWN_FOLDER')
  })

  it('目標是檔案時回報錯誤', async () => {
    await rejectsWithCode(listFiles(okFolder(), 'f1', 'a-file.txt'), 'NOT_A_DIRECTORY')
  })

  it('目標不存在時回報錯誤而非空清單', async () => {
    await assert.rejects(listFiles(okFolder(), 'f1', 'no-such-dir'), FsBoundaryError)
  })
})

describe('listFiles 與非 ASCII 檔名', () => {
  it('以原始檔名回傳，且讀得到內容', async () => {
    // git 預設 core.quotePath=true 會把它 C-quote 成 "\346\270\254..." —— 對照組：
    // 拿掉 `-z`，這條必須變紅。
    const name = '測試筆記.md'
    fs.writeFileSync(path.join(repo, name), 'hello')
    git(repo, ['init', '-q', '-b', 'main'])
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-qm', 'init'])

    const files = await listFiles(okFolder(), 'f1', '.')

    assert.ok(files.includes(name), JSON.stringify(files))
    const content = await readFile(okFolder(), 'f1', name)
    assert.equal(content.text, 'hello')
  })
})

describe('listFiles 的排除規則', () => {
  it('排除位於自身之內的其他 git 工作目錄', async () => {
    git(repo, ['init', '-q', '-b', 'main'])
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-qm', 'init'])
    // 使用者的標準工作流：worktree 開在 repo 內部。
    git(repo, ['worktree', 'add', '-q', '-b', 'feat', '.claude/worktrees/wt'])

    const files = await listFiles(okFolder(), 'f1', '.')

    assert.ok(
      !files.some((f) => f.startsWith('.claude/worktrees/')),
      JSON.stringify(files.filter((f) => f.startsWith('.claude'))),
    )
    // 而主工作目錄那一份仍在 —— 否則「排除」可能只是整個列舉壞了。
    assert.ok(files.includes('a-file.txt'), JSON.stringify(files))
  })

  it('排除版控忽略的內容', async () => {
    fs.mkdirSync(path.join(repo, 'built'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'built', 'bundle.js'), 'x')
    fs.writeFileSync(path.join(repo, '.gitignore'), 'built/\n')
    git(repo, ['init', '-q', '-b', 'main'])

    const files = await listFiles(okFolder(), 'f1', '.')

    assert.ok(!files.some((f) => f.startsWith('built/')), JSON.stringify(files))
  })
})

describe('listFiles 的保守列舉（目標不在版控之下）', () => {
  it('非 git 目錄仍回傳清單，且不含 node_modules', async () => {
    fs.mkdirSync(path.join(repo, 'node_modules', 'pkg'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'node_modules', 'pkg', 'index.js'), 'x')

    const files = await listFiles(okFolder(), 'f1', '.')

    assert.ok(files.includes('a-file.txt'), JSON.stringify(files))
    assert.ok(!files.some((f) => f.startsWith('node_modules/')), JSON.stringify(files))
  })

  it('目標整個被版控忽略時仍回傳其下的檔案', async () => {
    // git 對此 exit 0 且無輸出 —— 在 exit code 上與「成功」無法區分，只能以「成功但為空」判定。
    fs.mkdirSync(path.join(repo, 'out'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'out', 'made.js'), 'x')
    fs.writeFileSync(path.join(repo, '.gitignore'), 'out/\n')
    git(repo, ['init', '-q', '-b', 'main'])

    const files = await listFiles(okFolder(), 'f1', 'out')

    assert.deepEqual(files, ['out/made.js'])
  })
})

describe('listFiles 不阻塞主行程', () => {
  it('列舉期間事件迴圈仍在運行', async () => {
    git(repo, ['init', '-q', '-b', 'main'])

    // **不以「某個同步 API 未被呼叫」代之** —— ESM 具名匯入不經屬性查找，攔截攔不到它，
    // 那條斷言在同步實作下照樣是綠的。改為直接觀察待驗的性質本身。
    //
    // 判準是「一個完整的 event loop tick 之後，列舉還沒完成」：同步的 spawn 會在函式回傳
    // 之前就把整件事做完，非同步的至少要跨數個 tick（建立行程、等它結束、讀它的輸出）。
    // **不可改成「await 之後檢查一個 0ms timer 有沒有跑」** —— 那在兩種實作下都會通過。
    let done = false
    const pending = enumerateFiles(repo).then((files) => {
      done = true
      return files
    })

    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(done, false, '列舉在一個 event loop tick 內就完成了 —— 它是同步的')

    const files = await pending
    assert.ok(files.length > 0, '列舉本身要有結果，否則上面那條可能只是它整個壞了')
  })
})
