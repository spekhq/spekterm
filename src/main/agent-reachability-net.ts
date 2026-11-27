import { net } from 'electron'

import type { ReachabilityRequest } from './agent-reachability'

/**
 * The reachability check's one request (`handoff-waits-for-network`, design D1), through the browser engine's
 * network stack so it follows the system's proxy settings, as the update check does. Its own file so that the network
 * allow-list (`scripts/network-surface.test.mjs`) names exactly this use.
 *
 * **`net.request`, not `net.fetch`**: with `redirect: 'manual'`, `net.fetch` rejects on a redirect ("Redirect was
 * cancelled", measured on Electron 43.8.4), which would read a gateway whose root redirects as unreachable and hold
 * its user's handoffs for good. Here a redirect is an answer: reachable, and it is not followed.
 *
 * No credentials, no cookies, no body. **`close` is not an outcome**: measured on Electron 43.8.4, a `HEAD` emits
 * `close` *before* `response` (and before `error`), so reading it as "unreachable" failed every check. The outcomes are
 * `response` and `redirect` (reachable) and `error` (refused, no DNS: unreachable); a packet dropped on the way emits
 * nothing at all, which is why `checkReachable` races its own timer and calls `abort`, which settles `done` here.
 */
export const sendReachabilityRequest: ReachabilityRequest = (origin) => {
  let settled = false
  let settle: (reachable: boolean) => void = () => {}
  const done = new Promise<boolean>((resolve) => {
    settle = (reachable) => {
      if (settled) return
      settled = true
      resolve(reachable)
    }
  })

  let request: Electron.ClientRequest
  try {
    request = net.request({
      method: 'HEAD',
      url: `${origin}/`,
      redirect: 'manual',
      credentials: 'omit',
      useSessionCookies: false,
      cache: 'no-store',
    })
  } catch {
    settle(false)
    return { done, abort: () => {} }
  }

  const abort = (): void => {
    try {
      request.abort()
    } catch {
      // Already ended.
    }
  }
  request.on('response', (response) => {
    settle(true)
    // A HEAD answer has no body; drain anything so the request can finish, then let it go.
    response.on('data', () => {})
    response.on('error', () => {})
    abort()
  })
  request.on('redirect', () => {
    settle(true)
    abort()
  })
  request.on('error', () => settle(false))
  request.on('abort', () => settle(false))
  request.end()

  return {
    done,
    abort: () => {
      settle(false)
      abort()
    },
  }
}
