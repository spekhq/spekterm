/**
 * ui-localization：locale 衍生的呈現 SHALL 只有一個來源。
 *
 * ## 證據，不是推測
 *
 * 這個 app 曾經只有一種語言，而在那個前提下長出了三種互不相同的做法：一處硬編了
 * `zh-TW` 的排序規則、一處硬編了 `en-US` 的數字格式、一處沿用執行環境的預設 ——
 * 於是一個宣稱全英文的介面，在一台 `LANG=zh_TW` 的機器上把重置時刻顯示成了當地格式。
 * **三處都沒有任何東西會變紅。** 紀律在沒有守衛時已經失效過了。
 *
 * ## 豁免是規格條款，不是後門
 *
 * 不是每一次 `localeCompare` 都該跟著 UI 語言。**僅為確定性而存在的內部定序**
 *（同分時的 tie-break、兩條列舉路徑的收斂、對識別碼的比較）SHALL NOT 隨語言改變 ——
 * 一個隨語言變動的 tie-break 會讓「同分時的排名」成為環境的函數，而釘住它的測試就變成
 * 在測環境。
 *
 * 因此豁免**逐一具名並各帶理由**，而且以「檔案 ＋ 該行的內容」登記而非行號：
 * 行號會隨無關的編輯漂移，而漂移之後的豁免會靜默地蓋住另一行。
 *
 * **過期的豁免同樣使守衛失敗** —— 一條再也匹配不到東西的豁免，會在下一次有人寫出同樣的
 * 呼叫時變成一張免費通行證。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcRoot = join(repoRoot, 'src')

/** locale 的唯一來源。 */
const HOME = 'src/shared/i18n/locale.ts'

const PATTERNS = [
  /\bnew Intl\./,
  /\.toLocaleString\(/,
  /\.toLocaleDateString\(/,
  /\.toLocaleTimeString\(/,
  /\.localeCompare\(/,
]

/**
 * 與語言無關的內部定序 —— 每一條都帶理由。
 * `snippet` 必須出現在該行中（比對前先去掉前後空白）。
 */
const EXEMPT = [
  {
    file: 'src/renderer/src/shell/quick-open/score.ts',
    snippet: 'a.path.localeCompare(b.path)',
    why: '分數相同時的 tie-break：它決定演算法的確定性，而 score.test.ts 的期望值正是以同一個比較算出來的',
  },
  {
    file: 'src/main/fs-service.ts',
    snippet: 'a.name.localeCompare(b.name)',
    why: '目錄列舉的確定性。使用者看到的順序由 useFileTree 的 collator 決定（renderer 會再排一次）—— 若日後 renderer 不再重排，這條豁免必須重新論證',
  },
  {
    file: 'src/main/fs-service.ts',
    snippet: 'within.sort((a, b) => a.localeCompare(b))',
    why: '兩條列舉路徑的順序不同（git 已排序、readdir 未必），在此收斂以免呼叫端看到不穩定的順序',
  },
  {
    file: 'src/main/insights-aggregate.ts',
    snippet: 'b.n - a.n || a.name.localeCompare(b.name)',
    why: '次數相同時的次要鍵，同樣是確定性而非呈現',
  },
  {
    file: 'src/renderer/src/shell/MainStage.tsx',
    snippet: 'a.id.localeCompare(b.id)',
    why: '比的是 session id，不是給人讀的字串',
  },
]

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.tsx?$/.test(entry.name)) yield full
  }
}

/** 測試檔豁免 —— 它們不呈現任何東西給使用者。 */
function isProductSource(path) {
  return !/\.test\.tsx?$/.test(path) && !/\.testkit\.tsx?$/.test(path)
}

export function scan() {
  const offences = []
  const usedExemptions = new Set()

  for (const absolute of walk(srcRoot)) {
    const path = relative(repoRoot, absolute)
    if (path === HOME || !isProductSource(path)) continue

    readFileSync(absolute, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (!PATTERNS.some((pattern) => pattern.test(line))) return
        const trimmed = line.trim()
        const match = EXEMPT.findIndex((e) => e.file === path && trimmed.includes(e.snippet))
        if (match >= 0) {
          usedExemptions.add(match)
          return
        }
        offences.push(`${path}:${index + 1}  ${trimmed}`)
      })
  }

  const stale = EXEMPT.filter((_, index) => !usedExemptions.has(index)).map(
    (e) => `${e.file} 的豁免再也匹配不到任何一行：${e.snippet}`,
  )

  return { offences, stale }
}

test('locale 只自單一模組取得', () => {
  const { offences } = scan()
  assert.deepEqual(
    offences,
    [],
    `locale 衍生的格式化與排序必須走 ${HOME}；\n` +
      `內部定序（不隨語言改變的）請在本檔的 EXEMPT 中具名並寫下理由。`,
  )
})

test('沒有過期的豁免', () => {
  const { stale } = scan()
  assert.deepEqual(stale, [], '一條匹配不到東西的豁免，會在下一次有人寫出同樣的呼叫時成為免費通行證')
})

test('對照組：把一次呈現用的格式化搬出單一模組即被回報', () => {
  // 以實際的樣態餵進偵測邏輯（不動磁碟）—— 這正是收斂前 StatusBar 的那一行。
  const line = "  const clock = at.toLocaleTimeString(undefined, { hour: '2-digit' })"
  assert.equal(PATTERNS.some((p) => p.test(line)), true)
  // 而它不在豁免清單裡。
  assert.equal(EXEMPT.some((e) => line.trim().includes(e.snippet)), false)
})
