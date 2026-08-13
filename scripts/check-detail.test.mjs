/**
 * 守衛：**複合條件的斷言必須帶 detail**。
 *
 * ## 為什麼
 *
 * 一條沒有 detail 的複合斷言，失敗時等於什麼都沒說。實例（issue #19）：`Ctrl+Tab` 為無操作的
 * 那兩條之中，一條印出 `shell 1 → shell 1`（於是可推得紅的是另一個子條件），另一條**完全沒有
 * detail** —— 三個條件哪個不成立，至今無從得知。
 *
 * ## 判準
 *
 * `check()` 的**條件引數**（第三個）中出現 `&&` 或 `||` 就必須有第四個引數。**下鑽巢狀函式與
 * 立即執行函式** —— 條件寫成 IIFE 時，失敗一樣看不出是哪個子條件，要求 detail 的理由一字不差
 * 地成立（現況有一處正是這種寫法）。
 *
 * **不提供逐處豁免的開關。** 判準取「條件中出現 `&&` 或 `||`」這種語法上明確、寫得出對照組的
 * 形式：它會漏掉一些等價寫法（`Boolean(a) === Boolean(b)`），但不會誤判 —— 一個會誤判的守衛
 * 遲早會被加上例外開關，而例外開關會被用在不該用的地方。
 *
 * ## 為什麼連「自訂的斷言函式」也要擋
 *
 * **這是本守衛能不能成立的前提，不是順手的整理。** 曾有兩支探針各自定義三引數的
 * `check(name, passed, detail)`（少了結果陣列），於是「第三引數是條件」在它們身上指到的是
 * detail —— 守衛會**同時誤判與漏判**：把一個 detail 裡含 `||` 的合格斷言報成違規，卻放過兩條
 * 真正的違規。**一個判準會因為呼叫端的簽名而指錯位置，那不是誤差，是這道守衛沒有定義域。**
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptsDir = dirname(fileURLToPath(import.meta.url))

/** 斷言函式的**唯一**定義所在 —— 豁免的是那一份定義，不是某個檔案裡的任意程式碼。 */
const CANONICAL = 'instrument.mjs'

const CONDITION_ARG = 2
const DETAIL_ARG = 3

function hasLogicalOperator(node) {
  let found = false
  const visit = (child) => {
    if (found) return
    if (
      ts.isBinaryExpression(child) &&
      (child.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        child.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      found = true
      return
    }
    // **刻意繼續下鑽巢狀函式**：條件寫成 IIFE 時，失敗一樣看不出是哪個子條件。
    ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}

/** 掃一份原始碼，回傳違規。**導出供對照組餵 fixture。** */
export function findUnexplainedChecks(fileName, sourceText) {
  const src = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true)
  const violations = []
  const at = (node) => `${fileName}:${src.getLineAndCharacterOfPosition(node.getStart()).line + 1}`

  const visit = (node) => {
    // 自訂的斷言函式 —— 它會讓「第三引數是條件」這個前提失效。
    const declaresCheck =
      (ts.isFunctionDeclaration(node) && node.name?.text === 'check') ||
      (ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'check' &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)))
    if (declaresCheck && basename(fileName) !== CANONICAL) {
      violations.push(`${at(node)}（自訂的 check —— 斷言函式只能有一份定義）`)
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'check') {
      const condition = node.arguments[CONDITION_ARG]
      const hasDetail = node.arguments.length > DETAIL_ARG
      if (condition && hasLogicalOperator(condition) && !hasDetail) {
        violations.push(at(node))
      }
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

test('每一條複合條件的斷言都帶 detail', () => {
  const violations = probeSources().flatMap((file) =>
    findUnexplainedChecks(file, readFileSync(file, 'utf8')),
  )
  assert.deepEqual(
    violations,
    [],
    '複合條件失敗時若不指出是哪個子條件，那條紅燈等於什麼都沒說',
  )
})

test('對照組：複合條件缺 detail 時被擋下', () => {
  const source = `check(results, '兩件事都成立', a.length === 1 && b.length === 1)`
  assert.equal(findUnexplainedChecks('fixture.mjs', source).length, 1)
})

test('對照組：補上 detail 之後放行', () => {
  const source = `check(results, '兩件事都成立', a.length === 1 && b.length === 1, \`a=\${a.length} b=\${b.length}\`)`
  assert.deepEqual(findUnexplainedChecks('fixture.mjs', source), [])
})

test('對照組：邏輯運算寫在 IIFE 之內時同樣被擋下', () => {
  const source = `check(results, '版面正確', (() => rail.width > 0 && main.width > 0)())`
  assert.equal(
    findUnexplainedChecks('fixture.mjs', source).length,
    1,
    '條件包成 IIFE 一樣看不出是哪個子條件 —— 要求 detail 的理由一字不差地成立',
  )
})

test('對照組：自訂的斷言函式被擋下', () => {
  const source = `
    function check(name, passed, detail) {
      console.log(name, passed, detail)
    }
    check('第三引數在這裡是 detail', ok, message)
  `
  assert.equal(
    findUnexplainedChecks('fixture.mjs', source).length,
    1,
    '簽名不同的第二份定義會讓「第三引數是條件」失效，守衛就沒有定義域了',
  )
})

test('對照組：單一條件不需要 detail', () => {
  const source = `check(results, '只有一件事', tabs.length === 1)`
  assert.deepEqual(
    findUnexplainedChecks('fixture.mjs', source),
    [],
    '規則只約束複合條件 —— 擴大到所有斷言會製造一堆無意義的 detail',
  )
})
