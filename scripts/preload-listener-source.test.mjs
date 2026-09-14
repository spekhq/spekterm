/**
 * workspace-app-shell：preload 的每一個訂閱都必須把事件物件丟掉。
 *
 * ## 為什麼這是承重的
 *
 * `ipcRenderer.on(channel, handler)` 會把 `IpcRendererEvent` 當第一個參數交給 handler，
 * 而**那個事件物件的 `sender` 就是 `ipcRenderer` 本身**。把 renderer 傳進來的 listener 直接
 * 交給 `ipcRenderer.on`，等於讓 renderer 拿到 `ipcRenderer` —— 經 contextBridge 代理過去之後，
 * 它就能對**任何**通道 `invoke` / `send`，preload 白名單就地失效。
 *
 * 正確的形狀是包一層把參數丟掉：
 *
 * ```ts
 * const handler = (): void => listener()
 * ipcRenderer.on(CHANNEL, handler)
 * ```
 *
 * 帶負載的訂閱同理 —— 具名 `_event` 之後只轉交其餘參數。
 *
 * ## 為什麼要一道守衛
 *
 * 十幾個訂閱**全部靠手寫的紀律**維持著同一個形狀，而寫錯的那一個不會有任何徵狀：
 * 功能完全正常，只是白名單從此不構成邊界。這與 `watcher-source.test.mjs` 同一族 ——
 * 「不接受某個東西」要由結構保證，不是由「沒有人再送它」保證。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const PRELOAD = join(repoRoot, 'src', 'preload', 'index.ts')

/**
 * 找出把**外部傳入的識別碼**直接當作訂閱 handler 的位置。
 *
 * 判準：`ipcRenderer.on(...)` 的第二個參數若是一個識別碼，它必須是**本地宣告**的
 * （`const handler = …`），不得是函式的參數。箭頭函式與函式運算式一律放行 —— 它們
 * 自己決定要不要接住事件物件，而那是可讀的。
 */
export function findPreloadListenerViolations(source, fileName = 'preload.ts') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found = []

  /** 目前所在函式的參數名稱堆疊。 */
  const paramScopes = []

  const isParam = (name) => paramScopes.some((scope) => scope.has(name))

  const visit = (node) => {
    let pushed = false
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
    ) {
      const names = new Set()
      for (const parameter of node.parameters) {
        if (ts.isIdentifier(parameter.name)) names.add(parameter.name.text)
      }
      paramScopes.push(names)
      pushed = true
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'ipcRenderer' &&
      (node.expression.name.text === 'on' || node.expression.name.text === 'once') &&
      node.arguments.length >= 2
    ) {
      const handler = node.arguments[1]
      if (ts.isIdentifier(handler) && isParam(handler.text)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        found.push(`第 ${line + 1} 行：把外部傳入的 ${handler.text} 直接交給 ipcRenderer.${node.expression.name.text}`)
      }
    }

    ts.forEachChild(node, visit)
    if (pushed) paramScopes.pop()
  }

  visit(sourceFile)
  return found
}

test('preload 的訂閱不得把事件物件交給 renderer', () => {
  const violations = findPreloadListenerViolations(readFileSync(PRELOAD, 'utf8'), 'src/preload/index.ts')
  assert.deepEqual(violations, [])
})

test('preload 確實有訂閱（否則這道守衛在守一個空集合）', () => {
  // 對照組的另一半 —— 少了它，把所有訂閱刪光之後守衛照樣全綠。
  const source = readFileSync(PRELOAD, 'utf8')
  const count = source.split('ipcRenderer.on(').length - 1
  assert.ok(count >= 10, `preload 應該有一批訂閱，實際 ${count} 個`)
})

test('守衛認得出違規與合規的兩種形狀（對照組）', () => {
  const bad = `
    const api = {
      onThing: (listener: () => void) => {
        ipcRenderer.on('c', listener)
      },
    }
  `
  assert.equal(findPreloadListenerViolations(bad).length, 1, '直接轉交必須被抓到')

  const good = `
    const api = {
      onThing: (listener: () => void) => {
        const handler = (): void => listener()
        ipcRenderer.on('c', handler)
      },
    }
  `
  assert.equal(findPreloadListenerViolations(good).length, 0, '包一層的形狀放行')

  const withPayload = `
    const api = {
      onThing: (listener: (a: string) => void) => {
        const handler = (_event: unknown, a: string): void => listener(a)
        ipcRenderer.on('c', handler)
      },
    }
  `
  assert.equal(findPreloadListenerViolations(withPayload).length, 0, '帶負載的形狀放行')
})
