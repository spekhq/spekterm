/**
 * project-website (android-screenshots-on-the-website): the phone screenshot import — the set's checks, the
 * release tag's choice, reading at a tag, and that a failed import writes nothing.
 *
 * The git cases run against throwaway repositories, so they need no spekterm-android checkout. Assertions match
 * the module's own messages (file and tag names), never git's wording, which follows the machine's language.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { after, test } from 'node:test'
import { chooseReleaseTag, committedPhoneProblems, importPhoneSet, phoneSet, phoneSetProblems, readPhoneSet, SOURCE_FILE } from './lib/phone-shots.mjs'

const scratch = mkdtempSync(join(tmpdir(), 'phone-shots-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

/** The start of a PNG: signature, then an IHDR chunk header with the size. Enough for the checks. */
function png(width = 1080, height = 1920, { chunk = 'IHDR', tail = 'x' } = {}) {
  const head = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0)
  head.writeUInt32BE(13, 8)
  head.write(chunk, 12, 'latin1')
  head.writeUInt32BE(width, 16)
  head.writeUInt32BE(height, 20)
  return Buffer.concat([head, Buffer.from(tail)])
}

function validFiles() {
  return Object.fromEntries(phoneSet().map(({ source }, i) => [source, png(1080, 1920, { tail: `shot ${i}` })]))
}

function run(dir, ...args) {
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout
}

/** A repository whose commits each hold `files`, tagged as given; returns its directory. */
function repoWith(name, commits) {
  const dir = join(scratch, name)
  mkdirSync(dir, { recursive: true })
  run(dir, 'init', '-q', '-b', 'master')
  run(dir, 'config', 'user.email', 'me@example.com')
  run(dir, 'config', 'user.name', 'me')
  run(dir, 'config', 'commit.gpgsign', 'false')
  run(dir, 'config', 'tag.gpgsign', 'false')
  for (const { files, tag, annotated, branch } of commits) {
    for (const entry of readdirSync(dir)) if (entry !== '.git') rmSync(join(dir, entry), { recursive: true, force: true })
    for (const [path, bytes] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true })
      writeFileSync(join(dir, path), bytes)
    }
    writeFileSync(join(dir, 'README.md'), `${tag ?? branch}\n`)
    run(dir, 'add', '-A')
    run(dir, 'commit', '-q', '-m', `${tag ?? branch}`)
    if (tag) run(dir, 'tag', ...(annotated ? ['-a', '-m', tag] : []), tag)
    if (branch) run(dir, 'branch', branch)
  }
  return dir
}

const good = validFiles()
const missingOne = { ...good }
delete missingOne[phoneSet()[3].source]
const wrongSize = { ...good, [phoneSet()[7].source]: png(1080, 2424) }

const repo = repoWith('android', [
  { files: good, tag: 'v0.9.1' },
  { files: good, tag: 'v0.10.0', annotated: true },
  { files: missingOne, tag: 'v0.11.0' },
  { files: wrongSize, tag: 'v0.12.0' },
  { files: good, tag: 'v1' },
  { files: good, tag: 'core-v9.0.0' },
  { files: good, branch: 'v2.0.0' },
])

/** Every file under a directory with its bytes, for "nothing changed" checks. */
function snapshot(dir) {
  if (!existsSync(dir)) return {}
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
  return Object.fromEntries(walk(dir).map((file) => [relative(dir, file), readFileSync(file).toString('base64')]))
}

// ── The set's checks ────────────────────────────────────────────────────────────────────────────────

test('a valid set has no problem', () => {
  assert.deepEqual(phoneSetProblems(good), [])
})

test('a missing file, a non-PNG, a wrong chunk type and a wrong size are each named', () => {
  const [a, b, c, d] = phoneSet().map(({ source }) => source)
  const problems = phoneSetProblems({
    ...good,
    [a]: undefined,
    [b]: Buffer.from('GIF89a this is not a png at all'),
    [c]: png(1080, 1920, { chunk: 'tEXt' }),
    [d]: png(1080, 2424),
  })
  assert.equal(problems.length, 4, problems.join('\n'))
  assert.match(problems[0], new RegExp(`^${a}: missing`))
  assert.match(problems[1], new RegExp(`^${b}: not a PNG`))
  assert.match(problems[2], new RegExp(`^${c}: not a PNG image \\(no IHDR`))
  assert.match(problems[3], new RegExp(`^${d}: 1080 × 2424`))
})

test('the set is five screenshots in each of two languages', () => {
  const targets = phoneSet().map(({ target }) => target)
  assert.equal(new Set(targets).size, 10)
  assert.deepEqual(targets.slice(0, 5), ['en/phone-sessions.png', 'en/phone-conversation.png', 'en/phone-prompt.png', 'en/phone-inbox.png', 'en/phone-openspec.png'])
  assert.ok(targets.slice(5).every((t) => t.startsWith('zh-TW/phone-')))
})

// ── The release tag ─────────────────────────────────────────────────────────────────────────────────

test('the highest release tag is chosen numerically, ignoring tags that are not releases', () => {
  assert.deepEqual(chooseReleaseTag(['v0.9.1', 'v0.10.0', 'core-v1.0.0', 'v1'], undefined), { tag: 'v0.10.0' })
})

test('no release tag, or a named tag that is not a release, is a problem', () => {
  assert.match(chooseReleaseTag(['v1', 'core-v1.0.0'], undefined).problem, /no release tag/)
  assert.match(chooseReleaseTag([], undefined).problem, /no release tag/)
  assert.match(chooseReleaseTag(['v0.10.0'], 'v1').problem, /^v1 is not a release tag/)
})

// ── Reading at a tag ────────────────────────────────────────────────────────────────────────────────

test('a valid tag, lightweight or annotated, reads the set as committed', () => {
  for (const tag of ['v0.9.1', 'v0.10.0']) {
    const read = readPhoneSet(repo, tag)
    assert.equal(read.problem, undefined, read.problem)
    assert.equal(read.tag, tag)
    for (const { source } of phoneSet()) assert.ok(read.files[source].equals(good[source]), source)
  }
})

test('with no tag named, the highest release tag is read (not v1, not a branch)', () => {
  const read = readPhoneSet(repo, undefined)
  // v0.12.0 is the highest release, and it holds a wrong-size file.
  assert.match(read.problem, /^v0\.12\.0: /)
})

test('a tag missing a file, or holding a wrong-size one, names the file', () => {
  assert.match(readPhoneSet(repo, 'v0.11.0').problem, new RegExp(`${phoneSet()[3].source}: missing at v0\\.11\\.0`))
  assert.match(readPhoneSet(repo, 'v0.12.0').problem, new RegExp(`${phoneSet()[7].source}: 1080 × 2424`))
})

test('a non-release tag, an unknown tag, and a branch named like a release are refused', () => {
  assert.match(readPhoneSet(repo, 'v1').problem, /^v1 is not a release tag/)
  assert.match(readPhoneSet(repo, 'v9.9.9').problem, /^no tag v9\.9\.9 in /)
  assert.match(readPhoneSet(repo, 'v2.0.0').problem, /^no tag v2\.0\.0 in /)
})

test('a repository without a release tag is refused', () => {
  const bare = repoWith('untagged', [{ files: good, tag: 'v1' }])
  assert.match(readPhoneSet(bare, undefined).problem, /no release tag/)
})

test('a subdirectory of a repository, or no repository, is refused', () => {
  assert.match(readPhoneSet(join(repo, 'play'), 'v0.9.1').problem, /is not the top of a git repository/)
  const plain = join(scratch, 'plain')
  mkdirSync(plain, { recursive: true })
  // Inside the scratch directory, which is in no repository, so git finds none.
  assert.match(readPhoneSet(plain, 'v0.9.1').problem, /is not a git repository/)
  assert.match(readPhoneSet(join(scratch, 'absent'), 'v0.9.1').problem, /no spekterm-android repository/)
})

test('the directory may be given relative, or with a trailing slash', () => {
  assert.equal(readPhoneSet(`${repo}/`, 'v0.9.1').tag, 'v0.9.1')
  assert.equal(readPhoneSet(relative(process.cwd(), repo), 'v0.9.1').tag, 'v0.9.1')
})

// ── The import ──────────────────────────────────────────────────────────────────────────────────────

test('an import writes the ten files byte for byte, their hashes, and the tag', () => {
  const outDir = join(scratch, 'out-ok')
  const manifest = { 'en/hero.png': 'kept' }
  const result = importPhoneSet({ dir: repo, tag: 'v0.10.0', outDir, manifest })
  assert.equal(result.problem, undefined, result.problem)
  assert.equal(result.written.length, 10)
  for (const { source, target } of phoneSet()) {
    assert.ok(readFileSync(join(outDir, target)).equals(good[source]), target)
    assert.match(manifest[target], /^[0-9a-f]{64}$/)
  }
  assert.equal(manifest['en/hero.png'], 'kept')
  assert.equal(readFileSync(join(outDir, SOURCE_FILE), 'utf8'), 'v0.10.0\n')
})

test('a failed import writes nothing and leaves the manifest object unchanged', () => {
  for (const tag of ['v0.11.0', 'v0.12.0', 'v1', 'v9.9.9']) {
    const outDir = join(scratch, `out-${tag}`)
    mkdirSync(join(outDir, 'en'), { recursive: true })
    writeFileSync(join(outDir, 'en', 'phone-sessions.png'), 'committed')
    writeFileSync(join(outDir, SOURCE_FILE), 'v0.1.0\n')
    const before = snapshot(outDir)
    const manifest = { 'en/phone-sessions.png': 'old' }
    const result = importPhoneSet({ dir: repo, tag, outDir, manifest })
    assert.ok(result.problem, `${tag}: expected a problem`)
    assert.deepEqual(snapshot(outDir), before, `${tag}: the directory changed`)
    assert.deepEqual(manifest, { 'en/phone-sessions.png': 'old' }, `${tag}: the manifest changed`)
  }
})

// ── The committed set ───────────────────────────────────────────────────────────────────────────────

const allKeys = ['en/hero.png', 'neutral/spek-change.png', ...phoneSet().map(({ target }) => target)]

test('the committed phone screenshots must be exactly the set, with a release recorded', () => {
  assert.deepEqual(committedPhoneProblems(allKeys, 'v0.4.0\n'), [])
  assert.deepEqual(committedPhoneProblems(['en/hero.png'], null), [], 'no phone screenshot needs no tag')
})

test('control: an extra, a missing, and an unrecorded or malformed release are caught', () => {
  assert.match(committedPhoneProblems([...allKeys, 'en/phone-extra.png'], 'v0.4.0\n').join(), /en\/phone-extra\.png: not one of/)
  assert.match(committedPhoneProblems(allKeys.filter((k) => k !== 'zh-TW/phone-inbox.png'), 'v0.4.0\n').join(), /zh-TW\/phone-inbox\.png: missing/)
  assert.match(committedPhoneProblems(allKeys, null).join(), /ANDROID_SOURCE: missing/)
  assert.match(committedPhoneProblems(allKeys, 'v1\n').join(), /is not a release tag/)
  assert.match(committedPhoneProblems(allKeys, 'v0.4.0').join(), /is not a release tag/)
})
