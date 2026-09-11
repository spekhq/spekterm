/**
 * agent-intake / intake-routing 的驗收。
 *
 * ## 這支探針存在的理由，是一條跨行程的斷言
 *
 * 「交給 agent 的內容**逐字元等於**呈現給使用者的內容」是這條管線人類閘門的另一半，而它
 * **在主行程裡驗不到** —— 一個比對兩個純函式的單元測試看不見呈現那一端（它根本不在場），
 * 也看不見「正規化被搬到呈現層」這個最自然的實作錯誤。
 *
 * 唯一看得見它的載體是：從**畫面上**取那一列的 `textContent`（不是 `innerText` —— 它會套用
 * `text-transform` 並壓縮空白，本 repo 踩過），從**磁碟上**讀 context 檔，兩者比對相等。
 *
 * ## 第二條只有這裡驗得到的事
 *
 * 「預填不早於就緒」的兩端都由**檔案**界定：替身在 fire `SessionStart` 之前先等一段，並在
 * fire 的當下寫下 receipt。於是「就緒之前」是一個真實存在、可以持續輪詢的區間 ——
 * **而不是一次取樣**（那量到的是「錯誤的寫入有沒有搶在我這次取樣之前」，是時序不是行為）。
 *
 * 而「寫入」只有位元組收據看得見：預填**刻意不附送出字元**，canonical 模式下那些位元組不會
 * 被交出來，`agent-input.log` 恆為空 —— 對正確實作與錯誤實作**一樣**。
 */
import { spawn } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { check, connectToApp, pollFor } from './lib/cdp.mjs'
import { label } from './lib/copy.mjs'
import { awaitMounted } from './lib/mounted.mjs'
import { electronExtraArgs } from './lib/display.mjs'
import { runSections } from './lib/sections.mjs'
import { PROBE_PORTS } from './lib/ports.mjs'
import { ptyPids, ptySessionPids } from './lib/pty-pids.mjs'
import { makeStubAgent } from './lib/stub-agent.mjs'

const PORT = PROBE_PORTS.intake.main
const RESTART_PORT = PROBE_PORTS.intake.restart

const results = []
const temps = []

function mkTemp(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  temps.push(dir)
  return dir
}

/** 三個 folder —— rail 選第三個、規則指第二個、fallback 指第一個。見 `runRouting`。 */
function seedProfile() {
  const profile = mkTemp('spekterm-intake-profile-')
  const folders = ['one', 'two', 'three'].map((name, index) => {
    const repo = mkTemp(`spekterm-intake-repo-${name}-`)
    mkdirSync(join(repo, 'openspec'), { recursive: true })
    // `name` ＝ rail 上呈現的名字（主行程取 basename），而卡片上呈現的正是它 ——
    // mkTemp 的隨機尾綴讓三個名字互不為子字串，斷言因此有鑑別力。
    return { id: `f${index + 1}`, path: repo, name: basename(repo), addedAt: '2026-09-11T00:00:00.000Z' }
  })
  writeFileSync(join(profile, 'workspace.json'), JSON.stringify({ version: 1, folders }))
  return { profile, folders }
}

/** routing 規則 —— 直接寫進本能力自己的檔案（它不住在 `preferences.json`）。 */
function seedRouting(profile, { rules = [], fallbackFolderId = null } = {}) {
  writeFileSync(
    join(profile, 'intake-routing.json'),
    JSON.stringify({ version: 1, rules, fallbackFolderId }),
  )
}

function inboxOf(profile) {
  return join(profile, 'intake-inbox')
}

/** 投遞 —— **先寫暫存再更名**，與 producer 的契約相同。 */
function drop(profile, name, payload) {
  const inbox = inboxOf(profile)
  mkdirSync(inbox, { recursive: true })
  const target = join(inbox, `${name}.json`)
  writeFileSync(`${target}.tmp`, JSON.stringify(payload))
  renameSync(`${target}.tmp`, target)
  return target
}

function intake({ id = 'a1', title = 'a title', body = 'a body', originId = 'C1', actor = 'someone' } = {}) {
  return { id, origin: { kind: 'slack', id: originId, label: '#dev' }, title, body, actor }
}

async function launch({ profile, configDir, stub, port = PORT, marker }) {
  const child = spawn(
    'electron',
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...electronExtraArgs(), '.'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SHELL: '/bin/sh',
        CLAUDE_CONFIG_DIR: configDir,
        // **`HOME` 也要換掉。** agent 目標走 `$SHELL -l -c claude`，而 login shell 會 source
        // `~/.profile`，把**真** claude 搶回 PATH 前面。漏掉它的徵狀是「替身完全沒被執行」，
        // 而畫面上一切正常 —— 紅的是產品那側的斷言。這是第三支踩過這個坑的探針。
        HOME: stub.home,
        PATH: `${stub.bin}:${process.env.PATH}`,
        SPEK_PROBE_MARKER: marker,
      },
    },
  )
  let output = ''
  child.stderr?.on('data', (chunk) => (output += chunk))
  child.stdout?.on('data', (chunk) => (output += chunk))
  const client = await connectToApp(port, { targetTimeoutMs: 30_000 })
  await awaitMounted(client)
  return {
    client,
    output: () => output,
    async close() {
      try {
        await client.close()
      } catch {
        // 已經斷了就算了 —— 收屍才是重點。
      }
      child.kill()
      await new Promise((resolve) => setTimeout(resolve, 900))
    },
  }
}

/**
 * 起一個乾淨的 app —— **先把上一段的收掉**。
 *
 * `afterMode` 是**每個模式**跑一次，不是每個段落。少了這一步，第二段之後每次 `launch` 都會
 * 連到**還活著的前一個 app**（`connectToApp` 連的是先起來的那一個），於是「找不到那一列」
 * 的等待全部在一個不相干的 profile 上空轉 —— 而症狀看起來像產品沒有把 intake 讀進來。
 * 這是 `insights` 與 `agentView` 兩個 port 學到的同一件事，換一個形狀出現。
 */
async function freshApp(context, options) {
  if (context.app) {
    await context.app.close()
    context.app = null
  }
  const app = await launch(options)
  context.app = app
  return app
}

// ── 讀畫面的表達式 ──────────────────────────────────────────────────────────

// **選擇器一律自字典取字** —— `label()` 會把文案組成完整的屬性選擇器。
// 文案與選擇器若分離為兩份字面值，某一次改文案就會失去同步，而徵狀是「選不到元素」，
// 不是「斷言失敗」。（那道守衛走行掃描，所以這段註解裡也不能寫出該屬性的字面形式。）

/**
 * 點開收件匣，並回報**它是不是真的開了**。
 *
 * 第一版寫成 `querySelector(…)?.click(), true` —— **那是一個恆真的閘**：選不到按鈕時它照樣
 * 回 `true`，於是其後每一條「找不到那一列」的等待都在一個根本沒開的 overlay 上空轉。
 * 判準必須是**結果**（dialog 在不在），不是「我試著點了」。
 */
const OPEN_INBOX = `(() => {
  const dialog = document.querySelector('[role="dialog"]${label('intake.label')}')
  if (dialog) return true
  document.querySelector('${label('activityBar.handoffs')}')?.click()
  return !!document.querySelector('[role="dialog"]${label('intake.label')}')
})()`

async function openInbox(app) {
  return pollFor({
    read: () => app.client.evaluate(OPEN_INBOX),
    settled: (open) => open === true,
    timeoutMs: 15_000,
    label: '收件匣已開啟',
  })
}

function itemSelector(title) {
  return label('intake.itemLabel', { title })
}

/** 那一列的 `textContent` —— **不是 `innerText`**（見檔頭）。 */
function itemTextExpression(title) {
  return `document.querySelector(${JSON.stringify(itemSelector(title))})?.textContent ?? ''`
}

/** 那一列**子樹之內**的圖片與連結數 —— 作用域不可是整份文件。 */
function itemMediaExpression(title) {
  return `(() => {
    const row = document.querySelector(${JSON.stringify(itemSelector(title))})
    if (!row) return null
    return { images: row.querySelectorAll('img').length, links: row.querySelectorAll('a').length }
  })()`
}

function acceptExpression(title) {
  return `(() => {
    const row = document.querySelector(${JSON.stringify(itemSelector(title))})
    const button = row?.querySelector('${label('intake.accept')}')
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`
}

function dismissExpression(title) {
  return `(() => {
    const row = document.querySelector(${JSON.stringify(itemSelector(title))})
    const button = row?.querySelector('${label('intake.dismiss')}')
    if (!button) return false
    button.click()
    return true
  })()`
}

/** 斷言失敗時，光看數字看不出是誰 —— 把候選行程的樣子印出來。 */
function diagnoseProcesses(marker) {
  const rows = []
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const cmdline = readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0').filter(Boolean)
      if (!cmdline.join(' ').includes('claude')) continue
      const environ = readFileSync(`/proc/${entry}/environ`, 'utf8')
      rows.push(`${cmdline.slice(0, 3).join(' ')}｜marker=${environ.includes(marker)}`)
    } catch {
      // 行程結束了
    }
  }
  return rows.slice(0, 4).join(' ；') || '(沒有 claude 行程)'
}

// ── 段落 ────────────────────────────────────────────────────────────────────

/**
 * 兩條入口 —— 啟動掃描與監看。
 *
 * 第一段先以**已知的數值**釘住「讀到的是 fixture 而非開發者本機的真實收件匣」：
 * 少了它，`--user-data-dir` 沒傳進去時每一條存在性斷言照樣全綠。
 */
async function runIngest(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  // 啟動**之前**投遞 —— 只有掃描看得到它（`ignoreInitial: true` 寫死於 `watcher.ts`）。
  drop(profile, 'before', intake({ id: 'before-1', title: 'BEFORE-TITLE' }))

  const app = await freshApp(context, { profile, configDir, stub, marker })

  await openInbox(app)

  /**
   * 活動列 —— `workspace-layout` 的 delta。
   *
   * Handoffs 從停用轉為已實作；Search 仍是停用的 placeholder。**兩者一起驗**：
   * 只驗「Handoffs 是亮的」的話，一個把整排都打開的實作照樣通過。
   */
  const entries = await pollFor({
    read: () =>
      app.client.evaluate(`(() => {
        const pick = (sel) => {
          const el = document.querySelector(sel)
          return el ? { disabled: !!el.disabled } : null
        }
        return {
          handoffs: pick('${label('activityBar.handoffs')}'),
          search: pick('${label('activityBar.search')}'),
          sessions: pick('${label('activityBar.sessions')}'),
        }
      })()`),
    settled: (value) => value?.handoffs != null,
    timeoutMs: 15_000,
    label: '活動列已呈現',
  })
  check(results, 'Handoffs 入口為可用狀態', entries.handoffs?.disabled === false, JSON.stringify(entries.handoffs))
  check(results, '尚未實作的入口（Search）仍為停用', entries.search?.disabled === true, JSON.stringify(entries.search))
  check(results, 'Sessions 入口仍為可用', entries.sessions?.disabled === false, JSON.stringify(entries.sessions))

  const sidePanelExpression = `document.querySelector('[role="tablist"]${label('panelSwitch.label')}')?.textContent ?? ''`
  const sidePanelBefore = await app.client.evaluate(sidePanelExpression)

  const before = await pollFor({
    read: () => app.client.evaluate(itemTextExpression('BEFORE-TITLE')),
    settled: (text) => text.includes('BEFORE-TITLE'),
    timeoutMs: 15_000,
    label: '啟動前投遞的 intake 出現',
  })
  check(results, '前置：讀到的是 fixture 的收件匣（已知的標題）', before.includes('BEFORE-TITLE'), before.slice(0, 60))
  check(results, '應用程式未執行時投遞的 intake 於啟動後進入收件匣', true, 'BEFORE-TITLE')

  // 啟動**之後**投遞 —— 由監看接手。
  drop(profile, 'after', intake({ id: 'after-1', title: 'AFTER-TITLE' }))
  const after = await pollFor({
    read: () => app.client.evaluate(itemTextExpression('AFTER-TITLE')),
    settled: (text) => text.includes('AFTER-TITLE'),
    timeoutMs: 15_000,
    label: '啟動後投遞的 intake 出現',
  })
  check(results, '啟動後才投遞的 intake 由監看接手', after.includes('AFTER-TITLE'))

  // **落點被消費掉** —— 兩條入口都走同一條處理路徑。
  const leftovers = readdirSync(inboxOf(profile))
  check(results, '採納之後投遞檔被消費', leftovers.length === 0, `落點剩下：${JSON.stringify(leftovers)}`)

  // 收件匣是 overlay，**不是側欄的第三個身分** —— 側欄的身分不因它而改變。
  const sidePanelAfter = await app.client.evaluate(sidePanelExpression)
  check(results, '開啟收件匣不改變側欄的身分', sidePanelAfter === sidePanelBefore, `前=${sidePanelBefore} 後=${sidePanelAfter}`)
}

/**
 * 本文以純文字呈現。
 *
 * **正面的錨在前**：那一列的文字裡要**含有語法的字面形式** —— 否則「沒有 img／a」對一個
 * 根本沒渲染出那一列的實作也成立。而作用域是**該列的子樹**，不是整份文件：後者會在 app
 * 別處出現任何一個 `<a>` 時為了無關的理由變紅，然後被放寬。
 */
async function runPlainText(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  const SYNTAX = '![pixel](https://attacker.example/x.png) and [a link](https://evil.example)'
  drop(profile, 'markdownish', intake({ id: 'md-1', title: 'MARKDOWN-TITLE', body: SYNTAX }))

  const app = await freshApp(context, { profile, configDir, stub, marker })
  await openInbox(app)

  const text = await pollFor({
    read: () => app.client.evaluate(itemTextExpression('MARKDOWN-TITLE')),
    settled: (value) => value.includes('MARKDOWN-TITLE'),
    timeoutMs: 15_000,
    label: '該列已呈現',
  })
  check(results, '本文中的標記語法以字面文字呈現（正面的錨）', text.includes(SYNTAX), text.slice(0, 90))

  const media = await pollFor({
    read: () => app.client.evaluate(itemMediaExpression('MARKDOWN-TITLE')),
    settled: (value) => value !== null,
    timeoutMs: 15_000,
    label: '該列的子樹可檢視',
  })
  check(
    results,
    '該列之內不存在圖片與可點的連結',
    media !== null && media.images === 0 && media.links === 0,
    media === null ? '選不到那一列' : `img=${media.images} a=${media.links}`,
  )
}

/**
 * 於 routing 解析出的 folder 建立，而不是選中的或第一個。
 *
 * **鑑別力全部來自 fixture 的形狀**：三個 folder、rail 選第三個、規則指第二個、
 * fallback 指第一個 —— 於是「用選中的」「用第一個」「用 fallback」三種錯誤實作各自都會紅。
 */
async function runRouting(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, {
    rules: [{ id: 'r1', criterion: 'originId', contains: 'CROUTE', folderId: folders[1].id }],
    fallbackFolderId: folders[0].id,
  })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  drop(profile, 'routed', intake({ id: 'routed-1', title: 'ROUTED-TITLE', originId: 'CROUTE' }))

  const app = await freshApp(context, { profile, configDir, stub, marker })
  await openInbox(app)

  const text = await pollFor({
    read: () => app.client.evaluate(itemTextExpression('ROUTED-TITLE')),
    settled: (value) => value.includes('ROUTED-TITLE'),
    timeoutMs: 15_000,
    label: '該列已呈現',
  })
  // 卡片上呈現的是**解析到的 folder，而且是它在 rail 上的名字**。斷言絕對值 —— 不是「有變」。
  //
  // **釘名字而不是識別碼**：識別碼對使用者不構成資訊，而「顯示識別碼」這個缺陷正是
  // 以釘識別碼的斷言放過去的 —— 改成顯示名字之後，原本那條否定斷言會變成恆真。
  check(
    results,
    '接受之前看得到將開在哪個 folder（第二個，不是選中的或第一個）',
    text.includes(`Opens in ${folders[1].name}`),
    text.slice(0, 120),
  )
  check(
    results,
    '不是 fallback 指向的那一個',
    !text.includes(`Opens in ${folders[0].name}`),
    text.slice(0, 120),
  )
  // 識別碼不得外洩到那一列上 —— 它既不是資訊，也是路徑以外的第二種位置指認。
  check(results, '呈現的不是 folder 識別碼', !text.includes(`Opens in ${folders[1].id}`), text.slice(0, 120))
}

/**
 * 接受 → 預填 —— 本 change 最會靜默失效的一段。
 *
 * 三條斷言，判準的兩端都由**檔案**界定：
 *
 * 1. **就緒之前的整段期間**收據為空（持續輪詢，不是一次取樣）；同段落先確認 pty 已存在，
 *    否則「沒寫入」只是因為根本沒有東西。
 * 2. 就緒之後收據含 prompt，**且其後不含送出字元或換行**。
 * 3. **呈現與交付是同一份文字** —— 畫面上那一列的文字 vs 磁碟上 context 檔界線之內的內容。
 */
async function runAcceptPrefill(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  // **可控的就緒延遲** —— 少了它，ready 在 pty 誕生後數毫秒就到，
  // 而「不等待就緒即寫入」的錯誤實作與正確實作落在同一個不可分辨的瞬間。
  const stub = makeStubAgent(mkTemp, configDir, { readyDelaySeconds: 4, announceTitle: 'STUB-DECLARED-TITLE' })

  const BODY = 'first line\nsecond line with  spaces'
  drop(profile, 'prefill', intake({ id: 'prefill-1', title: 'PREFILL-TITLE', body: BODY }))

  const app = await freshApp(context, { profile, configDir, stub, marker })
  await openInbox(app)
  const shown = await pollFor({
    read: () => app.client.evaluate(itemTextExpression('PREFILL-TITLE')),
    settled: (value) => value.includes('PREFILL-TITLE'),
    timeoutMs: 15_000,
    label: '該列已呈現',
  })

  await pollFor({
    read: () => app.client.evaluate(acceptExpression('PREFILL-TITLE')),
    settled: Boolean,
    timeoutMs: 15_000,
    label: '按下接受',
  })

  // pty 必須真的存在 —— 否則「收據為空」只是因為什麼都還沒發生。
  await pollFor({
    read: () => ptySessionPids(marker).length,
    settled: (count) => count >= 1,
    timeoutMs: 20_000,
    label: 'pty 已建立',
  })

  // **整段期間**為空，而不是某一次取樣為空。
  /**
   * 等到替身宣告就緒 —— **或**在那之前就看到位元組（那就是提早寫入）。
   *
   * **上界不可省**：替身若從未啟動，`ready()` 永遠是 false，而沒有上界的迴圈會把整個段落
   * 拖到逾時，**真正的失敗（session 沒建起來）被那個逾時蓋掉**（實測踩過）。
   */
  const beforeReady = await pollFor({
    read: () => ({ ready: stub.ready(), bytes: stub.bytes() }),
    settled: (state) => state.ready || state.bytes.length > 0,
    timeoutMs: 20_000,
    interval: 50,
    label: '替身宣告就緒（或在那之前收到位元組）',
  })
  const dirtyBeforeReady = beforeReady.ready ? '' : beforeReady.bytes
  check(results, '前置：替身確實宣告了就緒（否則下一條什麼都沒測到）', beforeReady.ready === true)
  /**
   * **這條由對照組釘住**（`scripts/intake-control-groups.mjs` 的 `prefill-no-wait`）：
   * 把觸發改成「pty 建立完成之後、不等待就緒即寫入」時它會紅，收據裡提前出現那行 prompt。
   *
   * > 它一度紅不起來，而原因**不在這條斷言**：替身當時把讀取迴圈放在背景、且一次空讀就退出，
   * > 於是提早寫入的位元組根本沒有人讀。**差點據此把一條有效的斷言降級成「留著當回歸」** ——
   * > 對照組沒有變紅時，第一個要問的是「觀測管道還活著嗎」，不是「這條斷言沒有鑑別力」。
   */
  check(
    results,
    '就緒之前的整段期間未向該 session 寫入任何內容',
    dirtyBeforeReady === '',
    dirtyBeforeReady === '' ? '收據全程為空' : `提前收到：${JSON.stringify(dirtyBeforeReady.slice(0, 60))}`,
  )

  const received = await pollFor({
    read: () => stub.bytes(),
    settled: () => stub.bytes().includes('.md'),
    timeoutMs: 25_000,
    label: '就緒之後 prompt 抵達 pty',
  }).catch(() => stub.bytes())

  const bytes = stub.bytes()
  check(results, '就緒之後 prompt 填入 agent 的輸入處', bytes.length > 0 && bytes.includes('.md'), bytes.slice(0, 80))
  check(
    results,
    '填入的內容之後不含送出字元或換行（它尚未被送出）',
    !/[\r\n]/.test(bytes),
    JSON.stringify(bytes.slice(-30)),
  )
  check(results, '該 prompt 未進入 agent 的紀錄（沒有被送出）', stub.input() === '', JSON.stringify(stub.input()))
  void received

  // **跨行程的那一條** —— 畫面上的文字 vs 磁碟上的檔案。
  const contextDir = join(profile, 'intake')
  const contextFile = readdirSync(contextDir).find((name) => name.endsWith('.md'))
  const contents = contextFile ? readFileSync(join(contextDir, contextFile), 'utf8') : ''
  const fenced = contents.match(/<<<untrusted-[0-9a-f]+>>>\n([\s\S]*)\n<<<\/untrusted-[0-9a-f]+>>>/)?.[1] ?? null
  check(results, '交給 agent 的檔案確實產生且帶界線', fenced !== null, contextFile ?? '(無)')
  /**
   * **系統不代為指定 session 名稱。**
   *
   * 指定名稱在既有能力中＝「使用者永久接管命名權」，此後 agent 依任務產生的標題會被靜默地
   * 不予呈現。斷言維持**正面形式**（標籤最終等於替身宣告的那個），不可改寫成「標籤不是
   * intake 的標題」那種恆真式。OSC 標題比 session 晚到，因此是輪詢而非一次取樣。
   */
  const labelText = await pollFor({
    read: () => app.client.evaluate('document.body.textContent ?? \'\''),
    settled: (text) => text.includes('STUB-DECLARED-TITLE'),
    timeoutMs: 20_000,
    label: 'agent 宣告的標題出現在分頁上',
  }).catch(() => '')
  check(
    results,
    'session 的名稱未被系統指定（agent 宣告的標題呈現得出來）',
    labelText.includes('STUB-DECLARED-TITLE'),
    labelText.includes('PREFILL-TITLE') ? '標籤被 intake 的標題佔住了' : labelText.slice(0, 60),
  )

  check(
    results,
    '交給 agent 的內容逐字元等於呈現給使用者的本文',
    fenced !== null && shown.includes(fenced),
    fenced === null ? '(無界線)' : `檔案內＝${JSON.stringify(fenced.slice(0, 60))}`,
  )
}

/**
 * 忽略不建立 session。
 *
 * **絕對的 session 計數，而且是 session 不是行程**（一個 claude session 是兩個帶 marker 的
 * 行程）。且**同段落先驗一次接受確實建得出 session** —— 否則「沒有新增」對一個接受鈕根本
 * 沒接上的實作同樣成立。
 */
async function runDismiss(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  drop(profile, 'keep', intake({ id: 'keep-1', title: 'ACCEPT-ME' }))
  drop(profile, 'drop', intake({ id: 'drop-1', title: 'DISMISS-ME' }))

  const app = await freshApp(context, { profile, configDir, stub, marker })
  await openInbox(app)
  await pollFor({
    read: () => app.client.evaluate(itemTextExpression('ACCEPT-ME')),
    settled: (value) => value.includes('ACCEPT-ME'),
    timeoutMs: 15_000,
    label: '兩則都已呈現',
  })

  const baseline = ptySessionPids(marker).length
  await pollFor({
    read: () => app.client.evaluate(acceptExpression('ACCEPT-ME')),
    settled: Boolean,
    timeoutMs: 15_000,
    label: '接受',
  })
  await pollFor({
    read: () => ptySessionPids(marker).length,
    settled: (count) => count === baseline + 1,
    timeoutMs: 20_000,
    label: '接受確實建立了一個 session',
  })
  const diagnosis = await app.client.evaluate('document.body.textContent ?? \'\'')
  check(
    results,
    '前置：接受確實建得出 session（否定斷言的對照）',
    ptySessionPids(marker).length === baseline + 1,
    ptySessionPids(marker).length === baseline + 1
      ? ''
      : `pty=${ptyPids(marker).length} session=${ptySessionPids(marker).length} | ${diagnoseProcesses(marker)}`,
  )

  const afterAccept = ptySessionPids(marker).length
  await openInbox(app)
  await pollFor({
    read: () => app.client.evaluate(dismissExpression('DISMISS-ME')),
    settled: Boolean,
    timeoutMs: 15_000,
    label: '忽略',
  })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  check(
    results,
    '忽略不建立任何 session（session 總數不變）',
    ptySessionPids(marker).length === afterAccept,
    `忽略前 ${afterAccept}，忽略後 ${ptySessionPids(marker).length}`,
  )
}

const SECTIONS = [
  { name: 'runIngest', run: runIngest },
  { name: 'runPlainText', run: runPlainText },
  { name: 'runRouting', run: runRouting },
  { name: 'runAcceptPrefill', run: runAcceptPrefill },
  { name: 'runDismiss', run: runDismiss },
]

const outcome = await runSections({
  sections: SECTIONS,
  build: { port: PORT, rendererUrl: null },
  dev: null,
  results,
  afterMode: async (_mode, context) => {
    if (context.app) await context.app.close()
  },
  cleanup: () => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true })
  },
})

void RESTART_PORT
process.exit(outcome ? 0 : 1)
