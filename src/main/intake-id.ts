/**
 * 識別碼的驗證，與它到落盤檔名的編碼。
 *
 * ## 驗證是三段，而三段各自擋不同的東西
 *
 * 1. **字元集白名單** —— 有哪些字。
 * 2. **整串否決**（`.`、`..`、空字串）—— 整串是什麼。
 * 3. **長度上限** —— 編碼之後的檔名要在所有目標平台上合法。
 *
 * **第二段不是多餘的**：字元集白名單含點號（Slack 的 `C123.1699` 這種識別碼需要它），
 * 而含點號的白名單**會放行 `..`**。「有哪些字」管不到「整串是什麼」。
 *
 * ## 檔名為什麼是 hex，而不是雜湊、也不是原文
 *
 * - **不用原文**：檔案系統對大小寫的處理因平台而異（macOS APFS 不敏感），兩個在收件匣中
 *   相異的識別碼會落到磁碟上**同一個檔案** ⇒ 使用者審 A 的標題、agent 讀 B 的內容。
 * - **不用雜湊截斷**：識別碼是**投遞者挑的**，對一個截斷過的雜湊找碰撞是可行的 ——
 *   那會把上一行要防的失效原封不動地重新打開。
 * - 讓這條性質成立的是**輸出字母表**（只有 `0-9a-f`：沒有大小寫變體、沒有結合字元），
 *   而 hex 是注入式的：零碰撞，且檔名可逆回識別碼（診斷時看得懂）。
 *
 * **編碼消費的是 UTF-8 位元組，且編碼之前不得施加任何 Unicode 正規化** —— 一次出於好意的
 * `.normalize()` 會把兩個相異的識別碼映到同一個檔名，正是這裡要防的那件事，
 * 而它會通過「輸出字母表」與「可逆」兩項檢查。
 *
 * > **本 repo 從未自己算過雜湊**（`src/` 只有 `randomUUID`；`worktree-key.ts` 只做格式驗證，
 * > sha1 在 core）。這裡也不需要引入。
 *
 * ## 字元集是 ASCII-only，而那讓其中一種危害變成結構上不可達
 *
 * 白名單不含非 ASCII，於是 **NFC／NFD 變體在這裡表達不出來** —— 上面那條「正規化不敏感」的
 * 危害目前只有**大小寫**那一半是可達的。規則仍然寫著，因為字元集日後若放寬，另一半就回來了，
 * 而那時沒有任何東西會提醒你。
 */

/** 字元集白名單。含點號是必要的（Slack 的 `C123.1699`），因此第二段的整串否決不可省。 */
const ID_CHARSET = /^[A-Za-z0-9._:@+-]+$/

/**
 * 識別碼的 UTF-8 位元組上限。
 *
 * 由**編碼後的檔名**反推：hex 使長度加倍，再加上 `.json` 五個字元，要留在 `NAME_MAX`（多數
 * 檔案系統為 255 位元組）之內 ⇒ `120 * 2 + 5 = 245`。**直接把上限訂在識別碼上是錯的尺度。**
 */
export const MAX_ID_BYTES = 120

/** 整串否決 —— 它們全都通得過字元集白名單。 */
const DENIED_WHOLE = new Set(['.', '..'])

export function isValidIntakeId(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false
  if (!ID_CHARSET.test(value)) return false
  if (DENIED_WHOLE.has(value)) return false
  return Buffer.byteLength(value, 'utf8') <= MAX_ID_BYTES
}

/**
 * 識別碼 → 落盤檔名的主幹。呼叫端自行接上副檔名。
 *
 * **呼叫端必須先通過 `isValidIntakeId`** —— 這裡不重複驗證，但它也不需要：hex 的輸出恆為
 * `[0-9a-f]*`，因此即使被誤用也產不出路徑片段。長度則由上面的上限保證。
 */
export function intakeFileStem(id: string): string {
  return Buffer.from(id, 'utf8').toString('hex')
}

/** 反解，供診斷用。格式不合時回 `null`。 */
export function intakeIdFromStem(stem: string): string | null {
  if (!/^(?:[0-9a-f]{2})+$/.test(stem)) return null
  return Buffer.from(stem, 'hex').toString('utf8')
}
