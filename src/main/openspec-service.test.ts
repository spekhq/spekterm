import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { OpenSpecService, OpenSpecServiceError } from './openspec-service'
import type { FolderLookup, WorkspaceFolder } from './workspace-store'

let base: string
let repo: string
let outside: string
let changed: string[]
let service: OpenSpecService | null

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** chokidar 的初次掃描是非同步的；改檔案之前必須讓它完成，否則事件不會來。 */
const READY_MS = 300

function lookup(folders: Partial<WorkspaceFolder>[]): FolderLookup {
  return { list: () => folders as WorkspaceFolder[] }
}

function okFolder(): FolderLookup {
  return lookup([{ id: 'f1', path: repo, status: 'ok' }])
}

function write(relPath: string, content: string): void {
  const target = path.join(repo, relPath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

/**
 * 一個最小但完整的 OpenSpec repo：一份 spec、一個 active change（含 tasks 與 delta spec）、
 * 一個 archived change。
 */
function makeRepo(): void {
  write('openspec/config.yaml', 'schema: spec-driven\n')
  write(
    'openspec/specs/auth/spec.md',
    '# auth Specification\n\n## Purpose\n\n登入。\n\n## Requirements\n\n### Requirement: 使用者可登入\n\n系統 SHALL 允許登入。\n\n#### Scenario: 正確的密碼\n\n- **WHEN** 密碼正確\n- **THEN** 登入成功\n',
  )
  write(
    'openspec/changes/add-oauth/proposal.md',
    '# 加入 OAuth\n\n## Why\n\n因為需要。\n',
  )
  write(
    'openspec/changes/add-oauth/tasks.md',
    '## 1. 後端\n\n- [x] 1.1 建立 endpoint\n- [ ] 1.2 接上 provider\n\n## 2. 前端\n\n- [ ] 2.1 加按鈕\n',
  )
  write(
    'openspec/changes/add-oauth/specs/auth/spec.md',
    '## ADDED Requirements\n\n### Requirement: 使用者可用 OAuth 登入\n\n系統 SHALL 支援 OAuth。\n\n#### Scenario: 以 Google 登入\n\n- **WHEN** 使用者選擇 Google\n- **THEN** 導向 Google\n',
  )
  write(
    'openspec/changes/archive/2026-01-01-old-change/proposal.md',
    '# 舊的 change\n\n## Why\n\n歷史。\n',
  )
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(tmpdir(), 'spek-openspec-'))
  repo = path.join(base, 'repo')
  outside = path.join(base, 'outside')
  fs.mkdirSync(repo, { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  makeRepo()
  changed = []
  service = null
})

afterEach(async () => {
  await service?.dispose()
  fs.rmSync(base, { recursive: true, force: true })
})

function create(
  store: FolderLookup = okFolder(),
  { debounceMs = 20, scan }: { debounceMs?: number; scan?: (root: string) => Promise<never> } = {},
): OpenSpecService {
  service = scan
    ? new OpenSpecService(store, (id) => changed.push(id), debounceMs, scan)
    : new OpenSpecService(store, (id) => changed.push(id), debounceMs)
  return service
}

describe('OpenSpecService 的定址邊界', () => {
  it('未知的 folderId 被拒，且不觸及檔案系統', async () => {
    const svc = create()
    await assert.rejects(
      () => svc.getSpecs('nope'),
      (error: unknown) =>
        error instanceof OpenSpecServiceError && error.code === 'UNKNOWN_FOLDER',
    )
  })

  it('spec 的路徑以 folder-relative 呈現，不是絕對路徑', async () => {
    const specs = await create().getSpecs('f1')

    assert.equal(specs.length, 1)
    assert.equal(specs[0].topic, 'auth')
    assert.equal(specs[0].relPath, 'openspec/specs/auth/spec.md')
    assert.ok(!path.isAbsolute(specs[0].relPath ?? ''))
  })

  it('change 的 artifact 路徑以 folder-relative 呈現', async () => {
    const detail = await create().getChange('f1', 'add-oauth')

    assert.equal(detail.relPath, 'openspec/changes/add-oauth')

    const tasks = detail.artifacts.find((artifact) => artifact.id === 'tasks')
    assert.equal(tasks?.relPath, 'openspec/changes/add-oauth/tasks.md')

    const specs = detail.artifacts.find((artifact) => artifact.kind === 'specs')
    // specs 是一整棵子目錄，沒有單一檔案可跳 —— 但它底下的每個 delta spec 有。
    assert.equal(specs?.relPath, null)
    assert.equal(specs?.specs?.[0].relPath, 'openspec/changes/add-oauth/specs/auth/spec.md')
  })

  it('archived change 的路徑指向 archive 目錄', async () => {
    const detail = await create().getChange('f1', '2026-01-01-old-change')

    assert.equal(detail.status, 'archived')
    assert.equal(detail.relPath, 'openspec/changes/archive/2026-01-01-old-change')
  })

  it('送往 renderer 的 DTO 完全不含絕對路徑', async () => {
    const svc = create()
    const payload = JSON.stringify([
      await svc.getOverview('f1'),
      await svc.getSpecs('f1'),
      await svc.getSpec('f1', 'auth'),
      await svc.getChanges('f1'),
      await svc.getChange('f1', 'add-oauth'),
      await svc.getGraphData('f1'),
    ])

    // repo 的絕對路徑（以及它的父目錄）不得出現在任何一個回應裡。
    assert.ok(!payload.includes(repo), 'DTO 洩漏了 repo 的絕對路徑')
    assert.ok(!payload.includes(base), 'DTO 洩漏了暫存目錄的絕對路徑')
  })
})

describe('OpenSpecService 的 identifier 白名單', () => {
  it('traversal 形式的 slug 被拒，且不讀取 folder 之外的內容', async () => {
    // folder 之外真的有一個 change 目錄 —— 若實作是拼路徑而非查表，就會讀到它。
    const outsideChange = path.join(outside, 'openspec/changes/secret')
    fs.mkdirSync(outsideChange, { recursive: true })
    fs.writeFileSync(path.join(outsideChange, 'proposal.md'), '# 機密\n')

    const svc = create()
    for (const slug of [
      '../../outside/openspec/changes/secret',
      '../../../etc',
      path.join(outside, 'openspec/changes/secret'),
    ]) {
      await assert.rejects(
        () => svc.getChange('f1', slug),
        (error: unknown) => error instanceof OpenSpecServiceError && error.code === 'NOT_FOUND',
        `slug 應被拒：${slug}`,
      )
    }
  })

  it('掃描結果中不存在的 topic 被拒', async () => {
    const svc = create()
    await assert.rejects(
      () => svc.getSpec('f1', '../../../etc/passwd'),
      (error: unknown) => error instanceof OpenSpecServiceError && error.code === 'NOT_FOUND',
    )
    await assert.rejects(
      () => svc.getSpec('f1', 'no-such-topic'),
      (error: unknown) => error instanceof OpenSpecServiceError && error.code === 'NOT_FOUND',
    )
  })

  it('存在的 slug 讀得到內容', async () => {
    const detail = await create().getChange('f1', 'add-oauth')

    assert.equal(detail.slug, 'add-oauth')
    const tasks = detail.artifacts.find((artifact) => artifact.kind === 'tasks')
    assert.equal(tasks?.tasks?.total, 3)
    assert.equal(tasks?.tasks?.completed, 1)
    assert.deepEqual(
      tasks?.tasks?.sections.map((section) => section.title),
      ['1. 後端', '2. 前端'],
    )
  })
})

describe('OpenSpecService 的快取與失效', () => {
  it('快取命中時不重複掃描', async () => {
    let scans = 0
    const real = new OpenSpecService(okFolder(), () => {}, 20)
    // 借用真的掃描一次，取得可回放的結果。
    const first = await real.getSpecs('f1')
    await real.dispose()

    const svc = create(okFolder(), {
      scan: (async () => {
        scans += 1
        return { specs: [], activeChanges: [], archivedChanges: [], defaultSchema: null }
      }) as unknown as (root: string) => Promise<never>,
    })

    await svc.getSpecs('f1')
    await svc.getSpecs('f1')
    await svc.getChanges('f1')
    await svc.getOverview('f1')

    assert.equal(scans, 1, '四次請求只應掃描一次')
    assert.equal(first.length, 1)
  })

  it('同一個 folder 的併發請求共用一次掃描', async () => {
    let scans = 0
    const svc = create(okFolder(), {
      scan: (async () => {
        scans += 1
        await delay(30)
        return { specs: [], activeChanges: [], archivedChanges: [], defaultSchema: null }
      }) as unknown as (root: string) => Promise<never>,
    })

    await Promise.all([
      svc.getSpecs('f1'),
      svc.getChanges('f1'),
      svc.getOverview('f1'),
      svc.getSpecs('f1'),
    ])

    assert.equal(scans, 1, '四個 tab 同時開，不該掃四次')
  })

  it('openspec 目錄變更後快取失效，且通知 renderer', async () => {
    const svc = create()

    const before = await svc.getChanges('f1')
    assert.equal(before.active.length, 1)

    await delay(READY_MS)

    // agent 新增了一個 change。
    write('openspec/changes/add-sso/proposal.md', '# 加入 SSO\n\n## Why\n\n因為需要。\n')

    const deadline = Date.now() + 3000
    while (changed.length === 0 && Date.now() < deadline) await delay(20)

    assert.deepEqual(changed, ['f1'], '應收到一次該 folder 的變更通知')

    const after = await svc.getChanges('f1')
    assert.equal(after.active.length, 2, '快取應已失效並重新掃描')
  })

  it('連續變更合併為單次通知', async () => {
    const svc = create(okFolder(), { debounceMs: 120 })
    await svc.getChanges('f1')
    await delay(READY_MS)

    // agent 的一次操作會寫入數個檔案。
    write('openspec/changes/add-sso/proposal.md', '# 1\n')
    write('openspec/changes/add-sso/design.md', '# 2\n')
    write('openspec/changes/add-sso/tasks.md', '# 3\n')
    write('openspec/changes/add-sso/specs/auth/spec.md', '# 4\n')

    const deadline = Date.now() + 3000
    while (changed.length === 0 && Date.now() < deadline) await delay(20)
    await delay(300)

    assert.equal(changed.length, 1, `四次寫入應合併為一次通知，實得 ${changed.length}`)
  })

  it('釋放 folder 後不再監看', async () => {
    const svc = create()
    await svc.getSpecs('f1')
    assert.equal(svc.watchedFolderCount, 1)

    await svc.releaseFolder('f1')
    assert.equal(svc.watchedFolderCount, 0)

    await delay(READY_MS)
    write('openspec/changes/add-sso/proposal.md', '# 加入 SSO\n')
    await delay(300)

    assert.deepEqual(changed, [], '已釋放的 folder 不該再推送事件')
  })
})

describe('OpenSpecService 的空 repo', () => {
  it('不含 openspec 的 folder 回傳空結構，而非失敗', async () => {
    const empty = path.join(base, 'empty')
    fs.mkdirSync(empty, { recursive: true })

    const svc = create(lookup([{ id: 'f2', path: empty, status: 'ok' }]))

    assert.deepEqual(await svc.getSpecs('f2'), [])
    const changes = await svc.getChanges('f2')
    assert.deepEqual(changes.active, [])
    assert.deepEqual(changes.archived, [])
  })
})
