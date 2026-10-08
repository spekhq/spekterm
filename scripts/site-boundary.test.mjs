/**
 * project-website: "The site is built from the repository and stays out of the app".
 *
 * The website lives in `site/` with its own package and lockfile. Nothing from it may reach the desktop
 * artifact, and the root project must not adopt it as a workspace — a workspace would hoist the site's
 * dependencies into the root install and its lockfile. (Root and site sharing some packages, such as
 * `typescript`, is not a leak.)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, matchesGlob } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const rootPackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const rootLock = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8'))

/** Paths that stand for "something under the site's directory". */
const SITE_SAMPLES = ['site/package.json', 'site/dist/index.html', 'site/src/content/docs/index.mdx']

/** Does one packaging selection (a pattern string, or `{ from, filter }`) select a path under `site/`? */
function selectsSite(selection) {
  const from = typeof selection === 'string' ? selection : selection?.from
  if (typeof from !== 'string' || from.startsWith('!')) return false
  if (from === 'site' || from.startsWith('site/')) return true
  return SITE_SAMPLES.some((sample) => matchesGlob(sample, from))
}

/** The packaging configuration's file selections — included files, extra files, extra resources. */
function packagingSelections(build) {
  const asList = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value])
  return [...asList(build.files), ...asList(build.extraFiles), ...asList(build.extraResources)]
}

test('the packaging configuration selects nothing under site/', () => {
  const offending = packagingSelections(rootPackage.build).filter(selectsSite)
  assert.deepEqual(offending, [], `packaging selects the website: ${JSON.stringify(offending)}`)
})

test('control: a selection of site/** is caught', () => {
  for (const mutation of ['site/**', 'site', '**/*.mdx', { from: 'site/dist', to: 'docs' }]) {
    const build = { ...rootPackage.build, files: [...rootPackage.build.files, mutation] }
    assert.ok(packagingSelections(build).some(selectsSite), `not caught: ${JSON.stringify(mutation)}`)
  }
})

/** What in the root package and lockfile adopts the site: workspaces, and lock entries under `site/`. */
function adoptionOf(pkg, lock) {
  const siteEntries = Object.keys(lock.packages ?? {}).filter((key) => key === 'site' || key.startsWith('site/'))
  return { workspaces: pkg.workspaces ?? null, siteEntries }
}

test('the root project does not adopt the site as a workspace or list it in its lockfile', () => {
  assert.deepEqual(adoptionOf(rootPackage, rootLock), { workspaces: null, siteEntries: [] })
})

test('control: a workspace and its lock entries are caught', () => {
  const pkg = { ...rootPackage, workspaces: ['site'] }
  const lock = { packages: { ...rootLock.packages, site: { name: 'spekterm-site' }, 'site/node_modules/astro': {} } }
  assert.deepEqual(adoptionOf(pkg, lock), { workspaces: ['site'], siteEntries: ['site', 'site/node_modules/astro'] })
})

// project-website: "The site's build is the gate to publishing". The hosting runs the site's `build`
// script; these are the steps it must still run, in order. A step deleted from `build.mjs` (or a
// `build` script that bypasses it) would let a failing page publish, with nothing turning red.

const SITE_BUILD_STEPS = ['astro check', 'root content guards', 'astro build', 'parity', 'origins', 'notices', 'content']

/** The step names a build script declares, in order (`step('<name>', …)`). */
function stepsOf(source) {
  return [...source.matchAll(/^step\('([^']+)'/gm)].map((match) => match[1])
}

test("the site's build runs every gate step, in order", () => {
  const sitePackage = JSON.parse(readFileSync(join(repoRoot, 'site', 'package.json'), 'utf8'))
  assert.equal(sitePackage.scripts.build, 'node scripts/build.mjs')
  const source = readFileSync(join(repoRoot, 'site', 'scripts', 'build.mjs'), 'utf8')
  assert.deepEqual(stepsOf(source), SITE_BUILD_STEPS)
  assert.match(source, /public-hygiene\.test\.mjs/)
  assert.match(source, /license\.test\.mjs/)
})

test('control: a deleted build step is caught', () => {
  const source = SITE_BUILD_STEPS.map((name) => `step('${name}', x)`).join('\n')
  assert.deepEqual(stepsOf(source), SITE_BUILD_STEPS)
  assert.notDeepEqual(stepsOf(source.replace("step('origins', x)\n", '')), SITE_BUILD_STEPS)
})
