/**
 * agent-intake：兩條「靠紀律就會失守」的性質，改由原始碼守衛承擔。
 *
 * ## 1. 本文只能經一個 accessor 取得
 *
 * 「交給 agent 的內容逐字元等於呈現給使用者的內容」是人類閘門的另一半。它最自然的失效方式
 * 不是實作錯誤，而是**兩端各自取值** —— 呈現走一條路、交付走另一條，中間任何一邊多做一次
 * 轉換（例如在呈現層剝除不可列印字元），兩份文字就差在一組看不見的字元上。
 *
 * 把取用收斂成 `bodyOf()` 一個入口，這件事就從「兩個值要相等」變成「只有一個值」。
 *
 * ## 2. nonce 的不變式是**取值來源**，不是輸出的樣子
 *
 * 「不構成可預測的序列」寫不成一條斷言：任何有限樣本都判定不了可預測性，而一個零填充的遞增
 * 計數器滿足「互異 ＋ 長度達標」—— 於是「改用計數器 → 必須變紅」那個對照組會**保持綠**，
 * 然後被讀成「這條沒有鑑別力」。因此這裡釘的是它只能來自密碼學亂數入口。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcRoot = join(repoRoot, 'src')

/** 本文 accessor 所在的模組 —— 唯一允許直接取用 `.authored.body` 的檔案。 */
const SCHEMA = join('src', 'main', 'intake-schema.ts')

/** nonce 的產生處。 */
const CONTEXT = join('src', 'main', 'intake-context.ts')

export function findBodyAccessViolations(source, fileName = 'sample.ts') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found = []
  const visit = (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'body' &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'authored'
    ) {
      found.push('direct .authored.body')
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

export function findNonceViolations(source, fileName = 'sample.ts') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  let usesRandomBytes = false
  const found = []
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === 'randomBytes') usesRandomBytes = true
    if (ts.isIdentifier(node) && (node.text === 'Math' || node.text === 'Date')) {
      // 只在 nonce 的產生函式裡才算違規，交由呼叫端以檔案為單位判定。
      found.push(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return { usesRandomBytes, found }
}

function collectSources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return collectSources(full)
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) return []
    if (entry.name.includes('.test.') || entry.name.includes('.testkit.')) return []
    return [full]
  })
}

test('本文只能經 bodyOf() 取得', () => {
  const offenders = []
  for (const file of collectSources(srcRoot)) {
    const rel = relative(repoRoot, file)
    if (rel === SCHEMA) continue
    if (findBodyAccessViolations(readFileSync(file, 'utf8'), rel).length > 0) offenders.push(rel)
  }
  assert.deepEqual(offenders, [], `本文的取用必須收斂到 ${SCHEMA} 的 bodyOf()`)
})

test('nonce 只能來自密碼學亂數', () => {
  const source = readFileSync(join(repoRoot, CONTEXT), 'utf8')
  const { usesRandomBytes, found } = findNonceViolations(source, CONTEXT)
  assert.equal(usesRandomBytes, true, 'nonce 必須取自 node:crypto 的 randomBytes')
  assert.deepEqual(found, [], `${CONTEXT} 不得使用 Math／Date 產生 nonce`)
})

test('對照組：兩道守衛都抓得到違規', () => {
  assert.equal(findBodyAccessViolations('const b = intake.authored.body').length, 1)
  assert.deepEqual(findBodyAccessViolations('const b = bodyOf(intake)'), [])
  assert.deepEqual(findBodyAccessViolations('// intake.authored.body 只能經 bodyOf'), [])

  assert.equal(findNonceViolations('const n = String(Date.now())').usesRandomBytes, false)
  assert.deepEqual(findNonceViolations('const n = Math.random()').found, ['Math'])
  assert.equal(findNonceViolations("import { randomBytes } from 'node:crypto'").usesRandomBytes, true)
})
