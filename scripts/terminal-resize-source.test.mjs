/**
 * terminal-sessions：終端的行列數只由**一個匯流點**改變。
 *
 * `xterm.ts` 的 `fit()` 是那個匯流點，而「容器沒有版面盒子時什麼都不做」這道防護就住在它裡面。
 * 整條論證（design D3：「壞值表達不出來，所以 `size()` 不必再設第二道」）成立的前提，是
 * **renderer 內沒有別的路徑改得動終端的行列數、也沒有別的路徑推得動 pty 的尺寸**。
 *
 * 那是一個**日後會被打破的性質**，不是一個恆真句。用一次性的 `git grep` 確認它，等於把整條
 * 論證交給「下一個人記得再 grep 一次」——而本 change 的根因（一次純依賴升級靜默抽掉了守衛的
 * 前提，九支探針全綠）正是同一族的失效：**沒有東西會在它失守時變紅**。
 *
 * 這道守衛與另外兩道互補，三者擋的是不同方向：
 *
 * 1. **本檔**：我們自己在別處多開一條繞過 `fit()` 的路。
 * 2. `probe-terminal` 的 winsize 斷言：上游又改了 `proposeDimensions()` 的回傳值形狀。
 * 3. `xterm.ts` 明寫的 `windowOptions: {}`：pty 裡的程式以 DECCOLM／XTWINOPS 自行改寫幾何。
 *
 * ## 為什麼咽喉點是「套件的 import」而不是「`fit()` 的呼叫」
 *
 * 第一版擋的是「`xterm.ts` 之外不得呼叫 `.fit()`」—— 它把 `TerminalView` 三處
 * `handleRef.current?.fit()` 判成違規，而**那正是匯流點被正確使用的樣子**。真正要防的是
 * 「有人繞過 wrapper 自己拿到 `FitAddon`／`Terminal`」，而那唯一的入口是 import。
 * 擋住它，`fitAddon.fit()` 出現在別處就**表達不出來**（比照 `watcher-source.test.mjs`：
 * 守的是建立入口，不是每一個呼叫點）。
 *
 * 這也順帶把 CLAUDE.md 記載多時、卻**沒有任何東西在守**的那條慣例（「renderer 的其他模組
 * 一律不直接 import `@xterm/*`，退守替代終端時改動侷限於此」）真的釘住 —— eslint 的
 * `no-restricted-imports` 只列了 monaco 與 chokidar。
 *
 * **走語法樹而非逐行比對**：本檔案與 `xterm.ts`／`TerminalView.tsx` 的**註解**都會談到
 * `@xterm/*` 與 `resize`，逐行掃描會把它們全部誤判。註解是 trivia，不在語法樹的節點裡，
 * 因此自動豁免（比照 `watcher-source.test.mjs`）。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcRoot = join(repoRoot, 'src')

/** wrapper —— 唯一允許直接碰 `@xterm/*` 的檔案；`fit()` 的防護就住在它裡面。 */
const WRAPPER = join('src', 'renderer', 'src', 'shell', 'terminal', 'xterm.ts')

/** 唯一允許把尺寸推給 pty 的檔案 —— 它是唯一握有「終端當下可不可見」這個資訊的地方。 */
const VIEW = join('src', 'renderer', 'src', 'shell', 'terminal', 'TerminalView.tsx')

const PACKAGE_PREFIX = '@xterm/'

/** `.resize()` 的接收端看起來像不像一個終端／pty 控制面。 */
const TERMINAL_RECEIVER = /terminal|\bterm\b/i

/**
 * 找出一份來源中「繞過匯流點」的位置。
 *
 * `entry` 傳的是**這個檔案是誰**（`'wrapper'`／`'view'`／`undefined`）——兩個入口的豁免範圍
 * 不同，不是一個布林。
 */
export function findTerminalResizeViolations(source, fileName = 'sample.ts', { entry } = {}) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found = []

  const at = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  const isXtermModule = (node) => ts.isStringLiteral(node) && node.text.startsWith(PACKAGE_PREFIX)

  const visit = (node) => {
    // ① 靜態 import：`import … from '@xterm/…'`。CSS 的 side-effect import 一併算 —— 樣式
    //    同樣屬於「這個套件的接觸面」，而 wrapper 就是那個接觸面。型別匯入放行（型別
    //    建立不出終端），比照 chokidar 那道守衛的 allowTypeImports。
    if (
      ts.isImportDeclaration(node) &&
      isXtermModule(node.moduleSpecifier) &&
      entry !== 'wrapper' &&
      !node.importClause?.isTypeOnly
    ) {
      found.push({ line: at(node), kind: 'xterm-import' })
    }

    // ② 動態 `import('@xterm/…')` —— eslint 的 no-restricted-imports 實測不攔它。
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      isXtermModule(node.arguments[0]) &&
      entry !== 'wrapper'
    ) {
      found.push({ line: at(node), kind: 'xterm-dynamic-import' })
    }

    // ③ wrapper 自己把 `@xterm/*` 的**值**再導出 —— 所有守衛全綠，而呼叫端
    //    `import { Terminal } from './xterm'` 就繞過了整個 wrapper。
    if (
      entry === 'wrapper' &&
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      isXtermModule(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      const clause = node.exportClause
      const leaksValue =
        clause === undefined ||
        !ts.isNamedExports(clause) ||
        clause.elements.some((element) => !element.isTypeOnly)
      if (leaksValue) found.push({ line: at(node), kind: 'xterm-value-re-export' })
    }

    // ④ 對終端／pty 推尺寸（`window.workspace.terminal.resize(...)`、`term.resize(...)`）——
    //    只有兩個入口可以。第三個地方出現它，「尺寸只由一次真實量測決定」就不再成立。
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'resize' &&
      entry === undefined &&
      TERMINAL_RECEIVER.test(node.expression.expression.getText(sourceFile))
    ) {
      found.push({ line: at(node), kind: 'resize-outside-entry' })
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

/** 測試檔不出貨，且它們正需要談論這些東西。 */
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

test('終端的行列數與 pty 的尺寸只由單一匯流點改變', () => {
  const offenders = []

  for (const path of walk(srcRoot)) {
    if (!isProductSource(path)) continue
    const rel = relative(repoRoot, path)
    const entry = rel === WRAPPER ? 'wrapper' : rel === VIEW ? 'view' : undefined
    for (const hit of findTerminalResizeViolations(readFileSync(path, 'utf8'), path, { entry })) {
      offenders.push(`${rel}:${hit.line}: ${hit.kind}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `終端的尺寸只能經由 ${WRAPPER} 的 fit()（它持有「容器有沒有版面盒子」這道防護）\n` +
      `與 ${VIEW}（唯一知道終端當下可不可見的地方）改變。\n` +
      '多一條繞道，「尺寸只由一次真實量測決定」就不再成立，而失效是靜默的。\n\n' +
      offenders.join('\n'),
  )
})

test('對照組：四種繞道各自被抓到', () => {
  const staticImport = findTerminalResizeViolations("import { FitAddon } from '@xterm/addon-fit'")
  assert.equal(staticImport.length, 1, 'wrapper 之外的靜態 import 應被抓到')
  assert.equal(staticImport[0].kind, 'xterm-import')

  const dynamicImport = findTerminalResizeViolations("const m = await import('@xterm/xterm')")
  assert.equal(dynamicImport.length, 1, '動態 import 應被抓到')
  assert.equal(dynamicImport[0].kind, 'xterm-dynamic-import')

  const reExport = findTerminalResizeViolations("export { Terminal } from '@xterm/xterm'", WRAPPER, {
    entry: 'wrapper',
  })
  assert.equal(reExport.length, 1, 'wrapper 的值 re-export 應被抓到')
  assert.equal(reExport[0].kind, 'xterm-value-re-export')

  const strayResize = findTerminalResizeViolations('window.workspace.terminal.resize(id, 2, 1)')
  assert.equal(strayResize.length, 1, '入口之外推尺寸給 pty 應被抓到')
  assert.equal(strayResize[0].kind, 'resize-outside-entry')

  const strayTermResize = findTerminalResizeViolations('term.resize(2, 1)')
  assert.equal(strayTermResize.length, 1, '入口之外直接改終端行列數應被抓到')
})

test('對照組：兩個入口的合法用法不被誤報', () => {
  const wrapperOk = findTerminalResizeViolations(
    [
      "import { FitAddon } from '@xterm/addon-fit'",
      "import '@xterm/xterm/css/xterm.css'",
      "export type { IDisposable } from '@xterm/xterm'",
      'const proposed = fitAddon.proposeDimensions()',
      'fitAddon.fit()',
      'term.resize(80, 24)',
    ].join('\n'),
    WRAPPER,
    { entry: 'wrapper' },
  )
  assert.deepEqual(wrapperOk, [], `wrapper 的合法用法被誤報：${JSON.stringify(wrapperOk)}`)

  // **匯流點被正確使用的樣子** —— 這正是第一版守衛誤報的那三行。
  const viewOk = findTerminalResizeViolations(
    [
      'const size = handleRef.current?.fit()',
      'window.workspace.terminal.resize(sessionId, size.cols, size.rows)',
    ].join('\n'),
    VIEW,
    { entry: 'view' },
  )
  assert.deepEqual(viewOk, [], `view 的合法用法被誤報：${JSON.stringify(viewOk)}`)

  // 呼叫端經 wrapper 的介面取用 —— 不歸這道守衛管。
  const callerOk = findTerminalResizeViolations(
    ["import { createXterm } from './xterm'", 'const size = handle.fit()'].join('\n'),
  )
  assert.deepEqual(callerOk, [], `呼叫端的合法用法被誤報：${JSON.stringify(callerOk)}`)

  // 同名方法但與終端無關的接收端（例如影像處理）不歸這道守衛管。
  const unrelated = findTerminalResizeViolations('imageCanvas.resize(100, 100)')
  assert.deepEqual(unrelated, [], `無關的 resize 被誤報：${JSON.stringify(unrelated)}`)
})
