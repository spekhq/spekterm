/**
 * project-website: "Screenshots come only from the capture script".
 *
 * `scripts/capture-screenshots.mjs` records the SHA-256 of every image it writes. A committed screenshot
 * that is not in the manifest, or does not match its hash, was not written by the script; a manifest
 * entry without its file means the set is incomplete. This cannot prove where the manifest came from —
 * it is a weak carrier, and the maintainer's review of every image is the other half.
 *
 * Also the verdict the script applies to the screen before each capture (`scripts/lib/screen-check.mjs`).
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { MAINTAINER_HOME, sha256 } from './lib/public-hygiene.mjs'
import { screenVerdict } from './lib/screen-check.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(repoRoot, 'site', 'src', 'assets', 'screenshots')

function imagesOn(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? imagesOn(join(dir, entry.name)) : /\.(png|jpe?g|webp)$/.test(entry.name) ? [join(dir, entry.name)] : [],
  )
}

/** Problems with a set of images against a manifest — shared by the real check and its controls. */
function manifestProblems(images, manifest) {
  const problems = []
  if (Object.keys(manifest).length === 0) problems.push('the manifest is empty')
  for (const [path, bytes] of Object.entries(images)) {
    if (!(path in manifest)) problems.push(`${path}: not written by the capture script`)
    else if (manifest[path] !== createHash('sha256').update(bytes).digest('hex')) problems.push(`${path}: changed after capture`)
  }
  for (const path of Object.keys(manifest)) if (!(path in images)) problems.push(`${path}: recorded but missing`)
  return problems
}

test('every committed screenshot is one the capture script wrote, and none is missing', () => {
  assert.ok(existsSync(join(SHOTS, 'manifest.json')), 'no screenshot manifest')
  const manifest = JSON.parse(readFileSync(join(SHOTS, 'manifest.json'), 'utf8'))
  const images = Object.fromEntries(imagesOn(SHOTS).map((file) => [relative(SHOTS, file), readFileSync(file)]))
  assert.deepEqual(manifestProblems(images, manifest), [])
})

test('control: a replaced, an added, and a deleted screenshot, and an empty manifest, are caught', () => {
  const a = Buffer.from('a')
  const manifest = { 'en/hero.png': createHash('sha256').update(a).digest('hex') }
  assert.deepEqual(manifestProblems({ 'en/hero.png': a }, manifest), [])
  assert.match(manifestProblems({ 'en/hero.png': Buffer.from('b') }, manifest).join(), /changed after capture/)
  assert.match(manifestProblems({ 'en/hero.png': a, 'en/x.png': a }, manifest).join(), /not written by the capture script/)
  assert.match(manifestProblems({}, manifest).join(), /recorded but missing/)
  assert.match(manifestProblems({}, {}).join(), /manifest is empty/)
})

test('control: the pre-capture verdict refuses forbidden text and an empty read', () => {
  assert.equal(screenVerdict('me@spekterm api-server %', { fixtureName: 'api-server' }), null)
  assert.match(screenVerdict(`api-server ${MAINTAINER_HOME}/git`, { fixtureName: 'api-server' }), /home path/)
  const injected = new Set([sha256('fixtureword')])
  assert.match(screenVerdict('api-server FixtureWord', { fixtureName: 'api-server', hashes: injected }), /internal word/)
  assert.match(screenVerdict('', { fixtureName: 'api-server' }), /wrong page or nothing/)
})
