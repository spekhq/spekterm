/**
 * 探針的段落執行器 —— 逐段隔離、依賴宣告、段落篩選。
 *
 * ## 為什麼要有這一層
 *
 * `run-probes.mjs` 的檔頭寫著「付了十幾分鐘就該拿到完整的一張圖，而不是第一支紅了就停」。
 * **那條紀律此前只存在於探針之間，沒有落到探針之內** —— 一支探針的第一個例外就讓其後所有段落
 * 的狀態變成未知。實測的代價：`probe:terminal` 的 dev 段耗時 771 秒，而它**只跑了 10 個段落
 * 中的 1 個**就 throw；其餘 9 段一次都沒執行過，而沒有任何輸出說明這件事。
 *
 * 更糟的是它會污染以耗時為基礎的判斷：那 771 秒曾被當成「21 次 launch 的總和」用來推導最佳化
 * 方案，而真相是它幾乎全部由**一次** launch 花掉。**一個方便取得、看起來相關的量，不等於規格
 * 真正在乎的那個量。**
 *
 * ## 三種段落狀態，缺一不可
 *
 * - **通過**／**失敗** —— 一般情形。
 * - **未執行（前置失敗）** —— 這一種是本模組能不能用的關鍵，不是加分項。共用累積狀態的探針
 *   （`probe:openspec` 全程只有一次 `launch()`）少了它，前段一失敗就會連鎖出一整片指向同一個
 *   根因的紅燈。**一片紅燈與一次中斷同樣無法閱讀**，只是換了一種形式。
 *
 * ## 隔離不是容忍
 *
 * 被捕捉的例外一律完整輸出訊息與呼叫堆疊，且該段落計為失敗、影響最終結束碼。一個被捕捉之後
 * 只留下一行「某段失敗」的例外，比中斷更糟 —— 中斷至少會把堆疊印在終端上。
 */

import { writeFileSync } from 'node:fs'
import { beginSection, sectionSummary } from './instrument.mjs'

/**
 * 段落的預設時限。
 *
 * **為什麼需要時限：`try`／`catch` 只擋得住 throw，擋不住 hang。** 一個永遠不 resolve 的 Promise
 * 不會拋任何東西，於是整支探針無限期掛著 —— **比中斷更糟**（中斷至少會結束、會印堆疊）。
 * 實測：`runRestore` 的 dev 段在 `app.quitGracefully()` 卡住 1 小時 30 分，`test:e2e` 永遠不會結束。
 *
 * 這一族的失效在本 repo 早有記載（`docs/lessons/probes.md`：對已 `close()` 的 CDP client 呼叫
 * `evaluate` 會無限等待，不拋錯、不逾時，**症狀看起來像「Electron 啟動很慢」**）。
 *
 * 預設值訂得寬鬆：時限是**癱瘓的防線，不是效能的閘門**。段落真的變慢時該讓它跑完並在耗時輸出裡
 * 現形，而不是被一個緊繃的數字誤殺 —— 誤殺的代價是一條看起來像產品缺陷的紅燈。
 */
const DEFAULT_SECTION_TIMEOUT_MS = 8 * 60 * 1000

class SectionTimeout extends Error {
  constructor(label, limitMs) {
    super(`段落逾時：${label}（超過 ${limitMs / 1000} 秒）`)
    this.name = 'SectionTimeout'
    this.limitMs = limitMs
  }
}

/**
 * 給一個非同步工作套上時限。
 *
 * **逾時之後不去中止那個工作** —— JS 沒有辦法中止一個執行中的 Promise。它會繼續在背景跑，
 * 因此段落必須另外提供 `onTimeout` 來收拾它建立的行程；少了那一步，逾時只是把「探針掛著」
 * 換成「探針繼續跑但機器上多了一組沒人管的 electron」。
 */
function withTimeout(work, limitMs, label) {
  let timer
  return Promise.race([
    Promise.resolve().then(work),
    new Promise((_, reject) => {
      // **不可 `unref()` 這個計時器。** 段落 hang 住時它可能是唯一撐住事件迴圈的東西 ——
      // unref 之後 Node 會判定無事可做而直接結束，計時器永遠不觸發，逾時形同不存在。
      // （洩漏不是問題：下面的 `finally` 一律 `clearTimeout`。）
      timer = setTimeout(() => reject(new SectionTimeout(label, limitMs)), limitMs)
    }),
  ]).finally(() => clearTimeout(timer))
}

/**
 * 解析 `PROBE_ONLY`。語法沿用 `probe:terminal` 既有的形式：
 *
 *   PROBE_ONLY=runMode                 只跑 runMode（build 與 dev 兩模式）
 *   PROBE_ONLY=runMode:build           只跑 runMode 的 build 模式
 *   PROBE_ONLY=runRestore,runAltScreen 跑這兩段
 */
function parseOnly(raw) {
  return (raw ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((filter) => {
      const [section, mode] = filter.split(':')
      return { section, mode: mode || null }
    })
}

/**
 * 把「使用者指定的段落」擴張成「指定的段落 ＋ 它們遞移的前置」。
 *
 * **少了這一步，段落篩選會變成一個會騙人的工具** —— 單獨跑一個缺前置的段落，症狀是「紅得
 * 莫名其妙」，而那與產品缺陷長得一模一樣（`docs/lessons/probes.md`：「驗收有前置條件時，
 * 前置沒成立會紅得莫名其妙」）。
 */
function withDeps(names, sections) {
  const byName = new Map(sections.map((s) => [s.name, s]))
  const selected = new Set()
  const visit = (name) => {
    if (selected.has(name)) return
    const section = byName.get(name)
    if (!section) throw new Error(`PROBE_ONLY 指定了不存在的段落：${name}`)
    selected.add(name)
    for (const dep of section.deps ?? []) visit(dep)
  }
  names.forEach(visit)
  return selected
}

/**
 * 算出某個模式下要跑的段落集合。`null` 表示「全部都跑」（未設 `PROBE_ONLY`）。
 *
 * **篩選必須逐模式計算，前置繼承帶它進來的那個段落的模式。** 直覺寫法（先算一份跨模式的選取
 * 集合，再各模式套用）會讓 `PROBE_ONLY=b:dev` 把前置 `a` 在 **build 也跑一遍** —— 使用者要的
 * 是 b 的 dev，而 build 那一輪對它毫無用處。**這個浪費正是本模組要消滅的東西**，讓它從自己的
 * 篩選邏輯漏回來是說不過去的。
 */
function selectedFor(only, sections, mode) {
  if (only.length === 0) return null
  const explicit = only.filter((o) => !o.mode || o.mode === mode).map((o) => o.section)
  // 未知的段落名一律要報錯，即使它被模式篩掉 —— 否則 `PROBE_ONLY=typo:dev` 會靜默跑成空輪。
  const known = new Set(sections.map((s) => s.name))
  for (const { section } of only) {
    if (!known.has(section)) throw new Error(`PROBE_ONLY 指定了不存在的段落：${section}`)
  }
  if (explicit.length === 0) return new Set()
  return withDeps(explicit, sections)
}

/** 某個段落在某個模式下要不要跑。 */
function wanted(selected, name) {
  return selected === null || selected.has(name)
}

/**
 * 跑完一個模式的所有段落。
 *
 * @returns {Promise<Array<{name: string, status: 'passed'|'failed'|'skipped', reason?: string}>>}
 */
async function runOneMode(sections, mode, modeConfig, selected, afterMode) {
  /** 這個模式自己的 context —— **build 與 dev 各持一份，不得互串**（兩者各自建立 fixture）。 */
  const context = {}
  const failed = new Set()
  const outcomes = []

  try {
    await runSectionsOfMode(sections, mode, modeConfig, selected, context, failed, outcomes)
  } finally {
    // **模式收尾必須在 finally** —— 多個段落共用一個 app 時（`probe:openspec` 全程只有一次
    // `launch()`），關閉它的責任不能落在「最後一個段落」身上：中途任一段 throw，那一段就
    // 不會執行，app 於是活過整個 build 模式、與 dev 模式的 app 並存。
    if (afterMode) {
      try {
        await afterMode(mode, context)
      } catch (error) {
        console.error(`\n模式收尾（${mode}）失敗：${error?.message ?? error}`)
      }
    }
  }

  return outcomes
}

async function runSectionsOfMode(sections, mode, modeConfig, selected, context, failed, outcomes) {
  for (const section of sections) {
    if (!wanted(selected, section.name)) continue

    const blockedBy = (section.deps ?? []).filter((dep) => failed.has(dep))
    if (blockedBy.length > 0) {
      // **不執行、也不計入失敗的斷言數** —— 它們指向的是前置那一個根因。
      failed.add(section.name)
      outcomes.push({ name: section.name, status: 'skipped', reason: blockedBy.join(', ') })
      console.log(`\n── ${mode}：${section.name} —— 未執行（前置失敗：${blockedBy.join(', ')}）──`)
      continue
    }

    // **每個段落換一個 token 並重置累計**（見 `instrument.mjs`）—— 逾時的段落不會被中止，
    // 它的殘留活動會繼續呼叫 `check()` 與 `pollFor()`，而下一個段落是無辜的。
    beginSection()
    const startedAt = Date.now()
    const meter = () => ({ seconds: (Date.now() - startedAt) / 1000, ...sectionSummary() })

    try {
      const produced = await withTimeout(
        () => section.run(mode, modeConfig, context),
        section.timeoutMs ?? DEFAULT_SECTION_TIMEOUT_MS,
        `${mode}：${section.name}`,
      )
      if (produced && typeof produced === 'object') Object.assign(context, produced)
      outcomes.push({ name: section.name, status: 'passed', ...meter() })
    } catch (error) {
      failed.add(section.name)
      const timedOut = error instanceof SectionTimeout
      outcomes.push({
        name: section.name,
        status: 'failed',
        reason: timedOut ? `逾時（${error.limitMs / 1000}s）` : (error?.message ?? String(error)),
        ...meter(),
      })
      if (timedOut) {
        console.error(`\n✗ ${mode}：${section.name} 逾時（超過 ${error.limitMs / 1000} 秒），本段記為失敗`)
        // **逾時的段落不會走到自己的 `finally`** —— 它建立的 app 與 pty 沒有其他人會收。
        if (section.onTimeout) {
          try {
            await section.onTimeout(mode, context)
          } catch (cleanupError) {
            console.error(`  逾時收屍失敗：${cleanupError?.message ?? cleanupError}`)
          }
        }
      } else {
        // **完整輸出訊息與堆疊** —— 隔離不是容忍。
        console.error(`\n✗ ${mode}：${section.name} 拋出例外，本段記為失敗，繼續其後的段落`)
        console.error(error?.stack ?? String(error))
      }
    }
  }
}

/**
 * 執行一支探針的全部段落。
 *
 * @param {object} options
 * @param {Array<{name: string, run: Function, deps?: string[]}>} options.sections 依執行順序排列
 * @param {object} options.build   build 模式的設定（會原樣傳給段落的第二個參數）
 * @param {object} options.dev     dev 模式的設定；`start` 為啟動 dev server 的函式
 * @param {Array<boolean>} options.results 探針共用的斷言結果陣列（`check(results, …)` 寫入的那個）
 * @param {Function} [options.afterMode] 每個模式跑完後執行，收到 `(mode, context)`。
 *   多段共用一個 app 時，關閉它的責任放這裡 —— 放在「最後一個段落」會在中途 throw 時漏掉。
 * @param {Function} [options.cleanup] 收尾（刪暫存目錄等），無論成敗都會執行
 */
export async function runSections({ sections, build, dev, results, afterMode, cleanup }) {
  const only = parseOnly(process.env.PROBE_ONLY)
  const selectedBuild = selectedFor(only, sections, 'build')
  const selectedDev = selectedFor(only, sections, 'dev')

  if (only.length > 0) {
    const shown = only.map((o) => (o.mode ? `${o.section}:${o.mode}` : o.section)).join(',')
    console.log(`（PROBE_ONLY=${shown} —— 只跑指定的段落，這不是完整驗收）`)
    const named = new Set(only.map((o) => o.section))
    const extra = [...new Set([...(selectedBuild ?? []), ...(selectedDev ?? [])])].filter(
      (name) => !named.has(name),
    )
    if (extra.length > 0) console.log(`（一併帶上宣告的前置段落：${extra.join(', ')}）`)
  }

  let devServer = null
  const outcomes = { build: [], dev: [] }

  try {
    outcomes.build = await runOneMode(sections, 'build', build, selectedBuild, afterMode)

    // **dev server 起得很慢 —— 沒有任何 dev 段要跑時就不要起它。**
    const needsDev = sections.some((s) => wanted(selectedDev, s.name))
    if (needsDev && dev) {
      devServer = await dev.start()
      outcomes.dev = await runOneMode(
        sections,
        'dev',
        { ...dev, rendererUrl: devServer.url },
        selectedDev,
        afterMode,
      )
    }
  } finally {
    if (devServer?.child?.pid) {
      try {
        // dev server 以 detached 起成 group leader —— 殺整組，否則 vite 會變孤兒佔著 port。
        process.kill(-devServer.child.pid, 'SIGKILL')
      } catch {
        // 已經結束
      }
    }
    if (cleanup) {
      try {
        await cleanup()
      } catch {
        // 收尾失敗不影響結論
      }
    }
  }

  return summarize(outcomes, results)
}

/**
 * 段落的耗時與累計。
 *
 * **窗口耗盡的次數與合計時間必須在這裡出現**，理由與耗時同一條：一段跑了幾百秒時，
 * 「它慢」與「它有六個等待落空」要修的是不同的東西，而逐次的那一行散在幾百行輸出裡。
 * 未執行的段落沒有數字（`seconds` 為 undefined），不印。
 */
function meterOf(outcome) {
  if (outcome.seconds === undefined) return ''
  const parts = [`${outcome.seconds.toFixed(1)}s`]
  if (outcome.timeouts > 0) {
    parts.push(`窗口耗盡 ${outcome.timeouts} 次／${(outcome.timeoutMs / 1000).toFixed(1)}s`)
  }
  if (outcome.cdpCalls > 0) {
    parts.push(`cdp ${outcome.cdpCalls}×${(outcome.cdpMs / 1000).toFixed(1)}s`)
  }
  return `（${parts.join('，')}）`
}

/** 印出段落狀態與斷言總數，並以結束碼反映結果。 */
function summarize(outcomes, results) {
  const all = [...outcomes.build.map((o) => ({ ...o, mode: 'build' })), ...outcomes.dev.map((o) => ({ ...o, mode: 'dev' }))]
  const failed = all.filter((o) => o.status === 'failed')
  const skipped = all.filter((o) => o.status === 'skipped')

  if (all.length > 0) {
    console.log(`\n段落狀態`)
    for (const o of all) {
      const mark = o.status === 'passed' ? '通過' : o.status === 'failed' ? '失敗' : '未執行'
      const detail = o.reason ? ` —— ${o.reason}` : ''
      console.log(`  ${mark}  ${o.mode}：${o.name}${detail}${meterOf(o)}`)
    }
  }

  const passed = results.filter(Boolean).length
  console.log(`\n${passed}/${results.length} 通過`)
  if (failed.length > 0 || skipped.length > 0) {
    console.log(
      `本輪不完整：${failed.length} 個段落失敗、${skipped.length} 個段落因前置失敗而未執行`,
    )
  }

  // 斷言有紅、或有段落失敗／未執行 —— 任一成立即非零。
  const complete = failed.length === 0 && skipped.length === 0
  const ok = passed === results.length && complete

  // **把「這一輪完整嗎」交給呼叫端**（`run-probes.mjs` 設定此環境變數）。
  //
  // 用檔案而非 stdout：`run-probes.mjs` 以 `stdio: 'inherit'` spawn 探針，看不到它的輸出；
  // 改成 pipe 再轉發會賠掉即時性。而這件事必須傳得出去 —— 一輪執行的耗時若被拿去做最佳化
  // 判斷，「它有沒有跑完」就是那個判斷的前提。本 change 的前一版正是敗在這裡。
  if (process.env.PROBE_SUMMARY_FILE) {
    try {
      writeFileSync(
        process.env.PROBE_SUMMARY_FILE,
        JSON.stringify({
          complete,
          passed,
          total: results.length,
          failed: failed.map((o) => `${o.mode}:${o.name}`),
          skipped: skipped.map((o) => `${o.mode}:${o.name}`),
        }),
      )
    } catch {
      // 寫不出摘要不影響探針自己的結論
    }
  }

  return { ok, complete, failed, skipped, passed, total: results.length }
}
