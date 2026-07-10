import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import {
  WORKSPACE_VERSION,
  WorkspaceStore,
  writeWorkspaceFileAtomic,
} from './workspace-store'

const CHILD_PROCESS_METHODS = [
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'fork',
] as const

/**
 * 攔截所有啟動外部程式的入口，回傳被呼叫過的方法名稱。
 *
 * `cross-spawn`（`@spekjs/core` 的唯一 runtime 依賴）走的是 `require('child_process').spawn`，
 * 與這裡改寫的是同一個模組物件 —— 因此若有人把 openspec 偵測換成 `scanOpenSpec()`，
 * 它內部的 `git log` 會被記錄下來，測試立刻失敗。
 */
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
let configPath: string

function makeDir(...segments: string[]): string {
  const target = path.join(base, ...segments)
  fs.mkdirSync(target, { recursive: true })
  return target
}

function readConfig(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'))
}

function corruptFiles(): string[] {
  return fs.readdirSync(base).filter((name) => name.includes('workspace.json.corrupt-'))
}

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'spek-store-')))
  configPath = path.join(base, 'workspace.json')
})

afterEach(() => {
  mock.restoreAll()
  fs.rmSync(base, { recursive: true, force: true })
})

describe('加入與去重', () => {
  it('保存解析 symlink 後的真實路徑', () => {
    const real = makeDir('repo')
    const link = path.join(base, 'link-to-repo')
    fs.symlinkSync(real, link)

    const store = new WorkspaceStore(configPath)
    store.load()
    const added = store.add(link)

    assert.equal(added.path, real)
    assert.equal(added.name, 'repo')
  })

  it('同一目錄經由 symlink 再次加入時不重複', () => {
    const real = makeDir('repo')
    const link = path.join(base, 'link-to-repo')
    fs.symlinkSync(real, link)

    const store = new WorkspaceStore(configPath)
    store.load()
    store.add(real)
    store.add(link)

    assert.equal(store.list().length, 1)
  })

  it('拒絕非目錄的路徑', () => {
    const file = path.join(base, 'a-file')
    fs.writeFileSync(file, 'x')

    const store = new WorkspaceStore(configPath)
    store.load()
    assert.throws(() => store.add(file))
  })
})

describe('移除', () => {
  it('只影響設定，不更動磁碟', () => {
    const repo = makeDir('repo')
    const store = new WorkspaceStore(configPath)
    store.load()
    const added = store.add(repo)

    store.remove(added.id)

    assert.equal(store.list().length, 0)
    assert.equal(fs.existsSync(repo), true, '磁碟上的目錄必須原封不動')
  })
})

describe('持久化', () => {
  it('設定檔帶有版本欄位', () => {
    const store = new WorkspaceStore(configPath)
    store.load()
    store.add(makeDir('repo'))

    assert.equal(readConfig().version, WORKSPACE_VERSION)
  })

  it('重啟後還原清單且順序一致', () => {
    const first = new WorkspaceStore(configPath)
    first.load()
    first.add(makeDir('alpha'))
    first.add(makeDir('beta'))
    first.add(makeDir('gamma'))

    const second = new WorkspaceStore(configPath)
    second.load()

    assert.deepEqual(
      second.list().map((folder) => folder.name),
      ['alpha', 'beta', 'gamma'],
    )
  })

  it('衍生欄位不寫入設定檔', () => {
    const store = new WorkspaceStore(configPath)
    store.load()
    store.add(makeDir('repo', 'openspec'))
    store.add(makeDir('repo'))

    const persisted = readConfig().folders as Record<string, unknown>[]
    for (const folder of persisted) {
      assert.deepEqual(Object.keys(folder).sort(), ['addedAt', 'id', 'path'])
    }
  })

  it('寫入過程不留下不完整的設定檔', () => {
    fs.writeFileSync(configPath, '{"version":1,"folders":[]}\n')
    const before = fs.readFileSync(configPath, 'utf8')

    // rename 失敗時，目標檔必須仍是舊內容 —— 證明新內容先落在暫存檔而非直接覆寫目標
    mock.method(fs, 'renameSync', () => {
      throw new Error('rename failed')
    })

    const store = new WorkspaceStore(configPath)
    store.load()
    assert.throws(() => store.add(makeDir('repo')))

    assert.equal(fs.readFileSync(configPath, 'utf8'), before, '目標檔不得被部分寫入')
    assert.equal(fs.existsSync(`${configPath}.tmp`), true, '新內容應落在暫存檔')
  })

  it('writeWorkspaceFileAtomic 會建立缺少的目錄', () => {
    const nested = path.join(base, 'deep', 'workspace.json')
    writeWorkspaceFileAtomic(nested, { version: WORKSPACE_VERSION, folders: [] })
    assert.equal(fs.existsSync(nested), true)
  })
})

describe('損毀降級', () => {
  it('內容不是有效的 JSON：以空 workspace 啟動並保留原檔', () => {
    fs.writeFileSync(configPath, '{ this is not json')

    const store = new WorkspaceStore(configPath)
    store.load()

    assert.equal(store.list().length, 0)
    assert.equal(corruptFiles().length, 1, '原檔須改名保留而非刪除')
    assert.equal(fs.existsSync(configPath), false)
  })

  it('版本無法辨識：以空 workspace 啟動並保留原檔', () => {
    fs.writeFileSync(configPath, JSON.stringify({ version: 999, folders: [] }))

    const store = new WorkspaceStore(configPath)
    store.load()

    assert.equal(store.list().length, 0)
    assert.equal(corruptFiles().length, 1)
  })

  it('folders 結構不符：以空 workspace 啟動', () => {
    fs.writeFileSync(configPath, JSON.stringify({ version: 1, folders: [{ id: 1 }] }))

    const store = new WorkspaceStore(configPath)
    store.load()

    assert.equal(store.list().length, 0)
    assert.equal(corruptFiles().length, 1)
  })

  it('設定檔不存在：以空 workspace 啟動且不留下 corrupt 檔', () => {
    const store = new WorkspaceStore(configPath)
    store.load()

    assert.equal(store.list().length, 0)
    assert.equal(corruptFiles().length, 0, '首次啟動不是損毀')
  })
})

describe('衍生狀態', () => {
  it('含 openspec 目錄的 folder 標示為 true', () => {
    makeDir('repo', 'openspec')
    const store = new WorkspaceStore(configPath)
    store.load()
    assert.equal(store.add(path.join(base, 'repo')).hasOpenSpec, true)
  })

  it('openspec 存在但不是目錄時標示為 false', () => {
    const repo = makeDir('repo')
    fs.writeFileSync(path.join(repo, 'openspec'), 'not a directory')

    const store = new WorkspaceStore(configPath)
    store.load()
    assert.equal(store.add(repo).hasOpenSpec, false)
  })

  it('標示隨磁碟內容更新而非沿用舊值', () => {
    const repo = makeDir('repo')
    const first = new WorkspaceStore(configPath)
    first.load()
    assert.equal(first.add(repo).hasOpenSpec, false)

    fs.mkdirSync(path.join(repo, 'openspec'))

    const second = new WorkspaceStore(configPath)
    second.load()
    assert.equal(second.list()[0].hasOpenSpec, true, '必須重算，不得沿用設定檔中的舊值')
  })

  it('偵測 openspec 不呼叫任何外部程式', () => {
    const repo = makeDir('repo')
    makeDir('repo', 'openspec')
    makeDir('repo', '.git') // 有 git 歷史，誘使實作改用 scanOpenSpec()

    const calls = trapChildProcess()
    const store = new WorkspaceStore(configPath)
    store.load()
    const added = store.add(repo)
    store.list()

    assert.equal(added.hasOpenSpec, true)
    assert.deepEqual(calls, [], `偵測不得 spawn 外部程式，實際呼叫：${calls.join(', ')}`)

    // 對照組：證明攔截確實生效，而不是因為攔截失效才看起來「沒有呼叫」
    childProcess.spawnSync('true')
    assert.deepEqual(calls, ['spawnSync'], '攔截未生效，上一項斷言沒有意義')
  })

  it('路徑失效的 folder 保留於清單並標示 missing', () => {
    const repo = makeDir('repo')
    const first = new WorkspaceStore(configPath)
    first.load()
    first.add(repo)

    fs.rmSync(repo, { recursive: true })

    const second = new WorkspaceStore(configPath)
    second.load()
    const folders = second.list()

    assert.equal(folders.length, 1, '不得靜默移除')
    assert.equal(folders[0].status, 'missing')
    assert.equal(folders[0].hasOpenSpec, false)
  })
})
