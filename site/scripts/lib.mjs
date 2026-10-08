/**
 * Shared plumbing for the site's build checks: paths, the sitemap, parsed HTML, and the self-test
 * harness every check uses.
 *
 * Every check runs `--self-test` before it runs on the real output (design D12): the self-test
 * builds fixtures that violate the check and fails unless the check catches each one. A check that
 * has gone blind therefore stops the build instead of passing it.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'node-html-parser'

export const SITE_ROOT = fileURLToPath(new URL('..', import.meta.url))
export const DIST = join(SITE_ROOT, 'dist')
export const CANONICAL_ORIGIN = 'https://spekterm.com'
export const LOCALES = [
  { lang: 'en', prefix: '' },
  { lang: 'zh-TW', prefix: '/zh-tw' },
]

/** The repository root, found by git so the checks do not depend on the working directory. */
export function repoRoot(from = SITE_ROOT) {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: from, encoding: 'utf8' }).trim()
}

/** Every file under `dir` (recursive), as paths relative to `dir` with `/` separators. */
export function walk(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full).map((rel) => `${entry.name}/${rel}`))
    else if (entry.isFile()) out.push(entry.name)
  }
  return out.sort()
}

/** Paths (`/docs/install/`) of the pages listed in a built site's sitemap — the spec's "pages". */
export function sitemapPages(dist = DIST) {
  const index = join(dist, 'sitemap-index.xml')
  if (!existsSync(index)) throw new Error(`no sitemap index at ${index}`)
  const sitemaps = [...readFileSync(index, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  const pages = []
  for (const url of sitemaps) {
    const file = join(dist, new URL(url).pathname)
    for (const m of readFileSync(file, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)) {
      pages.push(new URL(m[1]).pathname)
    }
  }
  if (pages.length === 0) throw new Error('the sitemap lists no page')
  return [...new Set(pages)].sort()
}

/** The built HTML file of a page path. */
export function htmlFileOf(dist, path) {
  return join(dist, path, 'index.html')
}

export function readHtml(file) {
  return parse(readFileSync(file, 'utf8'), HTML_OPTIONS)
}

/** The page's counterpart in the other language. */
export function counterpartOf(path) {
  return path.startsWith('/zh-tw/') ? path.slice('/zh-tw'.length) : `/zh-tw${path}`
}

export function localeOf(path) {
  return path.startsWith('/zh-tw/') ? LOCALES[1] : LOCALES[0]
}

/** Visible text of a parsed document's body, whitespace collapsed. */
/**
 * Options for every HTML parse in the checks. node-html-parser keeps `<pre>` as **raw text** by default,
 * so a highlighted code block (tokens in `<span>`s) reads as markup, not as its text — a required
 * command inside a code block was reported missing. Only script and style stay raw.
 */
export const HTML_OPTIONS = { comment: false, blockTextElements: { script: true, noscript: true, style: true } }

export function textOf(root) {
  const body = root.querySelector('body') ?? root
  for (const el of body.querySelectorAll('script, style, template')) el.remove()
  return body.textContent.replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------------------------
// Self-test harness

/** Writes `{ relPath: content }` into a fresh temporary directory and returns its path. */
export function fixtureDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'spekterm-site-check-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, ...rel.split('/'))
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

/**
 * Runs `check(dir)` (which returns a list of problems) on a passing fixture and on each violating
 * one. Every violating case must produce a problem containing `expect`; the passing one must
 * produce none. Throws with every miss listed.
 */
export function selfTest(name, { pass, cases, check }) {
  const misses = []
  const run = (files) => {
    const dir = fixtureDir(files)
    try {
      return check(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const clean = run(pass)
  if (clean.length > 0) misses.push(`the passing fixture failed: ${clean.join('; ')}`)
  for (const { label, files, expect } of cases) {
    const problems = run(files)
    if (!problems.some((p) => p.includes(expect))) {
      misses.push(`"${label}" was not caught (expected a problem mentioning "${expect}", got: ${problems.join('; ') || 'none'})`)
    }
  }
  if (misses.length > 0) throw new Error(`${name} self-test failed:\n  - ${misses.join('\n  - ')}`)
  console.log(`${name}: self-test passed (${cases.length} violations caught, the passing fixture passed)`)
}

/** Standard entry point: `--self-test` runs the self-test, otherwise the check on the real output. */
export function main(name, { selfTest: runSelfTest, run }) {
  try {
    if (process.argv.includes('--self-test')) {
      runSelfTest()
      return
    }
    const problems = run()
    if (problems.length > 0) {
      console.error(`${name}: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}`)
      process.exit(1)
    }
    console.log(`${name}: passed`)
  } catch (error) {
    console.error(`${name}: ${error.message}`)
    process.exit(1)
  }
}

export function toPosix(path) {
  return path.split(sep).join('/')
}

export { relative }
