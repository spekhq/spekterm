import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { FsBoundaryError, isWithin, resolveWithinRoot } from './fs-boundary'

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
