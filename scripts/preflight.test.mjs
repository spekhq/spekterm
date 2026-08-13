/**
 * `lib/preflight.mjs` 的驗收。
 *
 * **每一條機制都配一條對照組** —— 一個只在「條件不成立」時被呼叫的檢查，最容易寫成一個恆真的
 * 東西：它在正常路徑上永遠不出聲，於是沒有人會發現它其實什麼都沒檢查。
 *
 * 兩個注入接縫（`backoffMs`／`holderOf`）是這些測試跑得起來的前提：預設退避是數秒，而 `npm test`
 * 全部只要十幾秒。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  NO_BUILD,
  PreflightError,
  ensureBuildArtifacts,
  ensurePortsFree,
  isPortBusy,
} from './lib/preflight.mjs'

/** 造一個假的 repo 根：`withArtifacts` 為真時放進兩個產物。 */
function fakeRoot(withArtifacts) {
  const root = mkdtempSync(join(tmpdir(), 'spekterm-preflight-'))
  if (withArtifacts) {
    mkdirSync(join(root, 'out', 'main'), { recursive: true })
    mkdirSync(join(root, 'out', 'renderer'), { recursive: true })
    writeFileSync(join(root, 'out', 'main', 'index.js'), '')
    writeFileSync(join(root, 'out', 'renderer', 'index.html'), '')
  }
  return root
}

/** 佔住一個 port，回傳 `[port, 釋放函式]`。以 port 0 讓作業系統挑一個沒人用的。 */
function occupyPort() {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve([port, () => new Promise((done) => server.close(done))])
    })
  })
}

// ── 建置產物 ────────────────────────────────────────────────────────────────

test('產物不存在時失敗，訊息含建置指示', () => {
  const root = fakeRoot(false)
  assert.throws(
    () => ensureBuildArtifacts('shell', { root }),
    (error) => {
      assert.ok(error instanceof PreflightError)
      assert.match(error.message, /npm run build/)
      assert.match(error.message, /out\/main\/index\.js/)
      return true
    },
  )
})

test('對照組：產物存在時通過', () => {
  const root = fakeRoot(true)
  assert.doesNotThrow(() => ensureBuildArtifacts('shell', { root }))
})

test('不吃建置產物的探針豁免這道檢查', () => {
  const root = fakeRoot(false)
  for (const name of NO_BUILD) {
    assert.doesNotThrow(
      () => ensureBuildArtifacts(name, { root }),
      `${name} 不吃 out/，不該被產物檢查擋下`,
    )
  }
})

// ── port ───────────────────────────────────────────────────────────────────

test('port 被佔用時失敗，訊息含 port 與已等待時間', async () => {
  const [port, release] = await occupyPort()
  try {
    await assert.rejects(
      ensurePortsFree([port], { name: 'shell', backoffMs: 200, intervalMs: 50, holderOf: () => null }),
      (error) => {
        assert.ok(error instanceof PreflightError)
        assert.match(error.message, new RegExp(String(port)))
        assert.match(error.message, /已等待 \d+\.\d 秒/)
        return true
      },
    )
  } finally {
    await release()
  }
})

test('對照組：沒有人佔用時通過', async () => {
  const [port, release] = await occupyPort()
  await release() // 拿一個「剛剛確實可以 listen」的號碼，再把它讓出來
  await ensurePortsFree([port], { name: 'shell', backoffMs: 200, intervalMs: 50 })
})

test('退避窗口內被釋放就不算失敗', async () => {
  const [port, release] = await occupyPort()
  setTimeout(release, 150)
  await ensurePortsFree([port], { name: 'shell', backoffMs: 3000, intervalMs: 50 })
})

test('查不出持有者時仍然正確判定為被佔用', async () => {
  const [port, release] = await occupyPort()
  try {
    await assert.rejects(
      ensurePortsFree([port], {
        name: 'shell',
        backoffMs: 200,
        intervalMs: 50,
        holderOf: () => {
          throw new Error('ss: command not found')
        },
      }),
      /查不出來|command not found/,
    )
  } finally {
    await release()
  }
})

test('持有者查得到時，訊息帶著那一行', async () => {
  const [port, release] = await occupyPort()
  try {
    await assert.rejects(
      ensurePortsFree([port], {
        name: 'shell',
        backoffMs: 200,
        intervalMs: 50,
        holderOf: () => 'LISTEN 127.0.0.1:9223 users:(("dconf",pid=2834805,fd=75))',
      }),
      /dconf/,
    )
  } finally {
    await release()
  }
})

test('沒有 port 的探針（core / native）什麼都不檢查', async () => {
  await ensurePortsFree([], { name: 'core' })
})

test('isPortBusy 對有人 listen 的 port 回真、對沒人的回假', async () => {
  const [port, release] = await occupyPort()
  assert.equal(await isPortBusy(port), true)
  await release()
  assert.equal(await isPortBusy(port), false)
})

// ── 兩種前置失敗必須互相可區分 ──────────────────────────────────────────────

test('兩種前置失敗的訊息不相等，且各自含自己的處置', async () => {
  const root = fakeRoot(false)
  let artifactMessage = ''
  try {
    ensureBuildArtifacts('shell', { root })
  } catch (error) {
    artifactMessage = error.message
  }

  const [port, release] = await occupyPort()
  let portMessage = ''
  try {
    await ensurePortsFree([port], { name: 'shell', backoffMs: 200, intervalMs: 50, holderOf: () => null })
  } catch (error) {
    portMessage = error.message
  } finally {
    await release()
  }

  assert.notEqual(artifactMessage, portMessage)

  // **判準不是「兩句話不一樣」，是「各自帶得走自己的處置」。** 只比不相等的話，日後給兩者加上
  // 一個共同的泛用前綴、把差異縮到一個代碼，這條測試照樣綠 —— 而「兩種前置失敗長得一模一樣」
  // 正是 issue #23 的全部內容。
  assert.match(artifactMessage, /npm run build/)
  assert.doesNotMatch(artifactMessage, new RegExp(`port ${port}`))

  assert.match(portMessage, new RegExp(`port ${port}`))
  assert.doesNotMatch(portMessage, /npm run build/)
})
