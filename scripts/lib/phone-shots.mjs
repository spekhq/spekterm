/**
 * spekterm for Android's phone screenshots on the website (`project-website`: "Screenshots come only from the
 * capture script", design of `android-screenshots-on-the-website`).
 *
 * The app is a native phone app this repository cannot run, so its screenshots are imported, not captured: the
 * five of its Google Play listing, per language, read as committed at a release tag of a spekterm-android
 * repository — never its working tree. All ten are read and checked before anything is written; on any
 * problem nothing is written and the manifest object is left as it was.
 *
 * Shared by `scripts/capture-screenshots.mjs` (the import) and `scripts/screenshot-manifest.test.mjs` (the set
 * the committed screenshots must equal), so the two cannot disagree.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** The listing's screenshots, in display order: listing name → the site's name. */
export const PHONE_SHOTS = [
  ['01-sessions', 'phone-sessions'],
  ['02-conversation', 'phone-conversation'],
  ['03-prompt', 'phone-prompt'],
  ['04-inbox', 'phone-inbox'],
  ['05-openspec', 'phone-openspec'],
]

/** The listing's locale → the site's screenshot directory. */
export const PHONE_LOCALES = [
  ['en-US', 'en'],
  ['zh-TW', 'zh-TW'],
]

/** Where the release tag the phone screenshots came from is recorded, relative to the screenshot directory. */
export const SOURCE_FILE = 'ANDROID_SOURCE'

export const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/

const WIDTH = 1080
const HEIGHT = 1920
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The ten files of the set: where each is in the listing, and where it goes on the site. */
export function phoneSet() {
  return PHONE_LOCALES.flatMap(([locale, dir]) =>
    PHONE_SHOTS.map(([listing, name]) => ({
      source: `play/listings/${locale}/graphics/phone-screenshots/${listing}.png`,
      target: `${dir}/${name}.png`,
    })),
  )
}

/**
 * Problems with the set's contents: `files` maps each `source` path to its bytes (absent when it could not be
 * read). A file is good when it is a PNG whose first chunk is `IHDR` saying 1080 × 1920.
 * @param {Record<string, Buffer | undefined>} files
 */
export function phoneSetProblems(files) {
  const problems = []
  for (const { source } of phoneSet()) {
    const bytes = files[source]
    if (!bytes) problems.push(`${source}: missing`)
    else if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) problems.push(`${source}: not a PNG image`)
    else if (bytes.toString('latin1', 12, 16) !== 'IHDR') problems.push(`${source}: not a PNG image (no IHDR chunk first)`)
    else {
      const width = bytes.readUInt32BE(16)
      const height = bytes.readUInt32BE(20)
      if (width !== WIDTH || height !== HEIGHT) problems.push(`${source}: ${width} × ${height}, not ${WIDTH} × ${HEIGHT}`)
    }
  }
  return problems
}

/**
 * The release tag to import from: `named` when given (it must be a release tag), otherwise the highest release
 * tag among `tags`. The pattern is applied before comparing — git's own version order puts `v1` above `v0.10.0`.
 * @param {string[]} tags
 * @param {string | undefined} named
 * @returns {{ tag: string } | { problem: string }}
 */
export function chooseReleaseTag(tags, named) {
  if (named !== undefined && named !== '') {
    return RELEASE_TAG.test(named) ? { tag: named } : { problem: `${named} is not a release tag (v<major>.<minor>.<patch>)` }
  }
  const releases = tags.filter((tag) => RELEASE_TAG.test(tag))
  if (releases.length === 0) return { problem: 'the repository has no release tag (v<major>.<minor>.<patch>)' }
  const parts = (tag) => tag.match(RELEASE_TAG).slice(1).map(Number)
  releases.sort((a, b) => {
    const [pa, pb] = [parts(a), parts(b)]
    return pb[0] - pa[0] || pb[1] - pa[1] || pb[2] - pa[2]
  })
  return { tag: releases[0] }
}

/** One git call. A non-zero status or a spawn error is a problem naming the call, never an empty answer. */
function git(dir, args, { binary = false } = {}) {
  const result = spawnSync('git', ['-C', dir, ...args], {
    // The bytes of an image, or text in a fixed language (this machine's git speaks Chinese).
    encoding: binary ? 'buffer' : 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
    // The default 1 MiB fails on a large image with an empty stderr.
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) return { problem: `git ${args.join(' ')}: ${result.error.code ?? result.error.message}` }
  if (result.status !== 0) {
    const stderr = (binary ? result.stderr.toString('utf8') : result.stderr).trim()
    return { problem: `git ${args.join(' ')} exited ${result.status}${stderr ? `: ${stderr}` : ''}` }
  }
  return { out: result.stdout }
}

/**
 * Read the set from `dir` at a release tag: `named`, or the highest one.
 * @returns {{ tag: string, files: Record<string, Buffer> } | { problem: string }}
 */
export function readPhoneSet(dir, named) {
  let top
  try {
    top = realpathSync(resolve(dir))
  } catch {
    return { problem: `no spekterm-android repository at ${dir} (set ANDROID_DIR)` }
  }
  const toplevel = git(top, ['rev-parse', '--show-toplevel'])
  if (toplevel.problem) return { problem: `${dir} is not a git repository: ${toplevel.problem}` }
  // git -C climbs into an enclosing repository; only the repository's own top is accepted.
  if (toplevel.out.trim() !== top) return { problem: `${dir} is not the top of a git repository (its top is ${toplevel.out.trim()})` }

  const tags = git(top, ['tag', '--list', 'v*'])
  if (tags.problem) return { problem: tags.problem }
  const chosen = chooseReleaseTag(tags.out.split('\n').map((line) => line.trim()).filter(Boolean), named)
  if (chosen.problem) return { problem: chosen.problem }
  const { tag } = chosen
  // A tag, not a branch of the same name.
  const verified = git(top, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`])
  if (verified.problem) return { problem: `no tag ${tag} in ${dir}` }

  const files = {}
  const unreadable = []
  for (const { source } of phoneSet()) {
    const blob = git(top, ['cat-file', 'blob', `refs/tags/${tag}:${source}`], { binary: true })
    if (blob.problem) unreadable.push(`${source}: missing at ${tag}`)
    else files[source] = blob.out
  }
  const problems = [...unreadable, ...phoneSetProblems(files).filter((problem) => !problem.endsWith(': missing'))]
  if (problems.length > 0) return { problem: `${tag}: ${problems.join('; ')}` }
  return { tag, files }
}

/**
 * Import the set into `outDir` (the site's screenshot directory): all ten files, their hashes on `manifest`
 * (keys relative to `outDir`), and the tag in `SOURCE_FILE`. On a problem nothing is written and `manifest` is
 * unchanged. The caller reads and writes `manifest.json`.
 * @returns {{ tag: string, written: string[] } | { problem: string }}
 */
export function importPhoneSet({ dir, tag: named, outDir, manifest }) {
  const read = readPhoneSet(dir, named)
  if (read.problem) return { problem: read.problem }
  const written = []
  for (const { source, target } of phoneSet()) {
    const bytes = read.files[source]
    const file = join(outDir, target)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
    manifest[target] = createHash('sha256').update(bytes).digest('hex')
    written.push(target)
  }
  writeFileSync(join(outDir, SOURCE_FILE), `${read.tag}\n`)
  return { tag: read.tag, written }
}

/**
 * Problems with the committed phone screenshots, given the manifest's keys and the recorded tag (null when the
 * file is absent): the keys whose file name starts with `phone-` must be exactly the set, and a release tag must
 * be recorded whenever any is present.
 * @param {string[]} keys
 * @param {string | null} source
 */
export function committedPhoneProblems(keys, source) {
  const expected = new Set(phoneSet().map(({ target }) => target))
  const phone = keys.filter((key) => key.split('/').pop().startsWith('phone-'))
  const problems = []
  if (phone.length === 0) return problems
  for (const key of phone) if (!expected.has(key)) problems.push(`${key}: not one of the imported phone screenshots`)
  for (const key of expected) if (!phone.includes(key)) problems.push(`${key}: missing from the imported phone screenshots`)
  if (source === null) problems.push(`${SOURCE_FILE}: missing, so the phone screenshots' release is not recorded`)
  else if (!/^v\d+\.\d+\.\d+\n$/.test(source)) problems.push(`${SOURCE_FILE}: ${JSON.stringify(source)} is not a release tag and a newline`)
  return problems
}
