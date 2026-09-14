/**
 * 會製造 intake 的探針，其啟動必須帶 `--user-data-dir`。
 *
 * 主行程以「命令列指定了拋棄式 profile」決定通知走替身而不是真實的作業系統
 * （見 `index.ts` 的 `usingThrowawayProfile`）。少了那個旗標，**跑一次探針就會往開發者
 * 真實的桌面噴一排通知** —— `xvfb-run` 只換 `DISPLAY`，匯流排位址是原封繼承的，
 * 而那些通知會留在通知中心裡等人手動清。
 *
 * 判準寫成「探針的啟動參數裡有它」而不是「主行程有沒有讀到」：後者要跑起來才知道，
 * 而這道守衛要在 `npm test` 的秒級層擋下來。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 會走 `deliver()` 的探針 —— 它們一跑就會產生到達，也就會產生通知。 */
const INTAKE_PROBES = ['scripts/probe-intake.mjs', 'scripts/probe-slack.mjs']

test('會製造 intake 的探針都以拋棄式 profile 啟動', () => {
  const missing = INTAKE_PROBES.filter(
    (file) => !readFileSync(join(repoRoot, file), 'utf8').includes('--user-data-dir='),
  )
  assert.deepEqual(missing, [], '少了它，跑一次探針就會往真實的桌面發通知')
})

test('主行程確實以那個旗標決定後端（否則守衛在守一個沒有人看的東西）', () => {
  const source = readFileSync(join(repoRoot, 'src/main/index.ts'), 'utf8')
  assert.ok(source.includes('usingThrowawayProfile'), '判準必須存在')
  assert.ok(
    source.includes("startsWith('--user-data-dir=')"),
    '判準必須就是那個旗標 —— 改成「沒有打包」的話，dev 模式的 dogfood 會拿到替身而不是真通知',
  )
})
