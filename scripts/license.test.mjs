/**
 * project-license：專案以 MIT 開源，且這個宣告在版控的每一處都一致成立。
 *
 * 形狀照 `naming.test.mjs`（版控中不得殘留舊產品名），外加四個講究 —— 每一個都對應一種
 * 「看起來有在檢查，其實沒有」的失效：
 *
 * 1. **禁字以字串組合構造，不寫字面。** 否則這支測試會搜到自己，得替自己開例外 —— 那是一個
 *    永久的後門。
 * 2. **禁字清單與排除清單都從規則定義處（規格檔）解析出來，再與這裡的比對。** 兩份清單各寫一份
 *    的話會各自漂移；而「多加一條排除」是讓紅燈消失最自然的修法 —— 規格沒有同意的排除，
 *    這裡就紅。
 * 3. **逐字對照。** 每一個禁字都必須在規則定義處被搜到 —— 一個拼錯的禁字永遠零命中，而零命中
 *    正是「通過」的樣子。只靠 archive 當對照組不夠：archive 裡只出現部分禁字。
 * 4. **範圍含未追蹤、未被忽略的檔案**（`--untracked`）。還沒加進版控的新文件，正是最容易把
 *    舊說法寫回來的地方；這也讓規格檔在 `git add` 之前就被看得到。
 *
 * 英文禁字不分大小寫（`-i`）：同一句保留權利聲明，首字大寫與全大寫是同一句話。
 * （這支守衛抓到的第一個違規，就是這一行註解原本舉的兩個大小寫例子。）
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(repoRoot, file), 'utf8')

const ARCHIVE = 'openspec/changes/archive'
const CHANGE_DIR = 'openspec/changes/open-source-mit'
const MAIN_SPEC = 'openspec/specs/project-license/spec.md'
const CHANGE_SPEC = `${CHANGE_DIR}/specs/project-license/spec.md`

/** 規則定義處：封存前在 change 目錄裡，封存後是 main spec。 */
const RULE_DEFINITION = existsSync(join(repoRoot, MAIN_SPEC)) ? MAIN_SPEC : CHANGE_SPEC

/** 排除恰為規格宣告的三處（見「排除恰為宣告的三處」）。 */
const EXCLUDED = [ARCHIVE, CHANGE_DIR, MAIN_SPEC]

// 以組合構造，使本檔案不含這些字面 —— 見上方說明 1。
const FORBIDDEN = [
  ['All', 'rights', 'reserved'].join(' '),
  ['propri', 'etary'].join(''),
  ['closed', 'source'].join(' '),
  ['closed', 'source'].join('-'),
  ['UN', 'LICENSED'].join(''),
  ['專有', '授權'].join(''),
  ['保留', '所有權利'].join(''),
  ['非', '開源'].join(''),
  ['私有', 'repo'].join(' '),
  ['商業', '版'].join(''),
]

/**
 * 含有 `needle` 的檔案（不分大小寫、字面比對）。`git grep` 零命中時以 exit code 1 結束 ——
 * 那是「沒有」，不是錯誤；其餘結束碼照拋，否則本測試會在不是 git repo 時靜默通過。
 *
 * `-c color.grep=never` 不可省：這台機器設了 `color.ui = always`，git 輸出到 pipe 也會上色，
 * 回傳的檔名就帶著 ANSI 逸出碼。
 */
function filesContaining(needle, pathspec) {
  try {
    const out = execFileSync(
      'git',
      ['-c', 'color.grep=never', 'grep', '--untracked', '-i', '--fixed-strings', '--files-with-matches', needle, '--', ...pathspec],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    return out.split('\n').filter(Boolean)
  } catch (error) {
    if (error.status === 1) return []
    throw error
  }
}

/** 規格裡某一段（從 `start` 到 `end` 之前）出現的所有 `` `...` ``。 */
function backticksBetween(text, start, end) {
  const from = text.indexOf(start)
  const to = text.indexOf(end, from)
  assert.ok(from !== -1 && to !== -1, `規則定義處 ${RULE_DEFINITION} 找不到「${start}」到「${end}」這一段`)
  return [...text.slice(from, to).matchAll(/`([^`]+)`/g)].map((match) => match[1])
}

test('禁字清單與規則定義處列出的相同', () => {
  const declared = backticksBetween(read(RULE_DEFINITION), '禁字清單如下', '檢查的範圍')
  assert.deepEqual([...FORBIDDEN].sort(), [...declared].sort())
})

test('排除恰為規則定義處宣告的三處，不多不少', () => {
  const declared = backticksBetween(read(RULE_DEFINITION), '排除 SHALL 恰為以下三處', '`CLAUDE.md`')
    .map((path) => path.replace(/\/\*\*$/, ''))
  assert.deepEqual([...EXCLUDED].sort(), [...declared].sort())
})

test('對照組：每一個禁字都搜得到規則定義處 —— 每一個禁字的搜尋都確實有效', () => {
  for (const needle of FORBIDDEN) {
    assert.deepEqual(filesContaining(needle, [RULE_DEFINITION]), [RULE_DEFINITION], `「${needle}」搜不到規則定義處`)
  }
})

test('對照組：archive 裡仍有命中 —— 歷史紀錄未被改寫', () => {
  const hits = FORBIDDEN.flatMap((needle) => filesContaining(needle, ['.']))
  assert.ok(
    hits.some((file) => file.startsWith(`${ARCHIVE}/`)),
    'archive 裡搜不到任何一個禁字。若非搜尋本身失效，就是 archive 被改寫了 —— 它記載的是當時的授權。',
  )
})

test('版控中不殘留限制性授權的宣告（排除宣告的三處）', () => {
  const pathspec = ['.', ...EXCLUDED.map((path) => `:!${path}`)]
  for (const needle of FORBIDDEN) {
    const hits = filesContaining(needle, pathspec)
    assert.deepEqual(hits, [], `「${needle}」出現在：${hits.join(', ')}`)
  }
})

test('根目錄有 MIT 授權全文，著作權人為 Kewang', () => {
  const text = read('LICENSE')
  assert.match(text, /^MIT License\n/)
  assert.match(text, /^Copyright \(c\) \d{4} Kewang$/m)
  assert.match(text, /Permission is hereby granted, free of charge, to any person obtaining a copy/)
  assert.match(text, /THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND/)
})

test('package.json 宣告 MIT，且仍不發佈到 npm', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.license, 'MIT')
  assert.equal(pkg.private, true)
})

test('README 的授權段落寫明 MIT 並指向 LICENSE', () => {
  const readme = read('README.md')
  const at = readme.indexOf('\n## License\n')
  assert.ok(at !== -1, 'README 沒有 License 段落')
  const section = readme.slice(at, readme.indexOf('\n## ', at + 1) === -1 ? undefined : readme.indexOf('\n## ', at + 1))
  assert.match(section, /MIT/)
  assert.match(section, /\(\.\/LICENSE\)/)
})

test('貢獻說明寫明貢獻依 MIT 提供、贊助歸維護者且不依貢獻分配', () => {
  const text = read('CONTRIBUTING.md')
  assert.match(text, /contributions will be licensed under the\s+\[MIT License\]\(LICENSE\)/)
  assert.match(text, /supports the\s+\*\*maintainer personally\*\*/)
  assert.match(text, /\*\*not distributed\s+based on contributions\*\*/)
})

test('sponsor links appear only together with FUNDING.yml', () => {
  // Until the maintainer's GitHub Sponsors profile exists, there is no FUNDING.yml and no sponsor link:
  // a button that leads to a missing page is worse than none. Once it exists, both must name the same account.
  const funding = existsSync(join(repoRoot, '.github/FUNDING.yml')) ? read('.github/FUNDING.yml') : null
  const account = funding?.match(/^github:\s*\[\s*([\w-]+)\s*\]\s*$/m)?.[1] ?? null
  if (funding !== null) assert.equal(account, 'kewang', 'FUNDING.yml must name the maintainer account')
  for (const file of ['README.md', 'README.zh-TW.md']) {
    const linked = [...read(file).matchAll(/github\.com\/sponsors\/([\w-]+)/g)].map((match) => match[1])
    if (account === null) assert.deepEqual(linked, [], `${file} links to a sponsors page but there is no FUNDING.yml`)
    else assert.ok(linked.every((name) => name === account), `${file} links to a different sponsors account`)
  }
})
