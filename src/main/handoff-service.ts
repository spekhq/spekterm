import { buildDelivery, HANDOFF_ADAPTER, parseHandoffPayload } from './handoff-delivery'
import { clearOutbox, outboxRoot, sourceSessionOf } from './handoff-outbox'
import { HandoffThrottle, type ThrottleOptions } from './handoff-throttle'
import { resolveTarget, type TargetCandidate } from './handoff-target'
import type { DeliverOutcome, IntakeService } from './intake-service'
import { IntakeSource } from './intake-source'

/** 來源 session 的座標。`folderId` 為 `null` ＝ 全域 session。 */
export interface HandoffSource {
  folderId: string | null
  label: string
}

/** 來源 session 已結束時用的座標識別碼。**不是一個 folder** —— 只是一個座標。 */
export const ENDED_SOURCE_ID = '(ended)'

/** 全域 session 的座標識別碼。 */
export const GLOBAL_SOURCE_ID = '(global)'

export interface HandoffServiceDeps {
  service: IntakeService
  /** 由 sessionId 推出來源。查無（session 已結束）回 `null`。 */
  sourceOf: (sessionId: string) => HandoffSource | null
  /**
   * 查表的定義域。
   *
   * **它與告知 agent 的那份清單必須取自同一個來源** —— 分成兩份的話，agent 手上的選項與接收端
   * 認得的選項會在某一次變動之後分岔，而症狀是「它明明照著清單寫，卻被說查無」。
   */
  candidates: () => TargetCandidate[]
  agentEventsEnabled: () => boolean
  /**
   * 本能力是否啟用。**在每一次投遞的當下求值**，不是建構時。
   *
   * **它要同時擋住兩件事**：注入（由 `prepareHandoffInjection` 負責）與**既有落點中的內容**。
   * 只擋注入的話，關掉偏好之後，上一輪留下的落點照樣會被監看與處理 —— 使用者關掉了一個能力，
   * 而它還在開 session。
   */
  enabled: () => boolean
  /**
   * 到達即接受：請 renderer 在該 folder 建立 session。
   *
   * **建立不由主行程做** —— session 清單的權威在 renderer（見 `ipc/intake` 檔頭），主行程自行
   * 建立的 session 會在下一次 replace 時被抹掉，**而 pty 還活著**。
   */
  requestAutoAccept: (adapter: string, id: string, folderId: string) => void
  throttle?: ThrottleOptions
}

/**
 * 交接的 producer。
 *
 * **它是收件匣的一個 producer，不是收件匣的一部分** —— 與 `slack-intake-source` 同一個分界：
 * 驗證、去重、context 檔、預填、通知一律沿用。本服務只負責「一則交接如何產生、它的來源與
 * 目標如何被決定」。
 */
export class HandoffService {
  readonly #deps: HandoffServiceDeps
  readonly #throttle: HandoffThrottle
  #source: IntakeSource | null = null

  constructor(deps: HandoffServiceDeps) {
    this.#deps = deps
    this.#throttle = new HandoffThrottle(deps.throttle)
  }

  async start(): Promise<void> {
    const root = outboxRoot()
    if (!root) return
    this.#source = new IntakeSource({
      root,
      adapter: HANDOFF_ADAPTER,
      service: this.#deps.service,
      // 落點是**每個 session 一層**：`<root>/<sessionId>/*.json`。
      depth: 1,
      deliver: (contents, file) => this.deliverFile(contents, file),
      /**
       * **這條路徑上的永久性失敗要發通知** —— 「被拒絕的投遞不發通知」那條規則明文的例外。
       *
       * 接受那個環節已經沒有人在看，少了它，一次失敗的交接與「什麼都沒發生」在畫面上完全
       * 相同 —— 而使用者會以為工作已經交出去了。
       */
      notifyFailures: true,
    })
    await this.#source.start()
  }

  async dispose(): Promise<void> {
    await this.#source?.dispose()
    this.#source = null
  }

  /**
   * session 結束 —— **先把落點裡既有的項目處理完，再清除**。
   *
   * 少了這個順序，一則已經投遞、尚未被讀到的交接會隨 session 的結束而消失，**而投遞端與
   * 使用者兩邊都不會知道**。
   */
  async endSession(sessionId: string): Promise<void> {
    await this.#source?.scan()
    clearOutbox(sessionId)
  }

  /** 一份投遞檔 → 一次 `deliver()`。 */
  async deliverFile(contents: string, file: string): Promise<DeliverOutcome> {
    const { service } = this.#deps

    // 關閉時**連既有落點的內容都不處理**（見 `enabled` 的註解）。不消費 —— 使用者可能只是
    // 暫時關掉它，那些投遞在重新啟用之後應該還在。
    if (!this.#deps.enabled()) return { ok: false, code: 'MALFORMED', consume: false, notify: false }

    const sessionId = sourceSessionOf(file)
    // 不在 `<root>/<sessionId>/` 正下方 ⇒ 不是一份交接。消費掉它，否則它每次掃描都再走一趟。
    if (!sessionId) return { ok: false, code: 'MALFORMED', consume: true, notify: false }

    const payload = parseHandoffPayload(contents)
    if (!payload.ok) {
      // **`MALFORMED` 不消費、也不通知** —— 可能只是寫到一半，而那種項目每次補寫都會再被讀到，
      // 逐次通知沒有上界（`agent-intake` 的例外條款明文排除它）。
      if (payload.reason === 'MALFORMED') return { ok: false, code: 'MALFORMED', consume: false, notify: false }
      return service.reject('FIELD_TYPE', sessionId, 'target / body', { adapter: HANDOFF_ADAPTER })
    }

    const source = this.#deps.sourceOf(sessionId)
    const originId = source ? (source.folderId ?? GLOBAL_SOURCE_ID) : ENDED_SOURCE_ID
    const originLabel = source?.label ?? ENDED_SOURCE_ID

    /**
     * **診斷欄位由這裡交出去** —— 共用的攝入路徑算不出它們。
     *
     * `deliver()` 只拿得到 `provenance`（來源座標與**已解析的**目標 folder），而「投遞者
     * 當初寫的是哪個字串」正是診斷一次「查無」時唯一有用的東西。讓共用路徑自己去讀
     * `raw.target` 則會破壞「payload 自稱的一律不採信」的姿態。
     */
    const failure = { target: payload.value.target, origin: originLabel }

    const target = resolveTarget(payload.value.target, this.#deps.candidates())
    if (!target.ok) {
      return {
        ...(target.reason === 'AMBIGUOUS'
          ? service.reject('TARGET_AMBIGUOUS', payload.value.target, target.candidates.join(', '), {
              adapter: HANDOFF_ADAPTER,
              ...failure,
            })
          : service.reject('TARGET_NOT_FOUND', payload.value.target, undefined, {
              adapter: HANDOFF_ADAPTER,
              ...failure,
            })),
        failure,
      }
    }

    // **預填不可能發生時不建立 session。** 事件回報關閉是一個可事先偵測的**恆定**成因；照樣
    // 建 session 會讓「建了 → 等到逾時 → 退回待處理 → 再處理 → 又建一個」成為主幹。
    if (!this.#deps.agentEventsEnabled()) {
      return {
        ...service.reject('PREFILL_UNAVAILABLE', payload.value.target, undefined, {
          adapter: HANDOFF_ADAPTER,
          ...failure,
        }),
        failure,
      }
    }

    const { contents: delivery, provenance } = buildDelivery({
      sessionId,
      payload: payload.value,
      contents,
      originId,
      originLabel,
      targetFolderId: target.folderId,
    })

    // **失敗的診斷欄位一律帶上** —— 共用路徑的拒絕（本文過長、識別碼不合法…）同樣要說得出
    // 「是哪一件事」，而它們在那裡算不出目標原字串。
    const outcome = await service.deliver(delivery, HANDOFF_ADAPTER, provenance, failure)
    if (!outcome.ok || !outcome.record) return { ...outcome, failure }

    // **上限在最後才問** —— 一則會被拒絕的交接不該吃掉一個名額。
    // 超過時**不**自動接受：它留在收件匣成為待處理，使用者接受它即可（降級而非拒絕）。
    if (this.#throttle.take()) {
      this.#deps.requestAutoAccept(HANDOFF_ADAPTER, outcome.record.id, target.folderId)
    }
    return outcome
  }
}

/**
 * 目前這個行程的交接服務。
 *
 * **它存在的理由只有一個**：pty 的服務要在 session 結束時通知交接把落點收掉，而它不該認得
 * `HandoffService`（那個「先處理完、再清除」的順序住在這裡，不住在它那裡）。與
 * `configureAgentEvents` / `configureHandoff` 同一個姿態。
 */
let active: HandoffService | null = null

export function registerHandoffService(service: HandoffService | null): void {
  active = service
}

/** session 結束了。尚未註冊時為 no-op（例如偏好關閉、或落點建不起來）。 */
export function endHandoffSession(sessionId: string): void {
  void active?.endSession(sessionId).catch((error) => {
    console.error(`[handoff] failed to end session ${sessionId}: ${String(error)}`)
  })
}
