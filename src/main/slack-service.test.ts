import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { IntakeStore } from './intake-store'
import { SecretStore } from './secret-store'
import { SlackCursorStore } from './slack-cursor-store'
import { MAX_DELIVERIES_PER_ROUND, SlackRuntime, isConfigured } from './slack-service'
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

function runtime(): SlackRuntime {
  return new SlackRuntime({
    settings,
    secrets,
    cursors,
    intake,
    inboxRoot: path.join(base, 'intake-inbox'),
    inboxAdapter: 'file',
    now: () => 1_700_000_000_000,
  })
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
