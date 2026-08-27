import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isQueryableShell, mergeUserPath, parseEnvOutput } from './user-env'

/** 組一份 shell 輸出：前面是 rc 噪音，然後是標記，然後是 `env -0` 的內容。 */
function envOutput(noise: string, entries: Array<[string, string]>): Buffer {
  const body = entries.map(([k, v]) => `${k}=${v}\0`).join('')
  return Buffer.from(`${noise}\0__SPEKTERM_ENV__\0${body}`, 'utf-8')
}

/**
 * 此前用的標記規則（取最後一組 `@@` 之間的內容）。**只存在於測試中，作為對照組** ——
 * 它證明改用 NUL 不是換個寫法而已，見下方「值含 `@@` 時舊規則會截斷」。
 */
function parseWithLegacyMark(stdout: string): string | null {
  const end = stdout.lastIndexOf('@@')
  if (end <= 0) return null
  const start = stdout.lastIndexOf('@@', end - 1)
  if (start < 0) return null
  const value = stdout.slice(start + '@@'.length, end)
  return value.length > 0 ? value : null
}

describe('parseEnvOutput', () => {
  it('取出標記之後的所有變數', () => {
    const parsed = parseEnvOutput(envOutput('', [['PATH', '/usr/bin'], ['LANG', 'en_US.UTF-8']]))

    assert.deepEqual(parsed, { PATH: '/usr/bin', LANG: 'en_US.UTF-8' })
  })

  it('前後有 rc 噪音時仍取得到', () => {
    // 互動 rc 印東西到 stdout 是常態（歡迎訊息、版本管理器的提示）。
    const parsed = parseEnvOutput(envOutput('Reverting to nvm default version\n', [['A', '1']]))

    assert.deepEqual(parsed, { A: '1' })
  })

  it('噪音本身含標記時，取的是最後一組', () => {
    // 這是選「最後一組」而非「第一組」的理由：我們的 printf 恆為最後執行的東西。
    const noise = 'plugin says \0__SPEKTERM_ENV__\0 STALE=yes\0 then\n'
    const parsed = parseEnvOutput(envOutput(noise, [['FRESH', 'yes']]))

    assert.deepEqual(parsed, { FRESH: 'yes' })
  })

  it('值含換行與引號時完整取回', () => {
    const value = 'line1\nline2 with \'quote\' and "dquote"'
    const parsed = parseEnvOutput(envOutput('', [['TRICKY', value], ['AFTER', 'ok']]))

    assert.equal(parsed?.TRICKY, value)
    // **後面那一筆也要在** —— 一個沒被正確切分的值會把它吃掉。
    assert.equal(parsed?.AFTER, 'ok')
  })

  it('值含 `@@` 時舊規則會截斷，NUL 規則不會（對照組）', () => {
    // **這條是新標記有沒有鑑別力的唯一證據。** 少了它，「值含引號時完整取回」只是一條正向斷言
    // —— 換成任何可用的方案它都會綠。
    const value = 'token @@ suffix'
    const buffer = envOutput('', [['TRICKY', value]])

    assert.equal(parseEnvOutput(buffer)?.TRICKY, value)
    // 舊規則對同一份輸出取到的是 `@@` 之間那一段，而不是完整的值。
    assert.notEqual(parseWithLegacyMark(buffer.toString('utf-8')), value)
  })

  it('值本身含 `=` 時只切第一個', () => {
    const parsed = parseEnvOutput(envOutput('', [['DSN', 'postgres://u:p@h/db?a=1&b=2']]))

    assert.equal(parsed?.DSN, 'postgres://u:p@h/db?a=1&b=2')
  })

  it('沒有標記時回 null', () => {
    assert.equal(parseEnvOutput(Buffer.from('command not found: printf', 'utf-8')), null)
  })

  it('標記之後沒有任何變數時回 null（不是回空物件）', () => {
    // 「取回零個變數」與「取得失敗」在這裡是同一件事：兩者都該讓呼叫端維持原狀。
    assert.equal(parseEnvOutput(Buffer.from('\0__SPEKTERM_ENV__\0', 'utf-8')), null)
  })

  it('沒有名字的項目被忽略，不產生空鍵', () => {
    const parsed = parseEnvOutput(envOutput('', [['', 'orphan'], ['REAL', 'yes']]))

    assert.deepEqual(parsed, { REAL: 'yes' })
  })
})

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

describe('isQueryableShell', () => {
  it('接受能以 -i -l -c 安全查詢的 shell', () => {
    for (const shell of ['/bin/sh', '/bin/bash', '/usr/bin/zsh', '/bin/ksh']) {
      assert.ok(isQueryableShell(shell), shell)
    }
  })

  it('拒絕 fish', () => {
    // **理由已經換過一次，不要照著舊的推論。** 舊理由是「fish 的 `$PATH` 是 list」—— 那對「讀
    // `$PATH` 這個 shell 變數」成立，而現在的取值方式不讀任何 shell 變數（`env` 是外部程式）。
    // 現在的理由是**未實測**：`-i -l -c` 在 fish 上的語意與 `env -0` 的可用性都沒驗過，
    // 而失效是靜默的（取回一份不完整的環境，沒有錯誤）。
    assert.equal(isQueryableShell('/usr/bin/fish'), false)
  })

  it('拒絕未知的 shell', () => {
    for (const shell of ['/usr/bin/nu', '/bin/elvish', '/usr/local/bin/xonsh']) {
      assert.equal(isQueryableShell(shell), false, shell)
    }
  })
})
