/**
 * watcher-error-reporting：檔案監看者一律出自單一建立入口（`src/main/watcher.ts`）。
 *
 * **這道守衛只補 eslint 擋不到的部分。** 靜態 `import … from 'chokidar'` 由
 * `eslint.config.js` 的 `no-restricted-imports` 擋下（`allowTypeImports` 放行型別匯入）。
 * 那條規則對以下三者無感，而它們每一個都能讓不變式失守：
 *
 * 1. **動態 `import('chokidar')`** —— 實測 eslint 的該規則不攔它。
 * 2. **建立入口自己 re-export chokidar 的值** —— 這是最陰險的一個：所有守衛全綠，而呼叫端
 *    `import { watch } from './watcher'` 就建得出一個沒有錯誤處理的監看者。**本 change 的
 *    全部理由就是「讓它表達不出來」，所以這個漏洞必須一起堵。**
 * 3. **`followSymlinks` 出現在建立入口之外** —— 那是檔案系統邊界的一部分（見
 *    `filesystem-access`），不是呼叫端的偏好。忘記設定它的失效是靜默的：邊界外的檔名經事件
 *    流向 renderer，畫面上看起來只是多了幾個檔案。
 *
 * **走語法樹而非逐行比對**：`openspec-service.test.ts` 與 `watch-service.test.ts` 的**註解**
 * 都提到 chokidar，本檔案與 `watcher.ts` 的註解也提到 —— 逐行掃描會把它們全部誤判。
 * 註解是 trivia，不在語法樹的節點裡，因此自動豁免。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcRoot = join(repoRoot, 'src')

/** 建立入口 —— 唯一允許碰觸底層套件與邊界選項的檔案。 */
const ENTRY = join('src', 'main', 'watcher.ts')

const PACKAGE = 'chokidar'
const BOUNDARY_OPTION = 'followSymlinks'

/**
 * 找出一份 TypeScript 來源中違反「單一建立入口」的位置。
 *
 * `isEntry` 為真時套用的是**另一組**規則：入口本身當然要匯入底層套件，但它不得把該套件的
 * **值**再導出（型別可以 —— 型別建立不出監看者）。
 */
export function findWatcherSourceViolations(source, fileName = 'sample.ts', { isEntry } = {}) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found = []

  const at = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1

  const visit = (node) => {
    // ① 動態 import —— 入口以外一律違規。
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === PACKAGE &&
      !isEntry
    ) {
      found.push({ line: at(node), kind: 'dynamic-import' })
    }

    // ② 入口把底層套件的值再導出。
    if (
      isEntry &&
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === PACKAGE &&
      !node.isTypeOnly
    ) {
      // `export * from 'chokidar'` 沒有 exportClause —— 它導出的一定包含值。
      // 具名導出則逐個看：`export { type FSWatcher }` 合法，`export { watch }` 不合法。
      const clause = node.exportClause
      const leaksValue =
        clause === undefined ||
        !ts.isNamedExports(clause) ||
        clause.elements.some((element) => !element.isTypeOnly)
      if (leaksValue) found.push({ line: at(node), kind: 'value-re-export' })
    }

    // ③ 邊界選項出現在入口之外（識別字或字串鍵皆算）。
    if (
      !isEntry &&
      (ts.isIdentifier(node) || ts.isStringLiteral(node)) &&
      node.text === BOUNDARY_OPTION
    ) {
      found.push({ line: at(node), kind: 'boundary-option' })
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

/** 測試檔不出貨，且它們正需要談論這些東西。 */
function isProductSource(path) {
  if (!/\.tsx?$/.test(path)) return false
  return !/\.test\.tsx?$/.test(path)
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
}

test('檔案監看者一律出自單一建立入口', () => {
  const offenders = []

  for (const path of walk(srcRoot)) {
    if (!isProductSource(path)) continue
    const rel = relative(repoRoot, path)
    const source = readFileSync(path, 'utf8')
    for (const hit of findWatcherSourceViolations(source, path, { isEntry: rel === ENTRY })) {
      offenders.push(`${rel}:${hit.line}: ${hit.kind}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `檔案監看者一律經由 ${ENTRY} 建立 —— 錯誤處理與 ${BOUNDARY_OPTION} 都在那裡，\n` +
      `不由呼叫端決定（靜態 import 另由 eslint 擋下）。\n\n` +
      offenders.join('\n'),
  )
})

test('對照組：三種繞道各自被抓到', () => {
  const dynamic = findWatcherSourceViolations("const { watch } = await import('chokidar')")
  assert.equal(dynamic.length, 1, '動態 import 應被抓到')
  assert.equal(dynamic[0].kind, 'dynamic-import')

  const option = findWatcherSourceViolations('const opts = { followSymlinks: false }')
  assert.equal(option.length, 1, '呼叫端的邊界選項應被抓到')
  assert.equal(option[0].kind, 'boundary-option')

  const reExportStar = findWatcherSourceViolations("export * from 'chokidar'", ENTRY, {
    isEntry: true,
  })
  assert.equal(reExportStar.length, 1, 'export * 應被抓到')

  const reExportValue = findWatcherSourceViolations("export { watch } from 'chokidar'", ENTRY, {
    isEntry: true,
  })
  assert.equal(reExportValue.length, 1, '具名的值 re-export 應被抓到')
  assert.equal(reExportValue[0].kind, 'value-re-export')
})

test('對照組：合法的用法不被誤報', () => {
  // 入口自己匯入底層套件、並且只 re-export 型別 —— 兩種寫法都合法。
  const entryOk = findWatcherSourceViolations(
    [
      "import { watch as chokidarWatch } from 'chokidar'",
      "export type { FSWatcher } from 'chokidar'",
      "export { type FSWatcher as W } from 'chokidar'",
      'const opts = { followSymlinks: false }',
    ].join('\n'),
    ENTRY,
    { isEntry: true },
  )
  assert.deepEqual(entryOk, [], `入口的合法用法被誤報：${JSON.stringify(entryOk)}`)

  // 呼叫端的型別匯入（eslint 的 allowTypeImports 放行的那一種）不歸這道守衛管。
  const callerOk = findWatcherSourceViolations(
    ["import type { FSWatcher } from 'chokidar'", "import { createWatcher } from './watcher'"].join(
      '\n',
    ),
  )
  assert.deepEqual(callerOk, [], `呼叫端的合法用法被誤報：${JSON.stringify(callerOk)}`)
})
