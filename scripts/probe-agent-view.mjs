/**
 * 驗證 `agent-transcript-view` 的四個能力：`agent-transcript-stream`、`agent-event-bridge`、
 * `agent-conversation-view`、`agent-input-bridge`。
 *
 * ## 替身 agent，而不是真的 agent
 *
 * 真實委派刻意不進探針（要網路、會花錢、回覆不可重現）—— 與 `conversation-report` 同一條理由。
 * 這裡的替身做三件真事：**照著我們注入的 `--settings` 真的呼叫 hook 命令**、**真的把紀錄寫到
 * 我們算得出來的位置**、**真的回報它拿到的終端尺寸**。
 *
 * 只斷言「argv 裡有 `--settings`」證明不了任何事：注入的命令能不能跑、落點對不對、環境變數有沒有
 * 到，全都在那之外。**而那正是本 change 實際踩到的失敗** —— hook 命令有一個多餘的分號，
 * shell 語法錯，於是每一次都失敗，而事件目錄只是安靜地空著。
 *
 * 「真的 agent 會呼叫我們注入的東西」不在這裡，由 dogfood 認定 —— 該缺口寫在規格裡。
 *
 * ## 終端尺寸那一段是本支最容易假綠的一條
 *
 * 對話 view 在上層時終端仍必須保有版面盒子，否則 pty 會停在一個從未被量測過的初始值
 * （80×24），agent 以錯誤的寬度輸出，**而那些輸出一旦印出就永久留在終端歷史裡**。
 * **不修也不會紅**：agent 照樣回話，症狀要到使用者切去終端 view 看歷史時才顯現。
 * 因此那一段以替身回報的 `stty size` 為觀察對象，並在同一輪驗一次對照組。
 *
 * 用法：npm run probe:agent-view
 */
import { spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
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
import { join } from 'node:path'
import { check, connectToApp, pollFor, pressKey, retryAction } from './lib/cdp.mjs'
import { copy, copyIn, label, labelIn, prefixOf } from './lib/copy.mjs'
import { makeStubAgent } from './lib/stub-agent.mjs'
import { awaitApplied, clickSelector, closeSettings, inSettings, openSettings, setField } from './lib/settings.mjs'
import { awaitMounted } from './lib/mounted.mjs'
import { electronExtraArgs } from './lib/display.mjs'
import { runSections } from './lib/sections.mjs'
import { PROBE_PORTS } from './lib/ports.mjs'
import { RENDER_PATH_PRELUDE } from './lib/render-path.mjs'
import { seedLanguage } from './lib/probe-language.mjs'

const PORT = PROBE_PORTS.agentView.main
const RESTORE_PORT = PROBE_PORTS.agentView.restore

const results = []
const temps = []

function mkTemp(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  temps.push(dir)
  return dir
}


function seedProfile(repo) {
  const profile = mkTemp('spekterm-agentview-profile-')
  writeFileSync(
    join(profile, 'workspace.json'),
    JSON.stringify({
      version: 1,
      folders: [{ id: 'f1', path: repo, addedAt: '2026-09-06T00:00:00.000Z' }],
    }),
  )
  return profile
}

async function launch({ profile, configDir, stub, port = PORT }) {
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
        // agent 目標走 `$SHELL -l -c claude`，**而 login shell 會重設 PATH** —— 只前置 bin
        // 是不夠的，`~/.profile` 會把真的 claude 搶回前面。因此 HOME 也要換掉。
        // （`probe-terminal` 的同一段註解記著這件事；漏掉它的徵狀是「替身完全沒被執行」，
        // 而畫面上一切正常 —— 產品那邊的斷言才是紅的。）
        HOME: stub.home,
        PATH: `${stub.bin}:${process.env.PATH}`,
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
      // 落盤是 debounce 的；給它一點時間把 session 清單寫出去。
      await new Promise((resolve) => setTimeout(resolve, 900))
    },
  }
}

// ── 讀畫面的表達式 ──────────────────────────────────────────────────────────

/**
 * rail 的列以**專案名稱**為 `aria-label`（那是這個 repo 的慣例，見 `WorkspaceRail`）——
 * 因此選擇器要在執行期以 fixture 的目錄名組出來，不能寫死。
 */
function selectRepoExpression(name) {
  return `(() => {
    const row = document.querySelector('[aria-label="${name}"]')
    if (!row) return false
    row.click()
    return true
  })()`
}

const CREATE_SESSION = `(() => {
  const button = document.querySelector('${label('sessions.new')}')
  if (!button) return 'no-button'
  button.click()
  return 'clicked'
})()`

const VIEW_STATE = `(() => {
  const toggle = document.querySelector('${label('conversation.showConversation')}')
    ?? document.querySelector('${label('conversation.showTerminal')}')
  const composer = document.querySelector('${label('conversation.composer')}')
  const send = document.querySelector('${label('conversation.send')}')
  return {
    hasToggle: Boolean(toggle),
    toggleLabel: toggle?.getAttribute('aria-label') ?? null,
    hasComposer: Boolean(composer),
    sendDisabled: send ? send.disabled : null,
    text: document.querySelector('[aria-label="${copy('stage.terminal')}"]')?.innerText ?? '',
  }
})()`

const TOGGLE_VIEW = `(() => {
  const toggle = document.querySelector('${label('conversation.showConversation')}')
    ?? document.querySelector('${label('conversation.showTerminal')}')
  if (!toggle) return false
  toggle.click()
  return true
})()`

// ── 段落 ────────────────────────────────────────────────────────────────────

const COMPOSER = `document.querySelector('${label('conversation.composer')}')`

/** A visible Wake button inside the terminal stage (session-hibernation). */
const WAKE_IN_STAGE = `[...(document.querySelector('[aria-label="${copy('stage.terminal')}"]')?.querySelectorAll('button') ?? [])].some((b) => b.textContent === ${JSON.stringify(copy('sessions.wake'))} && b.getBoundingClientRect().width > 0)`

/** Whether focus sits on a Wake button. */
const CONVERSATION_WAKE_FOCUSED = `(document.activeElement?.tagName === 'BUTTON' && document.activeElement.textContent === ${JSON.stringify(copy('sessions.wake'))})`

/** Whether any process of the stub agent for this conversation is still running. */
function agentAlive(conversationId) {
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue
    try {
      if (readFileSync(`/proc/${entry}/cmdline`, 'utf8').includes(conversationId)) return true
    } catch {
      // the process ended while being read
    }
  }
  return false
}
const SEND = `document.querySelector('${label('conversation.send')}')`

/** 預設是終端 view；切到對話 view 後內容抵達，且送得出去。 */
async function runViewAndSend(_mode, _config, context) {
  const repo = mkTemp('spekterm-agentview-repo-')
  const configDir = mkTemp('spekterm-agentview-config-')
  const stub = makeStubAgent(mkTemp, configDir)
  const profile = seedProfile(repo)
  Object.assign(context, { profile, configDir, stub, repo, repoName: repo.split('/').pop() })

  const app = await launch({ profile, configDir, stub })
  context.app = app

  await pollFor({
    read: () => app.client.evaluate(selectRepoExpression(context.repoName)),
    settled: (ok) => ok === true,
    timeoutMs: 15_000,
    label: '選中 repo',
  })
  await pollFor({
    read: () => app.client.evaluate(CREATE_SESSION),
    settled: (r) => r === 'clicked',
    timeoutMs: 15_000,
    label: '建立 session 的入口可點',
  })
  await pollFor({
    read: () =>
      app.client.evaluate(`(() => {
        const item = [...document.querySelectorAll('[role="menuitem"]')]
          .find((el) => el.textContent.trim().toLowerCase().includes('claude'))
        if (!item) return false
        item.click()
        return true
      })()`),
    settled: (ok) => ok === true,
    timeoutMs: 15_000,
    label: 'spawn 選單出現且可選 agent',
  })

  const initial = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.hasToggle,
    timeoutMs: 25_000,
    label: 'agent session 建立後出現切換入口',
  })
  check(
    results,
    'agent session 預設為終端 view，且提供切換入口',
    initial.toggleLabel === copy('conversation.showConversation') && !initial.hasComposer,
    `切換入口＝${initial.toggleLabel}，對話輸入框存在＝${initial.hasComposer}`,
  )

  await app.client.evaluate(TOGGLE_VIEW)
  const conversation = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.hasComposer,
    timeoutMs: 15_000,
    label: '切換到對話 view',
  })
  check(results, '對話 view 呈現輸入框', conversation.hasComposer, '輸入框存在')

  const withContent = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.text.includes('STUB-HELLO-'),
    timeoutMs: 25_000,
    label: 'agent 寫下的內容抵達對話 view',
  })
  check(
    results,
    '紀錄中的內容抵達對話 view',
    withContent.text.includes('STUB-HELLO-'),
    'agent 寫下的訊息已呈現',
  )

  // 送出按鈕在草稿為空時本來就是停用的 —— 先填草稿，才問得出「等待狀態允不允許」。
  await app.client.evaluate(`(() => {
    const box = ${COMPOSER}
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'PROBE-SENT')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  const sendable = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.sendDisabled === false,
    timeoutMs: 25_000,
    label: '等待狀態由替身的事件推到可送出',
  })
  check(
    results,
    '替身觸發的事件使等待狀態變為可送出（注入的 hook 命令真的被執行）',
    sendable.sendDisabled === false,
    '送出按鈕已啟用',
  )

  await app.client.evaluate(`${SEND}.click()`)
  const arrived = await pollFor({
    read: () => stub.input(),
    settled: (text) => text.includes('PROBE-SENT'),
    timeoutMs: 15_000,
    label: '送出的內容抵達 pty',
  })
  check(results, '對話 view 送出的內容抵達 pty', arrived.includes('PROBE-SENT'), '替身收到 PROBE-SENT')

  // 切回終端 view —— 逃生口必須一直在。
  await app.client.evaluate(TOGGLE_VIEW)
  const back = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => !state.hasComposer,
    timeoutMs: 15_000,
    label: '切回終端 view',
  })
  check(
    results,
    '切回終端 view 後對話輸入框消失，切換入口仍在',
    !back.hasComposer && back.hasToggle,
    `輸入框＝${back.hasComposer}，切換入口＝${back.hasToggle}`,
  )

  // 讓下一段以「對話 view」為當前 view 重建。
  await app.client.evaluate(TOGGLE_VIEW)
  await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.hasComposer,
    timeoutMs: 15_000,
    label: '回到對話 view（供重建段使用）',
  })

  /*
    **等它真的落盤，不要猜。**

    此前這裡直接進下一段，於是重建段永遠看到終端 view，而**寬度那條斷言照樣是綠的**
    （終端 view 之下終端本來就掛載得好好的）—— 一盞完美的假綠：它通過了，但它證明的不是
    它自稱在證明的事。

    **等待的理由換過了。** 選擇改為全域偏好之後落點是 `preferences.json`，而偏好的寫入
    **沒有 debounce**（每個 setter 直接原子寫檔）—— 剩下的只有一次 IPC 往返。
    連帶：此前這次等待隱含保證的「`sessions.json` 已 flush」**不再成立**
    （那一份仍是 500ms debounce），下面對它的斷言因此自己帶前置。

    讀落盤結果同時也是「view 的選擇跨重啟保留」這條 requirement 的載體。
  */
  const readJson = (name) => {
    try {
      return JSON.parse(readFileSync(join(context.profile, name), 'utf8'))
    } catch {
      return null
    }
  }
  const prefs = await pollFor({
    read: () => readJson('preferences.json'),
    settled: (data) => data?.terminal?.agentView === 'conversation',
    timeoutMs: 15_000,
    label: 'view 的選擇落盤於偏好檔',
  })
  check(
    results,
    'view 的選擇被持久化於偏好檔',
    prefs.terminal.agentView === 'conversation',
    `偏好檔的 terminal：${JSON.stringify(prefs.terminal)}`,
  )

  /*
    **反向：它不得同時落在 session 的持久化紀錄裡。**

    只驗「偏好檔裡有」的話，一個「兩邊都寫」的實作照樣全綠 —— 而那正是這個 change 要消滅的
    狀態（兩處都寫使「兩個 session 的 view 不一樣」重新變得表達得出來）。

    **否定式斷言要自帶前置。** 檔案讀不到（回 `null`）或 `sessions` 是空陣列時，
    `every(...)` 恆真 —— 那是 `probes.md` 記過的同一型假綠。
  */
  const sessionsFile = await pollFor({
    read: () => readJson('sessions.json'),
    settled: (data) => Array.isArray(data?.sessions) && data.sessions.length >= 1,
    timeoutMs: 15_000,
    label: 'sessions.json 已落盤且非空（否定式斷言的前置）',
  })
  check(
    results,
    '前置：落盤的 session 就是這一段建立的那個 agent session',
    sessionsFile.sessions.some((entry) => entry.spawnTarget === 'claude'),
    `落盤的 spawnTarget：${sessionsFile.sessions.map((entry) => entry.spawnTarget).join(', ')}`,
  )
  check(
    results,
    'view 的選擇 SHALL NOT 落在 session 的持久化紀錄裡',
    sessionsFile.sessions.every((entry) => !('view' in entry)),
    `落盤的 session 欄位：${sessionsFile.sessions.map((entry) => Object.keys(entry).join('+')).join(' / ')}`,
  )
}

/**
 * **本支最容易假綠的一段。**
 *
 * 重建後直接以對話 view 喚醒的 session，其 pty 的欄數必須與可用寬度相符 —— 而不是那個從未被
 * 量測過的初始值。不修**也不會紅**：agent 照樣回話，症狀要到使用者切去終端 view 看歷史才顯現。
 *
 * **一個沒有載體的時序前提**（`global-conversation-view-preference` 之後新增）：
 * view 的選擇改為全域偏好之後，它與 `restore()` 是**兩條互不相干的非同步**，先後沒有保證。
 * 偏好晚到的那個窗口裡，終端會先以**未覆蓋**狀態出現並被 fit 一次 —— 欄數在那一瞬間就已經
 * 正確，於是這一段即使在「對話 view 在上層時終端沒有版面盒子」的錯誤實作下也可能通過。
 *
 * **刻意不為它做載體**：那是一個競賽窗口，抽樣式的觀察做不出穩定的判別，而一條時綠時紅、
 * 且證明不了什麼的斷言比沒有更糟（見 `docs/lessons/probes.md`）。此前沒有這個窗口 ——
 * `session.view` 與 session 本身來自同一次 `restore()`，是原子的。
 */
async function runRebuiltWidth(_mode, _config, context) {
  const readJson = (name) => {
    try {
      return JSON.parse(readFileSync(join(context.profile, name), 'utf8'))
    } catch {
      return null
    }
  }
  // Hibernate the agent session first: a session running when the application closes starts again on its own
  // (restore-running-sessions), and this section is about waking a dormant one straight into the conversation view.
  const agentId = readJson('sessions.json')?.sessions?.find((entry) => entry.spawnTarget === 'claude')?.id ?? null
  const hibernated = agentId
    ? await context.app.client.evaluate(`window.workspace.terminal.hibernate(${JSON.stringify(agentId)})`)
    : null
  await pollFor({
    read: () => readJson('sessions.json')?.sessions?.find((entry) => entry.id === agentId)?.running,
    settled: (running) => running === undefined,
    timeoutMs: 10_000,
    label: 'the agent session is recorded as not running',
  })
  check(results, 'precondition: the agent session is hibernated before the restart', hibernated?.ok === true, JSON.stringify({ agentId, hibernated }))
  await context.app.close()
  context.app = null

  const stub = makeStubAgent(mkTemp, context.configDir)
  const app = await launch({
    profile: context.profile,
    configDir: context.configDir,
    stub,
    port: RESTORE_PORT,
  })
  context.app = app

  await pollFor({
    read: () => app.client.evaluate(selectRepoExpression(context.repoName)),
    settled: (ok) => ok === true,
    timeoutMs: 15_000,
        label: '重建後選中 repo',
  })
  // Displaying a dormant session no longer starts it (session-persistence): the conversation view
  // offers Wake, with focus on it, and Enter wakes the session — no click.
  const wakeFocused = await pollFor({
    read: () => app.client.evaluate(CONVERSATION_WAKE_FOCUSED),
    settled: (focused) => focused === true,
    timeoutMs: 15_000,
    label: 'the dormant conversation view focuses its Wake button',
  })
  check(
    results,
    'a dormant session in the conversation view offers Wake, with focus on it',
    wakeFocused === true,
    `activeElement=${JSON.stringify(await app.client.evaluate('document.activeElement?.outerHTML?.slice(0, 120) ?? null'))}`,
  )
  await pressKey(app.client, 'Enter')
  const state = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (view) => view.hasComposer,
    timeoutMs: 25_000,
    label: '重建的 session 以對話 view 呈現（view 的選擇跨重啟保留）',
  })
  check(
    results,
    '重建後回到上次的 view（對話）',
    state.hasComposer,
    `輸入框＝${state.hasComposer}，切換入口＝${state.toggleLabel}，畫面＝${JSON.stringify(state.text.slice(0, 120))}`,
  )

  const cols = await pollFor({
    read: () => {
      try {
        return stub.cols()
      } catch {
        return 0
      }
    },
    // **等它最終不再是暫定值。** 沒有版面盒子的話校正永遠不會來，這個等待就會耗盡 —— 那正是
    // 這條 requirement 的失效樣貌，而不是一個時序上的巧合。
    settled: (value) => value > 0 && value !== 80,
    timeoutMs: 25_000,
    label: '替身回報的終端尺寸最終不再是 spawn 當下的暫定值',
  })
  check(
    results,
    '對話 view 在上層時 pty 的欄數與可用寬度相符（不是未經量測的初始值）',
    cols !== 80 && cols > 0,
    `替身回報 cols=${cols}（初始暫定值為 80）`,
  )
}


/**
 * **內容與輸入是兩條獨立的路。**
 *
 * 替身這次完全不觸發事件（模擬「事件橋接未注入／注入失敗」）。等待狀態恆為未知 ⇒ 送不出去，
 * **但內容照樣讀得到**。這是 design 最重要的降級路徑：少了 hooks，使用者失去的是「在新畫面
 * 打字」，不是「看不到內容」。
 *
 * 同時驗「未知時拒絕並說明原因」—— 一個永遠灰掉又不說原因的輸入框，與「壞掉」在畫面上分不出來
 * （dogfood 第一次就撞上了）。
 */
async function runReadableWithoutEvents(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repo2-')
  const configDir = mkTemp('spekterm-agentview-config2-')
  const stub = makeStubAgent(mkTemp, configDir, { honorHooks: false })
  const profile = seedProfile(repo)
  const repoName = repo.split('/').pop()

  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app

  await pollFor({
    read: () => app.client.evaluate(selectRepoExpression(repoName)),
    settled: (ok) => ok === true,
    timeoutMs: 15_000,
    label: '選中 repo',
  })
  await pollFor({
    read: () => app.client.evaluate(CREATE_SESSION),
    settled: (r) => r === 'clicked',
    timeoutMs: 15_000,
    label: '建立 session 的入口可點',
  })
  await pollFor({
    read: () =>
      app.client.evaluate(`(() => {
        const item = [...document.querySelectorAll('[role="menuitem"]')]
          .find((el) => el.textContent.trim().toLowerCase().includes('claude'))
        if (!item) return false
        item.click()
        return true
      })()`),
    settled: (ok) => ok === true,
    timeoutMs: 15_000,
    label: 'spawn 選單可選 agent',
  })
  await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.hasToggle,
    timeoutMs: 25_000,
    label: '切換入口出現',
  })
  await app.client.evaluate(TOGGLE_VIEW)

  const state = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (view) => view.hasComposer && view.text.includes('STUB-HELLO-'),
    timeoutMs: 25_000,
    label: '未注入事件時，對話 view 仍讀得到內容',
  })
  check(
    results,
    '未注入事件回報時對話 view 仍可讀（內容與輸入是兩條獨立的路）',
    state.text.includes('STUB-HELLO-'),
    'agent 寫下的訊息已呈現',
  )

  // 填草稿 —— 送出按鈕在草稿為空時本來就是停用的，不填就問不出「等待狀態允不允許」。
  await app.client.evaluate(`(() => {
    const box = document.querySelector('${label('conversation.composer')}')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'SHOULD-NOT-ARRIVE')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  const blocked = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (view) => view.sendDisabled === true,
    timeoutMs: 10_000,
    label: '等待狀態未知 ⇒ 送出停用',
  })
  check(results, '等待狀態未知時送出停用', blocked.sendDisabled === true, '送出按鈕為停用')
  check(
    results,
    '停用時說明原因（不是一個沉默的灰按鈕）',
    blocked.text.includes(copy('conversation.waitingForState').slice(0, 24)),
    `畫面上出現說明＝${blocked.text.includes(copy('conversation.waitingForState').slice(0, 24))}`,
  )

  /*
    主行程才是閘 —— 繞過 UI 直接呼叫 IPC 也必須被拒絕。

    **用真正的 session id，不是一個隨便的字串。** 一個不匹配的 id 本來就會被拒（它連不到任何
    訂閱），於是那樣的斷言證明的是「錯的 id 會被拒」，而不是「未知狀態會被拒」——
    兩者是不同的事，而前者對這條 requirement 沒有任何鑑別力。
  */
  const sessionId = await pollFor({
    read: () => {
      try {
        const data = JSON.parse(readFileSync(join(profile, 'sessions.json'), 'utf8'))
        return data.sessions?.[0]?.id ?? null
      } catch {
        return null
      }
    },
    settled: (id) => typeof id === 'string',
    timeoutMs: 15_000,
    label: '取得真正的 session id',
  })
  const refused = await app.client.evaluate(`(async () => {
    const result = await window.workspace.conversation.send(${JSON.stringify(sessionId)}, 'SHOULD-NOT-ARRIVE')
    return { ok: result.ok, reason: result.reason ?? null }
  })()`)
  check(
    results,
    '送出的閘在主行程 —— 以**真正的** session id 繞過 UI 仍被拒絕',
    refused.ok === false && refused.reason === 'unknown',
    `主行程回覆 ok=${refused.ok} reason=${refused.reason}（session=${sessionId.slice(0, 8)}）`,
  )
  check(
    results,
    '被拒絕的內容沒有抵達 pty',
    !stub.input().includes('SHOULD-NOT-ARRIVE'),
    `替身收到的輸入：${JSON.stringify(stub.input().slice(0, 60))}`,
  )
}


/** 建立一個 agent session（選中 repo → 建立入口 → spawn 選單選 agent）。 */
async function createAgentSession(app, repoName) {
  await pollFor({
    read: () => app.client.evaluate(selectRepoExpression(repoName)),
    settled: (ok) => ok === true,
    timeoutMs: 15_000,
    label: '選中 repo',
  })
  await pollFor({
    read: () => app.client.evaluate(CREATE_SESSION),
    settled: (r) => r === 'clicked',
    timeoutMs: 15_000,
    label: '建立 session 的入口可點',
  })
  await pollFor({
    read: () =>
      app.client.evaluate(`(() => {
        const item = [...document.querySelectorAll('[role="menuitem"]')]
          .find((el) => el.textContent.trim().toLowerCase().includes('claude'))
        if (!item) return false
        item.click()
        return true
      })()`),
    settled: (ok) => ok === true,
    timeoutMs: 15_000,
    label: 'spawn 選單可選 agent',
  })
}

/**
 * session 分頁列上的第 n 個分頁（0 起）。
 *
 * **一定要連 `aria-label` 一起指名 tablist。** 這個 app 有四到五個 `role="tablist"`
 * （身分切換、OpenSpec 視圖、artifact 分頁、session 分頁），
 * `querySelectorAll('[role="tab"]')[0]` 抓到的**不是** session 分頁 ——
 * 實測踩到：點下去焦點根本沒動，而斷言報的是「切換後看到的是另一個 session 的內容」，
 * 看起來像產品把 A 的對話畫在 B 的畫面上。
 */
function focusTabExpression(index) {
  return `(() => {
    const list = document.querySelector('[role="tablist"][aria-label="${copy('sessions.tabs')}"]')
    if (!list) return false
    const tabs = [...list.querySelectorAll('[role="tab"]')]
    if (!tabs[${index}]) return false
    tabs[${index}].click()
    return true
  })()`
}

/**
 * 兩個並行的 agent session **各自跟進自己的紀錄**，而 **view 的選擇是全域的、兩者共用**。
 *
 * 定位若以「最近被修改的紀錄」之類的搜尋實作，這裡就會**把 A 的對話呈現在 B 的畫面上** ——
 * 而那比沒有內容更糟，因為它看起來完全正常。
 *
 * **view 那一半此前驗的是相反的事**（per-session）。全域化之後這裡承擔兩條 requirement：
 * 新建的 session 採用當前的全域選擇、以及切換其中一個時另一個一起改變。
 */
async function runParallelSessions(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repo3-')
  const configDir = mkTemp('spekterm-agentview-config3-')
  const stub = makeStubAgent(mkTemp, configDir)
  const profile = seedProfile(repo)
  const repoName = repo.split('/').pop()
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app

  await createAgentSession(app, repoName)
  await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.hasToggle,
    timeoutMs: 25_000,
    label: '第一個 session 建立',
  })
  await app.client.evaluate(TOGGLE_VIEW)
  const first = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.hasComposer && /STUB-HELLO-[0-9a-f-]{36}/.test(state.text),
    timeoutMs: 25_000,
    label: '第一個 session 的內容抵達',
  })
  const firstMarker = /STUB-HELLO-([0-9a-f-]{36})/.exec(first.text)[1]

  /*
    **新建的 session 採用當前的全域選擇。** 第一個已經在對話 view，所以第二個一建立就該是。

    **不可以 `hasComposer` 當 settled 條件。** `VIEW_STATE` 是 document-wide，而 DOM 裡只有
    focused session 的那一份；`createAgentSession` 點完 spawn 選單就回來，此刻**第一個
    session 的輸入框還在畫面上** ⇒ `hasComposer` 立刻為真 ⇒ **產品若維持 per-session，
    這條照樣綠**。因此錨在**身分**上：等分頁數變成 2，且畫面上的 marker 換成了另一個。
  */
  await createAgentSession(app, repoName)
  const secondConv = await pollFor({
    read: () =>
      app.client.evaluate(`(() => {
        const state = ${VIEW_STATE}
        const list = document.querySelector('[role="tablist"][aria-label="${copy('sessions.tabs')}"]')
        return { ...state, tabs: list ? list.querySelectorAll('[role="tab"]').length : 0 }
      })()`),
    settled: (state) =>
      state.tabs === 2 &&
      /STUB-HELLO-[0-9a-f-]{36}/.test(state.text) &&
      !state.text.includes(firstMarker),
    timeoutMs: 25_000,
    label: '第二個 session 建立且其內容抵達（分頁數＝2 且 marker 已換人）',
  })
  const secondMarker = /STUB-HELLO-([0-9a-f-]{36})/.exec(secondConv.text)[1]
  check(
    results,
    '新建的第二個 session 採用當前的全域選擇（對話 view）',
    secondConv.hasComposer && secondConv.toggleLabel === copy('conversation.showTerminal'),
    `輸入框＝${secondConv.hasComposer}，切換入口＝${secondConv.toggleLabel}`,
  )

  check(
    results,
    '兩個並行的 session 各自跟進自己的紀錄（不會把 A 的對話畫在 B 的畫面上）',
    firstMarker !== secondMarker && !secondConv.text.includes(firstMarker),
    `第一個＝${firstMarker.slice(0, 8)}，第二個＝${secondMarker.slice(0, 8)}，第二個畫面含第一個的內容＝${secondConv.text.includes(firstMarker)}`,
  )

  // 切回第一個 —— 它的 view 與內容都該是自己的。
  await pollFor({
    read: () => app.client.evaluate(focusTabExpression(0)),
    settled: (ok) => ok === true,
    timeoutMs: 10_000,
    label: '切回第一個 session',
  })
  const backToFirst = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.text.includes(firstMarker),
    timeoutMs: 20_000,
    label: '第一個 session 的內容回來',
  })
  check(
    results,
    '切換 session 後內容跟著它自己（view 則是共用的，見下）',
    backToFirst.text.includes(firstMarker) && !backToFirst.text.includes(secondMarker),
    `含自己的內容＝${backToFirst.text.includes(firstMarker)}，含另一個的＝${backToFirst.text.includes(secondMarker)}`,
  )

  /*
    **切回終端時其他 session 亦回到終端。**

    **方向不可反。** 兩個都已在對話 view 時，「把其中一個切到對話、另一個也是對話」與
    「它一直都是對話」在觀察上完全相同 —— 往終端方向的那一次才具鑑別力。

    而「另一個也變了」**必須切回去才看得到**（`VIEW_STATE` 只讀得到 focused 的那一份）。
  */
  await pollFor({
    read: () => app.client.evaluate(focusTabExpression(1)),
    settled: (ok) => ok === true,
    timeoutMs: 10_000,
    label: '切到第二個 session（準備把它切回終端）',
  })
  await app.client.evaluate(TOGGLE_VIEW)
  await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => !state.hasComposer,
    timeoutMs: 15_000,
    label: '第二個 session 切回終端 view',
  })
  await pollFor({
    read: () => app.client.evaluate(focusTabExpression(0)),
    settled: (ok) => ok === true,
    timeoutMs: 10_000,
    label: '切回第一個 session（觀察它是否也變了）',
  })
  const firstAfter = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.hasToggle,
    timeoutMs: 15_000,
    label: '第一個 session 的呈現就緒',
  })
  check(
    results,
    '切回終端時其他 session 亦回到終端（view 的選擇是全域的）',
    !firstAfter.hasComposer && firstAfter.toggleLabel === copy('conversation.showConversation'),
    `輸入框＝${firstAfter.hasComposer}，切換入口＝${firstAfter.toggleLabel}`,
  )

  /*
    **Settings offers the same view choice** (agent-conversation-view, "Settings also offers the view choice").

    Both directions again: the tab bar puts every session in the conversation view, Settings must show that
    (a radio fixed on its default, terminal, would pass the second check alone), and choosing Terminal in
    Settings must reach both sessions, which is only visible by focusing each in turn.
  */
  await app.client.evaluate(TOGGLE_VIEW)
  await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.hasComposer,
    timeoutMs: 15_000,
    label: 'the tab bar toggle puts the sessions in the conversation view',
  })
  const VIEW_RADIO = inSettings('input[name="settings-agent-view"]')
  const CHECKED_VIEW = `document.querySelector(${JSON.stringify(`${VIEW_RADIO}:checked`)})?.value ?? null`
  await openSettings(app.client, 'agents')
  const shownView = await awaitApplied(app.client, CHECKED_VIEW, (value) => value !== null, 'the view radio is shown')
  check(results, 'Settings shows the current view (conversation, as the tab bar set it)',
    shownView === 'conversation', `checked=${shownView}`)

  await clickSelector(app.client, `${VIEW_RADIO}[value="terminal"]`, 'the Terminal view option')
  const chosen = await awaitApplied(app.client, CHECKED_VIEW, (value) => value === 'terminal', 'Settings shows Terminal chosen')
  await closeSettings(app.client)
  const viewOf = async (index) => {
    await pollFor({
      read: () => app.client.evaluate(focusTabExpression(index)),
      settled: (ok) => ok === true,
      timeoutMs: 10_000,
      label: `focus session ${index + 1}`,
    })
    return pollFor({
      read: () => app.client.evaluate(VIEW_STATE),
      settled: (state) => state.hasToggle && !state.hasComposer,
      timeoutMs: 15_000,
      label: `session ${index + 1} shows the terminal view`,
    }).catch(() => app.client.evaluate(VIEW_STATE))
  }
  const firstView = await viewOf(0)
  const secondView = await viewOf(1)
  check(results, 'A choice in Settings changes every agent session (both show the terminal view)',
    chosen === 'terminal' && !firstView.hasComposer && !secondView.hasComposer &&
      firstView.toggleLabel === copy('conversation.showConversation') &&
      secondView.toggleLabel === copy('conversation.showConversation'),
    `radio=${chosen} first: composer=${firstView.hasComposer} toggle=${firstView.toggleLabel}; second: composer=${secondView.hasComposer} toggle=${secondView.toggleLabel}`)

  /*
    **把全域偏好還原為對話 view —— 下一段依賴它。**

    `runDormantConversation` 重啟後期待畫面出現休眠的**對話**呈現，而決定那件事的現在是
    profile-wide 的偏好（此前是那個 session 自己的欄位）。不還原的話它會紅，而訊息看起來
    像「休眠的呈現壞了」，離根因隔了兩層。
  */
  await app.client.evaluate(TOGGLE_VIEW)
  await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.hasComposer,
    timeoutMs: 15_000,
    label: '還原為對話 view（供休眠段使用）',
  })

  context.parallel = { profile, configDir, repo, repoName }
}

/**
 * **休眠的 session 於對話 view 呈現休眠，不是一份空的對話。**
 *
 * 一份空的對話與「這個 session 真的還沒講話」無法區分，而兩者的正確處置不同。
 *
 * fixture：把 repo 目錄移走再重建 —— 喚醒會失敗，session 因此**停在**休眠態（比照
 * `probe-terminal` 造 `wakeError` 的作法）。這是唯一穩定觀察得到休眠的方式：正常路徑上，
 * 一個 session 被顯示的那一刻就醒了。
 */
async function runDormantConversation(_mode, _config, context) {
  await context.app.close()
  context.app = null
  const { profile, configDir, repo, repoName } = context.parallel
  rmSync(repo, { recursive: true, force: true })

  const stub = makeStubAgent(mkTemp, configDir)
  const app = await launch({ profile, configDir, stub, port: RESTORE_PORT })
  context.app = app

  await pollFor({
    read: () => app.client.evaluate(selectRepoExpression(repoName)),
    settled: (ok) => ok === true,
    timeoutMs: 15_000,
    label: '選中已消失的 repo',
  })
  const state = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (view) => view.text.includes(copy('conversation.dormant').slice(0, 20)),
    timeoutMs: 25_000,
    label: '休眠 session 於對話 view 呈現休眠狀態',
  })
    check(
    results,
    '休眠的 session 於對話 view 呈現休眠，而非一份空的對話',
    state.text.includes(copy('conversation.dormant').slice(0, 20)),
    `畫面＝${JSON.stringify(state.text.slice(0, 80))}`,
  )
  check(
    results,
    'the dormant conversation view offers the wake action',
    Boolean(await app.client.evaluate(WAKE_IN_STAGE)),
    `stage text=${JSON.stringify(state.text.slice(0, 120))}`,
  )
}


/**
 * **送出 ≠ agent 收到。**
 *
 * 在它出現於紀錄中之前一律標示為未確認 —— 直接畫成一則已送達的訊息的話，兩者一致時看不出差別，
 * 不一致時（agent 沒收到、或收到的與送出的不同）使用者會看見**一則從未發生的訊息**。
 *
 * fixture：替身延遲數秒才把使用者訊息補進紀錄，於是「未確認 → 已確認」這個轉換觀察得到。
 */
async function runUnconfirmed(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repo4-')
  const configDir = mkTemp('spekterm-agentview-config4-')
  const stub = makeStubAgent(mkTemp, configDir, { echoDelaySeconds: 4 })
  const profile = seedProfile(repo)
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app

  await createAgentSession(app, repo.split('/').pop())
  await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.hasToggle,
    timeoutMs: 25_000,
    label: 'session 建立',
  })
  await app.client.evaluate(TOGGLE_VIEW)
  await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.hasComposer,
    timeoutMs: 15_000,
    label: '切到對話 view',
  })
  await app.client.evaluate(`(() => {
    const box = document.querySelector('${label('conversation.composer')}')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'PENDING-PROBE')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.sendDisabled === false,
    timeoutMs: 25_000,
    label: '等待狀態允許送出',
  })
  await app.client.evaluate(`document.querySelector('${label('conversation.send')}').click()`)

  /*
    **比對要忽略大小寫。**

    `innerText` 回傳的是**套用過 CSS `text-transform` 之後**的文字，而這個標籤帶著
    `uppercase` —— 畫面上是 `NOT CONFIRMED YET`，字典裡是 `Not confirmed yet`，
    直接 `includes()` 永遠對不上。同一段畫面裡的 `YOU`（字典寫的是 `You`）就是證據。

    這與本 repo「文案即選擇器」那條紀律同族：**選擇器取自字典是對的，但畫面上的文字未必逐字
    等於字典裡的值**。以 `aria-label` 定位不受影響（屬性值不經 CSS），以 `innerText` 比對才會。
  */
  const marker = copy('conversation.unconfirmed').toUpperCase()
  const pendingShown = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.text.toUpperCase().includes(marker),
    timeoutMs: 10_000,
    label: '送出後立即標示為未確認',
  })
  check(
    results,
    '送出的內容在抵達紀錄之前標示為未確認',
    pendingShown.text.toUpperCase().includes(marker),
    `畫面上出現「${marker}」`,
  )

  const confirmed = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => !state.text.toUpperCase().includes(marker) && state.text.includes('PENDING-PROBE'),
    timeoutMs: 25_000,
    label: '內容出現於紀錄後標示消失',
  })
  check(
    results,
    '內容出現於 agent 的紀錄之後，未確認的標示消失',
    !confirmed.text.toUpperCase().includes(marker) && confirmed.text.includes('PENDING-PROBE'),
    `仍標示未確認＝${confirmed.text.toUpperCase().includes(marker)}，訊息已呈現＝${confirmed.text.includes('PENDING-PROBE')}`,
  )
}


/** 建好一個 agent session 並切到對話 view。回傳當下的畫面狀態。 */
async function openConversation(app, repoName) {
  await createAgentSession(app, repoName)
  await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.hasToggle,
    timeoutMs: 25_000,
    label: 'session 建立',
  })
  await app.client.evaluate(TOGGLE_VIEW)
  return pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.hasComposer || state.text.includes(copy('conversation.unavailable')),
    timeoutMs: 20_000,
    label: '切到對話 view',
  })
}

async function typeDraft(app, text) {
  await app.client.evaluate(`(() => {
    const box = document.querySelector('${label('conversation.composer')}')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, ${JSON.stringify(text)})
    box.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
}

/**
 * 控制位元組**一律以 escape 序列書寫**，不寫字面的位元組。
 *
 * 字面的控制位元組會讓 `git diff` 與 `grep` 對整個檔案瞎掉（本 repo 已在四個檔案上踩過），
 * 而且它們在 review 的畫面上是隱形的 —— 這一段正好是在驗「控制位元組要被濾掉」，
 * 用字面值寫它格外諷刺（實測：本次撰寫時連續兩度不小心寫成字面值，被工具擋下）。
 */
const CTRL_SAMPLE = `CTRL-PROBE\u0001a\u0007b`
// eslint-disable-next-line no-control-regex
const CTRL_PATTERN = /[\u0001-\u0008]/

/**
 * **許可提示出現時拒絕自由文字，並說出正在被問什麼。**
 *
 * 這是本 change 失效後果最嚴重的一條 —— 而使用者的 `defaultMode` 通常是 `auto`，日常幾乎不會
 * 走到它（design D7b 的覆蓋風險）。因此它**必須**由探針主動觸發，不能倚賴自然使用去發現。
 *
 * 順帶驗控制字元：送出的內容不得因控制位元組而中斷或消失。
 */
async function runAwaitingChoice(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repo5-')
  const configDir = mkTemp('spekterm-agentview-config5-')
  const stub = makeStubAgent(mkTemp, configDir, { holdPermission: true })
  const profile = seedProfile(repo)
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app

  await openConversation(app, repo.split('/').pop())
  await typeDraft(app, CTRL_SAMPLE)
  await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.sendDisabled === false,
    timeoutMs: 25_000,
    label: '等待狀態允許送出',
  })
  await app.client.evaluate(`document.querySelector('${label('conversation.send')}').click()`)

  const arrived = await pollFor({
    read: () => stub.input(),
    settled: (text) => text.includes('CTRL-PROBE'),
    timeoutMs: 15_000,
    label: '含控制字元的內容仍然抵達 pty',
  })
  check(
    results,
    '含控制字元的輸入不使訊息消失（控制位元組被濾掉，本文抵達）',
    arrived.includes('CTRL-PROBEab') && !CTRL_PATTERN.test(arrived),
    `替身收到：${JSON.stringify(arrived.trim().slice(0, 40))}`,
  )

  const asking = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.text.includes('terminal view') && state.sendDisabled === true,
    timeoutMs: 25_000,
    label: '許可請求使畫面說出正在被問什麼且停用送出',
  })
  check(
    results,
    '等待選擇時呈現「正在被問什麼」並指向終端 view',
    asking.text.includes('terminal view'),
    `畫面＝${JSON.stringify(asking.text.slice(-160))}`,
  )

  await typeDraft(app, 'SHOULD-NOT-ARRIVE-2')
  const blocked = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.sendDisabled === true,
    timeoutMs: 15_000,
    label: '等待選擇時送出停用',
  })
  check(results, '等待選擇時自由文字送不出去', blocked.sendDisabled === true, '送出按鈕為停用')
  check(
    results,
    '此 view 不提供作答的入口（事件不含選項，猜編號就是猜畫面）',
    !blocked.text.includes('Yes, and') && !blocked.text.includes('No, and tell'),
    '畫面上沒有任何選項按鈕',
  )
  check(
    results,
    '被擋下的自由文字沒有抵達 pty',
    !stub.input().includes('SHOULD-NOT-ARRIVE-2'),
    `替身收到的輸入不含它＝${!stub.input().includes('SHOULD-NOT-ARRIVE-2')}`,
  )
}

/**
 * 內容不完整時**明示** —— 一份看起來完整、實際少了開頭的對話會誤導判斷；
 * 一個安靜地什麼都不顯示的 view 與「這個 session 還沒講話」無法區分。
 */
async function runIncompleteContent(_mode, _config, context) {
  if (context.app) await context.app.close()

  const repoA = mkTemp('spekterm-agentview-repo6-')
  const configA = mkTemp('spekterm-agentview-config6-')
  const bulkStub = makeStubAgent(mkTemp, configA, { bulkRecords: 500 })
  const profileA = seedProfile(repoA)
  const appA = await launch({ profile: profileA, configDir: configA, stub: bulkStub, port: PORT })
  context.app = appA
  const bulk = await openConversation(appA, repoA.split('/').pop())
  const truncated = await pollFor({
    read: () => appA.client.evaluate(VIEW_STATE),
    settled: (state) => state.text.includes(copy('conversation.earlierNotLoaded')),
    timeoutMs: 25_000,
    label: '超過上限時明示較早的內容未載入',
  })
  check(
    results,
    '長對話只載入最近一段，並明示較早的未載入',
    truncated.text.includes(copy('conversation.earlierNotLoaded')) && bulk.hasComposer,
    '畫面上出現「較早的內容未載入」的說明',
  )

  await appA.close()
  const repoB = mkTemp('spekterm-agentview-repo7-')
  const configB = mkTemp('spekterm-agentview-config7-')
  const brokenStub = makeStubAgent(mkTemp, configB, { unreadable: true })
  const profileB = seedProfile(repoB)
  const appB = await launch({ profile: profileB, configDir: configB, stub: brokenStub, port: RESTORE_PORT })
  context.app = appB
  await openConversation(appB, repoB.split('/').pop())
  const unavailable = await pollFor({
    read: () => appB.client.evaluate(VIEW_STATE),
    settled: (state) => state.text.includes(copy('conversation.unavailable')),
    timeoutMs: 25_000,
    label: '來源讀不到時明說',
  })
  check(
    results,
    '來源不可讀時明說原因並指向終端 view，不靜默呈現為「沒有內容」',
    unavailable.text.includes(copy('conversation.unavailable')) && unavailable.text.includes('terminal view'),
    `畫面＝${JSON.stringify(unavailable.text.slice(0, 120))}`,
  )
  check(
    results,
    '來源不可讀時 pty 不受影響（終端 view 照常可用）',
    unavailable.hasToggle,
    `切換入口仍在＝${unavailable.hasToggle}`,
  )
}


/**
 * **第四種轉換：另一種呈現覆蓋於其上。**
 *
 * 保有版面盒子、失去可見、**不**銷毀、**不**失去掛載。`terminal-sessions` 既有的條文只寫了
 * 顯示↔隱藏與銷毀三種 —— 而它自己已經指出「銷毀是獨立於顯示↔隱藏之外的第三種轉換，因此需要
 * 各自的條文與各自的驗收」，同一個理由在此適用。
 *
 * **判準必須是資源自身的失效狀態。** 該 requirement 明文禁止用「取得資源時新增了哪些節點」
 * 當額度歸還的證據 —— 那個判準在額度未歸還時依然全綠。
 *
 * **這條路帶著一個比其餘路徑更強的掩蓋機制**：切換呈現方式必然把輸入焦點交給輸入框，而失焦
 * 會讓底層套件自己暫停週期性工作。既有 spec 記載那個掩蓋在點擊分頁時尚可用鍵盤繞開；
 * **在這裡繞不開 —— 焦點轉移就是切換本身**。因此觀察的是脈絡，不是計時器。
 *
 * 探針**持有脈絡的參照**，於是觀察不受 GC 時機影響（沿用 `probe-terminal` 的同一條理由：
 * 未歸還額度的實作之所以多半沒出事，正是因為 GC 碰巧來得及）。
 */
async function runCoveredReleasesQuota(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repo8-')
  const configDir = mkTemp('spekterm-agentview-config8-')
  const stub = makeStubAgent(mkTemp, configDir)
  const profile = seedProfile(repo)
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app
  await openConversation(app, repo.split('/').pop())

  const CAPTURE_SHOWN_GL = `(() => {${RENDER_PATH_PRELUDE}
    window.__probeGlCover = window.__probeGlCover ?? []
    const shown = hostsOf().filter((d) => !d.classList.contains('hidden'))
    const host = shown[0]
    if (!host) return 'no-shown-host'
    const screen = host.querySelector('.xterm-screen')
    const main = screen
      ? [...screen.querySelectorAll('canvas')].find((c) => !c.classList.contains('xterm-link-layer'))
      : null
    const gl = main ? main.getContext('webgl2') : null
    if (!gl) return 'no-context'
    window.__probeGlCover.push(gl)
    return 'captured'
  })()`
  const LOST = `window.__probeGlCover.map((gl) => (gl ? gl.isContextLost() : null))`

  // 先切回終端 view 取得一份脈絡，再覆蓋它。
  await app.client.evaluate(TOGGLE_VIEW)
  await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => !state.hasComposer,
    timeoutMs: 15_000,
    label: '回到終端 view',
  })
  const captured = await pollFor({
    read: () => app.client.evaluate(CAPTURE_SHOWN_GL),
    settled: (r) => r === 'captured',
    timeoutMs: 15_000,
    label: '抓住顯示中終端的渲染資源',
  })
  check(results, '前提：顯示中的終端確實持有一份渲染資源', captured === 'captured', `抓取結果＝${captured}`)

  await app.client.evaluate(TOGGLE_VIEW)
  const lostAfterCover = await pollFor({
    read: () => app.client.evaluate(LOST),
    settled: (list) => list[list.length - 1] === true,
    timeoutMs: 15_000,
    label: '覆蓋之後該資源失效（額度歸還）',
  })
  check(
    results,
    '另一種呈現覆蓋其上時，終端歸還其渲染資源的並存額度',
    lostAfterCover[lostAfterCover.length - 1] === true,
    `lost=${JSON.stringify(lostAfterCover)}`,
  )

  // 反覆切換：每次切回終端取得一份新脈絡，每次覆蓋都必須歸還它。
  // 未歸還的實作會讓它們全部保持有效 —— 那正是「累積佔用」的樣子。
  for (let round = 0; round < 4; round += 1) {
    await app.client.evaluate(TOGGLE_VIEW)
    await pollFor({
      read: () => app.client.evaluate(CAPTURE_SHOWN_GL),
      settled: (r) => r === 'captured',
      timeoutMs: 15_000,
      label: `第 ${round + 2} 次取得渲染資源`,
    })
    await app.client.evaluate(TOGGLE_VIEW)
    await pollFor({
      read: () => app.client.evaluate(LOST),
      settled: (list) => list[list.length - 1] === true,
      timeoutMs: 15_000,
      label: `第 ${round + 2} 次覆蓋後歸還`,
    })
  }
  const allLost = await app.client.evaluate(LOST)
  check(
    results,
    '反覆切換呈現方式不累積佔用（每一份取得的資源都被歸還）',
    allLost.length >= 5 && allLost.every((lost) => lost === true),
    `取得 ${allLost.length} 份，lost=${JSON.stringify(allLost)}`,
  )

  // 切回終端 view 之後仍必須拿得到一份**有效**的資源 —— 釋放若做過頭，症狀在這裡。
  await app.client.evaluate(TOGGLE_VIEW)
  const alive = await pollFor({
    read: () =>
      app.client.evaluate(`(() => {${RENDER_PATH_PRELUDE}
        const shown = hostsOf().filter((d) => !d.classList.contains('hidden'))
        return shown.map((host) => renderPathOf(host))
      })()`),
    settled: (paths) => paths.includes('programmatic'),
    timeoutMs: 15_000,
    label: '切回終端 view 後仍走程式化繪製',
  })
  check(
    results,
    '切回終端 view 後重新取得有效的渲染資源（釋放沒有做過頭）',
    alive.includes('programmatic'),
    `渲染路徑＝${JSON.stringify(alive)}`,
  )
}


/** 在對話 view 裡填入草稿並送出（等待狀態允許之後）。 */
async function sendFromConversation(app, text) {
  await typeDraft(app, text)
  await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.sendDisabled === false,
    timeoutMs: 25_000,
    label: '等待狀態允許送出',
  })
  await app.client.evaluate(`document.querySelector('${label('conversation.send')}').click()`)
}

/**
 * **agent 在 pty 之內換掉紀錄時，跟進必須跟著換。**
 *
 * 使用者於 agent 之內清空或切換對話會指派一份新的紀錄 —— 而那**發生在 pty 之內**：pty 沒死、
 * 自癒沒觸發，spekterm 收不到任何自己發出的訊號。唯一的線索是事件帶來的 `transcript_path`。
 *
 * 漏掉這條的失效**特別惡劣**：跟進器停在一份不再成長的檔上，落進「等它出現」而**永遠等下去**，
 * 且不算失敗。畫面就是一份安靜停住的對話，而終端裡 agent 明明在跑。
 *
 * 替身順帶送出 `SessionEnd` —— **它不代表 session 結束**（實測 `/clear` 就會發它而 pty 還活著）。
 * 把它接上拆除的實作，會在這一段之後再也收不到任何內容。
 */
async function runRelocateByEvent(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repo9-')
  const configDir = mkTemp('spekterm-agentview-config9-')
  const stub = makeStubAgent(mkTemp, configDir, { relocateAfterInput: true })
  const profile = seedProfile(repo)
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app

  await openConversation(app, repo.split('/').pop())
  // **前提要等內容真的到** —— `hasComposer` 只代表 view 掛上了，早於任何內容抵達。
  // 少了這道等待，前提會在「內容尚未到達」時就判紅，而它其實只是還沒到。
  const opened = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.text.includes('STUB-HELLO-'),
    timeoutMs: 25_000,
    label: '原本那一份紀錄的內容抵達',
  })
  check(results, '前提：跟進的是原本那一份紀錄', opened.text.includes('STUB-HELLO-'), '原本的內容已呈現')

  await sendFromConversation(app, 'TRIGGER-RELOCATE')
  const relocated = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.text.includes('RELOCATED-MARKER'),
    timeoutMs: 25_000,
    label: '事件回報新位置後，跟進改換來源',
  })
  check(
    results,
    'agent 於 pty 之內換掉紀錄時，跟進以事件回報的位置改換來源',
    relocated.text.includes('RELOCATED-MARKER'),
    '新紀錄的內容已呈現',
  )
  check(
    results,
    '「對話結束」的事件沒有把跟進拆掉（它不代表 session 結束）',
    relocated.hasComposer && relocated.hasToggle,
    `輸入框＝${relocated.hasComposer}，切換入口＝${relocated.hasToggle}`,
  )
}

/**
 * 忙碌狀態來自 agent 自己回報的事件，**不由畫面推測、也不模擬產生過程**。
 */
async function runBusyIndicator(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repoA-')
  const configDir = mkTemp('spekterm-agentview-configA-')
  const stub = makeStubAgent(mkTemp, configDir, { busySeconds: 4 })
  const profile = seedProfile(repo)
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app

  await openConversation(app, repo.split('/').pop())
  await sendFromConversation(app, 'MAKE-IT-BUSY')

  const busy = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.text.toUpperCase().includes(copy('conversation.busy').toUpperCase()),
    timeoutMs: 20_000,
    label: 'agent 宣告忙碌後畫面呈現忙碌',
  })
  check(
    results,
    'agent 回報忙碌時畫面呈現忙碌',
    busy.text.toUpperCase().includes(copy('conversation.busy').toUpperCase()),
    '畫面上出現忙碌指示',
  )
  /*
    忙碌時**仍然允許送出** —— agent 本來就接受在它工作時打字（會排隊），拒絕會很難用。

    **必須先打新的草稿再問。** 送出之後草稿被清空，而空草稿時送出鈕本來就是停用的 ——
    不重新打字就斷言，量到的是「草稿是不是空的」，不是「等待狀態允不允許」。
  */
  await typeDraft(app, 'WHILE-BUSY')
  const busyWithDraft = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.sendDisabled !== null,
    timeoutMs: 10_000,
    label: '忙碌中重新打字',
  })
  check(
    results,
    '忙碌時送出仍然可用（打了草稿之後）',
    busyWithDraft.sendDisabled === false,
    `送出停用＝${busyWithDraft.sendDisabled}`,
  )

  const idle = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => !state.text.toUpperCase().includes(copy('conversation.busy').toUpperCase()),
    timeoutMs: 25_000,
    label: 'agent 宣告就緒後忙碌指示消失',
  })
  check(
    results,
    'agent 回報就緒後忙碌指示消失',
    !idle.text.toUpperCase().includes(copy('conversation.busy').toUpperCase()),
    '忙碌指示已消失',
  )
}

/**
 * **A text-only answer shows busy** (`agent-event-bridge`, companion-test-fixes).
 *
 * The stub writes its answer after `answerSeconds` and reports no tool event at all, so the only thing that
 * can make the state busy is the submission event itself. `runBusyIndicator` cannot carry this: its stub
 * fires `PreToolUse`, which was busy before this change too.
 */
async function runTextOnlyBusy(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repoT-')
  const configDir = mkTemp('spekterm-agentview-configT-')
  const stub = makeStubAgent(mkTemp, configDir, { answerSeconds: 5 })
  const profile = seedProfile(repo)
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app

  await openConversation(app, repo.split('/').pop())
  await sendFromConversation(app, 'TEXT-ONLY-PROBE')
  const busyText = copy('conversation.busy').toUpperCase()
  const busy = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.text.toUpperCase().includes(busyText),
    timeoutMs: 15_000,
    label: 'a text-only answer shows busy',
  })
  check(
    results,
    'a text-only answer (no tool event) shows the agent busy',
    busy.text.toUpperCase().includes(busyText),
    `busy shown=${busy.text.toUpperCase().includes(busyText)}`,
  )
  const done = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.text.includes('STUB-ANSWER-1') && !state.text.toUpperCase().includes(busyText),
    timeoutMs: 25_000,
    label: 'the answer arrives and busy clears',
  })
  check(
    results,
    'the busy indicator clears when the answer ends',
    done.text.includes('STUB-ANSWER-1') && !done.text.toUpperCase().includes(busyText),
    `answer shown=${done.text.includes('STUB-ANSWER-1')}, still busy=${done.text.toUpperCase().includes(busyText)}`,
  )
}

/** Every user entry in the conversation view: its label (as written, not as CSS-transformed) and its text. */
const USER_ENTRIES = `(() => {
  const stage = document.querySelector('[aria-label="${copy('stage.terminal')}"]')
  const labels = new Set(${JSON.stringify(['userMessage', 'metaMessage', 'fromAnotherSession', 'fromASubagent', 'backgroundTask'].map((key) => copy(`conversation.${key}`)))})
  const prefixes = ${JSON.stringify([prefixOf('conversation.fromSession'), prefixOf('conversation.fromSubagent')])}
  return [...(stage?.querySelectorAll('.conversation-enter') ?? [])]
    .map((row) => ({ label: row.firstElementChild?.textContent ?? '', text: row.textContent ?? '' }))
    .filter((entry) => labels.has(entry.label) || prefixes.some((prefix) => entry.label.startsWith(prefix)))
})()`

/**
 * **A message delivered mid-turn is the user's; a background-task notice is not** (`agent-transcript-stream`).
 *
 * The stub records the sent line only as a `queued_command` attachment (`queuedDelivery`), never as a `user`
 * record — so the "not confirmed" label can clear, and the text can show under "You", only through the
 * attachment's projection. The notice is a `user` record shaped like the agent's (system prompt source,
 * non-human origin, no `isMeta`), appended by the stub on request.
 */
async function runMidTurnDelivery(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repoQ-')
  const configDir = mkTemp('spekterm-agentview-configQ-')
  const stub = makeStubAgent(mkTemp, configDir, { queuedDelivery: true, echoDelaySeconds: 3 })
  const profile = seedProfile(repo)
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app

  await openConversation(app, repo.split('/').pop())
  const conversation = stub.peerNames().at(-1)?.conversation
  await sendFromConversation(app, 'MIDTURN-PROBE')
  const marker = copy('conversation.unconfirmed').toUpperCase()
  const confirmed = await pollFor({
    read: () => app.client.evaluate(`({ view: ${VIEW_STATE}, entries: ${USER_ENTRIES} })`),
    settled: (state) =>
      !state.view.text.toUpperCase().includes(marker) && state.entries.some((e) => e.text.includes('MIDTURN-PROBE')),
    timeoutMs: 25_000,
    label: 'the mid-turn delivery appears and confirms the sent message',
  })
  const delivered = confirmed.entries.find((e) => e.text.includes('MIDTURN-PROBE'))
  check(
    results,
    'a message recorded as a mid-turn delivery shows as the user\'s message',
    delivered?.label === copy('conversation.userMessage'),
    `label=${JSON.stringify(delivered?.label ?? null)}`,
  )
  check(
    results,
    'the mid-turn delivery clears the "not confirmed" label',
    !confirmed.view.text.toUpperCase().includes(marker),
    `still unconfirmed=${confirmed.view.text.toUpperCase().includes(marker)}`,
  )

  stub.command(
    conversation,
    `printf '%s\\n' '{"type":"user","uuid":"notice-1","timestamp":"2026-09-06T00:00:03.000Z","promptSource":"system","origin":{"kind":"task-notification","producer":"session-task"},"message":{"role":"user","content":"<task-notification><task-id>NOTICE-PROBE</task-id><status>completed</status></task-notification>"}}' >> "$tp"`,
  )
  const noticed = await pollFor({
    read: () => app.client.evaluate(USER_ENTRIES),
    settled: (entries) => entries.some((e) => e.text.includes('NOTICE-PROBE')),
    timeoutMs: 15_000,
    label: 'the task notice arrives',
  })
  const notice = noticed.find((e) => e.text.includes('NOTICE-PROBE'))
  check(
    results,
    'a background-task notice is not shown as the user\'s message',
    notice?.label === copy('conversation.backgroundTask'),
    `label=${JSON.stringify(notice?.label ?? null)}`,
  )
}

/**
 * **A message the user did not type is labeled with where it came from, and never confirms a reply**
 * (`agent-conversation-view`, `remote-tool-detail` D4a / D4b / D5).
 *
 * Records are appended as the agent writes them (CLI 2.1.30x shapes, generic bodies): a session's message wrapped
 * with a socket address and carrying its `origin.body`, and a skill's meta text with no origin. Then a reply is
 * sent while the stub withholds its echo, and a mid-turn delivery from another session with **the same text**
 * arrives first: it must show labeled with the sender and leave "not confirmed" in place.
 * Control groups (run by hand, recorded here): drop `!e.meta` from the confirmation match → "not confirmed"
 * clears on the peer's entry (red); label every meta entry `metaMessage` → the session label check is red.
 */
async function runOriginLabels(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repoO-')
  const configDir = mkTemp('spekterm-agentview-configO-')
  const stub = makeStubAgent(mkTemp, configDir, { echoDelaySeconds: 8 })
  const profile = seedProfile(repo)
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app

  await openConversation(app, repo.split('/').pop())
  const conversation = stub.peerNames().at(-1)?.conversation
  const socket = 'uds:/run/user/1000/cc-socks/4242.sock'
  const origin = (body) => ({ kind: 'peer', from: socket, verifiedPeerPid: 4242, msg_id: `m-${body}`, name: 'api-server-8393', fromMode: 'prompting', body })
  const sessionMessage = {
    type: 'user',
    uuid: 'peer-1',
    timestamp: '2026-09-06T00:00:03.000Z',
    isMeta: true,
    promptSource: 'system',
    origin: origin('ORIGIN-PROBE please rebase'),
    message: { role: 'user', content: `Another Claude session sent a message:\n<cross-session-message from="${socket}" from-name="api-server-8393">\nORIGIN-PROBE please rebase\n</cross-session-message>` },
  }
  const skillText = { type: 'user', uuid: 'skill-1', timestamp: '2026-09-06T00:00:03.000Z', isMeta: true, message: { role: 'user', content: 'SKILL-PROBE base directory text' } }
  const append = (records) =>
    stub.command(conversation, records.map((r) => `printf '%s\\n' '${JSON.stringify(r)}' >> "$tp"`).join('; '))
  append([sessionMessage, skillText])
  const shown = await pollFor({
    read: () => app.client.evaluate(USER_ENTRIES),
    settled: (entries) => entries.some((e) => e.text.includes('ORIGIN-PROBE')) && entries.some((e) => e.text.includes('SKILL-PROBE')),
    timeoutMs: 15_000,
    label: 'the session message and the skill text arrive',
  })
  const peer = shown.find((e) => e.text.includes('ORIGIN-PROBE'))
  const skill = shown.find((e) => e.text.includes('SKILL-PROBE'))
  check(
    results,
    "a session's message is labeled with the sender's name and shown without the agent's wrapper",
    peer?.label === copy('conversation.fromSession', { name: 'api-server-8393' }) && !peer.text.includes('uds:') && !peer.text.includes('cross-session-message'),
    `label=${JSON.stringify(peer?.label ?? null)} text=${JSON.stringify(peer?.text.slice(0, 80) ?? null)}`,
  )
  check(
    results,
    'a not-typed message without an origin keeps the generic label',
    skill?.label === copy('conversation.metaMessage'),
    `label=${JSON.stringify(skill?.label ?? null)}`,
  )

  await sendFromConversation(app, 'SAME-TEXT-PROBE')
  const marker = copy('conversation.unconfirmed').toUpperCase()
  await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.text.toUpperCase().includes(marker),
    timeoutMs: 10_000,
    label: 'the reply is marked not confirmed',
  })
  append([
    {
      type: 'attachment',
      uuid: 'peer-2',
      timestamp: '2026-09-06T00:00:04.000Z',
      attachment: { type: 'queued_command', prompt: `<cross-session-message from="${socket}">\nSAME-TEXT-PROBE\n</cross-session-message>`, commandMode: 'prompt', isMeta: true, origin: origin('SAME-TEXT-PROBE') },
    },
  ])
  const arrived = await pollFor({
    read: () => app.client.evaluate(`({ view: ${VIEW_STATE}, entries: ${USER_ENTRIES} })`),
    settled: (state) => state.entries.some((e) => e.text.includes('SAME-TEXT-PROBE')),
    timeoutMs: 6_000,
    label: "the other session's mid-turn message with the same text",
  })
  const echo = arrived.entries.filter((e) => e.text.includes('SAME-TEXT-PROBE'))
  check(
    results,
    "another session's message with the reply's text is not the user's, and leaves the reply not confirmed",
    echo.length === 1 && echo[0].label === copy('conversation.fromSession', { name: 'api-server-8393' }) && arrived.view.text.toUpperCase().includes(marker),
    `entries=${JSON.stringify(echo.map((e) => e.label))} stillUnconfirmed=${arrived.view.text.toUpperCase().includes(marker)}`,
  )
}

/**
 * A result holding images is labeled with their count; a text-only result is not (`remote-result-images` D7).
 * Control group (run by hand, recorded here): hide the count in `ConversationView` (the one-image label red).
 */
async function runResultImageCount(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repoI-')
  const configDir = mkTemp('spekterm-agentview-configI-')
  const stub = makeStubAgent(mkTemp, configDir)
  const profile = seedProfile(repo)
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app

  await openConversation(app, repo.split('/').pop())
  const conversation = stub.peerNames().at(-1)?.conversation
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex').toString('base64')
  const result = (id, content) => ({ type: 'user', uuid: `r-${id}`, timestamp: '2026-10-25T00:00:01.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } })
  const records = [
    result('img-1', [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }]),
    result('txt-1', [{ type: 'text', text: 'COUNT-PROBE-TEXT' }]),
  ]
  stub.command(conversation, records.map((r) => `printf '%s\\n' '${JSON.stringify(r)}' >> "$tp"`).join('; '))
  const RESULTS = `[...document.querySelectorAll('details')].map((d) => ({ summary: d.querySelector('summary')?.textContent ?? '', body: d.querySelector('pre')?.textContent ?? null }))`
  const shown = await pollFor({
    read: () => app.client.evaluate(RESULTS),
    settled: (list) => list.some((r) => r.body === 'COUNT-PROBE-TEXT') && list.some((r) => r.body === ''),
    timeoutMs: 15_000,
    label: 'both results arrive',
  })
  const withImage = shown.find((r) => r.body === '')
  const textOnly = shown.find((r) => r.body === 'COUNT-PROBE-TEXT')
  check(
    results,
    'a result holding one image says so; a text-only result carries no count',
    withImage?.summary === `${copy('conversation.toolResult')} · ${copy('conversation.resultImages_one', { count: 1 })}` &&
      textOnly?.summary === copy('conversation.toolResult'),
    `image=${JSON.stringify(withImage?.summary ?? null)} text=${JSON.stringify(textOnly?.summary ?? null)}`,
  )
}

/**
 * A background subagent's permission prompt keeps the agent waiting on a choice (`agent-event-bridge`). Measured
 * (CLI 2.1.300): the agent reports its own turn end while the subagent's prompt is open, and a background-task
 * notice arrives as a prompt submission followed by another turn end. The state used to read ready there, and a
 * reply's text and Enter approve an open prompt.
 */
async function runSubagentPrompt(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repoS-')
  const configDir = mkTemp('spekterm-agentview-configS-')
  const stub = makeStubAgent(mkTemp, configDir)
  const profile = seedProfile(repo)
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app

  await openConversation(app, repo.split('/').pop())
  const conversation = stub.peerNames().at(-1)?.conversation
  await typeDraft(app, 'SHOULD-NOT-SEND')
  await pollFor({ read: () => app.client.evaluate(VIEW_STATE), settled: (state) => state.sendDisabled === false, timeoutMs: 25_000, label: 'ready to send' })
  const running = `{"hook_event_name":"Stop","background_tasks":[{"id":"sub1","type":"subagent","status":"running"}]}`
  stub.command(conversation, [
    `firej PreToolUse '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"t-sub","agent_id":"sub1","tool_input":{"command":"echo one"}}'`,
    `firej PermissionRequest '{"hook_event_name":"PermissionRequest","tool_name":"Bash","agent_id":"sub1","tool_input":{"command":"echo one"}}'`,
    `firej Stop '${running}'`,
    `firej UserPromptSubmit '{"hook_event_name":"UserPromptSubmit","prompt":"<task-notification><task-id>other</task-id></task-notification>"}'`,
    `firej Stop '${running}'`,
  ].join('\n'))
  const asking = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.sendDisabled === true && state.text.includes('terminal view'),
    timeoutMs: 15_000,
    label: 'the subagent prompt refuses sending',
  })
  // Several drains after the agent's turn end and the notice: still refused.
  await new Promise((resolve) => setTimeout(resolve, 2_000))
  const after = await app.client.evaluate(VIEW_STATE)
  check(
    results,
    'a background subagent\'s open prompt keeps the conversation view\'s input refused across the agent\'s turn end and a notice',
    asking.sendDisabled === true && after.sendDisabled === true && !stub.input().includes('SHOULD-NOT-SEND'),
    `disabled=${after.sendDisabled} text=${JSON.stringify(after.text.slice(-120))}`,
  )
}

/** A long reply the agent records as one paste is shown as its text and clears "not confirmed" (`agent-transcript-stream`). */
async function runPasteRecorded(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repoP-')
  const configDir = mkTemp('spekterm-agentview-configP-')
  const stub = makeStubAgent(mkTemp, configDir, { pasteWrap: true })
  const profile = seedProfile(repo)
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app

  await openConversation(app, repo.split('/').pop())
  const text = `PASTE-PROBE-${'p'.repeat(300)}`
  await sendFromConversation(app, text)
  const marker = copy('conversation.unconfirmed').toUpperCase()
  const confirmed = await pollFor({
    read: () => app.client.evaluate(`({ view: ${VIEW_STATE}, entries: ${USER_ENTRIES} })`),
    settled: (state) => !state.view.text.toUpperCase().includes(marker) && state.entries.some((e) => e.text.includes('PASTE-PROBE-')),
    timeoutMs: 25_000,
    label: 'the pasted reply confirmed',
  })
  const entry = confirmed.entries.find((e) => e.text.includes('PASTE-PROBE-'))
  check(
    results,
    'a long reply recorded as one paste is shown as its text, without markers, and clears "not confirmed"',
    !confirmed.view.text.toUpperCase().includes(marker) && Boolean(entry?.text.includes(text)) && !confirmed.view.text.includes('pasted_content'),
    `entry=${JSON.stringify(entry?.text.slice(0, 40))} markers=${confirmed.view.text.includes('pasted_content')}`,
  )
}

/**
 * A slash command the agent records in its command markers is shown as the line typed, and clears "not confirmed"
 * (`agent-transcript-stream`, `remote-phone-context` C4). The stub records a `/` line as the agent does
 * (`slashCommands`). Control group: drop `commandLine` from `project()` → the entry shows the markers (red).
 */
async function runSlashCommandLine(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repoC-')
  const configDir = mkTemp('spekterm-agentview-configC-')
  const stub = makeStubAgent(mkTemp, configDir, { slashCommands: true })
  const profile = seedProfile(repo)
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app

  await openConversation(app, repo.split('/').pop())
  await sendFromConversation(app, '/probe-skill SLASH-PROBE args')
  const marker = copy('conversation.unconfirmed').toUpperCase()
  const confirmed = await pollFor({
    read: () => app.client.evaluate(`({ view: ${VIEW_STATE}, entries: ${USER_ENTRIES} })`),
    settled: (state) => !state.view.text.toUpperCase().includes(marker) && state.entries.some((e) => e.text.includes('SLASH-PROBE')),
    timeoutMs: 25_000,
    label: 'the slash command confirmed',
  })
  const entry = confirmed.entries.find((e) => e.text.includes('SLASH-PROBE'))
  check(
    results,
    'a slash command is shown as the line typed, without its markers, and clears "not confirmed"',
    entry?.text.slice(entry.label.length).trim() === '/probe-skill SLASH-PROBE args' && entry?.label === copy('conversation.userMessage') &&
      !confirmed.view.text.includes('command-name') && !confirmed.view.text.toUpperCase().includes(marker),
    `entry=${JSON.stringify(entry?.text ?? null)} label=${JSON.stringify(entry?.label ?? null)} markers=${confirmed.view.text.includes('command-name')}`,
  )
}

/**
 * Automatic hibernation of agent sessions (session-hibernation design D4), threshold seeded as
 * seconds. Which sessions an agent's state keeps running depends on that state being current for
 * sessions nobody watches — the always-on subscription. Two sessions carry it: one never watched (it
 * reads `unknown` without the subscription, so it is never hibernated) and one watched until it was
 * waiting, then left and given work (it reads a stale `ready` without the subscription, so it is
 * hibernated mid-work).
 */
async function runAutoHibernateAgent(_mode, _config, context) {
  if (context.app) await context.app.close()
  const THRESHOLD_S = 5
  const repo = mkTemp('spekterm-agentview-repoH-')
  const configDir = mkTemp('spekterm-agentview-configH-')
  const stub = makeStubAgent(mkTemp, configDir)
  const profile = seedProfile(repo)
  writeFileSync(
    join(profile, 'preferences.json'),
    JSON.stringify({ version: 1, terminal: { autoHibernateSeconds: THRESHOLD_S }, ui: { language: 'en' } }),
  )
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app
  const repoName = repo.split('/').pop()

  /** Create an agent session and return its conversation id (the stub logs each start). */
  const create = async () => {
    const before = stub.peerNames().length
    await createAgentSession(app, repoName)
    const names = await pollFor({
      read: () => stub.peerNames(),
      settled: (list) => list.length > before,
      timeoutMs: 20_000,
      label: 'the new agent starts',
    })
    return names.at(-1).conversation
  }

  // A: idle, never shown in the conversation view.
  const idle = await create()
  // B: shown in the conversation view until it reports waiting.
  const watched = await create()
  await app.client.evaluate(TOGGLE_VIEW)
  await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.text.includes(`STUB-HELLO-${watched}`),
    timeoutMs: 20_000,
    label: 'B is watched and its content arrived',
  })
  await new Promise((resolve) => setTimeout(resolve, 1000))
  // D: leaves B; B is then given work that never ends while nobody watches it.
  const choosing = await create()
  stub.command(watched, 'fire PreToolUse')
  // E: leaves D; D then waits on a permission choice.
  await create()
  stub.command(choosing, 'fire PermissionRequest')

  const idleGone = await pollFor({
    read: () => agentAlive(idle),
    settled: (alive) => alive === false,
    timeoutMs: (THRESHOLD_S + 12) * 1000,
    interval: 250,
    label: 'the idle, never-watched agent is hibernated',
  })
  check(results, 'an idle agent that was never watched is hibernated after the threshold', idleGone === false, `alive=${idleGone}`)

  await new Promise((resolve) => setTimeout(resolve, (THRESHOLD_S + 3) * 1000))
  const kept = { working: agentAlive(watched), choosing: agentAlive(choosing) }
  check(results, 'an agent that started working while unwatched stays running (no stale ready)', kept.working, JSON.stringify(kept))
  check(results, 'an agent waiting on a permission choice stays running', kept.choosing, JSON.stringify(kept))

  // F: the conversation relocates while nobody watches it; opening its view follows the new file.
  const relocating = await create()
  await create()
  stub.command(
    relocating,
    [
      'tp="$dir/relocated-$sid.jsonl"',
      `printf '%s\n' '{"type":"assistant","uuid":"ru1","timestamp":"2026-09-06T00:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"RELOCATED-UNWATCHED"}]}}' >> "$tp"`,
      'fire SessionEnd',
      'fire SessionStart',
    ].join('\n'),
  )
  await new Promise((resolve) => setTimeout(resolve, 1500))
  await app.client.evaluate(focusTabExpression(4))
  const relocated = await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.text.includes('RELOCATED-UNWATCHED'),
    timeoutMs: 10_000,
    label: 'the view follows a relocation that happened while unwatched',
  })
  check(
    results,
    'opening the conversation view follows a relocation reported while nobody watched',
    relocated.text.includes('RELOCATED-UNWATCHED'),
    `view text=${JSON.stringify(relocated.text.slice(0, 160))}`,
  )
}

/**
 * The maximized side panel covers the terminal (`maximize-panel-and-confirm-close`): the same
 * transition as the conversation view on top — the terminal keeps its box, loses visibility, and
 * must return its renderer share (`terminal-sessions`). Observed the same way as above: the context
 * the probe holds is lost. Also the focus rules of design M2: restoring hands focus to the
 * conversation input, and a covered conversation view never takes focus (a dormant one would put it
 * on a Wake button nobody sees).
 */
async function runMaximizeCover(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repo-max-')
  const configDir = mkTemp('spekterm-agentview-config-max-')
  const stub = makeStubAgent(mkTemp, configDir)
  const profile = seedProfile(repo)
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app
  await openConversation(app, repo.split('/').pop())

  const ENTRY = `document.querySelector('[aria-label="${copy('stage.maximizeSidePanel')}"], [aria-label="${copy('stage.restoreSidePanel')}"]')`
  const MAXIMIZED = `${ENTRY}?.getAttribute('aria-pressed') === 'true'`
  const toggleMaximized = async (want) => {
    await app.client.evaluate(`${ENTRY}?.click()`)
    return pollFor({ read: () => app.client.evaluate(MAXIMIZED), settled: (v) => v === want, timeoutMs: 5000, label: `maximized=${want}` })
  }
  const CAPTURE_SHOWN_GL = `(() => {${RENDER_PATH_PRELUDE}
    window.__probeGlMax = window.__probeGlMax ?? []
    const shown = hostsOf().filter((d) => !d.classList.contains('hidden'))
    const host = shown[0]
    if (!host) return 'no-shown-host'
    const screen = host.querySelector('.xterm-screen')
    const main = screen
      ? [...screen.querySelectorAll('canvas')].find((c) => !c.classList.contains('xterm-link-layer'))
      : null
    const gl = main ? main.getContext('webgl2') : null
    if (!gl) return 'no-context'
    window.__probeGlMax.push(gl)
    return 'captured'
  })()`
  const LOST = `window.__probeGlMax.map((gl) => (gl ? gl.isContextLost() : null))`
  const FOCUS = `(() => {
    const el = document.activeElement
    if (!el || el === document.body) return 'body'
    if (el.matches('${label('conversation.composer')}')) return 'composer'
    if (el.tagName === 'BUTTON' && el.textContent === ${JSON.stringify(copy('sessions.wake'))}) return 'wake'
    if (document.querySelector('section[aria-label="${copy('openspec.sidePanel')}"]')?.contains(el)) return 'panel'
    if (el.closest('.xterm')) return 'terminal'
    return el.tagName.toLowerCase()
  })()`

  // ── GPU share: terminal view, capture, maximize ⇒ lost; restore ⇒ held again ──
  await app.client.evaluate(TOGGLE_VIEW)
  await pollFor({ read: () => app.client.evaluate(VIEW_STATE), settled: (state) => !state.hasComposer, timeoutMs: 15_000, label: 'terminal view' })
  const captured = await pollFor({ read: () => app.client.evaluate(CAPTURE_SHOWN_GL), settled: (r) => r === 'captured', timeoutMs: 15_000, label: 'capture the shown terminal context' })
  check(results, '[maximize] precondition: the shown terminal holds a renderer context', captured === 'captured', `capture=${captured}`)
  await toggleMaximized(true)
  const lost = await pollFor({ read: () => app.client.evaluate(LOST), settled: (list) => list[list.length - 1] === true, timeoutMs: 15_000, label: 'context lost under the cover' })
  check(results, '[maximize] the covered terminal returns its renderer share', lost[lost.length - 1] === true, `lost=${JSON.stringify(lost)}`)
  await toggleMaximized(false)
  const again = await pollFor({ read: () => app.client.evaluate(CAPTURE_SHOWN_GL), settled: (r) => r === 'captured', timeoutMs: 15_000, label: 'context again after restore' })
  const newest = await app.client.evaluate(LOST)
  check(results, '[maximize] after restoring the terminal holds a renderer again', again === 'captured' && newest[newest.length - 1] === false,
    `capture=${again} lost=${JSON.stringify(newest)}`)

  // ── Restoring returns focus to the conversation input ──
  await app.client.evaluate(TOGGLE_VIEW)
  await pollFor({ read: () => app.client.evaluate(VIEW_STATE), settled: (state) => state.hasComposer, timeoutMs: 15_000, label: 'conversation view' })
  await toggleMaximized(true)
  const focusMax = await pollFor({ read: () => app.client.evaluate(FOCUS), settled: (v) => v === 'panel', timeoutMs: 3000, label: 'focus in the panel' })
  await toggleMaximized(false)
  const focusBack = await pollFor({ read: () => app.client.evaluate(FOCUS), settled: (v) => v === 'composer', timeoutMs: 3000, label: 'focus in the composer' })
  check(results, '[maximize] restoring returns focus to the conversation input', focusMax === 'panel' && focusBack === 'composer',
    `maximized=${focusMax} restored=${focusBack}`)

  // ── A covered conversation view takes no focus: hibernate under the cover ──
  await toggleMaximized(true)
  for (const type of ['rawKeyDown', 'keyUp']) {
    await app.client.send('Input.dispatchKeyEvent', { type, key: 'H', code: 'KeyH', windowsVirtualKeyCode: 72, nativeVirtualKeyCode: 72, modifiers: 2 | 8 })
  }
  const dormant = await pollFor({ read: () => app.client.evaluate(WAKE_IN_STAGE), settled: (v) => v === true, timeoutMs: 8000, label: 'dormant under the cover' })
  await new Promise((resolve) => setTimeout(resolve, 600))
  const focusDormant = await app.client.evaluate(FOCUS)
  const stillMax = await app.client.evaluate(MAXIMIZED)
  check(results, '[maximize] a covered dormant conversation view does not take focus',
    dormant === true && stillMax === true && focusDormant !== 'wake', `dormant=${dormant} maximized=${stillMax} focus=${focusDormant}`)
  await toggleMaximized(false)
  const focusWake = await pollFor({ read: () => app.client.evaluate(FOCUS), settled: (v) => v === 'wake', timeoutMs: 3000, label: 'focus on Wake after restore' })
  check(results, '[maximize] restoring a dormant conversation view focuses its Wake button', focusWake === 'wake', `focus=${focusWake}`)
}

/**
 * The close confirmation marks a working agent (workspace-app-shell, "A working agent is marked").
 * The native dialog is the stand-in in src/main/close-dialog-stub.ts (throwaway profile): writing
 * close-stub/close makes the main process close the window as its close button does, and the prompt
 * is read back from close-stub/dialogs.jsonl.
 */
async function runCloseConfirmAgent(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repoC-')
  const configDir = mkTemp('spekterm-agentview-configC-')
  const stub = makeStubAgent(mkTemp, configDir, { busySeconds: 30 })
  const profile = seedProfile(repo)
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app
  const repoName = repo.split('/').pop()
  const root = join(profile, 'close-stub')
  const dialogs = () => {
    try {
      return readFileSync(join(root, 'dialogs.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    } catch {
      return []
    }
  }

  await openConversation(app, repoName)
  await sendFromConversation(app, 'MAKE-IT-BUSY')
  await pollFor({
    read: () => app.client.evaluate(VIEW_STATE),
    settled: (state) => state.text.toUpperCase().includes(copy('conversation.busy').toUpperCase()),
    timeoutMs: 20_000,
    label: 'the agent reports working',
  })

  writeFileSync(join(root, 'answer'), 'cancel')
  writeFileSync(join(root, 'close'), String(Date.now()))
  const prompts = await pollFor({
    read: dialogs,
    settled: (value) => value.length >= 1,
    timeoutMs: 8000,
    interval: 100,
    label: 'the close prompt',
  })
  const firstLine = (prompts[0]?.detail ?? '').split('\n')[0]
  const slot = 'LABEL_SLOT'
  const [prefix, suffix] = copy('closeConfirm.lineWorking', { item: repoName, label: slot }).split(slot)
  check(
    results,
    'a working agent is marked in the close confirmation',
    firstLine.startsWith(prefix) && firstLine.endsWith(suffix) && firstLine.length > prefix.length + suffix.length,
    `line=${JSON.stringify(firstLine)} expected ${JSON.stringify(prefix)}…${JSON.stringify(suffix)}`,
  )
}


// ── session-wait-indicator ─────────────────────────────────────────────────

/** One folder's rail rows and the stage's tabs, in the shared order, plus the two folder rows' titles. */
function attentionState(names) {
  return `(() => {
    const titles = (root, selector) => [...(root?.querySelectorAll(selector) ?? [])].map((el) => el.getAttribute('title') ?? '')
    const tablist = document.querySelector('[role="tablist"][aria-label="${copy('sessions.tabs')}"]')
    const rows = document.querySelector('[aria-label="${copy('rail.folderSessions', { name: names.f })}"]')
    return {
      tabs: titles(tablist, '[role="tab"]'),
      rows: titles(rows, ':scope > li > [role="button"]'),
      folder: document.querySelector('[aria-label="${names.f}"]')?.getAttribute('title') ?? null,
      empty: document.querySelector('[aria-label="${names.g}"]')?.getAttribute('title') ?? null,
      focus: document.hasFocus(),
    }
  })()`
}

const STATUS = (key) => copy('sessions.statusRunningWith', { state: copy(key) })
const WAITING = STATUS('sessions.attentionWaiting')
const CHOICE = STATUS('sessions.attentionChoice')
const WORKING = STATUS('sessions.attentionWorking')
const IDLE = STATUS('sessions.attentionIdle')
const URGENT = (key) => copy('rail.mostUrgent', { state: copy(key) })
/** Any attention words at all, for "running and nothing more". */
const ANY_ATTENTION = [WAITING, CHOICE, WORKING, IDLE]

/** A turn: the prompt is reported, the agent works for a moment, the turn ends. */
const TURN = (seconds = 1) => `fire UserPromptSubmit\nsleep ${seconds}\nfire Stop`

async function createSessionOf(app, repoName, match) {
  await pollFor({ read: () => app.client.evaluate(selectRepoExpression(repoName)), settled: (ok) => ok === true, timeoutMs: 15_000, label: 'select the repo' })
  await pollFor({ read: () => app.client.evaluate(CREATE_SESSION), settled: (r) => r === 'clicked', timeoutMs: 15_000, label: 'the create entry' })
  await pollFor({
    read: () =>
      app.client.evaluate(`(() => {
        const item = [...document.querySelectorAll('[role="menuitem"]')]
          .find((el) => el.textContent.trim().toLowerCase().includes(${JSON.stringify(match)}))
        if (!item) return false
        item.click()
        return true
      })()`),
    settled: (ok) => ok === true,
    timeoutMs: 15_000,
    label: `the spawn menu offers ${match}`,
  })
}

/**
 * **The status dots say whether an agent needs the user** (`session-wait-indicator`).
 *
 * The dots are `aria-hidden`; what they say is in the row's and the tab's title, from the dictionary — that is
 * what is read here. The stub starts without its startup `Stop`, as a real agent does: with it, every session would
 * start "waiting", and an "unseen turn end shows waiting" assertion would pass with no turn-end detection at all.
 *
 * Folder F holds agents A, B, C and a shell; folder G holds nothing. The steps that need the window to have focus
 * (looking at a session clears it) check `document.hasFocus()` first and record a gap without it — the focus rule is
 * carried by `looked-at.test.ts`.
 */
async function runAttention(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repoW-')
  const empty = mkTemp('spekterm-agentview-repoW2-')
  const configDir = mkTemp('spekterm-agentview-configW-')
  // The start is reported four seconds after spawn, by when a later session is displayed: a start that is shown
  // as it arrives is seen at once, and the baseline below could then not tell a turn end from a start.
  const stub = makeStubAgent(mkTemp, configDir, { startupStop: false, readyDelaySeconds: 4 })
  const profile = mkTemp('spekterm-agentview-profile-')
  writeFileSync(
    join(profile, 'workspace.json'),
    JSON.stringify({
      version: 1,
      folders: [
        { id: 'f1', path: repo, addedAt: '2026-09-06T00:00:00.000Z' },
        { id: 'f2', path: empty, addedAt: '2026-09-06T00:00:00.000Z' },
      ],
    }),
  )
  const names = { f: repo.split('/').pop(), g: empty.split('/').pop() }
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app
  const state = () => app.client.evaluate(attentionState(names))

  for (let i = 0; i < 3; i++) await createSessionOf(app, names.f, 'claude')
  await createSessionOf(app, names.f, 'shell')
  const started = await pollFor({ read: () => stub.peerNames(), settled: (list) => list.length >= 3, timeoutMs: 30_000, label: 'three agents started' })
  const [a, b, c] = started.map((entry) => entry.conversation)
  // Four tabs, read before the agents report their start (four seconds after spawn).
  const created = await pollFor({ read: state, settled: (s) => s.tabs.length === 4, timeoutMs: 3_000, label: 'four tabs' })
  check(
    results,
    'the shell is displayed before the agents report their start (the baseline can tell a start from a turn end)',
    created.tabs.length === 4 && !created.tabs.slice(0, 3).some((t) => ANY_ATTENTION.some((w) => t.includes(w))),
    JSON.stringify(created.tabs),
  )

  const baseline = await pollFor({
    read: state,
    settled: (s) => s.tabs.length === 4 && s.tabs.slice(0, 3).every((t) => t.includes(IDLE)),
    timeoutMs: 25_000,
    label: 'three idle agents',
  })
  check(
    results,
    'a started agent that reported only its start is idle, not waiting (the baseline)',
    baseline.tabs.slice(0, 3).every((t) => t.includes(IDLE)) && !baseline.tabs.some((t) => t.includes(WAITING)),
    JSON.stringify(baseline.tabs),
  )
  check(
    results,
    'a shell session states running and no attention state',
    baseline.tabs[3]?.includes(copy('sessions.statusRunning')) && !ANY_ATTENTION.some((w) => baseline.tabs[3].includes(w)),
    JSON.stringify(baseline.tabs[3]),
  )
  check(
    results,
    'a folder with no session names no state',
    baseline.empty !== null && !baseline.empty.includes(prefixOf('rail.mostUrgent')),
    JSON.stringify(baseline.empty),
  )

  // The agent reports a conversation end with nothing after it (CLI 2.1.317+ does, in a live process): B stays idle.
  // The barrier is positive — the command writes its drop point's path after firing, and the read waits until the
  // drop point has been read empty — so "still idle" cannot pass on an event that was never read.
  const endMarker = join(mkTemp('spekterm-agentview-endW-'), 'drop-point')
  stub.command(b, `firej SessionEnd '{"hook_event_name":"SessionEnd","reason":"other"}'\nprintf %s "$SPEKTERM_EVENT_DIR" > '${endMarker}'`)
  await pollFor({
    read: () => {
      if (!existsSync(endMarker)) return null
      const dir = readFileSync(endMarker, 'utf8')
      return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')).length : null
    },
    settled: (pending) => pending === 0,
    timeoutMs: 15_000,
    label: "B's conversation end was read",
  })
  // One more drain tick, then the tab.
  await new Promise((resolve) => setTimeout(resolve, 1_000))
  const ended = await state()
  check(
    results,
    'a conversation end the agent reports with nothing after it leaves an idle session idle, not running',
    ended.tabs[1]?.includes(IDLE) && !ANY_ATTENTION.some((w) => w !== IDLE && ended.tabs[1].includes(w)),
    JSON.stringify(ended.tabs[1]),
  )

  // B is displayed while A finishes a turn: A was not looked at.
  await app.client.evaluate(focusTabExpression(1))
  stub.command(a, TURN())
  const unseen = await pollFor({ read: state, settled: (s) => s.tabs[0]?.includes(WAITING), timeoutMs: 20_000, label: 'A waits' })
  check(
    results,
    'a turn that ends unseen states "waiting for you" on the rail row and the tab',
    unseen.tabs[0]?.includes(WAITING) && unseen.rows[0]?.includes(WAITING),
    JSON.stringify({ tab: unseen.tabs[0], row: unseen.rows[0] }),
  )
  check(results, "the folder row's title states waiting", unseen.folder?.includes(URGENT('sessions.attentionWaiting')), JSON.stringify(unseen.folder))

  // C works: waiting still outranks working on the folder row.
  stub.command(c, 'fire UserPromptSubmit')
  const working = await pollFor({ read: state, settled: (s) => s.tabs[2]?.includes(WORKING), timeoutMs: 20_000, label: 'C works' })
  check(results, 'a turn in progress states "working"', working.tabs[2]?.includes(WORKING), JSON.stringify(working.tabs[2]))
  check(
    results,
    'with one session working and another waiting, the folder row states waiting',
    working.folder?.includes(URGENT('sessions.attentionWaiting')) && working.tabs[0]?.includes(WAITING),
    JSON.stringify({ folder: working.folder, a: working.tabs[0] }),
  )

  // Collapsed, the folder row still says it.
  await app.client.evaluate(`document.querySelector('${label('rail.collapseSessions', { name: names.f })}')?.click()`)
  const collapsed = await pollFor({ read: state, settled: (s) => s.rows.length === 0, timeoutMs: 10_000, label: 'F collapsed' })
  check(
    results,
    'a collapsed folder still states waiting on its row',
    collapsed.rows.length === 0 && collapsed.folder?.includes(URGENT('sessions.attentionWaiting')),
    JSON.stringify({ rows: collapsed.rows.length, folder: collapsed.folder }),
  )
  await app.client.evaluate(`document.querySelector('${label('rail.expandSessions', { name: names.f })}')?.click()`)
  await pollFor({ read: state, settled: (s) => s.rows.length === 4, timeoutMs: 10_000, label: 'F expanded' })

  // A background subagent's tool start after the turn: not a new turn.
  stub.command(a, `firej PreToolUse '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"t-late","agent_id":"sub1","tool_input":{"command":"ls"}}'`)
  await new Promise((resolve) => setTimeout(resolve, 2_000))
  const late = await state()
  check(results, "a subagent's late tool start leaves the session waiting", late.tabs[0]?.includes(WAITING), JSON.stringify(late.tabs[0]))
  stub.command(c, 'fire Stop')

  if (!late.focus) {
    console.log('  (the window has no focus: "looking clears it" is carried by looked-at.test.ts and wait-seen.test.ts — a recorded gap)')
    return
  }

  // Looking at A clears it.
  await app.client.evaluate(focusTabExpression(0))
  const looked = await pollFor({ read: state, settled: (s) => s.tabs[0]?.includes(IDLE), timeoutMs: 10_000, label: 'A looked at' })
  check(results, 'turning to a session in the focused window states "idle"', looked.tabs[0]?.includes(IDLE), JSON.stringify(looked.tabs[0]))

  // B finishes a turn while displayed: working, then idle, never waiting.
  await app.client.evaluate(focusTabExpression(1))
  await pollFor({ read: state, settled: (s) => s.tabs[1]?.includes(IDLE), timeoutMs: 10_000, label: 'B displayed and idle' })
  const seenStates = []
  stub.command(b, TURN(2))
  await pollFor({
    read: async () => {
      const s = await state()
      seenStates.push(s.tabs[1])
      return s
    },
    settled: (s) => seenStates.some((t) => t?.includes(WORKING)) && s.tabs[1]?.includes(IDLE),
    timeoutMs: 20_000,
    label: 'B worked and is idle',
  })
  check(
    results,
    'a turn that ends while the user watches goes working → idle, never waiting',
    seenStates.some((t) => t?.includes(WORKING)) && seenStates.at(-1)?.includes(IDLE) && !seenStates.some((t) => t?.includes(WAITING)),
    JSON.stringify([...new Set(seenStates)]),
  )

  // A, displayed, asks for permission: a choice even while looked at; typing into it answers it.
  await app.client.evaluate(focusTabExpression(0))
  stub.command(
    a,
    [
      `firej PreToolUse '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"t-ask","tool_input":{"command":"rm x"}}'`,
      `firej PermissionRequest '{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"rm x"}}'`,
    ].join('\n'),
  )
  const asking = await pollFor({ read: state, settled: (s) => s.tabs[0]?.includes(CHOICE), timeoutMs: 15_000, label: 'A asks' })
  check(results, 'a permission prompt states "asks for a choice" even when displayed', asking.tabs[0]?.includes(CHOICE), JSON.stringify(asking.tabs[0]))
  await app.client.evaluate(`(() => {
    const box = [...document.querySelectorAll('[aria-label="${copy('stage.terminal')}"] .xterm-helper-textarea')]
      .find((el) => el.closest('.xterm')?.getBoundingClientRect().width > 0)
    box?.focus()
    return Boolean(box)
  })()`)
  await app.client.send('Input.insertText', { text: 'n' })
  const answered = await pollFor({ read: state, settled: (s) => !s.tabs[0]?.includes(CHOICE), timeoutMs: 10_000, label: 'A answered at the desktop' })
  check(results, 'a choice typed into at the desktop no longer shows as a choice', !answered.tabs[0]?.includes(CHOICE), JSON.stringify(answered.tabs[0]))

  // After A was seen, a new turn that ends while B is displayed is unseen again.
  stub.command(a, `firej PostToolUse '{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_use_id":"t-ask","tool_input":{"command":"rm x"}}'\nfire Stop`)
  await pollFor({ read: state, settled: (s) => s.tabs[0]?.includes(IDLE), timeoutMs: 10_000, label: 'A idle again' })
  await app.client.evaluate(focusTabExpression(1))
  stub.command(a, TURN())
  const again = await pollFor({ read: state, settled: (s) => s.tabs[0]?.includes(WAITING), timeoutMs: 20_000, label: 'A waits again' })
  check(results, 'a new turn end after being seen states "waiting for you" again', again.tabs[0]?.includes(WAITING), JSON.stringify(again.tabs[0]))
}

/** An agent that reports nothing (event reporting not honored) keeps the running dot (`session-wait-indicator`). */
async function runAttentionUnreported(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repoU-')
  const configDir = mkTemp('spekterm-agentview-configU-')
  const stub = makeStubAgent(mkTemp, configDir, { honorHooks: false })
  const profile = seedProfile(repo)
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app
  await createSessionOf(app, repo.split('/').pop(), 'claude')
  await pollFor({ read: () => stub.peerNames(), settled: (list) => list.length >= 1, timeoutMs: 30_000, label: 'the agent started' })
  await new Promise((resolve) => setTimeout(resolve, 2_000))
  const tab = await app.client.evaluate(`document.querySelector('[role="tablist"][aria-label="${copy('sessions.tabs')}"] [role="tab"]')?.getAttribute('title') ?? null`)
  check(
    results,
    'an agent session whose wait state is unknown states running and no attention state',
    tab?.includes(copy('sessions.statusRunning')) && !ANY_ATTENTION.some((w) => tab.includes(w)),
    JSON.stringify(tab),
  )
}

// ── The main stage header's workspace summary (`session-wait-indicator`) ─────

const SUMMARY_BUCKETS = ['needsYou', 'error', 'working', 'running', 'idle', 'hibernated', 'ended']
const BUCKET_OF_WORDS = new Map(SUMMARY_BUCKETS.map((bucket) => [copy(`stage.summaryState.${bucket}`), bucket]))

/** The header: its first line, the summary's controls (bucket, count, tooltip, rect), and its layout. */
const SUMMARY_STATE = `(() => {
  const header = document.querySelector('main${label('stage.label')} > header')
  const group = header?.querySelector('[role="group"]${label('stage.summary')}')
  const controls = [...(group?.querySelectorAll('button') ?? [])].map((button) => {
    const r = button.getBoundingClientRect()
    return { label: button.getAttribute('aria-label'), title: button.getAttribute('title'), text: button.innerText.replace(/\\s+/g, ' ').trim(), x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  const fold = group?.querySelector('[role="img"]')
  return {
    first: header ? header.innerText.split('\\n')[0].trim() : null,
    text: header?.innerText ?? '',
    controls,
    fold: fold ? { label: fold.getAttribute('aria-label'), title: fold.getAttribute('title') } : null,
    focus: document.hasFocus(),
  }
})()`

/** `{ bucket: count }` from the controls' accessible names ("needs you: 2"). */
function countsOf(state) {
  const counts = {}
  for (const control of state?.controls ?? []) {
    const match = control.label?.match(/^(.*?)[:：]\s*(\d+)$/)
    const bucket = match && BUCKET_OF_WORDS.get(match[1])
    if (bucket) counts[bucket] = Number(match[2])
  }
  return counts
}

const SELECTED_TAB_TEXT = `document.querySelector('[role="tablist"]${label('sessions.tabs')} [role="tab"][aria-selected="true"]')?.innerText.replace(/\\s+/g, ' ').trim() ?? null`

/** A rail session row by its label, and whether it lies inside its scrolling list's view. */
const RAIL_ROW = (text) => `(() => {
  const row = [...document.querySelectorAll('aside${label('rail.label')} ul ul > li > [role="button"]')]
    .find((el) => el.innerText.includes(${JSON.stringify(text)}))
  if (!row) return null
  const list = row.closest('aside > ul')
  const a = list.getBoundingClientRect()
  const b = row.getBoundingClientRect()
  return { visible: b.top >= a.top - 0.5 && b.bottom <= a.bottom + 0.5 }
})()`
const ITEM_ROW = (name) => `(() => {
  const row = document.querySelector('aside${label('rail.label')} [role="button"][aria-label="${name}"]')
  if (!row) return null
  const list = row.closest('aside > ul')
  const a = list.getBoundingClientRect()
  const b = row.getBoundingClientRect()
  return { visible: b.top >= a.top - 0.5 && b.bottom <= a.bottom + 0.5, rows: row.closest('li')?.querySelectorAll('ul > li').length ?? 0 }
})()`
/** The session rows' labels in DOM order (the rail's row order). */
const RAIL_ROW_LABELS = `[...document.querySelectorAll('aside${label('rail.label')} ul ul > li > [role="button"]')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim())`
const SCROLL_RAIL_TOP = `(() => { for (const ul of document.querySelectorAll('aside${label('rail.label')} > ul')) ul.scrollTop = 0; return true })()`
const SCROLL_RAIL_BOTTOM = `(() => { for (const ul of document.querySelectorAll('aside${label('rail.label')} > ul')) ul.scrollTop = ul.scrollHeight; return true })()`
const HEADER_LAYOUT = `(() => {
  const header = document.querySelector('main${label('stage.label')} > header')
  const h = header.getBoundingClientRect()
  const children = [...header.children].filter((el) => getComputedStyle(el).position !== 'absolute' && el.getBoundingClientRect().width > 0)
  const name = header.firstElementChild.getBoundingClientRect()
  const buttons = [...header.querySelectorAll('button, [role="tab"]')].filter((el) => !el.closest('[aria-hidden="true"]'))
  return {
    nameWidth: Math.round(name.width),
    // One line: every visible child shares the name's row (their vertical ranges overlap it).
    oneLine: children.every((el) => { const r = el.getBoundingClientRect(); return r.top < name.bottom && r.bottom > name.top }),
    inside: buttons.every((el) => { const r = el.getBoundingClientRect(); return r.left >= h.left - 0.5 && r.right <= h.right + 0.5 }),
    summary: header.querySelector('[role="group"]${label('stage.summary')}')?.innerText.replace(/\\s+/g, ' ').trim() ?? null,
    width: Math.round(h.width),
  }
})()`

async function clickAt(app, at) {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await app.client.send('Input.dispatchMouseEvent', {
      type,
      x: at.x,
      y: at.y,
      button: type === 'mouseMoved' ? 'none' : 'left',
      buttons: type === 'mousePressed' ? 1 : 0,
      clickCount: 1,
    })
  }
}

/** A real click on the summary control of `bucket`; `false` when it is not listed. */
async function clickBucket(app, bucket) {
  const state = await app.client.evaluate(SUMMARY_STATE)
  const words = copy(`stage.summaryState.${bucket}`)
  const control = state.controls.find((c) => c.label?.startsWith(`${words}:`) || c.label?.startsWith(`${words}：`))
  if (!control) return false
  await clickAt(app, control)
  return true
}

/**
 * The header summary: two folders (one pinned), a handed-off child, hibernated, ended and errored sessions, and
 * agents in several states, with the global item selected. Dormant sessions come from a seeded `sessions.json`
 * (their order, a child in it, and their titles are then fixed); live ones are created through the UI.
 */
async function runSummary(_mode, _config, context) {
  if (context.app) await context.app.close()
  // Short folder names: a long one in the header leaves the summary less room, and the probe clicks its controls.
  const sumBase = mkTemp('spekterm-agentview-sum-')
  const folder = (name) => {
    mkdirSync(join(sumBase, name))
    return join(sumBase, name)
  }
  const pinned = folder('pin')
  const plain = folder('plain')
  const removed = folder('gone')
  // W, after U, holds running shells: with them below U in the scrolling list, U's row can be scrolled out of view.
  // Its long name is the one the narrow-header check truncates.
  const lower = folder('lower-folder-with-a-rather-long-name')
  const names = { p: pinned.split('/').pop(), u: plain.split('/').pop(), r: removed.split('/').pop(), w: lower.split('/').pop() }
  const configDir = mkTemp('spekterm-agentview-configS-')
  const stub = makeStubAgent(mkTemp, configDir, { startupStop: false })
  const profile = mkTemp('spekterm-agentview-profile-')
  writeFileSync(
    join(profile, 'workspace.json'),
    JSON.stringify({
      version: 1,
      folders: [
        { id: 'fu', path: plain, addedAt: '2026-10-01T00:00:00.000Z' },
        { id: 'fp', path: pinned, addedAt: '2026-10-01T00:00:00.000Z', pinned: true },
        { id: 'fr', path: removed, addedAt: '2026-10-01T00:00:00.000Z' },
        { id: 'fw', path: lower, addedAt: '2026-10-01T00:00:00.000Z' },
      ],
    }),
  )
  const id = (n) => `0a1b2c3d-0000-4000-8000-00000000000${n}`
  // P's single order puts the child last; on the rail it sits under its parent: H-P1, H-P2 (child), H-P3.
  writeFileSync(
    join(profile, 'sessions.json'),
    JSON.stringify({
      version: 1,
      sessions: [
        { id: id(1), folderId: 'fp', spawnTarget: 'shell', ordinal: 1, customTitle: 'H-P1' },
        { id: id(3), folderId: 'fp', spawnTarget: 'shell', ordinal: 3, customTitle: 'H-P3' },
        {
          id: id(2),
          folderId: 'fp',
          spawnTarget: 'shell',
          ordinal: 2,
          customTitle: 'H-P2',
          lineage: { parentId: id(1), origin: { kind: 'folder', folderId: 'fp', folderName: names.p } },
        },
        { id: id(4), folderId: 'fu', spawnTarget: 'shell', ordinal: 1, customTitle: 'H-U1' },
      ],
    }),
  )
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app
  const state = () => app.client.evaluate(SUMMARY_STATE)
  const selectGlobal = () =>
    app.client.evaluate(`document.querySelector('aside${label('rail.label')} [role="button"]${label('rail.globalName')}')?.click() ?? false`)

  // Live sessions: a running shell in R (removed later), four in W, two agents in U, an ended and an errored shell in P.
  await createSessionOf(app, names.r, 'shell')
  for (let i = 0; i < 4; i += 1) await createSessionOf(app, names.w, 'shell')
  await createSessionOf(app, names.u, 'claude')
  await createSessionOf(app, names.u, 'claude')
  const started = await pollFor({ read: () => stub.peerNames(), settled: (list) => list.length >= 2, timeoutMs: 30_000, label: 'two agents' })
  const [a, b] = started.map((entry) => entry.conversation)
  for (const code of [0, 3]) {
    await createSessionOf(app, names.p, 'shell')
    await new Promise((resolve) => setTimeout(resolve, 1200))
    await app.client.evaluate(`(() => {
      const box = [...document.querySelectorAll('[aria-label="${copy('stage.terminal')}"] .xterm-helper-textarea')]
        .find((el) => el.closest('.xterm')?.getBoundingClientRect().width > 0)
      box?.focus()
      return Boolean(box)
    })()`)
    await app.client.send('Input.insertText', { text: `exit ${code}` })
    await pressKey(app.client, 'Enter')
  }
  await selectGlobal()
  // A ends a turn unseen (needs you); B works.
  stub.command(a, TURN())
  stub.command(b, 'fire UserPromptSubmit')
  const listed = await pollFor({
    read: state,
    settled: (s) => {
      const c = countsOf(s)
      return c.needsYou === 1 && c.working === 1 && c.error === 1 && c.ended === 1 && c.hibernated === 4 && c.running === 5
    },
    timeoutMs: 30_000,
    label: 'the summary lists every state',
  })
  const counts = countsOf(listed)
  check(
    results,
    '[summary] the header counts the whole workspace by state, with the global item selected',
    listed.first === copy('rail.globalName') &&
      JSON.stringify(Object.keys(counts)) === JSON.stringify(['needsYou', 'error', 'working', 'running', 'hibernated', 'ended']),
    `${listed.first}: ${JSON.stringify(counts)}`,
  )
  check(
    results,
    '[summary] the header shows no path',
    ![pinned, plain, removed].some((path) => listed.text.includes(path)),
    JSON.stringify(listed.text.slice(0, 160)),
  )

  // R is removed while its shell keeps running: no longer counted.
  await app.client.evaluate(`document.querySelector(${JSON.stringify(`button${label('rail.removeFolder', { name: names.r })}`)})?.click() ?? false`)
  const afterRemoval = await pollFor({ read: state, settled: (s) => countsOf(s).running === 4, timeoutMs: 8_000, label: 'R removed' })
  check(results, "[summary] a removed folder's running session is not counted", countsOf(afterRemoval).running === 4, JSON.stringify(countsOf(afterRemoval)))

  // B, not displayed, ends its turn: one fewer working, one more needing you.
  stub.command(b, 'fire Stop')
  const turned = await pollFor({ read: state, settled: (s) => countsOf(s).needsYou === 2, timeoutMs: 15_000, label: 'B ends its turn' })
  check(
    results,
    '[summary] a working session that ends a turn unseen moves from working to needs you',
    countsOf(afterRemoval).working === 1 && countsOf(turned).working === undefined && countsOf(turned).needsYou === 2,
    `${JSON.stringify(countsOf(afterRemoval))} → ${JSON.stringify(countsOf(turned))}`,
  )

  // The tooltip names the sessions; "needs you" says which ask for a choice. B asks for permission.
  stub.command(
    b,
    [
      `firej PreToolUse '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"t-ask","tool_input":{"command":"rm x"}}'`,
      `firej PermissionRequest '{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"rm x"}}'`,
    ].join('\n'),
  )
  const asking = await pollFor({
    read: state,
    // The needs-you tooltip's line for a session that asks for a choice ends with this.
    settled: (s) => s.controls.some((c) => c.title?.includes(copy('stage.summaryChoice', { session: '%S%', item: names.u }).split('%S%')[1])),
    timeoutMs: 15_000,
    label: 'B asks',
  })
  const needs = asking.controls.find((c) => c.label?.startsWith(copy('stage.summaryState.needsYou')))
  // The lines name each session with its rail item; the session titles are read back from them.
  const lines = (needs?.title ?? '').split('\n').slice(1).map((line) => line.replace(/^• /, ''))
  const titleOf = (key) => {
    const [before, after] = copy(key, { session: '%S%', item: names.u }).split('%S%')
    const line = lines.find((l) => l.endsWith(after))
    return line ? line.slice(before.length, line.length - after.length) : null
  }
  const aTitle = titleOf('stage.summaryTurnEnded')
  const bTitle = titleOf('stage.summaryChoice')
  check(
    results,
    '[summary] the tooltip lists the sessions with their rail items and says which asks for a choice',
    lines.length === 2 && aTitle !== null && bTitle !== null && aTitle !== bTitle,
    JSON.stringify(needs?.title),
  )

  // Activating "needs you" after a click on the rail and with the target scrolled away: U is selected, A is
  // focused, and A's rail row is scrolled into view. The viewport is made short so that the rail overflows.
  //
  // The clicks are what made the old pointer exception fail: a click on a row inside U's block set U's flag, which
  // only a key cleared, so U's session row was never scrolled to after it. Now the click on the global row (outside
  // U's block) and the click on the header clear it.
  const centerOf = (selector) =>
    app.client.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null })()`)
  const u1 = await app.client.evaluate(`(() => {
    const row = [...document.querySelectorAll('aside${label('rail.label')} ul ul > li > [role="button"]')].find((el) => el.innerText.includes('H-U1'))
    row?.scrollIntoView({ block: 'nearest' })
    const r = row?.getBoundingClientRect()
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
  })()`)
  await clickAt(app, u1)
  await new Promise((resolve) => setTimeout(resolve, 300))
  await clickAt(app, await centerOf(`aside${label('rail.label')} [role="button"]${label('rail.globalName')}`))
  await app.client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 330, deviceScaleFactor: 0, mobile: false })
  await new Promise((resolve) => setTimeout(resolve, 600))
  await app.client.evaluate(SCROLL_RAIL_TOP)
  await new Promise((resolve) => setTimeout(resolve, 300))
  const hiddenBefore = await app.client.evaluate(RAIL_ROW(aTitle))
  await clickBucket(app, 'needsYou')
  const jumped = await pollFor({
    read: async () => ({ first: (await state()).first, tab: await app.client.evaluate(SELECTED_TAB_TEXT), row: await app.client.evaluate(RAIL_ROW(aTitle)) }),
    settled: (v) => v.first === names.u && v.tab?.includes(aTitle) && v.row?.visible === true,
    timeoutMs: 6_000,
    label: 'the jump to A',
  })
  check(
    results,
    '[summary] activating "needs you" selects the folder, focuses the session and the rail shows its row, even after a click on the rail',
    hiddenBefore?.visible === false && jumped.first === names.u && jumped.tab?.includes(aTitle) && jumped.row?.visible === true,
    `row hidden before=${hiddenBefore?.visible === false}; ${JSON.stringify(jumped)}`,
  )
  const keyboardInSession = await app.client.evaluate(`document.activeElement?.closest('section${label('stage.terminal')}') !== null && document.activeElement?.closest('section${label('stage.terminal')}') !== undefined`)
  check(results, '[summary] the jump gives the session keyboard focus, as a rail row does', keyboardInSession === true, String(keyboardInSession))
  if (asking.focus) {
    const lowered = await pollFor({ read: state, settled: (s) => countsOf(s).needsYou === 1, timeoutMs: 8_000, label: 'A looked at' })
    check(results, '[summary] looking at the session lowers the needs-you count', countsOf(lowered).needsYou === 1, JSON.stringify(countsOf(lowered)))
  } else {
    console.log('  (the window has no focus: "looking at the session lowers the count" is carried by looked-at.test.ts — a recorded gap)')
  }

  // "hibernated" clicked once per hibernated session: the order of their rows on the rail.
  await app.client.send('Emulation.clearDeviceMetricsOverride')
  await new Promise((resolve) => setTimeout(resolve, 400))
  const railOrder = (await app.client.evaluate(RAIL_ROW_LABELS)).filter((text) => /^H-/.test(text)).map((text) => text.slice(0, 4))
  const visited = []
  for (let i = 0; i < 5; i += 1) {
    await clickBucket(app, 'hibernated')
    const tab = await pollFor({
      read: () => app.client.evaluate(SELECTED_TAB_TEXT),
      settled: (v) => /H-/.test(v ?? '') && v.slice(v.indexOf('H-'), v.indexOf('H-') + 4) !== visited.at(-1),
      timeoutMs: 4_000,
      label: `hibernated #${i + 1}`,
    })
    visited.push(tab?.slice(tab.indexOf('H-'), tab.indexOf('H-') + 4) ?? null)
  }
  check(
    results,
    "[summary] repeated activations follow the rail's row order (pinned folder, its child under its parent, then the rest) and wrap",
    JSON.stringify(railOrder) === JSON.stringify(['H-P1', 'H-P2', 'H-P3', 'H-U1']) &&
      JSON.stringify(visited) === JSON.stringify([...railOrder, railOrder[0]]),
    `rail ${JSON.stringify(railOrder)}; visited ${JSON.stringify(visited)}`,
  )

  // "error" and "ended" reach their sessions.
  await clickBucket(app, 'error')
  const errorTab = await pollFor({ read: () => app.client.evaluate(SELECTED_TAB_TEXT), settled: (v) => /shell/.test(v ?? ''), timeoutMs: 4_000, label: 'the errored shell' })
  const errorTitle = await app.client.evaluate(`document.querySelector('[role="tablist"]${label('sessions.tabs')} [role="tab"][aria-selected="true"]')?.getAttribute('title') ?? ''`)
  await clickBucket(app, 'ended')
  await new Promise((resolve) => setTimeout(resolve, 400))
  const endedTitle = await app.client.evaluate(`document.querySelector('[role="tablist"]${label('sessions.tabs')} [role="tab"][aria-selected="true"]')?.getAttribute('title') ?? ''`)
  check(
    results,
    '[summary] ended sessions are counted and reachable: "error" and "ended" each focus their session',
    errorTitle.includes(copy('sessions.statusExitedWithCode', { code: 3 })) && endedTitle.includes(copy('sessions.statusExited')) && !endedTitle.includes('3'),
    `error → ${errorTab} (${errorTitle}); ended → ${endedTitle}`,
  )

  // A collapsed folder: the jump scrolls the folder's row into view and leaves it collapsed. The focused session is
  // P's ended shell, so the next hibernated one is U's H-U1; U is collapsed and scrolled out of view under W's rows.
  await app.client.evaluate(`document.querySelector('${label('rail.collapseSessions', { name: names.u })}')?.click()`)
  await pollFor({ read: () => app.client.evaluate(ITEM_ROW(names.u)), settled: (v) => v?.rows === 0, timeoutMs: 4_000, label: 'U collapsed' })
  await app.client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 330, deviceScaleFactor: 0, mobile: false })
  await new Promise((resolve) => setTimeout(resolve, 600))
  await app.client.evaluate(SCROLL_RAIL_BOTTOM)
  await new Promise((resolve) => setTimeout(resolve, 300))
  const uBefore = await app.client.evaluate(ITEM_ROW(names.u))
  await clickBucket(app, 'hibernated')
  const uAfter = await pollFor({ read: () => app.client.evaluate(ITEM_ROW(names.u)), settled: (v) => v?.visible === true, timeoutMs: 4_000, label: "U's row in view" })
  const collapsedTab = await app.client.evaluate(SELECTED_TAB_TEXT)
  check(
    results,
    "[summary] a jump into a collapsed folder shows the folder's row and leaves it collapsed",
    uBefore?.visible === false && uAfter?.visible === true && uAfter.rows === 0 && /H-U1/.test(collapsedTab ?? ''),
    `before ${JSON.stringify(uBefore)} → ${JSON.stringify(uAfter)}; focused ${collapsedTab}`,
  )
  await app.client.send('Emulation.clearDeviceMetricsOverride')

  // A narrow header, at 100% and at 175%: one line, the name keeps some width, every control stays inside.
  await app.client.evaluate(selectRepoExpression(names.w))
  const layouts = []
  for (const [zoom, width] of [[100, 820], [175, 1280]]) {
    await app.client.evaluate(`window.workspace.settings.setZoom(${zoom})`)
    await app.client.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 0, mobile: false })
    await new Promise((resolve) => setTimeout(resolve, 800))
    layouts.push({ zoom, ...(await app.client.evaluate(HEADER_LAYOUT)) })
  }
  await app.client.evaluate('window.workspace.settings.setZoom(null)')
  await app.client.send('Emulation.clearDeviceMetricsOverride')
  check(
    results,
    '[summary] a narrow header stays one line, keeps the name and keeps every control inside',
    // At least the name's first few characters: 60 px is about six at this size (its minimum is 8ch).
    layouts.every((l) => l.oneLine && l.inside && l.nameWidth >= 60),
    JSON.stringify(layouts),
  )
}

// ── quick-replies ──────────────────────────────────────────────────────────

const QR_DEFAULTS = ['close', 'risk', 'remaining'].map((key) => copy(`quickReplies.default.${key}`))
const QR_DEFAULTS_ZH = ['close', 'risk', 'remaining'].map((key) => copyIn('zh-TW', `quickReplies.default.${key}`))

/** The quick reply row of the shown agent session, by its toolbar name in `language`. */
const qrToolbar = (language = 'en') =>
  `section${labelIn(language, 'stage.terminal')} [role="toolbar"]${labelIn(language, 'quickReplies.toolbar')}`

/**
 * The row as the user sees it: its sentences (the buttons named by a sentence), every button, the line that takes the
 * buttons' place, and its box. `null` when there is no row.
 */
function qrState(language = 'en') {
  return `(() => {
    const bar = document.querySelector(${JSON.stringify(qrToolbar(language))})
    if (!bar) return null
    const r = bar.getBoundingClientRect()
    const buttons = [...bar.querySelectorAll('button')].map((b) => ({
      label: b.getAttribute('aria-label'), text: b.textContent, disabled: b.disabled, title: b.getAttribute('title'),
    }))
    return {
      top: Math.round(r.top),
      height: Math.round(r.height),
      shown: r.width > 0 && r.height > 0,
      sentences: buttons.filter((b) => b.label !== null && b.label !== ${JSON.stringify(copyIn(language, 'quickReplies.edit'))}).map((b) => b.label),
      buttons,
      status: bar.querySelector('[role="status"]')?.textContent ?? null,
    }
  })()`
}

/**
 * The shown terminal's box, measured as `FitAddon.proposeDimensions()` measures it: the host's computed content size,
 * the `.xterm` element's padding, and the rendered screen (whose size is the cell size times the terminal's own
 * columns and rows). Hidden hosts have no box.
 */
const QR_TERMINAL_BOX = `(() => {
  const stage = document.querySelector('section[aria-label="${copy('stage.terminal')}"]')
  const host = [...(stage?.querySelectorAll('.xterm') ?? [])].map((x) => x.parentElement)
    .find((h) => h && !h.classList.contains('hidden') && h.clientHeight > 0)
  if (!host) return null
  const xterm = host.querySelector('.xterm')
  const screen = host.querySelector('.xterm-screen')
  if (!screen) return null
  const px = (v) => parseInt(v, 10) || 0
  const hs = getComputedStyle(host)
  const xs = getComputedStyle(xterm)
  const s = screen.getBoundingClientRect()
  const h = host.getBoundingClientRect()
  return {
    hostW: px(hs.width), hostH: px(hs.height), hostBottom: Math.round(h.bottom),
    padH: px(xs.paddingLeft) + px(xs.paddingRight), padV: px(xs.paddingTop) + px(xs.paddingBottom),
    screenW: s.width, screenH: s.height,
    center: { x: Math.round(s.x + s.width / 2), y: Math.round(s.y + s.height / 2) },
  }
})()`

/** The scrollbar width `proposeDimensions()` subtracts (the app keeps xterm's default scrollbar and a scrollback). */
const QR_SCROLLBAR = 14

/**
 * The pty's size (the stub's own `stty size`, every change logged) against the terminal's fitted size (what fit would
 * propose for the box the terminal has now). The cell size comes from the screen: its width is the cell width times
 * the terminal's columns, which equal the pty's while the two agree. **A covered terminal's screen does not give it**
 * (measured: under the conversation view the screen is wider than its columns' cells), so a covered measurement
 * passes the cell measured while the terminal was shown.
 */
async function qrSize(app, stub, conversation, knownCell = null) {
  const box = await app.client.evaluate(QR_TERMINAL_BOX)
  const sizes = stub.sessionSizes(conversation)
  const pty = sizes.at(-1) ?? null
  const cell = knownCell ?? (box && pty && pty.cols > 0 && pty.rows > 0 ? { w: box.screenW / pty.cols, h: box.screenH / pty.rows } : null)
  const fitted =
    box && cell
      ? {
          cols: Math.floor((box.hostW - box.padH - QR_SCROLLBAR) / cell.w),
          rows: Math.floor((box.hostH - box.padV) / cell.h),
        }
      : null
  return {
    pty,
    fitted,
    cell,
    logged: sizes.length,
    hostH: box?.hostH ?? null,
    hostBottom: box?.hostBottom ?? null,
    center: box?.center ?? null,
    equal: Boolean(pty && fitted && pty.cols === fitted.cols && pty.rows === fitted.rows),
  }
}

const qrSizeText = (size) =>
  `pty=${size.pty ? `${size.pty.cols}x${size.pty.rows}` : null} fitted=${size.fitted ? `${size.fitted.cols}x${size.fitted.rows}` : null} logged=${size.logged} hostH=${size.hostH}`

/** Focus sits in the shown terminal's input (xterm's helper textarea). */
const QR_TERMINAL_FOCUSED = `(() => {
  const el = document.activeElement
  const host = el?.closest?.('.xterm')?.parentElement
  return Boolean(el && el.classList.contains('xterm-helper-textarea') && host && !host.classList.contains('hidden'))
})()`

/** The center of a visible button whose text is `text`, inside `scope`; `null` when there is none. */
function qrButtonAt(scope, text) {
  return `(() => {
    // Hidden sessions' views are mounted too: only a button with a box counts.
    const button = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})]
      .find((b) => b.textContent.trim() === ${JSON.stringify(text)} && b.getClientRects().length > 0)
    if (!button) return null
    button.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const r = button.getBoundingClientRect()
    return r.width > 0 && r.height > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
  })()`
}

/** A real click on the button of `scope` whose text is `text`. Throws when it never shows. */
async function qrClickText(app, scope, text) {
  const at = await pollFor({
    read: () => app.client.evaluate(qrButtonAt(scope, text)),
    settled: (value) => value !== null,
    timeoutMs: 8_000,
    label: `the button ${JSON.stringify(text)}`,
  })
  if (!at) throw new Error(`no button ${JSON.stringify(text)} in ${scope}`)
  await clickAt(app, at)
}

/** A real click on the quick reply named `sentence`. */
const qrClick = (app, sentence, language = 'en') =>
  clickSelector(app.client, `${qrToolbar(language)} button[aria-label=${JSON.stringify(sentence)}]`, `the quick reply ${JSON.stringify(sentence)}`)

let qrEventNs = 0n
/**
 * An agent event written into the session's events directory, as the injected hook writes one (`probe-remote.mjs`'s
 * `fireEvent`): the probe chooses the payload (a notice's `prompt`) and the moment, which the stub's own events cannot.
 */
function qrFireEvent(profile, sessionId, body) {
  const dir = join(profile, 'agent-events', sessionId)
  mkdirSync(dir, { recursive: true })
  const wall = BigInt(Date.now()) * 1_000_000n
  qrEventNs = wall > qrEventNs ? wall : qrEventNs + 1n
  const file = join(dir, `${qrEventNs}-probe.json`)
  writeFileSync(`${file}.tmp`, JSON.stringify(body))
  renameSync(`${file}.tmp`, file)
}

/** The submit key as the stub reads it: the tty's line discipline turns the written CR into LF (`icrnl`). */
const QR_SUBMIT = /^[\r\n]$/

/**
 * Writes agent events and waits until the main process has read them (the events directory is empty again).
 *
 * **Not a tidy-up — a precondition.** A reply's first check of the agent's state happens before its queued refresh
 * (`deliverReply`), so a click within one drain tick (400 ms) of an event reads the state from before it (found while
 * writing this section: a Stop written right before the click was refused as "waiting for a choice").
 */
async function qrFire(profile, sessionId, ...bodies) {
  for (const body of bodies) qrFireEvent(profile, sessionId, body)
  const dir = join(profile, 'agent-events', sessionId)
  return pollFor({
    read: () => {
      try {
        return readdirSync(dir).filter((name) => name.endsWith('-probe.json')).length
      } catch {
        return 0
      }
    },
    settled: (left) => left === 0,
    timeoutMs: 5_000,
    label: 'the main process read the events',
  })
}

const QR_NOTICE = { hook_event_name: 'UserPromptSubmit', prompt: '<task-notification><task-id>qr-probe</task-id><status>completed</status></task-notification>' }

/** The renderer's id of the session whose agent got `conversation` (the events directory is keyed by it). */
function qrSessionId(profile, conversation) {
  return pollFor({
    read: () => {
      try {
        return JSON.parse(readFileSync(join(profile, 'sessions.json'), 'utf8')).sessions.find((s) => s.claudeSessionId === conversation)?.id ?? null
      } catch {
        return null
      }
    },
    settled: Boolean,
    timeoutMs: 15_000,
    label: 'the session id of the agent',
  })
}

/** Creates an agent session through the spawn menu and returns its conversation id. */
async function qrCreateAgent(app, stub, repoName) {
  const before = stub.peerNames().length
  await createAgentSession(app, repoName)
  const names = await pollFor({ read: () => stub.peerNames(), settled: (list) => list.length > before, timeoutMs: 25_000, label: 'the new agent starts' })
  return names.at(-1)?.conversation ?? null
}

/** A real click in the shown terminal's screen, then waits for focus to be in it. */
async function qrFocusTerminal(app) {
  const box = await pollFor({ read: () => app.client.evaluate(QR_TERMINAL_BOX), settled: (b) => b !== null, timeoutMs: 10_000, label: 'the shown terminal' })
  if (box) await clickAt(app, box.center)
  return pollFor({ read: () => app.client.evaluate(QR_TERMINAL_FOCUSED), settled: (v) => v === true, timeoutMs: 5_000, label: 'focus in the terminal' })
}

const QR_TAB_TITLE = `document.querySelector('[role="tablist"][aria-label="${copy('sessions.tabs')}"] [role="tab"][aria-selected="true"]')?.getAttribute('title') ?? ''`

/**
 * Waits until the shown session's tab says the agent works: the stub's `UserPromptSubmit` for the last line was read.
 * The stub reports it after logging the line, so a turn end written by the probe right after seeing the line could
 * sort before it and leave the agent "working".
 */
const qrAwaitWorking = (app) =>
  pollFor({ read: () => app.client.evaluate(QR_TAB_TITLE), settled: (title) => title.includes(WORKING), timeoutMs: 10_000, label: 'the agent works on the line' })

/**
 * Waits until the stub has written its report for every line it received. The stub reports a line after logging it,
 * so an event the probe writes right after seeing the line could sort before the stub's `UserPromptSubmit` and leave
 * the agent working.
 */
const qrAwaitReported = (stub, conversation) =>
  pollFor({
    read: () => ({ reported: stub.reported(conversation), lines: qrInput(stub, conversation).lines.length }),
    settled: (n) => n.reported === n.lines,
    timeoutMs: 8_000,
    label: 'the stub reported every line',
  })

/** Dismisses whatever line took the buttons' place. */
const qrDismiss = (app) => qrClickText(app, qrToolbar(), copy('quickReplies.dismiss'))

/**
 * After a step whose expected refusal did not come (a control group): end the agent's turn and bring the buttons back,
 * so the steps after it run on the state they expect instead of throwing.
 */
async function qrRecover(app, stop) {
  await stop()
  const row = await app.client.evaluate(qrState())
  if (row?.status != null) await qrDismiss(app)
  await qrAwaitButtons(app)
}

/** Clicks a quick reply and waits until the agent receives it as its last line, or a line takes the buttons' place. */
async function qrClickAndSee(app, stub, conversation, sentence) {
  await qrClick(app, sentence)
  return pollFor({
    read: async () => ({ line: qrInput(stub, conversation).lines.at(-1) ?? null, status: (await app.client.evaluate(qrState()))?.status ?? null }),
    settled: (seen) => seen.line === sentence || seen.status !== null,
    timeoutMs: 8_000,
    label: 'the quick reply is sent or refused',
  })
}

/** What the stub's session received: its lines and its bytes. */
const qrInput = (stub, conversation) => stub.sessionInputs()[conversation] ?? { lines: [], bytes: '' }

/**
 * Waits until the row's buttons are enabled (the window knows the agent can take a reply) and no line has taken
 * their place.
 */
const qrAwaitButtons = (app, language = 'en') =>
  pollFor({
    read: () => app.client.evaluate(qrState(language)),
    settled: (state) => state !== null && state.status === null && state.sentences.length > 0 && state.buttons.every((b) => !b.disabled),
    timeoutMs: 15_000,
    label: 'the quick reply buttons are enabled',
  })

/**
 * "Send anyway" on a typing refusal, then the agent's turn for it ends: the next step starts with the box submitted.
 * Returns the stub's last line.
 */
async function qrSendAnyway(app, stub, conversation, profile, sessionId, expectedLine) {
  await qrClickText(app, qrToolbar(), copy('quickReplies.sendAnyway'))
  const lines = await pollFor({
    read: () => qrInput(stub, conversation).lines,
    settled: (list) => list.at(-1) === expectedLine,
    timeoutMs: 10_000,
    label: 'send anyway reaches the agent',
  })
  await qrAwaitReported(stub, conversation)
  await qrFire(profile, sessionId, { hook_event_name: 'Stop' })
  await qrAwaitButtons(app)
  return lines.at(-1) ?? null
}

/**
 * **A quick reply sends at once, and is refused while the user's typing may be in the agent's box** (`quick-replies`).
 *
 * The stub ends no turn by itself (`manualTurns`): the probe orders "a prompt submitted", "typed while busy" and the
 * turn's end. The pty size is the stub's own `stty size` (logged on every change), compared with the size fit would
 * propose for the terminal's box: a line added under the row would shrink the box and resize the pty.
 *
 * Control groups (tasks.md 5.1), each run by hand on this section and recorded in the coverage table:
 * - the turn-end baseline (the gate refuses when anything was typed since the last turn end or a turn is in progress):
 *   7 red — both sends while the agent works, and every typing refusal that follows a turn end;
 * - no TYPED gate: 8 red — every typing refusal, its "writes nothing" and send anyway;
 * - the refusal as an extra line under the row (inside the toolbar, so it fails on behavior, not on a selector): 2 red —
 *   "in place of the buttons" and "does not resize the terminal" (the pty went from 34 to 32 rows);
 * - the notice not excluded from the confirmed submissions (`drainEvents`): 1 red — "a notice does not confirm an
 *   unreported Enter".
 */
async function runQuickReplies(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repoQR-')
  const configDir = mkTemp('spekterm-agentview-configQR-')
  const stub = makeStubAgent(mkTemp, configDir, { manualTurns: true, silentAnswers: true, sizeLog: true })
  const profile = seedProfile(repo)
  const app = await launch({ profile, configDir, stub, port: PORT })
  context.app = app
  const repoName = repo.split('/').pop()

  const conversation = await qrCreateAgent(app, stub, repoName)
  const sessionId = await qrSessionId(profile, conversation)
  check(results, '[quick-replies] precondition: an agent session with a known id', Boolean(conversation && sessionId), JSON.stringify({ conversation, sessionId }))
  const stop = async () => {
    await qrAwaitReported(stub, conversation)
    await qrFire(profile, sessionId, { hook_event_name: 'Stop' })
  }

  // ── The row under the terminal ──
  const row = await qrAwaitButtons(app)
  const firstFit = await pollFor({ read: () => qrSize(app, stub, conversation), settled: (s) => s.equal, timeoutMs: 15_000, label: 'the pty takes the fitted size' })
  check(
    results,
    '[quick-replies] three quick replies named by the default sentences show under the terminal',
    JSON.stringify(row?.sentences) === JSON.stringify(QR_DEFAULTS) && row.top >= (firstFit.hostBottom ?? Infinity) - 1,
    `sentences=${JSON.stringify(row?.sentences)} rowTop=${row?.top} terminalBottom=${firstFit.hostBottom}`,
  )
  check(results, '[quick-replies] precondition: the pty has the terminal\'s fitted size', firstFit.equal, qrSizeText(firstFit))

  // ── Ready, terminal view: the sentence, then a separate submit key; focus and size unchanged ──
  await qrFocusTerminal(app)
  const beforeA = await qrSize(app, stub, conversation)
  const blocksA = stub.sessionBlocks(conversation).length
  await qrClick(app, QR_DEFAULTS[0])
  const sentA = await pollFor({
    read: () => stub.sessionBlocks(conversation).slice(blocksA),
    settled: (list) => list.some((b) => QR_SUBMIT.test(b.text)),
    timeoutMs: 10_000,
    label: 'the quick reply reaches the agent',
  })
  const gapA = sentA.length >= 2 ? Math.round(sentA[1].atMs - sentA[0].atMs) : null
  check(
    results,
    '[quick-replies] a click in the terminal view writes the sentence, then the submit key as a separate later write',
    sentA.length === 2 && sentA[0].text === QR_DEFAULTS[0] && QR_SUBMIT.test(sentA[1].text) && gapA >= 300,
    `blocks=${JSON.stringify(sentA.map((b) => b.text))} gap=${gapA}ms`,
  )
  check(results, '[quick-replies] the agent receives the sentence as one prompt', qrInput(stub, conversation).lines.at(-1) === QR_DEFAULTS[0], `last line=${JSON.stringify(qrInput(stub, conversation).lines.at(-1))}`)
  const focusA = await app.client.evaluate(QR_TERMINAL_FOCUSED)
  check(results, '[quick-replies] the terminal keeps keyboard focus through the click', focusA === true, `activeElement=${await app.client.evaluate('document.activeElement?.className ?? null')}`)
  await new Promise((resolve) => setTimeout(resolve, 700))
  const afterA = await qrSize(app, stub, conversation)
  check(
    results,
    '[quick-replies] the pty keeps the terminal\'s fitted size through a click (terminal view)',
    beforeA.equal && afterA.equal && afterA.logged === beforeA.logged,
    `before ${qrSizeText(beforeA)} / after ${qrSizeText(afterA)}`,
  )
  await stop()
  await qrAwaitButtons(app)

  // ── The same from the conversation view, focus in the composer ──
  await app.client.evaluate(TOGGLE_VIEW)
  await pollFor({ read: () => app.client.evaluate(VIEW_STATE), settled: (state) => state.hasComposer, timeoutMs: 15_000, label: 'the conversation view' })
  const COMPOSER_FOCUSED = `Boolean(document.activeElement?.matches('${label('conversation.composer')}'))`
  // The view's layout settles after it mounts (the composer was measured at one place and found at another once):
  // measure and click again until focus is in it.
  await retryAction({
    act: async () => {
      const at = await app.client.evaluate(`(() => { const r = ${COMPOSER}?.getBoundingClientRect(); return r && r.height > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null })()`)
      if (at) await clickAt(app, at)
    },
    read: () => app.client.evaluate(COMPOSER_FOCUSED),
    settled: (v) => v === true,
    attemptWindowMs: 1_500,
    timeoutMs: 10_000,
    label: 'focus in the composer',
  })
  const rowB = await qrAwaitButtons(app)
  const beforeB = await qrSize(app, stub, conversation, beforeA.cell)
  const blocksB = stub.sessionBlocks(conversation).length
  await qrClick(app, QR_DEFAULTS[1])
  const sentB = await pollFor({
    read: () => stub.sessionBlocks(conversation).slice(blocksB),
    settled: (list) => list.some((b) => QR_SUBMIT.test(b.text)),
    timeoutMs: 10_000,
    label: 'the quick reply from the conversation view reaches the agent',
  })
  const gapB = sentB.length >= 2 ? Math.round(sentB[1].atMs - sentB[0].atMs) : null
  check(
    results,
    '[quick-replies] a click in the conversation view writes the sentence, then the submit key as a separate later write',
    rowB !== null && sentB.length === 2 && sentB[0].text === QR_DEFAULTS[1] && QR_SUBMIT.test(sentB[1].text) && gapB >= 300,
    `row=${rowB !== null} blocks=${JSON.stringify(sentB.map((b) => b.text))} gap=${gapB}ms`,
  )
  const focusB = await app.client.evaluate(COMPOSER_FOCUSED)
  check(results, '[quick-replies] the composer keeps keyboard focus through the click', focusB === true, `activeElement=${await app.client.evaluate('document.activeElement?.tagName ?? null')}`)
  await new Promise((resolve) => setTimeout(resolve, 700))
  const afterB = await qrSize(app, stub, conversation, beforeA.cell)
  check(
    results,
    '[quick-replies] the pty keeps the terminal\'s fitted size through a click (conversation view)',
    beforeB.equal && afterB.equal && afterB.logged === beforeB.logged,
    `before ${qrSizeText(beforeB)} / after ${qrSizeText(afterB)}`,
  )
  await stop()
  await qrAwaitButtons(app)
  await app.client.evaluate(TOGGLE_VIEW)
  await pollFor({ read: () => app.client.evaluate(VIEW_STATE), settled: (state) => !state.hasComposer, timeoutMs: 15_000, label: 'back to the terminal view' })

  // ── A held permission request: buttons disabled, and the main process refuses a direct call ──
  stub.command(conversation, 'fire PermissionRequest')
  const choice = await pollFor({
    read: () => app.client.evaluate(qrState()),
    settled: (state) => state !== null && state.sentences.length > 0 && state.buttons.filter((b) => state.sentences.includes(b.label)).every((b) => b.disabled),
    timeoutMs: 15_000,
    label: 'the buttons are disabled while the agent asks for a choice',
  })
  const sentenceButtons = choice?.buttons.filter((b) => choice.sentences.includes(b.label)) ?? []
  check(
    results,
    '[quick-replies] while the agent asks for a choice the buttons are disabled, with the reason',
    sentenceButtons.length === 3 && sentenceButtons.every((b) => b.disabled && b.title === copy('quickReplies.refused.choice')),
    JSON.stringify(sentenceButtons.map((b) => ({ disabled: b.disabled, title: b.title }))),
  )
  const bytesC = qrInput(stub, conversation).bytes
  const direct = await app.client.evaluate(`window.workspace.conversation.quickReply(${JSON.stringify(sessionId)}, ${JSON.stringify(QR_DEFAULTS[2])})`)
  await new Promise((resolve) => setTimeout(resolve, 900))
  check(
    results,
    '[quick-replies] a quick reply sent straight to the main process while the agent asks for a choice is refused and writes nothing',
    direct?.ok === false && direct.code === 'WAIT_STATE' && direct.state === 'awaiting-choice' && qrInput(stub, conversation).bytes === bytesC,
    `result=${JSON.stringify(direct)} wrote=${JSON.stringify(qrInput(stub, conversation).bytes.slice(bytesC.length))}`,
  )
  await stop()
  await qrAwaitButtons(app)
  // A request written but not yet drained by the window's tick: the main process reads it before deciding.
  const bytesC2 = qrInput(stub, conversation).bytes
  qrFireEvent(profile, sessionId, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm x' } })
  const undrained = await app.client.evaluate(`window.workspace.conversation.quickReply(${JSON.stringify(sessionId)}, ${JSON.stringify(QR_DEFAULTS[2])})`)
  await new Promise((resolve) => setTimeout(resolve, 900))
  check(
    results,
    '[quick-replies] a permission request reported just before the call is read before anything is written',
    undrained?.ok === false && undrained.code === 'WAIT_STATE' && qrInput(stub, conversation).bytes === bytesC2,
    `result=${JSON.stringify(undrained)} wrote=${JSON.stringify(qrInput(stub, conversation).bytes.slice(bytesC2.length))}`,
  )
  await stop()
  await qrAwaitButtons(app)

  // ── A letter typed after the last submit: refused in place of the buttons; send anyway sends ──
  await qrFocusTerminal(app)
  const rowD = await qrAwaitButtons(app)
  const beforeD = await qrSize(app, stub, conversation)
  await app.client.send('Input.insertText', { text: 'q' })
  await pollFor({ read: () => qrInput(stub, conversation).bytes, settled: (b) => b.endsWith('q'), timeoutMs: 5_000, label: 'the letter reaches the pty' })
  const bytesD = qrInput(stub, conversation).bytes
  await qrClick(app, QR_DEFAULTS[2])
  const refusedD = await pollFor({
    read: () => app.client.evaluate(qrState()),
    settled: (state) => state?.status === copy('quickReplies.refused.typed'),
    timeoutMs: 8_000,
    label: 'the typing refusal shows',
  })
  check(
    results,
    '[quick-replies] a letter typed after the last submit: the click is refused in place of the buttons, offering send anyway',
    refusedD?.status === copy('quickReplies.refused.typed') && refusedD.sentences.length === 0 &&
      refusedD.buttons.some((b) => b.text === copy('quickReplies.sendAnyway')) && refusedD.height === rowD?.height,
    `status=${JSON.stringify(refusedD?.status)} buttons=${JSON.stringify(refusedD?.buttons.map((b) => b.text))} height ${rowD?.height} → ${refusedD?.height}`,
  )
  await new Promise((resolve) => setTimeout(resolve, 900))
  const afterD = await qrSize(app, stub, conversation)
  check(results, '[quick-replies] the refused click writes nothing', qrInput(stub, conversation).bytes === bytesD, `wrote=${JSON.stringify(qrInput(stub, conversation).bytes.slice(bytesD.length))}`)
  check(
    results,
    '[quick-replies] the refusal does not resize the terminal',
    beforeD.equal && afterD.equal && afterD.logged === beforeD.logged && afterD.hostH === beforeD.hostH,
    `before ${qrSizeText(beforeD)} / after ${qrSizeText(afterD)}`,
  )
  const anywayD = refusedD?.status === copy('quickReplies.refused.typed')
    ? await qrSendAnyway(app, stub, conversation, profile, sessionId, `q${QR_DEFAULTS[2]}`)
    : null
  check(results, '[quick-replies] send anyway, with nothing typed since the warning, sends the sentence', anywayD === `q${QR_DEFAULTS[2]}`, `last line=${JSON.stringify(anywayD)}`)
  if (anywayD === null) await qrRecover(app, stop)

  // ── The user's own prompt, then busy: a click is sent; a second click while busy is sent too ──
  await qrFocusTerminal(app)
  await app.client.send('Input.insertText', { text: 'QR-OWN-PROMPT' })
  await pressKey(app.client, 'Enter')
  await pollFor({ read: () => qrInput(stub, conversation).lines, settled: (l) => l.at(-1) === 'QR-OWN-PROMPT', timeoutMs: 8_000, label: 'the typed prompt is submitted' })
  const working = await pollFor({
    read: () => app.client.evaluate(QR_TAB_TITLE),
    settled: (title) => title.includes(WORKING),
    timeoutMs: 10_000,
    label: 'the agent works on the typed prompt',
  })
  const firstBusy = await qrClickAndSee(app, stub, conversation, QR_DEFAULTS[0])
  if (firstBusy.status !== null) await qrDismiss(app)
  await qrAwaitButtons(app)
  const secondBusy = await qrClickAndSee(app, stub, conversation, QR_DEFAULTS[1])
  if (secondBusy.status !== null) await qrDismiss(app)
  check(
    results,
    '[quick-replies] while the agent works on a prompt the user typed and submitted, a quick reply is sent',
    working.includes(WORKING) && firstBusy.line === QR_DEFAULTS[0] && firstBusy.status === null,
    `tab=${JSON.stringify(working)} last line=${JSON.stringify(firstBusy.line)} status=${JSON.stringify(firstBusy.status)}`,
  )
  check(
    results,
    '[quick-replies] a second quick reply while the agent works on the first is sent too',
    secondBusy.line === QR_DEFAULTS[1] && secondBusy.status === null,
    `last line=${JSON.stringify(secondBusy.line)} status=${JSON.stringify(secondBusy.status)}`,
  )
  await stop()
  await qrAwaitButtons(app)

  // ── A letter typed while busy, then the turn ends: refused ──
  await app.client.send('Input.insertText', { text: 'QR-BUSY' })
  await pressKey(app.client, 'Enter')
  await pollFor({ read: () => qrInput(stub, conversation).lines, settled: (l) => l.at(-1) === 'QR-BUSY', timeoutMs: 8_000, label: 'a prompt makes the agent busy' })
  await qrAwaitWorking(app)
  await app.client.send('Input.insertText', { text: 'w' })
  await pollFor({ read: () => qrInput(stub, conversation).bytes, settled: (b) => b.endsWith('w'), timeoutMs: 5_000, label: 'the letter typed while busy reaches the pty' })
  await stop()
  await pollFor({
    read: () => app.client.evaluate(QR_TAB_TITLE),
    settled: (title) => !title.includes(WORKING) && (title.includes(WAITING) || title.includes(IDLE)),
    timeoutMs: 10_000,
    label: 'the turn has ended',
  })
  await qrClick(app, QR_DEFAULTS[2])
  const refusedF = await pollFor({ read: () => app.client.evaluate(qrState()), settled: (s) => s?.status !== null, timeoutMs: 8_000, label: 'a line takes the buttons\' place' })
  check(
    results,
    '[quick-replies] a letter typed while the agent worked, then the turn ended: the click is refused',
    refusedF?.status === copy('quickReplies.refused.typed'),
    `status=${JSON.stringify(refusedF?.status)} last line=${JSON.stringify(qrInput(stub, conversation).lines.at(-1))}`,
  )
  if (refusedF?.status === copy('quickReplies.refused.typed')) await qrSendAnyway(app, stub, conversation, profile, sessionId, `w${QR_DEFAULTS[2]}`)
  else await qrRecover(app, stop)

  // ── A letter typed, then a background task's notice: refused ──
  await app.client.send('Input.insertText', { text: 'e' })
  await pollFor({ read: () => qrInput(stub, conversation).bytes, settled: (b) => b.endsWith('e'), timeoutMs: 5_000, label: 'the letter reaches the pty' })
  await qrAwaitReported(stub, conversation)
  await qrFire(profile, sessionId, QR_NOTICE, { hook_event_name: 'Stop' })
  await qrClick(app, QR_DEFAULTS[0])
  const refusedG = await pollFor({ read: () => app.client.evaluate(qrState()), settled: (s) => s?.status !== null, timeoutMs: 8_000, label: 'a line takes the buttons\' place' })
  check(
    results,
    '[quick-replies] a letter typed, then a background task notice reported as a submission: the click is refused',
    refusedG?.status === copy('quickReplies.refused.typed'),
    `status=${JSON.stringify(refusedG?.status)}`,
  )
  if (refusedG?.status === copy('quickReplies.refused.typed')) await qrSendAnyway(app, stub, conversation, profile, sessionId, `e${QR_DEFAULTS[0]}`)
  else await qrRecover(app, stop)

  // The notice must not confirm an Enter either: a letter and an Enter the agent reported no submission for (as for a
  // typed `!cmd`), then a notice. Counting the notice as a submission would take that Enter as submitted.
  stub.command(conversation, stub.silentLine())
  await pollFor({ read: () => stub.held(conversation), settled: (v) => v === true, timeoutMs: 5_000, label: 'the stub will not report the next line' })
  await app.client.send('Input.insertText', { text: 'n' })
  await pressKey(app.client, 'Enter')
  await pollFor({ read: () => stub.held(conversation), settled: (v) => v === false, timeoutMs: 5_000, label: 'the unreported line arrived' })
  await qrAwaitReported(stub, conversation)
  await qrFire(profile, sessionId, QR_NOTICE, { hook_event_name: 'Stop' })
  await qrClick(app, QR_DEFAULTS[1])
  const refusedG2 = await pollFor({ read: () => app.client.evaluate(qrState()), settled: (s) => s?.status !== null, timeoutMs: 8_000, label: 'a line takes the buttons\' place' })
  check(
    results,
    '[quick-replies] a notice does not confirm an unreported Enter: the click is refused',
    refusedG2?.status === copy('quickReplies.refused.typed'),
    `status=${JSON.stringify(refusedG2?.status)}`,
  )
  if (refusedG2?.status === copy('quickReplies.refused.typed')) await qrSendAnyway(app, stub, conversation, profile, sessionId, QR_DEFAULTS[1])
  else await qrRecover(app, stop)

  // ── A permission request answered with a digit (no Enter), then the turn ends: refused, with send anyway ──
  stub.command(conversation, 'fire PermissionRequest')
  await pollFor({
    read: () => app.client.evaluate(qrState()),
    settled: (state) => state !== null && state.sentences.length > 0 && state.buttons.filter((b) => state.sentences.includes(b.label)).every((b) => b.disabled),
    timeoutMs: 15_000,
    label: 'the agent asks for a choice',
  })
  await app.client.send('Input.insertText', { text: '1' })
  await pollFor({ read: () => qrInput(stub, conversation).bytes, settled: (b) => b.endsWith('1'), timeoutMs: 5_000, label: 'the digit reaches the pty' })
  await stop()
  await qrAwaitButtons(app)
  await qrClick(app, QR_DEFAULTS[2])
  const refusedH = await pollFor({ read: () => app.client.evaluate(qrState()), settled: (s) => s?.status !== null, timeoutMs: 8_000, label: 'a line takes the buttons\' place' })
  check(
    results,
    '[quick-replies] a prompt answered with a key in the terminal, then the turn ended: the click is refused, offering send anyway',
    refusedH?.status === copy('quickReplies.refused.typed') && refusedH.buttons.some((b) => b.text === copy('quickReplies.sendAnyway')),
    `status=${JSON.stringify(refusedH?.status)} buttons=${JSON.stringify(refusedH?.buttons.map((b) => b.text))}`,
  )
  if (refusedH?.status === copy('quickReplies.refused.typed')) await qrSendAnyway(app, stub, conversation, profile, sessionId, `1${QR_DEFAULTS[2]}`)
  else await qrRecover(app, stop)

  // ── A letter typed, the request answered with Enter (no submission reported), then a notice: refused ──
  await app.client.send('Input.insertText', { text: 'r' })
  await pollFor({ read: () => qrInput(stub, conversation).bytes, settled: (b) => b.endsWith('r'), timeoutMs: 5_000, label: 'the letter reaches the pty' })
  stub.command(conversation, stub.heldPermission())
  await pollFor({
    read: () => app.client.evaluate(qrState()),
    settled: (state) => state !== null && state.sentences.length > 0 && state.buttons.filter((b) => state.sentences.includes(b.label)).every((b) => b.disabled),
    timeoutMs: 15_000,
    label: 'the agent asks for a choice (the window has drained it)',
  })
  await pressKey(app.client, 'Enter')
  const answered = await pollFor({ read: () => stub.held(conversation), settled: (v) => v === false, timeoutMs: 5_000, label: 'the Enter answered the request' })
  await qrAwaitReported(stub, conversation)
  await qrFire(profile, sessionId, QR_NOTICE, { hook_event_name: 'Stop' })
  await qrAwaitButtons(app)
  await qrClick(app, QR_DEFAULTS[0])
  const refusedI = await pollFor({ read: () => app.client.evaluate(qrState()), settled: (s) => s?.status !== null, timeoutMs: 8_000, label: 'a line takes the buttons\' place' })
  check(
    results,
    '[quick-replies] a letter typed, the prompt answered with Enter, then a notice: the click is refused',
    answered === false && refusedI?.status === copy('quickReplies.refused.typed'),
    `answered=${answered === false} status=${JSON.stringify(refusedI?.status)} last line=${JSON.stringify(qrInput(stub, conversation).lines.at(-1))}`,
  )
  if (refusedI?.status === copy('quickReplies.refused.typed')) await qrSendAnyway(app, stub, conversation, profile, sessionId, QR_DEFAULTS[0])
  else await qrRecover(app, stop)

  // ── A key typed within the half second after the text: the submit key is withheld, and the row says so ──
  await qrFocusTerminal(app)
  await qrAwaitButtons(app)
  const blocksJ = stub.sessionBlocks(conversation).length
  await qrClick(app, QR_DEFAULTS[1])
  const textArrived = await pollFor({
    read: () => stub.sessionBlocks(conversation).slice(blocksJ),
    settled: (list) => list.some((b) => b.text === QR_DEFAULTS[1]),
    timeoutMs: 8_000,
    interval: 10,
    label: 'the stub receives the text',
  })
  await app.client.send('Input.insertText', { text: 'z' })
  const typedAfterMs = Math.round(Date.now() - (textArrived.find((b) => b.text === QR_DEFAULTS[1])?.atMs ?? 0))
  const notSent = await pollFor({ read: () => app.client.evaluate(qrState()), settled: (s) => s?.status === copy('quickReplies.notSent'), timeoutMs: 8_000, label: 'the not-sent notice shows' })
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const afterText = stub.sessionBlocks(conversation).slice(blocksJ).map((b) => b.text)
  check(results, '[quick-replies] precondition: the key was typed within the half second after the text arrived', typedAfterMs < 400, `typed ${typedAfterMs}ms after the text arrived`)
  check(
    results,
    '[quick-replies] a key typed between the text and the submit key withholds the submit key',
    afterText.join('') === `${QR_DEFAULTS[1]}z` && !afterText.some((t) => /[\r\n]/.test(t)),
    `blocks=${JSON.stringify(afterText)}`,
  )
  check(results, '[quick-replies] the row says the sentence is in the input box, not sent', notSent?.status === copy('quickReplies.notSent'), `status=${JSON.stringify(notSent?.status)}`)
}

/**
 * **The row's place and the list in Settings** (`quick-replies`): a shell session shows no row; the defaults follow the
 * UI language while the list is not set and are kept as set once it is; the Edit button opens Settings at Agents &
 * sessions; the list survives a restart, empty included; the section's restore brings the defaults back and leaves the
 * terminal font; a dormant session shows the row disabled, so waking it does not resize its pty.
 */
async function runQuickReplySettings(_mode, _config, context) {
  if (context.app) await context.app.close()
  const repo = mkTemp('spekterm-agentview-repoQS-')
  const configDir = mkTemp('spekterm-agentview-configQS-')
  const stub = makeStubAgent(mkTemp, configDir, { sizeLog: true })
  const profile = seedProfile(repo)
  // A terminal font size the section's restore must leave alone.
  writeFileSync(join(profile, 'preferences.json'), JSON.stringify({ version: 1, terminal: { fontSize: 15 }, ui: { language: 'en', theme: 'dark' } }))
  const repoName = repo.split('/').pop()
  let port = PORT
  context.app = await launch({ profile, configDir, stub, port })
  const prefs = () => {
    try {
      return JSON.parse(readFileSync(join(profile, 'preferences.json'), 'utf8'))
    } catch {
      return null
    }
  }
  const sentencesOf = (language = 'en') => context.app.client.evaluate(qrState(language)).then((state) => state?.sentences ?? null)
  const awaitSentences = (expected, what, language = 'en') =>
    pollFor({ read: () => sentencesOf(language), settled: (list) => JSON.stringify(list) === JSON.stringify(expected), timeoutMs: 10_000, label: what })
  const restart = async () => {
    await context.app.close()
    port = port === PORT ? RESTORE_PORT : PORT
    context.app = await launch({ profile, configDir, stub, port })
    await pollFor({ read: () => context.app.client.evaluate(selectRepoExpression(repoName)), settled: (ok) => ok === true, timeoutMs: 15_000, label: 'select the repo after the restart' })
    // The first tab is the first agent session (created first).
    await pollFor({ read: () => context.app.client.evaluate(focusTabExpression(0)), settled: (ok) => ok === true, timeoutMs: 15_000, label: 'show the first session' })
    return pollFor({ read: () => context.app.client.evaluate(VIEW_STATE), settled: (state) => state.hasToggle, timeoutMs: 20_000, label: 'an agent session is shown after the restart' })
  }
  const switchLanguage = async (from, to) => {
    const client = context.app.client
    await clickSelector(client, `nav${labelIn(from, 'activityBar.label')} button${labelIn(from, 'activityBar.settings')}`, 'the Settings entry')
    await clickSelector(client, '[role="dialog"] [role="tab"][id="settings-tab-general"]', 'the General section')
    await pollFor({
      read: () => client.evaluate(`document.querySelector('[role="dialog"] [role="tab"][id="settings-tab-general"]')?.getAttribute('aria-selected') === 'true'`),
      settled: Boolean,
      timeoutMs: 5_000,
      label: 'General is shown',
    })
    await client.evaluate(`(() => {
      const select = document.querySelector('[role="dialog"] select${labelIn(from, 'settings.language')}')
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
      setter.call(select, ${JSON.stringify(to)})
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await pollFor({ read: () => client.evaluate('document.documentElement.lang'), settled: (lang) => lang === to, timeoutMs: 8_000, label: `the UI language is ${to}` })
    await clickSelector(client, `[role="dialog"] button${labelIn(to, 'common.close')}`, 'the Settings close control')
    await pollFor({ read: () => client.evaluate(`document.querySelector('[role="dialog"]') === null`), settled: Boolean, timeoutMs: 5_000, label: 'Settings is closed' })
  }

  const conversation = await qrCreateAgent(context.app, stub, repoName)
  await awaitSentences(QR_DEFAULTS, 'the default quick replies show')

  // ── A shell session shows no row ──
  await createSessionOf(context.app, repoName, 'shell')
  const shellShown = await pollFor({
    read: () => context.app.client.evaluate(`({ tabs: document.querySelectorAll('[role="tablist"][aria-label="${copy('sessions.tabs')}"] [role="tab"]').length, toggle: ${VIEW_STATE}.hasToggle, row: ${qrState()} })`),
    settled: (state) => state.tabs === 2 && state.toggle === false,
    timeoutMs: 15_000,
    label: 'the shell session is shown',
  })
  await new Promise((resolve) => setTimeout(resolve, 800))
  const shellRow = await context.app.client.evaluate(qrState())
  check(
    results,
    '[quick-replies] a shell session shows no quick reply row',
    shellShown.tabs === 2 && shellShown.toggle === false && shellRow === null,
    `tabs=${shellShown.tabs} agent toggle=${shellShown.toggle} row=${JSON.stringify(shellRow)}`,
  )
  await context.app.client.evaluate(focusTabExpression(0))
  await awaitSentences(QR_DEFAULTS, 'back on the agent session')

  // ── The list unset: the defaults follow the UI language ──
  await switchLanguage('en', 'zh-TW')
  const zhDefaults = await awaitSentences(QR_DEFAULTS_ZH, 'the Chinese defaults', 'zh-TW')
  check(results, '[quick-replies] with the list unset, switching to Traditional Chinese shows the Chinese defaults', JSON.stringify(zhDefaults) === JSON.stringify(QR_DEFAULTS_ZH), JSON.stringify(zhDefaults))
  await switchLanguage('zh-TW', 'en')
  await awaitSentences(QR_DEFAULTS, 'the English defaults again')

  // ── The Edit button opens Settings at Agents & sessions (Settings was last on General) ──
  await clickSelector(context.app.client, `${qrToolbar()} button${label('quickReplies.edit')}`, 'the Edit button')
  const atAgents = await pollFor({
    read: () => context.app.client.evaluate(`document.querySelector('[role="dialog"] [role="tab"][id="settings-tab-agents"]')?.getAttribute('aria-selected') ?? null`),
    settled: (v) => v === 'true',
    timeoutMs: 5_000,
    label: 'Settings shows Agents & sessions',
  })
  const firstField = await context.app.client.evaluate(`document.querySelector(${JSON.stringify(inSettings(`input${label('settings.quickReplyField', { index: 1 })}`))})?.value ?? null`)
  check(
    results,
    '[quick-replies] the Edit button opens Settings at Agents & sessions, listing the quick replies',
    atAgents === 'true' && firstField === QR_DEFAULTS[0],
    `agents selected=${atAgents} first field=${JSON.stringify(firstField)}`,
  )

  // ── Add one, remove one → the row's order ──
  const ADDED = 'Go ahead if there is no risk'
  await qrClickText(context.app, '[role="dialog"]', copy('settings.quickReplyAdd'))
  await pollFor({ read: () => context.app.client.evaluate(`Boolean(document.querySelector(${JSON.stringify(inSettings(`input${label('settings.quickReplyNew')}`))}))`), settled: Boolean, timeoutMs: 5_000, label: 'the new row' })
  await setField(context.app.client, 'settings.quickReplyNew', ADDED)
  const added = await awaitSentences([...QR_DEFAULTS, ADDED], 'the added sentence on the row')
  await clickSelector(context.app.client, inSettings(`button${label('settings.quickReplyRemove', { sentence: QR_DEFAULTS[1] })}`), 'remove the second default')
  const edited = [QR_DEFAULTS[0], QR_DEFAULTS[2], ADDED]
  const afterRemove = await awaitSentences(edited, 'the removed sentence leaves the row')
  await closeSettings(context.app.client)
  check(
    results,
    '[quick-replies] adding a sentence and removing one changes the row, in the order of the list',
    JSON.stringify(added) === JSON.stringify([...QR_DEFAULTS, ADDED]) && JSON.stringify(afterRemove) === JSON.stringify(edited) &&
      JSON.stringify(prefs()?.terminal?.quickReplies) === JSON.stringify(edited),
    `after add=${JSON.stringify(added)} after remove=${JSON.stringify(afterRemove)} stored=${JSON.stringify(prefs()?.terminal?.quickReplies)}`,
  )

  // ── The list set: a language switch leaves it ──
  await switchLanguage('en', 'zh-TW')
  await new Promise((resolve) => setTimeout(resolve, 600))
  const zhEdited = await sentencesOf('zh-TW')
  await switchLanguage('zh-TW', 'en')
  check(results, '[quick-replies] with the list set, switching the UI language leaves the row as set', JSON.stringify(zhEdited) === JSON.stringify(edited), JSON.stringify(zhEdited))

  // ── Kept after a restart ──
  await restart()
  const kept = await awaitSentences(edited, 'the edited list after a restart')
  check(results, '[quick-replies] the edited list is kept after a restart', JSON.stringify(kept) === JSON.stringify(edited), JSON.stringify(kept))

  // ── Restore the section's defaults: two defaults removed, one added → the three defaults; the font stays ──
  await openSettings(context.app.client, 'agents')
  await clickSelector(context.app.client, inSettings(`button${label('settings.quickReplyRemove', { sentence: QR_DEFAULTS[2] })}`), 'remove another default')
  await awaitSentences([QR_DEFAULTS[0], ADDED], 'two defaults removed, one added')
  await qrClickText(context.app, '[role="dialog"]', copy('settings.restoreDefaults'))
  await qrClickText(context.app, '[role="dialog"]', copy('settings.restore'))
  const restored = await awaitSentences(QR_DEFAULTS, 'the defaults after the restore')
  await closeSettings(context.app.client)
  const storedAfterRestore = prefs()?.terminal ?? null
  check(
    results,
    '[quick-replies] restoring Agents & sessions brings back the three defaults and leaves the terminal font',
    JSON.stringify(restored) === JSON.stringify(QR_DEFAULTS) && storedAfterRestore !== null && !('quickReplies' in storedAfterRestore) && storedAfterRestore.fontSize === 15,
    `row=${JSON.stringify(restored)} stored terminal=${JSON.stringify(storedAfterRestore)}`,
  )

  // ── A dormant agent session: the row shows, disabled, so waking it does not resize its pty ──
  await qrFocusTerminal(context.app)
  const running = await pollFor({ read: () => qrSize(context.app, stub, conversation), settled: (s) => s.equal, timeoutMs: 15_000, label: 'the pty has the fitted size' })
  for (const type of ['rawKeyDown', 'keyUp']) {
    await context.app.client.send('Input.dispatchKeyEvent', { type, key: 'H', code: 'KeyH', windowsVirtualKeyCode: 72, nativeVirtualKeyCode: 72, modifiers: 2 | 8 })
  }
  await pollFor({ read: () => context.app.client.evaluate(WAKE_IN_STAGE), settled: (v) => v === true, timeoutMs: 10_000, label: 'the agent session is dormant' })
  await pollFor({ read: () => agentAlive(conversation), settled: (alive) => alive === false, timeoutMs: 10_000, label: 'the agent process ended' })
  const dormantRow = await context.app.client.evaluate(qrState())
  const dormantBox = await context.app.client.evaluate(QR_TERMINAL_BOX)
  const dormantButtons = dormantRow?.buttons.filter((b) => dormantRow.sentences.includes(b.label)) ?? []
  check(
    results,
    '[quick-replies] a dormant agent session shows the row with its buttons disabled',
    dormantButtons.length === 3 && dormantButtons.every((b) => b.disabled && b.title === copy('quickReplies.dormant')),
    JSON.stringify(dormantButtons.map((b) => ({ disabled: b.disabled, title: b.title }))),
  )
  check(results, '[quick-replies] the dormant session\'s terminal keeps the box it had while running', dormantBox?.hostH === running.hostH, `running hostH=${running.hostH} dormant hostH=${dormantBox?.hostH}`)
  const loggedBeforeWake = stub.sessionSizes(conversation).length
  await qrClickText(context.app, `section[aria-label="${copy('stage.terminal')}"]`, copy('sessions.wake'))
  await pollFor({ read: () => agentAlive(conversation), settled: (alive) => alive === true, timeoutMs: 15_000, label: 'the agent process runs again' })
  const woken = await pollFor({
    read: () => qrSize(context.app, stub, conversation),
    settled: (s) => s.equal && s.logged > loggedBeforeWake,
    timeoutMs: 15_000,
    label: 'the woken pty reports its size',
  })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const wokenSizes = stub.sessionSizes(conversation).slice(loggedBeforeWake)
  // The pty is spawned at 80 columns before the first resize reaches it; every size after that is the fitted one.
  const fittedSizes = wokenSizes.filter((s) => !(s.cols === 80 && s.rows === 24))
  check(
    results,
    '[quick-replies] waking a dormant agent session leaves its pty at its first fitted size',
    fittedSizes.length >= 1 && fittedSizes.every((s) => s.cols === running.pty?.cols && s.rows === running.pty?.rows) && woken.equal,
    `before ${qrSizeText(running)} / woken sizes=${JSON.stringify(wokenSizes)} / now ${qrSizeText(woken)}`,
  )

  // ── Remove every sentence: no row on any session, kept empty after a restart ──
  await openSettings(context.app.client, 'agents')
  for (const sentence of QR_DEFAULTS) {
    await clickSelector(context.app.client, inSettings(`button${label('settings.quickReplyRemove', { sentence })}`), `remove ${sentence}`)
    await pollFor({ read: () => sentencesOf(), settled: (list) => list === null || !list.includes(sentence), timeoutMs: 5_000, label: `${sentence} removed` })
  }
  await closeSettings(context.app.client)
  const second = await qrCreateAgent(context.app, stub, repoName)
  const noRow = []
  for (const index of [0, 2]) {
    await context.app.client.evaluate(focusTabExpression(index))
    const shown = await pollFor({ read: () => context.app.client.evaluate(VIEW_STATE), settled: (state) => state.hasToggle, timeoutMs: 10_000, label: 'an agent session is shown' })
    await new Promise((resolve) => setTimeout(resolve, 500))
    noRow.push({ index, agent: shown.hasToggle, row: await context.app.client.evaluate(qrState()) })
  }
  check(
    results,
    '[quick-replies] with every sentence removed, no agent session shows a row',
    Boolean(second) && noRow.every((entry) => entry.agent && entry.row === null) && JSON.stringify(prefs()?.terminal?.quickReplies) === '[]',
    `second agent=${Boolean(second)} ${JSON.stringify(noRow)} stored=${JSON.stringify(prefs()?.terminal?.quickReplies)}`,
  )
  const afterRestart = await restart()
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const emptyRow = await context.app.client.evaluate(qrState())
  check(
    results,
    '[quick-replies] the emptied list stays empty after a restart',
    afterRestart.hasToggle && emptyRow === null && JSON.stringify(prefs()?.terminal?.quickReplies) === '[]',
    `agent shown=${afterRestart.hasToggle} row=${JSON.stringify(emptyRow)} stored=${JSON.stringify(prefs()?.terminal?.quickReplies)}`,
  )
}


const SECTIONS = [
  { name: 'runViewAndSend', run: runViewAndSend },
  { name: 'runRebuiltWidth', run: runRebuiltWidth, requires: ['runViewAndSend'] },
  { name: 'runReadableWithoutEvents', run: runReadableWithoutEvents },
  { name: 'runParallelSessions', run: runParallelSessions },
  { name: 'runDormantConversation', run: runDormantConversation, requires: ['runParallelSessions'] },
  { name: 'runUnconfirmed', run: runUnconfirmed },
  { name: 'runAwaitingChoice', run: runAwaitingChoice },
  { name: 'runIncompleteContent', run: runIncompleteContent },
  { name: 'runCoveredReleasesQuota', run: runCoveredReleasesQuota },
  { name: 'runMaximizeCover', run: runMaximizeCover },
  { name: 'runRelocateByEvent', run: runRelocateByEvent },
  { name: 'runBusyIndicator', run: runBusyIndicator },
  { name: 'runTextOnlyBusy', run: runTextOnlyBusy },
  { name: 'runMidTurnDelivery', run: runMidTurnDelivery },
  { name: 'runOriginLabels', run: runOriginLabels },
  { name: 'runResultImageCount', run: runResultImageCount },
  { name: 'runSubagentPrompt', run: runSubagentPrompt },
  { name: 'runPasteRecorded', run: runPasteRecorded },
  { name: 'runSlashCommandLine', run: runSlashCommandLine },
  { name: 'runAutoHibernateAgent', run: runAutoHibernateAgent },
  { name: 'runCloseConfirmAgent', run: runCloseConfirmAgent },
  { name: 'runAttention', run: runAttention },
  { name: 'runAttentionUnreported', run: runAttentionUnreported },
  { name: 'runSummary', run: runSummary },
  { name: 'runQuickReplies', run: runQuickReplies },
  { name: 'runQuickReplySettings', run: runQuickReplySettings },
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

process.exit(outcome.ok ? 0 : 1)
