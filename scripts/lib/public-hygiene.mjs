/**
 * public-content-hygiene: the matching logic, shared by the repository guard
 * (`scripts/public-hygiene.test.mjs`) and by anything else that must not publish an internal name or the
 * maintainer's home path — the website's screenshot capture reads the app's on-screen text through it.
 *
 * Pure: no git call, no test registration at import. Why the list is hashes, and which words are
 * deliberately not on it, is explained at the top of the guard.
 */
import { createHash } from 'node:crypto'

/** SHA-256 of the words (lower case) the maintainer declared internal. */
export const INTERNAL_WORDS = new Set([
  '83d9c871c274f06f8d411f8f0f4e10a07aac1d58681ed580eaba39cc78f6adf3',
  '722155eed857ad7160a28c4059277baadb9b2f49e981bee3e8f06267df70f071',
  'ee4e30e780bcc5fffa26e4aeb171857015b059da591faa3f8e271dcd65400f04',
])

/** Control: the product name. It is always present — failing to match it means tokenizing or hashing broke. */
export const KNOWN_PUBLIC_WORD = '3b2b56084f042d3c2911f846265b790a5559e43924330ed2af082d17c8fb9501'

/** The maintainer's home directory. The user name itself is a public GitHub account and is allowed. */
export const MAINTAINER_HOME = ['', 'home', 'kewang'].join('/')

/**
 * The same path in the form Claude Code uses for its per-project directory names (`/` replaced by `-`,
 * e.g. `~/.claude/projects/-home-<user>-git-<repo>`). The history rewrite before going public missed this
 * form at first — a check that only knows the slash form reports zero hits while the path is still there.
 */
export const MAINTAINER_HOME_ENCODED = ['', 'home', 'kewang', ''].join('-')

export const sha256 = (word) => createHash('sha256').update(word).digest('hex')

/** Split on non-alphanumerics, lower case. `Some-Name_URL` → `some`, `name`, `url`. */
export function wordsOf(text) {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

/**
 * What in `text` the hygiene rules forbid: the hash prefixes of internal words (never the words — output
 * can end up somewhere public) and whether a home path appears. `hashes` replaces the internal list, so a
 * caller's own control group can use a word it is free to write.
 */
export function hygieneHits(text, { hashes = INTERNAL_WORDS } = {}) {
  const words = []
  const seen = new Set()
  for (const word of wordsOf(text)) {
    if (seen.has(word)) continue
    seen.add(word)
    const hash = sha256(word)
    if (hashes.has(hash)) words.push(`${hash.slice(0, 12)}…`)
  }
  const homePath = text.includes(MAINTAINER_HOME) || text.includes(MAINTAINER_HOME_ENCODED)
  return { words, homePath }
}
