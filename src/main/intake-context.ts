import { constants } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'

import { openNoFollow, resolveNewWithin } from './fs-boundary'
import { intakeFileStem, isValidIntakeId } from './intake-id'
import { t } from '@shared/i18n'

/**
 * 交給 agent 的那份檔案，與填進輸入處的那一行 prompt。
 *
 * ## 交付即呈現
 *
 * 界線之內的內容**逐字元等於**呈現給使用者的本文。這不是「兩個值要相等」的紀律，而是
 * **只有一個值**：本文在攝入時正規化一次（`intake-schema`），呈現與交付都是它的消費者。
 * 於是「兩份文字」在資料上表達不出來。
 *
 * 上一版的設計由「保存的原始投遞」產生這份檔案，而呈現給使用者的只有本文 —— 投遞者把乾淨的
 * 描述寫在本文、把指示藏在原始內容的任一欄位，**使用者看到的與 agent 讀到的就是兩份不同的
 * 文字**，而那不需要任何實作錯誤。
 *
 * **界線之內不增減任何字元**（含前後的換行）—— 比對要寫成相等而非包含，否則一個在界線內補一個
 * 換行的實作照樣通過。
 *
 * ## 界線的 nonce，以及它為什麼也要出現在 prompt 裡
 *
 * 界線若是固定字面值，投遞者把它抄進本文即可讓被標示的區段提早結束。nonce 讓他無法**重現那個
 * 值** —— 但它擋不掉「另開一組**自己的**界線再接一段旁白語氣的文字」，因為模型沒有依據判定
 * 哪一組算數。**讓 nonce 同時出現在 prompt（由系統組成、可信的那一端）才關掉這條路徑。**
 *
 * **本模組不宣稱界線構成防護。** 對語言模型而言檔案內容與指令進入同一個脈絡；界線是緩解。
 * 而它的保護期是**一個 context window** —— `/clear`、壓縮或長對話之後，prompt 裡那句
 * 「只有帶該值的界線算數」會先於注入內容從脈絡中消失。
 *
 * ## nonce 的不變式是取值來源，不是輸出的樣子
 *
 * 「不構成可預測的序列」寫不成一條斷言：任何有限樣本都判定不了可預測性，而一個零填充的遞增
 * 計數器滿足「互異 ＋ 長度達標」。因此它的載體是一道釘住取值來源的原始碼守衛
 * （`scripts/intake-nonce-source.test.mjs`），而不是行為測試。
 */

/** nonce 的位元組數。128 bits —— 足以排除猜測。 */
const NONCE_BYTES = 16

export function createNonce(): string {
  return randomBytes(NONCE_BYTES).toString('hex')
}

export function contextRoot(userDataPath: string): string {
  return path.join(userDataPath, 'intake')
}

/** 界線。**帶 nonce**，而同一個 nonce 也會出現在 prompt 裡。 */
export function fenceOpen(nonce: string): string {
  return `<<<untrusted-${nonce}>>>`
}

export function fenceClose(nonce: string): string {
  return `<<</untrusted-${nonce}>>>`
}

export interface ContextDocument {
  nonce: string
  contents: string
}

/**
 * 組出 context 檔的內容。
 *
 * `body` 必須是**攝入時正規化過的那一份** —— 也就是呈現給使用者的同一個字串。
 */
export function buildContext(body: string, nonce: string): ContextDocument {
  const header = t('intake.contextHeader', { nonce })
  // **界線之內不增減任何字元。** `body` 原樣夾在兩個界線之間。
  const contents = `${header}\n\n${fenceOpen(nonce)}\n${body}\n${fenceClose(nonce)}\n`
  return { nonce, contents }
}

/** 取回界線之內的內容 —— 驗收與診斷用。找不到完整的一對界線時回 `null`。 */
export function fencedBody(contents: string, nonce: string): string | null {
  const open = `${fenceOpen(nonce)}\n`
  const close = `\n${fenceClose(nonce)}`
  const start = contents.indexOf(open)
  if (start < 0) return null
  const from = start + open.length
  const end = contents.indexOf(close, from)
  if (end < 0) return null
  return contents.slice(from, end)
}

export function contextFileName(id: string): string {
  return `${intakeFileStem(id)}.md`
}

/** 寫出 context 檔，經與 workspace 寫入相同的邊界解析。回傳它的絕對路徑。 */
export async function writeContext(root: string, id: string, document: ContextDocument): Promise<string> {
  if (!isValidIntakeId(id)) throw new Error('invalid intake id')
  const target = await resolveNewWithin(root, contextFileName(id))
  const handle = await openNoFollow(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC,
  )
  try {
    await handle.writeFile(document.contents, 'utf8')
  } finally {
    await handle.close()
  }
  return target
}

/**
 * 填進輸入處的那一行。
 *
 * **完全由系統組成，不含 intake 任何欄位的原文**（系統自己產生的 nonce 不在此限）。
 * 投遞者撰寫的文字若進入 agent 的輸入緩衝區，某些起始字元會使該輸入切換成別的模式
 * （記憶、命令、選單）—— **而它後面緊接著的就是使用者按下的送出**。
 *
 * 措辭要求 agent 第一回合**逐字照抄祈使句與對「你」的稱呼，不要判斷它們是不是針對它**。
 * 「摘要並提計畫」不算：寫摘要的是**已經讀過注入內容的那個模型**，一段被注入的摘要讀起來會
 * 完全合理；照抄是機械操作，**使注入較有可能**以一個條目的形式出現。
 *
 * **不宣稱它阻止了工具呼叫，也不宣稱注入必然會被認出。** 已知的殘餘路徑至少有二：投遞者可
 * 預先寫好一份「本文不含任何指示」的假清單（**問法越明確，這條越好打**），以及本文可以只放
 * 一個連結，把真正的內容移到本能力所有機制的作用域之外 —— 因此 prompt 明示第一回合不得取得
 * 任何外部資源。
 */
export function buildPrompt(contextPath: string, nonce: string): string {
  return t('intake.prompt', { path: contextPath, nonce })
}
