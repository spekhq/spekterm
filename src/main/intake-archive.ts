import fs from 'node:fs'
import { constants } from 'node:fs'
import path from 'node:path'

import { openNoFollow, resolveNewWithin } from './fs-boundary'
import { intakeFileStem, isValidIntakeId } from './intake-id'

/**
 * 原始投遞的保存處 —— **本 repo 唯一碰得到「來源專屬原始內容」的模組**。
 *
 * ## 為什麼要把它關在一個模組裡
 *
 * `parseIntake()` 的回傳型別沒有原始內容，於是「依 Slack 的 channel 判斷」在型別上表達不出來。
 * 但型別擋不住「有人改了型別」—— 因此 `scripts/intake-raw-source.test.mjs` 釘住了
 * 「`readDelivery` 只能被本模組與測試引用」。**兩層合起來才是結構保證。**
 *
 * 原始內容保存下來是為了日後診斷與 Slack adapter，**它不進呈現、不進判斷、也不進 agent 的
 * 脈絡** —— 交付一份使用者沒看過的文字，等同讓投遞者在被審閱的內容之外另開一條通道。
 *
 * ## 寫入為什麼不能用 rename
 *
 * 最省事的實作是把投遞檔 `rename` 進保存處。**那會讓下面整套邊界約束一個位元組都碰不到** ——
 * `rename(2)` 不經 `open`，於是 `O_NOFOLLOW` 沒有機會生效，而保存處會留下一個投遞者放置的
 * symlink；其後「由保存的投遞產生內容」就會讀到那個 link 的目標。
 *
 * 因此：**寫入已在記憶體裡、且已經驗證過的位元組**，寫成之後才刪除投遞檔。
 *
 * ## 這是本 repo 第一個走出 workspace 作用域的邊界寫入
 *
 * `fs-boundary` 的那套守衛，其 root 一路都是 workspace folder；userData 之下既有的寫入
 * （`writePreferencesFileAtomic`）是裸的 `writeFileSync` + `rename`，**安全只因為檔名是常數**。
 * 這裡的檔名由不受信任的輸入推導，所以必須借用同一套解析與 `O_NOFOLLOW`：
 *
 * - `resolveNewWithin` 解析**中間段**（以父目錄的 realpath 組路徑）—— 擋中間目錄是 symlink。
 * - `openNoFollow` 拒絕跟隨**最後一段** —— 擋 leaf 是 symlink。
 *
 * **兩者各擋一半，缺一不可**，而它們的對照組也不同：把寫入改成 `rename` 只會讓「中間目錄」
 * 那條變紅（`rename(2)` 不跟隨最後一段，它把那個 link 本身換掉）；「leaf」那條的對照組是
 * 把 `openNoFollow` 換成普通的 `open`。
 */

/** 保存處的根目錄。呼叫端於啟動時指定一次。 */
export function deliveryRoot(userDataPath: string): string {
  return path.join(userDataPath, 'intake')
}

export async function ensureDeliveryRoot(root: string): Promise<void> {
  await fs.promises.mkdir(root, { recursive: true })
}

/**
 * 保存一份原始投遞。內容是**呼叫端已驗證過的位元組**，不是一個路徑。
 *
 * 既有的同名保存會被覆寫（內容過期後重新投遞同一識別碼時會走到這裡）；
 * 但 `O_NOFOLLOW` 使「覆寫」永遠不會穿過一個 symlink。
 */
export async function saveDelivery(root: string, id: string, contents: string): Promise<void> {
  if (!isValidIntakeId(id)) throw new Error('invalid intake id')
  const target = await resolveNewWithin(root, `${intakeFileStem(id)}.json`)
  const handle = await openNoFollow(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC,
  )
  try {
    await handle.writeFile(contents, 'utf8')
  } finally {
    await handle.close()
  }
}

/**
 * 讀回一份原始投遞。
 *
 * **這個函式是那道原始碼守衛的對象** —— 產品程式碼中除了本模組之外，不得有任何地方引用它。
 * 它的用途是診斷與日後的 adapter，不是「給收件匣以內的東西讀 raw」的後門。
 */
export async function readDelivery(root: string, id: string): Promise<string | null> {
  if (!isValidIntakeId(id)) return null
  const target = path.join(root, `${intakeFileStem(id)}.json`)
  try {
    return await fs.promises.readFile(target, 'utf8')
  } catch {
    return null
  }
}

/** 內容過期時移除保存的投遞。**去重鍵不在這裡，它留在狀態 index。** */
export async function forgetDelivery(root: string, id: string): Promise<void> {
  if (!isValidIntakeId(id)) return
  const target = path.join(root, `${intakeFileStem(id)}.json`)
  await fs.promises.rm(target, { force: true })
}
