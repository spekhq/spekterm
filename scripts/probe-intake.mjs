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
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { check, connectToApp, pollFor, pressKey } from './lib/cdp.mjs'
import { copy, copyIn, label, labelIn, prefixOf } from './lib/copy.mjs'
import { retryAction } from './lib/instrument.mjs'
import { awaitMounted } from './lib/mounted.mjs'
import { electronExtraArgs } from './lib/display.mjs'
import { runSections } from './lib/sections.mjs'
import { PROBE_PORTS } from './lib/ports.mjs'
import { ptyPids, ptySessionPids } from './lib/pty-pids.mjs'
import { makeStubAgent } from './lib/stub-agent.mjs'
import { seedLanguage } from './lib/probe-language.mjs'

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
  // 被測 app 的語言是**被指定的**：全新的 profile 會觸發首次啟動的語言偵測，
  // 而在一台非英文的機器上，那會讓每一條 `aria-label` 選擇器選不到元素。
  // 既有的 `preferences.json` 不動（損毀韌性與舊檔那兩段自己佈置它）。
  seedLanguage(profile)

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

/**
 * 指定語言的「接受」按鈕。**列的 `aria-label` 與按鈕的 `aria-label` 在該語言下都變了** ——
 * `aria-label` 同時是選擇器，而它自己也會被翻譯。
 */
function acceptExpressionIn(language, title) {
  const rowSelector = JSON.stringify(labelIn(language, 'intake.itemLabel', { title }))
  const buttonSelector = labelIn(language, 'intake.accept')
  return `(() => {
    const row = document.querySelector(${rowSelector})
    const button = row?.querySelector('${buttonSelector}')
    if (!button || button.disabled) return false
    button.click()
    return true
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

/**
 * 直接 seed 落盤的收件匣狀態。
 *
 * **「帶著待處理項目啟動」這個前提只能這樣造。** 在落點放檔案造出來的是**到達**，
 * 而到達是會通知的 —— 那正好是相反的前提（見 `runNotifyBackfill`）。
 *
 * 另注意：`CAPACITY` 與 `MALFORMED` 的投遞檔刻意不被消費，它們在下次啟動會重新 deliver
 * ⇒ 那是一次合法的新到達。seed 時不要在落點留下任何東西。
 */
function seedStore(profile, items) {
  const entries = items.map((item) => ({
    adapter: 'file',
    id: item.id,
    state: 'pending',
    digest: `seed-${item.id}`,
    content: {
      verified: { adapter: 'file', originKind: 'slack', originId: 'C1' },
      authored: {
        title: item.title,
        body: item.body ?? 'seeded body',
        actor: item.actor ?? 'someone',
        originLabel: '#dev',
      },
      receivedAt: 1_700_000_000_000,
    },
  }))
  writeFileSync(join(profile, 'intake.json'), JSON.stringify({ version: 1, entries }))
}

/** 替身通知後端的落點 —— 與主行程的 `stubNotifyRoot()` 同一個推導。 */
function notifyRoot(profile) {
  return join(profile, 'notify-stub')
}

function notifications(profile) {
  const file = join(notifyRoot(profile), 'notifications.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

/**
 * 通知的固定合併窗（`src/main/intake-notify.ts` 的 `WINDOW_MS`）**加上餘裕**。
 *
 * probe 是 `.mjs`，import 不了 TypeScript 的常數，因此這個值與產品那一份是分開的兩份 ——
 * 它**只需要大於**產品那個窗，不需要相等，所以分岔不會讓斷言失準（只會讓它多等一會）。
 */
const NOTIFY_QUIET_MS = 5_000

/**
 * 交接的本文 —— **刻意長於第三方本文適用的上限（4,000），遠短於 first-party 的上限（20,000）**。
 *
 * 它一次承擔三件事：
 *
 * 1. **分流真的生效**。上限若沒有分流，這一則會在投遞階段就被拒 —— 於是 `runHandoff` 的
 *    每一條斷言全部變紅，而不是只有一條。
 * 2. **全文不被截斷**。頭尾各一個標記，兩個都必須出現在畫面上。
 *    只驗頭的話，一個「截斷到前 N 字元」的實作照樣全綠。
 * 3. **跨行程逐字元**。畫面上那一段的文字必須含磁碟上界線之內的完整內容。
 */
const HANDOFF_BODY = `HANDOFF-BODY-HEAD ${'detail line about the work to take over. '.repeat(110)}HANDOFF-BODY-TAIL`

/**
 * 等到通知**落定**再量測 —— 距離最後一次新增已經過了一個完整的合併窗。
 *
 * **「連續兩次讀到相同的數量」是不夠的**：合併窗之內通知根本還沒被發出，數量在那段時間裡
 * 本來就不變，於是那個判準在窗到期之前就會成立 —— 而窗一到期，一則與待測動作**無關**的通知
 * 就落在 `before` 之後，成為某條斷言的「證據」。
 *
 * 那正是「目標查無時發出通知」這條斷言假綠的成因：它量到 `before=0`，而 9 秒後才看見那則
 * `"New handoff"`（該段稍早接受的 intake 所觸發），`miss.json` 本身一則通知都沒有發出。
 */
async function settledNotifications(profile, label) {
  let count = -1
  let changedAt = Date.now()
  const { list } = await pollFor({
    read: () => {
      const current = notifications(profile)
      if (current.length !== count) {
        count = current.length
        changedAt = Date.now()
      }
      return { list: current, quietFor: Date.now() - changedAt }
    },
    settled: ({ quietFor }) => quietFor >= NOTIFY_QUIET_MS,
    timeoutMs: 30_000,
    label,
  })
  return list
}

function receipts(profile) {
  const file = join(notifyRoot(profile), 'receipts.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean)
}

/** 模擬一次「使用者觸發了通知」。 */
function fireNotification(profile, nth) {
  const root = notifyRoot(profile)
  mkdirSync(root, { recursive: true })
  // 同一個路徑寫第二次只會 emit `change`，替身兩種事件都訂了。
  writeFileSync(join(root, 'trigger'), String(nth))
}

/** 合併窗 + 一點餘裕。產品的窗是秒級的，探針**真的等** —— 少一個注入點就少一條會分岔的路。 */
const WINDOW_WAIT_MS = 6000

/** 入口上的計數標示 —— **由入口的標籤定位到按鈕，再讀它子樹內的標示**。 */
const BADGE_TEXT = `(() => {
  const button = document.querySelector('${label('activityBar.handoffs')}')
  if (!button) return null
  const badge = button.querySelector('[role="status"]')
  return badge ? badge.textContent : ''
})()`

/** 入口按鈕自己的尺寸 —— **不是 nav 的寬度**（那是寫死的，量它恆真）。 */
const HANDOFFS_RECT = `(() => {
  const button = document.querySelector('${label('activityBar.handoffs')}')
  if (!button) return null
  const rect = button.getBoundingClientRect()
  const badge = button.querySelector('[role="status"]')
  return { w: Math.round(rect.width), h: Math.round(rect.height), badge: badge ? badge.textContent : null }
})()`

/** 活動列的入口列舉 —— 與 `probe:workspace` 的同一個形狀。 */
const ACTIVITY_ENTRIES = `document.querySelectorAll('nav${label('activityBar.label')} button').length`

const ACTIVE_LABEL = `document.activeElement ? (document.activeElement.getAttribute('aria-label') ?? document.activeElement.tagName) : null`

/**
 * 收件匣 overlay 的分頁**沒有無障礙標籤**（它們的名字來自文字節點），所以要以文字定位。
 * 照既有紀律，那段文字仍然自字典取得。
 */
function tabClick(keyPath) {
  return `(() => {
    const list = document.querySelector('[role="tablist"]${label('intake.label')}')
    const tab = [...(list?.querySelectorAll('[role="tab"]') ?? [])]
      .find((candidate) => candidate.textContent === ${JSON.stringify(copy(keyPath))})
    if (!tab) return false
    tab.click()
    return true
  })()`
}

function tabFocus(keyPath) {
  return `(() => {
    const list = document.querySelector('[role="tablist"]${label('intake.label')}')
    const tab = [...(list?.querySelectorAll('[role="tab"]') ?? [])]
      .find((candidate) => candidate.textContent === ${JSON.stringify(copy(keyPath))})
    if (!tab) return false
    tab.focus()
    return document.activeElement === tab
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
  //
  // **釘被選中的那一項，不是整列的文字**（intake-inbox-usability）：folder 改為選單之後，
  // 整列的文字含**每一個**選項的名字，於是「含第二個的名字」「不含第一個的名字」的真假
  // 只取決於選項的排列順序。使用者讀到的是被選中的那一項。
  const selected = await app.client.evaluate(selectedFolderExpression('ROUTED-TITLE'))
  check(
    results,
    '接受之前看得到將開在哪個 folder（第二個，不是選中的或第一個）',
    selected?.text === folders[1].name,
    `${JSON.stringify(selected)} | ${text.slice(0, 80)}`,
  )
  check(results, '不是 fallback 指向的那一個', selected?.text !== folders[0].name, JSON.stringify(selected))
  // 識別碼不得外洩到那一列上 —— 它既不是資訊，也是路徑以外的第二種位置指認。
  check(results, '呈現的不是 folder 識別碼', !!selected && selected.text !== folders[1].id, JSON.stringify(selected))

  /**
   * **session 真的開在那裡** —— 讀 pty 行程的 cwd（intake-inbox-usability）。
   *
   * 此前這一段只驗畫面上寫著將開在哪裡，從來沒有驗到接受之後 session 開在哪。
   * 未改選即接受：送出的是預選值（解析結果），而第一個 folder 是 fallback —— 規則不生效的
   * 錯誤實作會開在那裡。
   */
  const before = ptySessionPids(marker)
  await pollFor({
    read: () => app.client.evaluate(acceptExpression('ROUTED-TITLE')),
    settled: Boolean,
    timeoutMs: 15_000,
    label: '未改選即接受',
  })
  const opened = await newSessionCwd(marker, before, '接受建立了 session')
  check(
    results,
    '未改選即接受時 session 開在解析出的 folder（第二個，不是 fallback 的第一個）',
    opened.cwd === folders[1].path && opened.count === 1,
    `cwd=${opened.cwd} 新增=${opened.count} 期望=${folders[1].path}`,
  )
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

/**
 * 活動列上的計數 —— **本段從頭到尾不打開收件匣，直到最後一條**。
 *
 * 第一條是這一段存在的主要理由：主行程的收件者集合是在 renderer 第一次呼叫 `list()` 時
 * 才註冊的，而在常駐的 provider 出現之前那只發生在 overlay 掛載時 —— 也就是**一個從來
 * 沒有被打開過的收件匣，其變化不會推給任何人**。順序不能動：一旦打開過，這條就失去前提。
 */
async function runBadge(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  // **刻意不設 fallback**：本段要有一則 routing 解析不出來的項目，而設了 fallback 之後
  // 每一則都解析得出來 —— 那條「仍計入」的斷言就沒有被驗到的機會。
  seedRouting(profile, {
    rules: [{ id: 'r1', criterion: 'originId', contains: 'C1', folderId: folders[0].id }],
  })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  const app = await freshApp(context, { profile, configDir, stub, marker })

  const emptyRect = await app.client.evaluate(HANDOFFS_RECT)
  check(results, '前置：沒有待處理項目時不存在計數標示', emptyRect?.badge === null, JSON.stringify(emptyRect))

  drop(profile, 'b1', intake({ id: 'badge-1', title: 'BADGE-ONE' }))
  const one = await pollFor({
    read: () => app.client.evaluate(BADGE_TEXT),
    settled: (text) => text === '1',
    timeoutMs: 15_000,
    label: '計數變成 1',
  })
  check(results, '從未打開過收件匣時仍呈現計數', one === '1', `得到 ${JSON.stringify(one)}`)

  drop(profile, 'b2', intake({ id: 'badge-2', title: 'BADGE-TWO' }))
  drop(profile, 'b3', intake({ id: 'badge-3', title: 'BADGE-THREE', originId: 'CNOPE' }))
  const three = await pollFor({
    read: () => app.client.evaluate(BADGE_TEXT),
    settled: (text) => text === '3',
    timeoutMs: 15_000,
    label: '計數變成 3',
  })
  check(results, '計數等於待處理的則數', three === '3', `得到 ${JSON.stringify(three)}`)

  // **尺寸不變。** 量的是入口按鈕，不是活動列 —— 後者是寫死的寬度，量它恆真。
  const withBadge = await app.client.evaluate(HANDOFFS_RECT)
  check(
    results,
    '帶計數時入口本身的尺寸不變（且量測時標示確實存在）',
    withBadge?.badge === '3' && withBadge.w === emptyRect?.w && withBadge.h === emptyRect?.h,
    `空 ${JSON.stringify(emptyRect)}｜帶計數 ${JSON.stringify(withBadge)}`,
  )
  check(
    results,
    '入口的無障礙標籤不因計數而改變',
    (await app.client.evaluate(
      `document.querySelector('${label('activityBar.handoffs')}')?.getAttribute('aria-label') ?? null`,
    )) === copy('activityBar.handoffs'),
    '以入口的標籤定位得到它，且標籤與不帶計數時逐字元相同（本段每一次定位都倚賴這件事）',
  )
  check(
    results,
    '計數標示不使入口的列舉多出一項',
    (await app.client.evaluate(ACTIVITY_ENTRIES)) === 5,
    `得到 ${await app.client.evaluate(ACTIVITY_ENTRIES)}`,
  )

  // routing 解析不出來的那一則也計入 —— 打開收件匣確認它確實是「解析不出來」的那種。
  await openInbox(app)
  const rows = await pollFor({
    read: () =>
      app.client.evaluate(
        `document.querySelectorAll('[role="dialog"]${label('intake.label')} li').length`,
      ),
    settled: (count) => count === 3,
    timeoutMs: 15_000,
    label: '收件匣裡有三列',
  })
  check(results, '打開之後列出的待處理項目數與計數相同', rows === 3, `得到 ${rows}`)
  const unresolved = await app.client.evaluate(itemTextExpression('BADGE-THREE'))
  check(
    results,
    '前置：其中一則的 routing 確實解析不出來（否則「仍計入」沒有被驗到）',
    unresolved.includes(copy('intake.unresolved')),
    unresolved.slice(0, 120),
  )

  // 處理掉一則 ⇒ 計數減少；全部處理完 ⇒ 標示消失。
  await retryAction({
    act: () => app.client.evaluate(dismissExpression('BADGE-ONE')),
    read: () => app.client.evaluate(BADGE_TEXT),
    settled: (text) => text === '2',
    attemptWindowMs: 3000,
    timeoutMs: 15_000,
    label: '忽略一則',
  })
  check(results, '處理掉一則之後計數隨即減少', true, '2')

  for (const title of ['BADGE-TWO', 'BADGE-THREE']) {
    await retryAction({
      act: () => app.client.evaluate(dismissExpression(title)),
      read: () => app.client.evaluate(`!document.querySelector(${JSON.stringify(itemSelector(title))})`),
      settled: (gone) => gone === true,
      attemptWindowMs: 3000,
      timeoutMs: 15_000,
      label: `忽略 ${title}`,
    })
  }
  const gone = await pollFor({
    read: () => app.client.evaluate(BADGE_TEXT),
    settled: (text) => text === '',
    timeoutMs: 15_000,
    label: '標示消失',
  })
  check(results, '沒有待處理項目時不呈現計數標示（不是 0）', gone === '', `得到 ${JSON.stringify(gone)}`)
}

/** 計數跨重啟保留 —— **本探針的第一個重啟段落**（`RESTART_PORT` 保留已久但一直沒有被用到）。 */
async function runBadgeRestart(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  const first = await freshApp(context, { profile, configDir, stub, marker })
  drop(profile, 'r1', intake({ id: 'restart-1', title: 'RESTART-ONE' }))
  drop(profile, 'r2', intake({ id: 'restart-2', title: 'RESTART-TWO' }))
  await pollFor({
    read: () => first.client.evaluate(BADGE_TEXT),
    settled: (text) => text === '2',
    timeoutMs: 15_000,
    label: '前置：重啟之前計數是 2',
  })

  // 同一個 profile 重開。**計數來自非同步的 IPC，必須輪詢而不是量一次。**
  const second = await freshApp(context, { profile, configDir, stub, marker, port: RESTART_PORT })
  const after = await pollFor({
    read: () => second.client.evaluate(BADGE_TEXT),
    settled: (text) => text === '2',
    timeoutMs: 20_000,
    label: '重啟後計數仍是 2',
  })
  check(results, '計數跨重啟保留', after === '2', `得到 ${JSON.stringify(after)}`)
}

/**
 * 通知 —— **回補要通知，落盤中既有的不重新通知**。
 *
 * 這兩半在同一段裡，因為它們互為對方的錨：只驗後半的話，一個「啟動後一律靜默」的實作全綠，
 * 而那正好掏空這個能力最主要的使用情境（app 關著的期間被提及）。
 *
 * 兩半的**前提造法不同**：回補用落點放檔案（那是到達），既有的用直接 seed 落盤狀態
 * （在落點放檔案造出來的是到達，會通知）。
 */
async function runNotifyBackfill(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  // 落盤中已有三則待處理項目 —— 它們**不是**到達。
  seedStore(profile, [
    { id: 'seeded-1', title: 'SEEDED-ONE' },
    { id: 'seeded-2', title: 'SEEDED-TWO' },
    { id: 'seeded-3', title: 'SEEDED-THREE' },
  ])
  // 而落點裡有一份 app 沒執行時投遞的 —— 它**是**到達。
  drop(profile, 'backfill', intake({ id: 'backfill-1', title: 'BACKFILL-TITLE' }))

  const app = await freshApp(context, { profile, configDir, stub, marker })
  await pollFor({
    read: () => app.client.evaluate(BADGE_TEXT),
    settled: (text) => text === '4',
    timeoutMs: 20_000,
    label: '前置：三則既有 + 一則回補都進來了',
  })

  await new Promise((resolve) => setTimeout(resolve, WINDOW_WAIT_MS))
  const sent = notifications(profile)
  check(
    results,
    '關閉期間投遞的項目於啟動時進來仍然通知，而落盤中既有的不重新通知（恰一則）',
    sent.length === 1,
    `發出 ${sent.length} 則：${JSON.stringify(sent).slice(0, 200)}`,
  )
  check(
    results,
    '通知的標題不含投遞提供的任何值',
    sent.length === 1 && !sent[0].title.includes('BACKFILL-TITLE'),
    JSON.stringify(sent[0] ?? null),
  )
  check(
    results,
    '通知的內文帶得出那一則（反向的錨）',
    sent.length === 1 && sent[0].body.includes('BACKFILL-TITLE'),
    JSON.stringify(sent[0] ?? null),
  )
}

/** 合併、拒絕不通知，以及縮減。 */
async function runNotifyContent(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  const app = await freshApp(context, { profile, configDir, stub, marker })

  // 一次投十則 —— 全部落在同一個窗裡。
  for (let i = 0; i < 10; i += 1) {
    drop(profile, `m${i}`, intake({ id: `merge-${i}`, title: `MERGE-${i}` }))
  }
  // 外加兩則會被拒絕的：識別碼不合法，以及識別碼搶佔。
  drop(profile, 'bad', { id: '..', origin: { kind: 'slack', id: 'C1' }, title: 'x', body: 'y' })
  drop(profile, 'seize', intake({ id: 'merge-0', title: 'SEIZED-TITLE' }))

  await pollFor({
    read: () => app.client.evaluate(BADGE_TEXT),
    settled: (text) => text === '10',
    timeoutMs: 25_000,
    label: '前置：十則都進來了',
  })
  await new Promise((resolve) => setTimeout(resolve, WINDOW_WAIT_MS))

  const sent = notifications(profile)
  check(
    results,
    '窗內的多則合併為一則，且被拒絕的投遞不發出通知',
    sent.length === 1,
    `發出 ${sent.length} 則：${JSON.stringify(sent).slice(0, 200)}`,
  )
  const whole = sent.map((one) => `${one.title}\n${one.body}`).join('\n')
  check(
    results,
    '合併的那一則不含任何第三方文字',
    !/MERGE-|SEIZED-TITLE/.test(whole),
    whole.slice(0, 160),
  )

  // 縮減：標記字元與 URL 都不得抵達作業系統那一層。
  drop(
    profile,
    'reduce',
    intake({ id: 'reduce-1', title: 'BEFORE <b>BOLD</b> https://evil.example/beacon AFTER' }),
  )
  await new Promise((resolve) => setTimeout(resolve, WINDOW_WAIT_MS))
  const reduced = notifications(profile).at(-1)
  check(
    results,
    '交給作業系統的字串不含標記字元，也不含 URL',
    Boolean(reduced) &&
      !/[<>&]/.test(reduced.body) &&
      !reduced.body.includes('evil.example') &&
      reduced.body.includes('BEFORE') &&
      reduced.body.includes('AFTER'),
    JSON.stringify(reduced ?? null),
  )
}

/**
 * 觸發通知 ⇒ 視窗到前景 ＋ 打開收件匣。
 *
 * 「已開啟時是無操作」這條**需要收據**：第二次觸發若根本沒抵達 renderer，分頁當然還在
 * routing —— 綠的。收據把「規格要求的無操作」與「訊息根本沒送到」分開。
 */
async function runNotifyActivate(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  const app = await freshApp(context, { profile, configDir, stub, marker })
  drop(profile, 'a1', intake({ id: 'activate-1', title: 'ACTIVATE-TITLE' }))
  await pollFor({
    read: () => app.client.evaluate(BADGE_TEXT),
    settled: (text) => text === '1',
    timeoutMs: 15_000,
    label: '前置：那一則進來了',
  })
  check(
    results,
    '前置：收件匣此刻未開啟',
    (await app.client.evaluate(`!document.querySelector('[role="dialog"]${label('intake.label')}')`)) === true,
    '未開啟',
  )

  fireNotification(profile, 1)
  const opened = await pollFor({
    read: () =>
      app.client.evaluate(`!!document.querySelector('[role="dialog"]${label('intake.label')}')`),
    settled: (open) => open === true,
    timeoutMs: 15_000,
    label: '觸發之後收件匣打開',
  })
  check(results, '觸發通知後收件匣呈現', opened === true, String(opened))

  // 切到 routing 規則分頁，並在某個欄位輸入一半。
  await retryAction({
    act: () => app.client.evaluate(tabClick('intake.rules.label')),
    read: () => app.client.evaluate(`!!document.querySelector('${label('intake.rules.add')}')`),
    settled: (present) => present === true,
    attemptWindowMs: 3000,
    timeoutMs: 15_000,
    label: '切到 routing 規則分頁',
  })
  await retryAction({
    act: () => app.client.evaluate(`(() => {
      const add = document.querySelector('${label('intake.rules.add')}')
      if (!add) return false
      add.click()
      return true
    })()`),
    read: () => app.client.evaluate(`!!document.querySelector('${label('intake.rules.contains')}')`),
    settled: (present) => present === true,
    attemptWindowMs: 3000,
    timeoutMs: 15_000,
    label: '新增一條規則',
  })
  const typed = await app.client.evaluate(`(() => {
    const input = document.querySelector('${label('intake.rules.contains')}')
    if (!input) return 'no-input'
    // React 的受控輸入不吃直接指派 —— 要走原型上的 setter 再送一次 input 事件。
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'HALF-TYPED')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.focus()
    return input.value
  })()`)
  check(results, '前置：規則的欄位裡確實輸入了一半', typed === 'HALF-TYPED', String(typed))

  const before = receipts(profile).length
  fireNotification(profile, 2)
  await pollFor({
    read: () => receipts(profile).length,
    settled: (count) => count > before,
    timeoutMs: 15_000,
    label: '第二次觸發確實抵達了主行程',
  })
  await new Promise((resolve) => setTimeout(resolve, 800))

  const state = await app.client.evaluate(`(() => {
    const input = document.querySelector('${label('intake.rules.contains')}')
    return {
      onRules: !!document.querySelector('${label('intake.rules.add')}'),
      value: input ? input.value : null,
      active: ${ACTIVE_LABEL},
    }
  })()`)
  check(
    results,
    '收件匣已開啟時觸發通知不重設分頁、不清掉輸入中的內容、不改變焦點',
    state?.onRules === true && state.value === 'HALF-TYPED' && state.active === copy('intake.rules.contains'),
    `${JSON.stringify(state)}｜收據 ${receipts(profile).length} 筆`,
  )

  // 關閉之後焦點回到入口。
  await retryAction({
    act: () =>
      app.client.evaluate(`(() => {
        const close = document.querySelector('[role="dialog"]${label('intake.label')} ${label('intake.close')}')
        if (!close) return false
        close.click()
        return true
      })()`),
    read: () =>
      app.client.evaluate(`!document.querySelector('[role="dialog"]${label('intake.label')}')`),
    settled: (closed) => closed === true,
    attemptWindowMs: 3000,
    timeoutMs: 15_000,
    label: '關閉收件匣',
  })
  check(
    results,
    '由通知開啟並關閉之後焦點回到活動列的入口',
    (await app.client.evaluate(ACTIVE_LABEL)) === copy('activityBar.handoffs'),
    String(await app.client.evaluate(ACTIVE_LABEL)),
  )
}

/**
 * **收件匣開著時，一次收件匣變動不得把焦點搶走。**
 *
 * 這一條擋的是一個既有的、被這個 change 引爆的缺陷：overlay 的「聚焦關閉鈕」effect 若跟著
 * 父層每次渲染重建的回呼走，活動列一旦訂閱收件匣狀態（計數），每一次變動都會把焦點搶回去
 * —— 而使用者可能正在編輯 routing 規則。
 */
async function runFocusStability(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  const app = await freshApp(context, { profile, configDir, stub, marker })
  await openInbox(app)

  // 把焦點放到一個**不是關閉鈕**的地方。
  const moved = await app.client.evaluate(tabFocus('intake.rules.label'))
  const anchored = await app.client.evaluate(
    `document.activeElement ? (document.activeElement.getAttribute('aria-label') ?? document.activeElement.textContent) : null`,
  )
  check(
    results,
    '前置：焦點確實被移到別的地方',
    moved === true && anchored !== copy('intake.close'),
    `moved=${moved} active=${anchored}`,
  )

  // 投一則 —— 這會讓計數改變，於是活動列重繪。
  drop(profile, 'f1', intake({ id: 'focus-1', title: 'FOCUS-TITLE' }))
  await pollFor({
    read: () => app.client.evaluate(itemTextExpression('FOCUS-TITLE')),
    settled: (text) => text.includes('FOCUS-TITLE'),
    timeoutMs: 15_000,
    label: '那一則已呈現（前置：變動確實抵達了畫面）',
  })
  await new Promise((resolve) => setTimeout(resolve, 500))

  const after = await app.client.evaluate(
    `document.activeElement ? (document.activeElement.getAttribute('aria-label') ?? document.activeElement.textContent) : null`,
  )
  check(
    results,
    '收件匣變動不把焦點搶回關閉鈕',
    after === anchored,
    `變動前 ${anchored}｜變動後 ${after}`,
  )
}

/**
 * 位數超出可容納範圍 —— 三位數以 `99+` 呈現，且入口的尺寸不變。
 *
 * **以 seed 落盤狀態造出前提**：待處理總量上限是 200，靠真的投遞一百多份檔案既慢又沒有
 * 多驗到任何東西。
 */
async function runBadgeOverflow(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  const many = []
  for (let i = 0; i < 123; i += 1) many.push({ id: `many-${i}`, title: `MANY-${i}` })
  seedStore(profile, many)

  const app = await freshApp(context, { profile, configDir, stub, marker })
  const rect = await pollFor({
    read: () => app.client.evaluate(HANDOFFS_RECT),
    settled: (value) => value?.badge != null && value.badge !== '',
    timeoutMs: 20_000,
    label: '計數標示出現',
  })
  check(results, '三位數以不改變尺寸的形式呈現', rect?.badge === '99+', JSON.stringify(rect))
  check(
    results,
    '三位數時入口的尺寸與個位數時相同',
    rect?.w === 36 && rect.h === 36,
    JSON.stringify(rect),
  )
}

// ── 交接（`agent-handoff-source`）────────────────────────────────────────────

/**
 * 點 rail 上叫這個名字的那一列。
 *
 * **不寫成屬性選擇器的字面形式**：`aria-label-source` 那道守衛擋的是「把文案硬編進選擇器」，
 * 而 rail 列的標籤是 **folder 的名稱**（資料，不是字典裡的文案）—— 它不會隨改文案而漂移。
 * 以執行期比對屬性值表達，既說得清楚也不必去放寬那道守衛。
 */
function railRowClick(name) {
  return `[...document.querySelectorAll('[aria-label]')]`
    + `.find((b) => b.getAttribute('aria-label') === ${JSON.stringify(name)})?.click();`
}

/**
 * rail 上目前選中的是哪一項。
 *
 * **判準是「選中的那一項」而不是 `document.activeElement`** —— 後者在虛擬螢幕上不穩定，
 * 而規格要說的是「使用者正在看的那個 repo 沒有被換掉」。
 */
const RAIL_SELECTION = `(() => {
  const current = document.querySelector('[aria-current="true"]')
  return current ? (current.getAttribute('aria-label') ?? current.textContent ?? '') : '(none)'
})()`

/** 交接的投遞落點根 —— 與主行程的 `outboxRoot()` 同一個推導。 */
function outboxRootOf(profile) {
  return join(profile, 'handoff', 'outbox')
}

/** 寫一份偏好檔。**目前只有交接的開關需要它**（其餘段落都用預設）。 */
function seedPreferences(profile, terminal) {
  writeFileSync(join(profile, 'preferences.json'), JSON.stringify({ version: 1, terminal }))
}

/**
 * 等某個 agent session 的投遞落點出現，並回傳它的絕對路徑。
 *
 * **落點的目錄名就是 sessionId，而那是 renderer 產生的** —— 探針算不出來，只能等它出現。
 * 那個「算不出來」正是來源身分的依據：agent 收到的是一個它沒得挑的目錄。
 */
async function awaitOutbox(profile, label_) {
  const root = outboxRootOf(profile)
  const name = await pollFor({
    read: () => (existsSync(root) ? readdirSync(root) : []),
    settled: (names) => names.length >= 1,
    timeoutMs: 25_000,
    label: label_,
  })
  return join(root, name[0])
}

/**
 * 交接的端到端路徑。
 *
 * **來源必須是一個真的 agent session** —— 落點是 spawn 時才建立的，而它的目錄名就是來源身分。
 * 因此這一段先用既有的接受路徑在第一個 folder 開一個 session，再從**它的**落點投遞。
 */
async function runHandoff(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  /**
   * **可控的就緒延遲，與 `runAcceptPrefill` 同一個理由。**
   *
   * 零延遲時替身幾乎在 pty 誕生的同一瞬間宣告就緒，而這一段的建立路徑比手動接受多一次
   * IPC 往返 —— 實測約一半的機率連**來源** session 的 prompt 都收不到（收據為空，
   * 而 context 檔與 pty 都在）。那是替身太快，不是產品沒寫。
   */
  //
  // **`busySeconds`**：收到一行時先宣告忙碌 —— 「使用者送出」唯一的線索是 agent 開始工作
  // （intake-inbox-usability）。它只在收到一行時作用，在此之前的斷言不受影響。
  const stub = makeStubAgent(mkTemp, configDir, { readyDelaySeconds: 2, busySeconds: 1 })

  drop(profile, 'source', intake({ id: 'src-1', title: 'SOURCE-TITLE' }))

  const app = await freshApp(context, { profile, configDir, stub, marker })
  await openInbox(app)
  await pollFor({
    read: () => app.client.evaluate(acceptExpression('SOURCE-TITLE')),
    settled: Boolean,
    timeoutMs: 20_000,
    label: '來源 session 已由接受路徑建立',
  })

  const outbox = await awaitOutbox(profile, '來源 session 的投遞落點出現')

  /**
   * **自我介紹真的被交出去了。**
   *
   * 可觀察的不是「設定檔裡有那條命令」（那只證明我們寫了它），是**命令的 stdout**。
   * 而 `SessionStart` 上有**兩條**命令（事件橋接 ＋ 自我介紹）—— 兩條都要被執行，
   * 那正是合成器把 hooks 串接而非覆蓋的行為後果。
   */
  const introOut = await pollFor({
    read: () => [1, 2, 3].map((n) => stub.hookStdout('SessionStart', n)),
    settled: (outs) => outs.some((text) => text.includes('additionalContext')),
    timeoutMs: 20_000,
    label: '自我介紹的 stdout 落盤',
  }).catch(() => [1, 2, 3].map((n) => stub.hookStdout('SessionStart', n)))
  const introText = introOut.find((text) => text.includes('additionalContext')) ?? ''
  check(
    results,
    'SessionStart 上兩條注入的命令都被執行',
    stub.hookCommandCount('SessionStart') >= 2,
    `執行了 ${stub.hookCommandCount('SessionStart')} 條`,
  )
  check(results, '自我介紹進入 agent 的脈絡（hook 的 stdout 帶 additionalContext）', introText.includes('additionalContext'), introText.slice(0, 60))
  check(
    results,
    '自我介紹列出 workspace 裡每一個可交接的對象',
    folders.every((folder) => introText.includes(basename(folder.path))),
    introText.slice(0, 200),
  )
  check(results, '自我介紹告知這個 session 自己的投遞落點', introText.includes(basename(outbox)), basename(outbox))

  const sessionsBefore = ptySessionPids(marker).length

  /**
   * **前置：rail 上真的有一個選中的項目。**
   *
   * 少了它，「前後相同」在兩邊都是 `(none)` 時恆真 —— 一個把焦點切到新 session 的實作
   * 照樣通過（第一版就是這樣，實測前後都是 `(none)`）。
   */
  const sourceName = basename(folders[0].path)
  const inboxDialog = `[role="dialog"]${label('intake.label')}`
  const handoffsEntry = label('activityBar.handoffs')
  const selectRail = `(() => {
    const d = document;
    if (d.querySelector(${JSON.stringify(inboxDialog)})) d.querySelector(${JSON.stringify(handoffsEntry)}).click();
    if (d.querySelector('[aria-current="true"]')) return true;
    ${railRowClick(sourceName)}
    return !!d.querySelector('[aria-current="true"]');
  })()`
  await pollFor({
    read: () => app.client.evaluate(selectRail),
    settled: Boolean,
    timeoutMs: 15_000,
    label: 'rail 上已有選中的項目',
  })
  const railBefore = await app.client.evaluate(RAIL_SELECTION)
  check(results, '前置：rail 上確實有一個選中的項目', railBefore !== '(none)', railBefore)

  /**
   * **等來源那一則的合併窗結算完再投遞交接。**
   *
   * 兩者若落在同一個窗裡就會合併成一則，而合併的通知依規格是「打開收件匣」——
   * 於是「交接的通知聚焦它建立的 session」那條測不到（實測：`keys` 裡兩則都在）。
   * 這不是產品的問題，是這一段要造的前提。
   */
  await new Promise((resolve) => setTimeout(resolve, WINDOW_WAIT_MS))

  // ── 交接 ──
  writeFileSync(
    join(outbox, 'h1.json'),
    JSON.stringify({ target: basename(folders[1].path), title: 'HANDOFF-TITLE', body: HANDOFF_BODY }),
  )

  const sessionsAfter = await pollFor({
    read: () => ptySessionPids(marker).length,
    settled: (count) => count > sessionsBefore,
    timeoutMs: 30_000,
    label: '目標 folder 出現一個新的 agent session',
  }).catch(() => ptySessionPids(marker).length)
  check(results, '交接於到達時直接建立 session（使用者未執行任何接受動作）', sessionsAfter > sessionsBefore, `前=${sessionsBefore} 後=${sessionsAfter}`)

  /**
   * **待送出的標示，而不是替身的位元組收據。**
   *
   * 收據是**整個替身共用一份**（同一個 `$HOME`），三個並行的 session 寫進同一個檔案 ——
   * 「新增了幾則」在那上面是不可靠的（實測：三個 prefill 全部 `fill()` 了，收據只看得到兩則）。
   * 而這裡真正要斷言的是 requirement 說的事：**prompt 填好了、而且還沒被送出**，
   * 那正是這個標示的語意，且它是 per-session 的。
   *
   * 標示只在該 folder 被顯示時才在 DOM 裡 —— 因此**先驗焦點沒被切走，再由探針自己切過去**
   * （那是使用者的動作，不是系統的）。
   */
  const railAfter = await app.client.evaluate(RAIL_SELECTION)
  check(results, 'rail 上選中的項目未因交接而改變', railAfter === railBefore, `前=${railBefore} 後=${railAfter}`)

  const targetName = basename(folders[1].path)
  await pollFor({
    read: () =>
      app.client.evaluate(`(() => {
        ${railRowClick(targetName)}
        return ${RAIL_SELECTION} === ${JSON.stringify(targetName)}
      })()`),
    settled: Boolean,
    timeoutMs: 15_000,
    label: '切到目標 folder（使用者的動作）',
  })

  const badge = label('intake.prefillPending')
  const pending = await pollFor({
    read: () => app.client.evaluate(`!!document.querySelector(${JSON.stringify(badge)})`),
    settled: Boolean,
    timeoutMs: 30_000,
    label: '新 session 上出現「待送出」的標示',
  }).catch(() => false)
  check(results, '第一則 prompt 填入新 session 的輸入處且標示為待送出', pending === true, `pty=${ptySessionPids(marker).length}`)
  check(
    results,
    '該 prompt 未被送出（沒有任何一行進入 agent 的紀錄）',
    stub.input() === '',
    JSON.stringify(stub.input().slice(0, 60)),
  )

  // 收件匣裡看得見「已經開好」那一段 —— 否則使用者收到通知、打開收件匣、什麼都沒有。
  await openInbox(app)
  const openedText = await pollFor({
    read: () => app.client.evaluate(`document.querySelector('${label('intake.openedLabel')}')?.textContent ?? ''`),
    settled: (text) => text.includes('HANDOFF-TITLE'),
    timeoutMs: 15_000,
    label: '已開好的那一則呈現於收件匣',
  }).catch(() => '')
  check(results, '已建立 session 的交接在收件匣中看得見（含它開在哪裡）', openedText.includes('HANDOFF-TITLE'), openedText.slice(0, 120))

  /**
   * **本文的全文不被截斷。**
   *
   * 這裡是 first-party 本文**唯一**的呈現位置（交接從不停留於待處理，`IntakeCard` 那一段
   * 永遠不會顯示它）。頭尾兩個標記都要在 —— 只驗頭的話，一個「截斷到前 N 字元」的實作
   * 照樣全綠。
   */
  check(
    results,
    '已建立 session 的交接其本文全文呈現且未被截斷',
    openedText.includes('HANDOFF-BODY-HEAD') && openedText.includes('HANDOFF-BODY-TAIL'),
    `頭=${openedText.includes('HANDOFF-BODY-HEAD')} 尾=${openedText.includes('HANDOFF-BODY-TAIL')} 長度=${openedText.length}`,
  )

  // 長度是「這則很長」唯一看得見的訊號，而這一段此前沒有它。
  check(
    results,
    '已建立 session 的交接其呈現附上本文的長度',
    openedText.includes(copy('intake.bodyLength', { count: HANDOFF_BODY.length })),
    `找的是「${copy('intake.bodyLength', { count: HANDOFF_BODY.length })}」`,
  )

  /**
   * **跨行程的那一條 —— 交接這條路徑此前沒有它。**
   *
   * 既有的同形斷言（`runAcceptPrefill`）比對的是 `IntakeCard` 那一列，而 first-party 的本文
   * 根本不在那裡呈現。於是「交付的內容逐字元等於呈現的內容」在**交接**上從未被驗過。
   *
   * 對照組：把截斷加進這一段的渲染，這條必須變紅。
   */
  const handoffContextDir = join(profile, 'intake')
  const handoffContextFile = existsSync(handoffContextDir)
    ? readdirSync(handoffContextDir).find((name) => name.endsWith('.md'))
    : undefined
  const handoffContents = handoffContextFile
    ? readFileSync(join(handoffContextDir, handoffContextFile), 'utf8')
    : ''
  const handoffFenced =
    handoffContents.match(/<<<untrusted-[0-9a-f]+>>>\n([\s\S]*)\n<<<\/untrusted-[0-9a-f]+>>>/)?.[1] ?? null
  check(
    results,
    '交接：交給 agent 的內容逐字元等於呈現給使用者的本文',
    handoffFenced !== null && openedText.includes(handoffFenced),
    handoffFenced === null
      ? `(無界線) 檔案=${handoffContextFile ?? '無'}`
      : `檔案內 ${handoffFenced.length} 字元，畫面 ${openedText.length} 字元`,
  )

  /**
   * **通知的效果分流。**
   *
   * 一則已經開好 session 的交接，其通知 SHALL 聚焦那個 session，SHALL NOT 打開收件匣 ——
   * 它在收件匣裡沒有任何待辦動作，把使用者送去那裡等於要他再點一次。
   *
   * 前置有兩個，缺一這條就恆真：**收件匣此刻是關的**（否則「沒有打開」無從分辨），
   * 且**rail 選的不是目標 folder**（否則「切過去了」無從分辨）。
   */
  // **關閉走 overlay 自己的關閉鈕**，不是再點一次活動列的入口 —— 那個入口只負責開啟，
  // 而 overlay 是全視窗的，點擊也到不了它（實測：窗口耗盡，收件匣一直開著）。
  const closeButton = label('intake.close')
  await pollFor({
    read: () => app.client.evaluate(`(() => {
      const d = document
      const dialog = d.querySelector(${JSON.stringify(inboxDialog)})
      if (dialog) dialog.querySelector(${JSON.stringify(closeButton)})?.click()
      return !d.querySelector(${JSON.stringify(inboxDialog)})
    })()`),
    settled: Boolean,
    timeoutMs: 15_000,
    label: '前置：收件匣已關閉',
  })
  /**
   * **切回來源 folder** —— 上面為了看「待送出」的標示已經切到目標去了。
   * 少了這一步，「通知把我帶到那個 session」與「我本來就在那裡」分不開。
   */
  await pollFor({
    read: () =>
      app.client.evaluate(`(() => {
        ${railRowClick(sourceName)}
        return ${RAIL_SELECTION} === ${JSON.stringify(sourceName)}
      })()`),
    settled: Boolean,
    timeoutMs: 15_000,
    label: '切回來源 folder',
  })
  const railBeforeActivate = await app.client.evaluate(RAIL_SELECTION)
  check(results, '前置：rail 選的不是目標 folder', railBeforeActivate !== basename(folders[1].path), railBeforeActivate)

  /**
   * **等那一則通知真的被呈現了再觸發。**
   *
   * 觸發檔模擬的是「點了**最新**的那一則」，而合併窗是秒級的 —— 在它結算之前按下去，
   * 觸發到的是**上一則**，於是這條斷言測的是別的東西（實測三次有兩次）。
   * 替身把每一則涵蓋的主鍵一起落盤，正是為了讓這個前置寫得出來。
   */
  const presented = await pollFor({
    read: () => notifications(profile),
    settled: (list) => list.some((entry) => (entry.keys ?? []).some((key) => key.adapter === 'handoff')),
    timeoutMs: 20_000,
    label: '交接的那一則通知已呈現',
  }).catch(() => notifications(profile))
  const handoffNotice = presented.filter((entry) => (entry.keys ?? []).some((key) => key.adapter === 'handoff'))
  check(
    results,
    '前置：最新的那一則通知恰好涵蓋這一則交接',
    handoffNotice.length === 1 && handoffNotice[0].keys.length === 1,
    JSON.stringify(handoffNotice.map((entry) => entry.keys)),
  )

  fireNotification(profile, 1)
  const afterActivate = await pollFor({
    read: () =>
      app.client.evaluate(`(() => ({
        inbox: !!document.querySelector(${JSON.stringify(inboxDialog)}),
        rail: ${RAIL_SELECTION},
      }))()`),
    settled: (state) => state.rail === basename(folders[1].path),
    timeoutMs: 20_000,
    label: '觸發通知之後焦點落在交接建立的 session',
  }).catch(() =>
    app.client.evaluate(`(() => ({
      inbox: !!document.querySelector(${JSON.stringify(inboxDialog)}),
      rail: ${RAIL_SELECTION},
    }))()`),
  )
  check(
    results,
    '觸發交接的通知會聚焦它建立的 session',
    afterActivate.rail === basename(folders[1].path),
    `rail=${afterActivate.rail}`,
  )
  check(results, '觸發交接的通知不打開收件匣', afterActivate.inbox === false, `inbox=${afterActivate.inbox}`)

  /**
   * **送出之後，它離開已開好那一段**（intake-inbox-usability）。
   *
   * 焦點此刻在交接建立的那個 session（上一條剛驗過）。Enter 必須是**真的**按鍵事件 ——
   * 併進文字送出的換行不會被 xterm 當成 Enter。收據是替身讀到的那一行。
   *
   * 反向對照：**由接受路徑建立、而 prompt 沒有送出的那一則（SOURCE-TITLE）必須還在** ——
   * 否則「已開好那一段整個被清空」也會讓這條通過。
   */
  const focusTerminal = `(() => {
    const visible = [...document.querySelectorAll('.xterm-helper-textarea')].find((area) => {
      const rect = area.closest('.xterm')?.getBoundingClientRect()
      return rect && rect.width > 0 && rect.height > 0
    })
    if (!visible) return false
    visible.focus()
    return document.activeElement === visible
  })()`
  const submitted = await retryAction({
    act: async () => {
      if (await app.client.evaluate(focusTerminal)) await pressKey(app.client, 'Enter')
    },
    read: () => stub.input(),
    settled: (input) => input !== '',
    attemptWindowMs: 4000,
    timeoutMs: 20_000,
    label: '於交接建立的 session 送出',
  })
  await openInbox(app)
  const afterSubmit = await pollFor({
    read: () => app.client.evaluate(`document.querySelector('${label('intake.openedLabel')}')?.textContent ?? ''`),
    settled: (text) => !text.includes('HANDOFF-TITLE'),
    timeoutMs: 20_000,
    label: '送出之後交接離開已開好那一段',
  })
  const handoffEntry = JSON.parse(readFileSync(join(profile, 'intake.json'), 'utf8')).entries.find(
    (entry) => entry.content?.authored?.title === 'HANDOFF-TITLE',
  )
  check(
    results,
    '送出之後不再呈現，且了結落盤',
    submitted !== '' &&
      !afterSubmit.includes('HANDOFF-TITLE') &&
      afterSubmit.includes('SOURCE-TITLE') &&
      typeof handoffEntry?.settledAt === 'number',
    `送出=${JSON.stringify(submitted.slice(0, 40))} 仍在=${afterSubmit.includes('HANDOFF-TITLE')} 來源仍在=${afterSubmit.includes('SOURCE-TITLE')} settledAt=${handoffEntry?.settledAt}`,
  )
}

/**
 * 交接的失敗必須自己發聲，以及偏好關閉時連既有落點都不處理。
 *
 * **這一段比其他段落更重**：接受那個環節已經沒有人在看，少了它，一次失敗的交接與
 * 「什麼都沒發生」在畫面上完全相同 —— 而使用者會以為工作已經交出去了。
 */
async function runHandoffFailure(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  drop(profile, 'source', intake({ id: 'src-2', title: 'SOURCE-TITLE' }))
  const app = await freshApp(context, { profile, configDir, stub, marker })
  await openInbox(app)
  await pollFor({
    read: () => app.client.evaluate(acceptExpression('SOURCE-TITLE')),
    settled: Boolean,
    timeoutMs: 20_000,
    label: '來源 session 已建立',
  })
  const outbox = await awaitOutbox(profile, '投遞落點出現')

  // **量在靜止點** —— 見 `settledNotifications` 的註解（這一行是本 change 的起點）。
  const settledBefore = await settledNotifications(profile, '通知落定（量測 before 之前）')
  const before = settledBefore.length
  const sessionsBefore = ptySessionPids(marker).length

  /**
   * 目標查無 —— 前綴刻意選成**只屬於目標那一個** folder 的前綴。
   *
   * **不能取兩個 folder 的共同前綴**：模糊比對的實作在那裡會得到「歧義」而不是「誤中」，
   * 於是它照樣不建 session，對照組紅不起來（實測踩過一次）。
   */
  writeFileSync(
    join(outbox, 'miss.json'),
    JSON.stringify({ target: basename(folders[1].path).slice(0, -3), title: 'MISS', body: 'x' }),
  )

  const after = await pollFor({
    read: () => notifications(profile),
    settled: (list) => list.length > before,
    timeoutMs: 25_000,
    label: '查無目標發出通知',
  }).catch(() => notifications(profile))

  /**
   * **比對內容，不只比對數量。**
   *
   * 「多了一則通知」是一個方便取得的量，它對「**哪一則**」完全沉默 —— 而這條斷言在乎的正是
   * 那件事。比對的是拒絕的**類別說明**（`intake.rejectReason.TARGET_NOT_FOUND`）：
   * **不比對目標原字串** —— 既有 requirement 明文禁止通知內文含 folder 名稱。
   */
  const reason = copy('intake.rejectReason.TARGET_NOT_FOUND')
  const arrived = after.slice(before)
  const named = arrived.filter((n) => `${n.title ?? ''} ${n.body ?? ''}`.includes(reason))
  check(
    results,
    '目標查無時發出通知（這條路徑上沒有人在等著按接受）',
    named.length > 0,
    `前=${before} 後=${after.length} 新增=${JSON.stringify(arrived.map((n) => n.body ?? n.title))} 找的是「${reason}」`,
  )
  check(
    results,
    '目標查無時不建立任何 session',
    ptySessionPids(marker).length === sessionsBefore,
    `前=${sessionsBefore} 後=${ptySessionPids(marker).length}`,
  )
  check(
    results,
    '前綴不算命中（模糊比對的實作會在這裡開出一個 session）',
    ptySessionPids(marker).length === sessionsBefore,
  )

  await openInbox(app)
  const rejected = await pollFor({
    read: () => app.client.evaluate(`document.body.textContent ?? ''`),
    settled: (text) => /rejected|Rejected/.test(text),
    timeoutMs: 15_000,
    label: '拒絕呈現於收件匣',
  }).catch(() => '')
  check(results, '該失敗同時呈現於收件匣之內', /rejected|Rejected/.test(rejected))

  /**
   * **共用攝入路徑上的永久性失敗同樣可見。**
   *
   * 本文過長（`TOO_LONG`）與投遞過大（`TOO_LARGE`）都**不是** adapter 自己算出來的 ——
   * 前者在 `parseIntake`、後者在 `readBounded`，而 `readBounded` 在 `deliver` **之前**就
   * 消費掉檔案並 return。把通知接在 adapter 的 `deliver` 裡，這兩條結構上都通知不出來，
   * 而那正是這個 change 的起點（一則本文過長的交接被消費、無通知、無痕跡）。
   */
  for (const [name, payload, code] of [
    [
      'over-long.json',
      JSON.stringify({ target: basename(folders[1].path), title: 'TOO-LONG', body: 'x'.repeat(21_000) }),
      'TOO_LONG',
    ],
    [
      'over-big.json',
      JSON.stringify({ target: basename(folders[1].path), title: 'TOO-BIG', body: 'x'.repeat(600_000) }),
      'TOO_LARGE',
    ],
  ]) {
    const quiet = await settledNotifications(profile, `通知落定（${code} 之前）`)
    const sessionsHere = ptySessionPids(marker).length
    writeFileSync(join(outbox, name), payload)
    const reason = copy(`intake.rejectReason.${code}`)
    const arrivedNow = await pollFor({
      read: () => notifications(profile),
      settled: (list) => list.slice(quiet.length).some((n) => `${n.title ?? ''} ${n.body ?? ''}`.includes(reason)),
      timeoutMs: 25_000,
      label: `${code} 發出通知`,
    }).catch(() => notifications(profile))
    const newOnes = arrivedNow.slice(quiet.length)
    check(
      results,
      `${code}：共用攝入路徑上的永久性失敗同樣發出通知`,
      newOnes.some((n) => `${n.title ?? ''} ${n.body ?? ''}`.includes(reason)),
      `新增=${JSON.stringify(newOnes.map((n) => n.body ?? n.title))} 找的是「${reason}」`,
    )
    check(
      results,
      `${code}：不建立任何 session`,
      ptySessionPids(marker).length === sessionsHere,
      `前=${sessionsHere} 後=${ptySessionPids(marker).length}`,
    )
  }

  // 寫到一半的投遞：**不消費、不通知**（每次補寫都會再被讀到，逐次通知沒有上界）。
  const notifiedBefore = notifications(profile).length
  writeFileSync(join(outbox, 'partial.json'), '{"target":"beta","bo')
  await new Promise((resolve) => setTimeout(resolve, 2500))
  check(
    results,
    '寫到一半的投遞不發通知，且不被消費',
    notifications(profile).length === notifiedBefore && existsSync(join(outbox, 'partial.json')),
    `通知 ${notifiedBefore}→${notifications(profile).length}`,
  )

  /**
   * **呈現要能認得出是哪一件事失敗。**
   *
   * 此前這裡只有一個總數（「N 則投遞被拒絕」）—— 它回答不了「哪一則」「為什麼」
   * 「我要怎麼辦」中的任何一個。而說明原因的文案（`intake.rejectReason`）早就寫好了，
   * 只是**沒有任何消費者**。
   */
  await openInbox(app)
  const missTarget = basename(folders[1].path).slice(0, -3)
  const detailed = await pollFor({
    read: () => app.client.evaluate('document.body.textContent ?? \'\''),
    settled: (text) => text.includes(copy('intake.rejectReason.TARGET_NOT_FOUND')),
    timeoutMs: 15_000,
    label: '拒絕的類別呈現於收件匣',
  }).catch(() => '')
  check(
    results,
    '拒絕的呈現說得出類別與投遞者寫下的目標',
    detailed.includes(copy('intake.rejectReason.TARGET_NOT_FOUND')) && detailed.includes(missTarget),
    `類別=${detailed.includes(copy('intake.rejectReason.TARGET_NOT_FOUND'))} 目標=${detailed.includes(missTarget)}`,
  )

  /**
   * **逐則清除。**
   *
   * 一次清光全部會讓使用者為了清掉一則第三方投遞的格式錯誤，順手清掉一則他還沒處理的
   * 交接失敗 —— 而後者正是這條通道存在的理由。
   */
  const noticeCount = `document.querySelectorAll('${label('intake.dismissNotice')}').length`
  const beforeDismiss = await app.client.evaluate(noticeCount)
  const dismissed = await app.client.evaluate(`(() => {
    const button = document.querySelector('${label('intake.dismissNotice')}')
    if (!button) return false
    button.click()
    return true
  })()`)
  const afterDismiss = await pollFor({
    read: () => app.client.evaluate(noticeCount),
    settled: (n) => n < beforeDismiss,
    timeoutMs: 15_000,
    label: '逐則清除之後少一則',
  }).catch(() => beforeDismiss)
  check(
    results,
    '痕跡可被逐則清除，其餘的仍在',
    dismissed === true && afterDismiss === beforeDismiss - 1 && afterDismiss > 0,
    `前=${beforeDismiss} 後=${afterDismiss}`,
  )

  /**
   * **失敗的呈現活過重新啟動。**
   *
   * 這是「拒絕必須可見」能否成立的最後一段：一則只活在行程記憶體中的警示，其可見性取決於
   * 使用者在關掉應用程式之前剛好打開過收件匣 —— 而促使他去打開收件匣的那個訊號（通知）
   * 正是同一條路徑上的東西。兩者同時只在一次執行之內有效時，「可見」在實際使用中等於
   * 「不可見」。
   *
   * **port 借用 `RESTART_PORT`** —— 段落是依序跑的，前一個重啟段落此刻已經結束。
   */
  const restarted = await freshApp(context, { profile, configDir, stub, marker, port: RESTART_PORT })
  await openInbox(restarted)
  const survived = await pollFor({
    read: () => restarted.client.evaluate(noticeCount),
    settled: (n) => n > 0,
    timeoutMs: 20_000,
    label: '重啟之後痕跡仍在',
  }).catch(() => 0)
  check(
    results,
    '失敗的呈現活過重新啟動',
    survived === afterDismiss,
    `重啟前=${afterDismiss} 重啟後=${survived}`,
  )
}

/** 偏好關閉時：不注入、不建立落點、**既有落點中的內容也不被處理**。 */
async function runHandoffDisabled(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  seedPreferences(profile, { agentHandoff: false })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  // 上一輪留下的落點 —— 關閉之後它的內容也不該被處理。
  const leftover = join(outboxRootOf(profile), 'left-over-session')
  mkdirSync(leftover, { recursive: true })
  writeFileSync(
    join(leftover, 'x.json'),
    JSON.stringify({ target: basename(folders[1].path), title: 'DISABLED-HANDOFF', body: 'x' }),
  )

  drop(profile, 'source', intake({ id: 'src-3', title: 'SOURCE-TITLE' }))
  const app = await freshApp(context, { profile, configDir, stub, marker })
  await openInbox(app)
  await pollFor({
    read: () => app.client.evaluate(acceptExpression('SOURCE-TITLE')),
    settled: Boolean,
    timeoutMs: 20_000,
    label: '來源 session 已建立（事件回報未受影響）',
  })

  /**
   * **先分開「session 沒建起來」與「預填沒發生」。**
   *
   * 少了這個前置，下一條的失敗訊息兩種成因長得一模一樣，而它們的處置相反
   * （這一段第一版就是這樣紅的，花了兩輪才知道是哪一半）。
   */
  await pollFor({
    read: () => ptySessionPids(marker).length,
    settled: (count) => count >= 1,
    timeoutMs: 30_000,
    label: '前置：來源 session 的 pty 已建立',
  }).catch(() => 0)
  check(results, '前置：來源 session 的 pty 已建立', ptySessionPids(marker).length >= 1, `pty=${ptySessionPids(marker).length}`)

  // 事件回報仍然運作 —— 關掉交接 SHALL NOT 使另一個功能失效。
  await pollFor({
    read: () => stub.bytes(),
    settled: (bytes) => bytes.includes('.md'),
    // **窗口放寬到 40s**：第一版是 25s，而它在載入較重的那一輪耗盡了 —— 同一條斷言
    // 時綠時紅，看起來像產品壞了。預填要等 agent 啟動並 fire `SessionStart`。
    timeoutMs: 40_000,
    label: '關閉交接之後預填仍然運作（啟用狀態彼此獨立）',
  }).catch(() => '')
  check(results, '關閉交接不影響事件回報（預填照常）', stub.bytes().includes('.md'), stub.bytes().slice(0, 60))

  check(
    results,
    '關閉時不為新 session 建立投遞落點',
    !existsSync(join(outboxRootOf(profile), basename(leftover))) || readdirSync(outboxRootOf(profile)).length === 1,
    JSON.stringify(existsSync(outboxRootOf(profile)) ? readdirSync(outboxRootOf(profile)) : []),
  )
  check(
    results,
    '關閉時既有落點中的內容不被處理，且不被消費',
    existsSync(join(leftover, 'x.json')),
    '投遞檔仍在',
  )
  const text = await app.client.evaluate(`document.body.textContent ?? ''`)
  check(results, '關閉時那一則交接不出現在收件匣', !text.includes('DISABLED-HANDOFF'))
}


/**
 * ui-localization：**寫給 agent 執行的指令不隨 UI 語言改變，即使它出現在畫面上。**
 *
 * 這一段的被測狀態是**中文介面**，而它同時斷言三件事：
 *
 * 1. 介面的文字是中文（否則後兩條什麼都沒測到 —— 一個語言根本沒切成功的 app，
 *    當然會看到英文的 prompt）。
 * 2. **被填入輸入處的第一則 prompt 是英文。** 它被寫進 pty、停在游標前等使用者按 Enter，
 *    因此落在 `ui-localization` 第 4 類（「寫進 pty 串流、供人閱讀」）的字面定義之內 ——
 *    而它是那條定義的明文例外，理由是它承載 prompt injection 的措辭，翻譯後的效力
 *    **沒有任何載體能驗**。
 * 3. **交給 agent 的檔案中，界線之外的抬頭也是英文。**（界線之內是投遞者的本文，不歸我們管。）
 *
 * 少了第 1 條，這一段會在「語言切換壞掉」時**照樣全綠** —— 那正是 greenIfAbsent 的形狀。
 */
async function runProtocolLanguage(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  // **在 app 啟動前種入中文** —— `seedLanguage` 只在偏好檔不存在時才寫，因此這一份會留著。
  seedLanguage(profile, { language: 'zh-TW' })

  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir, { readyDelaySeconds: 2 })

  drop(profile, 'zh', intake({ id: 'zh-1', title: 'ZH-PROMPT-TITLE', body: 'body for the agent' }))

  const app = await freshApp(context, { profile, configDir, stub, marker })

  // 前置：介面真的是中文。**收件匣的入口標籤在中文下也變了** —— `aria-label` 同時是選擇器。
  const inboxLabelZh = await pollFor({
    read: () => app.client.evaluate(
      `document.querySelector('[aria-label="${copyIn('zh-TW', 'activityBar.handoffs')}"]') !== null`),
    settled: Boolean,
    timeoutMs: 20_000,
    label: '前置：介面已是中文',
  }).catch(() => false)
  check(results, '前置：被測 app 的介面為中文', inboxLabelZh === true,
    inboxLabelZh ? '' : '找不到中文的收件匣入口 —— 語言沒有切換成功，後兩條因此什麼都沒測到')

  await app.client.evaluate(
    `document.querySelector('[aria-label="${copyIn('zh-TW', 'activityBar.handoffs')}"]')?.click()`)
  await pollFor({
    read: () => app.client.evaluate(acceptExpressionIn('zh-TW', 'ZH-PROMPT-TITLE')),
    settled: Boolean,
    timeoutMs: 20_000,
    label: '按下接受',
  })

  // **等到整則 prompt 到齊，不是等到第一個位元組。** pty 是串流的：以 `.md` 為settled 條件
  // 會在 `Read …/xxxx.md. I` 就返回，於是斷言比對到的是一個截斷的字串 —— 而它看起來像
  // 「prompt 被翻譯了」。以最後一句為界。
  const bytes = await pollFor({
    read: () => stub.bytes(),
    settled: (value) => value.includes('not part of the task'),
    timeoutMs: 30_000,
    label: 'prompt 完整抵達 pty',
  }).catch(() => stub.bytes())

  check(results, '中文介面下，填入輸入處的 prompt 仍為英文',
    bytes.includes('Its fenced section') && bytes.includes('is the task: carry it out'),
    bytes.slice(0, 120))

  const contextDir = join(profile, 'intake')
  const contextFile = readdirSync(contextDir).find((name) => name.endsWith('.md'))
  const contents = contextFile ? readFileSync(join(contextDir, contextFile), 'utf8') : ''
  check(results, '中文介面下，context 檔界線之外的抬頭仍為英文',
    contents.startsWith('The section below was written by a third party.'),
    contents.slice(0, 120))

  // **作業系統通知由主行程發出，它不經 IPC、也不由 renderer 繪製** —— 語言若沒有抵達主行程，
  // 畫面是中文而系統通知還是英文，**而那不會產生任何錯誤**。（這一則於 app 啟動時的回補
  // 路徑上發出，因此此時已經在檔案裡。）
  const sent = notifications(profile)
  const titles = sent.map((n) => n.title)
  check(results, '中文介面下，作業系統通知的文案為中文',
    titles.length > 0 && titles.every((title) => title === copyIn('zh-TW', 'intake.notify.title')),
    JSON.stringify(titles))
}

/**
 * **落點被重新準備之後仍被偵測** —— 而這一段唯一的形狀是「session 是被還原的」。
 *
 * 落點的監看是 app 啟動時對 `outbox/` 根掛一次的，它綁定的是目錄這個**對象**。此前
 * `prepareOutbox()` 在每次 spawn 把落點刪掉再建立 —— 啟動時掛上的監看於是留在一個死掉的
 * 對象上，該 session 的投遞從此石沉大海，而來源 agent 回報它已經交接出去了。
 *
 * **`runHandoff` 驗不到它**：那一段的來源 session 是 app 跑起來**之後**才建立的，它的落點
 * 是全新的目錄（監看以 `addDir` 接上），正好是唯一不受影響的情形。因此這裡必須種一份
 * `sessions.json` 與**對應的落點目錄**，讓監看在啟動時就掛在一個既有的落點上。
 */
async function runHandoffRestored(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, { fallbackFolderId: folders[0].id })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir, { readyDelaySeconds: 2 })

  // **識別碼由探針指定**（而不是像 `runHandoff` 那樣等 renderer 產生）—— 這一段要的正是
  // 「這個落點在 app 啟動之前就存在」，而那要求我們先知道它叫什麼。
  const RESTORED = '3f5a9c11-7d42-4b8e-9a10-5c6d7e8f9a0b'
  const ORPHAN = '7b2e4d08-1c33-4a55-8f66-9d0e1f2a3b4c'
  writeFileSync(
    join(profile, 'sessions.json'),
    JSON.stringify({
      version: 1,
      sessions: [
        { id: RESTORED, folderId: folders[0].id, spawnTarget: 'claude', ordinal: 1, customTitle: 'restored' },
      ],
    }),
  )
  const restoredOutbox = join(outboxRootOf(profile), RESTORED)
  const orphanOutbox = join(outboxRootOf(profile), ORPHAN)
  mkdirSync(restoredOutbox, { recursive: true })
  mkdirSync(orphanOutbox, { recursive: true })

  const app = await freshApp(context, { profile, configDir, stub, marker })

  /**
   * **前置：監看真的掛在「啟動時就已經存在」的落點上。**
   *
   * 少了它，這一段在舊實作下**可能照樣全綠** —— 本缺陷的必要條件是「監看先掛上、落點才被
   * 重新準備」，而那個順序在探針裡只靠時序成立（`handoffService.start()` 不被 await，
   * 失敗時也只寫診斷輸出）。監看若根本沒起來，重新準備就毀不掉任何東西。
   *
   * 用的是**孤兒落點**（沒有對應的 session）：它走完整條事件路徑直到一次可見的拒絕，
   * 而且不會多開一個 session 去污染後面的計數。投遞寫在畫面就緒之後 —— 啟動掃描那時
   * 早已跑完，因此讀到它的只可能是監看。
   */
  const quiet = await settledNotifications(profile, '通知落定（前置之前）')
  writeFileSync(
    join(orphanOutbox, 'precondition.json'),
    JSON.stringify({ target: '__no_such_repo__', title: 'PRECONDITION', body: 'x' }),
  )
  const reason = copy('intake.rejectReason.TARGET_NOT_FOUND')
  const arrived = await pollFor({
    read: () => notifications(profile),
    settled: (list) => list.slice(quiet.length).some((n) => `${n.title ?? ''} ${n.body ?? ''}`.includes(reason)),
    timeoutMs: 25_000,
    label: '啟動時既有的落點上，監看讀到了新投遞',
  }).catch(() => notifications(profile))
  check(
    results,
    '前置：監看掛在啟動時就已存在的落點上',
    arrived.slice(quiet.length).some((n) => `${n.title ?? ''} ${n.body ?? ''}`.includes(reason)),
    `新增=${JSON.stringify(arrived.slice(quiet.length).map((n) => n.body ?? n.title))}`,
  )

  // ── 喚醒被還原的 session：`prepareOutbox()` 對一個**既有的**落點跑一次 ──
  const sourceName = basename(folders[0].path)
  await pollFor({
    read: () => app.client.evaluate(`(() => { ${railRowClick(sourceName)} return ${RAIL_SELECTION} === ${JSON.stringify(sourceName)} })()`),
    settled: Boolean,
    timeoutMs: 15_000,
    label: '被還原的 session 所屬的 folder 已被選中',
  })
  const sessionsBefore = await pollFor({
    read: () => ptySessionPids(marker).length,
    settled: (count) => count >= 1,
    timeoutMs: 30_000,
    label: '被還原的 session 已喚醒（pty 起來了）',
  }).catch(() => ptySessionPids(marker).length)
  check(results, '前置：被還原的 session 真的被喚醒', sessionsBefore >= 1, `pty=${sessionsBefore}`)

  /**
   * **等監看把那次替換處理完再投遞。**
   *
   * 重新準備之後**立刻**寫進去的檔案，會在監看重新讀取那個新目錄時被一併撿走 —— 於是一個
   * 監看已死的實作照樣全綠（單元測試那一側的第一版對照組就是這樣過的）。現場的投遞是在
   * spawn 之後好幾分鐘才寫的。這個間隔在重現那件事，順帶讓上面那則通知的合併窗結算。
   */
  await new Promise((resolve) => setTimeout(resolve, WINDOW_WAIT_MS))

  writeFileSync(
    join(restoredOutbox, 'restored.json'),
    JSON.stringify({ target: basename(folders[1].path), title: 'RESTORED-HANDOFF', body: HANDOFF_BODY }),
  )

  const sessionsAfter = await pollFor({
    read: () => ptySessionPids(marker).length,
    settled: (count) => count > sessionsBefore,
    timeoutMs: 30_000,
    label: '被還原的 session 其交接建立了目標 folder 的 session',
  }).catch(() => ptySessionPids(marker).length)
  check(
    results,
    '落點被重新準備之後（session 被還原），其後寫入的交接仍被偵測並建立 session',
    sessionsAfter > sessionsBefore,
    `前=${sessionsBefore} 後=${sessionsAfter}`,
  )
}

// ── intake-inbox-usability ─────────────────────────────────────────────────────

/** 卡片上的 folder 選單。**以字典取標籤**（它同時是選擇器）。 */
function selectedFolderExpression(title) {
  return `(() => {
    const row = document.querySelector(${JSON.stringify(itemSelector(title))})
    const select = row?.querySelector(${JSON.stringify(label('intake.chooseFolder'))})
    if (!select) return null
    return { value: select.value, text: select.selectedOptions[0]?.textContent ?? null }
  })()`
}

/**
 * 在卡片上改選 folder。
 *
 * 原生 select 的下拉清單是作業系統畫的，CDP 驅動不到 —— 與 probe-workspace／probe-files
 * 同一個做法：以原生 setter 設值再發 change（React 對 select 聽的就是 change）。
 * 回傳的是**畫面上最終被選定的值**，由呼叫端輪詢確認它留住了（受控元件會把沒被接住的值改回去）。
 */
function chooseFolderExpression(title, folderId) {
  return `(() => {
    const row = document.querySelector(${JSON.stringify(itemSelector(title))})
    const select = row?.querySelector(${JSON.stringify(label('intake.chooseFolder'))})
    if (!select) return null
    if (select.value !== ${JSON.stringify(folderId)}) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      setter.call(select, ${JSON.stringify(folderId)})
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return select.value
  })()`
}

async function chooseFolder(app, title, folderId) {
  return pollFor({
    read: () => app.client.evaluate(chooseFolderExpression(title, folderId)),
    settled: (value) => value === folderId,
    timeoutMs: 15_000,
    label: `改選 ${title}`,
  })
}

/** 收件匣 overlay 裡的分頁 —— tablist 以字典標籤指名（role="tab" 在這個 app 會撞）。 */
function switchTabExpression(tabCopyKey) {
  return `(() => {
    const list = document.querySelector('[role="tablist"]${label('intake.label')}')
    const tab = [...(list?.querySelectorAll('[role="tab"]') ?? [])].find(
      (candidate) => candidate.textContent === ${JSON.stringify(copy(tabCopyKey))},
    )
    if (!tab) return false
    if (tab.getAttribute('aria-selected') !== 'true') tab.click()
    return tab.getAttribute('aria-selected') === 'true'
  })()`
}

/** 那一列的接受鈕是不是停用的。選不到那一列時回 null（不要讓「選不到」看起來像「停用」）。 */
function acceptDisabledExpression(title) {
  return `(() => {
    const row = document.querySelector(${JSON.stringify(itemSelector(title))})
    const button = row?.querySelector('${label('intake.accept')}')
    return button ? button.disabled : null
  })()`
}

/** 每一個 agent session 的 pty 開在哪裡 —— **讀行程的 cwd，不讀 renderer 的狀態**。 */
function sessionCwds(marker) {
  return ptySessionPids(marker).map((pid) => {
    try {
      return readlinkSync(`/proc/${pid}/cwd`)
    } catch {
      return null
    }
  })
}

/** 等 session 多一個，回傳**新的那一個**的 cwd。 */
async function newSessionCwd(marker, beforePids, label_) {
  const pids = await pollFor({
    read: () => ptySessionPids(marker),
    settled: (now) => now.length > beforePids.length,
    timeoutMs: 20_000,
    label: label_,
  })
  const fresh = pids.filter((pid) => !beforePids.includes(pid))
  if (fresh.length !== 1) return { cwd: null, count: fresh.length }
  try {
    return { cwd: readlinkSync(`/proc/${fresh[0]}/cwd`), count: 1 }
  } catch {
    return { cwd: null, count: 1 }
  }
}

/**
 * 接受之前由使用者確認 folder（intake-routing「接受時由使用者確認目標 folder…」）。
 *
 * fixture：**無 fallback**；一條以來源識別碼命中、指向 f2（甲）的規則；另一條命中後指向一個
 * 不存在的 folder。三則可解析（R1–R3，三則才分得出「不延續到其他 intake」與「沒改選的跟著規則走」）、
 * 一則 NO_MATCH、一則 FOLDER_GONE，外加一則以種入 intake.json 造出的「目標已不存在的待處理交接」
 * —— 那個目標無法由投遞內容表達，只能這樣造。
 *
 * 甲＝f2（規則原本指的）、乙＝f1、丙＝f3。
 */
async function runChooseFolder(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  seedRouting(profile, {
    rules: [
      { id: 'r1', criterion: 'originId', contains: 'CROUTE', folderId: folders[1].id },
      { id: 'r2', criterion: 'originId', contains: 'CGONE', folderId: 'f9' },
    ],
    fallbackFolderId: null,
  })
  writeFileSync(
    join(profile, 'intake.json'),
    JSON.stringify({
      version: 1,
      entries: [
        {
          adapter: 'handoff',
          id: 'choose-handoff-gone',
          state: 'pending',
          digest: 'seeded',
          content: {
            verified: { adapter: 'handoff', originKind: 'handoff', originId: 'seeded', targetFolderId: 'f9', firstPartyBody: true },
            authored: { title: 'CHOOSE-HANDOFF-GONE', body: 'b', actor: 'agent', originLabel: 'seeded' },
            receivedAt: Date.now() - 60_000,
          },
        },
      ],
    }),
  )
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  drop(profile, 'r1', intake({ id: 'choose-r1', title: 'CHOOSE-R1', originId: 'CROUTE' }))
  drop(profile, 'r2', intake({ id: 'choose-r2', title: 'CHOOSE-R2', originId: 'CROUTE' }))
  drop(profile, 'r3', intake({ id: 'choose-r3', title: 'CHOOSE-R3', originId: 'CROUTE' }))
  drop(profile, 'nm', intake({ id: 'choose-nomatch', title: 'CHOOSE-NOMATCH', originId: 'CNONE' }))
  drop(profile, 'fg', intake({ id: 'choose-gone', title: 'CHOOSE-GONE', originId: 'CGONE' }))

  const app = await freshApp(context, { profile, configDir, stub, marker })
  await openInbox(app)
  const r1 = await pollFor({
    read: () => app.client.evaluate(selectedFolderExpression('CHOOSE-R1')),
    settled: (value) => value?.value === folders[1].id,
    timeoutMs: 15_000,
    label: 'R1 已呈現且預選甲',
  })

  // ── 預選：釘**被選中的那一項**，不是整列的文字（選單的每一個選項都在整列的文字裡）──
  check(
    results,
    '可解析者被選定的 folder 為其解析結果，並以名稱呈現',
    r1?.text === folders[1].name,
    JSON.stringify(r1),
  )
  for (const [title, reasonKey] of [
    ['CHOOSE-NOMATCH', 'intake.unresolved'],
    ['CHOOSE-GONE', 'intake.unresolvedFolderGone'],
    ['CHOOSE-HANDOFF-GONE', 'intake.unresolvedFolderGone'],
  ]) {
    const selected = await app.client.evaluate(selectedFolderExpression(title))
    const text = await app.client.evaluate(itemTextExpression(title))
    check(
      results,
      `解析不出者沒有被選定的 folder，且呈現原因（${title}）`,
      selected?.value === '' && text.includes(copy(reasonKey)),
      `selected=${JSON.stringify(selected)} 原因=${text.includes(copy(reasonKey))}`,
    )
  }

  // ── 主行程不替使用者補預設值：直接呼叫 IPC，繞過畫面 ──
  // 停用的按鈕點不到主行程、畫面永遠送出呈現值 —— 經畫面的斷言對主行程的實作一律是綠的。
  const direct = await app.client.evaluate(`(async () => {
    const accept = window.workspace.intake.accept
    return {
      missing: await accept('choose-r1', 'file'),
      empty: await accept('choose-r1', 'file', ''),
      unknown: await accept('choose-r1', 'file', 'f9'),
      state: (await window.workspace.intake.list()).items.find((item) => item.id === 'choose-r1')?.state ?? null,
    }
  })()`)
  check(
    results,
    '未指明確認的 folder 的接受被拒絕，即使解析得出',
    direct?.missing?.ok === false &&
      direct?.missing?.reason === 'unknown' &&
      direct?.empty?.ok === false &&
      direct?.empty?.reason === 'unknown' &&
      direct?.state === 'pending',
    JSON.stringify(direct),
  )
  check(
    results,
    '確認的 folder 不在 workspace 時被拒絕（FOLDER_GONE）',
    direct?.unknown?.ok === false && direct?.unknown?.reason === 'FOLDER_GONE',
    JSON.stringify(direct?.unknown),
  )

  // ── 改選不延續到其他 intake：**在接受之前**看 R2 ──
  await chooseFolder(app, 'CHOOSE-R1', folders[0].id)
  const r2BeforeAccept = await app.client.evaluate(selectedFolderExpression('CHOOSE-R2'))
  check(
    results,
    '改選一則之後，另一則同樣命中規則的仍預選解析結果',
    r2BeforeAccept?.value === folders[1].id,
    JSON.stringify(r2BeforeAccept),
  )

  // ── 改選活過分頁切換；沒改選的跟著規則走（正反兩向）──
  await chooseFolder(app, 'CHOOSE-R3', folders[2].id)
  await pollFor({
    read: () => app.client.evaluate(switchTabExpression('intake.rules.label')),
    settled: Boolean,
    timeoutMs: 15_000,
    label: '切到 Rules 分頁',
  })
  // 經規則編輯入口把 r1 改指乙 —— 那是使用者唯一能改規則的地方，而它會讓卡片全部卸載。
  const ruleChanged = await pollFor({
    read: () =>
      app.client.evaluate(`(() => {
        const list = document.querySelector('ul${label('intake.rules.label')}')
        const select = list?.querySelector('li')?.querySelector(${JSON.stringify(label('intake.rules.folder'))})
        if (!select) return null
        if (select.value !== ${JSON.stringify(folders[0].id)}) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
          setter.call(select, ${JSON.stringify(folders[0].id)})
          select.dispatchEvent(new Event('change', { bubbles: true }))
        }
        return select.value
      })()`),
    settled: (value) => value === folders[0].id,
    timeoutMs: 15_000,
    label: '經規則編輯入口把規則改指乙',
  })
  const routingFile = join(profile, 'intake-routing.json')
  const routingAfterEdit = await pollFor({
    read: () => readFileSync(routingFile, 'utf8'),
    settled: (text) => JSON.parse(text).rules?.[0]?.folderId === folders[0].id,
    timeoutMs: 15_000,
    label: '規則的變更已落盤',
  })
  const cardsUnmounted = await app.client.evaluate(`!document.querySelector(${JSON.stringify(itemSelector('CHOOSE-R3'))})`)
  check(
    results,
    '前置：在規則分頁時卡片確實已卸載（否則「改選活過分頁切換」沒有被驗到）',
    ruleChanged === folders[0].id && cardsUnmounted === true,
    `rule=${ruleChanged} unmounted=${cardsUnmounted}`,
  )
  await pollFor({
    read: () => app.client.evaluate(switchTabExpression('intake.title')),
    settled: Boolean,
    timeoutMs: 15_000,
    label: '切回收件匣分頁',
  })
  const afterRules = await pollFor({
    read: () =>
      app.client.evaluate(`({
        r2: ${selectedFolderExpression('CHOOSE-R2')},
        r3: ${selectedFolderExpression('CHOOSE-R3')},
      })`),
    settled: (value) => value?.r2?.value === folders[0].id,
    timeoutMs: 15_000,
    label: '沒改選的 R2 跟著規則變成乙',
  })
  check(
    results,
    '改選之後規則的變動不覆蓋使用者的選擇',
    afterRules?.r3?.value === folders[2].id,
    JSON.stringify(afterRules?.r3),
  )
  check(results, '尚未改選者的預選隨規則變動', afterRules?.r2?.value === folders[0].id, JSON.stringify(afterRules?.r2))

  // ── 接受 R3（改選為丙，而規則此刻指乙）⇒ pty 開在丙；改選沒有寫回規則 ──
  // **挑 R3 而不是 R1**：R1 改選的乙恰好也是規則現在指的地方，「開在乙」分不出改選與規則。
  // R3 的改選（丙）與解析結果（乙）不同 —— 新 session 只有一個且開在丙，就表示乙沒有新增。
  const beforeR3 = ptySessionPids(marker)
  await pollFor({
    read: () => app.client.evaluate(acceptExpression('CHOOSE-R3')),
    settled: Boolean,
    timeoutMs: 15_000,
    label: '接受 R3',
  })
  const r3Opened = await newSessionCwd(marker, beforeR3, 'R3 的 session 已建立')
  check(
    results,
    '改選之後 session 建立於改選的 folder',
    r3Opened.cwd === folders[2].path && r3Opened.count === 1,
    `cwd=${r3Opened.cwd} 新增=${r3Opened.count} 期望=${folders[2].path}（解析結果是 ${folders[0].path}）`,
  )
  check(
    results,
    '改選不改變規則（規則檔與改選之前逐位元組相同）',
    readFileSync(routingFile, 'utf8') === routingAfterEdit,
    readFileSync(routingFile, 'utf8').slice(0, 160),
  )

  // ── 解析不出者：選定之前不能接受；明確選定之後開在選定的那裡 ──
  await openInbox(app)
  const disabled = await pollFor({
    read: () => app.client.evaluate(acceptDisabledExpression('CHOOSE-NOMATCH')),
    settled: (value) => value !== null,
    timeoutMs: 15_000,
    label: 'NO_MATCH 那一列已呈現',
  })
  const beforeTry = ptySessionPids(marker).length
  const tried = await app.client.evaluate(acceptExpression('CHOOSE-NOMATCH'))
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const stateAfterTry = await app.client.evaluate(
    `window.workspace.intake.list().then((snapshot) => snapshot.items.find((item) => item.id === 'choose-nomatch')?.state ?? null)`,
  )
  check(
    results,
    '解析不出者在選定之前無法接受',
    disabled === true && tried === false && ptySessionPids(marker).length === beforeTry && stateAfterTry === 'pending',
    `disabled=${disabled} 點得到=${tried} session ${beforeTry}→${ptySessionPids(marker).length} state=${stateAfterTry}`,
  )

  await chooseFolder(app, 'CHOOSE-NOMATCH', folders[1].id)
  const beforeNm = ptySessionPids(marker)
  await pollFor({
    read: () => app.client.evaluate(acceptExpression('CHOOSE-NOMATCH')),
    settled: Boolean,
    timeoutMs: 15_000,
    label: '接受 NO_MATCH',
  })
  const nmOpened = await newSessionCwd(marker, beforeNm, 'NO_MATCH 的 session 已建立')
  check(
    results,
    '解析不出者在明確選定之後可接受，session 開在選定的 folder',
    nmOpened.cwd === folders[1].path,
    `cwd=${nmOpened.cwd} 新增=${nmOpened.count} 期望=${folders[1].path}`,
  )
}

/**
 * 標題**從每一列的無障礙標籤取**，不從畫面上的文字取 —— 標題與本文重複時不另外呈現
 * （Slack 的標題就是本文裡那一則的第一行），於是「第一個 span 是標題」不成立。
 */
const OPENED_PREFIX = prefixOf('intake.openedItemLabel')
const PENDING_PREFIX = prefixOf('intake.itemLabel')

/** 已開好那一段裡的標題，依畫面順序。 */
const OPENED_TITLES = `[...document.querySelectorAll(${JSON.stringify(`li[aria-label^="${OPENED_PREFIX}"]`)})].map(
  (li) => li.getAttribute('aria-label').slice(${OPENED_PREFIX.length}),
)`

/** 待處理那一段的標題，依畫面順序。 */
const PENDING_TITLES = `[...document.querySelectorAll(${JSON.stringify(`[role="dialog"]${label('intake.label')} li[aria-label^="${PENDING_PREFIX}"]`)})].map(
  (li) => li.getAttribute('aria-label').slice(${PENDING_PREFIX.length}),
)`

/** 某一列（待處理或已開好）的元素，以無障礙標籤指名。 */
function rowExpression(title) {
  return `(document.querySelector(${JSON.stringify(label('intake.itemLabel', { title }))}) ?? document.querySelector(${JSON.stringify(label('intake.openedItemLabel', { title }))}))`
}

/** 某一列的 time 元素文字。 */
function arrivedTextExpression(title) {
  return `(${rowExpression(title)}?.querySelector('time')?.textContent ?? null)`
}

/** 頁面內以與收件匣相同的格式設定算出期望字串 —— 語言跟著頁面走。 */
function fullTimeExpression(ms) {
  return `new Intl.DateTimeFormat(document.documentElement.lang || 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(${ms}))`
}

function clearOpenedExpression(title) {
  return `(() => {
    const row = document.querySelector(${JSON.stringify(label('intake.openedItemLabel', { title }))})
    const button = row?.querySelector('${label('intake.clearOpened')}')
    if (!button) return false
    button.click()
    return true
  })()`
}

function intakeEntry(profile, id) {
  const data = JSON.parse(readFileSync(join(profile, 'intake.json'), 'utf8'))
  return data.entries.find((entry) => entry.id === id) ?? null
}

/** 對目前的焦點送 Ctrl+Shift+W（關閉選中項目裡聚焦的 session）。帶修飾鍵的按鍵走 rawKeyDown。 */
async function pressCloseSession(client) {
  const base = { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87, modifiers: 2 | 8 }
  await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}

/**
 * 已開好那一段的去留、它呈現的 folder、兩段的順序與發生時間（agent-intake）。
 *
 * **已開好的項目在這一次執行中以接受產生** —— 啟動之前就已接受的，照規格會在啟動時被了結
 * （預填的 prompt 活不過 pty）。唯一種入的已接受項目就是用來驗那件事的。
 * 段落最後以同一個 profile 重新啟動一次，驗「本次接受而未送出的，重開之後不再呈現」。
 */
async function runOpenedLifecycle(_mode, _modeConfig, context) {
  const { profile, folders } = seedProfile()
  // 規則把 CRA 指向甲（f1）—— 「routing 會解到甲、而 session 在乙」要的就是它。
  seedRouting(profile, { rules: [{ id: 'r', criterion: 'originId', contains: 'CRA', folderId: folders[0].id }] })
  const configDir = mkTemp('spekterm-intake-config-')
  const marker = `spek-intake-${process.pid}-${Date.now()}`
  const stub = makeStubAgent(mkTemp, configDir)

  const S = {
    legacy: '0a1b2c3d-0000-4000-8000-000000000001',
    pending: '0a1b2c3d-0000-4000-8000-000000000006',
  }
  writeFileSync(
    join(profile, 'sessions.json'),
    JSON.stringify({
      version: 1,
      sessions: [
        { id: S.legacy, folderId: folders[0].id, spawnTarget: 'claude', ordinal: 1, customTitle: 'SESSION-LEGACY' },
        { id: S.pending, folderId: folders[1].id, spawnTarget: 'claude', ordinal: 1, customTitle: 'SESSION-PENDING' },
      ],
    }),
  )

  const now = Date.now()
  const HOUR = 3_600_000
  /**
   * **回補的形狀**：`ago` 是宣告的**發生**時間，`receivedAgo` 是到達時間 —— 到達時間都擠在
   * 最近一兩分鐘內，而且**與發生時間的順序相反**（越早發生的越晚收到）。於是「依到達時間排」
   * 與「顯示到達時間」兩個錯誤實作都會紅。`declared: false` 的不宣告發生時間（以到達時間代之）。
   */
  const entry = (id, title, { state = 'pending', sessionId, originId = 'C1', ago, receivedAgo, declared = true }) => ({
    adapter: 'file',
    id,
    state,
    digest: `seeded-${id}`,
    ...(sessionId ? { sessionId } : {}),
    content: {
      verified: { adapter: 'file', originKind: 'slack', originId },
      authored: {
        title,
        body: `${title} body`,
        actor: 'someone',
        originLabel: '#dev',
        ...(declared ? { occurredAt: now - ago } : {}),
      },
      receivedAt: now - (declared ? receivedAgo : ago),
    },
  })
  // **落盤順序刻意打亂**：既不是由舊到新、也不是由新到舊 —— 否則反轉插入順序也會綠。
  writeFileSync(
    join(profile, 'intake.json'),
    JSON.stringify({
      version: 1,
      entries: [
        entry('p-b', 'ACCEPT-B', { ago: 2 * HOUR, receivedAgo: 59_000 }),
        entry('p-mid', 'PENDING-MID', { ago: 24 * HOUR + 60_000, receivedAgo: 58_500 }),
        entry('p-elsewhere', 'ACCEPT-ELSEWHERE', { originId: 'CRA', ago: 5 * HOUR, receivedAgo: 56_000 }),
        entry('p-new', 'PENDING-NEW', { ago: 3 * HOUR, receivedAgo: 59_500 }),
        // **上一次執行接受、session 仍在、prompt 沒送出** —— 啟動時必須被了結。
        entry('o-legacy', 'OPENED-LEGACY', { state: 'accepted', sessionId: S.legacy, ago: 30 * 60_000, receivedAgo: 61_000 }),
        entry('p-a', 'ACCEPT-A', { ago: HOUR, receivedAgo: 60_000 }),
        entry('p-removed', 'ACCEPT-REMOVED', { ago: 4 * HOUR, receivedAgo: 57_000 }),
        entry('p-old', 'PENDING-OLD', { ago: 2 * 24 * HOUR, receivedAgo: 57_500 }),
        entry('p-close', 'ACCEPT-CLOSE', { ago: 3 * HOUR + 60_000, receivedAgo: 58_000 }),
        // 宣告一個**未來**的時刻，而它是最早到達的 —— 有效時間必須是到達時間（排最後）。
        entry('p-future', 'PENDING-FUTURE', { ago: -10 * 24 * HOUR, receivedAgo: 10 * 24 * HOUR }),
        // 待處理、帶著仍存在於乙的 session、routing 解到甲 —— 預填逾時退回待處理的形狀。
        entry('p-session', 'PENDING-SESSION', { sessionId: S.pending, originId: 'CRA', ago: 20 * 60_000, declared: false }),
      ],
    }),
  )
  // **走真的解析路徑**：一份投遞檔宣告 ISO 8601 的發生時間（上面那些是直接種進落盤檔的）。
  const droppedAt = new Date(now - 26 * HOUR).toISOString()
  drop(profile, 'dropped', { ...intake({ id: 'p-dropped', title: 'PENDING-DROPPED' }), occurredAt: droppedAt })

  let app = await freshApp(context, { profile, configDir, stub, marker })
  await openInbox(app)
  const expectedPending = [
    'PENDING-SESSION',
    'ACCEPT-A',
    'ACCEPT-B',
    'PENDING-NEW',
    'ACCEPT-CLOSE',
    'ACCEPT-REMOVED',
    'ACCEPT-ELSEWHERE',
    'PENDING-MID',
    'PENDING-DROPPED',
    'PENDING-OLD',
    'PENDING-FUTURE',
  ]
  const pendingTitles = await pollFor({
    read: () => app.client.evaluate(PENDING_TITLES),
    settled: (titles) => titles.includes('PENDING-DROPPED') && titles.includes('PENDING-SESSION'),
    timeoutMs: 20_000,
    label: '待處理項目已呈現（含投遞檔那一則）',
  })

  // ── 上一次執行接受的：啟動時了結 ──
  // **等過 session 清單落盤的去抖動再讀** —— 還原若丟掉了那個 session，立刻讀到的仍是種入的那一份。
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const openedAtStart = await app.client.evaluate(OPENED_TITLES)
  const legacySessionKept = JSON.parse(readFileSync(join(profile, 'sessions.json'), 'utf8')).sessions.some(
    (session) => session.id === S.legacy,
  )
  check(
    results,
    '上一次執行接受而未送出的項目，啟動後不再呈現（session 仍被還原、狀態仍為已接受、了結落盤）',
    !openedAtStart.includes('OPENED-LEGACY') &&
      legacySessionKept &&
      intakeEntry(profile, 'o-legacy')?.state === 'accepted' &&
      typeof intakeEntry(profile, 'o-legacy')?.settledAt === 'number',
    `已開好=${JSON.stringify(openedAtStart)} session在=${legacySessionKept} 紀錄=${JSON.stringify({ state: intakeEntry(profile, 'o-legacy')?.state, settledAt: intakeEntry(profile, 'o-legacy')?.settledAt })}`,
  )

  // ── 待處理：順序、預選、發生時間 ──
  check(
    results,
    '待處理項目依發生時間新的在上',
    JSON.stringify(pendingTitles) === JSON.stringify(expectedPending),
    `${JSON.stringify(pendingTitles)} 期望 ${JSON.stringify(expectedPending)}`,
  )
  const pendingSession = await app.client.evaluate(selectedFolderExpression('PENDING-SESSION'))
  check(
    results,
    '預填逾時退回者預選既有 session 所在的 folder',
    pendingSession?.value === folders[1].id && pendingSession?.text === folders[1].name,
    JSON.stringify(pendingSession),
  )
  // 期望值在頁面內以同一組格式設定算出（語言跟著頁面走）。宣告的發生時間與到達時間相差數小時，
  // 於是「顯示到達時間」的錯誤實作在這裡一定對不上。
  const shown = (title) => arrivedTextExpression(title)
  const times = await app.client.evaluate(`({
    pendingNew: ${shown('PENDING-NEW')},
    dropped: ${shown('PENDING-DROPPED')},
    session: ${shown('PENDING-SESSION')},
    future: ${shown('PENDING-FUTURE')},
    expectNew: ${fullTimeExpression(now - 3 * HOUR)},
    expectDropped: ${fullTimeExpression(Date.parse(droppedAt))},
    expectSession: ${fullTimeExpression(now - 20 * 60_000)},
    expectFuture: ${fullTimeExpression(now - 10 * 24 * HOUR)},
    receivedNew: ${fullTimeExpression(now - 59_500)},
  })`)
  check(
    results,
    '宣告的發生時間晚於到達時間時以到達時間為準（呈現與排序）',
    times.future === times.expectFuture && pendingTitles.at(-1) === 'PENDING-FUTURE',
    `呈現=${times.future} 期望=${times.expectFuture} 排序末位=${pendingTitles.at(-1)}`,
  )

  // ── 標題與本文重複時只出現一次 ──
  // PENDING-NEW 的本文以標題開頭（Slack 的形狀）；PENDING-DROPPED 的本文不含標題（交接的形狀）。
  // 兩個方向各一：前者若照樣另列標題會出現兩次，後者若被誤判為重複會一次都不出現。
  const occurrences = await app.client.evaluate(`({
    redundant: (${rowExpression('PENDING-NEW')}?.textContent ?? '').split('PENDING-NEW').length - 1,
    distinct: (${rowExpression('PENDING-DROPPED')}?.textContent ?? '').split('PENDING-DROPPED').length - 1,
  })`)
  check(
    results,
    '標題已在本文中時不另外呈現，不在本文中時照常呈現',
    occurrences.redundant === 1 && occurrences.distinct === 1,
    JSON.stringify(occurrences),
  )

  // ── 在這一次執行中接受五則 ──
  // 順序是承重的：CLOSE 最後、且開在乙 —— create() 把新建的 session 設為該 folder 的焦點，
  // 於是之後在乙按 Ctrl+Shift+W 關掉的就是它。
  const acceptOne = async (title, folderId) => {
    await openInbox(app)
    if (folderId) await chooseFolder(app, title, folderId)
    const before = ptySessionPids(marker)
    await pollFor({
      read: () => app.client.evaluate(acceptExpression(title)),
      settled: Boolean,
      timeoutMs: 15_000,
      label: `接受 ${title}`,
    })
    return newSessionCwd(marker, before, `${title} 的 session 已建立`)
  }
  const opened = {
    // A、B 解析不出（規則只認 CRA、沒有 fallback）—— 明確選定甲。
    a: await acceptOne('ACCEPT-A', folders[0].id),
    b: await acceptOne('ACCEPT-B', folders[0].id),
    removed: await acceptOne('ACCEPT-REMOVED', folders[2].id),
    elsewhere: await acceptOne('ACCEPT-ELSEWHERE', folders[1].id),
    close: await acceptOne('ACCEPT-CLOSE', folders[1].id),
  }
  check(
    results,
    '前置：五則都在這一次執行中接受並建立了 session',
    Object.values(opened).every((result) => result.count === 1),
    JSON.stringify(opened),
  )

  await openInbox(app)
  const openedTitles = await pollFor({
    read: () => app.client.evaluate(OPENED_TITLES),
    settled: (titles) => titles.length >= 5,
    timeoutMs: 20_000,
    label: '五則都出現在已開好那一段',
  })
  check(
    results,
    '已開好的項目新的在上',
    JSON.stringify(openedTitles) ===
      JSON.stringify(['ACCEPT-A', 'ACCEPT-B', 'ACCEPT-CLOSE', 'ACCEPT-REMOVED', 'ACCEPT-ELSEWHERE']),
    JSON.stringify(openedTitles),
  )

  const elsewhere = await app.client.evaluate(`${rowExpression('ACCEPT-ELSEWHERE')}?.textContent ?? ''`)
  check(
    results,
    '已開好的項目呈現的是 session 所在的 folder，不是解析結果',
    elsewhere.includes(copy('intake.fromSession', { name: folders[1].name })) &&
      !elsewhere.includes(copy('intake.fromSession', { name: folders[0].name })),
    elsewhere.slice(0, 160),
  )

  const openedTimes = await app.client.evaluate(`({
    openedA: ${shown('ACCEPT-A')},
    expectA: ${fullTimeExpression(now - HOUR)},
  })`)
  check(
    results,
    '每一則呈現發生時間的完整日期與時刻（宣告者為發生時間、未宣告者為到達時間）',
    times.pendingNew === times.expectNew &&
      times.pendingNew !== times.receivedNew &&
      times.dropped === times.expectDropped &&
      times.session === times.expectSession &&
      openedTimes.openedA === openedTimes.expectA,
    JSON.stringify({ ...times, ...openedTimes }),
  )

  // ── 逐則清除 ──
  const ptysBeforeClear = ptySessionPids(marker).length
  await pollFor({
    read: () => app.client.evaluate(clearOpenedExpression('ACCEPT-A')),
    settled: Boolean,
    timeoutMs: 15_000,
    label: '清除 ACCEPT-A',
  })
  const afterClear = await pollFor({
    read: () => app.client.evaluate(OPENED_TITLES),
    settled: (titles) => !titles.includes('ACCEPT-A'),
    timeoutMs: 15_000,
    label: 'ACCEPT-A 離開已開好那一段',
  })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  check(
    results,
    '逐則清除只清掉那一則，其 session 仍在，且了結落盤',
    !afterClear.includes('ACCEPT-A') &&
      afterClear.includes('ACCEPT-B') &&
      ptySessionPids(marker).length === ptysBeforeClear &&
      typeof intakeEntry(profile, 'p-a')?.settledAt === 'number',
    `清單=${JSON.stringify(afterClear)} pty ${ptysBeforeClear}→${ptySessionPids(marker).length} settledAt=${intakeEntry(profile, 'p-a')?.settledAt}`,
  )

  // ── 關閉 session ⇒ 不再呈現 ──
  const inboxDialog = `[role="dialog"]${label('intake.label')}`
  const closeInbox = `(() => {
    const dialog = document.querySelector(${JSON.stringify(inboxDialog)})
    if (dialog) dialog.querySelector(${JSON.stringify(label('intake.close'))})?.click()
    return !document.querySelector(${JSON.stringify(inboxDialog)})
  })()`
  await pollFor({ read: () => app.client.evaluate(closeInbox), settled: Boolean, timeoutMs: 15_000, label: '關閉收件匣' })
  await pollFor({
    read: () =>
      app.client.evaluate(`(() => {
        ${railRowClick(folders[1].name)}
        return ${RAIL_SELECTION} === ${JSON.stringify(folders[1].name)}
      })()`),
    settled: Boolean,
    timeoutMs: 15_000,
    label: '選中乙',
  })
  const ptysBeforeClose = ptySessionPids(marker).length
  await retryAction({
    act: () => pressCloseSession(app.client),
    read: () => ptySessionPids(marker).length,
    settled: (count) => count < ptysBeforeClose,
    attemptWindowMs: 3000,
    timeoutMs: 15_000,
    label: '以 Ctrl+Shift+W 關閉乙聚焦的 session',
  })
  await openInbox(app)
  const afterClose = await pollFor({
    read: () => app.client.evaluate(OPENED_TITLES),
    settled: (titles) => !titles.includes('ACCEPT-CLOSE'),
    timeoutMs: 15_000,
    label: 'ACCEPT-CLOSE 離開已開好那一段',
  })
  check(
    results,
    'session 已不存在時不再呈現',
    !afterClose.includes('ACCEPT-CLOSE') && afterClose.includes('ACCEPT-ELSEWHERE') && afterClose.includes('ACCEPT-B'),
    JSON.stringify(afterClose),
  )

  // ── 移除 folder ⇒ 不再呈現 ──
  await pollFor({ read: () => app.client.evaluate(closeInbox), settled: Boolean, timeoutMs: 15_000, label: '關閉收件匣' })
  const removeLabel = label('rail.removeFolder', { name: folders[2].name })
  await pollFor({
    read: () =>
      app.client.evaluate(`(() => {
        document.querySelector(${JSON.stringify(removeLabel)})?.click()
        return !document.querySelector(${JSON.stringify(removeLabel)})
      })()`),
    settled: Boolean,
    timeoutMs: 15_000,
    label: '把第三個 folder 移出 workspace',
  })
  await openInbox(app)
  const afterRemove = await pollFor({
    read: () => app.client.evaluate(OPENED_TITLES),
    settled: (titles) => !titles.includes('ACCEPT-REMOVED'),
    timeoutMs: 15_000,
    label: 'ACCEPT-REMOVED 離開已開好那一段',
  })
  check(
    results,
    'session 所在的 folder 已被移出 workspace 時不再呈現',
    !afterRemove.includes('ACCEPT-REMOVED') && afterRemove.includes('ACCEPT-B'),
    JSON.stringify(afterRemove),
  )

  // ── 以同一個 profile 重新啟動：本次接受而未送出的不再呈現 ──
  // 前置：重開之前它們確實還在（否則「重開之後不在」恆真）。等過 session 清單落盤的去抖動。
  const beforeRestart = await app.client.evaluate(OPENED_TITLES)
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const sessionOf = (id) => intakeEntry(profile, id)?.sessionId
  app = await freshApp(context, { profile, configDir, stub, marker })
  await openInbox(app)
  await pollFor({
    read: () => app.client.evaluate(PENDING_TITLES),
    settled: (titles) => titles.includes('PENDING-NEW'),
    timeoutMs: 20_000,
    label: '重開之後收件匣已呈現',
  })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const afterRestart = await app.client.evaluate(OPENED_TITLES)
  const restoredIds = JSON.parse(readFileSync(join(profile, 'sessions.json'), 'utf8')).sessions.map((session) => session.id)
  check(
    results,
    '應用程式重新啟動後，本次接受而未送出的項目不再呈現（session 仍被還原）',
    beforeRestart.includes('ACCEPT-B') &&
      beforeRestart.includes('ACCEPT-ELSEWHERE') &&
      afterRestart.length === 0 &&
      restoredIds.includes(sessionOf('p-b')) &&
      restoredIds.includes(sessionOf('p-elsewhere')) &&
      typeof intakeEntry(profile, 'p-b')?.settledAt === 'number',
    `重開前=${JSON.stringify(beforeRestart)} 重開後=${JSON.stringify(afterRestart)} 還原=${restoredIds.includes(sessionOf('p-b'))}/${restoredIds.includes(sessionOf('p-elsewhere'))}`,
  )
}

const SECTIONS = [
  { name: 'runIngest', run: runIngest },
  { name: 'runPlainText', run: runPlainText },
  { name: 'runRouting', run: runRouting },
  { name: 'runAcceptPrefill', run: runAcceptPrefill },
  { name: 'runProtocolLanguage', run: runProtocolLanguage },
  { name: 'runDismiss', run: runDismiss },
  { name: 'runBadge', run: runBadge },
  { name: 'runBadgeOverflow', run: runBadgeOverflow },
  { name: 'runBadgeRestart', run: runBadgeRestart },
  { name: 'runNotifyBackfill', run: runNotifyBackfill },
  { name: 'runNotifyContent', run: runNotifyContent },
  { name: 'runNotifyActivate', run: runNotifyActivate },
  { name: 'runFocusStability', run: runFocusStability },
  { name: 'runHandoff', run: runHandoff },
  { name: 'runHandoffRestored', run: runHandoffRestored },
  { name: 'runHandoffFailure', run: runHandoffFailure },
  { name: 'runHandoffDisabled', run: runHandoffDisabled },
  { name: 'runChooseFolder', run: runChooseFolder },
  { name: 'runOpenedLifecycle', run: runOpenedLifecycle },
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

process.exit(outcome ? 0 : 1)
