/**
 * agent-intake：作業系統通知的 API 一律出自單一綁定點（`src/main/intake-notify-electron.ts`）。
 *
 * ## 為什麼要守
 *
 * 通知是這個 app **第一次把文字送到自己控制範圍之外的呈現面**，而它有一整組不得被繞過的性質：
 * 標題恆為系統文案、第三方欄位進入之前先縮減、選項是白名單（不得有動作按鈕、不得有遠端圖示、
 * 不得不自行消失）、已顯示的通知必須被持有到結束。**那些全部住在決策層與後端的可測部分**。
 * 任何一處直接取用作業系統的通知 API，就是一條繞過它們全部的旁路 —— 而它不會讓任何東西變紅。
 *
 * ## 走語法樹而非逐行比對
 *
 * 本檔案、`intake-notify.ts`、`intake-notify-backend.ts` 的**註解**都會提到那個 API 的名字，
 * 逐行掃描會把它們全部誤判（`aria-label-source.test.mjs` 就是行掃描，因此它連註解一起吃 ——
 * 那在那個守衛裡是刻意的，在這裡不是）。註解是 trivia，不在語法樹的節點裡，自動豁免。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcRoot = join(repoRoot, 'src')

/** 唯一允許取用作業系統通知 API 的檔案。 */
const ENTRY = join('src', 'main', 'intake-notify-electron.ts')

const MODULE = 'electron'
const SYMBOL = 'Notification'

/**
 * 找出一份來源中「自 electron 取得通知 API」的位置。
 *
 * 涵蓋三種取得方式：具名匯入、命名空間匯入後取用該屬性、以及動態匯入。
 * **型別匯入放行** —— 一個型別建立不出通知。
 */
export function findNotificationSourceViolations(source, fileName = 'sample.ts') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found = []
  const namespaces = new Set()

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (node.moduleSpecifier.text === MODULE) {
        const clause = node.importClause
        if (clause && !clause.isTypeOnly) {
          const bindings = clause.namedBindings
          if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) {
              if (element.isTypeOnly) continue
              const imported = (element.propertyName ?? element.name).text
              if (imported === SYMBOL) found.push(`具名匯入 ${SYMBOL}`)
            }
          }
          if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
        }
      }
    }

    // `import * as electron from 'electron'` 之後的 `electron.Notification`
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      namespaces.has(node.expression.text) &&
      node.name.text === SYMBOL
    ) {
      found.push(`命名空間取用 ${SYMBOL}`)
    }

    // 動態 import —— eslint 的 no-restricted-imports 實測不攔它（見 watcher-source 的同一條）
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === MODULE
    ) {
      found.push('動態匯入 electron')
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

function sources(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sources(full))
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

test('作業系統通知的 API 只能由單一綁定點取用', () => {
  const offenders = []
  for (const file of sources(srcRoot)) {
    const rel = relative(repoRoot, file)
    if (rel === ENTRY) continue
    const violations = findNotificationSourceViolations(readFileSync(file, 'utf8'), rel)
    for (const violation of violations) offenders.push(`${rel}：${violation}`)
  }
  assert.deepEqual(offenders, [], `只有 ${ENTRY} 可以取用它`)
})

test('綁定點自己確實取用了它（否則這道守衛在守一個空集合）', () => {
  // **對照組的另一半。** 少了這條，把綁定點刪掉之後守衛照樣全綠 —— 而那時每一個呼叫端
  // 都會被迫自己去取用，也就是這道守衛存在的前提消失了。
  const violations = findNotificationSourceViolations(
    readFileSync(join(repoRoot, ENTRY), 'utf8'),
    ENTRY,
  )
  assert.ok(violations.length > 0, `${ENTRY} 應該是取用它的那一個`)
})

test('守衛認得出三種取得方式（對照組）', () => {
  assert.equal(
    findNotificationSourceViolations(`import { Notification } from 'electron'`).length,
    1,
    '具名匯入',
  )
  assert.equal(
    findNotificationSourceViolations(
      `import * as el from 'electron'\nconst n = new el.Notification({})`,
    ).length,
    1,
    '命名空間取用',
  )
  assert.equal(
    findNotificationSourceViolations(`await import('electron')`).length,
    1,
    '動態匯入',
  )
  assert.equal(
    findNotificationSourceViolations(`import type { Notification } from 'electron'`).length,
    0,
    '型別匯入放行 —— 一個型別建立不出通知',
  )
  assert.equal(
    findNotificationSourceViolations(`import { app } from 'electron'`).length,
    0,
    'electron 的其他 API 不在這道守衛的定義域內',
  )
})
