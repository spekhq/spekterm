import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, Menu, session } from 'electron'
import { applyContentSecurityPolicy } from './content-security-policy'
import { DirtyStateStore } from './dirty-state'
import { registerAppHandlers } from './ipc/app'
import { registerClipboardHandlers } from './ipc/clipboard'
import { registerConversationHandlers } from './ipc/conversation'
import { registerFsHandlers } from './ipc/fs'
import { registerFolderHandlers } from './ipc/folders'
import { registerIntakeHandlers } from './ipc/intake'
import { registerInsightsHandlers, spawnReportDelegate, spawnScanWorker } from './ipc/insights'
import { registerOpenSpecHandlers } from './ipc/openspec'
import { registerPanelHandlers } from './ipc/panel'
import { registerSettingsHandlers } from './ipc/settings'
import { registerSlackHandlers } from './ipc/slack'
import { registerShellHandlers } from './ipc/shell'
import { registerTerminalHandlers } from './ipc/terminal'
import { applyNavigationGuards } from './navigation'
import { formatScanSummary, scanRepo } from './openspec'
import { guardUnsavedChanges } from './unsaved-changes'
import { configureAgentEvents } from './agent-events'
import { configureAgentInjection } from './agent-injection'
import { configureAgentStatus } from './agent-status'
import { contextRoot } from './intake-context'
import { ensureDeliveryRoot } from './intake-archive'
import { IntakeNotifier } from './intake-notify'
import { electronNotifyBackend } from './intake-notify-electron'
import { createStubBackend, stubNotifyRoot } from './intake-notify-stub'
import { IntakeService } from './intake-service'
import { IntakeSource, inboxRoot } from './intake-source'
import { RoutingStore, routingFile } from './intake-routing'
import { IntakeStore } from './intake-store'
import { PanelStore } from './panel-store'
import { PreferencesStore } from './preferences-store'
import { SecretStore } from './secret-store'
import { SessionStore } from './session-store'
import { SlackCursorStore } from './slack-cursor-store'
import { SlackRuntime } from './slack-service'
import { SlackSettingsStore } from './slack-settings-store'
import { createInsightsService } from './insights'
import { configDirs, delegateDirSuffix, resolveArchiveRoot, resolveDelegateCwd, resolveProjectsDir } from './insights-source'
import { createReportService, reportsRoot } from './report'

/** 讀後感請求的模型。報告記錄的是**這個值** —— 實際生效的可能因回退而不同。 */
const REPORT_MODEL = 'claude-sonnet-5'
import { applyUserEnvOnce } from './user-env'
import { WorkspaceStore } from './workspace-store'

const currentDir = dirname(fileURLToPath(import.meta.url))

/** 啟動後多久觸發第一次掃描。夠晚以免與視窗建立搶資源，夠早以免使用者關掉 app 時還沒跑到。 */
const STARTUP_SCAN_DELAY_MS = 5_000

/**
 * PRD §12 的信任模型。明確寫出而非依賴 Electron 預設值 —— 預設值會隨版本改變，
 * 而 spec 要求「檢查建立視窗時傳入的 webPreferences」時能讀到這兩個值。
 */
const trustModel = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
} as const

function createWindow(dirty: DirtyStateStore): BrowserWindow {
  // 完全移除 menu —— 這個 app 不定義任何 menu 內容，一條空的 menu bar 只會擋住畫面。
  // **不是 `autoHideMenuBar`**（那只是平時隱藏、按 `Alt` 仍浮出）：要的是按 `Alt` 什麼都不發生
  //（design D2）。setApplicationMenu 是 app 層的，設一次即涵蓋整個應用程式。
  Menu.setApplicationMenu(null)

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#0a0c0f',
    webPreferences: {
      preload: join(currentDir, '../preload/index.mjs'),
      ...trustModel,
    },
  })

  // 在載入任何內容之前掛上。renderer 從第一幀起就會渲染使用者 repo 裡的不受信任內容。
  applyNavigationGuards(window.webContents)
  guardUnsavedChanges(window, dirty)

  const contentsId = window.webContents.id
  // 重新載入不會銷毀 webContents，但新頁面沒有任何未存的變更 —— 舊快照必須作廢，
  // 否則關閉時會對著一份不存在的 dirty 集合發問（與 watcher 的釋放同源）。
  window.webContents.on('did-navigate', () => dirty.release(contentsId))
  window.webContents.once('destroyed', () => dirty.release(contentsId))

  window.on('ready-to-show', () => {
    window.show()
  })

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(currentDir, '../renderer/index.html'))
  }

  return window
}

/**
 * 開發模式的掃描目標。預設掃描 repo 自身 —— 它就是一個含 `openspec/` 的 repo。
 * `SPEKTERM_SCAN_PATH` 可指向任意 repo，供實測其他專案。
 *
 * **這個預設值只在未打包時成立，而擋住它的是呼叫端的 `app.isPackaged` 判斷** ——
 * 打包後 `app.getAppPath()` 指向 asar 內部。今天安全，只因為它不會被呼叫。
 *
 * > 若日後把掃描摘要改成無條件輸出（或把這個函式挪作他用），打包版會去掃 asar 內部的
 * > `openspec/` 並回傳一堆零 —— 而**那看起來像「使用者的 repo 沒有 openspec」**，
 * > 不像一個路徑解析的錯。
 */
function resolveScanTarget(): string {
  return process.env.SPEKTERM_SCAN_PATH ?? app.getAppPath()
}

/**
 * 開發模式下輸出掃描摘要，作為 core 整合的可見驗收依據。
 *
 * 掃描不到 `openspec/` 時 core 回傳空結構而非拋錯，因此路徑給錯只會印出一行零，
 * 不該讓工作台開不起來 —— 這裡的 catch 是為了真正的例外（如權限不足）。
 */
async function logScanSummary(): Promise<void> {
  const target = resolveScanTarget()
  try {
    console.log(formatScanSummary(await scanRepo(target)))
  } catch (error) {
    console.error(`[openspec] scan failed ${target}: ${String(error)}`)
  }
}

/**
 * 使用者互動 shell 的 PATH —— 讓 core spawn 的 `openspec` 在桌面環境啟動時解析得到。
 *
 * **不 await**（實測互動 shell 約 1.3 秒，不該擋住視窗建立）。套用發生在 `user-env.ts` 內部
 * 那個唯一的時點；需要對齊時序的地方 `await whenUserEnvReady()`，它們不負責套用。
 */
void applyUserEnvOnce()

/** 啟動後多久跑第一輪 Slack 回補 —— 不與啟動搶資源。 */
const SLACK_BACKFILL_DELAY_MS = 4000

/**
 * 安裝的 desktop entry 檔名。
 *
 * **實測**：不設 `setDesktopName` 時通知的 `desktop-entry` 提示是 `electron`，與安裝的 entry
 * 對不上 ⇒ 通知拿到 Electron 的預設圖示。而 `agent-intake` 對通知的整條論證建立在
 * 「它看起來像作業系統在替**這個 app** 說話」。
 *
 * 值與 `scripts/lib/desktop-entry.mjs` 的 `ENTRY_NAME` 必須一致 —— 主行程 import 不了
 * `scripts/`（那是建置腳本），因此由 `scripts/desktop-name.test.mjs` 釘住兩者相同。
 */
const DESKTOP_ENTRY_NAME = 'spekterm.desktop'

/**
 * 把主視窗帶到前景。
 *
 * **三個都要**：實測在帶有 window manager 的環境下，單獨 `focus()` 對最小化的視窗
 * 完全無效（`isMinimized()` 維持為真）。
 *
 * **視窗由 `getAllWindows()` 取得而不是持有一份參考** —— `createWindow()` 在這個檔案裡有
 * 兩個呼叫點（`whenReady` 與 `activate`），持有第一個的模組層級參考在 close → activate
 * 之後會指向一個已銷毀的物件。
 */
function bringToFront(): void {
  const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/**
 * 這一次執行是不是跑在一個**命令列指定的拋棄式 profile** 上。
 *
 * 用途只有一個：決定通知走真實的作業系統，還是走驗收用的替身。
 *
 * **判準不能只是「沒有打包」**：`npm run dev` 也沒有打包，而 dogfood 正是在 dev 裡進行的
 * —— 那時要的是真通知。驗收與 dev 的差別在於**驗收一律以 `--user-data-dir` 指定一個丟完就
 * 刪的 profile**，dev 走的是 `XDG_CONFIG_HOME`。
 *
 * **判準也不能是 `--remote-debugging-port`**：dogfood 期間的效能診斷工具就帶著它。
 *
 * 出貨的產物一律為否（打包之後這條路徑組不出來），因此替身在使用者手上不存在。
 */
function usingThrowawayProfile(): boolean {
  if (app.isPackaged) return false
  return process.argv.some((arg) => arg.startsWith('--user-data-dir='))
}

void app.whenReady().then(() => {
  // 通知的應用程式身分 —— 見 `DESKTOP_ENTRY_NAME` 的註解。
  app.setDesktopName?.(DESKTOP_ENTRY_NAME)

  // workspace 設定隨使用者資料目錄走，因此 `--user-data-dir` 可指向暫存 profile，
  // 讓驗收得以反覆重啟應用程式而不污染真實設定。
  const store = new WorkspaceStore(join(app.getPath('userData'), 'workspace.json'))
  store.load()

  // session 的持久化與 workspace 同一個落點，理由也一樣（`--user-data-dir` 可隔離驗收）。
  // 快照另外放一個目錄：它們是每個 session 一個檔的大塊文字，不該讓 sessions.json 這個
  // 每次都整份重寫的小檔跟著漲。
  const sessionStore = new SessionStore(
    join(app.getPath('userData'), 'sessions.json'),
    join(app.getPath('userData'), 'sessions'),
  )
  sessionStore.load()

  // 使用者偏好與 workspace 同一個落點，理由也一樣（`--user-data-dir` 可隔離驗收）。
  const preferencesStore = new PreferencesStore(join(app.getPath('userData'), 'preferences.json'))
  preferencesStore.load()

  // 側欄座標（來源 repo／工作目錄／錨定的 change）。**刻意不與 folder 清單同居於
  // `workspace.json`**：那份檔案的解析是 all-or-nothing，而它損毀的代價是「使用者失去所有 repo」
  // —— 一個偏好性質的欄位不該有機會造成那個結果；而且錨定一次 change 就要重寫一次那份使用者
  // 精心維護的清單（見本 change 的 design D2）。
  const panelStore = new PanelStore(join(app.getPath('userData'), 'panel.json'))
  panelStore.load()

  // agent 狀態橋接的落點（payload 與注入用的 settings 檔）。與偏好同在 userData 之下。
  configureAgentStatus(app.getPath('userData'))
  configureAgentEvents(app.getPath('userData'))
  configureAgentInjection(app.getPath('userData'))

  // 收件匣：狀態 index、原始投遞的保存處、routing 規則（**本能力自己的檔案，不進 preferences**）。
  const intakeStore = new IntakeStore(join(app.getPath('userData'), 'intake.json'))
  intakeStore.load()
  const routingStore = new RoutingStore(routingFile(app.getPath('userData')))
  routingStore.load()
  const intakeService = new IntakeService({
    store: intakeStore,
    archiveRoot: contextRoot(app.getPath('userData')),
  })

  // Slack adapter 的兩份落盤 —— **刻意分成兩份檔案**。連線設定本來就要投影給 renderer
  // （介面要顯示連到哪個工作區、是否已設定、端點是不是預設值），而憑證絕不可以；
  // 放在同一個物件裡，那個投影就直接成了 `secret-scope` 第一條所防的那條出口。
  // 分家之後「把憑證投影出去」需要先跨檔案去拿它 —— 做得到，但不會被不小心做出來。
  const secretStore = new SecretStore(join(app.getPath('userData'), 'secrets.json'))
  secretStore.load()
  const slackSettingsStore = new SlackSettingsStore(join(app.getPath('userData'), 'slack.json'))
  slackSettingsStore.load()
  // 水位是**純粹的最佳化**（design D3(b)）：去重的權威是收件匣自己的紀錄，這份檔案只決定
  // 「要掃多少訊息」。遺失它的代價是多掃一遍，不是重複交付 —— 因此它不做韌性設計。
  const slackCursorStore = new SlackCursorStore(join(app.getPath('userData'), 'slack-cursors.json'))
  slackCursorStore.load()

  // Slack 的執行期。**在註冊 IPC 之前建立** —— 那個 handler 要問它狀態。
  // 它持有的狀態是一條 requirement 的載體：「失效」與「目前沒有待處理項目」必須分得出來，
  // 因為兩者在外部本來是同一個樣子（收件匣是空的）。
  /** 狀態改變的訂閱者 —— IPC 那一層在註冊時掛進來。 */
  const slackStatusListeners = new Set<() => void>()
  const slackRuntime = new SlackRuntime({
    settings: slackSettingsStore,
    secrets: secretStore,
    cursors: slackCursorStore,
    intake: intakeStore,
    onStatusChanged: () => {
      for (const listener of slackStatusListeners) listener()
    },
    inboxRoot: inboxRoot(app.getPath('userData')),
    // 與 `IntakeSource` 的 adapter 同一個值 —— 去重的主鍵是 `(adapter, id)`，
    // 兩邊不一致的話「這個識別碼進來過嗎」永遠答否，而重複交付會靜默地發生。
    inboxAdapter: 'file',
  })

  const dirty = new DirtyStateStore()

  // 在建立視窗、載入任何 renderer 內容之前施加 CSP —— renderer 從第一幀起就會渲染使用者
  // repo 裡的不受信任內容（與 applyNavigationGuards 同屬信任模型的前置防護）。
  // dev／production 政策的切換依「是否載入 Vite dev server」（ELECTRON_RENDERER_URL），**不是**
  // app.isPackaged —— 未打包但載入 file:// build 產物（如 probe 的建置模式）應拿 production 政策，
  // 否則 production 政策永遠不會被任何 probe 覆蓋（見 content-security-policy.ts）。
  applyContentSecurityPolicy(session.defaultSession, Boolean(process.env.ELECTRON_RENDERER_URL))

  registerFolderHandlers(store, panelStore)
  registerFsHandlers(store)
  registerOpenSpecHandlers(store)
  registerShellHandlers()
  registerAppHandlers(dirty)
  registerConversationHandlers()
  registerTerminalHandlers(store, sessionStore, preferencesStore)
  registerClipboardHandlers()
  registerSettingsHandlers(preferencesStore)
  registerSlackHandlers({
    settings: slackSettingsStore,
    secrets: secretStore,
    status: () => slackRuntime.status(),
    onStatusChanged: (notify) => slackStatusListeners.add(notify),
    requestRound: () => void slackRuntime.runRound(),
  })
  registerPanelHandlers(panelStore)
  /**
   * 通知 —— 決策層在 `intake-notify.ts`，碰作業系統的只有 `intake-notify-electron.ts`。
   *
   * **替身以 `app.isPackaged` 為閘，不用環境變數**：`ptyEnv()` 展開 `process.env`，於是一個
   * 環境變數會進到每一個 pty，而 pty 裡跑的正是被不受信任內容驅動的 agent —— 它寫一個檔案
   * 就能讓視窗搶到前景並打開收件匣。改以 userData 推導路徑之後，出貨的產物裡這條路徑
   * 根本組不出來（探針本來就傳 `--user-data-dir`）。
   */
  const notifyBackend = usingThrowawayProfile()
    ? createStubBackend({ root: stubNotifyRoot(app.getPath('userData')) })
    : electronNotifyBackend()
  const notifier = new IntakeNotifier({ backend: notifyBackend })
  // **接在到達上，不是接在「有東西變了」或 `DeliverOutcome.notify` 上** —— 後兩者會讓
  // 每一次拒絕跳一則桌面通知、每一則真正進來的都不跳（見 `intake-service.ts` 的 `onArrival`）。
  intakeService.onArrival((record) => notifier.arrived(record))

  let openInbox: (() => void) | null = null
  registerIntakeHandlers({
    service: intakeService,
    routing: routingStore,
    folders: store,
    contextRoot: contextRoot(app.getPath('userData')),
    // 未設定＝啟用（與 gpuAcceleration 同一條規則）。
    agentEventsEnabled: () => preferencesStore.get().agentEvents !== false,
    onInboxOpened: () => notifier.inboxOpened(),
    registerOpenInbox: (open) => { openInbox = open },
  })

  notifyBackend.onActivate(() => {
    bringToFront()
    openInbox?.()
  })

  const insights = createInsightsService({
    projectsDir: () => resolveProjectsDir(),
    archiveRoot: () => resolveArchiveRoot(app.getPath('userData')),
    excludeDirSuffix: () => delegateDirSuffix(),
    spawn: spawnScanWorker,
  })
  const reports = createReportService({
    archiveRoot: () => resolveArchiveRoot(app.getPath('userData')),
    configDir: () => configDirs(),
    delegateCwd: () => resolveDelegateCwd(app.getPath('userData')),
    reportsDir: () => reportsRoot(app.getPath('userData')),
    requestedModel: () => REPORT_MODEL,
    // **`configDir` 由 `report.ts` 解析一次後傳進來**，這裡不再自己求值 ——
    // 「委派寫紀錄的位置」與「我們刪紀錄的位置」必須同源。
    spawn: ({ configDir }) =>
      spawnReportDelegate({ cwd: resolveDelegateCwd(app.getPath('userData')), model: REPORT_MODEL, configDir }),
  })
  registerInsightsHandlers(insights, reports)

  createWindow(dirty)

  /**
   * 檔案落點：**mkdir → 建立監看並等它就緒 → 掃描既有內容**。
   *
   * 掃描不是優化 —— `createWatcher` 的 `ignoreInitial: true` 寫死且不可覆寫，於是
   * 「app 關著的時候投遞」（正是外部 producer 存在的理由）的東西只有掃描看得到。
   */
  const intakeSource = new IntakeSource({
    root: inboxRoot(app.getPath('userData')),
    adapter: 'file',
    service: intakeService,
  })
  void ensureDeliveryRoot(contextRoot(app.getPath('userData')))
    .then(() => intakeSource.start())
    .catch((error) => {
      console.error(`[intake] failed to start inbox: ${String(error)}`)
    })

  /**
   * 啟動後跑一輪 Slack 的回補。
   *
   * **這是本能力的主幹，不是加速器**（design D1）：桌面應用程式大多數時間是關著的，而 Slack 的
   * 即時通道沒有重送佇列 —— 以即時為主等於把最常見的情形（關機八小時）交給一個補不了的機制。
   *
   * **不 await** —— 它不得阻塞啟動。因此它也不得拋錯：`runSlackRound` 以回傳值呈現失敗，
   * 一個漏出去的 rejection 在主行程裡是致命的（主行程一死，所有 pty 陪葬）。
   * 延遲觸發是為了不與啟動搶資源，比照上面那趟對話存檔的掃描。
   */
  setTimeout(() => {
    // `start()` 立刻跑第一輪，並開始週期輪詢。
    // **週期輪詢不是備援** —— 即時路徑是加速器且可能根本不可用（design D1），
    // 而少了它這個能力只在啟動的那一刻有效（實測踩過）。
    slackRuntime.start()
  }, SLACK_BACKFILL_DELAY_MS)

  /**
   * 啟動後跑一趟增量掃描 —— **與使用者要不要看無關**。
   *
   * 來源的保留期是 30 天。只在使用者開啟呈現介面時掃的話，他一個月沒開過，那一個月的來源就
   * 已經被刪掉了，而存檔裡永遠不會有它 —— **那正是這個能力要解決的問題本身**。
   *
   * 延遲觸發是為了不與啟動搶資源；掃描本身跑在獨立行程裡，不影響互動。
   */
  setTimeout(() => {
    void insights.refresh().catch(() => {
      // 失敗的狀態由 service 自己記著（renderer 問得到）。這裡不需要也不該有文案。
    })
  }, STARTUP_SCAN_DELAY_MS)

  // 未打包的執行一律視為開發模式（`electron-vite dev` 與直接 `electron .` 皆涵蓋）。
  if (!app.isPackaged) {
    void logScanSummary()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(dirty)

  /**
   * 檔案落點：**mkdir → 建立監看並等它就緒 → 掃描既有內容**。
   *
   * 掃描不是優化 —— `createWatcher` 的 `ignoreInitial: true` 寫死且不可覆寫，於是
   * 「app 關著的時候投遞」（正是外部 producer 存在的理由）的東西只有掃描看得到。
   */
  const intakeSource = new IntakeSource({
    root: inboxRoot(app.getPath('userData')),
    adapter: 'file',
    service: intakeService,
  })
  void ensureDeliveryRoot(contextRoot(app.getPath('userData')))
    .then(() => intakeSource.start())
    .catch((error) => {
      console.error(`[intake] failed to start inbox: ${String(error)}`)
    })
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
