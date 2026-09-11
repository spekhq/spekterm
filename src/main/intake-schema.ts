/**
 * 一則 intake 的欄位分組與解析。
 *
 * ## 三組欄位，而分組落在型別上
 *
 * - **`verified`** —— 接收 adapter 從自己已驗證的 metadata 填入（adapter、來源種類與座標識別碼）。
 * - **`authored`** —— 投遞者逐字撰寫（標題、本文、發起者、座標標籤）。
 * - **來源專屬的原始內容** —— **不在本模組的任何型別裡**。
 *
 * 前兩組的區分不是文件上的分類，而是承重的：routing 拿哪一組當判準，決定的是「投遞者能不能
 * 自己選 session 開在哪個 repo」。以 `authored` 為判準的規則，等於讓他挑許可姿態最寬的那一個。
 *
 * ## 第三組為什麼連型別都沒有
 *
 * `parseIntake()` 的回傳值**沒有原始內容的欄位** —— 於是「依 Slack 的 channel 判斷」在型別上
 * 表達不出來，而不是靠一條「請不要讀它」的紀律。原始內容仍會被原封保存（供日後診斷與 Slack
 * adapter 使用），但那條路徑不經過這裡。
 *
 * **它也不會被交給 agent。** 上一版的設計由「保存的原始投遞」產生交給 agent 的檔案，而呈現給
 * 使用者的只有本文 —— 投遞者只要把乾淨的描述寫在本文、把指示藏在原始內容的任一欄位，
 * 使用者看到的與 agent 讀到的就是兩份不同的文字，**而型別守衛反而保證了沒有任何模組會呈現它**。
 *
 * ## 正規化在這裡發生，而且只發生一次
 *
 * 所有第三方可控的字串在攝入時被正規化，其結果即該字串**唯一的**表示；呈現與交付都是它的
 * 消費者。**位置是承重的**：若正規化發生在呈現層（那是最自然的位置，它讀起來就是一個渲染
 * 關切），交付的就是未正規化的原字串，兩者恰好差在一組看不見的字元上 ——「交給 agent 的內容
 * 逐字元等於呈現給使用者的內容」會在建構上不成立，而一個在主行程比對兩個純函式的單元測試
 * **永遠看不見它**（呈現那一端根本不在場）。
 *
 * 正規化是**白名單**（只保留可列印字元與換行），與識別碼的字元集同一條理由：
 * 「排除控制字元與雙向覆寫字元」是一個列舉不完的集合（C0、C1、bidi、零寬、行分隔、tag 字元…），
 * 漏掉任何一段都不會有東西變紅。既有的正確形式見 `preferences-store` 的 `sanitizeFamily`。
 */

/** 呈現與交付共用的長度上限。**訂在「一個人會實際讀完」的量級，不是技術極限。** */
export const MAX_BODY_LENGTH = 4000

/** 其餘 authored 欄位的長度上限。 */
export const MAX_FIELD_LENGTH = 200

/** 接收端可驗證的欄位 —— 由 adapter 填入，投遞者控制不到。 */
export interface IntakeVerified {
  /** 由**接收端**決定，不採信投遞內容自稱的來源。 */
  adapter: string
  /** 來源種類（`slack` / `github` / …）。**不是列舉** —— 不認得的值仍須放行。 */
  originKind: string
  /** 來源座標的識別碼（Slack 的 channel id、GitHub 的 repo…）。 */
  originId: string
}

/** 第三方逐字撰寫的欄位 —— 投遞者完全控制其內容。 */
export interface IntakeAuthored {
  title: string
  body: string
  actor: string
  /** 來源座標的**標籤**（channel 名稱之類）—— 與 `originId` 不同，這是可變的字串。 */
  originLabel: string
}

export interface Intake {
  id: string
  verified: IntakeVerified
  authored: IntakeAuthored
  receivedAt: number
}

export type IntakeRejection =
  | 'MALFORMED'
  | 'MISSING_ID'
  | 'INVALID_ID'
  | 'FIELD_TYPE'
  | 'TOO_LONG'
  | 'TOO_LARGE'
  | 'DUPLICATE'
  | 'CAPACITY'

export interface ParseFailure {
  ok: false
  code: IntakeRejection
  /** 給人看的細節。**不含投遞的原文** —— 它尚未經過正規化。 */
  detail?: string
}

export type ParseResult = { ok: true; value: Intake } | ParseFailure

/**
 * 正規化一個第三方可控的字串：**白名單**，只保留可列印字元與換行。
 *
 * 判準以 code point 為單位（`for…of` 走的是 code point，不是 UTF-16 code unit），於是
 * 補充平面的字元不會被拆成兩個 surrogate 而其中一個被誤判。
 */
export function normalizeAuthored(value: string): string {
  let out = ''
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0
    if (ch === '\n') {
      out += ch
      continue
    }
    // C0（含 DEL）與 C1 一律移除。
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) continue
    // 雙向控制、零寬、行/段分隔、BOM、以及 tag 字元（隱形文字注入最常用的一段）。
    if (cp >= 0x200b && cp <= 0x200f) continue
    if (cp >= 0x2028 && cp <= 0x202e) continue
    if (cp >= 0x2060 && cp <= 0x2064) continue
    if (cp >= 0x2066 && cp <= 0x2069) continue
    if (cp === 0xfeff) continue
    if (cp >= 0xe0000 && cp <= 0xe007f) continue
    out += ch
  }
  return out
}

/**
 * 取得本文 —— **唯一的 accessor**。
 *
 * 「呈現的那份就是交付的那份」是這條管線人類閘門的另一半，而它最自然的失效方式是
 * **兩端各自取值**。把取用收斂成一個入口，配上 `scripts/intake-context-source.test.mjs`
 * 的守衛（`.authored.body` 只能出現在本模組），就把那條紀律換成了結構。
 *
 * 兩個承重的呼叫點是**送往 renderer 的投影**與**寫出 context 檔** —— 它們必須是同一個字串。
 * routing 的比對也走這裡（它讀的是同一份內容，沒有理由另開一條路）。
 */
export function bodyOf(intake: Intake): string {
  return intake.authored.body
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' ? value : null
}

/**
 * 把一份投遞的 JSON 解析成一則 intake。
 *
 * `adapter` 由**呼叫端**供應（接收端決定），payload 裡自稱的來源一律不採信。
 * 回傳值不含原始內容 —— 那由呼叫端另行保存。
 */
export function parseIntake(raw: unknown, adapter: string): ParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, code: 'MALFORMED', detail: 'payload is not an object' }
  }
  const source = raw as Record<string, unknown>

  const id = readString(source, 'id')
  if (id === null || id === '') return { ok: false, code: 'MISSING_ID' }

  const origin = source.origin
  if (typeof origin !== 'object' || origin === null || Array.isArray(origin)) {
    return { ok: false, code: 'FIELD_TYPE', detail: 'origin' }
  }
  const originFields = origin as Record<string, unknown>

  // **`originKind` 不以列舉白名單判定。** 一個不認得的來源種類仍須放行 —— 否則新增一種來源
  // 就要改這裡，而 D3 的「新增來源不改收件匣以內任何判斷」即失效。
  const originKind = readString(originFields, 'kind')
  const originId = readString(originFields, 'id')
  if (originKind === null || originId === null) {
    return { ok: false, code: 'FIELD_TYPE', detail: 'origin.kind / origin.id' }
  }

  const body = readString(source, 'body')
  if (body === null) return { ok: false, code: 'FIELD_TYPE', detail: 'body' }

  const title = readString(source, 'title') ?? ''
  const actor = readString(source, 'actor') ?? ''
  const originLabel = readString(originFields, 'label') ?? ''

  const authored: IntakeAuthored = {
    title: normalizeAuthored(title),
    body: normalizeAuthored(body),
    actor: normalizeAuthored(actor),
    originLabel: normalizeAuthored(originLabel),
  }

  // **長度以正規化之後判定。** 以原文判定的話，一串被剝掉的不可見字元可以把一則合法的投遞
  // 推過上限，而使用者看到的內容其實很短。
  if (authored.body.length > MAX_BODY_LENGTH) {
    return { ok: false, code: 'TOO_LONG', detail: 'body' }
  }
  for (const [key, value] of Object.entries(authored)) {
    if (key !== 'body' && value.length > MAX_FIELD_LENGTH) {
      return { ok: false, code: 'TOO_LONG', detail: key }
    }
  }

  return {
    ok: true,
    value: {
      id,
      verified: { adapter, originKind: normalizeAuthored(originKind), originId },
      authored,
      receivedAt: Date.now(),
    },
  }
}
