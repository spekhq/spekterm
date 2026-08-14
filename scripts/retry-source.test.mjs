/**
 * 守衛：**探針裡不得出現手寫的固定次數重試**。
 *
 * ## 為什麼既有的等待守衛擋不到它
 *
 * `wait-source.test.mjs` 的判準是「迴圈的條件或本體中有 `Date.now()` 的大小比較」。而固定次數
 * 的重試迴圈**裡面根本沒有時限判斷** —— 它結構性地不在那道守衛的定義域內。收斂之前，
 * 「開一個選單並點其中一項」這件事有八個各自為政的實作，重試 0 到 5 輪、一輪的內層預算 1.7 到
 * 17 秒，而**沒有任何一處把「總共願意等多久」寫下來過**（第一版的提案就把其中一個站點算少了
 * 八倍：它只看到迴圈裡寫著 `2000`，沒看到迴圈體內每輪還有一個預設 15 秒的座標穩定等待）。
 *
 * ## 判準：**純計數的界 ＋ 迴圈體內提早退出**
 *
 * 探針裡的計數迴圈有四類，而**只有第一類的次數是錯的尺度**：
 *
 * | 類 | 形狀 | 例 | 判定 |
 * |---|---|---|---|
 * | **重試** | 動作沒生效就重做同一件事 | `for (let i = 0; i < 3; i++) { … if (ok) return }` | **違規** |
 * | 遞增 | 每輪都有淨效果，累積到條件成立 | `for (let i = 0; i < 4 && !tabs.overflows; i++)` | 放過 |
 * | 重複 | 固定做 N 次，無退出條件 | `for (let i = 0; i < 3; i++) await createSession()` | 放過 |
 * | 以次數為界的等待 | 無副作用、每輪無淨效果 | `for (let i = 0; i < 60 && !done; i++)` | 放過（見下） |
 *
 * 守衛若把後三類一併擋掉，等於要求把三個本來正確的東西改寫成錯的形狀 —— 遞增迴圈每輪推進
 * 一格，次數就是「最多需要幾格」；重複迴圈的 N 就是要做幾次。
 *
 * **判準的區分力來自兩個條件的合取**：遞增與「以次數為界的等待」把退出條件寫在**迴圈條件**裡
 *（於是界不是純計數），重複迴圈**沒有提早退出**。
 *
 * ## 已知的缺口（兩道守衛都抓不到）
 *
 * 「以次數為界的等待」（`for (let i = 0; i < 60 && !done; i++)` ＋ `sleep(250)`）是一個藏在
 * 乘法裡的 15 秒預算 —— **正是本守衛的 Why 逐字描述的病**，但它的界不是純計數，而它也沒有
 * `Date.now()` 比較。現況那一處已改用 `pollFor`，但**守衛擋不住下一個**。要涵蓋它得先定義
 * 「什麼算等待」，而那個判準寫得出來就會誤判 —— 記在 `docs/lessons/probes.md`，不在這裡硬幹。
 *
 * ## 已知的誤判面
 *
 * 把退出條件寫成體內 `break` 的遞增迴圈會被誤判。該形狀今天不存在，而 codebase 現有的兩處
 * 遞增迴圈都把條件寫在迴圈條件裡。**接受** —— 判準寧可漏也不要誤判（既有守衛的同一條裁決：
 * 一個會誤判的守衛遲早會被加上例外開關，而例外開關會被用在不該用的地方）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptsDir = dirname(fileURLToPath(import.meta.url))

const RELATIONAL = new Set([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
])

/**
 * 這個 `for` 的界是不是**純計數** —— 條件恰好是一個 `<識別字> <關係運算子> <運算式>`，
 * 沒有以 `&&` 接上任何狀態判斷。
 */
function hasPlainCountBound(node) {
  const condition = node.condition
  if (!condition || !ts.isBinaryExpression(condition)) return false
  if (!RELATIONAL.has(condition.operatorToken.kind)) return false
  return ts.isIdentifier(condition.left) || ts.isIdentifier(condition.right)
}

/**
 * 這個迴圈的**本體**裡有沒有提早退出。
 *
 * **不下鑽進巢狀的函式**：迴圈體內一個 callback 裡的 `return` 是那個 callback 的返回，
 * 與這個迴圈無關（`.map((x) => { return x })`）。同理不下鑽進巢狀迴圈的 `break`。
 */
function hasEarlyExit(node) {
  let found = false
  const visit = (child) => {
    if (found) return
    if (ts.isFunctionDeclaration(child) || ts.isFunctionExpression(child) || ts.isArrowFunction(child)) return
    if (ts.isReturnStatement(child) || ts.isBreakStatement(child)) {
      found = true
      return
    }
    if (
      ts.isForStatement(child) ||
      ts.isForOfStatement(child) ||
      ts.isForInStatement(child) ||
      ts.isWhileStatement(child) ||
      ts.isDoStatement(child) ||
      ts.isSwitchStatement(child)
    ) {
      // 巢狀迴圈／switch 裡的 `break` 是它自己的；但其中的 `return` 仍會離開外層迴圈。
      const inner = (grand) => {
        if (found) return
        if (ts.isFunctionDeclaration(grand) || ts.isFunctionExpression(grand) || ts.isArrowFunction(grand)) return
        if (ts.isReturnStatement(grand)) {
          found = true
          return
        }
        ts.forEachChild(grand, inner)
      }
      ts.forEachChild(child, inner)
      return
    }
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node.statement, visit)
  return found
}

/** 掃一份原始碼，回傳違規（檔名:行）。**導出供對照組餵 fixture。** */
export function findHandWrittenRetries(fileName, sourceText) {
  const src = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true)
  const violations = []
  const visit = (node) => {
    if (ts.isForStatement(node) && hasPlainCountBound(node) && hasEarlyExit(node)) {
      const { line } = src.getLineAndCharacterOfPosition(node.getStart())
      violations.push(`${fileName}:${line + 1}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(src)
  return violations
}

/**
 * 掃一份原始碼，回傳「傳了次數參數給 `retryAction`」的違規。
 *
 * 上界一律以時限表達 —— 原語的介面裡本來就沒有次數參數，但 JavaScript 不會因為多傳一個
 * 屬性而報錯，所以這件事需要一道守衛而不是型別。
 */
const COUNT_LIKE = new Set(['attempts', 'retries', 'times', 'count', 'maxAttempts', 'tries'])

export function findRetryCountArguments(fileName, sourceText) {
  const src = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true)
  const violations = []
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'retryAction'
    ) {
      for (const argument of node.arguments) {
        if (!ts.isObjectLiteralExpression(argument)) continue
        for (const property of argument.properties) {
          const name = property.name && ts.isIdentifier(property.name) ? property.name.text : null
          if (name && COUNT_LIKE.has(name)) {
            const { line } = src.getLineAndCharacterOfPosition(property.getStart())
            violations.push(`${fileName}:${line + 1}（${name}）`)
          }
        }
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

test('探針中沒有手寫的固定次數重試', () => {
  const violations = probeSources().flatMap((file) =>
    findHandWrittenRetries(file, readFileSync(file, 'utf8')),
  )
  assert.deepEqual(
    violations,
    [],
    '重試一律走 retryAction —— 固定次數的上界是一個藏在乘法裡、沒有人寫下來過的數字',
  )
})

test('沒有任何呼叫端把次數傳給 retryAction', () => {
  const violations = probeSources().flatMap((file) =>
    findRetryCountArguments(file, readFileSync(file, 'utf8')),
  )
  assert.deepEqual(violations, [], '上界一律以時限表達')
})

// ── 對照組 ──────────────────────────────────────────────────────────────────

test('對照組（該紅）：純計數的界 ＋ 體內 return，就是一個手寫重試', () => {
  const fixture = `
    async function createSession(client, target) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        await realClick(client, await stableRect(client, NEW_SESSION_RECT))
        const item = await pollUntil(client, MENU_ITEM_RECT(target), (v) => v !== null, 2000)
        if (item) {
          await realClick(client, item)
          return
        }
      }
      throw new Error('選單中找不到')
    }
  `
  assert.deepEqual(findHandWrittenRetries('fixture.mjs', fixture), ['fixture.mjs:3'])
})

test('對照組（該紅）：以 break 提早退出同樣算', () => {
  const fixture = `
    for (let i = 0; i < 5; i++) {
      openMenu()
      if (menuIsOpen()) break
    }
  `
  assert.equal(findHandWrittenRetries('fixture.mjs', fixture).length, 1)
})

test('對照組（該綠）：遞增迴圈不被誤判 —— 退出條件寫在迴圈條件裡', () => {
  // `probe-keyboard.mjs` 的兩處：補 session 到分頁列溢出、`Ctrl+Tab` 走到第一個分頁。
  const fixture = `
    for (let i = 0; i < 4 && tabs !== null && !tabs.overflows; i += 1) {
      await pressKey(app.client, 't', ['ctrl'])
      tabs = await app.client.evaluate(TAB_SCROLLER)
    }
    for (let i = 0; i < tabs.count && tabs.index !== 0; i += 1) {
      await pressKey(app.client, 'Tab', ['ctrl'])
      tabs = await app.client.evaluate(TAB_SCROLLER)
    }
  `
  assert.deepEqual(findHandWrittenRetries('fixture.mjs', fixture), [])
})

test('對照組（該綠）：重複迴圈不被誤判 —— 沒有提早退出', () => {
  const fixture = `
    for (let i = 0; i < 3; i++) {
      await createSession(app.client)
      await pollUntil(app.client, TABS, (value) => value.length === i + 1, 10_000)
    }
    for (let i = 0; i < 20; i += 1) await ctrlTab()
    for (let i = 0; i < 5; i++) await pressKey(app.client, 'ArrowRight')
  `
  assert.deepEqual(findHandWrittenRetries('fixture.mjs', fixture), [])
})

test('對照組（該綠）：以次數為界的等待不被誤判 —— 界不是純計數', () => {
  const fixture = `
    let stubRan = false
    for (let i = 0; i < 60 && !stubRan; i++) {
      stubRan = existsSync(receipt)
      if (!stubRan) await sleep(250)
    }
  `
  assert.deepEqual(findHandWrittenRetries('fixture.mjs', fixture), [])
})

test('對照組（該綠）：迴圈體內 callback 的 return 不算提早退出', () => {
  const fixture = `
    for (let i = 0; i < steps; i += 1) {
      const points = raw.map((p) => {
        return { x: p.x + i, y: p.y }
      })
      await dragMouse(points)
    }
  `
  assert.deepEqual(findHandWrittenRetries('fixture.mjs', fixture), [])
})

test('對照組（該紅）：把次數傳給 retryAction', () => {
  const fixture = `
    await retryAction({ act, read, settled, attempts: 3, timeoutMs: 5000, label: 'x' })
  `
  assert.equal(findRetryCountArguments('fixture.mjs', fixture).length, 1)
})
