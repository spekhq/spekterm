/**
 * 守衛：**探針裡不得出現手寫的等待迴圈**。
 *
 * ## 為什麼要有這道守衛
 *
 * 等待落空時要出聲（載明等了多久、在等什麼），而那件事只有在**等待收斂於單一實作**時才具備
 * 「不可能漏掉」的性質。本 change 之前有 **十七份**各自手寫的 deadline 迴圈，分佈在八個檔案 ——
 * 其中三份甚至是匿名的行內迴圈，連函式名都沒有。逐一修好它們是紀律，而紀律擋不住第十八份被
 * 順手寫出來：**一個「由測試釘住的格式假設」不如一個「使不變式無法被違反的結構」**。
 *
 * ## 判準涵蓋兩種形狀，因為兩種都曾存在
 *
 * | 形狀 | 例 | 現況份數 |
 * |---|---|---|
 * | 時限在**迴圈條件** | `while (Date.now() < deadline) { … }` | 16 |
 * | 時限在**迴圈體內** | `for (;;) { … if (Date.now() >= deadline) return }` | 1 |
 *
 * **只涵蓋第一種的守衛會在對照組上如期變紅**（於是看起來有效），**卻放過這個 codebase 自己
 * 已經有的那一份** —— 那正是本專案定義的假綠。第二種形狀（`pollUntilText`）是實際存在的。
 *
 * 判準取「迴圈的條件或本體中，出現 `Date.now()` 與某個值的大小比較」—— 比「出現 `Date.now()`」
 * 精確：迴圈裡用 `Date.now()` 組一個 marker 字串不是等待。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptsDir = dirname(fileURLToPath(import.meta.url))

/** 等待原語自身 —— **以函式名豁免，不以檔案豁免**（同一個檔案裡的第二個迴圈仍要被擋）。 */
const PRIMITIVE = 'pollFor'

const LOOPS = new Set([
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.ForInStatement,
])

const RELATIONAL = new Set([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
])

const isDateNow = (node) =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === 'Date' &&
  node.expression.name.text === 'now'

/** 這棵子樹裡有沒有「`Date.now()` 與某個東西比大小」。 */
function hasDeadlineComparison(node) {
  let found = false
  const visit = (child) => {
    if (found) return
    if (
      ts.isBinaryExpression(child) &&
      RELATIONAL.has(child.operatorToken.kind) &&
      (isDateNow(child.left) || isDateNow(child.right))
    ) {
      found = true
      return
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}

/** 這個節點是不是位於名為 `pollFor` 的函式之內。 */
function insidePrimitive(node) {
  for (let cursor = node.parent; cursor; cursor = cursor.parent) {
    if (ts.isFunctionDeclaration(cursor) && cursor.name?.text === PRIMITIVE) return true
    if (
      ts.isVariableDeclaration(cursor) &&
      ts.isIdentifier(cursor.name) &&
      cursor.name.text === PRIMITIVE
    ) {
      return true
    }
  }
  return false
}

/** 掃一份原始碼，回傳違規（行號 + 摘要）。**導出供對照組餵 fixture。** */
export function findHandWrittenWaits(fileName, sourceText) {
  const src = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true)
  const violations = []
  const visit = (node) => {
    if (LOOPS.has(node.kind) && !insidePrimitive(node) && hasDeadlineComparison(node)) {
      const { line } = src.getLineAndCharacterOfPosition(node.getStart())
      violations.push(`${fileName}:${line + 1}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(src)
  return violations
}

function probeSources() {
  const files = []
  for (const dir of [scriptsDir, join(scriptsDir, 'lib')]) {
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.mjs') && !name.endsWith('.test.mjs')) files.push(join(dir, name))
    }
  }
  return files
}

test('探針中沒有手寫的等待迴圈', () => {
  const violations = probeSources().flatMap((file) =>
    findHandWrittenWaits(file, readFileSync(file, 'utf8')),
  )
  assert.deepEqual(
    violations,
    [],
    '等待一律走 pollFor —— 手寫的迴圈會靜默地回傳最後的值，而那正是「一段跑了幾百秒」的去向',
  )
})

test('對照組（形狀一）：時限寫在迴圈條件時被擋下', () => {
  const source = `
    async function waitForThing(timeoutMs) {
      const deadline = Date.now() + timeoutMs
      let last = null
      while (Date.now() < deadline) {
        last = read()
        if (last) return last
        await sleep(100)
      }
      return last
    }
  `
  assert.equal(findHandWrittenWaits('fixture.mjs', source).length, 1)
})

test('對照組（形狀二）：時限寫在迴圈體內時同樣被擋下', () => {
  const source = `
    async function pollUntilText(read, settled, timeoutMs) {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const text = await read()
        if (settled(text) || Date.now() >= deadline) return text
        await sleep(200)
      }
    }
  `
  assert.equal(
    findHandWrittenWaits('fixture.mjs', source).length,
    1,
    '少了這一條，守衛會放過這個 codebase 自己已經有的那一份',
  )
})

test('對照組：等待原語自身不被擋（以函式名豁免）', () => {
  const source = `
    export async function pollFor({ read, settled, timeoutMs }) {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const last = await read()
        if (settled(last)) return last
        if (Date.now() >= deadline) break
        await sleep(250)
      }
      return null
    }
  `
  assert.deepEqual(findHandWrittenWaits('fixture.mjs', source), [])
})

test('對照組：迴圈裡用 Date.now() 組字串不算等待', () => {
  const source = `
    for (const name of names) {
      markers.push(\`probe-\${name}-\${Date.now()}\`)
    }
  `
  assert.deepEqual(
    findHandWrittenWaits('fixture.mjs', source),
    [],
    '判準是「與某個值比大小」，不是「出現 Date.now()」—— 會誤判的守衛遲早被加上例外開關',
  )
})
