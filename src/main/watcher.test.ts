import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import type { FSWatcher } from 'chokidar'
import { createWatcher } from './watcher'

let base: string
let watcher: FSWatcher | null

beforeEach(() => {
  base = fs.mkdtempSync(path.join(tmpdir(), 'spekterm-watcher-'))
  watcher = null
})

afterEach(async () => {
  // 不關掉的話 `node --test` 會一直等著這個 handle；spy 不還原則後續測試會失去 console.error。
  if (watcher) await watcher.close()
  mock.restoreAll()
  fs.rmSync(base, { recursive: true, force: true })
})

/**
 * 這些測試針對的是**錯誤路徑**，而錯誤路徑無法可靠地自然觸發（chokidar 的 `_handleError` 會過濾
 * 掉 `ENOENT` 與 `ENOTDIR`，剩下 `EPERM` / `EACCES` / `ENOSPC` 都需要特殊的檔案系統狀態）。
 * 因此以 `emit('error', …)` 直接送出事件 —— 驗的是**我們掛上去的 handler 收不收得到、會不會
 * 讓行程掛掉**，那正是本能力的規格內容。
 */
describe('createWatcher 的錯誤處理', () => {
  it('監看者發出錯誤時不造成未捕捉例外', () => {
    watcher = createWatcher({ target: base, pollingRoot: base, label: base })

    // 沒有 'error' listener 時，Node 的 EventEmitter 會在此 throw ——
    // 而主行程一死，它底下所有 pty 跟著死（`src/` 下沒有任何 uncaughtException handler）。
    assert.doesNotThrow(() => {
      watcher?.emit('error', new Error('ENOSPC: System limit for number of file watchers reached'))
    })
  })

  it('回報指出是哪一個監看者出錯', () => {
    const spy = mock.method(console, 'error', () => {})
    const label = path.join(base, 'some', 'identifying', 'path')
    watcher = createWatcher({ target: base, pollingRoot: base, label })

    watcher.emit('error', new Error('EACCES: permission denied'))

    assert.equal(spy.mock.callCount(), 1)
    const message = String(spy.mock.calls[0].arguments[0])
    // 少了 label，一則錯誤在數千個監看者之間無從定位。
    assert.ok(message.includes(label), `訊息未指出是哪一個監看者：${message}`)
    assert.ok(message.includes('EACCES: permission denied'), `訊息未含錯誤本身：${message}`)
  })

  it("掛上 'all' 不構成錯誤處理（chokidar 的 emitWithAll 對 error 跳過 all）", () => {
    // 這是 branch-service 曾經的處境：它兩層 watcher 都掛了 on('all')，看起來像是有在聽，
    // 但 error 事件根本不走 all —— 於是它一直是三個站點裡唯一會讓主行程掛掉的那個。
    watcher = createWatcher({ target: base, pollingRoot: base, label: base })
    let seenByAll = false
    watcher.on('all', () => {
      seenByAll = true
    })

    watcher.emit('error', new Error('boom'))

    assert.equal(seenByAll, false)
  })
})
