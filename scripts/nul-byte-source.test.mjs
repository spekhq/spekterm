/**
 * 版控中的原始碼不得含**字面的 NUL 位元組**。
 *
 * ## 為什麼需要守衛，而不是一條紀律
 *
 * 一個字面 NUL 會讓 `grep`、`git grep`、`git diff` 對**整個檔案**瞎掉 —— 而失效方式是最壞的
 * 那一種：`grep` 回空 + exit 1，**連「binary file」都不說**。於是
 *
 * - 讀不到那個檔案的 diff；
 * - 而且「把某個符號 grep 一遍」這種**清查技術**在它上面有一個沒人發現的盲點。
 *   後者是實際的代價，不是理論上的：`global-session` 的 design 倚賴「把 `folderId ===`
 *   grep 一遍」來清查每一個歸屬比較點，而其中一個檔案的 5 處命中**結構性地不在結果裡**。
 *
 * **這個 repo 已經修過四個檔案**（`data.tsx`、`side-panel/SidePanel.tsx`、
 * `files/dirty-buffers.tsx`、`intake-store.ts`），而 CLAUDE.md 自己也曾在警告這件事的那一段裡
 * 寫出一個真的 NUL。四次之後仍然沒有任何東西在守 —— 而「記得要小心」顯然不是機制。
 *
 * ## 分隔符選 NUL 是對的，錯的只是寫法
 *
 * 拿 NUL 當 cache key 的分隔符是正確的選擇（它不可能出現在識別碼或路徑裡）。要寫的是
 * **escape 序列** `\\x00`，語意完全等價，而 grep 看得見。這道守衛因此不禁止那個用途，
 * 只禁止那個寫法。
 *
 * ## 為什麼不用 grep 來查
 *
 * **不能用 grep 查 grep 看不到的東西。** 本檔案讀原始位元組（`readFileSync` 不經任何文字工具），
 * 與 `watcher-source` / `terminal-resize-source` 走語法樹同一條理由：檢查的手段不能與
 * 被檢查的缺陷共享盲點。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 掃描的根目錄。產品原始碼、驗收腳本、共用字典全部涵蓋。The website's sources too (`site`). */
const ROOTS = ['src', 'scripts', 'docs', 'openspec', 'site']

/** 只看文字檔 —— 二進位資產（圖示之類）本來就含 NUL。 */
const TEXT_FILE = /\.(ts|tsx|mjs|js|json|md|mdx|astro|css|html|yaml|yml)$/

/** Generated or installed trees under the roots — not sources, and `site/node_modules` is large. */
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.astro'])

function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) yield* walk(full)
    }
    else if (entry.isFile()) yield full
  }
}

/** 找出一份位元組內容裡每一個 NUL 所在的行號。 */
export function findNulBytes(bytes) {
  const found = []
  let line = 1
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]
    if (byte === 0x0a) line += 1
    else if (byte === 0x00) found.push(line)
  }
  return found
}

test('版控中的文字檔不含字面的 NUL 位元組', () => {
  const offenders = []

  for (const root of ROOTS) {
    for (const path of walk(join(repoRoot, root))) {
      if (!TEXT_FILE.test(path)) continue
      // **讀原始位元組** —— 不能用 grep 查 grep 看不到的東西。
      const lines = findNulBytes(readFileSync(path))
      for (const line of lines) offenders.push(`${relative(repoRoot, path)}:${line}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    '一個字面的 NUL 會讓 grep / git grep / git diff 對整個檔案瞎掉，而它回空 + exit 1，\n' +
      '連「binary file」都不說 —— 於是「把某個符號 grep 一遍」這種清查技術在那個檔案上\n' +
      '有一個沒人發現的盲點（實際發生過：5 處命中結構性地不在結果裡）。\n' +
      '拿 NUL 當分隔符是對的，把它寫成 \\x00 即可 —— 語意等價，而 grep 看得見。\n\n' +
      offenders.join('\n'),
  )
})

test('對照組：NUL 位元組被抓到，escape 序列與一般內容不被誤報', () => {
  // **本檔案自己不能含字面 NUL**（那會讓上一條測試在這個檔案上變紅），因此以
  // `String.fromCharCode(0)` 造出那個位元組。
  //
  // 這一次的經驗值得記下：**我在寫這道守衛的時候，往它裡面寫進了兩個字面 NUL** ——
  // 而抓到它的正是守衛自己。CLAUDE.md 早就寫著「寫『不要寫字面 NUL』的時候特別容易寫出一個」，
  // 這是那句話的元層級實例。
  const NUL = String.fromCharCode(0)

  const literal = findNulBytes(Buffer.from(`const sep = a${NUL}b\n`, 'utf8'))
  assert.deepEqual(literal, [1], 'NUL 位元組應被抓到')

  // 多行時要報對行號。
  const multiline = findNulBytes(Buffer.from(`line1\nline2${NUL}\nline3${NUL}\n`, 'utf8'))
  assert.deepEqual(multiline, [2, 3], '行號應正確')

  // **原始碼中的 escape 序列**（在檔案裡是四個 ASCII 字元）不含 NUL，不該被誤報 ——
  // 那正是被守的用途應該有的寫法：語意等價，而 grep 看得見。
  const escaped = findNulBytes(Buffer.from(String.raw`const sep = a\x00b` + '\n', 'utf8'))
  assert.deepEqual(escaped, [], 'escape 序列不該被誤報')

  // 一般內容（含非 ASCII）不受影響。
  const normal = findNulBytes(Buffer.from('註解與程式碼混排，沒有 NUL。\n', 'utf8'))
  assert.deepEqual(normal, [], '一般內容不該被誤報')
})
