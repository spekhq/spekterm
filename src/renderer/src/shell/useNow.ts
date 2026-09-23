import { useEffect, useState } from 'react'

/**
 * 相對時間會過期。元件掛載的期間，每 `intervalMs` 讓它重算一次。
 *
 * 此前住在 `FilesPanel.tsx` 裡；收件匣的到達時間（`intake-inbox-usability`）要同一件事 ——
 * 停在打開那一刻的「剛剛」會讓兩則相隔一小時的項目看起來同時到達。
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
