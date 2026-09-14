import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { IntakeStore } from './intake-store'
import { SecretStore } from './secret-store'
import { SlackCursorStore } from './slack-cursor-store'
import type { BackfillOutcome } from './slack-backfill'
import {
  BACKOFF,
  MAX_DELIVERIES_PER_ROUND,
  ROUND_INTERVAL_MS,
  backoffSeconds,
  type SlackServiceDeps,
  SlackRuntime,
  isConfigured,
} from './slack-service'
import { SlackSettingsStore } from './slack-settings-store'
import { secretName } from './slack-state'

const USER_TOKEN = 'xoxp-SENTINEL-a7f3c91e-do-not-leak'

/**
 * 一個一定連不上的端點。
 *
 * **每個測試都必須設定它。** 第一版沒設，於是那個測試**真的打了 slack.com** ——
 * 它把一個假憑證送到真實服務、讓測試依賴網路，而且 Slack 正確地回了 `invalid_auth`，
 * 於是「網路問題不該被報成憑證失效」那條斷言以一個完全正確的實作失敗了。
 * 症狀看起來像產品的 bug，實際是測試的前置沒設好。
 */
const UNREACHABLE = 'https://127.0.0.1:1/api'

let base: string
let secrets: SecretStore
let settings: SlackSettingsStore
let cursors: SlackCursorStore
let intake: IntakeStore

function deps(): SlackServiceDeps {
  return {
    settings,
    secrets,
    cursors,
    intake,
    inboxRoot: path.join(base, 'intake-inbox'),
    inboxAdapter: 'file',
    now: () => 1_700_000_000_000,
  }
}

function runtime(): SlackRuntime {
  return new SlackRuntime(deps())
}

/** 只記帳、不做事的一輪 —— 用來觀察「誰觸發了一輪」。 */
class CountingRuntime extends SlackRuntime {
  readonly rounds: number[] = []
  override async runRound(): Promise<void> {
    this.rounds.push(this.rounds.length + 1)
  }
}

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'spek-slack-svc-')))
  secrets = new SecretStore(path.join(base, 'secrets.json'))
  secrets.load()
  settings = new SlackSettingsStore(path.join(base, 'slack.json'))
  settings.load()
  cursors = new SlackCursorStore(path.join(base, 'slack-cursors.json'))
  cursors.load()
  intake = new IntakeStore(path.join(base, 'intake.json'))
  intake.load()
  // **一律指向本機** —— 見 `UNREACHABLE` 的說明。
  settings.setApiBaseUrl(UNREACHABLE)
})

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true })
})

describe('每輪的交付上限', () => {
  it('**小於收件匣的待處理總量上限**', async () => {
    // 收件匣的總量上限是**暫時性拒絕**：超限的投遞原封留在落點、每次掃描被重讀一次，
    // 而 producer 若不自我節制就會繼續寫新檔。這個關係是承重的 ——
    // 它讓「我們不會是那個把落點塞滿的人」成為結構而不是巧合。
    const { MAX_PENDING } = await import('./intake-store')
    assert.ok(
      MAX_DELIVERIES_PER_ROUND < MAX_PENDING,
      `每輪上限 ${MAX_DELIVERIES_PER_ROUND} 應小於收件匣的 ${MAX_PENDING}`,
    )
  })
})

describe('四種狀態必須分得出來', () => {
  it('還沒設定憑證 ⇒ configured 為假，且不是失效', async () => {
    // **「還沒設定」不是失效。** 報成失效會讓使用者去找一個不存在的問題。
    const service = runtime()
    await service.runRound()

    const status = service.status()
    assert.equal(status.configured, false)
    assert.equal(status.failure, undefined, '未設定不該被報成失效')
    assert.equal(status.realtime, 'off')
  })

  it('isConfigured 只看 user token —— app token 是即時路徑的選配', () => {
    assert.equal(isConfigured({ secrets }), false)
    secrets.set(secretName('userToken'), USER_TOKEN)
    assert.equal(isConfigured({ secrets }), true, '沒有 app token 也算已設定')
  })

  it('連不上 ⇒ configured 為真、失效為 transient 而非 auth', async () => {
    // **「連不上」與「憑證失效」是兩件事。** 把前者報成後者，使用者會去重新產生一份好的憑證
    // 而問題根本不在那裡；報成 auth 的另一個代價是即時路徑會被跳過（見 runRound 的早退）。
    secrets.set(secretName('userToken'), USER_TOKEN)
    const service = runtime()
    await service.runRound()

    const status = service.status()
    assert.equal(status.configured, true)
    assert.equal(status.failure?.kind, 'transient', `實際：${JSON.stringify(status.failure)}`)
    assert.equal(status.delivered, 0)
  })
})

describe('失效的合併', () => {
  it('**同一種失效合併為恰好一則，且帶次數**', async () => {
    // 「而非多則」單獨在**零則**時也成立 —— 那是一條紅不起來的斷言。因此驗「恰為一則 ＋ 次數」。
    secrets.set(secretName('userToken'), USER_TOKEN)
    const service = runtime()

    await service.runRound()
    const first = service.status().failure
    assert.equal(first?.count, 1, `第一輪應為 1 次，實際 ${JSON.stringify(first)}`)

    await service.runRound()
    const second = service.status().failure
    assert.equal(second?.kind, first?.kind, '同一種')
    assert.equal(second?.error, first?.error)
    assert.equal(second?.count, 2, '第二次應累加而不是另開一則')
  })

  it('狀態是複本 —— 呼叫端改不動它', async () => {
    secrets.set(secretName('userToken'), USER_TOKEN)
    const service = runtime()
    await service.runRound()

    const status = service.status()
    if (status.failure !== undefined) status.failure.count = 999
    assert.notEqual(service.status().failure?.count, 999)
  })
})

describe('不阻塞、不拋錯', () => {
  it('runRound 在任何情況下都不 reject', async () => {
    // 呼叫端不 await 它（`void`）—— 一個漏出去的 rejection 在主行程裡是致命的
    // （主行程一死，它底下所有 pty 陪葬）。
    const service = runtime()
    await assert.doesNotReject(() => service.runRound())

    secrets.set(secretName('userToken'), USER_TOKEN)
    await assert.doesNotReject(() => service.runRound())
  })

  it('dispose 不拋錯，且可重複呼叫', async () => {
    const service = runtime()
    await assert.doesNotReject(() => service.dispose())
    await assert.doesNotReject(() => service.dispose())
  })
})

describe('週期輪詢 —— 沒有它，這個能力只在啟動的那一刻有效', () => {
  // **dogfood 踩到的缺陷。** design D1 的降級模式寫的是「啟動時 **+ 週期輪詢**」，而第一版
  // 只做了前半：使用者在 app 起來之後才貼上憑證，那一輪早就跑完了，而**不重開 app 就永遠
  // 不會有第二輪**。而 dev 模式下「重開 app」還需要有人重跑 `npm run dev`。
  it('start() 立刻跑一輪，之後每個間隔再跑一輪', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] })
    const instance = new CountingRuntime(deps())

    instance.start()
    // **啟動那一輪不能等到第一個間隔到期** —— 關閉期間的提及要馬上補上，而那是 D1 的主幹。
    assert.equal(instance.rounds.length, 1, '啟動時就該跑一輪')

    t.mock.timers.tick(ROUND_INTERVAL_MS)
    assert.equal(instance.rounds.length, 2, '一個間隔之後該有第二輪')
    t.mock.timers.tick(ROUND_INTERVAL_MS)
    assert.equal(instance.rounds.length, 3, '週期性 —— 不是只有第二輪')
  })

  it('重複 start() 不會疊出第二個計時器', (t) => {
    // 疊出兩個計時器的症狀是每個間隔跑兩輪 —— 速率上限會被無謂地逼近，而沒有東西會紅。
    t.mock.timers.enable({ apis: ['setInterval'] })
    const instance = new CountingRuntime(deps())

    instance.start()
    instance.start()
    t.mock.timers.tick(ROUND_INTERVAL_MS)

    assert.equal(instance.rounds.length, 2, '啟動那一輪 + 一個間隔 = 兩輪')
  })

  it('dispose() 之後不再有新的一輪', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] })
    const instance = new CountingRuntime(deps())

    instance.start()
    await instance.dispose()
    t.mock.timers.tick(ROUND_INTERVAL_MS * 3)

    assert.equal(instance.rounds.length, 1, '只有啟動那一輪')
  })
})

describe('一輪還在跑時不疊上另一輪', () => {
  it('第二次呼叫直接返回', async () => {
    // 三個觸發點（啟動、週期、使用者剛存下憑證）可能重疊。疊起來會讓速率上限與水位的推進
    // 同時變得難以推理，而症狀只是「偶爾多打了一輪」—— 不會有任何東西變紅。
    secrets.set(secretName('userToken'), USER_TOKEN)
    const realGet = secrets.get.bind(secrets)
    let gets = 0
    // 觀察點取 `#round()` 的第一個動作 —— 它在任何 await 之前，所以「跑了幾輪」數得準。
    // **必須認名字**：一輪裡會再讀一次 app-level token（即時路徑），不分辨的話一輪就數成兩輪。
    ;(secrets as unknown as { get: typeof realGet }).get = (name) => {
      if (name === secretName('userToken')) gets += 1
      return realGet(name)
    }

    const instance = runtime()
    await Promise.all([instance.runRound(), instance.runRound()])

    assert.equal(gets, 1, '第二次呼叫應直接返回，而不是再跑一輪')
  })
})

describe('對端要求延後時的夾制', () => {
  it('缺席不是零 —— 對端已經拒絕了，零等於不退避', () => {
    assert.equal(backoffSeconds(undefined), BACKOFF.defaultSeconds)
    assert.equal(backoffSeconds(Number.NaN), BACKOFF.defaultSeconds)
  })

  it('**荒謬的值被夾住** —— 端點是使用者可設定的，那個值不是完全可信的輸入', () => {
    // 一個回 `Retry-After: 99999999` 的端點會讓這個能力無限期停擺，而畫面上只顯示
    // 「正在等待」。一個能被輸入資料無限期關閉的能力，是一個可以被關掉的能力。
    assert.equal(backoffSeconds(99_999_999), BACKOFF.maxSeconds)
    assert.equal(backoffSeconds(0), BACKOFF.minSeconds)
    assert.equal(backoffSeconds(-5), BACKOFF.minSeconds)
  })

  it('正常範圍內原樣採用', () => {
    assert.equal(backoffSeconds(17), 17)
  })
})

describe('退避期內不開始新的一輪', () => {
  /** 一份可指定結果的回補。 */
  function stubBackfill(results: Partial<BackfillOutcome>[]): {
    run: (deps: unknown) => Promise<BackfillOutcome>
    rounds: number
  } {
    const state = { rounds: 0 }
    const run = async (): Promise<BackfillOutcome> => {
      const spec = results[Math.min(state.rounds, results.length - 1)]
      state.rounds += 1
      return { delivered: 0, deferred: 0, channelsScanned: 0, channels: {}, ...spec }
    }
    return {
      run: run as unknown as (deps: unknown) => Promise<BackfillOutcome>,
      get rounds() {
        return state.rounds
      },
    }
  }

  function runtimeWith(
    backfill: ReturnType<typeof stubBackfill>,
    clock: { now: number },
  ): SlackRuntime {
    return new SlackRuntime({
      ...deps(),
      now: () => clock.now,
      backfill: backfill.run as never,
    })
  }

  it('**退避期內的每一次觸發都不跑，期滿之後的會跑**', async () => {
    // 後半句是承重的：少了它，一個「退避之後永遠不再取回」的實作照樣綠，
    // 而那個失效在畫面上只是「一直在等待」。
    //
    // **刻意不經 `start()`**：那一輪是 `void runRound()`，排不乾它就會被再入保護擋掉
    // 之後每一次呼叫 —— 而那會讓這條測的是再入而不是退避（實測踩過）。週期觸發本身
    // 另有「週期輪詢」那組測試承擔。
    secrets.set(secretName('userToken'), USER_TOKEN)
    const clock = { now: 1_700_000_000_000 }
    const backfill = stubBackfill([
      { rateLimited: true, retryAfterSeconds: 600, failure: { kind: 'rate_limited', error: 'rate_limited' } },
      {},
    ])
    const instance = runtimeWith(backfill, clock)

    await instance.runRound()
    assert.equal(backfill.rounds, 1, '前提：第一輪跑了，而它被限流')
    assert.equal(instance.status().retryAt, clock.now + 600_000, '前提：退避到 600 秒之後')

    // 退避 600 秒 ⇒ 之後兩個週期（各 5 分鐘）都落在期內。
    // **算術要留邊**：兩次各 +300 秒剛好落在截止點上，那不是「期內」（實測踩過）。
    clock.now += ROUND_INTERVAL_MS
    await instance.runRound()
    assert.equal(backfill.rounds, 1, '退避期內不該再跑')
    clock.now += ROUND_INTERVAL_MS - 1_000
    await instance.runRound()
    assert.equal(backfill.rounds, 1, '第二次也不跑 —— 不是只擋掉一次')

    clock.now += 2_000
    await instance.runRound()
    assert.equal(backfill.rounds, 2, '期滿之後要恢復')

    await instance.dispose()
  })

  it('**退避期間累積的提及在恢復後的那一輪被交付** —— 跳過不等於漏掉', async () => {
    secrets.set(secretName('userToken'), USER_TOKEN)
    const clock = { now: 1_700_000_000_000 }
    const backfill = stubBackfill([
      { rateLimited: true, retryAfterSeconds: 60, failure: { kind: 'rate_limited', error: 'rate_limited' } },
      { delivered: 3 },
    ])
    const instance = runtimeWith(backfill, clock)

    await instance.runRound()
    await instance.runRound()
    assert.equal(instance.status().delivered, 0, '前提：被跳過的那一輪什麼都沒交付')

    clock.now += 61_000
    await instance.runRound()
    assert.equal(instance.status().delivered, 3, '期間累積的三則在恢復後的那一輪進來')
    await instance.dispose()
  })

  it('**退避期內被觸發時，狀態仍然被推一次** —— 使用者的操作不得落空', async () => {
    // 他存下憑證卻什麼都沒發生，與「功能壞了」在畫面上完全相同。
    secrets.set(secretName('userToken'), USER_TOKEN)
    const clock = { now: 1_700_000_000_000 }
    const backfill = stubBackfill([
      { rateLimited: true, retryAfterSeconds: 600, failure: { kind: 'rate_limited', error: 'rate_limited' } },
    ])
    let notices = 0
    const instance = new SlackRuntime({
      ...deps(),
      now: () => clock.now,
      backfill: backfill.run as never,
      onStatusChanged: () => {
        notices += 1
      },
    })

    await instance.runRound()
    const before = notices
    await instance.runRound()

    assert.ok(notices > before, '被跳過的那一次仍要通知呈現層')
    assert.equal(instance.status().retryAt, clock.now + 600_000, '而且說得出下次何時會試')
    await instance.dispose()
  })
})
