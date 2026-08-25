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

describe('重排', () => {
  function seeded(): { store: WorkspaceStore; ids: Record<string, string> } {
    const store = new WorkspaceStore(configPath)
    store.load()
    const ids: Record<string, string> = {}
    for (const name of ['alpha', 'beta', 'gamma']) {
      ids[name] = store.add(makeDir(name)).id
    }
    return { store, ids }
  }

  const names = (store: WorkspaceStore): string[] => store.list().map((folder) => folder.name)

  it('改變順序，且不改動任何 folder 的內容', () => {
    const { store, ids } = seeded()
    const before = store.list().find((folder) => folder.id === ids.gamma)

    store.reorder(ids.gamma, 0, false)

    assert.deepEqual(names(store), ['gamma', 'alpha', 'beta'])
    assert.deepEqual(store.list().find((folder) => folder.id === ids.gamma), before)
  })

  it('未知的識別碼為無操作', () => {
    const { store } = seeded()
    store.reorder('no-such-id', 0, false)
    assert.deepEqual(names(store), ['alpha', 'beta', 'gamma'])
  })

  it('越界的目標位置被夾制於清單範圍', () => {
    const { store, ids } = seeded()

    store.reorder(ids.beta, 99, false)
    assert.deepEqual(names(store), ['alpha', 'gamma', 'beta'], '超出長度：移至最後')

    store.reorder(ids.beta, -5, false)
    assert.deepEqual(names(store), ['beta', 'alpha', 'gamma'], '負數：移至最前')
  })

  it('非整數與 NaN 的目標位置不使清單損毀', () => {
    const { store, ids } = seeded()

    store.reorder(ids.gamma, Number.NaN, false)
    assert.deepEqual(names(store), ['alpha', 'beta', 'gamma'], 'NaN：無操作')

    // 位置是序位，不是量 —— 小數截斷即可，重點是**不得**算出 undefined 的插入點而弄丟 folder。
    store.reorder(ids.gamma, 0.7, false)
    assert.deepEqual(names(store), ['gamma', 'alpha', 'beta'])
    assert.equal(store.list().length, 3, '不得因為越界索引而弄丟任何 folder')
  })

  it('重排後的順序立即落盤', () => {
    const { store, ids } = seeded()
    store.reorder(ids.gamma, 0, false)

    const reopened = new WorkspaceStore(configPath)
    reopened.load()

    assert.deepEqual(names(reopened), ['gamma', 'alpha', 'beta'], '重啟後仍是使用者排定的順序')
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

  it('folder 的 git 分支是衍生狀態', () => {
    const repo = makeDir('repo')
    fs.mkdirSync(path.join(repo, '.git'))
    fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/master\n')
    const plain = makeDir('plain')

    const store = new WorkspaceStore(configPath)
    store.load()
    store.add(repo)
    store.add(plain)

    const [a, b] = store.list()
    assert.equal(a.branch, 'master')
    assert.equal(b.branch, null, '非 git repo 沒有分支 —— 那是合法狀態，不是錯誤')

    // 衍生：磁碟上切了 branch，下一次 list() 就要反映它，不得沿用舊值
    fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/feat/x\n')
    assert.equal(store.list()[0].branch, 'feat/x')

    // 持久化一個「使用者隨時會在 terminal 裡改掉」的值，等於持久化謊言
    const persisted = readConfig().folders as Record<string, unknown>[]
    for (const folder of persisted) {
      assert.equal('branch' in folder, false)
    }
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

describe('置頂', () => {
  function seeded(count = 4): { store: WorkspaceStore; ids: Record<string, string> } {
    const store = new WorkspaceStore(configPath)
    store.load()
    const ids: Record<string, string> = {}
    for (const name of ['alpha', 'beta', 'gamma', 'delta'].slice(0, count)) {
      ids[name] = store.add(makeDir(name)).id
    }
    return { store, ids }
  }

  const names = (store: WorkspaceStore): string[] => store.list().map((folder) => folder.name)
  const pins = (store: WorkspaceStore): boolean[] => store.list().map((folder) => folder.pinned)

  /** 不變式：置頂者恆佔前綴 —— 一旦看到「未置頂之後又出現置頂」即為違反。 */
  function assertPrefixInvariant(store: WorkspaceStore, hint = ''): void {
    const flags = pins(store)
    const firstUnpinned = flags.indexOf(false)
    if (firstUnpinned === -1) return
    assert.equal(
      flags.slice(firstUnpinned).some(Boolean),
      false,
      `置頂者必須佔前綴${hint ? ` (${hint})` : ''}: ${JSON.stringify(flags)}`,
    )
  }

  it('置頂落在置頂段末端，取消置頂落在其餘段首端', () => {
    const { store, ids } = seeded()

    store.setPinned(ids.gamma, true)
    assert.deepEqual(names(store), ['gamma', 'alpha', 'beta', 'delta'])

    store.setPinned(ids.delta, true)
    assert.deepEqual(names(store), ['gamma', 'delta', 'alpha', 'beta'], '第二個置頂落在末端')
    assert.deepEqual(pins(store), [true, true, false, false])

    store.setPinned(ids.gamma, false)
    assert.deepEqual(names(store), ['delta', 'gamma', 'alpha', 'beta'], '取消置頂落在其餘段首端')
    assert.deepEqual(pins(store), [true, false, false, false])
    assertPrefixInvariant(store)
  })

  it('置頂狀態立即落盤並於重啟後還原', () => {
    const { store, ids } = seeded()
    store.setPinned(ids.beta, true)

    const reopened = new WorkspaceStore(configPath)
    reopened.load()

    assert.deepEqual(names(reopened), ['beta', 'alpha', 'gamma', 'delta'])
    assert.deepEqual(pins(reopened), [true, false, false, false])
  })

  /**
   * **這一條釘住的是三道閘門裡的兩道。**
   *
   * 跨越分界的移動其序位**前後同值**（置頂段的最後一個變成其餘段的第一個）。以「位置相同即
   * 返回」為早退條件時，旗標不會寫入、`save()` 也不會發生 —— 而清單長度、順序、甚至
   * `list()` 的其他欄位全都正確，症狀只有「它沒有被取消置頂」。
   */
  it('只改變置頂狀態、序位不變的重排仍會套用並落盤', () => {
    const { store, ids } = seeded()
    store.setPinned(ids.alpha, true)
    assert.deepEqual(pins(store), [true, false, false, false])

    // alpha 位於序位 0，取消置頂之後它仍在序位 0 —— to === from。
    store.reorder(ids.alpha, 0, false)

    assert.deepEqual(pins(store), [false, false, false, false], '置頂狀態必須改變')
    const reopened = new WorkspaceStore(configPath)
    reopened.load()
    assert.deepEqual(pins(reopened), [false, false, false, false], '而且必須落盤')
  })

  it('重排跨越分界時一併改變置頂狀態', () => {
    const { store, ids } = seeded()
    store.setPinned(ids.alpha, true)
    store.setPinned(ids.beta, true)

    store.reorder(ids.gamma, 0, true)
    assert.deepEqual(names(store), ['gamma', 'alpha', 'beta', 'delta'])
    assert.deepEqual(pins(store), [true, true, true, false])
    assertPrefixInvariant(store)
  })

  it('目標序位與置頂狀態牴觸時，夾制進該狀態允許的範圍', () => {
    const { store, ids } = seeded()
    store.setPinned(ids.alpha, true)

    // 要求「未置頂、但放到序位 0」—— 序位 0 是置頂段的地盤，必須被夾到其餘段的首端。
    store.reorder(ids.delta, 0, false)

    assert.deepEqual(names(store), ['alpha', 'delta', 'beta', 'gamma'])
    assertPrefixInvariant(store, '未置頂者被要求插進前綴')
  })

  it('移除一個置頂的 folder 之後不變式仍成立', () => {
    const { store, ids } = seeded()
    store.setPinned(ids.gamma, true)
    store.setPinned(ids.delta, true)

    store.remove(ids.gamma)

    assert.deepEqual(names(store), ['delta', 'alpha', 'beta'])
    assert.deepEqual(pins(store), [true, false, false])
    assertPrefixInvariant(store)
  })

  it('新加入的 folder 為未置頂且落在最後', () => {
    const { store, ids } = seeded(2)
    store.setPinned(ids.alpha, true)
    store.setPinned(ids.beta, true)

    const added = store.add(makeDir('epsilon'))

    assert.equal(added.pinned, false)
    assert.deepEqual(names(store), ['alpha', 'beta', 'epsilon'])
    assertPrefixInvariant(store, '全部都置頂時再加一個')
  })

  it('未置頂的 folder 不在設定檔裡留下 pinned 欄位', () => {
    const { store, ids } = seeded(2)
    store.setPinned(ids.alpha, true)

    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      folders: Record<string, unknown>[]
    }
    assert.equal(raw.folders[0].pinned, true)
    assert.equal('pinned' in raw.folders[1], false, '缺席即未置頂，不寫 false')
  })
})

describe('置頂狀態的載入', () => {
  const persisted = (folders: Record<string, unknown>[]): void => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(
      configPath,
      JSON.stringify({ version: WORKSPACE_VERSION, folders }, null, 2),
      'utf8',
    )
  }

  it('沒有 pinned 欄位的既有設定檔全數載入，且不被判為損毀', () => {
    const a = makeDir('a')
    const b = makeDir('b')
    persisted([
      { id: 'id-a', path: a, addedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'id-b', path: b, addedAt: '2026-01-02T00:00:00.000Z' },
    ])

    const store = new WorkspaceStore(configPath)
    store.load()

    // **鑑別力在這兩條**：數量與「沒有被隔離」。「皆為未置頂」是預設值，任何實作都會通過。
    assert.equal(store.list().length, 2, '一個 folder 都不能少')
    assert.equal(
      fs.readdirSync(path.dirname(configPath)).some((name) => name.includes('.corrupt-')),
      false,
      '不得因為缺少新欄位而隔離設定檔',
    )
  })

  it('置頂散落在中間的設定檔被穩定分割正規化，而非判為損毀', () => {
    const dirs = ['p1', 'u1', 'p2', 'u2'].map((name) => makeDir(name))
    persisted([
      { id: 'p1', path: dirs[0], addedAt: '2026-01-01T00:00:00.000Z', pinned: true },
      { id: 'u1', path: dirs[1], addedAt: '2026-01-02T00:00:00.000Z' },
      { id: 'p2', path: dirs[2], addedAt: '2026-01-03T00:00:00.000Z', pinned: true },
      { id: 'u2', path: dirs[3], addedAt: '2026-01-04T00:00:00.000Z' },
    ])

    const store = new WorkspaceStore(configPath)
    store.load()

    assert.deepEqual(
      store.list().map((folder) => folder.id),
      ['p1', 'p2', 'u1', 'u2'],
      '置頂者提前，兩組各自的相對順序不變',
    )
    assert.equal(store.list().length, 4, '正規化不得弄丟 folder')
  })

  it('pinned 型別不符時比照其他欄位視為不可信任', () => {
    persisted([
      { id: 'id-a', path: makeDir('a'), addedAt: '2026-01-01T00:00:00.000Z', pinned: 'yes' },
    ])

    const store = new WorkspaceStore(configPath)
    store.load()

    assert.deepEqual(store.list(), [], '以空 workspace 啟動')
    assert.equal(
      fs.readdirSync(path.dirname(configPath)).some((name) => name.includes('.corrupt-')),
      true,
      '原始內容被保留下來',
    )
  })
})
