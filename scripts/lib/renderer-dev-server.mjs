/**
 * The renderer dev server for a probe's dev mode — the only place a probe may start
 * `electron-vite dev` (`scripts/renderer-dev-server-source.test.mjs`).
 *
 * The probe spawns its own Electron (with `--user-data-dir` and `ELECTRON_RENDERER_URL`), so this
 * starts only the renderer's dev server. **`--rendererOnly` does not stop electron-vite from
 * starting an Electron of its own** (electron-vite 5: it skips building main and preload, then
 * calls `startElectron()` anyway). That Electron has no `--user-data-dir`, so it runs on the
 * developer's real profile: it restored the real workspace and started every session marked
 * running with the real `claude --resume` — a second live process for each conversation, writing
 * the same transcripts — and it read the real drop points and team connection, for the whole of
 * the dev mode. Nothing in a probe turned red.
 *
 * electron-vite takes the executable from `ELECTRON_EXEC_PATH` and its first argument from
 * `ELECTRON_ENTRY`, so they point at Node and a holder script that only waits. The holder prints a
 * line, and the dev server is not handed out until that line arrives: if a later electron-vite
 * ignores these variables, the probe fails here instead of starting the real app again.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RENDERER_DEV_HOLDER_LINE = '[renderer-dev-holder] standing in for the Electron of electron-vite dev'

const HOLDER = join(dirname(fileURLToPath(import.meta.url)), 'renderer-dev-holder.mjs')
const READY_TIMEOUT_MS = 90_000

// vite's output is colored. ESC is built with fromCharCode to keep control characters out of regex literals.
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const stripAnsi = (text) => text.replace(ANSI_PATTERN, '')

/** The environment the dev server runs in: electron-vite's own Electron is replaced by the holder. */
export function rendererDevServerEnv(base = process.env) {
  return { ...base, ELECTRON_EXEC_PATH: process.execPath, ELECTRON_ENTRY: HOLDER }
}

/**
 * Start `electron-vite dev --rendererOnly` and resolve with `{ child, url }` once the dev server
 * listens and the holder (not an Electron) has started.
 *
 * `detached: true` makes `npx` a process group leader: npx spawns node, node spawns vite and the
 * holder, and killing npx alone reaches none of them. End it with `process.kill(-child.pid)`.
 */
export async function startRendererDevServer() {
  const child = spawn('npx', ['electron-vite', 'dev', '--rendererOnly'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: rendererDevServerEnv(),
    detached: true,
  })

  const url = await new Promise((resolve, reject) => {
    let output = ''
    let found = null
    const timer = setTimeout(() => {
      const missing = found ? 'the holder never started (did electron-vite start an Electron instead?)' : 'no Local: URL'
      reject(new Error(`renderer dev server not ready: ${missing}\n${output.slice(-1500)}`))
    }, READY_TIMEOUT_MS)
    const onData = (chunk) => {
      output += stripAnsi(String(chunk))
      found ??= output.match(/Local:\s+(http:\/\/[^\s/]+\/?)/)?.[1]?.replace(/\/$/, '') ?? null
      if (found && output.includes(RENDERER_DEV_HOLDER_LINE)) {
        clearTimeout(timer)
        resolve(found)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      reject(new Error(`renderer dev server exited before it was ready (${code ?? signal})\n${output.slice(-1500)}`))
    })
  })

  return { child, url }
}
