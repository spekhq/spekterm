/**
 * electron-builder `afterPack` hook — macOS only. It runs after the bundle is assembled and **before it is
 * signed** (`platformPackager`: afterPack → fuses → sign), so what it changes is covered by the seal.
 *
 * 1. **Delete `default_app.asar`.** `package-mac.mjs` hands electron-builder a verified zip as
 *    `electronDist`, and that path skips the cleanup the normal download path does. Electron's placeholder
 *    app would ship otherwise. A trial build (`electron-builder --mac dir`) takes the normal path, so the file
 *    may already be gone.
 * 2. **Copy Electron's and Chromium's licence texts into the bundle.** The Electron zip carries `LICENSE` and
 *    `LICENSES.chromium.html` at its root. The AppImage keeps them at its root; for macOS electron-builder
 *    **deletes them** from the output directory before this hook runs (`electronMac.js`, measured: the hook
 *    found neither), so without this the dmg ships neither (`project-license`). `package-mac.mjs` extracts
 *    them from the archive it has just verified and names the directory in `ELECTRON_LICENCES_DIR`.
 *    (`node_modules/electron/dist` is not a source: Electron 43 has no postinstall, so it exists only after
 *    something ran Electron — measured, `npm ci` on the Mac left it absent.)
 *    `LICENSE` is renamed the way the Linux build names it, `LICENSE.electron.txt`, so it cannot be mistaken
 *    for spekterm's own `LICENSE` beside it.
 *
 * CommonJS because `package.json` is `"type": "module"` and electron-builder `require`s the hook.
 */
const { copyFileSync, existsSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const ELECTRON_LICENCES = [
  ['LICENSE', 'LICENSE.electron.txt'],
  ['LICENSES.chromium.html', 'LICENSES.chromium.html'],
]

/**
 * @param {{ appOutDir: string, electronPlatformName: string, appName: string, electronDir: string }} target
 *   `electronDir`: the unpacked Electron distribution the licence texts are copied from
 * @returns {string[]} what was done, for the build log
 */
function prepareBundle({ appOutDir, electronPlatformName, appName, electronDir }) {
  if (electronPlatformName !== 'darwin') return []
  const resources = join(appOutDir, `${appName}.app`, 'Contents', 'Resources')
  const done = []

  const placeholder = join(resources, 'default_app.asar')
  if (existsSync(placeholder)) {
    rmSync(placeholder)
    done.push('removed default_app.asar')
  }

  for (const [from, to] of ELECTRON_LICENCES) {
    const source = join(electronDir, from)
    if (!existsSync(source)) {
      throw new Error(`after-pack: ${from} is missing from the installed Electron (${electronDir}) — it must ship`)
    }
    copyFileSync(source, join(resources, to))
    done.push(`copied ${to}`)
  }
  return done
}

/** Where `package-mac.mjs` put the verified archive's licence texts. A macOS build must go through it. */
function licenceDir(platform) {
  const dir = process.env.ELECTRON_LICENCES_DIR
  if (platform === 'darwin' && !dir) {
    throw new Error(
      'after-pack: ELECTRON_LICENCES_DIR is not set — build the macOS package through `node scripts/package-mac.mjs` ' +
        '(it verifies the Electron archive and extracts its licence texts)',
    )
  }
  return dir ?? ''
}

module.exports = async function afterPack(context) {
  const done = prepareBundle({
    appOutDir: context.appOutDir,
    electronPlatformName: context.electronPlatformName,
    appName: context.packager.appInfo.productFilename,
    electronDir: licenceDir(context.electronPlatformName),
  })
  if (done.length > 0) console.log(`  • after-pack  ${done.join(', ')}`)
}
module.exports.prepareBundle = prepareBundle
