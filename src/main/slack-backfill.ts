import type { IntakeDelivery, SlackMessage } from './slack-mention'
import { buildDelivery, intakeIdOf, isIncomingMention } from './slack-mention'
import type { SlackApi, SlackFailure } from './slack-api'

/**
 * 回補 —— 本能力的**主幹**（design D1）。
 *
 * ## 為什麼主幹是回補而不是即時
 *
 * 桌面應用程式大多數時間是關著的，而 Slack 的即時通道**沒有重送佇列** —— 以即時為主等於把
 * 最常見的情形（關機八小時）交給一個結構上補不了的機制。即時路徑只是把同一件事提早送到。
 *
 * 它同時讓那條未查證的事實（user-scope 事件走不走 WebSocket）不再承重：不成立時本能力退化成
 * 「只有回補」，其餘模組一個字都不必改。
 *
 * ## 三重夾制
 *
 * 啟動時的取回量必須有界，否則它隨頻道數與關機時間無界成長，而本能力不得阻塞主行程：
 *
 * 1. **水位** —— 每個頻道只掃「上次看到之後」。
 * 2. **回看範圍** —— 水位不存在時的起點。**這是一個刻意的缺口**（關機超過它的期間會漏），
 *    而它必須對使用者可見。
 * 3. **每輪的交付上限** —— 見下方 `maxPerRound`。
 *
 * ## 水位只前進到確實處理完的位置
 *
 * 達到每輪上限時，水位 **SHALL NOT** 前進過那些還沒交付的提及 —— 否則它們永遠不會被看到，
 * 而那是一個靜默的漏件（最壞的那種失效）。
 */

/** 每個頻道每輪最多翻幾頁 —— 夾制之三的一部分。 */
const MAX_PAGES_PER_CHANNEL = 5

/** 每輪最多列舉幾頁頻道清單。 */
const MAX_CHANNEL_PAGES = 5

export interface BackfillDeps {
  api: SlackApi
  /** 某個頻道的水位；`undefined` ＝退回回看範圍的起點。 */
  cursorOf: (channelId: string) => string | undefined
  /** 前進水位。**只在該位置之前的提及都處理完之後才呼叫。** */
  advanceCursor: (channelId: string, ts: string) => void
  /** 記下自憑證推導出的身分（design D14）。 */
  rememberIdentity: (teamId: string, userId: string) => void
  /**
   * 這個識別碼已經進過收件匣了嗎。
   *
   * **去重的權威是收件匣自己的紀錄，不是本能力的水位**（design D3(b)）—— 會觸發重新推導的
   * 主要原因正是水位遺失，那時任何與它同居的紀錄一併遺失。收件匣的紀錄則從不被刪除。
   */
  alreadyDelivered: (id: string) => boolean
  /** 交付一則投遞（寫進既有的投遞落點）。 */
  deliver: (delivery: IntakeDelivery) => Promise<void>
  /** 回看範圍（天）。 */
  lookbackDays: () => number
  /** 每輪的交付上限。 */
  maxPerRound: number
  /** 現在（毫秒）。注入以讓「回看範圍之外」驗得起來。 */
  now: () => number
}

export interface BackfillOutcome {
  /** 這一輪交付了幾則。 */
  delivered: number
  /** 因為達到每輪上限而**還沒交付**的則數（下一輪續作）。 */
  deferred: number
  /** 掃過幾個頻道。 */
  channelsScanned: number
  /**
   * 這一輪列舉到的頻道（id → 名稱）。
   *
   * **即時路徑需要它**：Socket Mode 的事件裡沒有頻道名稱，而少了名稱那條路徑會把 id 寫進
   * 投遞內容 —— 於是同一則提及會**依「哪條路先到」而呈現不同**，那是「卡片顯示識別碼對使用者
   * 不構成資訊」那個缺陷的另一種形式。
   */
  channels: Readonly<Record<string, string>>
  /** 失敗（若有）。`auth` 代表使用者必須知道，重試無用。 */
  failure?: SlackFailure
}

/** 一個待交付的候選。 */
export interface Candidate {
  channelId: string
  channelName: string
  message: SlackMessage
}

/** 回看範圍的起點，Slack 的時間戳格式（秒 + 微秒）。 */
export function lookbackOldest(nowMs: number, days: number): string {
  const seconds = Math.floor(nowMs / 1000) - days * 24 * 60 * 60
  return `${Math.max(0, seconds)}.000000`
}

/**
 * 跑一輪回補。
 *
 * **不拋錯** —— 失敗以 `outcome.failure` 回報，讓上層能把「憑證失效」呈現給使用者
 * （`agent-intake` 那條「失效與閒置必須可區分」倚賴它）。一個 throw 會在某個 `void` 的呼叫點
 * 變成未捕捉的 rejection，而那在主行程裡是致命的。
 */
export async function runBackfill(deps: BackfillDeps): Promise<BackfillOutcome> {
  const identity = await deps.api.authTest()
  if (!identity.ok) {
    return { delivered: 0, deferred: 0, channelsScanned: 0, channels: {}, failure: identity }
  }
  const { teamId, userId } = identity.value
  deps.rememberIdentity(teamId, userId)

  const channels = await listChannels(deps)
  if (!channels.ok) {
    return { delivered: 0, deferred: 0, channelsScanned: 0, channels: {}, failure: channels.failure }
  }
  const channelNames: Record<string, string> = {}
  for (const channel of channels.value) channelNames[channel.id] = channel.name

  let delivered = 0
  let deferred = 0
  let failure: SlackFailure | undefined
  const names = new NameCache(deps.api)
  const oldestAllowed = lookbackOldest(deps.now(), deps.lookbackDays())

  for (const channel of channels.value) {
    // 水位優先；沒有水位（或水位比回看範圍更舊）時用回看範圍的起點。
    const cursor = deps.cursorOf(channel.id)
    const oldest =
      cursor !== undefined && Number(cursor) > Number(oldestAllowed) ? cursor : oldestAllowed

    const scanned = await scanChannel(deps, channel, oldest, userId)
    if (scanned.failure !== undefined) {
      failure ??= scanned.failure
      continue
    }

    // **候選依時間排序處理，而水位只前進到「已處理完」的位置。**
    let handledUpTo: string | undefined = scanned.newestSeen
    for (const [index, candidate] of scanned.candidates.entries()) {
      if (delivered >= deps.maxPerRound) {
        deferred += scanned.candidates.length - index
        // **水位停在第一個未處理的候選之前** —— 前進過它等於永久漏掉它。
        handledUpTo = previousTs(scanned.candidates, index)
        break
      }
      const outcome = await deliverCandidate(deps, teamId, candidate, names)
      if (outcome.failure !== undefined) {
        failure ??= outcome.failure
        // 這一則沒處理成功 ⇒ 水位同樣不得越過它。
        handledUpTo = previousTs(scanned.candidates, index)
        break
      }
      if (outcome.delivered) delivered += 1
    }

    if (handledUpTo !== undefined) deps.advanceCursor(channel.id, handledUpTo)
  }

  return {
    delivered,
    deferred,
    channelsScanned: channels.value.length,
    channels: channelNames,
    failure,
  }
}

/** 候選清單中第 `index` 個之前的那一則的 ts（沒有就 `undefined` ＝水位完全不動）。 */
function previousTs(candidates: Candidate[], index: number): string | undefined {
  if (index === 0) return undefined
  return candidates[index - 1].message.ts
}

async function listChannels(
  deps: BackfillDeps,
): Promise<{ ok: true; value: { id: string; name: string }[] } | { ok: false; failure: SlackFailure }> {
  const all: { id: string; name: string }[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_CHANNEL_PAGES; page += 1) {
    const result = await deps.api.usersConversations({ cursor })
    if (!result.ok) return { ok: false, failure: result }
    all.push(...result.value.channels)
    cursor = result.value.nextCursor
    if (cursor === undefined) break
  }
  return { ok: true, value: all }
}

async function scanChannel(
  deps: BackfillDeps,
  channel: { id: string; name: string },
  oldest: string,
  selfUserId: string,
): Promise<{ candidates: Candidate[]; newestSeen?: string; failure?: SlackFailure }> {
  const candidates: Candidate[] = []
  let newestSeen: string | undefined
  let cursor: string | undefined

  for (let page = 0; page < MAX_PAGES_PER_CHANNEL; page += 1) {
    const result = await deps.api.conversationsHistory({ channel: channel.id, oldest, cursor })
    if (!result.ok) return { candidates, newestSeen, failure: result }
    for (const message of result.value.messages) {
      if (newestSeen === undefined || Number(message.ts) > Number(newestSeen)) newestSeen = message.ts
      if (isIncomingMention(message, selfUserId)) {
        candidates.push({ channelId: channel.id, channelName: channel.name, message })
      }
    }
    cursor = result.value.nextCursor
    if (cursor === undefined) break
  }

  candidates.sort((left, right) => Number(left.message.ts) - Number(right.message.ts))
  return { candidates, newestSeen }
}

/**
 * 把一個候選交付出去。**回補與即時兩條路徑共用這個函式，而那是 design D1 的載體。**
 *
 * D1 承諾「即時只是把同一件事提早送到」。若兩條路徑各自組出投遞內容，先到的那一條會定案，
 * 而使用者讀到的與另一條會產出的**不同** —— 那是一個難查的不一致，且沒有任何東西會紅。
 * 共用一個函式讓那件事表達不出來。
 */
export async function deliverCandidate(
  deps: BackfillDeps,
  teamId: string,
  candidate: Candidate,
  names: NameCache,
): Promise<{ delivered: boolean; failure?: SlackFailure }> {
  const id = intakeIdOf({
    teamId,
    channelId: candidate.channelId,
    ts: candidate.message.ts,
  })
  // **去重：問收件匣，不問自己的水位。**
  if (deps.alreadyDelivered(id)) return { delivered: false }

  const thread = await fetchThreadUpTo(deps, candidate)
  if (thread.failure !== undefined) return { delivered: false, failure: thread.failure }

  const resolved = await names.resolve(collectUserIds(thread.messages))
  if (resolved.failure !== undefined) return { delivered: false, failure: resolved.failure }

  await deps.deliver(
    buildDelivery({
      teamId,
      channelId: candidate.channelId,
      channelName: candidate.channelName,
      message: candidate.message,
      thread: thread.messages,
      names: resolved.names,
    }),
  )
  return { delivered: true }
}

/**
 * 取回討論串，**裁切至被提及的那一則為止（含）**。
 *
 * 這是 design D3(a)：上界固定於訊息座標，於是同一則提及無論何時被重新推導，本文都一樣。
 * 語意上也對 —— 使用者是在那個時間點被交辦的。
 */
async function fetchThreadUpTo(
  deps: BackfillDeps,
  candidate: Candidate,
): Promise<{ messages: SlackMessage[]; failure?: SlackFailure }> {
  const result = await deps.api.conversationsReplies({
    channel: candidate.channelId,
    ts: candidate.message.ts,
  })
  if (!result.ok) {
    // 取不到討論串不該讓整則消失 —— 退回「只有那一則」，使用者至少看得到被 tag 的那句話。
    return { messages: [candidate.message] }
  }
  const upTo = result.value.messages.filter(
    (message) => Number(message.ts) <= Number(candidate.message.ts),
  )
  return { messages: upTo.length > 0 ? upTo : [candidate.message] }
}

function collectUserIds(messages: SlackMessage[]): string[] {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.user !== undefined) ids.add(message.user)
    for (const match of (message.text ?? '').matchAll(/<@([UW][A-Z0-9]+)/g)) ids.add(match[1])
  }
  return [...ids]
}

/**
 * user id → 顯示名稱的快取。
 *
 * **它是一輪之內的快取，不落盤** —— 落盤的話它就成了「與水位同居的快照」，而那個設計已經被
 * D3(b) 作廢（水位遺失時它一起遺失，保護不了促使它存在的情境）。
 */
export class NameCache {
  readonly #api: SlackApi
  readonly #names: Record<string, string> = {}

  constructor(api: SlackApi) {
    this.#api = api
  }

  async resolve(
    ids: string[],
  ): Promise<{ names: Record<string, string>; failure?: SlackFailure }> {
    for (const id of ids) {
      if (this.#names[id] !== undefined) continue
      const result = await this.#api.userDisplayName(id)
      if (!result.ok) {
        // **憑證失效要往上傳**；其餘（查不到名字）不該讓整則消失 —— 呈現層會退回 id。
        if (result.kind === 'auth') return { names: this.#names, failure: result }
        continue
      }
      this.#names[id] = result.value
    }
    return { names: this.#names }
  }
}
