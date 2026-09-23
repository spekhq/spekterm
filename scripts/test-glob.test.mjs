/**
 * 每一支單元測試都被 `npm test` 執行 —— 由 `test:unit` 的 glob 涵蓋。
 *
 * ## 為什麼要有它
 *
 * `test:unit` 是一串寫死層數的 glob（`src/main/*.test.ts` 只有一層）。`src/main/ipc/` 裡的
 * `intake-projection.test.ts` 因此**從寫下的那天起就沒有被執行過** —— 其中一條在
 * `agent-initiated-handoff` 改了注入的形狀之後變紅，而沒有任何人看到；對照表上還有三條
 * scenario 以它為載體，那道守衛只 grep 字面、不問它有沒有被執行（`intake-inbox-usability`）。
 *
 * **「一個測試檔存在」與「它被執行」是兩件事，而前者的失效是完全靜默的**：沒有錯誤、
 * 沒有警告，`npm test` 照樣全綠 —— 它只是少跑了一些東西。
 *
 * ## 判準
 *
 * 讀 `package.json` 的 `test:unit`，取出 `--test` 之後的 glob，以與 node 相同的語意比對
 * （`*` 不跨 `/`）。repo 內每一個 `*.test.{ts,tsx,mjs,js}` 都必須被其中之一涵蓋。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 不屬於本 repo 原始碼的目錄 —— 依賴、建置產物、打包產物。 */
const SKIP = new Set(['node_modules', 'out', 'release', 'dist', '.git'])

export function unitGlobs(script) {
  const tokens = script.split(/\s+/).filter(Boolean)
  const start = tokens.indexOf('--test')
  assert.ok(start >= 0, 'test:unit 必須以 node --test 執行')
  return tokens.slice(start + 1).filter((token) => !token.startsWith('-'))
}

/** node 的 glob 語意：`*` 匹配不含 `/` 的任意字串，其餘字元照字面。 */
export function globToRegExp(glob) {
  const body = glob
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*')
  return new RegExp(`^${body}$`)
}

function testFiles() {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.test\.(ts|tsx|mjs|js)$/.test(entry.name)) found.push(relative(repoRoot, full).split(sep).join('/'))
    }
  }
  walk(repoRoot)
  return found
}

test('每一支單元測試都被 test:unit 的 glob 涵蓋', () => {
  const script = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).scripts['test:unit']
  const patterns = unitGlobs(script).map(globToRegExp)
  const files = testFiles()
  // 自檢：列舉若什麼都沒找到，下面那條斷言恆真。
  assert.ok(files.length > 50, `只找到 ${files.length} 支測試 —— 列舉本身壞了`)

  const uncovered = files.filter((file) => !patterns.some((pattern) => pattern.test(file)))
  assert.deepEqual(uncovered, [], '這些測試不在 test:unit 的任何 glob 之內 —— 它們從來不會被執行')
})

test('glob 的比對語意與 node 相同：* 不跨目錄', () => {
  const pattern = globToRegExp('src/main/*.test.ts')
  assert.equal(pattern.test('src/main/a.test.ts'), true)
  // **這一條就是那個缺陷本身**：一層的 glob 看不到子目錄。
  assert.equal(pattern.test('src/main/ipc/a.test.ts'), false)
  assert.equal(globToRegExp('src/main/*/*.test.ts').test('src/main/ipc/a.test.ts'), true)
})
