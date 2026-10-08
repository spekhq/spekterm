/**
 * project-license：第三方授權彙總的純邏輯。
 *
 * 產物裡有兩種第三方程式碼，**來源不同，所以清單的取法也不同**：
 *
 * 1. **被打進 bundle 的**（renderer 幾乎全部、main／preload 裡未被 externalize 的）——
 *    devDependencies 裡哪些真的被打進去，只有 bundler 知道。所以清單取自建置工具自己的
 *    模組清單（`this.getModuleIds()`），不從依賴宣告去推。
 * 2. **原樣出貨的依賴**（electron-builder 帶進 asar 的 `node_modules`）—— 取自 lock 裡非 `dev`
 *    的項目。
 *
 * 這裡只有純函式與讀檔；接線在 `electron.vite.config.ts`（收集）與
 * `scripts/third-party-licenses.mjs`（合併、輸出）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const NODE_MODULES = '/node_modules/'

/**
 * 一個模組 id 屬於哪個套件：回傳該套件根目錄（絕對路徑），不在 `node_modules` 之下則回 `null`。
 *
 * - **取最後一個 `node_modules/`** —— 巢狀依賴（`a/node_modules/b/...`）屬於 `b`，不屬於 `a`。
 * - **scoped 套件多一段**（`@scope/name`）。
 * - rollup 的虛擬模組以 `\0` 開頭（`\0vite/preload-helper`），它們不是 `node_modules` 裡的套件。
 * - vite 會在 id 後面接查詢字串（`?commonjs-proxy`、`?inline`），先去掉。
 */
export function packageRootOf(moduleId) {
  if (typeof moduleId !== 'string' || moduleId.startsWith('\0')) return null
  const id = moduleId.split('?')[0].replaceAll('\\', '/')
  const at = id.lastIndexOf(NODE_MODULES)
  if (at === -1) return null
  const rest = id.slice(at + NODE_MODULES.length).split('/')
  const depth = rest[0]?.startsWith('@') ? 2 : 1
  if (rest.length <= depth || rest.slice(0, depth).some((part) => part === '')) return null
  return id.slice(0, at + NODE_MODULES.length) + rest.slice(0, depth).join('/')
}

/**
 * 原始檔裡標明授權的保留註解（`/*! ... *\/`，或含 `@license`／`@preserve` 的區塊註解）。
 *
 * **打包時這些註解會被剝掉**（實測 renderer 產物裡一個 `@license` 都不剩），而有些程式碼只在
 * 這裡宣告授權 —— 被其他套件**內嵌**的第三方原始碼（例如 `monaco-editor` 樹裡的 DOMPurify）
 * 在 `node_modules` 裡不是獨立套件，套件層級的授權檔與聲明檔都不一定提到它。
 */
export function legalCommentsOf(source) {
  const found = []
  for (const match of source.matchAll(/\/\*[\s\S]*?\*\//g)) {
    const block = match[0]
    if (block.startsWith('/*!') || /@(license|preserve)\b/.test(block)) found.push(block.trim())
  }
  return found
}

/** 一組模組 id → 去重、排序後的套件根目錄。 */
export function packageRootsOf(moduleIds) {
  const roots = new Set()
  for (const id of moduleIds) {
    const root = packageRootOf(id)
    if (root) roots.add(root)
  }
  return [...roots].sort()
}

/**
 * lock 裡原樣出貨的套件根目錄（相對於 repo 根目錄）。
 *
 * `dev: true` 的不出貨；`devOptional` 的語意是「dev 或 optional 其中之一」—— 它可能出貨，
 * 所以保留（多列一個套件的代價是彙總長一點，漏列的代價是違反它的授權）。
 */
export function productionPackagesOf(lock) {
  return Object.entries(lock.packages ?? {})
    .filter(([key, entry]) => key.startsWith('node_modules/') && !entry.dev && !entry.link)
    .map(([key]) => key)
    .sort()
}

/**
 * 要帶進彙總的檔案：授權本文，以及套件自己附的第三方聲明。
 *
 * 後者不是裝飾 —— `monaco-editor` 把 DOMPurify 等套件的原始碼**直接內嵌**在自己的樹裡，
 * 它們在 `node_modules` 裡不是獨立的套件，模組清單看不到它們；它們的授權只寫在
 * `ThirdPartyNotices.txt`。少了這一份，那些內嵌套件的聲明就不在產物裡。
 */
const LICENSE_FILE = /^(licen[cs]e|copying|notice|third[-_ ]?party[-_ ]?notices)(\.|-|$)/i

/** 一個套件根目錄 → 彙總條目。 */
export function licenseEntryOf(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const files = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && LICENSE_FILE.test(entry.name))
        .map((entry) => entry.name)
        .sort()
    : []
  return {
    name: pkg.name,
    version: pkg.version,
    license: declaredLicense(pkg),
    texts: files.map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8').trimEnd() })),
  }
}

/** `license` 是現行寫法；`licenses` 陣列是舊寫法，仍有套件在用。 */
function declaredLicense(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type
  if (Array.isArray(pkg.licenses)) {
    const types = pkg.licenses.map((item) => (typeof item === 'string' ? item : item?.type)).filter(Boolean)
    if (types.length > 0) return types.join(' OR ')
  }
  return 'UNKNOWN'
}

/** 同名同版的條目只留一份（同一個套件可能同時被打進 bundle 又原樣出貨）。 */
export function dedupeEntries(entries) {
  const byKey = new Map()
  for (const entry of entries) byKey.set(`${entry.name}@${entry.version}`, entry)
  return [...byKey.values()].sort((a, b) =>
    a.name === b.name ? (a.version < b.version ? -1 : 1) : a.name < b.name ? -1 : 1,
  )
}

/** 保留註解依內容去重：同一段聲明出現在一個套件的上百個檔案裡是常態。 */
export function dedupeNotices(notices) {
  const byText = new Map()
  for (const notice of notices) {
    const sources = byText.get(notice.comment) ?? new Set()
    sources.add(notice.source)
    byText.set(notice.comment, sources)
  }
  return [...byText.entries()]
    .map(([comment, sources]) => ({ comment, sources: [...sources].sort() }))
    .sort((a, b) => (a.sources[0] < b.sources[0] ? -1 : a.sources[0] > b.sources[0] ? 1 : 0))
}

const RULE = '='.repeat(72)
const THIN = '-'.repeat(72)

/** `heading` names what the list is for; the desktop artifact keeps the default. */
export function renderSummary(entries, notices = [], heading = 'Third-party software included in Spekterm') {
  const head = [
    heading,
    '',
    `This file lists every third-party package bundled into or shipped with this build (${entries.length} packages),`,
    'together with its license. It is generated at build time.',
    '',
  ]
  const body = entries.flatMap((entry) => [
    RULE,
    `${entry.name}@${entry.version}`,
    `License: ${entry.license}`,
    THIN,
    ...(entry.texts.length > 0
      ? entry.texts.flatMap(({ file, text }, index) => [...(index > 0 ? ['', `(${file})`] : []), text])
      : [`(This package does not include a license file; its package.json declares: ${entry.license})`]),
    '',
  ])
  const tail =
    notices.length === 0
      ? []
      : [
          RULE,
          'Notices embedded in bundled source files',
          '',
          'Some bundled files carry their own license notices (for example, third-party code vendored inside',
          'another package). Bundling removes those comments from the shipped code, so they are reproduced here.',
          THIN,
          ...notices.flatMap(({ comment, sources }) => [`From: ${sources.join(', ')}`, comment, '']),
        ]
  return [...head, ...body, ...tail].join('\n')
}
