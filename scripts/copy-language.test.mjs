/**
 * ui-localization：產品原始碼的字串字面值不得含非英文的文字。
 *
 * **文案之所以會變成中文，不是因為有人決定用中文，而是因為沒有東西擋著。** 這個 repo 的
 * 慣例是「程式碼英文、註解與文件繁體中文」—— 於是每個 change 的作者一邊用中文寫註解，
 * 一邊很自然地把中文寫進 `aria-label`。收斂前有約 150 處。少了這道守衛，`ui-copy-i18n`
 * 交付的狀態會被後續的 change 逐次磨掉。
 *
 * 規則：`src/**` 的產品原始碼中，**字串字面值、模板字面值與 JSX 文字節點**不得含 CJK。
 *
 * **註解豁免** —— 那是 repo 的既有慣例，本守衛不動它。
 *
 * **而豁免註解正是這道守衛的核心語意，因此它必須走語法樹（`ts.createSourceFile`）而非逐行
 * 比對**：註解與字串在同一行裡分不開（`const x = 'ok' // 這是註解`），而 JSX 的區塊註解
 * 對「行首是不是 //」的判斷更是完全無效。判不準註解，這道守衛不是誤殺就是全綠。
 *
 * **對照組不是裝飾。** 一道從未證明自己抓得到東西的守衛，與沒有守衛無法區分 ——
 * CLAUDE.md 記過 `naming.test.mjs` 因 ANSI 顏色碼讓路徑比對失準而全綠的實例。因此本檔案
 * 餵它一段**刻意違規**的來源，要求它必須被抓到；再餵一段**只有繁中註解**的來源，要求它
 * 不得被誤報。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcRoot = join(repoRoot, 'src')

/** CJK 統一漢字、注音、日文假名、諺文 —— 「非英文的文字」在這個 repo 的實際形狀。 */
const CJK = /[぀-ヿ㄀-ㄯ㐀-䶿一-鿿가-힯]/

/**
 * 找出一份 TypeScript 來源中，所有含 CJK 的**字串字面值／模板字面值／JSX 文字**。
 *
 * 註解不在語法樹的節點裡（它們是 trivia），因此**自動豁免** —— 這正是走 AST 而非 regex
 * 的理由。回傳 `{ line, text }`，行號自 1 起算。
 */
export function findNonEnglishLiterals(source, fileName = 'sample.tsx') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found = []

  const visit = (node) => {
    const isLiteral =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)

    if (isLiteral && CJK.test(node.text)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      found.push({ line: line + 1, text: node.text.trim() })
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

/** 測試檔可以用中文描述自己在測什麼 —— 它們不出貨。 */
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

test('產品原始碼的字串字面值不得含 CJK（註解不受限）', () => {
  const offenders = []

  for (const path of walk(srcRoot)) {
    if (!isProductSource(path)) continue
    const source = readFileSync(path, 'utf8')
    for (const hit of findNonEnglishLiterals(source, path)) {
      offenders.push(`${relative(repoRoot, path)}:${hit.line}: ${hit.text}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `使用者可見的文案必須來自字典（src/shared/i18n/en.json），不得寫在程式碼裡；\n` +
      `開發者訊息（console.*、內部不變式的 throw）不進字典，但一律英文。\n\n` +
      offenders.join('\n'),
  )
})

test('對照組：含 CJK 的字串字面值會被抓到', () => {
  const source = [
    'const label = "新增 session"',
    'const tpl = `關閉 ${name}`',
    'export const El = () => <span aria-label="工作區">尚未加入任何 folder</span>',
  ].join('\n')

  const hits = findNonEnglishLiterals(source)
  const lines = hits.map((hit) => hit.line)

  // 字串字面值、模板字面值、JSX 屬性、JSX 文字 —— 四種載體都要抓得到。
  assert.equal(lines.includes(1), true, '字串字面值')
  assert.equal(lines.includes(2), true, '模板字面值')
  assert.equal(lines.includes(3), true, 'JSX 屬性與文字節點')
  assert.equal(hits.length >= 4, true, `應抓到至少 4 處，實得 ${hits.length}`)
})

test('對照組：繁體中文的註解不會被誤報', () => {
  const source = [
    '// 這是行註解：它必須被豁免',
    '/* 這是區塊註解 */',
    '/**',
    ' * JSDoc 也是繁體中文 —— repo 的既有慣例。',
    ' */',
    'const ok = "New session" // 行尾註解：中文在這裡也合法',
    'export const El = () => (',
    '  <div>',
    '    {/* JSX 註解：這裡的中文同樣豁免 */}',
    '    <span aria-label="Workspace">No folders yet</span>',
    '  </div>',
    ')',
  ].join('\n')

  assert.deepEqual(findNonEnglishLiterals(source), [])
})
