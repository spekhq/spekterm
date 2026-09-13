import { t } from '@shared/i18n'
import { MAX_BODY_LENGTH, MAX_FIELD_LENGTH, normalizeAuthored } from './intake-schema'

/**
 * 把一則 Slack 提及轉成一份**投遞用的 JSON**。**純函式，不碰網路、不碰磁碟。**
 *
 * ## 為什麼這一層完全是純的
 *
 * 這裡決定的是「使用者會讀到什麼、agent 會讀到什麼」，而那是這條管線的人類閘門所倚賴的等式
 * （見 `docs/lessons/intake.md` 第一節）。把它與取回、水位、交付分開，那條等式才驗得起來 ——
 * 一個要網路的模組沒辦法用單元測試逐位元組比對。
 *
 * ## 上界固定為「被提及的那一則」
 *
 * 輸入的 `thread` 由呼叫端裁切至被提及的那一則為止（含）。**本模組不知道「現在」是什麼時候**
 * —— 它拿不到時鐘，於是「取到現在為止」在這裡表達不出來。
 *
 * 語意上也對：使用者是在那個時間點被交辦的，他需要的是**那時**的上下文。
 *
 * ## 截斷的作用域是所有 authored 欄位，不只本文
 *
 * 收件匣有**兩個**上限（本文 4000、其餘各 200），任一超過即**整則被拒絕**。
 * **Slack 訊息的第一行拿來當標題很容易超過 200** —— 只截本文的話，症狀是某些提及永遠進不了
 * 收件匣，而使用者只看到一則看不懂的拒絕。
 */

/** `<@U012ABCDEF>` 這種提及；`<@U012|name>` 的舊形式一併吃。 */
const MENTION = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g

/** 一則訊息（只取本模組需要的欄位 —— 多餘的欄位刻意不進型別，見 `intake-schema` 的第三組）。 */
export interface SlackMessage {
  /** Slack 的訊息時間戳，同時是它在頻道內的識別碼。 */
  ts: string
  /** 發話者的 user id。 */
  user?: string
  /** 訊息本文（Slack 的原始 `text`，其中的提及仍是 `<@U…>` 形式）。 */
  text?: string
}

export interface MentionInput {
  teamId: string
  channelId: string
  /** 頻道名稱 —— 可變的字串，只用於呈現。 */
  channelName: string
  /** 被提及的那一則訊息。 */
  message: SlackMessage
  /** 討論串內容，**已由呼叫端裁切至 `message` 為止（含）**，依時間排序。 */
  thread: SlackMessage[]
  /** user id → 顯示名稱。查不到的 id 保留其原形。 */
  names: Readonly<Record<string, string>>
}

/** 投遞檔的內容 —— 形狀由 `agent-intake` 的契約決定。 */
export interface IntakeDelivery {
  id: string
  title: string
  body: string
  actor: string
  origin: { kind: 'slack'; id: string; label: string }
}

/**
 * 一則訊息有沒有提及某個 user。
 *
 * **判準是 `<@id>` 的形式，不是顯示名稱的子字串。** 後者會把「訊息裡提到了我的名字」誤判為
 * 「有人 tag 我」，而兩者對使用者是不同的事；顯示名稱也會撞名。
 */
export function mentionsUser(text: string | undefined, selfUserId: string): boolean {
  if (text === undefined) return false
  for (const match of text.matchAll(MENTION)) {
    if (match[1] === selfUserId) return true
  }
  return false
}

/**
 * 一則訊息是否構成一則該被收進來的提及。
 *
 * ## 使用者自己發的**也算**，而那是改過的裁決
 *
 * 第一版排除了它，理由是「他不需要被自己交辦」、而且在訊息裡 tag 自己（做筆記、標記段落）
 * 會變成噪音。**那條理由站不住，因為失效方向是不對稱的：**
 *
 * - 收了而他不想要 ⇒ 收件匣多幾則**他自己造成的**項目，按一下忽略就沒了。
 * - **不收而他想要 ⇒ 他 tag 了自己，什麼都沒發生** —— 而那與「這個功能壞了」在畫面上完全
 *   相同，正是本能力花了一整條 requirement 在對付的那類失效。
 *
 * 而且「tag 自己」是**唯一完全可信、完全刻意**的那一種提及（其他每一則都來自第三方）——
 * 拿 Slack 當待辦捕捉是很常見的用法。
 *
 * > 若 dogfood 之後確認它真的吵，再加一個設定開關會是一個**資訊充分**的決定；
 * > 現在就加是猜。
 */
export function isCapturedMention(message: SlackMessage, selfUserId: string): boolean {
  return mentionsUser(message.text, selfUserId)
}

/**
 * intake 的識別碼。
 *
 * **以被提及的那一則訊息為單位，不是以討論串為單位** —— 同一條討論串裡第二次被 tag 是一件新的
 * 事，thread-scoped 的識別碼會讓它落入收件匣的重複抑制而靜默消失。
 *
 * `teamId` 不可省：頻道 id 跨工作區不保證相異，日後接第二個工作區時碰撞的症狀是
 * **一則真實的工作項目被判為重複而消失**。
 *
 * 字元集已由收件匣的 `ID_CHARSET` 涵蓋（它含 `:` 與 `.`，註解裡就寫著「Slack 的 `C123.1699`
 * 這種識別碼需要它」）。
 */
export function intakeIdOf(input: { teamId: string; channelId: string; ts: string }): string {
  return `slack:${input.teamId}:${input.channelId}:${input.ts}`
}

/** 把 `<@U…>` 換成 `@顯示名稱`；查不到的 id 保留原形（比消失好 —— 讀者至少知道那裡有一個人）。 */
function renderMentions(text: string, names: Readonly<Record<string, string>>): string {
  return text.replace(MENTION, (whole, id: string) => {
    const name = names[id]
    return name === undefined ? whole : `@${name}`
  })
}

/** 發話者的顯示名稱；查不到就用 id（呈現上不理想，但比空字串誠實）。 */
function displayName(userId: string | undefined, names: Readonly<Record<string, string>>): string {
  if (userId === undefined) return ''
  return names[userId] ?? userId
}

/**
 * 依 code point 截斷至 `max` 個 UTF-16 code unit 之內。
 *
 * **尺度必須與收件匣一致**（正規化之後、UTF-16 code unit），否則會在邊界上差幾個字元而
 * 仍然被拒絕。**而切割必須依 code point**：依 code unit 切會把補充平面的字元切成半個
 * surrogate，那是一個無效的字串（收件匣的正規化會把它留下來，因為它的白名單是逐 code point 的）。
 */
export function truncateToCodeUnits(value: string, max: number): string {
  if (value.length <= max) return value
  let out = ''
  for (const ch of value) {
    if (out.length + ch.length > max) break
    out += ch
  }
  return out
}

/**
 * 截斷一個短欄位（標題／發起者／標籤），超長時尾端加上省略記號。
 *
 * 記號**計入上限**（先留位置再截）—— 否則加上記號之後又超過，整則仍會被拒絕。
 */
function truncateField(value: string): string {
  const normalized = normalizeAuthored(value)
  if (normalized.length <= MAX_FIELD_LENGTH) return normalized
  const marker = normalizeAuthored(t('slack.truncatedField'))
  return truncateToCodeUnits(normalized, MAX_FIELD_LENGTH - marker.length) + marker
}

/**
 * 組出本文，超長時**自開頭截去**並在最前面留下說明。
 *
 * 兩件事都是規格條款而不是偏好：
 *
 * - **保留最接近被提及那一則的內容**（尾端）—— 使用者要判斷的是「為什麼 tag 我」，
 *   而答案在最後面。
 * - **截斷發生這件事寫在本文字串之內**。本文是唯一「呈現給使用者的那一份逐字元就是交給 agent
 *   的那一份」的欄位；記號放在別處，**使用者讀到「這裡被截斷了」而 agent 讀不到** ——
 *   兩者對「我看到的是全部嗎」得到相反的答案。
 */
function buildBody(input: MentionInput): string {
  const lines = input.thread.map((message) => {
    const who = displayName(message.user, input.names)
    const text = renderMentions(message.text ?? '', input.names)
    return who === '' ? text : `${who}: ${text}`
  })
  const header = t('slack.bodyHeader', { channel: input.channelName })
  const full = normalizeAuthored([header, '', ...lines].join('\n'))
  if (full.length <= MAX_BODY_LENGTH) return full

  const marker = normalizeAuthored(t('slack.truncatedBody'))
  const budget = MAX_BODY_LENGTH - marker.length - 1
  // **自開頭截去**：留下尾端（最接近被提及的那一則）。
  const tail = [...full].slice(-budget).join('')
  return `${marker}\n${tail}`
}

/** 標題取被提及那一則訊息的第一行（提及已解析成顯示名稱 —— 標題是給人讀的）。 */
function buildTitle(input: MentionInput): string {
  const rendered = renderMentions(input.message.text ?? '', input.names)
  return truncateField(rendered.split('\n')[0] ?? '')
}

/**
 * 把一則提及轉成投遞內容。
 *
 * 回傳值是**投遞檔的完整內容** —— 呼叫端只負責把它寫成 JSON。`origin.kind` 固定為 `slack`；
 * 那是**投遞者自稱的來源**，收件匣不採信它（`adapter` 由接收端決定），寫在這裡只為了讓
 * routing 有一個可比對的欄位。
 */
export function buildDelivery(input: MentionInput): IntakeDelivery {
  return {
    id: intakeIdOf({ teamId: input.teamId, channelId: input.channelId, ts: input.message.ts }),
    title: buildTitle(input),
    body: buildBody(input),
    actor: truncateField(displayName(input.message.user, input.names)),
    origin: {
      kind: 'slack',
      id: input.channelId,
      label: truncateField(input.channelName),
    },
  }
}
