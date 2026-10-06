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

const PRELOAD = join('src', 'preload', 'index.ts')

/** 寬的型別名 —— preload 宣告它即違規。 */
const WIDE_TYPE = 'TerminalPreferences'

/**
 * 每一條「設定 → renderer」的路徑各一條規則。
 *
 * `fullObjectMethods` 是**回傳整份設定物件**的那些方法 —— 只有它們需要被投影包住。
 * 回傳純量的（`apiBaseUrl()`、`lookbackDays()`、`usesDefaultEndpoint()`）不在此列：
 * 它們本身就是衍生事實，包住反而說不通。
 *
 * **`storeModule` 是給守衛自己用的**：每一個列在 `fullObjectMethods` 的名字都必須真的存在於
 * 那個模組裡。少了這道檢查，一次方法改名會讓守衛**靜默地不再比對到任何東西** ——
 * 它會全綠，而它守的性質已經沒了。那正是這個 repo 最常見的假綠形狀。
 */
const PROJECTION_RULES = [
  {
    files: [join('src', 'main', 'ipc', 'settings.ts')],
    storeModule: join('src', 'main', 'preferences-store.ts'),
    receiver: 'store',
    projector: 'projectPreferences',
    fullObjectTypes: ['TerminalPreferences'],
    fullObjectMethods: [
      'get',
      'setTerminalFont',
      'setAgentStatus',
            'setAgentView',
      'setGpuAcceleration',
      'setAutoHibernate',
    ],
  },
  {
    // **兩個檔案，而那不是為了周全。** `state()` 的組裝在 `slack-state.ts`，但三個 setter 的
    // IPC 處理常式在 `ipc/slack.ts` —— 只掃前者的話，後者裡一個直接 `return
    // input.settings.setApiBaseUrl(...)` 的實作**不會被任何東西擋下**。目前那三個處理常式
    // 都丟棄回傳值改呼叫 `state()`（因此沒有外洩），但那是實作恰好如此，不是被守著。
    files: [join('src', 'main', 'slack-state.ts'), join('src', 'main', 'ipc', 'slack.ts')],
    storeModule: join('src', 'main', 'slack-settings-store.ts'),
    receiver: 'settings',
    projector: 'projectSlackSettings',
    fullObjectTypes: ['SlackSettings'],
    fullObjectMethods: ['get', 'setLookbackDays', 'setApiBaseUrl'],
  },
]

/**
 * 找出沒有被投影包住的「整份設定」讀取。
 *
 * 判準是**父節點**：合法的唯一位置是投影函式的引數。不看「檔案裡有沒有出現投影函式」——
 * 那種寫法對 `project(store.get()); return store.get()` 一樣會通過。
 */
/** 接收者運算式的最後一段名稱：`store` → `store`、`input.settings` → `settings`。 */
function receiverNameOf(node) {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  return null
}

export function findUnprojectedStoreReads(
  source,
  fileName = 'settings.ts',
  { receiver = 'store', projector = 'projectPreferences', fullObjectMethods = null } = {},
) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found = []
  const at = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      // **接收者比對到最後一段，不要求它是一個裸識別碼。** `ipc/slack.ts` 的持有者是
      // `input.settings` 而非 `settings` —— 只認識別碼的判定對那整個檔案零命中，
      // 而那不是「沒有違規」，是「沒有在看」。（實測：把一個處理常式改成原樣轉手，
      // 守衛照樣全綠。）
      receiverNameOf(node.expression.expression) === receiver &&
      (fullObjectMethods === null || fullObjectMethods.includes(node.expression.name.text))
    ) {
      const parent = node.parent
      const wrapped =
        parent !== undefined &&
        ts.isCallExpression(parent) &&
        ts.isIdentifier(parent.expression) &&
        parent.expression.text === projector &&
        parent.arguments.includes(node)
      // **回傳值被丟棄的呼叫不是違規。** `input.settings.setLookbackDays(days)` 自成一個
      // 陳述式、其後另行 `return state()` —— 沒有任何東西抵達 renderer。少了這個判斷，
      // 守衛會要求呼叫端把一個**根本沒有被使用的值**包進投影裡，那是噪音而不是保護，
      // 而噪音最後會以「把這個檔案從清單裡拿掉」收場。
      const discarded = parent !== undefined && ts.isExpressionStatement(parent)
      if (!wrapped && !discarded) {
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

test('設定送往 renderer 的每一條路都經逐欄位投影', () => {
  for (const rule of PROJECTION_RULES) {
    for (const file of rule.files) {
    const source = readFileSync(join(repoRoot, file), 'utf8')
    const offenders = findUnprojectedStoreReads(source, file, rule)

    assert.deepEqual(
      offenders,
      [],
      `${file} 中每一個回傳整份設定的呼叫都必須被 ${rule.projector}() 包住 ——\n` +
        '含 setter：它們同樣把套用後的設定回傳給 renderer。原樣轉手的話，\n' +
        '日後加進那個物件的任何欄位（包含機密）都會零改動、零紅燈地送到 renderer。\n\n' +
        offenders
          .map((hit) => `${file}:${hit.line}: ${rule.receiver}.${hit.method}()`)
          .join('\n'),
    )
    }
  }
})

test('守衛自己沒有失效：列出的方法都真的存在於 store 模組中', () => {
  // **少了這道檢查，一次方法改名會讓上一條測試靜默地不再比對到任何東西** —— 它會全綠，
  // 而它守的性質已經沒了。這是這個 repo 最常見的假綠形狀（「測試沒有在測它自稱在測的東西」）。
  for (const rule of PROJECTION_RULES) {
    const storeSource = readFileSync(join(repoRoot, rule.storeModule), 'utf8')
    const missing = rule.fullObjectMethods.filter(
      (name) => !new RegExp(`^\\s{2}(?:#)?${name}\\s*\\(`, 'm').test(storeSource),
    )
    assert.deepEqual(
      missing,
      [],
      `${rule.storeModule} 中找不到這些方法：${missing.join('、')}\n` +
        '它們列在這道守衛的 fullObjectMethods 裡。名字對不上時守衛會靜默失效，\n' +
        '所以請更新這份清單（而不是讓它繼續全綠）。',
    )
  }
})

/**
 * store 模組中**每一個回傳整份設定的方法**。
 *
 * 判準：方法的回傳型別就是那份設定的型別（而非純量或 `void`）。以語法樹判定 ——
 * 逐行比對會被註解裡的型別名誤導。
 */
export function findFullObjectMethods(source, typeNames) {
  const file = ts.createSourceFile('store.ts', source, ts.ScriptTarget.Latest, true)
  const found = []

  const visit = (node) => {
    if (ts.isMethodDeclaration(node) && node.type && ts.isIdentifier(node.name)) {
      const returnType = node.type.getText(file).trim()
      if (typeNames.includes(returnType)) found.push(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)

  return found
}

test('守衛的清單是完整的：store 中每一個回傳整份設定的方法都被列出', () => {
  // **這是上一條的反向。** 上一條確保清單裡的名字真的存在；少了這一條，**新增一個
  // setter 而忘了登記**，它就成為一條沒有白名單的出口 —— 而守衛照樣全綠，因為它
  // 只檢查它自己列出來的那幾個。
  //
  // 兩條互補而非重複：一條防改名，一條防遺漏。這個 repo 兩種失效都發生過
  //（`agentStatus` 曾同時漏在讀入與保留兩份清單裡，見 issue #39）。
  for (const rule of PROJECTION_RULES) {
    const storeSource = readFileSync(join(repoRoot, rule.storeModule), 'utf8')
    const actual = findFullObjectMethods(storeSource, rule.fullObjectTypes)
    const unlisted = actual.filter((name) => !rule.fullObjectMethods.includes(name))

    assert.deepEqual(
      unlisted,
      [],
      `${rule.storeModule} 中這些方法回傳整份設定，卻不在守衛的 fullObjectMethods 裡：\n` +
        `${unlisted.join('、')}\n` +
        '未登記的方法不會被檢查 —— 它若原樣轉手，整份設定（含日後加進去的機密）\n' +
        '就會零紅燈地送到 renderer。把它加進清單。',
    )
  }
})

test('對照組：一個未登記的回傳整份設定的方法會被抓到', () => {
  const source = [
    'export class Store {',
    '  get(): TerminalPreferences { return this.value }',
    '  setLanguage(language: string | null): TerminalPreferences { return this.get() }',
    '  lookbackDays(): number { return 30 }',
    '}',
  ].join('\n')

  const found = findFullObjectMethods(source, ['TerminalPreferences'])
  assert.deepEqual(found.sort(), ['get', 'setLanguage'], '回傳純量的方法不該被列入')
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

  // Slack 那條規則的接收端與投影函式都不同名，同樣要抓到。
  const slack = findUnprojectedStoreReads('const s = settings.get()', 'slack.ts', {
    receiver: 'settings',
    projector: 'projectSlackSettings',
    fullObjectMethods: ['get'],
  })
  assert.equal(slack.length, 1, '另一條路徑的原樣轉手應被抓到')
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

  // **回傳純量的方法不必被包住** —— 它們本身就是衍生事實，包住反而說不通。
  const scalars = findUnprojectedStoreReads(
    [
      'const base = settings.apiBaseUrl()',
      'const days = settings.lookbackDays()',
      'const isDefault = settings.usesDefaultEndpoint()',
      'const wrapped = projectSlackSettings(settings.get())',
    ].join('\n'),
    'slack.ts',
    { receiver: 'settings', projector: 'projectSlackSettings', fullObjectMethods: ['get'] },
  )
  assert.deepEqual(scalars, [], `回傳純量的方法被誤報：${JSON.stringify(scalars)}`)

  const preloadOk = findWideTypeUses(
    [
      "import type { ProjectedPreferences } from '../main/preferences-store'",
      'const get = (): Promise<ProjectedPreferences> => ipcRenderer.invoke(ch)',
    ].join('\n'),
  )
  assert.deepEqual(preloadOk, [], `合法的 preload 宣告被誤報：${JSON.stringify(preloadOk)}`)
})

test('對照組：持有者為屬性存取時同樣被抓到', () => {
  // `ipc/slack.ts` 的持有者是 `input.settings`。只認裸識別碼的判定對它零命中 ——
  // 而零命中與「沒有違規」在測試輸出上長得一模一樣。
  const hits = findUnprojectedStoreReads(
    'ipcMain.handle(C.set, () => input.settings.setApiBaseUrl(url))',
    'slack.ts',
    { receiver: 'settings', projector: 'projectSlackSettings', fullObjectMethods: ['setApiBaseUrl'] },
  )
  assert.equal(hits.length, 1, '持有者為 input.settings 時必須照樣被抓到')
})

test('對照組：回傳值被丟棄的呼叫不是違規', () => {
  const discarded = findUnprojectedStoreReads(
    'ipcMain.handle(C.set, () => { input.settings.setApiBaseUrl(url); return state() })',
    'slack.ts',
    { receiver: 'settings', projector: 'projectSlackSettings', fullObjectMethods: ['setApiBaseUrl'] },
  )
  assert.deepEqual(discarded, [], '沒有任何東西抵達 renderer 的呼叫不該被要求投影')
})
