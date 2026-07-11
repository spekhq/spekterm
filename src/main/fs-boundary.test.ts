import assert from 'node:assert/strict'
import fs, { constants } from 'node:fs'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  FsBoundaryError,
  isWithin,
  openExistingForWrite,
  openNoFollow,
  resolveNewWithin,
  resolveWithinRoot,
} from './fs-boundary'

async function rejectsWithCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof FsBoundaryError, `expected FsBoundaryError, got ${String(error)}`)
    assert.equal(error.code, code)
    return true
  })
}

describe('isWithin', () => {
  it('視 root 自身為在內', () => {
    assert.equal(isWithin('/a/b', '/a/b'), true)
  })

  it('接受真正的子路徑', () => {
    assert.equal(isWithin('/a/b', '/a/b/c/d'), true)
  })

  it('拒絕上層目錄', () => {
    assert.equal(isWithin('/a/b', '/a'), false)
    assert.equal(isWithin('/a/b', '/'), false)
  })

  // 這是 startsWith 前綴比對唯一會答錯的案例，也是本函式存在的理由。
  it('拒絕以 root 為字串前綴的兄弟目錄', () => {
    assert.equal(isWithin('/a/b', '/a/bc'), false)
    assert.equal('/a/bc'.startsWith('/a/b'), true, '前提：字串前綴確實成立')
  })
})

describe('resolveWithinRoot', () => {
  let root: string
  let outside: string

  before(() => {
    const base = fs.realpathSync(mkdtempSync(path.join(tmpdir(), 'spek-boundary-')))
    root = path.join(base, 'root')
    outside = path.join(base, 'outside')
    mkdirSync(path.join(root, 'sub'), { recursive: true })
    mkdirSync(outside, { recursive: true })
    writeFileSync(path.join(root, 'file.txt'), 'x')
    writeFileSync(path.join(outside, 'secret.txt'), 'x')
    // root 內的 symlink 指向 root 外 —— 純字面檢查抓不到
    symlinkSync(outside, path.join(root, 'escape-link'))
    symlinkSync(path.join(root, 'sub'), path.join(root, 'inside-link'))
    mkdirSync(`${root}c`, { recursive: true }) // 兄弟目錄：/…/root 與 /…/rootc
  })

  after(() => {
    fs.rmSync(path.dirname(root), { recursive: true, force: true })
  })

  it('解析合法的子路徑', async () => {
    assert.equal(await resolveWithinRoot(root, 'sub'), path.join(root, 'sub'))
    assert.equal(await resolveWithinRoot(root, '.'), root)
  })

  it('解析 root 內指向 root 內的 symlink', async () => {
    assert.equal(await resolveWithinRoot(root, 'inside-link'), path.join(root, 'sub'))
  })

  it('拒絕絕對路徑', async () => {
    await rejectsWithCode(resolveWithinRoot(root, '/etc'), 'ABSOLUTE_PATH')
    await rejectsWithCode(resolveWithinRoot(root, path.join(root, 'sub')), 'ABSOLUTE_PATH')
  })

  it('拒絕以上層參照逃逸', async () => {
    await rejectsWithCode(resolveWithinRoot(root, '..'), 'ESCAPES_ROOT')
    await rejectsWithCode(resolveWithinRoot(root, '../outside'), 'ESCAPES_ROOT')
    await rejectsWithCode(resolveWithinRoot(root, 'sub/../../outside/secret.txt'), 'ESCAPES_ROOT')
  })

  it('拒絕經由 symlink 逃逸', async () => {
    await rejectsWithCode(resolveWithinRoot(root, 'escape-link'), 'ESCAPES_ROOT')
    await rejectsWithCode(resolveWithinRoot(root, 'escape-link/secret.txt'), 'ESCAPES_ROOT')
  })

  it('拒絕以 root 為字串前綴的兄弟目錄', async () => {
    const sibling = `${path.basename(root)}c`
    await rejectsWithCode(resolveWithinRoot(root, `../${sibling}`), 'ESCAPES_ROOT')
  })

  it('目標不存在時回報 NOT_FOUND', async () => {
    await rejectsWithCode(resolveWithinRoot(root, 'nope'), 'NOT_FOUND')
  })

  it('root 不存在時回報 NOT_FOUND', async () => {
    await rejectsWithCode(resolveWithinRoot(path.join(root, 'gone'), '.'), 'NOT_FOUND')
  })
})

describe('寫入的邊界', () => {
  let root: string
  let outside: string
  let secret: string

  before(() => {
    const base = fs.realpathSync(mkdtempSync(path.join(tmpdir(), 'spek-write-')))
    root = path.join(base, 'root')
    outside = path.join(base, 'outside')
    mkdirSync(path.join(root, 'sub'), { recursive: true })
    mkdirSync(outside, { recursive: true })
    mkdirSync(`${root}c`, { recursive: true })

    secret = path.join(outside, 'secret.txt')
    writeFileSync(secret, 'SECRET')
    writeFileSync(path.join(root, 'sub', 'a.txt'), 'target')

    symlinkSync(path.join(root, 'sub', 'a.txt'), path.join(root, 'file-link'))
    symlinkSync(secret, path.join(root, 'escape-file-link'))
    symlinkSync(outside, path.join(root, 'escape-link'))
  })

  after(() => {
    fs.rmSync(path.dirname(root), { recursive: true, force: true })
  })

  describe('openExistingForWrite', () => {
    it('拒絕絕對路徑', async () => {
      await rejectsWithCode(openExistingForWrite(root, '/etc/passwd'), 'ABSOLUTE_PATH')
    })

    it('拒絕以上層參照逃逸', async () => {
      await rejectsWithCode(openExistingForWrite(root, '../outside/secret.txt'), 'ESCAPES_ROOT')
      await rejectsWithCode(
        openExistingForWrite(root, 'sub/../../outside/secret.txt'),
        'ESCAPES_ROOT',
      )
    })

    it('拒絕經由 symlink 逃逸', async () => {
      await rejectsWithCode(openExistingForWrite(root, 'escape-file-link'), 'ESCAPES_ROOT')
      await rejectsWithCode(openExistingForWrite(root, 'escape-link/secret.txt'), 'ESCAPES_ROOT')
    })

    it('拒絕以 root 為字串前綴的兄弟目錄', async () => {
      const sibling = `${path.basename(root)}c`
      await rejectsWithCode(openExistingForWrite(root, `../${sibling}`), 'ESCAPES_ROOT')
    })

    // design D5：寫入落在 symlink 指向的真實檔案上，連結本身保留。
    // 「暫存檔 + 改名」的實作會讓這條測試失敗 —— 它把 symlink 換成普通檔案。
    it('寫入 folder 內的 symlink 不取代它，而是更新其目標', async () => {
      const { handle } = await openExistingForWrite(root, 'file-link')
      await handle.truncate(0)
      await handle.write('updated', 0)
      await handle.close()

      const stats = await lstat(path.join(root, 'file-link'))
      assert.equal(stats.isSymbolicLink(), true, 'symlink 必須被保留')
      assert.equal(await readFile(path.join(root, 'sub', 'a.txt'), 'utf8'), 'updated')
    })
  })

  describe('openNoFollow', () => {
    // race 命中的那一刻，open 面對的正是一個 symlink。這條測試直接證明 O_NOFOLLOW 生效
    // —— 拿掉那個 flag，它就會成功開啟並寫穿到 outside。
    it('目標是 symlink 時拒絕開啟', async () => {
      await rejectsWithCode(
        openNoFollow(path.join(root, 'escape-file-link'), constants.O_WRONLY),
        'SYMLINK_RACE',
      )
      assert.equal(await readFile(secret, 'utf8'), 'SECRET', '邊界外的檔案不得被開啟寫入')
    })

    it('目標是普通檔案時正常開啟', async () => {
      const handle = await openNoFollow(path.join(root, 'sub', 'a.txt'), constants.O_WRONLY)
      await handle.close()
    })
  })

  /**
   * 替換可能落在兩個窗口裡：
   *
   * - **解析途中**（`realpath(root)` 已讓出、`realpath(target)` 尚未執行）—— 本測試覆蓋它。
   *   目標在解析時已是 symlink，`resolveExistingWithin` 以 `ESCAPES_ROOT` 擋下。
   * - **解析之後、`open` 之前** —— 純外部無法可靠命中（沒有可注入的讓出點），
   *   由上面 `openNoFollow` 那條確定性測試覆蓋：它直接以 race 命中時的狀態呼叫 open。
   *
   * 兩者都不得讓邊界外的檔案被改動。
   */
  it('目標在解析途中被替換為越界 symlink，寫入不逸出邊界', async () => {
    const racy = path.join(root, 'racy.txt')
    let blocked = 0

    for (let i = 0; i < 50; i += 1) {
      fs.rmSync(racy, { force: true })
      fs.writeFileSync(racy, 'plain')

      // 呼叫同步執行至第一個 await（`realpath(root)`）便讓出，控制權立刻回到這裡。
      const writing = openExistingForWrite(root, 'racy.txt')
        .then(async ({ handle }) => {
          await handle.truncate(0)
          await handle.write('WROTE-THROUGH', 0)
          await handle.close()
        })
        .catch((error: unknown) => {
          if (error instanceof FsBoundaryError) {
            blocked += 1
            return
          }
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
          throw error
        })

      // 同步替換，趁解析尚未走到 target。
      fs.rmSync(racy, { force: true })
      fs.symlinkSync(secret, racy)

      await writing
    }

    fs.rmSync(racy, { force: true })
    assert.equal(await readFile(secret, 'utf8'), 'SECRET', '邊界外的檔案不得被寫入')
    assert.ok(blocked > 0, `替換必須被邊界擋下，實際擋下 ${blocked}/50 次`)
  })

  describe('resolveNewWithin', () => {
    it('解析尚不存在的目標', async () => {
      assert.equal(await resolveNewWithin(root, 'sub/new.txt'), path.join(root, 'sub', 'new.txt'))
    })

    it('經由 folder 內的 symlink 解析父目錄', async () => {
      symlinkSync(path.join(root, 'sub'), path.join(root, 'sub-link'))
      // 父目錄的 symlink 在此解析完畢，回傳的是真實路徑
      assert.equal(await resolveNewWithin(root, 'sub-link/x.txt'), path.join(root, 'sub', 'x.txt'))
    })

    it('拒絕 folder 根目錄自身', async () => {
      await rejectsWithCode(resolveNewWithin(root, '.'), 'ESCAPES_ROOT')
      await rejectsWithCode(resolveNewWithin(root, ''), 'ESCAPES_ROOT')
    })

    it('拒絕逃逸出邊界的目標', async () => {
      await rejectsWithCode(resolveNewWithin(root, '../outside/new.txt'), 'ESCAPES_ROOT')
      await rejectsWithCode(resolveNewWithin(root, 'escape-link/new.txt'), 'ESCAPES_ROOT')
    })

    it('父目錄不存在時回報 NOT_FOUND，不自動建立中間目錄', async () => {
      await rejectsWithCode(resolveNewWithin(root, 'nope/deep/x.txt'), 'NOT_FOUND')
      assert.equal(fs.existsSync(path.join(root, 'nope')), false)
    })
  })
})
