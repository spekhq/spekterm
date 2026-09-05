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

/**
 * 測試檔與 testkit 可以用中文描述自己在測什麼 —— 它們不出貨。
 *
 * **`.testkit.ts` 的豁免有一個前提：沒有產品原始碼 import 它。** 那個前提由下面
 * 「產品原始碼不得 import testkit」那條測試維持 —— 少了它，「不出貨」就只是一句沒有人在檢查的
 * 假設，而一份中文的 UI 文案只要搬進 `*.testkit.ts` 就能繞過整道守衛。
 * 兩條測試因此刻意放在同一個檔案裡：豁免與它的前提要一起被讀到。
 */
function isProductSource(path) {
  if (!/\.tsx?$/.test(path)) return false
  if (/\.testkit\.tsx?$/.test(path)) return false
  return !/\.test\.tsx?$/.test(path)
}

/** 從原始碼裡撈出所有 import 的模組指定字串（含 `export … from` 與動態 import）。 */
function importedSpecifiers(source) {
  const out = []
  const re = /(?:\bfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(source)) !== null) out.push(m[1])
  return out
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

test('產品原始碼不得 import testkit（上一條豁免的前提）', () => {
  const offenders = []

  for (const path of walk(srcRoot)) {
    if (!isProductSource(path)) continue
    const source = readFileSync(path, 'utf8')
    for (const spec of importedSpecifiers(source)) {
      if (/\.testkit$|\.testkit\.tsx?$/.test(spec)) {
        offenders.push(`${relative(repoRoot, path)} → ${spec}`)
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `testkit 只供測試使用，因此它被豁免於 CJK 守衛之外。產品原始碼一旦 import 它，\n` +
      `那個豁免就成了繞過整道守衛的通道。\n\n` +
      offenders.join('\n'),
  )
})

test('對照組：產品原始碼 import testkit 會被抓到', () => {
  const hits = importedSpecifiers("import { x } from './foo.testkit'\n")
  assert.deepEqual(hits, ['./foo.testkit'])
  assert.ok(/\.testkit$/.test(hits[0]))
  // 而一般的 import 不該被誤判。
  assert.deepEqual(
    importedSpecifiers("import { y } from './foo'\nimport z from 'node:fs'\n").filter((s) => /\.testkit/.test(s)),
    [],
  )
})

test('對照組：testkit 本身不受 CJK 守衛約束', () => {
  assert.equal(isProductSource('/x/src/main/a.testkit.ts'), false)
  assert.equal(isProductSource('/x/src/main/a.test.ts'), false)
  // 而一般的產品原始碼仍然受約束 —— 少了這一半，上面兩條在「全部回傳 false」時也會通過。
  assert.equal(isProductSource('/x/src/main/a.ts'), true)
  assert.equal(isProductSource('/x/src/renderer/src/shell/A.tsx'), true)
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
