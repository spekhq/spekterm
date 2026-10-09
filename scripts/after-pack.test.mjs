/**
 * The `afterPack` hook (`scripts/after-pack.cjs`): `desktop-packaging` "No placeholder application ships" and
 * `project-license`'s Electron and Chromium licence texts in the macOS bundle.
 *
 * Unit level only: whether the hook really runs before signing, and whether the copied files end up sealed,
 * is the macOS packaging probe's to show.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const { prepareBundle } = createRequire(import.meta.url)('./after-pack.cjs')

/**
 * An output directory with the app bundle in it, and an installed Electron distribution beside it — the
 * packager has already deleted the zip's licence files from the output directory when the hook runs.
 */
function makeOutDir({ placeholder = true, licences = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'spekterm-afterpack-'))
  const appOutDir = join(root, 'out')
  const electronDir = join(root, 'electron-dist')
  const resources = join(appOutDir, 'Spekterm.app', 'Contents', 'Resources')
  mkdirSync(resources, { recursive: true })
  mkdirSync(electronDir, { recursive: true })
  if (placeholder) writeFileSync(join(resources, 'default_app.asar'), 'placeholder')
  if (licences) {
    writeFileSync(join(electronDir, 'LICENSE'), 'electron licence')
    writeFileSync(join(electronDir, 'LICENSES.chromium.html'), '<html>chromium</html>')
  }
  return { appOutDir, electronDir, resources, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('macOS: the placeholder app is removed and both licence texts are copied in', () => {
  const { appOutDir, electronDir, resources, cleanup } = makeOutDir()
  try {
    prepareBundle({ appOutDir, electronPlatformName: 'darwin', appName: 'Spekterm', electronDir })
    assert.equal(existsSync(join(resources, 'default_app.asar')), false)
    assert.equal(readFileSync(join(resources, 'LICENSE.electron.txt'), 'utf8'), 'electron licence')
    assert.equal(readFileSync(join(resources, 'LICENSES.chromium.html'), 'utf8'), '<html>chromium</html>')
  } finally {
    cleanup()
  }
})

test('macOS: an absent placeholder is tolerated (a trial build already removed it)', () => {
  const { appOutDir, electronDir, resources, cleanup } = makeOutDir({ placeholder: false })
  try {
    prepareBundle({ appOutDir, electronPlatformName: 'darwin', appName: 'Spekterm', electronDir })
    assert.ok(existsSync(join(resources, 'LICENSE.electron.txt')))
  } finally {
    cleanup()
  }
})

test('macOS: a missing Electron licence fails the build instead of shipping without it', () => {
  const { appOutDir, electronDir, cleanup } = makeOutDir({ licences: false })
  try {
    assert.throws(
      () => prepareBundle({ appOutDir, electronPlatformName: 'darwin', appName: 'Spekterm', electronDir }),
      /LICENSE is missing/,
    )
  } finally {
    cleanup()
  }
})

test('Linux: the hook changes nothing', () => {
  const { appOutDir, electronDir, resources, cleanup } = makeOutDir()
  try {
    assert.deepEqual(prepareBundle({ appOutDir, electronPlatformName: 'linux', appName: 'Spekterm', electronDir }), [])
    assert.ok(existsSync(join(resources, 'default_app.asar')))
    assert.equal(existsSync(join(resources, 'LICENSE.electron.txt')), false)
  } finally {
    cleanup()
  }
})
