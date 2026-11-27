/**
 * A stand-in for the agent's service, for the handoff opener's reachability check (`handoff-waits-for-network`,
 * design D7). The probes that open handoffs point `ANTHROPIC_BASE_URL` at it in the launched app's environment, so
 * the check goes through the product's own path (`agentOrigin` reads the environment an agent session gets) and never
 * reaches the real API — which would make those probes fail on an offline machine.
 *
 * Plain HTTP on an ephemeral port, so it needs no entry in `ports.mjs`. It answers 404 by default (what an
 * unauthenticated request to the real API gets), or a redirect in `redirect` mode; it records every request's
 * method and headers; `stop()` makes it unreachable (connection refused) and `listen()` brings it back on the same
 * port.
 */
import { createServer } from 'node:http'

/**
 * @returns {Promise<{
 *   url: string,
 *   requests: { method: string, headers: Record<string, string | string[] | undefined>, at: number }[],
 *   setMode: (mode: 'answer' | 'redirect') => void,
 *   stop: () => Promise<void>,
 *   listen: () => Promise<void>,
 *   close: () => Promise<void>,
 * }>}
 */
export async function startStubAgentService() {
  const requests = []
  let mode = 'answer'
  const sockets = new Set()
  const server = createServer((req, res) => {
    requests.push({ method: req.method ?? '', headers: { ...req.headers }, at: Date.now() })
    if (mode === 'redirect') {
      res.writeHead(302, { location: 'http://127.0.0.1:9/elsewhere' })
    } else {
      res.writeHead(404, { 'content-type': 'application/json' })
    }
    res.end()
  })
  // Never what keeps a script alive: a run that ends without `process.exit` must not hang on it.
  server.unref()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  let port = 0
  const listen = () =>
    new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject)
        port = server.address().port
        resolve()
      })
    })
  const stop = () =>
    new Promise((resolve) => {
      if (!server.listening) return resolve()
      // Kept-alive connections would keep answering after the listener closes: end them too.
      for (const socket of sockets) socket.destroy()
      server.close(() => resolve())
    })

  await listen()
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    setMode: (next) => {
      mode = next
    },
    stop,
    listen,
    close: stop,
  }
}

/**
 * The launched app's environment, pointed at the stand-in: `ANTHROPIC_BASE_URL` set, and every provider switch
 * removed — a developer's own `CLAUDE_CODE_USE_BEDROCK` would turn the check off and make "does not open" assertions
 * red for a reason unrelated to the product.
 */
export function withStubAgentService(env, service) {
  const next = { ...env, ANTHROPIC_BASE_URL: service.url }
  for (const name of Object.keys(next)) {
    if (name.startsWith('CLAUDE_CODE_USE_')) delete next[name]
  }
  return next
}
