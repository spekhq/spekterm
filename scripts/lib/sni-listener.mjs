/**
 * A TCP listener that records every connection it receives and, for TLS, the host name the client asked
 * for (the SNI in its ClientHello). It never answers: the point is to see that a connection was attempted
 * and for which host — `workspace-app-shell`'s "no connection at startup" check maps every host name to it
 * with `--host-resolver-rules`.
 *
 * It listens on an ephemeral port (`listen(0)`), so it needs no entry in `ports.mjs`, and it must be
 * listening **before** the app is spawned: the spell checker's download was measured at ~0.6 s, before the
 * window appeared.
 */
import { createServer } from 'node:net'

/**
 * The server name from a TLS ClientHello, or `null` when the bytes are not one (or carry no SNI).
 * Layout: record header (5) → handshake header (4) → version (2) + random (32) → session id →
 * cipher suites → compression methods → extensions; extension 0x0000 is server_name.
 */
export function sniOf(bytes) {
  try {
    if (bytes.length < 5 || bytes[0] !== 0x16 || bytes[5] !== 0x01) return null
    let at = 5 + 4 + 2 + 32
    at += 1 + bytes[at] // session id
    at += 2 + bytes.readUInt16BE(at) // cipher suites
    at += 1 + bytes[at] // compression methods
    const end = at + 2 + bytes.readUInt16BE(at)
    at += 2
    while (at + 4 <= end) {
      const type = bytes.readUInt16BE(at)
      const length = bytes.readUInt16BE(at + 2)
      if (type === 0x0000) {
        // server_name_list length (2), name type (1), name length (2), name
        const nameLength = bytes.readUInt16BE(at + 4 + 3)
        return bytes.subarray(at + 4 + 5, at + 4 + 5 + nameLength).toString('ascii')
      }
      at += 4 + length
    }
    return null
  } catch {
    return null
  }
}

/**
 * Start listening on 127.0.0.1. `connections` grows as clients connect; `sni` is filled in once the first
 * bytes arrive (`null` for a connection that sent nothing recognizable).
 *
 * @returns {Promise<{ port: number, connections: { sni: string | null, at: number }[], close: () => Promise<void> }>}
 */
export async function startSniListener() {
  const connections = []
  const sockets = new Set()
  const started = Date.now()
  const server = createServer((socket) => {
    sockets.add(socket)
    const entry = { sni: null, at: Date.now() - started }
    connections.push(entry)
    let buffered = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk])
      entry.sni ??= sniOf(buffered)
    })
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    port: server.address().port,
    connections,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}

/**
 * The Chromium switch that sends every host name except `localhost` to `port`. **One argv element, no
 * quotes**: a quoted value, or `;` between the rules, makes Chromium ignore the rules silently (measured),
 * which is why the check this serves carries a positive control.
 */
export function resolverRulesArg(port) {
  return `--host-resolver-rules=MAP * 127.0.0.1:${port}, EXCLUDE localhost`
}
