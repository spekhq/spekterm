/**
 * 守衛：**debugging port 只能有一份宣告，而且不得重複**。
 *
 * ## 為什麼需要它
 *
 * 前置檢查（`lib/preflight.mjs`）要問「這支探針要用的 port 通不通」，那個問題只有在 port 收斂於
 * `lib/ports.mjs` 時才有定義域。而收斂本身不會維持自己 —— 下一個人加一支探針時，最省事的寫法
 * 永遠是在自己的檔案裡寫一個數字。
 *
 * ## 判準有三條，因為現況的缺陷用一條抓不到
 *
 * | 判準 | 抓什麼 | 為什麼不能省 |
 * |---|---|---|
 * | 一、表上不得有重複的號碼 | `identity` 與 `files` 都用 9225 | 這是收斂的目的 |
 * | 二、探針裡不得有 port 的數字字面 | `const DEBUG_PORT = 9225` | 第二份對照會長回來，而表上看起來仍然乾淨 |
 * | 三、不得對表的成員做算術 | **`DEBUG_PORT + 1`** | **判準二對它一個字都看不到** |
 *
 * 第三條是這道守衛真正的判準。`probe-identity` 啟動兩次，第二次用的是 `DEBUG_PORT + 1` ——
 * 那個號碼（9226）撞著 `probe-terminal` 的 build port，而它**從來不在任何一份表上**：
 * 一份以「一支探針一個 port」為形狀的表放不下它，一條找數字字面的規則也看不到它。
 * **一個只有判準二的守衛會在對照組上如期變紅，卻放過正在出問題的那一個** —— 本專案定義的假綠。
 *
 * **判準二與三是接力的，各有定義域。** 對照組（`git show HEAD` 的八支舊碼）上判準二報 12 處、
 * 判準三報 0 處 —— 因為當時的算術是對**本地常數**做的（`DEBUG_PORT + 1`），而那個常數本身已經被
 * 判準二抓住，那一行必然得改。改完之後同一個手勢會寫成 `PROBE_PORTS.identity.default + 1`，
 * 那時判準三接手。**兩條都要有**：只有二，改寫成表的成員之後就沒人擋了；只有三，本地常數的世界
 * 一片綠。
 *
 * ## 判準二為什麼不是「掃 9xxx 這個範圍」
 *
 * 那會誤判（探針裡有 `9000` 之類的時限），而**會誤判的守衛遲早會被加上例外開關**。判準取
 * 「`--remote-debugging-port=` 的插值是數字字面」與「名稱含 `PORT` 的宣告以數字字面為初始值」
 * 兩種語法上明確、寫得出對照組的形狀。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { PROBE_PORTS, allPorts, portsOf } from './lib/ports.mjs'

const scriptsDir = dirname(fileURLToPath(import.meta.url))

/** 這份表被匯入時的識別碼。探針一律以這個名字引用它。 */
const TABLE = 'PROBE_PORTS'

const ARITHMETIC = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
])

/** 這個節點是不是「以 `PROBE_PORTS` 為根的成員存取」（`PROBE_PORTS.files.build`）。 */
function isTableAccess(node) {
  let cursor = node
  while (ts.isPropertyAccessExpression(cursor) || ts.isElementAccessExpression(cursor)) {
    cursor = cursor.expression
  }
  return ts.isIdentifier(cursor) && cursor.text === TABLE
}

/** 這個節點是不是 `--remote-debugging-port=` 那個 template literal。 */
function isDebugPortTemplate(node) {
  return (
    ts.isTemplateExpression(node) && node.head.text.endsWith('--remote-debugging-port=')
  )
}

/**
 * 掃一份原始碼，回傳違規（`檔名:行號 判準`）。**導出供對照組餵 fixture。**
 */
export function findPortViolations(fileName, sourceText) {
  const src = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true)
  const violations = []
  const at = (node) =>
    `${fileName}:${src.getLineAndCharacterOfPosition(node.getStart()).line + 1}`

  const visit = (node) => {
    // 判準二之一：`--remote-debugging-port=${9225}` 或字面 port 直接寫在字串裡
    if (isDebugPortTemplate(node)) {
      const first = node.templateSpans[0]?.expression
      if (first && ts.isNumericLiteral(first)) {
        violations.push(`${at(node)} port 的數字字面直接寫進了 --remote-debugging-port=`)
      }
    }
    if (
      ts.isNoSubstitutionTemplateLiteral(node) &&
      /--remote-debugging-port=\d/.test(node.text)
    ) {
      violations.push(`${at(node)} port 的數字字面直接寫進了 --remote-debugging-port=`)
    }
    if (ts.isStringLiteral(node) && /--remote-debugging-port=\d/.test(node.text)) {
      violations.push(`${at(node)} port 的數字字面直接寫進了 --remote-debugging-port=`)
    }

    // 判準二之二：`const DEBUG_PORT = 9225`
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text.includes('PORT') &&
      node.initializer &&
      ts.isNumericLiteral(node.initializer)
    ) {
      violations.push(`${at(node)} ${node.name.text} 以數字字面宣告 —— port 只能宣告於 lib/ports.mjs`)
    }

    // 判準三：`PROBE_PORTS.identity.default + 1`
    if (
      ts.isBinaryExpression(node) &&
      ARITHMETIC.has(node.operatorToken.kind) &&
      (isTableAccess(node.left) || isTableAccess(node.right))
    ) {
      violations.push(`${at(node)} 對 ${TABLE} 的成員做算術 —— 衍生出來的 port 不會出現在表上`)
    }

    ts.forEachChild(node, visit)
  }
  visit(src)
  return violations
}

/** 全部探針原始碼（不含 `lib/ports.mjs` 自己 —— 數字字面本來就住在那裡）。 */
function probeSources() {
  const files = []
  for (const dir of [scriptsDir, join(scriptsDir, 'lib')]) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.mjs') || name.endsWith('.test.mjs')) continue
      if (name === 'ports.mjs') continue
      files.push(join(dir, name))
    }
  }
  return files
}

test('表上沒有重複的 port', () => {
  const ports = allPorts()
  const seen = new Map()
  const duplicates = []
  for (const [probe, entry] of Object.entries(PROBE_PORTS)) {
    for (const [role, port] of Object.entries(entry)) {
      const owner = `${probe}.${role}`
      if (seen.has(port)) duplicates.push(`${port}：${seen.get(port)} 與 ${owner}`)
      else seen.set(port, owner)
    }
  }
  assert.deepEqual(duplicates, [], '兩支探針配置到同一個 port —— 序列執行時看不出來，前一支沒收乾淨時必然咬人')
  assert.equal(new Set(ports).size, ports.length)
})

test('core 與 native 不在表上（給它們 port 會讓 probe:core 依設計失敗）', () => {
  assert.deepEqual(portsOf('core'), [])
  assert.deepEqual(portsOf('native'), [])
})

test('探針原始碼中沒有 port 的數字字面，也沒有衍生的 port', () => {
  const violations = probeSources().flatMap((file) =>
    findPortViolations(file, readFileSync(file, 'utf8')),
  )
  assert.deepEqual(violations, [], 'port 只能宣告於 lib/ports.mjs')
})

test('對照組（判準二）：本地的數字字面 port 被擋下', () => {
  const source = `
    const DEBUG_PORT = 9225
    spawn('electron', [\`--remote-debugging-port=\${DEBUG_PORT}\`, '.'])
  `
  assert.equal(findPortViolations('fixture.mjs', source).length, 1)
})

test('對照組（判準三）：衍生的 port 被擋下', () => {
  const source = `
    import { PROBE_PORTS } from './lib/ports.mjs'
    await launchAndObserve({ port: PROBE_PORTS.identity.default + 1 })
  `
  assert.equal(
    findPortViolations('fixture.mjs', source).length,
    1,
    '少了這一條，守衛就退回成一條看不見 `DEBUG_PORT + 1` 的規則 —— 而那正是現況的缺陷',
  )
})

test('對照組：數字字面直接寫進旗標時被擋下', () => {
  const source = "spawn('electron', ['--remote-debugging-port=9225', '.'])"
  assert.equal(findPortViolations('fixture.mjs', source).length, 1)
})

test('對照組：取自表的 port 不被擋（含以區域常數轉手）', () => {
  const source = `
    import { PROBE_PORTS } from './lib/ports.mjs'
    const BUILD_PORT = PROBE_PORTS.files.build
    spawn('electron', [\`--remote-debugging-port=\${port}\`, '.'])
  `
  assert.deepEqual(
    findPortViolations('fixture.mjs', source),
    [],
    '多數探針把 port 當參數傳進 launch()，插值處看到的是參數名 —— 判準若要求「插值必須是表的成員存取」，會把它們全部誤判',
  )
})

test('對照組：與 port 無關的算術不被擋', () => {
  const source = `
    import { PROBE_PORTS } from './lib/ports.mjs'
    const deadline = STARTUP_TIMEOUT_MS + 1000
    const port = PROBE_PORTS.shell.main
  `
  assert.deepEqual(findPortViolations('fixture.mjs', source), [])
})
