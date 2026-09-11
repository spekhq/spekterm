/**
 * agent-intake：來源專屬的原始內容只能被保存那一個模組碰到。
 *
 * ## 為什麼型別不夠
 *
 * `parseIntake()` 的回傳型別沒有原始內容的欄位，於是「依 Slack 的 channel 判斷」在型別上
 * 表達不出來。**但型別擋不住「有人改了型別」**，也擋不住有人直接去讀保存處。
 *
 * 而這件事失效的方向特別壞：上一版的設計由「保存的原始投遞」產生交給 agent 的檔案，
 * 而呈現給使用者的只有本文 —— 投遞者只要把乾淨的描述寫在本文、把指示藏在原始內容的任一欄位，
 * **使用者看到的與 agent 讀到的就是兩份不同的文字**。整條管線的人類閘門就是靠「他看過的那份
 * 就是 agent 會讀到的那份」成立的。
 *
 * ## 這道守衛的定義域
 *
 * 產品程式碼（`src/**`，排除 `*.test.ts`）中，除了保存模組自己之外，不得引用
 * `readDelivery` —— 靜態或動態皆然。
 *
 * **走語法樹而非逐行比對**：保存模組與本檔案的**註解**都寫著這個函式名，逐行掃描會把它們
 * 誤判（與 `watcher-source.test.mjs` 同一條理由）。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcRoot = join(repoRoot, 'src')

/** 保存模組 —— 唯一允許讀回原始投遞的檔案。 */
const ENTRY = join('src', 'main', 'intake-archive.ts')

/** 被保護的讀取函式。 */
const READER = 'readDelivery'

/** 找出一份來源中對原始投遞讀取函式的引用。 */
export function findRawSourceViolations(source, fileName = 'sample.ts') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found = []

  const visit = (node) => {
    // 靜態具名匯入：`import { readDelivery } from './intake-archive'`
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings) {
      const bindings = node.importClause.namedBindings
      if (ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (element.propertyName?.text === READER || element.name.text === READER) {
            found.push(`static import of ${READER}`)
          }
        }
      }
    }

    // 動態匯入後取用：`(await import('./intake-archive')).readDelivery`
    if (ts.isPropertyAccessExpression(node) && node.name.text === READER) {
      found.push(`property access ${READER}`)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

function collectSources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return collectSources(full)
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) return []
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) return []
    if (entry.name.endsWith('.testkit.ts')) return []
    return [full]
  })
}

test('原始投遞的讀取函式只被保存模組引用', () => {
  const offenders = []
  for (const file of collectSources(srcRoot)) {
    const rel = relative(repoRoot, file)
    if (rel === ENTRY) continue
    const violations = findRawSourceViolations(readFileSync(file, 'utf8'), rel)
    if (violations.length > 0) offenders.push(`${rel}: ${violations.join(', ')}`)
  }
  assert.deepEqual(offenders, [], `原始投遞只能被 ${ENTRY} 讀取`)
})

/** 檔案 adapter —— 它只負責把內容交給 `deliver()`，不得自己驗證或解析。 */
const SOURCE = join('src', 'main', 'intake-source.ts')

/**
 * 找出 adapter 裡「自己驗一遍」的痕跡。
 *
 * **判準寫成禁止式，不是「必須呼叫 `deliver()`」** —— 後者擋不住「先自己驗一遍再呼叫」，
 * 而那正是「第二份較弱的實作」的長相：啟動掃描與監看走同一個 `deliver()`，卻在它之前
 * 各自做了不一樣的前處理。
 */
export function findScannerViolations(source, fileName = 'sample.ts') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found = []
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'parse') {
      const target = node.expression
      if (ts.isIdentifier(target) && target.text === 'JSON') found.push('JSON.parse')
    }
    if (ts.isIdentifier(node) && node.text === 'parseIntake') found.push('parseIntake')
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

test('檔案 adapter 不自己解析或驗證 —— 兩條入口只有一份實作', () => {
  const file = join(repoRoot, SOURCE)
  const violations = findScannerViolations(readFileSync(file, 'utf8'), SOURCE)
  assert.deepEqual(violations, [], `${SOURCE} 必須把內容原樣交給 deliver()`)
})

test('對照組：守衛真的抓得到違規（否則它是一盞永遠亮綠的燈）', () => {
  assert.equal(findScannerViolations('const x = JSON.parse(s)').length, 1)
  assert.equal(findScannerViolations("import { parseIntake } from './intake-schema'").length, 1)
  assert.deepEqual(findScannerViolations('// JSON.parse 不得出現在這裡'), [])

  const staticImport = `import { readDelivery } from './intake-archive'\nexport const x = readDelivery\n`
  assert.equal(findRawSourceViolations(staticImport).length, 1)

  const dynamicImport = `export async function f() {\n  const m = await import('./intake-archive')\n  return m.readDelivery('/root', 'a')\n}\n`
  assert.equal(findRawSourceViolations(dynamicImport).length, 1)

  const renamed = `import { readDelivery as peek } from './intake-archive'\nexport const x = peek\n`
  assert.equal(findRawSourceViolations(renamed).length, 1)

  // 註解裡出現函式名不算違規 —— 逐行掃描會誤判，語法樹不會。
  const inComment = `// readDelivery 只能被保存模組引用\nexport const x = 1\n`
  assert.deepEqual(findRawSourceViolations(inComment), [])
})
