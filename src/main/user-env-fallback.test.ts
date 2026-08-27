import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { TerminalService, type TerminalSink } from './terminal'
import { applyUserEnvOnce, getUserEnv } from './user-env'
import type { FolderLookup, WorkspaceFolder } from './workspace-store'

/**
 * 取得**放棄**時的退路。自成一個檔案，理由同 `user-env-timing.test.ts`：需要的是一個與那裡
 * 相反的狀態（解析立刻放棄），而 `applyUserEnvOnce()` 一個行程只跑一次。
 *
 * 這裡不 spawn 任何 shell —— `SHELL` 指向一個不在可安全查詢名單上的東西，解析在送出之前就放棄。
 */

let repo: string
let origShell: string | undefined
let service: TerminalService | null = null

function lookup(folders: Partial<WorkspaceFolder>[]): FolderLookup {
  return { list: () => folders as WorkspaceFolder[] }
}

const sink = (): TerminalSink => ({ data: () => {}, exit: () => {}, conversation: () => {} })

before(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'spek-userenv-fallback-')))
  origShell = process.env.SHELL
  process.env.SHELL = '/usr/bin/fish'
})

after(() => {
  service?.dispose()
  if (origShell === undefined) delete process.env.SHELL
  else process.env.SHELL = origShell
  fs.rmSync(repo, { recursive: true, force: true })
})

describe('環境取得放棄時的退路', () => {
  it('不變更環境，且 session 仍建立得起來', async () => {
    const before = { ...process.env }

    await applyUserEnvOnce()

    assert.deepEqual(Object.keys(process.env).sort(), Object.keys(before).sort(), '不該新增變數')
    assert.equal(process.env.PATH, before.PATH, 'PATH 也不該變')
    assert.deepEqual(getUserEnv(), {}, '沒有取得任何東西時交給 pty 的是空物件')

    // **一個因為環境查不到而建不出來的 session，比一個環境不完整的 session 更糟。**
    service = new TerminalService(lookup([{ id: 'f1', path: repo, status: 'ok' }]), sink())
    const created = await service.create('f1', 'shell')

    assert.notEqual(created.sessionId, '')
  })
})
