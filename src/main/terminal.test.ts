import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { TerminalError, TerminalService, type TerminalSink } from './terminal'
import type { FolderLookup, WorkspaceFolder } from './workspace-store'

/**
 * `TerminalService` 不依賴 Electron —— 推送的出口由建構端注入。這正是當初那樣設計的理由：
 * 餵它一個假的 sink 就能直接驅動真 pty，不必動用 CDP。
 */
function lookup(folders: Partial<WorkspaceFolder>[]): FolderLookup {
  return { list: () => folders as WorkspaceFolder[] }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 8000, label = 'condition' }: { timeoutMs?: number; label?: string } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await delay(20)
  }
  throw new Error(`等待逾時：${label}（已收到 ${JSON.stringify(output().slice(-200))}）`)
}

let repo: string
let origShell: string | undefined
let service: TerminalService | null
let chunks: { sessionId: string; chunk: string }[]
let exits: { sessionId: string; exitCode: number }[]

function sink(): TerminalSink {
  return {
    data: (sessionId, chunk) => chunks.push({ sessionId, chunk }),
    exit: (sessionId, exitCode) => exits.push({ sessionId, exitCode }),
  }
}

function output(): string {
  return chunks.map((entry) => entry.chunk).join('')
}

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'spek-term-')))
  origShell = process.env.SHELL
  // 可預測、無 bash/zsh profile 的雜訊，且處處存在。
  process.env.SHELL = '/bin/sh'
  chunks = []
  exits = []
  service = null
})

afterEach(() => {
  service?.dispose()
  if (origShell === undefined) delete process.env.SHELL
  else process.env.SHELL = origShell
  fs.rmSync(repo, { recursive: true, force: true })
})

describe('TerminalService', () => {
  it('拒絕未註冊的 folder', () => {
    service = new TerminalService(lookup([]), sink())
    assert.throws(
      () => service?.create('nope', 'shell'),
      (error: unknown) => error instanceof TerminalError && error.code === 'UNKNOWN_FOLDER',
    )
    assert.equal(service.sessionCount, 0)
  })

  it('拒絕路徑失效的 folder', () => {
    service = new TerminalService(lookup([{ id: 'f1', path: repo, status: 'missing' }]), sink())
    assert.throws(
      () => service?.create('f1', 'shell'),
      (error: unknown) => error instanceof TerminalError && error.code === 'FOLDER_UNAVAILABLE',
    )
    assert.equal(service.sessionCount, 0)
  })

  it('雙向串流：輸入送達並被執行，cwd 為 folder 的根目錄', async () => {
    service = new TerminalService(lookup([{ id: 'f1', path: repo, status: 'ok' }]), sink())
    const id = service.create('f1', 'shell')
    assert.equal(service.sessionCount, 1)

    // tty 會回顯輸入行，因此不能只斷言「畫面上出現了我送的字」。回顯的是字面的
    // `echo OUT_$((6*7))`（不含 42）—— 只有 shell 真的執行了算術，輸出才會有 `OUT_42`。
    service.write(id, 'echo OUT_$((6*7))\r')
    await waitFor(() => output().includes('OUT_42'), { label: '執行結果 OUT_42' })

    // `$(pwd)` 在回顯裡不會展開，因此出現 `CWD=<路徑>` 就一定是真的執行了。
    service.write(id, 'echo CWD=$(pwd)\r')
    await waitFor(() => output().includes(`CWD=${repo}`), { label: `cwd = ${repo}` })

    service.write(id, 'exit\r')
    await waitFor(() => exits.some((entry) => entry.sessionId === id), { label: 'exit 事件' })
    assert.equal(service.sessionCount, 0)
  })

  it('pty 結束後自集合移除（集合恆等於「還活著的 pty」）', async () => {
    service = new TerminalService(lookup([{ id: 'f1', path: repo, status: 'ok' }]), sink())
    const id = service.create('f1', 'shell')

    service.write(id, 'exit\r')
    await waitFor(() => exits.length === 1, { label: 'exit 事件' })

    assert.equal(service.sessionCount, 0)
    // 已結束的 session：後續操作是 no-op，不得拋錯。
    assert.doesNotThrow(() => service?.write(id, 'echo hi\r'))
    assert.doesNotThrow(() => service?.resize(id, 100, 40))
    assert.doesNotThrow(() => service?.kill(id))
  })

  it('dispose 殺光所有 pty', async () => {
    service = new TerminalService(lookup([{ id: 'f1', path: repo, status: 'ok' }]), sink())
    service.create('f1', 'shell')
    service.create('f1', 'shell')
    assert.equal(service.sessionCount, 2)

    service.dispose()
    assert.equal(service.sessionCount, 0)

    // 真的被殺掉了 —— 兩個 pty 都會回報結束（不留孤兒行程）。
    await waitFor(() => exits.length === 2, { label: '兩個 pty 都結束' })
  })

  it('kill 終止指定的 session，其餘不受影響', async () => {
    service = new TerminalService(lookup([{ id: 'f1', path: repo, status: 'ok' }]), sink())
    const first = service.create('f1', 'shell')
    service.create('f1', 'shell')

    service.kill(first)
    assert.equal(service.sessionCount, 1)
    await waitFor(() => exits.some((entry) => entry.sessionId === first), { label: '被 kill 的 session 結束' })
  })

  it('啟動失敗不使 create 拋錯，而是以非零結束呈現', async () => {
    // **釘住實測結論**：node-pty 對 execvp 失敗不同步拋錯 —— 它成功回傳一個 pty，該 pty
    // 隨即以非零碼結束，`execvp(3) failed.` 由 onData 送出。若哪天有人「修」成同步拋錯，
    // 這條測試會擋下來。
    process.env.SHELL = '/nonexistent/xyzshell'
    service = new TerminalService(lookup([{ id: 'f1', path: repo, status: 'ok' }]), sink())

    let id = ''
    assert.doesNotThrow(() => {
      id = service?.create('f1', 'shell') ?? ''
    })
    assert.notEqual(id, '', 'create 仍應回傳 sessionId')

    await waitFor(() => exits.some((entry) => entry.exitCode !== 0), { label: '非零 exit' })
    assert.match(output(), /execvp/i)
  })

  it('resize 對已結束或未知的 session 是 no-op', () => {
    service = new TerminalService(lookup([{ id: 'f1', path: repo, status: 'ok' }]), sink())
    assert.doesNotThrow(() => service?.resize('unknown-session', 100, 40))

    const id = service.create('f1', 'shell')
    // 0 尺寸會讓 node-pty 拋錯，因此必須先被夾制。
    assert.doesNotThrow(() => service?.resize(id, 0, 0))
  })
})
