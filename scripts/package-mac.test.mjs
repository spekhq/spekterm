/**
 * desktop-packaging: "The Electron binary in a macOS artifact matches a pinned checksum"
 * (`scripts/package-mac.mjs`).
 *
 * **The real `downloadArtifact` runs** — only its downloader and its cache directory are injected. Replacing
 * `downloadArtifact` itself would test a stand-in of our own making and leave the comparison that matters
 * unexecuted.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { archiveName, fetchElectronZip, pinnedElectron } from './package-mac.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION = '43.5.0'
const CONTENT = 'not really electron'
const sha256 = (text) => createHash('sha256').update(text).digest('hex')

/** A downloader that serves the fixture content and records the URLs it was asked for. */
function fixtureDownloader() {
  const urls = []
  return {
    urls,
    async download(url, target) {
      urls.push(url)
      writeFileSync(target, CONTENT)
    },
  }
}

function withCache(fn) {
  const cacheRoot = mkdtempSync(join(tmpdir(), 'spekterm-electron-cache-'))
  return fn(cacheRoot).finally(() => rmSync(cacheRoot, { recursive: true, force: true }))
}

test('an archive matching the pinned checksum is accepted', () =>
  withCache(async (cacheRoot) => {
    const downloader = fixtureDownloader()
    const zip = await fetchElectronZip({
      version: VERSION,
      checksums: { [archiveName(VERSION)]: sha256(CONTENT) },
      downloader,
      cacheRoot,
    })
    assert.equal(readFileSync(zip, 'utf8'), CONTENT)
    assert.equal(downloader.urls.length, 1)
    assert.match(downloader.urls[0], /electron-v43\.5\.0-darwin-arm64\.zip$/)
  }))

test('an archive not matching the pinned checksum is refused', () =>
  withCache(async (cacheRoot) => {
    await assert.rejects(
      fetchElectronZip({
        version: VERSION,
        checksums: { [archiveName(VERSION)]: sha256('something else') },
        downloader: fixtureDownloader(),
        cacheRoot,
      }),
      /checksum/i,
    )
  }))

test('a missing checksum entry is refused before any download', () =>
  withCache(async (cacheRoot) => {
    const downloader = fixtureDownloader()
    await assert.rejects(
      fetchElectronZip({ version: VERSION, checksums: {}, downloader, cacheRoot }),
      /no entry for electron-v43\.5\.0-darwin-arm64\.zip/,
    )
    assert.equal(downloader.urls.length, 0)
  }))

test('the checksums are those of the installed electron version', () => {
  const { version, checksums } = pinnedElectron(repoRoot)
  const installed = JSON.parse(readFileSync(join(repoRoot, 'node_modules', 'electron', 'package.json'), 'utf8'))
  assert.equal(version, installed.version)
  assert.match(checksums[archiveName(version)] ?? '', /^[0-9a-f]{64}$/)
})
