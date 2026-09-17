import { INTRO_COMMAND, INTRO_ENV, OUTBOX_ENV, writeIntroFile } from './handoff-intro'
import { introFile, outboxDir, prepareOutbox } from './handoff-outbox'
import type { InjectionContribution } from './agent-injection'
import type { WorkspaceFolder } from './workspace-store'

export type FolderList = readonly Pick<WorkspaceFolder, 'name' | 'path'>[]

/**
 * 交接的注入貢獻。回傳 `null` ＝ 不參與（偏好關閉、或落點建不起來）。
 *
 * **它與事件橋接同時貢獻 `SessionStart`，而那是刻意的** —— 實測（2026-09-17、CLI 2.1.274）
 * 同一個事件上的多條命令都會被執行，且每一條的 stdout 都進入脈絡。合成器負責把兩者串接
 * （`agent-injection` 的 `HookContribution`）；**它若逐鍵覆蓋，第二條根本不會出現在送出去的
 * 設定裡，CLI 沒有機會執行一條它沒收到的命令。**
 *
 * **自我介紹寫不出來時仍然注入**：hook 命令會 `cat` 一個不存在的檔案 ⇒ 非零碼 ⇒ 沒有自我介紹，
 * 而 session 照常。反過來把整份貢獻收掉也可以，但那會讓「落點存在卻沒人被告知」與「落點不存在」
 * 混成同一種狀態。
 */
export function prepareHandoffInjection(
  sessionId: string,
  enabled: boolean,
  folders: FolderList,
): InjectionContribution | null {
  if (!enabled) return null
  const outbox = prepareOutbox(sessionId)
  if (!outbox) return null

  writeIntroFile(introFile(sessionId), { folders, outbox })

  return {
    settings: {},
    hooks: { SessionStart: [INTRO_COMMAND] },
    env: { [INTRO_ENV]: introFile(sessionId), [OUTBOX_ENV]: outbox },
  }
}

/**
 * workspace 的 folder 清單變動時，重寫每一個活著的 session 的自我介紹。
 *
 * **少了這個，「清單取當下的值」只在 spawn 那一刻成立** —— 而 hook 會在續接、壓縮、清除時
 * 重跑，那些時刻讀到的就是一份過期的清單。失效方式是靜默的：agent 交接給一個剛被移除的 repo，
 * 得到一次它看不到的拒絕。
 */
export function refreshIntros(sessionIds: readonly string[], folders: FolderList): void {
  for (const sessionId of sessionIds) {
    const outbox = outboxDir(sessionId)
    if (!outbox) continue
    writeIntroFile(introFile(sessionId), { folders, outbox })
  }
}
