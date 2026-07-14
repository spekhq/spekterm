/**
 * ui-localization：字典的 key 具有**編譯期**的型別安全。
 *
 * 引用一個不存在的 key SHALL 使型別檢查失敗 —— SHALL NOT 延遲到執行期才以「把 key 印在
 * 畫面上」的方式暴露（i18next 找不到 key 時就是這麼做的）。
 *
 * **這條非守不可，因為它靠的是一份 ambient declaration**（`src/shared/i18n/i18next.d.ts`
 * 的 `CustomTypeOptions`）—— **沒有任何模組 import 它**。刪掉那個檔案，`npm run typecheck`
 * 照樣全綠，而 `t('rail.emty')` 從此變成一個執行期才現形的錯誤（畫面上會出現 `rail.emty`
 * 這串字）。一個「拿掉之後沒有任何東西會紅」的防護，就是一個遲早會被拿掉的防護。
 *
 * 對照組因此是雙向的：錯的 key **必須**被抓到，對的 key **必須**通過（否則一個過度嚴格的
 * 型別會讓這條測試以「反正它總是紅」的方式失去意義）。
 */
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 與字典同目錄 —— 相對 import 才解析得到，`CustomTypeOptions` 也才會生效。 */
const VIRTUAL = join(repoRoot, 'src/shared/i18n/__key-safety__.ts')

function diagnose(source) {
  const configPath = join(repoRoot, 'tsconfig.json')
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile)
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, repoRoot)

  const host = ts.createCompilerHost(options, true)
  const readFile = host.readFile.bind(host)
  const getSourceFile = host.getSourceFile.bind(host)

  host.fileExists = (name) => name === VIRTUAL || ts.sys.fileExists(name)
  host.readFile = (name) => (name === VIRTUAL ? source : readFile(name))
  host.getSourceFile = (name, ...rest) =>
    name === VIRTUAL
      ? ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true)
      : getSourceFile(name, ...rest)

  // **`i18next.d.ts` 必須顯式進入 program。** 它是 module augmentation，沒有任何模組 import
  // 它 —— 正式的 typecheck 靠 tsconfig 的 `include` 把它撈進來，這裡得自己指名。
  const program = ts.createProgram(
    [VIRTUAL, join(repoRoot, 'src/shared/i18n/i18next.d.ts')],
    options,
    host,
  )

  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName === VIRTUAL)
    .map((d) => ({
      code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
    }))
}

test('引用不存在的 key 使型別檢查失敗', () => {
  const errors = diagnose(`
    import { t } from './index'
    export const label = t('rail.emty')
  `)

  assert.notEqual(errors.length, 0, '打錯的 key 必須被型別系統抓到 —— i18next.d.ts 還在嗎？')
  assert.equal(
    errors.some((e) => e.code === 2345),
    true,
    `應為 TS2345（引數型別不符），實得：${JSON.stringify(errors)}`,
  )
})

test('對照組：正確的 key 通過型別檢查', () => {
  const errors = diagnose(`
    import { t } from './index'
    export const label = t('rail.empty')
    export const withVars = t('rail.removeFolder', { name: 'spekterm' })
    export const plural = t('rail.sessionCount', { count: 3 })
  `)

  assert.deepEqual(errors, [], '正確的 key（含插值與複數）不得被誤報')
})
