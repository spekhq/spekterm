import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { TerminalService, type TerminalSink, ptyEnv } from './terminal'
import { applyUserEnvOnce, getUserEnv, startUserEnvResolution } from './user-env'
import type { FolderLookup, WorkspaceFolder } from './workspace-store'

/**
 * 真 spawn 的驗收 —— **與 `user-env.test.ts` 分成兩個檔案是為了隔離副作用**：這裡會改
 * `process.env.HOME` / `SHELL`，並讓 `applyUserEnvOnce()` 真的改掉 `process.env.PATH`。
 * `node --test` 一個檔案一個行程，於是那些改動不會外溢到別的測試。
 *
 * **本檔內的順序是承重的**（`node:test` 於單一檔案內序列執行）：先驗取值與對照組，再套用一次，
 * 最後才驗 pty —— `ptyEnv()` 讀的是套用之後的 `getUserEnv()`。
 */

// **不可用 `SPEKTERM_` 前綴** —— 那個前綴保留給 spekterm 替 session 設定的專屬變數，`ptyEnv()` 會把
// 從外層繼承來的一律剝掉（`agent-peer-name`）。以它命名的哨兵會被當成外層的殘留而消失。
const RC_SENTINEL = 'SPEK_TEST_RC_SENTINEL'
const PROFILE_SENTINEL = 'SPEKTERM_PROFILE_SENTINEL'
const TRICKY = 'SPEKTERM_TRICKY'
const TRICKY_VALUE = 'line1\nline2 with \'quote\' and "dquote" and @@ mark'

let home: string
let origHome: string | undefined
let origShell: string | undefined
let origPath: string | undefined
let service: TerminalService | null = null

/** 這台機器有沒有 zsh。**沒有時測試要看得見地 skip，不能靜默通過**（那就是假綠）。 */
const zshPath = '/bin/zsh'
const hasZsh = fs.existsSync(zshPath)
const skipReason = hasZsh ? undefined : `找不到 ${zshPath} —— 本檔的驗收需要它，未執行`

function lookup(folders: Partial<WorkspaceFolder>[]): FolderLookup {
  return { list: () => folders as WorkspaceFolder[] }
}

let chunks: string[] = []
function sink(): TerminalSink {
  return {
    data: (_id, chunk) => chunks.push(chunk),
    exit: () => {},
    conversation: () => {},
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await delay(20)
  }
  throw new Error(`等待逾時：${label}（已收到 ${JSON.stringify(chunks.join('').slice(-300))}）`)
}

/** 直接以**非互動** login shell 取一次環境 —— 本檔每一條正向斷言的對照組。 */
function resolveNonInteractive(): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    const child = spawn(zshPath, ['-l', '-c', "printf '\\0__SPEKTERM_ENV__\\0'; env -0"], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const out: Buffer[] = []
    child.stdout.on('data', (c: Buffer) => out.push(c))
    child.on('close', () => {
      const body = Buffer.concat(out)
      const mark = Buffer.from('\0__SPEKTERM_ENV__\0', 'utf-8')
      const at = body.lastIndexOf(mark)
      const env: Record<string, string> = {}
      if (at >= 0) {
        for (const entry of body.subarray(at + mark.length).toString('utf-8').split('\0')) {
          const eq = entry.indexOf('=')
          if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1)
        }
      }
      resolve(env)
    })
  })
}

before(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'spek-userenv-')))

  // **login profile 與互動 rc 各放一個哨兵** —— 兩者的差別正是本 change 的全部內容。
  fs.writeFileSync(path.join(home, '.zprofile'), `export ${PROFILE_SENTINEL}=from-zprofile\n`)

  // 假的 agent CLI 放在**只由互動 rc 加進 PATH** 的目錄裡：它同時承載「只由互動 rc 提供的
  // 可執行檔路徑可被解析」那條 scenario。
  const fakeBin = path.join(home, 'fake-bin')
  fs.mkdirSync(fakeBin)
  fs.writeFileSync(
    path.join(fakeBin, 'claude'),
    `#!/bin/sh\necho "AGENT_SEES_RC=\${${RC_SENTINEL}:-missing}"\necho "AGENT_RESOLVED=$(command -v claude)"\n`,
    { mode: 0o755 },
  )

  fs.writeFileSync(
    path.join(home, '.zshrc'),
    [
      `export ${RC_SENTINEL}=from-zshrc`,
      `export ${TRICKY}='${TRICKY_VALUE.replace(/'/g, `'"'"'`)}'`,
      `export PATH="${fakeBin}:$PATH"`,
      '',
    ].join('\n'),
  )

  origHome = process.env.HOME
  origShell = process.env.SHELL
  origPath = process.env.PATH
  process.env.HOME = home
  process.env.SHELL = zshPath
})

after(() => {
  service?.dispose()
  if (origHome === undefined) delete process.env.HOME
  else process.env.HOME = origHome
  if (origShell === undefined) delete process.env.SHELL
  else process.env.SHELL = origShell
  if (origPath === undefined) delete process.env.PATH
  else process.env.PATH = origPath
  fs.rmSync(home, { recursive: true, force: true })
})

/**
 * **一條一定會執行的前置斷言。**
 *
 * `describe(..., { skip })` 在缺少 zsh 時**完全靜默** —— 實測輸出是 `pass 0 / fail 0 /
 * skipped 0`，整批驗收消失得無影無蹤，而那與「全部通過」在 CI 的摘要上分不出來。
 * 這條讓缺席變成一條紅的，而不是一片空白。
 */
describe('前置條件', () => {
  it('本檔的驗收需要 zsh', () => {
    assert.ok(hasZsh, `找不到 ${zshPath} —— 本檔其餘的驗收全部未執行，這不是通過`)
  })
})

describe('自使用者互動 shell 取得環境', { skip: skipReason }, () => {
  let resolved: Record<string, string> | null = null

  it('取得只在互動 rc 設定的變數', async () => {
    resolved = await startUserEnvResolution()

    assert.ok(resolved, '取得應成功')
    assert.equal(resolved[RC_SENTINEL], 'from-zshrc')
    assert.equal(resolved[PROFILE_SENTINEL], 'from-zprofile')
  })

  it('對照組：非互動 login shell 取不到互動 rc 的變數', async () => {
    // **這條是整個 change 有沒有意義的唯一證據。** 少了它，一個「環境本來就有那個變數」的驗收
    // 環境會讓上一條在機制失效時依然通過。
    const nonInteractive = await resolveNonInteractive()

    assert.equal(nonInteractive[PROFILE_SENTINEL], 'from-zprofile', 'login profile 兩邊都讀得到')
    assert.equal(nonInteractive[RC_SENTINEL], undefined, '互動 rc 的變數不該出現')
  })

  it('值含換行與引號的變數完整取回', async () => {
    assert.equal(resolved?.[TRICKY], TRICKY_VALUE)
  })

  it('互動 rc 加進 PATH 的目錄出現在取回的 PATH 中', async () => {
    assert.match(resolved?.PATH ?? '', new RegExp(path.join(home, 'fake-bin').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  })
})

describe('套用：只有 PATH 進 process.env', { skip: skipReason }, () => {
  it('套用後 process.env 除 PATH 外沒有被新增任何變數', async () => {
    const before = new Set(Object.keys(process.env))

    await applyUserEnvOnce()

    const added = Object.keys(process.env).filter((k) => !before.has(k))
    // **這是本 change 最重要的一條斷言。** 使用者的 rc 若能在這裡新增變數，`XDG_CONFIG_HOME`
    // 就能改掉 userData 的落點、`ELECTRON_RENDERER_URL` 就能讓打包產物套用 dev CSP ——
    // 兩者都在 `whenReady` 內求值，與這裡是一場競賽。
    assert.deepEqual(added, [], `不該有新增的變數，卻多了 ${added.join(', ')}`)
    assert.equal(process.env[RC_SENTINEL], undefined, '互動 rc 的變數不該進主行程環境')
  })

  it('PATH 併進來了，而使用者的項目在前', () => {
    const fakeBin = path.join(home, 'fake-bin')
    const parts = (process.env.PATH ?? '').split(':')
    const fakeAt = parts.indexOf(fakeBin)
    const firstOriginal = parts.indexOf((origPath ?? '').split(':')[0] ?? '')

    assert.ok(fakeAt >= 0, 'fake-bin 應在 PATH 中')
    // **方向是承重的**：附加在後時 `openspec` 找得到，但它的 `#!/usr/bin/env node` 仍解析到
    // 系統 node 而失敗 —— 而那個非零結束與「未安裝」無法區分。
    assert.ok(firstOriginal < 0 || fakeAt < firstOriginal, '使用者的項目要排在既有項目之前')
  })

  it('PATH 以外的變數交給 pty，不留在 process.env', () => {
    assert.equal(getUserEnv()[RC_SENTINEL], 'from-zshrc')
    assert.equal(getUserEnv().PATH, undefined, 'PATH 不該重複出現在這裡（見 user-env.ts）')
  })
})

describe('pty 拿到的環境', { skip: skipReason }, () => {
  it('ptyEnv 帶上使用者環境，但 TERM 與巢狀標記由我們決定', () => {
    const env = ptyEnv({ TERM: 'dumb', CLAUDECODE: '1', PATH: '/usr/bin' }, {
      [RC_SENTINEL]: 'from-zshrc',
      TERM: 'from-user',
      CLAUDECODE: 'from-user',
    })

    assert.equal(env[RC_SENTINEL], 'from-zshrc', '使用者的變數要進來')
    assert.equal(env.TERM, 'xterm-256color', 'TERM 由我們決定')
    assert.equal(env.CLAUDECODE, undefined, '巢狀標記無論來自哪裡都要剝除')
  })

  it('agent 目標的 session 內看得到互動 rc 的變數，且假 CLI 由互動 rc 的 PATH 解析而來', async () => {
    chunks = []
    service = new TerminalService(lookup([{ id: 'f1', path: home, status: 'ok' }]), sink())
    await service.create('f1', 'claude')

    await waitFor(() => chunks.join('').includes('AGENT_SEES_RC='), 'agent 輸出')
    const out = chunks.join('')

    assert.match(out, /AGENT_SEES_RC=from-zshrc/)
    assert.match(out, new RegExp(`AGENT_RESOLVED=${path.join(home, 'fake-bin', 'claude')}`))
  })

  it('login shell 目標的 session 內同樣看得到（不得倒退）', async () => {
    chunks = []
    service?.dispose()
    service = new TerminalService(lookup([{ id: 'f1', path: home, status: 'ok' }]), sink())
    const { sessionId } = await service.create('f1', 'shell')

    // Typing before zsh's line editor is up loses keystrokes (seen on CI: `echo` arrived as
    // `cho`). zle turns on bracketed paste each time it starts reading a line — wait for that.
    await waitFor(() => chunks.join('').includes('\x1b[?2004h'), 'zsh ready')
    service.write(sessionId, `echo SHELL_SEES_RC=$${RC_SENTINEL}\r`)
    await waitFor(() => /SHELL_SEES_RC=from-zshrc/.test(chunks.join('')), 'shell 輸出')
  })
})
