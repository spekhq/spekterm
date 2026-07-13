import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { headPath, parseHead, readBranch } from './git-branch'

/**
 * fixture 一律手工寫檔，不呼叫真的 `git`。
 *
 * HEAD 的三種形式（含 worktree 的 `gitdir:` 間接層）已用真的 git 實測過，記載於本 change 的
 * design D6/D7。在這裡再 spawn 一次 git，只會讓測試依賴機器上裝了 git，並且污染「分支判定
 * 不得 spawn 子行程」那條斷言。
 */
const CHILD_PROCESS_METHODS = [
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'fork',
] as const

function trapChildProcess(): string[] {
  const calls: string[] = []
  for (const method of CHILD_PROCESS_METHODS) {
    mock.method(childProcess, method, ((): undefined => {
      calls.push(method)
      return undefined
    }) as never)
  }
  return calls
}

let base: string

function makeRepo(name: string, headContent: string): string {
  const repo = path.join(base, name)
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true })
  fs.writeFileSync(path.join(repo, '.git', 'HEAD'), headContent)
  return repo
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(tmpdir(), 'spekterm-git-branch-'))
})

afterEach(() => {
  mock.restoreAll()
  fs.rmSync(base, { recursive: true, force: true })
})

describe('parseHead', () => {
  it('位於分支上', () => {
    assert.equal(parseHead('ref: refs/heads/master\n'), 'master')
  })

  it('分支名含斜線 —— 取 refs/heads/ 之後全部，不在第一個斜線斷開', () => {
    assert.equal(parseHead('ref: refs/heads/feat/x\n'), 'feat/x')
    assert.equal(parseHead('ref: refs/heads/user/kewang/wip-2\n'), 'user/kewang/wip-2')
  })

  it('detached HEAD —— 純 sha 取短 sha', () => {
    assert.equal(parseHead('ef48cc91774f5718f672d97f1d0c365702cd57e6\n'), 'ef48cc9')
  })

  it('sha-256 的 repo 一樣認得', () => {
    assert.equal(parseHead('a'.repeat(64) + '\n'), 'aaaaaaa')
  })

  it('無法解讀的內容視為沒有分支，不拋錯', () => {
    assert.equal(parseHead(''), null)
    assert.equal(parseHead('\n\n'), null)
    assert.equal(parseHead('garbage'), null)
    assert.equal(parseHead('ref: refs/remotes/origin/master\n'), null) // 不指向 refs/heads
    assert.equal(parseHead('ref: refs/heads/\n'), null) // 空分支名
  })
})

describe('readBranch', () => {
  it('一般 repo', () => {
    assert.equal(readBranch(makeRepo('a', 'ref: refs/heads/master\n')), 'master')
  })

  it('detached HEAD 不使判定失效', () => {
    const repo = makeRepo('b', 'ef48cc91774f5718f672d97f1d0c365702cd57e6\n')
    assert.equal(readBranch(repo), 'ef48cc9')
  })

  it('不是 git repo —— 沒有分支是合法狀態，不是錯誤', () => {
    const plain = path.join(base, 'plain')
    fs.mkdirSync(plain)
    assert.equal(readBranch(plain), null)
  })

  it('folder 根本不存在也不拋錯', () => {
    assert.equal(readBranch(path.join(base, 'nope')), null)
  })

  it('.git 存在但 HEAD 不存在（.git 剛被建立）', () => {
    const repo = path.join(base, 'empty')
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true })
    assert.equal(readBranch(repo), null)
  })

  it('git worktree：.git 是檔案，gitdir 為絕對路徑', () => {
    // 實測的形式：<worktree>/.git 內容為 `gitdir: /abs/repo/.git/worktrees/wt`
    const main = makeRepo('main', 'ref: refs/heads/master\n')
    const gitDir = path.join(main, '.git', 'worktrees', 'wt')
    fs.mkdirSync(gitDir, { recursive: true })
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/feat/x\n')

    const wt = path.join(base, 'wt')
    fs.mkdirSync(wt)
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gitDir}\n`)

    assert.equal(readBranch(wt), 'feat/x')
    assert.equal(readBranch(main), 'master', '主 repo 的分支不受 worktree 影響')
  })

  it('submodule：.git 是檔案，gitdir 為相對路徑', () => {
    const parent = path.join(base, 'parent')
    const gitDir = path.join(parent, '.git', 'modules', 'sub')
    fs.mkdirSync(gitDir, { recursive: true })
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/sub-branch\n')

    const sub = path.join(parent, 'sub')
    fs.mkdirSync(sub)
    fs.writeFileSync(path.join(sub, '.git'), 'gitdir: ../.git/modules/sub\n')

    assert.equal(readBranch(sub), 'sub-branch')
  })

  it('.git 是檔案但內容無法解讀', () => {
    const repo = path.join(base, 'bad')
    fs.mkdirSync(repo)
    fs.writeFileSync(path.join(repo, '.git'), 'not a gitdir pointer\n')
    assert.equal(readBranch(repo), null)
  })

  it('gitdir 指向不存在的位置', () => {
    const repo = path.join(base, 'dangling')
    fs.mkdirSync(repo)
    fs.writeFileSync(path.join(repo, '.git'), `gitdir: ${path.join(base, 'gone')}\n`)
    assert.equal(readBranch(repo), null)
  })

  it('分支判定不呼叫任何外部程式', () => {
    const repo = makeRepo('c', 'ref: refs/heads/master\n')

    const calls = trapChildProcess()
    const branch = readBranch(repo)

    assert.equal(branch, 'master')
    assert.deepEqual(calls, [], `分支判定不得 spawn 外部程式，實際呼叫：${calls.join(', ')}`)

    // 對照組：證明攔截確實生效，而不是因為攔截失效才看起來「沒有呼叫」
    childProcess.spawnSync('true')
    assert.deepEqual(calls, ['spawnSync'], '攔截未生效，上一項斷言沒有意義')
  })
})

describe('headPath', () => {
  it('一般 repo 指向 <folder>/.git/HEAD', () => {
    const repo = makeRepo('d', 'ref: refs/heads/master\n')
    assert.equal(headPath(repo), path.join(repo, '.git', 'HEAD'))
  })

  it('worktree 指向 gitdir 底下的 HEAD —— 那可能在 folder 邊界之外', () => {
    const gitDir = path.join(base, 'elsewhere', 'worktrees', 'wt')
    fs.mkdirSync(gitDir, { recursive: true })

    const wt = path.join(base, 'wt2')
    fs.mkdirSync(wt)
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gitDir}\n`)

    assert.equal(headPath(wt), path.join(gitDir, 'HEAD'))
  })

  it('非 git repo 沒有東西可監看', () => {
    const plain = path.join(base, 'plain2')
    fs.mkdirSync(plain)
    assert.equal(headPath(plain), null)
  })
})
