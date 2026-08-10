import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isQueryableShell, mergeUserPath, parsePathOutput } from './user-path'

describe('mergeUserPath', () => {
  it('把使用者的新項目前置，而不是附加在後', () => {
    // **方向是承重的**：附加在後時 `openspec` 找得到，但它的 `#!/usr/bin/env node` 仍解析到系統
    // node 而 SyntaxError —— 而那個非零結束與「未安裝」在 core 的 provider 眼中無法區分。
    const merged = mergeUserPath('/usr/bin:/bin', '/home/u/.nvm/bin:/usr/bin')

    assert.equal(merged, '/home/u/.nvm/bin:/usr/bin:/bin')
    assert.ok(merged.indexOf('/home/u/.nvm/bin') < merged.indexOf('/usr/bin'))
  })

  it('既有項目一個都不移除（產物自身注入的路徑要留著）', () => {
    const current = '/tmp/.mount_abc:/tmp/.mount_abc/usr/sbin:/usr/bin'
    const merged = mergeUserPath(current, '/home/u/.nvm/bin')

    for (const part of current.split(':')) assert.ok(merged.split(':').includes(part), part)
  })

  it('重複項只留前面那個', () => {
    const merged = mergeUserPath('/usr/bin:/bin', '/usr/bin:/home/u/bin:/bin')

    assert.deepEqual(merged.split(':'), ['/home/u/bin', '/usr/bin', '/bin'])
  })

  it('使用者 PATH 沒有帶來新東西時，原樣回傳', () => {
    assert.equal(mergeUserPath('/usr/bin:/bin', '/bin:/usr/bin'), '/usr/bin:/bin')
  })

  it('忽略空片段，不產生空的 PATH 項目', () => {
    assert.equal(mergeUserPath('/usr/bin', '::/home/u/bin:'), '/home/u/bin:/usr/bin')
  })
})

describe('parsePathOutput', () => {
  it('取出標記之間的內容', () => {
    assert.equal(parsePathOutput('@@/usr/bin:/bin@@'), '/usr/bin:/bin')
  })

  it('前後有 rc 噪音時仍取得到', () => {
    // 互動 rc 印東西到 stdout 是常態（歡迎訊息、版本管理器的提示）。
    const out = 'Reverting to nvm default version\n@@/home/u/.nvm/bin:/usr/bin@@'
    assert.equal(parsePathOutput(out), '/home/u/.nvm/bin:/usr/bin')
  })

  it('噪音本身含標記時，取的是最後一組', () => {
    // 這是選「最後一組」而非「第一組」的理由：我們的 printf 恆為最後執行的東西。
    const out = 'plugin says @@hello@@ then\n@@/usr/bin@@'
    assert.equal(parsePathOutput(out), '/usr/bin')
  })

  it('沒有標記時回 null', () => {
    assert.equal(parsePathOutput('command not found: printf'), null)
  })

  it('只有一個標記時回 null（不是把後半當成 PATH）', () => {
    assert.equal(parsePathOutput('@@/usr/bin'), null)
  })

  it('標記之間是空的時回 null', () => {
    assert.equal(parsePathOutput('@@@@'), null)
  })
})

describe('isQueryableShell', () => {
  it('接受能以 -i -l -c 安全查詢的 shell', () => {
    for (const shell of ['/bin/sh', '/bin/bash', '/usr/bin/zsh', '/bin/ksh']) {
      assert.ok(isQueryableShell(shell), shell)
    }
  })

  it('拒絕 fish', () => {
    // **fish 的 `$PATH` 是 list**，同一個 printf 會印成 `@@/a@@@@/b@@…` —— 解析得到的是第一個
    // 目錄，沒有錯誤、只是 PATH 少掉大半。這正是白名單而非黑名單的理由：靜默的錯誤比沒修更糟。
    assert.equal(isQueryableShell('/usr/bin/fish'), false)
  })

  it('拒絕未知的 shell', () => {
    for (const shell of ['/usr/bin/nu', '/bin/elvish', '/usr/local/bin/xonsh']) {
      assert.equal(isQueryableShell(shell), false, shell)
    }
  })
})
