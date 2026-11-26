/**
 * Stands in for the Electron app that `electron-vite dev --rendererOnly` starts.
 *
 * `--rendererOnly` only skips building main and preload: electron-vite 5 still calls
 * `startElectron()` after the dev server listens, and that Electron gets no `--user-data-dir`.
 * It ran the previous build on the developer's real profile (`~/.config/Spekterm`), restored
 * the real workspace, and started every session marked running with the real `claude --resume` —
 * a second live process for each of the developer's conversations, for as long as the probe's
 * dev mode lasted. See `scripts/lib/renderer-dev-server.mjs`.
 *
 * electron-vite spawns `ELECTRON_EXEC_PATH` with `ELECTRON_ENTRY` as its first argument and exits
 * when that child closes, so this script must stay alive until the probe ends the process group.
 */
import { RENDERER_DEV_HOLDER_LINE } from './renderer-dev-server.mjs'

console.log(RENDERER_DEV_HOLDER_LINE)

// The probe ends the whole process group; if it never does (the probe itself was killed),
// do not outlive the dev server that started us.
const parent = process.ppid
setInterval(() => {
  if (process.ppid !== parent) process.exit(0)
}, 1000)
