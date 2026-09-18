/**
 * ui-localization：驗收腳本 SHALL 明確指定被測 app 的 UI 語言。
 *
 * ## 失效方向決定了這道守衛的形狀
 *
 * 驗收腳本以文案定位介面元素（`lib/copy.mjs` 自**基準語言**的字典組出 `aria-label` 選擇器）。
 * 被測 app 若以另一種語言啟動，**症狀是「選不到元素」** —— 探針拿到 `null`，然後以一種
 * 看起來像產品壞掉的方式紅掉。**那不像驗收設定錯了。**
 *
 * 而首次啟動的語言取自作業系統的偏好語言，**探針的 profile 是全新的** —— 於是在一台
 * 非英文的開發機上，每一支探針都會以開發者的語言啟動。
 *
 * ## 定義域：每一支帶 `--user-data-dir=` 的探針
 *
 * 一支探針通常只有**一處** `--user-data-dir=` 字面（在它共用的 `launch()` 裡），而 profile
 * 目錄可能有好幾個。因此種入的位置是那個共用的啟動路徑，而 helper「**只在偏好檔不存在時
 * 才寫**」—— 於是刻意佈置偏好檔的段落（損毀韌性、沒有 `ui` 區塊的舊檔）不必列為例外，
 * 它們寫在前，helper 就不動。
 *
 * ## 例外逐一具名，各帶理由
 *
 * 不傳 `--user-data-dir` 的探針不在定義域內（它們用真實的 userData），但仍在下面具名 ——
 * 一個「碰巧沒事」與一個「被論證過沒事」的差別，就是下一個人會不會去動它。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const scriptsDir = join(repoRoot, 'scripts')

const SEED_CALL = /\bseedLanguage\(/

/**
 * **「傳遞」`--user-data-dir` 的形式，而不是「提到」它。**
 *
 * `probe-identity.mjs` 的斷言正是去**讀**子行程 argv 裡的 `--user-data-dir=<path>` ——
 * 一個 `includes('--user-data-dir=')` 會把它判成「以自有 profile 啟動」，而它恰恰相反。
 * 所有真正的啟動點都寫成樣板字面值 `` `--user-data-dir=${…}` ``。
 */
const PASSES_PROFILE = /`--user-data-dir=\$\{/

/**
 * 不傳 `--user-data-dir` 的探針 —— 它們用真實的 userData，而**它們的斷言都不經字典**。
 */
const NO_PROFILE = {
  'probe-identity.mjs':
    '刻意不傳 --user-data-dir（它驗的正是 app.getPath("userData") 實際解析出來的路徑）。' +
    '斷言為 productName／appId／路徑／視窗標題，都不經字典。',
  'probe-core.mjs': '主行程掃描 OpenSpec 且不開 TCP 埠 —— 不載入 renderer，不使用 copy.mjs。',
  'probe-native.mjs': '它自己就是 Electron 主行程，驗的是 node-pty 載入與 spawn —— 沒有介面。',
}

export function scan() {
  const missing = []
  const staleExceptions = []

  const probes = readdirSync(scriptsDir).filter((name) => /^probe-.*\.mjs$/.test(name))

  for (const name of probes) {
    const source = readFileSync(join(scriptsDir, name), 'utf8')
    const launches = PASSES_PROFILE.test(source)

    if (!launches) {
      if (!(name in NO_PROFILE)) {
        missing.push(`${name} 沒有 --user-data-dir 也不在具名例外中 —— 它用的是真實的 userData`)
      }
      continue
    }
    if (!SEED_CALL.test(source)) {
      missing.push(`${name} 以 --user-data-dir 啟動被測 app，卻沒有指定語言`)
    }
  }

  for (const name of Object.keys(NO_PROFILE)) {
    if (!probes.includes(name)) staleExceptions.push(`${name} 的例外指向一支不存在的探針`)
  }

  return { missing, staleExceptions }
}

test('每一支以自有 profile 啟動的探針都指定了語言', () => {
  assert.deepEqual(
    scan().missing,
    [],
    'seedLanguage(profileDir) 要在該探針的啟動路徑上呼叫一次；\n' +
      '不傳 --user-data-dir 的探針請在 NO_PROFILE 中具名並寫下理由。',
  )
})

test('沒有指向不存在探針的例外', () => {
  assert.deepEqual(scan().staleExceptions, [])
})

test('驗收的語言與 copy.mjs 讀的那份字典一致', async () => {
  // 兩者分家的話，探針會以一種語言啟動、以另一種語言的文案去選元素 —— 而那正是這道守衛
  // 要防的事本身。
  const { PROBE_LANGUAGE } = await import('./lib/probe-language.mjs')
  const { DEFAULT_LANGUAGE } = await import(join(repoRoot, 'src/shared/i18n/languages.ts'))
  assert.equal(PROBE_LANGUAGE, DEFAULT_LANGUAGE)
})

test('對照組：拿掉任一支的種入即被回報', () => {
  // 以偵測邏輯直接驗（不動磁碟）：一支有 --user-data-dir、沒有 seedLanguage 的來源。
  const source = 'spawn(\'electron\', [`--user-data-dir=${profileDir}`], {})'
  assert.equal(PASSES_PROFILE.test(source), true)
  assert.equal(SEED_CALL.test(source), false, '沒有種入必須偵測得到')

  // 反向：**讀**取子行程 argv 的那種寫法不算啟動（`probe-identity` 就是這個形狀）。
  const reading = "const match = rest.join(' ').match(/--user-data-dir=(\\S+)/)"
  assert.equal(PASSES_PROFILE.test(reading), false, '讀 argv 不該被當成以自有 profile 啟動')
})
