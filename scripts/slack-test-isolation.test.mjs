/**
 * 碰到 Slack 用戶端的單元測試**必須把端點導開**。
 *
 * ## 這道守衛的由來是一次實際發生的事
 *
 * `slack-service.test.ts` 的第一版沒有覆寫端點，於是它用**預設端點**（`https://slack.com/api`）
 * 跑了起來 —— 它：
 *
 * 1. 把一個假憑證送到了真實的 Slack；
 * 2. 讓一支單元測試依賴網路；
 * 3. 而 Slack **正確地**回了 `invalid_auth`，於是「網路問題不該被報成憑證失效」那條斷言
 *    以一個完全正確的實作失敗了 —— 症狀看起來像產品的 bug。
 *
 * 三件事各自都夠糟，而**它們的成因只是一個沒設好的前置**。那不是紀律問題：預設端點是對的
 * （產品就該連真的 Slack），所以「記得在測試裡覆寫它」永遠會有人忘記。
 *
 * ## 判準
 *
 * 一份 `*.test.ts` 若取用了會發出請求的東西（`SlackApi` / `SlackRuntime`），它必須同時出現
 * **導開端點的證據**：注入 `fetchImpl`（替身）或呼叫 `setApiBaseUrl`（本機位址）。
 *
 * 這是啟發式的 —— 它擋不住「呼叫了 `setApiBaseUrl` 但傳真實位址」。**但它擋得住那個實際發生過的
 * 形狀**（完全沒想到這件事），而那是這道守衛的目的。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const mainRoot = join(repoRoot, 'src', 'main')

/** 會發出請求的東西 —— 取用它就要導開端點。 */
const NETWORKED = /\b(?:new SlackApi|new SlackRuntime|SlackRuntime\()/

/** 導開端點的證據。 */
const REDIRECTED = /\bfetchImpl\b|\bsetApiBaseUrl\b/

/** 找出違規 —— 取用了會發請求的東西卻沒有導開端點的證據。 */
export function isUnisolated(source) {
  return NETWORKED.test(source) && !REDIRECTED.test(source)
}

function* testFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* testFiles(full)
    else if (entry.isFile() && /\.test\.tsx?$/.test(entry.name)) yield full
  }
}

test('碰到 Slack 用戶端的單元測試都把端點導開', () => {
  const offenders = []
  for (const path of testFiles(mainRoot)) {
    if (isUnisolated(readFileSync(path, 'utf8'))) offenders.push(relative(repoRoot, path))
  }

  assert.deepEqual(
    offenders,
    [],
    '這些測試會用**預設端點**（真實的 Slack）跑起來：把假憑證送出去、依賴網路，\n' +
      '而且真實服務的正確回應會讓斷言以一個正確的實作失敗（實際發生過）。\n' +
      '處置：注入 fetchImpl，或在 beforeEach 把 setApiBaseUrl 指向一個連不上的本機位址。\n\n' +
      offenders.join('\n'),
  )
})

test('對照組：沒有導開的用法被抓到，導開的不被誤報', () => {
  assert.equal(isUnisolated('const api = new SlackApi({ baseUrl, token })'), true)
  assert.equal(isUnisolated('const service = new SlackRuntime({ settings, secrets })'), true)

  assert.equal(
    isUnisolated('const api = new SlackApi({ baseUrl, token, fetchImpl: stub })'),
    false,
    '注入替身即算導開',
  )
  assert.equal(
    isUnisolated(
      ["settings.setApiBaseUrl('https://127.0.0.1:1/api')", 'const s = new SlackRuntime({})'].join('\n'),
    ),
    false,
    '指向本機即算導開',
  )
  assert.equal(isUnisolated('const store = new SecretStore(path)'), false, '無關的測試不被誤報')
})
