/**
 * Can the agent's service be reached right now? (`scheduled-handoff`, "An automatic opening waits until the agent's
 * service can be reached"; change `handoff-waits-for-network`, design D1–D2.)
 *
 * The handoff opener asks this before opening anything automatically, so that a computer that woke from sleep before
 * its Wi-Fi came back, or one away from any network, does not open sessions whose agents cannot run — the opening is
 * final ("at most once, ever").
 *
 * **A request, not the system's online flag.** The flag counts any interface that is up and addressed; a VPN's
 * (Tailscale's `tailscale0`) stays so while the computer is offline. The request goes to the origin the agent itself
 * will call, and **any HTTP answer counts as reachable**: a 404 or a 401 proves DNS, routing and TLS work, which is
 * what an offline laptop lacks. Whether the account works is the agent's to report.
 *
 * Electron-free: the one `net.request` lives in `agent-reachability-net.ts`, the file the network allow-list names.
 */

/** A request that answers "reachable" or not, and can be abandoned. `done` never rejects. */
export interface ReachabilityAttempt {
  done: Promise<boolean>
  abort: () => void
}

export type ReachabilityRequest = (origin: string) => ReachabilityAttempt

/** How long one check may take before it counts as unreachable. */
export const REACHABILITY_TIMEOUT_MS = 5_000

/** The origin used when the environment names none. */
export const ANTHROPIC_API_ORIGIN = 'https://api.anthropic.com'

/**
 * Providers whose endpoint spekterm does not derive (regional, configured by the provider's own variables). With one
 * selected there is no check: guessing an endpoint could hold the user's work for good.
 */
const OTHER_PROVIDER_SWITCHES = ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']

/**
 * Values that leave a provider switch off. Claude Code's own rule is not verified here; a value misjudged as "on"
 * only skips the check, which is the behavior before this change.
 */
const OFF_VALUES = new Set(['', '0', 'false', 'no', 'off'])

/**
 * The origin to check, or `null` for "no check applies" (design D2): the check is turned off, another provider is
 * selected, or `ANTHROPIC_BASE_URL` is set to something that is not an `http:` / `https:` URL.
 *
 * `env` is the environment an agent session is started with (`ptyEnv()`), so the check targets what the agent calls.
 */
export function agentOrigin(env: Readonly<Record<string, string | undefined>>, enabled: boolean): string | null {
  if (!enabled) return null
  for (const name of OTHER_PROVIDER_SWITCHES) {
    const value = env[name]
    if (value !== undefined && !OFF_VALUES.has(value.trim().toLowerCase())) return null
  }
  const base = env.ANTHROPIC_BASE_URL?.trim()
  if (base === undefined || base === '') return ANTHROPIC_API_ORIGIN
  try {
    const url = new URL(base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
  } catch {
    return null
  }
}

/**
 * One check: `send` raced against this function's own timer, so a request that never settles cannot hold the opener.
 * The request is abandoned when the timer wins. Never throws, never rejects.
 */
export async function checkReachable(origin: string, send: ReachabilityRequest, timeoutMs: number): Promise<boolean> {
  let attempt: ReachabilityAttempt
  try {
    attempt = send(origin)
  } catch (error) {
    console.warn(`[handoff] the reachability check could not start: ${String(error)}`)
    return false
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  try {
    const reachable = await Promise.race([attempt.done.catch(() => false), timedOut])
    if (!reachable) abortQuietly(attempt)
    return reachable
  } finally {
    clearTimeout(timer)
  }
}

function abortQuietly(attempt: ReachabilityAttempt): void {
  try {
    attempt.abort()
  } catch {
    // An attempt that already ended may refuse an abort; nothing is left to stop.
  }
}
