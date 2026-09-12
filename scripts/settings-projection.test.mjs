/**
 * terminal-preferences：偏好送往 renderer 時一律經**逐欄位投影**，且那道投影的型別要抵達 renderer。
 *
 * ## 為什麼需要一道守衛
 *
 * `ipc/settings.ts` 此前把 `store` 的回傳值**原樣轉手**給 renderer。那不是一個 bug，是一個
 * **會在日後變成 bug 的形狀**：任何加進偏好物件的欄位 —— 包含機密 —— 都會零改動、零紅燈地
 * 送到 renderer，而 renderer 渲染的是不受信任的內容（使用者 repo 裡的任意 markdown、pty 的輸出）。
 * 這筆債在 `docs/PRD.md` 裡被明確指名「必須在有機密流過之前還掉」。
 *
 * 改成投影是一次修正；**讓它不能被改回去**才是處置。
 *
 * ## 兩個方向，而第二個是實測才發現的
 *
 * 1. **執行期**：`ipc/settings.ts` 裡每一個 `store.*()` 的回傳值都必須被 `projectPreferences()`
 *    包住。**五個處理常式都算** —— 四個 setter 同樣把套用後的偏好回傳給 renderer，
 *    漏掉任一個，那條路就是一個沒有白名單的出口。
 *
 * 2. **型別**：`preload/index.ts` 必須宣告**窄的** `ProjectedPreferences`，不得宣告寬的
 *    `TerminalPreferences`。renderer 的偏好型別是自 preload 回推的（`shell/types.ts` 的
 *    `Awaited<ReturnType<…settings.get>>`），所以 **preload 寫寬了，主行程的白名單就只剩執行期
 *    效果** —— renderer 仍然寫得出讀未送出欄位的程式碼，而它永遠是 `undefined`，
 *    症狀是一個安靜地永遠走 else 分支的判斷。
 *
 *    > 這一條是**對照組抓出來的**：第一版只窄化了主行程，註解裡寫著「renderer 讀未宣告的欄位
 *    > 是編譯錯誤」，而「在 renderer 讀 `agentEvents`」這個對照組**沒有變紅**。
 *    > 沒有那次對照，那句假話會留在註解裡，而下一個人會相信它。
 *
 * **走語法樹而非逐行比對**：本檔案與被守的兩個檔案，其註解都會談到 `TerminalPreferences` 與
 * 原樣轉手，逐行掃描會把它們全部誤判。註解是 trivia，不在語法樹的節點裡，因此自動豁免
 * （比照 `watcher-source.test.mjs` 與 `terminal-resize-source.test.mjs`）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const SETTINGS_IPC = join('src', 'main', 'ipc', 'settings.ts')
const PRELOAD = join('src', 'preload', 'index.ts')

/** 投影的函式名 —— 唯一允許把偏好交給 renderer 的形狀。 */
const PROJECTOR = 'projectPreferences'

/** 持有完整偏好的那個東西在 `ipc/settings.ts` 裡的識別碼。 */
const STORE = 'store'

/** 寬的型別名 —— preload 宣告它即違規。 */
const WIDE_TYPE = 'TerminalPreferences'

/**
 * `ipc/settings.ts`：找出沒有被 `projectPreferences()` 包住的 `store.*()` 回傳值。
 *
 * 判準是**父節點**：`store.get()` 合法的唯一位置是 `projectPreferences(store.get())` 的引數。
 * 不看「有沒有出現 projectPreferences」—— 那種寫法對
 * `projectPreferences(store.get()); return store.get()` 一樣會通過。
 */
export function findUnprojectedStoreReads(source, fileName = 'settings.ts') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found = []
  const at = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === STORE
    ) {
      const parent = node.parent
      const wrapped =
        parent !== undefined &&
        ts.isCallExpression(parent) &&
        ts.isIdentifier(parent.expression) &&
        parent.expression.text === PROJECTOR &&
        parent.arguments.includes(node)
      if (!wrapped) {
        found.push({ line: at(node), kind: 'unprojected-store-read', method: node.expression.name.text })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

/**
 * `preload/index.ts`：找出對**寬**型別的匯入或引用。
 *
 * 連 `import type` 也算違規 —— 這裡要防的**正是**型別層面的放寬（型別匯入在
 * `watcher-source.test.mjs` 是放行的，因為那道守衛防的是「建得出 watcher 的值」；
 * 這道守衛防的是型別本身）。
 */
export function findWideTypeUses(source, fileName = 'index.ts') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found = []
  const at = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1

  const visit = (node) => {
    if (ts.isImportSpecifier(node) && (node.propertyName ?? node.name).text === WIDE_TYPE) {
      found.push({ line: at(node), kind: 'wide-type-import' })
    }
    if (ts.isTypeReferenceNode(node) && node.typeName.getText(sourceFile) === WIDE_TYPE) {
      found.push({ line: at(node), kind: 'wide-type-reference' })
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

test('偏好送往 renderer 的每一條路都經逐欄位投影', () => {
  const source = readFileSync(join(repoRoot, SETTINGS_IPC), 'utf8')
  const offenders = findUnprojectedStoreReads(source, SETTINGS_IPC)

  assert.deepEqual(
    offenders,
    [],
    `${SETTINGS_IPC} 的每一個 store.*() 回傳值都必須被 ${PROJECTOR}() 包住 —— 含四個 setter，\n` +
      '它們同樣把套用後的偏好回傳給 renderer。原樣轉手的話，日後加進偏好的任何欄位\n' +
      '（包含機密）都會零改動、零紅燈地送到 renderer。\n\n' +
      offenders.map((hit) => `${SETTINGS_IPC}:${hit.line}: store.${hit.method}()`).join('\n'),
  )
})

test('preload 宣告窄的投影型別，於是窄化抵達 renderer', () => {
  const source = readFileSync(join(repoRoot, PRELOAD), 'utf8')
  const offenders = findWideTypeUses(source, PRELOAD)

  assert.deepEqual(
    offenders,
    [],
    `${PRELOAD} 不得宣告 ${WIDE_TYPE} —— renderer 的偏好型別是自 preload 回推的，\n` +
      `這裡寫寬了，主行程的逐欄位白名單就只剩執行期效果：renderer 仍然寫得出讀未送出欄位的\n` +
      '程式碼，而它永遠是 undefined。用 ProjectedPreferences。\n\n' +
      offenders.map((hit) => `${PRELOAD}:${hit.line}: ${hit.kind}`).join('\n'),
  )
})

test('對照組：原樣轉手的四種形狀各自被抓到', () => {
  const plainGet = findUnprojectedStoreReads('ipcMain.handle(C.get, () => store.get())')
  assert.equal(plainGet.length, 1, '原樣轉手 store.get() 應被抓到')
  assert.equal(plainGet[0].method, 'get')

  const plainSetter = findUnprojectedStoreReads(
    'ipcMain.handle(C.setAgentStatus, (_e, v) => store.setAgentStatus(v))',
  )
  assert.equal(plainSetter.length, 1, '原樣轉手 setter 的回傳值應被抓到')

  // **一份「有出現 projectPreferences 但也有一條沒包」的來源** —— 這正是「只檢查函式名有沒有
  // 出現」那種寫法會放過的形狀。
  const mixed = findUnprojectedStoreReads(
    [
      'ipcMain.handle(C.get, () => projectPreferences(store.get()))',
      'ipcMain.handle(C.setAgentView, (_e, v) => store.setAgentView(v))',
    ].join('\n'),
  )
  assert.equal(mixed.length, 1, '五個處理常式中漏掉一個應被抓到')
  assert.equal(mixed[0].method, 'setAgentView')

  // 包在別的函式裡不算 —— 那不是投影。
  const wrongWrapper = findUnprojectedStoreReads('ipcMain.handle(C.get, () => structuredClone(store.get()))')
  assert.equal(wrongWrapper.length, 1, '包在別的函式裡應被抓到')
})

test('對照組：preload 放寬型別的兩種形狀各自被抓到', () => {
  const imported = findWideTypeUses(
    "import type { TerminalPreferences } from '../main/preferences-store'",
  )
  assert.equal(imported.length, 1, '匯入寬型別應被抓到')
  assert.equal(imported[0].kind, 'wide-type-import')

  const referenced = findWideTypeUses('const get = (): Promise<TerminalPreferences> => x()')
  assert.equal(referenced.length, 1, '引用寬型別應被抓到')
  assert.equal(referenced[0].kind, 'wide-type-reference')
})

test('對照組：合法的寫法不被誤報', () => {
  const ok = findUnprojectedStoreReads(
    [
      'ipcMain.handle(C.get, () => projectPreferences(store.get()))',
      'ipcMain.handle(C.setTerminalFont, (_e, a, b, c) => projectPreferences(store.setTerminalFont(a, b, c)))',
      // 不碰 store 的處理常式不歸這道守衛管。
      'ipcMain.handle(C.listMonospaceFonts, () => listMonospaceFonts())',
      // 同名方法但接收端不是那個 store。
      'const names = fontStore.get()',
    ].join('\n'),
  )
  assert.deepEqual(ok, [], `合法的投影被誤報：${JSON.stringify(ok)}`)

  const preloadOk = findWideTypeUses(
    [
      "import type { ProjectedPreferences } from '../main/preferences-store'",
      'const get = (): Promise<ProjectedPreferences> => ipcRenderer.invoke(ch)',
    ].join('\n'),
  )
  assert.deepEqual(preloadOk, [], `合法的 preload 宣告被誤報：${JSON.stringify(preloadOk)}`)
})
