/**
 * public-content-hygiene：公開的 repo 不含維護者宣告為內部的識別字詞與本機家目錄路徑。
 *
 * ## 為什麼清單是雜湊
 *
 * 這支守衛若寫出那些字 —— 不論是字面、還是像 `naming.test.mjs` 那樣以字串拼接 —— 就等於把它們
 * 公開，而那正是它要防的事。所以清單只存 SHA-256。**這不是密碼學上的保密**：短字詞的雜湊猜得
 * 出來。它要做到的是「repo 不主動寫出這些名字」，不是「沒有人能知道」。
 *
 * 清單的明文不在 repo 裡；新增一個字詞時，在 repo 外算好它的雜湊再貼進來
 * （`printf '%s' <字詞> | sha256sum`，字詞一律小寫）。
 *
 * ## 為什麼不排除 archive
 *
 * 公開之前整個歷史已經改寫過，archive 裡不會再有命中。一個排除 archive 的守衛，會讓下一份
 * dogfood 紀錄在封存時把名字帶回來 —— 維護者每天都在會自然寫出那些名字的環境裡工作。
 *
 * ## 刻意不列的字
 *
 * 常見的名與姓（例如同事名字裡的姓氏）不列 —— 它們在一個開源專案的貢獻者名單裡完全可能正當地
 * 出現，列了會誤擋。內部系統所用的**公開產品名**也不列，它不是識別資訊。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 維護者宣告為內部的識別字詞（小寫）的 SHA-256。 */
const INTERNAL_WORDS = new Set([
  '83d9c871c274f06f8d411f8f0f4e10a07aac1d58681ed580eaba39cc78f6adf3',
  '722155eed857ad7160a28c4059277baadb9b2f49e981bee3e8f06267df70f071',
  'ee4e30e780bcc5fffa26e4aeb171857015b059da591faa3f8e271dcd65400f04',
])

/** 對照組：產品名。它一定出現在 repo 裡 —— 比不到它，就是切詞或雜湊流程壞了。 */
const KNOWN_PUBLIC_WORD = '3b2b56084f042d3c2911f846265b790a5559e43924330ed2af082d17c8fb9501'

/** 維護者的家目錄。使用者名稱本身是公開的 GitHub 帳號（`LICENSE`、`FUNDING.yml`），不在禁止之列。 */
const MAINTAINER_HOME = ['', 'home', 'kewang'].join('/')

const sha256 = (word) => createHash('sha256').update(word).digest('hex')

/** 檢查範圍：追蹤的檔案 ＋ 未追蹤但未被 `.gitignore` 忽略的檔案，不排除任何路徑。 */
function filesInScope() {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  return [...new Set(out.split('\0').filter(Boolean))]
}

/**
 * 可讀的文字內容；二進位檔（圖片）回 `null`。判準是前 8KB 有沒有 NUL —— 文字檔裡的 NUL
 * 已由 `nul-byte-source.test.mjs` 擋住，所以這裡不會因此漏看文字檔。
 */
function textOf(file) {
  let bytes
  try {
    bytes = readFileSync(join(repoRoot, file))
  } catch {
    return null // 已被刪除但仍在 index 裡的檔案
  }
  if (bytes.subarray(0, 8192).includes(0)) return null
  return bytes.toString('utf8')
}

/** 依非英數字元切詞、轉小寫。`Some-Name_URL` → `some`、`name`、`url`。 */
function wordsOf(text) {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

const files = filesInScope()

test('檢查範圍涵蓋 archive 與未追蹤的檔案', () => {
  assert.ok(files.some((file) => file.startsWith('openspec/changes/archive/')), '範圍裡沒有 archive')
  assert.ok(files.length > 100, `範圍只有 ${files.length} 個檔案 —— git ls-files 的呼叫方式可能壞了`)
})

test('清單只以固定長度的雜湊值出現', () => {
  for (const hash of [...INTERNAL_WORDS, KNOWN_PUBLIC_WORD]) assert.match(hash, /^[0-9a-f]{64}$/)
})

test('對照組：一個已知存在的公開字詞比對得到 —— 切詞與雜湊流程確實有效', () => {
  const found = files.some((file) => {
    const text = textOf(file)
    return text !== null && wordsOf(text).some((word) => sha256(word) === KNOWN_PUBLIC_WORD)
  })
  assert.ok(found, '整個 repo 裡比對不到產品名 —— 切詞或雜湊流程壞了，下一條測試的「零命中」沒有意義')
})

test('repo 不含維護者宣告為內部的識別字詞', () => {
  const hits = []
  for (const file of files) {
    const text = textOf(file)
    if (text === null) continue
    const seen = new Set()
    for (const word of wordsOf(text)) {
      if (seen.has(word)) continue
      seen.add(word)
      // 不印出字詞本身 —— 測試輸出也可能被貼到公開的地方。
      if (INTERNAL_WORDS.has(sha256(word))) hits.push(`${file}（${sha256(word).slice(0, 12)}…）`)
    }
  }
  assert.deepEqual(hits, [], `內部識別字詞出現在：\n${hits.join('\n')}`)
})

test('repo 不含維護者的本機家目錄路徑', () => {
  const hits = files.filter((file) => textOf(file)?.includes(MAINTAINER_HOME))
  assert.deepEqual(hits, [], `家目錄路徑出現在：${hits.join(', ')}`)
})
