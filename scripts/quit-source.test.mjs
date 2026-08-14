/**
 * 守衛：**探針裡不得直接送出 graceful 的終止訊號**，一律經 `lib/quit.mjs` 的 `quitAndWait`。
 *
 * ## 為什麼要有這道守衛
 *
 * 「送出訊號就返回」讓探針的後續動作與被測主行程的**收尾寫檔**競態，而那條路上最惡劣的
 * 失效方向是**假綠**：驗「損毀降級」的段落可能讀到一份被覆蓋回來的正常檔案，於是產品的隔離
 * 邏輯真的壞掉時它照樣通過（issue #8）。
 *
 * ## 判準為什麼是「一律」，而不是「會重啟的那些」
 *
 * 規格說的是「關閉之後會以同一個使用者資料目錄重新啟動的站點」—— 但**那件事靜態判定不出來**
 * （重啟可能發生在幾百行之外、或在另一個函式裡），而一個判定不出來的守衛等於沒有守衛。
 * 「不得直接送出 graceful 訊號」是唯一可執行的判準，而它比規格要求的更嚴 —— 那是安全的方向。
 *
 * **`SIGKILL` 不在此列**：那是連根拔除（`destroy()`、process group），語意本來就是「不等」，
 * 而 SIGKILL 之後的行程沒有機會再寫任何東西。
 *
 * ## 這道守衛的必要性有一個現成的證據
 *
 * `probe-core` 曾經自己手寫了一份「SIGTERM → 等 exit → 5 秒後 SIGKILL」—— 與 `quitAndWait`
 * 逐字同一件事。**需求本來就存在於別處，而紀律沒有擋住第二份實作**（同
 * `wait-source.test.mjs` 擋手寫等待迴圈的理由）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptsDir = dirname(fileURLToPath(import.meta.url))

/** graceful 的終止訊號 —— 送出它就等於「請你自己收尾」，那正是需要等待的情形。 */
const GRACEFUL_SIGNALS = new Set(['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT'])

/** 唯一得以直接送出它們的地方。 */
const PRIMITIVE_FILE = join(scriptsDir, 'lib', 'quit.mjs')

function probeSources() {
  const files = readdirSync(scriptsDir)
    .filter((name) => name.startsWith('probe-') && name.endsWith('.mjs'))
    .map((name) => join(scriptsDir, name))
  const libs = readdirSync(join(scriptsDir, 'lib'))
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => join(scriptsDir, 'lib', name))
    .filter((path) => path !== PRIMITIVE_FILE)
  return [...files, ...libs]
}

/** `x.kill('SIGTERM')` / `process.kill(pid, 'SIGTERM')` 裡那個訊號字面值。 */
function gracefulKills(source, text) {
  const found = []
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const isKill =
        (ts.isPropertyAccessExpression(callee) && callee.name.text === 'kill') ||
        (ts.isIdentifier(callee) && callee.text === 'kill')
      if (isKill) {
        for (const arg of node.arguments) {
          if (ts.isStringLiteral(arg) && GRACEFUL_SIGNALS.has(arg.text)) {
            const { line } = source.getLineAndCharacterOfPosition(arg.getStart(source))
            found.push({ signal: arg.text, line: line + 1 })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  void text
  return found
}

test('探針不得直接送出 graceful 的終止訊號', () => {
  const violations = []
  for (const path of probeSources()) {
    const text = readFileSync(path, 'utf8')
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
    for (const hit of gracefulKills(source, text)) {
      violations.push(`${path}:${hit.line} 直接送出 ${hit.signal}`)
    }
  }
  assert.deepEqual(
    violations,
    [],
    `這些地方要改用 lib/quit.mjs 的 quitAndWait：\n  ${violations.join('\n  ')}`,
  )
})

test('對照組：守衛認得出一個直接送出 SIGTERM 的寫法', () => {
  // **少了這條，一個永遠回空陣列的守衛也會全綠** —— 而這個 repo 每一條沒有對照組的守衛，
  // 最後都被發現是假綠。
  const text = `const child = spawn('x')\nchild.kill('SIGTERM')\n`
  const source = ts.createSourceFile('fake.mjs', text, ts.ScriptTarget.Latest, true)
  const hits = gracefulKills(source, text)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].signal, 'SIGTERM')
})

test('對照組：SIGKILL 不被判為違規（連根拔除本來就不等）', () => {
  const text = `child.kill('SIGKILL')\nprocess.kill(-pid, 'SIGKILL')\n`
  const source = ts.createSourceFile('fake.mjs', text, ts.ScriptTarget.Latest, true)
  assert.deepEqual(gracefulKills(source, text), [])
})

test('原語自己不受此限（否則它無法實作）', () => {
  const text = readFileSync(PRIMITIVE_FILE, 'utf8')
  const source = ts.createSourceFile(PRIMITIVE_FILE, text, ts.ScriptTarget.Latest, true)
  // 它**必須**送得出 graceful 訊號 —— 這條同時釘住「豁免的是這個檔案，不是這個行為」。
  assert.ok(text.includes('signal'), 'quitAndWait 以參數接受要送出的訊號')
  void source
})
