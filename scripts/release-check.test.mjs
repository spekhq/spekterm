/**
 * build-identity: "The macOS packaging command builds only a release commit" (`scripts/release-check.mjs`).
 *
 * **Every refusal is asserted by its reason, never by "it failed".** These tests run on Linux. Called with
 * the real platform, every fixture would be refused for being on Linux, and a suite that only checks
 * `ok === false` would pass without testing a single rule. Hence the platform is passed as `darwin`, and
 * each test names the words its refusal must contain — and the one fixture that must pass is in the set,
 * so a check that refuses everything is red too.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkRelease } from './release-check.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function writeVersion(root, version) {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fx', version }, null, 2) + '\n')
  const lock = { name: 'fx', version, lockfileVersion: 3, packages: { '': { name: 'fx', version } } }
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n')
}

/** A repository whose HEAD is the release commit of 0.2.4, made the way `release-bump.mjs` makes it. */
function makeReleaseRepo() {
  const root = mkdtempSync(join(tmpdir(), 'spekterm-release-check-'))
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim()
  git('init', '-q', '.')
  git('config', 'user.email', 'probe@example.com')
  git('config', 'user.name', 'probe')
  writeVersion(root, '0.2.3')
  writeFileSync(join(root, 'README.md'), 'fixture\n')
  git('add', '-A')
  git('commit', '-qm', 'seed')
  writeVersion(root, '0.2.4')
  git('commit', '-qm', 'chore(release): 0.2.4', '--', 'package.json', 'package-lock.json')
  return { root, git, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

const asMac = (root) => checkRelease({ repoRoot: root, platform: 'darwin' })

test('the release commit on a clean tree passes', () => {
  const { root, cleanup } = makeReleaseRepo()
  try {
    const result = asMac(root)
    assert.equal(result.ok, true, result.reason)
    assert.equal(result.version, '0.2.4')
  } finally {
    cleanup()
  }
})

test('a detached checkout of the release commit passes', () => {
  const { root, git, cleanup } = makeReleaseRepo()
  try {
    git('checkout', '-q', '--detach', 'HEAD')
    const result = asMac(root)
    assert.equal(result.ok, true, result.reason)
  } finally {
    cleanup()
  }
})

test('a commit after the release commit is refused, naming the release commit', () => {
  const { root, git, cleanup } = makeReleaseRepo()
  try {
    const release = git('rev-parse', '--short=7', 'HEAD')
    writeFileSync(join(root, 'README.md'), 'later\n')
    git('commit', '-qam', 'feat: later work')
    const result = asMac(root)
    assert.equal(result.ok, false)
    assert.match(result.reason, /not the release commit of 0\.2\.4/)
    assert.match(result.reason, new RegExp(`git checkout ${release}`))
  } finally {
    cleanup()
  }
})

test('an untracked file is refused', () => {
  const { root, cleanup } = makeReleaseRepo()
  try {
    writeFileSync(join(root, 'stray.ts'), 'export {}\n')
    const result = asMac(root)
    assert.equal(result.ok, false)
    assert.match(result.reason, /working tree has changes/)
    assert.match(result.reason, /stray\.ts/)
  } finally {
    cleanup()
  }
})

test('a release subject naming another version is refused', () => {
  const { root, git, cleanup } = makeReleaseRepo()
  try {
    writeVersion(root, '0.2.5')
    git('commit', '-qm', 'chore(release): 0.2.4', '--', 'package.json', 'package-lock.json')
    const result = asMac(root)
    assert.equal(result.ok, false)
    assert.match(result.reason, /not the release commit of 0\.2\.5/)
  } finally {
    cleanup()
  }
})

test('a commit with the release subject that changes another file is refused', () => {
  const { root, git, cleanup } = makeReleaseRepo()
  try {
    writeFileSync(join(root, 'README.md'), 'amended\n')
    git('commit', '-q', '--amend', '--no-edit', '-a')
    const result = asMac(root)
    assert.equal(result.ok, false)
    assert.match(result.reason, /changes README\.md, package-lock\.json, package\.json, not exactly/)
  } finally {
    cleanup()
  }
})

test('a clone without the parent of HEAD is refused', () => {
  const { root, cleanup } = makeReleaseRepo()
  const shallow = mkdtempSync(join(tmpdir(), 'spekterm-release-shallow-'))
  try {
    execFileSync('git', ['clone', '-q', '--depth=1', `file://${root}`, shallow], { stdio: 'ignore' })
    const result = asMac(shallow)
    assert.equal(result.ok, false)
    assert.match(result.reason, /parent of HEAD is not available/)
  } finally {
    rmSync(shallow, { recursive: true, force: true })
    cleanup()
  }
})

test('the real command refuses on Linux, naming macOS', { skip: process.platform === 'darwin' }, () => {
  const { root, cleanup } = makeReleaseRepo()
  try {
    const run = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'release-check.mjs'), root], {
      encoding: 'utf8',
    })
    assert.notEqual(run.status, 0)
    assert.match(run.stderr, /can only be built on macOS/)
  } finally {
    cleanup()
  }
})
