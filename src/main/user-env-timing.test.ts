import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { TerminalService, type TerminalSink } from './terminal'
import { applyUserEnvOnce } from './user-env'
import type { FolderLookup, WorkspaceFolder } from './workspace-store'

/**
 * `create()` 與環境取得的**時序**對齊。
 *
 * 自成一個檔案，因為它需要一個「解析還沒完成」的狀態 —— 而 `applyUserEnvOnce()` 一個行程只跑
 * 一次。受控 `HOME` 的 rc 裡放了一個 `sleep`，讓那個窗口大到斷言有鑑別力：**沒有這個 sleep，
 * 解析比 pty spawn 還快，這條測試對「create 有沒有等」就分辨不出來。**
 */

const SLEEP_SECONDS = 0.5
const zshPath = '/bin/zsh'
const hasZsh = fs.existsSync(zshPath)
const skipReason = hasZsh ? undefined : `找不到 ${zshPath} —— 本檔的驗收需要它，未執行`

let home: string
let origHome: string | undefined
let origShell: string | undefined
let origPath: string | undefined
let service: TerminalService | null = null

function lookup(folders: Partial<WorkspaceFolder>[]): FolderLookup {
  return { list: () => folders as WorkspaceFolder[] }
}

const sink = (): TerminalSink => ({ data: () => {}, exit: () => {}, conversation: () => {} })

before(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'spek-userenv-timing-')))
  fs.writeFileSync(path.join(home, '.zshrc'), `sleep ${SLEEP_SECONDS}\nexport SPEKTERM_SLOW_RC=yes\n`)
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

describe('session 的建立與環境取得對齊時序', { skip: skipReason }, () => {
  it('取得尚未完成時建立的 session，其 pty 於取得完成後才啟動', async () => {
    let ready = false
    const applied = applyUserEnvOnce()
    void applied.then(() => {
      ready = true
    })

    // **立刻**建立 —— 這正是「開 app 後喚醒第一個休眠 session」走的那條路。
    service = new TerminalService(lookup([{ id: 'f1', path: home, status: 'ok' }]), sink())
    const created = await service.create('f1', 'shell')

    assert.notEqual(created.sessionId, '')
    assert.ok(ready, 'create 應在環境就緒之後才完成 —— 否則那個 session 拿到的是未補強的環境')
    await applied
  })
})
