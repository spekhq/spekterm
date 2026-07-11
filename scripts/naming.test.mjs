/**
 * app-identity：版控內容不得殘留舊產品名。
 *
 * 正名是散落式的改動 —— 漏掉的角落通常要到半年後才被發現。這支測試把「沒漏」變成
 * 可執行的斷言。
 *
 * 兩個實作上的講究：
 *
 * 1. **舊名以字串組合構造，不寫字面。** 否則 `git grep` 會搜到這個測試檔自己，於是得靠
 *    「排除測試檔」來繞過 —— 那等於在檢查裡開一個永久後門。組合之後檔案裡根本沒有那些
 *    字面，測試因此不需要為自己開例外。
 *
 * 2. **對照組不是裝飾。** 一支永遠綠的測試等於沒有測試：若 `git grep` 的呼叫方式寫錯
 *    （pathspec 打錯、cwd 不對），它會靜默地永遠回傳零命中，而正面斷言會全綠。對照組要求
 *    「**不排除** archive 時必須命中舊名」—— archive 是歷史紀錄，它記載的是「當時這個專案
 *    叫什麼」，那些舊名本來就該留著。因此這條對照組同時證明了兩件事：搜尋確實有效，
 *    **且 archive 沒有被這次正名竄改**。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const ARCHIVE = 'openspec/changes/archive'

/**
 * 這條規則的**定義處**必須被排除 —— 它不可能不寫出舊名的字面：一份說「不得含有 X」的規格，
 * 本身就得寫出 X。這是自我指涉，不是後門。
 *
 * 排除的只有規格檔本身；CLAUDE.md、README、產品程式碼**一律不排除**，它們漏改的代價太高。
 * 那些文件若要談論正名的歷史，就得繞開舊名的字面（正名後的 CLAUDE.md 正是這樣寫的）。
 */
const RULE_DEFINITION = 'openspec/specs/app-identity/spec.md'

// 以組合構造，使本檔案不含這些字面 —— 見上方說明 1。
const OLD_PRODUCT_NAME = ['spek', 'workspace'].join(' ')
// 舊的 repo／目錄名：與上面只差一個分隔字元，卻是獨立的一條 —— 搜帶空格的那個搜不到它，
// 而它確實殘留在一份 main spec 裡（實測抓到，且是 repo 目錄改名後才浮現的）。
const OLD_REPO_NAME = ['spek', 'workspace'].join('-')
const OLD_PACKAGE_NAME = ['@spek', 'workspace'].join('/')
const OLD_SCAN_ENV = ['SPEK', 'SCAN', 'PATH'].join('_')
const OLD_PROFILE_NAMES = [
  ['spek', 'files', 'profile'].join('-'),
  ['spek', 'openspec', 'profile'].join('-'),
  ['spek', 'term', 'profile'].join('-'),
  ['spek', 'probe', 'shell'].join('-'),
]

const FORBIDDEN = [
  OLD_PRODUCT_NAME,
  OLD_REPO_NAME,
  OLD_PACKAGE_NAME,
  OLD_SCAN_ENV,
  ...OLD_PROFILE_NAMES,
]

/**
 * 版控中含有 `needle` 的檔案。`git grep` 找不到時以 exit code 1 結束 —— 那是「零命中」，
 * 不是錯誤。其餘結束碼照拋（例如不在 git repo 裡），否則本測試會靜默地永遠通過。
 *
 * `-c color.grep=never` 不可省：使用者若設了 `color.ui = always`，git **即使輸出到 pipe
 * 也會上色**，於是回傳的檔名帶著 ANSI 逸出碼，任何 `startsWith` 之類的路徑比對都會靜默失準。
 */
function trackedFilesContaining(needle, { includeArchive }) {
  const pathspec = includeArchive ? [] : ['--', '.', `:!${ARCHIVE}`, `:!${RULE_DEFINITION}`]
  try {
    const out = execFileSync(
      'git',
      ['-c', 'color.grep=never', 'grep', '--files-with-matches', '--fixed-strings', needle, ...pathspec],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    return out.split('\n').filter(Boolean)
  } catch (error) {
    if (error.status === 1) return []
    throw error
  }
}

test('對照組：archive 中仍留有舊名 —— 搜尋確實有效，且歷史紀錄未被竄改', () => {
  for (const needle of [OLD_PRODUCT_NAME, OLD_PACKAGE_NAME, OLD_SCAN_ENV]) {
    const hits = trackedFilesContaining(needle, { includeArchive: true })
    assert.ok(
      hits.some((file) => file.startsWith(ARCHIVE)),
      `archive 中找不到「${needle}」。若非搜尋本身失效，就是 archive 被這次正名改動了 —— ` +
        `它是歷史紀錄，記載的是當時的事實，不該跟著改名。`,
    )
  }
})

test('版控內容不得殘留舊識別字串（archive 除外）', () => {
  for (const needle of FORBIDDEN) {
    const hits = trackedFilesContaining(needle, { includeArchive: false })
    assert.deepEqual(hits, [], `「${needle}」仍殘留於：${hits.join(', ')}`)
  }
})

test('probe 的 user-data-dir profile 名一律以 spekterm- 為前綴', () => {
  // 這些 profile 名是收屍手法（pkill -9 -f <profile>）賴以連根拔除殭屍行程樹的識別字：
  // 每個子行程的 argv 都帶著它。名字對不上，殭屍就殺不掉，而它們還佔著 debugging port。
  const scriptsDir = join(repoRoot, 'scripts')
  const probes = readdirSync(scriptsDir).filter((f) => f.startsWith('probe-') && f.endsWith('.mjs'))
  assert.ok(probes.length > 0, '找不到任何 probe 腳本 —— 這支測試的前提失效了')

  for (const file of probes) {
    const source = readFileSync(join(scriptsDir, file), 'utf8')
    // 抓 mkTemp('...') / mkdtempSync(join(tmpdir(), '...')) 的暫存目錄前綴
    for (const match of source.matchAll(
      /mkTemp\(\s*'([^']+)'|mkdtempSync\(join\(tmpdir\(\),\s*'([^']+)'/g,
    )) {
      const value = match[1] ?? match[2]
      if (!value) continue
      assert.ok(
        value.startsWith('spekterm-'),
        `${file} 的暫存 profile 前綴為「${value}」，未以 spekterm- 開頭`,
      )
    }
  }
})
