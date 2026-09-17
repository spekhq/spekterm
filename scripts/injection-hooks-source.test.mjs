/**
 * 注入貢獻者不得把 hooks 寫進 `settings`。
 *
 * **這道守衛與 `composeInjection()` 的執行期 throw 互補，不重複。** 執行期那道只在該貢獻者
 * **實際參與**時才會炸（偏好關閉、環境未就緒時它回 `null`，那條路徑一個字都不會執行），
 * 而症狀是「建立 session 時整條注入失敗」—— 代價已經付在使用者身上了。本守衛在 `npm test`
 * 就攔下來。
 *
 * **為什麼這件事值得一道守衛**：`hooks` 與其餘設定項的合併語意**相反**（串接 vs 獨佔）。
 * 一個「順手寫回 settings」的實作在型別上完全合法（`settings` 是
 * `Record<string, unknown>`），而它把已知會被多人貢獻的那一項送回了會互相覆蓋的那條路徑。
 *
 * **走語法樹而非逐行掃描**：本檔案與 `agent-injection.ts` 的**註解**都寫著 `settings.hooks`
 * 這個字面形式，逐行比對會把它們全部誤判。註解是 trivia，不在語法樹的節點裡，自動豁免。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const mainRoot = join(repoRoot, 'src', 'main')

const SETTINGS = 'settings'
const HOOKS = 'hooks'

/** 找出一份來源中「`settings` 物件字面值裡出現 `hooks`」的位置。 */
export function findSettingsHooksViolations(source, fileName = 'sample.ts') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found = []

  /** 物件字面值中是否有名為 `hooks` 的屬性（含 shorthand 與字串字面值的 key）。 */
  const hasHooksProperty = (node) =>
    ts.isObjectLiteralExpression(node) &&
    node.properties.some((property) => {
      const name = property.name
      if (!name) return false
      if (ts.isIdentifier(name)) return name.text === HOOKS
      if (ts.isStringLiteral(name)) return name.text === HOOKS
      return false
    })

  const visit = (node) => {
    // `settings: { … }` 與 `settings: { hooks }`（shorthand 的值仍是物件字面值才算）
    if (
      ts.isPropertyAssignment(node) &&
      ((ts.isIdentifier(node.name) && node.name.text === SETTINGS) ||
        (ts.isStringLiteral(node.name) && node.name.text === SETTINGS)) &&
      hasHooksProperty(node.initializer)
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      found.push({ fileName, line: line + 1 })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

/**
 * **豁免 `*.test.ts`**：`agent-injection.test.ts` **刻意**構造這個違規，用來驗證
 * `composeInjection()` 會拒絕它 —— 那正是這道守衛所保護的不變式的另一半載體。
 * 不豁免的話，兩者互斥：要嘛守衛紅，要嘛那條行為測試不存在。
 */
function mainSources() {
  return readdirSync(mainRoot, { recursive: true })
    .filter((entry) => typeof entry === 'string' && entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
    .map((entry) => join(mainRoot, entry))
}

test('主行程中沒有任何貢獻者把 hooks 寫進 settings', () => {
  const violations = mainSources().flatMap((file) =>
    findSettingsHooksViolations(readFileSync(file, 'utf8'), relative(repoRoot, file)),
  )
  assert.deepEqual(violations, [], `settings 內不得出現 hooks：${JSON.stringify(violations)}`)
})

test('對照組：把 hooks 寫回 settings 時本守衛必須命中', () => {
  const sample = `
    export function prepare(): InjectionContribution {
      const hooks = { SessionStart: [] }
      return { settings: { hooks }, env: {} }
    }
  `
  assert.equal(findSettingsHooksViolations(sample).length, 1)
})

test('對照組：hooks 走獨立欄位時不命中', () => {
  const sample = `
    export function prepare(): InjectionContribution {
      return { settings: {}, hooks: { SessionStart: ['cmd'] }, env: {} }
    }
  `
  assert.deepEqual(findSettingsHooksViolations(sample), [])
})

test('對照組：註解中出現該字面形式不算違規', () => {
  const sample = `
    // 不要寫成 settings: { hooks } —— 見 agent-injection。
    export const x = 1
  `
  assert.deepEqual(findSettingsHooksViolations(sample), [])
})
