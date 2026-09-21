/**
 * 守衛：拒絕的永久／暫時分類其 `switch` **不得有 `default`**。
 *
 * ## 為什麼需要一道守衛，而不是「記得不要加」
 *
 * `isPermanentRejection` 的全部價值在於**新增一種 `IntakeRejection` 時編譯失敗** ——
 * 於是「它是永久還是暫時」成為一個必須被作出的決定。加一行 `default: return false`
 * 就把那個價值整個拿掉，而**不會有任何東西變紅**：型別檢查過、測試過、探針過。
 *
 * 一次「臨時加個列舉值看 typecheck 會不會紅」的手動驗證是**一次性的**，不是常駐載體。
 * 這支就是那個常駐載體。
 *
 * ## 走語法樹，不走行掃描
 *
 * 註解裡本來就會寫到 `default:`（這個檔案自己就寫了好幾次）。行掃描分不開註解與程式碼，
 * 而豁免註解正是它的核心語意 —— 與 CJK 守衛同一條理由。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = 'src/main/intake-rejection.ts'

/** 回傳該原始碼中每一個帶 `default` 子句的 switch 其所在行號。 */
export function findDefaultClauses(source, fileName = TARGET) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found = []
  const visit = (node) => {
    if (ts.isDefaultClause(node)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart())
      found.push(line + 1)
    }
    node.forEachChild(visit)
  }
  visit(sourceFile)
  return found
}

test('分類的 switch 沒有 default —— 新增列舉值必須讓建置失敗', () => {
  const source = readFileSync(join(repoRoot, TARGET), 'utf8')
  const found = findDefaultClauses(source)
  assert.deepEqual(
    found,
    [],
    `${TARGET} 第 ${found.join('、')} 行有 default 子句。` +
      '加上它，新增一種 IntakeRejection 時就不會再有任何東西變紅 —— ' +
      '而那正是這個函式存在的全部理由。',
  )
})

test('對照組：加上 default 時守衛必須變紅', () => {
  const mutated = [
    "type R = 'a' | 'b'",
    'export function f(code: R): boolean {',
    '  switch (code) {',
    "    case 'a':",
    '      return true',
    '    default:',
    '      return false',
    '  }',
    '}',
  ].join('\n')
  assert.deepEqual(findDefaultClauses(mutated, 'mutated.ts'), [6])
})

test('對照組：註解裡寫到 default 不算違規', () => {
  const withComment = [
    '// 這裡刻意沒有 default：新增列舉值時要編譯失敗。',
    "type R = 'a'",
    'export function f(code: R): boolean {',
    '  switch (code) {',
    "    case 'a':",
    '      return true',
    '  }',
    '}',
  ].join('\n')
  assert.deepEqual(findDefaultClauses(withComment, 'commented.ts'), [])
})
