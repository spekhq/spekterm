/**
 * project-website: the content scenarios no other check carries (design D12), read from the built
 * HTML.
 *
 * Structural part — about every page, independent of what the pages say:
 *   canonical URL; language switch targets the counterpart; disclaimer and notices link (also on the
 *   not-found page); release links target the latest release; no released or current version
 *   number; the documentation home exists in both languages; the brand — a tab icon the site serves
 *   and the header logo (also on the not-found page), and a share image in the page's language.
 * Content part — about what specific pages say:
 *   the landing page's required elements; no "Linux only" phrase; every required topic has a page;
 *   the data and network page names what the spec lists.
 *
 * `--structural-only` skips the content part (development convenience while pages are being
 * written; the build gate runs both).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'node-html-parser'
import {
  CANONICAL_ORIGIN,
  counterpartOf,
  DIST,
  htmlFileOf,
  localeOf,
  main,
  repoRoot,
  selfTest,
  SITE_ROOT,
  sitemapPages,
  textOf,
  HTML_OPTIONS,
} from './lib.mjs'

const LATEST_RELEASE = 'https://github.com/spekhq/spekterm/releases/latest'
/** The share image of each language (`scripts/make-brand-images.mjs`). */
const SHARE_IMAGE = { en: '/og/en.png', 'zh-TW': '/og/zh-tw.png' }
const RELEASES = /^https:\/\/github\.com\/spekhq\/spekterm\/releases(\/|$|\?|#)/

/** Every version the app has been released under, plus the current one in the root package.json. */
export function appVersions(root = repoRoot()) {
  const tags = execFileSync('git', ['tag', '-l', 'v*'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .map((tag) => tag.trim())
    .filter(Boolean)
  // A clone without tags (a shallow CI checkout) would make the version check pass silently;
  // `v0.2.1` exists, so an empty list is always an environment problem.
  if (tags.length === 0) throw new Error('git lists no v* tag — fetch tags before building (the version check needs them)')
  const current = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  return [...new Set([...tags.map((tag) => tag.slice(1)), current])]
}

function versionPattern(version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Word boundaries for dotted numbers: "0.2.1" must not match "10.2.1", "0.2.10" or "0.2.1.5".
  return new RegExp(`(?<![0-9A-Za-z.])${escaped}(?![0-9A-Za-z]|\\.[0-9])`)
}

function readStrings(siteDir) {
  return Object.fromEntries(
    ['en', 'zh-TW'].map((lang) => [lang, JSON.parse(readFileSync(join(siteDir, 'src/i18n', `${lang}.json`), 'utf8'))]),
  )
}

/**
 * @param {string} dist built site
 * @param {{ plan: any, strings: Record<string, Record<string, string>>, versions: string[], structuralOnly?: boolean }} options
 */
export function checkContent(dist, { plan, strings, versions, structuralOnly = false }) {
  const problems = []
  const pages = sitemapPages(dist)
  const pageSet = new Set(pages)
  const docs = pages.map((path) => ({ path, file: htmlFileOf(dist, path) }))
  const notFound = join(dist, '404.html')
  const everyDocument = [...docs, ...(existsSync(notFound) ? [{ path: '404.html', file: notFound }] : [])]
  if (!existsSync(notFound)) problems.push('the not-found page (404.html) was not built')

  // --- structural ----------------------------------------------------------------------------
  for (const required of ['/docs/', '/zh-tw/docs/']) {
    if (!pageSet.has(required)) problems.push(`the documentation home ${required} is not in the sitemap`)
  }

  const versionPatterns = versions.map((version) => [version, versionPattern(version)])

  for (const { path, file } of everyDocument) {
    if (!existsSync(file)) {
      problems.push(`${path}: listed in the sitemap but not built`)
      continue
    }
    const html = readFileSync(file, 'utf8')
    const root = parse(html, HTML_OPTIONS)
    const isPage = path !== '404.html'

    if (isPage) {
      const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute('href')
      if (canonical !== `${CANONICAL_ORIGIN}${path}`) {
        problems.push(`${path}: canonical URL is ${canonical ?? 'missing'}, expected ${CANONICAL_ORIGIN}${path}`)
      }
      const selects = root.querySelectorAll('starlight-lang-select select')
      if (selects.length === 0) problems.push(`${path}: no language switch`)
      const target = counterpartOf(path)
      for (const select of selects) {
        const values = select.querySelectorAll('option').map((option) => option.getAttribute('value'))
        if (!values.includes(target)) problems.push(`${path}: language switch does not offer ${target}`)
      }
    }

    // A declared icon the build does not contain shows the browser's blank page icon (as it did
    // before the site had one: Starlight declares /favicon.svg whether or not it exists).
    const icon = root.querySelector('link[rel~="icon"]')?.getAttribute('href')
    if (!icon) problems.push(`${path}: declares no tab icon`)
    else if (!existsSync(join(dist, icon))) problems.push(`${path}: its tab icon ${icon} is not in the build`)
    if (!root.querySelector('.site-title img')) problems.push(`${path}: no logo in the header`)
    if (isPage) {
      const expected = `${CANONICAL_ORIGIN}${SHARE_IMAGE[localeOf(path).lang]}`
      for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
        const image = root.querySelector(selector)?.getAttribute('content')
        if (image !== expected) problems.push(`${path}: ${selector} is ${image ?? 'missing'}, expected ${expected}`)
      }
      if (!existsSync(join(dist, SHARE_IMAGE[localeOf(path).lang]))) {
        problems.push(`${path}: its share image ${SHARE_IMAGE[localeOf(path).lang]} is not in the build`)
      }
    }

    const disclaimer = root.querySelector('.site-footer .disclaimer')?.textContent ?? ''
    if (!disclaimer.includes('Anthropic') || !disclaimer.includes('OpenSpec')) {
      problems.push(`${path}: the non-affiliation statement is missing`)
    }
    if (!root.querySelector('a[href="/third-party-notices.txt"]')) {
      problems.push(`${path}: no link to the third-party notices`)
    }
    for (const a of root.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href')
      if (RELEASES.test(href) && href !== LATEST_RELEASE) {
        problems.push(`${path}: release link ${href} does not target ${LATEST_RELEASE}`)
      }
    }
    for (const [version, pattern] of versionPatterns) {
      if (pattern.test(html)) problems.push(`${path}: carries the app version ${version}`)
    }
  }

  if (structuralOnly) return problems

  // --- content -------------------------------------------------------------------------------
  const phrases = plan.linuxOnlyPhrases.map((phrase) => phrase.toLowerCase())
  for (const { path, file } of everyDocument) {
    if (!existsSync(file)) continue
    const text = textOf(parse(readFileSync(file, 'utf8'), HTML_OPTIONS)).toLowerCase()
    for (const phrase of phrases) if (text.includes(phrase)) problems.push(`${path}: says "${phrase}"`)
  }

  for (const topic of plan.topics) {
    for (const prefix of ['', '/zh-tw']) {
      const path = `${prefix}/${topic}/`
      if (!pageSet.has(path)) problems.push(`required topic page ${path} is missing`)
    }
  }

  for (const path of ['/', '/zh-tw/']) {
    const file = htmlFileOf(dist, path)
    if (!existsSync(file)) {
      problems.push(`landing page ${path} was not built`)
      continue
    }
    const root = parse(readFileSync(file, 'utf8'), HTML_OPTIONS)
    const { lang, prefix } = localeOf(path)
    const main = root.querySelector('main') ?? root
    const links = root.querySelectorAll('a[href]').map((a) => a.getAttribute('href'))
    const hero = main
      .querySelectorAll('img')
      .some((img) => (img.getAttribute('src') ?? '').split('/').pop().startsWith(`${plan.landing.heroScreenshot}.`))
    if (!hero) problems.push(`${path}: no hero screenshot (an image named ${plan.landing.heroScreenshot}.*)`)
    if (!links.includes(LATEST_RELEASE)) problems.push(`${path}: no download link to ${LATEST_RELEASE}`)
    if (!links.some((href) => href.startsWith(`${prefix}/docs/`))) problems.push(`${path}: no link to the documentation`)
    if (!links.some((href) => /^https:\/\/github\.com\/spekhq\/spekterm\/?$/.test(href))) {
      problems.push(`${path}: no link to the source repository`)
    }
    const text = textOf(root)
    for (const name of ['Claude Code', 'OpenSpec']) if (!text.includes(name)) problems.push(`${path}: does not name ${name}`)
    const platforms = strings[lang]?.[plan.landing.platformsString]
    if (!platforms || !text.includes(platforms)) problems.push(`${path}: does not state the platform status`)
  }

  for (const { lang, prefix } of [
    { lang: 'en', prefix: '' },
    { lang: 'zh-TW', prefix: '/zh-tw' },
  ]) {
    const path = `${prefix}/${plan.dataAndNetwork}/`
    const file = htmlFileOf(dist, path)
    if (!existsSync(file)) continue // reported as a missing topic above
    const text = textOf(parse(readFileSync(file, 'utf8'), HTML_OPTIONS))
    for (const keyword of plan.dataAndNetworkKeywords[lang]) {
      if (!text.includes(keyword)) problems.push(`${path}: does not mention "${keyword}"`)
    }
  }

  return problems
}

// ---------------------------------------------------------------------------------------------
// Self-test: a built site that satisfies every rule, and one mutation per rule.

const PLAN = {
  topics: ['docs/a', 'docs/net'],
  dataAndNetwork: 'docs/net',
  landing: { heroScreenshot: 'hero', platformsString: 'landing.platforms' },
  dataAndNetworkKeywords: { en: ['Slack', 'login shell'], 'zh-TW': ['Slack', 'login shell'] },
  linuxOnlyPhrases: ['Linux only', '只支援 Linux'],
}
const STRINGS = { en: { 'landing.platforms': 'Linux builds today.' }, 'zh-TW': { 'landing.platforms': '目前提供 Linux 版本。' } }
const VERSIONS = ['0.2.1', '0.2.2']
const PAGES = ['/', '/zh-tw/', '/docs/', '/zh-tw/docs/', '/docs/a/', '/zh-tw/docs/a/', '/docs/net/', '/zh-tw/docs/net/']

function fakePage(
  path,
  { canonical, switchTo, footer = true, main = '', notices = true, icon = '/favicon.svg', logo = true, share = path.startsWith('/zh-tw/') ? '/og/zh-tw.png' : '/og/en.png' } = {},
) {
  const other = switchTo ?? counterpartOf(path)
  const self = path
  const shareUrl = share ? CANONICAL_ORIGIN + share : null
  return `<!doctype html><html><head><link rel="canonical" href="${canonical ?? CANONICAL_ORIGIN + path}">${icon ? `<link rel="shortcut icon" href="${icon}" type="image/svg+xml">` : ''}${shareUrl ? `<meta property="og:image" content="${shareUrl}"><meta name="twitter:image" content="${shareUrl}">` : ''}</head><body>
<header><a class="site-title" href="/">${logo ? '<img src="/_astro/logo.Ab12.svg" alt="">' : ''}<span>spekterm</span></a></header>
<starlight-lang-select><select><option value="${path.startsWith('/zh-tw/') ? other : self}">English</option><option value="${path.startsWith('/zh-tw/') ? self : other}">繁體中文</option></select></starlight-lang-select>
<main>${main}</main>
<footer>${footer ? '<div class="site-footer"><p class="disclaimer">Not affiliated with Anthropic or the OpenSpec project.</p>' : '<div>'}<p><a href="https://github.com/spekhq/spekterm">Source</a>${notices ? ' <a href="/third-party-notices.txt">Notices</a>' : ''}</p></div></footer>
</body></html>`
}

function landingMain(lang, { hero = true, download = true, platforms = true } = {}) {
  const prefix = lang === 'en' ? '' : '/zh-tw'
  return `<h1>spekterm</h1><p>Claude Code next to OpenSpec.</p>${platforms ? `<p>${STRINGS[lang]['landing.platforms']}</p>` : ''}
${hero ? '<img src="/_astro/hero.Ab12.webp" alt="">' : ''}${download ? `<a href="${LATEST_RELEASE}">Download</a>` : ''}<a href="${prefix}/docs/">Docs</a>`
}

function fakeSite(overrides = {}, { omit = [] } = {}) {
  const files = {
    'sitemap-index.xml': `<sitemapindex><sitemap><loc>${CANONICAL_ORIGIN}/sitemap-0.xml</loc></sitemap></sitemapindex>`,
    'sitemap-0.xml': `<urlset>${PAGES.filter((p) => !omit.includes(p))
      .map((p) => `<url><loc>${CANONICAL_ORIGIN}${p}</loc></url>`)
      .join('')}</urlset>`,
    '404.html': fakePage('/404/'),
    'favicon.svg': '<svg/>',
    'og/en.png': 'png',
    'og/zh-tw.png': 'png',
  }
  for (const path of PAGES) {
    if (omit.includes(path)) continue
    const lang = path.startsWith('/zh-tw/') ? 'zh-TW' : 'en'
    let main = ''
    if (path === '/' || path === '/zh-tw/') main = landingMain(lang)
    // The login shell sits in a highlighted code block, as Starlight renders one: the check must read
    // a code block's text, not its markup.
    if (path.endsWith('/net/')) {
      main = '<p>Slack.</p><pre data-language="bash"><code><div class="ec-line"><span>The</span><span> </span><span>login</span><span> </span><span>shell</span></div></code></pre>'
    }
    files[`${path.slice(1)}index.html`] = fakePage(path, { main })
  }
  return { ...files, ...overrides }
}

const withoutFile = (files, name) => Object.fromEntries(Object.entries(files).filter(([key]) => key !== name))

const run = (structuralOnly) => (dir) => checkContent(dir, { plan: PLAN, strings: STRINGS, versions: VERSIONS, structuralOnly })

function runSelfTest() {
  selfTest('check-content (structural)', {
    pass: fakeSite(),
    check: run(true),
    cases: [
      { label: 'a wrong canonical URL', files: fakeSite({ 'docs/a/index.html': fakePage('/docs/a/', { canonical: 'https://spekterm.pages.dev/docs/a/' }) }), expect: 'canonical URL' },
      { label: 'a language switch to the wrong page', files: fakeSite({ 'docs/a/index.html': fakePage('/docs/a/', { switchTo: '/zh-tw/' }) }), expect: 'does not offer /zh-tw/docs/a/' },
      { label: 'a page without the disclaimer', files: fakeSite({ 'docs/a/index.html': fakePage('/docs/a/', { footer: false }) }), expect: 'non-affiliation' },
      { label: 'the not-found page without the notices link', files: fakeSite({ '404.html': fakePage('/404/', { notices: false }) }), expect: '404.html: no link to the third-party notices' },
      { label: 'a link to a specific release', files: fakeSite({ 'docs/a/index.html': fakePage('/docs/a/', { main: '<a href="https://github.com/spekhq/spekterm/releases/tag/v0.2.1">x</a>' }) }), expect: 'does not target' },
      { label: 'a released version on a page', files: fakeSite({ 'docs/a/index.html': fakePage('/docs/a/', { main: '<p>Spekterm-0.2.1.AppImage</p>' }) }), expect: 'app version 0.2.1' },
      { label: 'no documentation home', files: fakeSite({}, { omit: ['/zh-tw/docs/'] }), expect: '/zh-tw/docs/ is not in the sitemap' },
      { label: 'a declared tab icon that was not built', files: withoutFile(fakeSite(), 'favicon.svg'), expect: 'tab icon /favicon.svg is not in the build' },
      { label: 'a page with no tab icon', files: fakeSite({ 'docs/a/index.html': fakePage('/docs/a/', { icon: null }) }), expect: '/docs/a/: declares no tab icon' },
      { label: 'the not-found page without the logo', files: fakeSite({ '404.html': fakePage('/404/', { logo: false }) }), expect: '404.html: no logo in the header' },
      { label: 'a page without a share image', files: fakeSite({ 'docs/a/index.html': fakePage('/docs/a/', { share: null }) }), expect: 'meta[property="og:image"] is missing' },
      { label: 'a Chinese page with the English share image', files: fakeSite({ 'zh-tw/docs/a/index.html': fakePage('/zh-tw/docs/a/', { share: '/og/en.png' }) }), expect: 'expected https://spekterm.com/og/zh-tw.png' },
      { label: 'a share image that was not built', files: withoutFile(fakeSite(), 'og/zh-tw.png'), expect: 'share image /og/zh-tw.png is not in the build' },
    ],
  })
  // Word boundaries: a longer number that contains a released version is not that version.
  const boundary = run(true)
  const near = fakeSite({ 'docs/a/index.html': fakePage('/docs/a/', { main: '<p>10.2.1 and 0.2.10 and 0.2.1.5</p>' }) })
  selfTest('check-content (version boundaries)', { pass: near, check: boundary, cases: [] })

  selfTest('check-content (content)', {
    pass: fakeSite(),
    check: run(false),
    cases: [
      { label: 'a "Linux only" phrase', files: fakeSite({ 'docs/a/index.html': fakePage('/docs/a/', { main: '<p>spekterm is LINUX ONLY.</p>' }) }), expect: 'says "linux only"' },
      { label: 'a Chinese "Linux only" phrase', files: fakeSite({ 'zh-tw/docs/a/index.html': fakePage('/zh-tw/docs/a/', { main: '<p>目前只支援 Linux。</p>' }) }), expect: 'says "只支援 linux"' },
      { label: 'a missing topic', files: fakeSite({}, { omit: ['/zh-tw/docs/a/'] }), expect: '/zh-tw/docs/a/ is missing' },
      { label: 'a landing page without the hero screenshot', files: fakeSite({ 'index.html': fakePage('/', { main: landingMain('en', { hero: false }) }) }), expect: 'no hero screenshot' },
      { label: 'a landing page without the download link', files: fakeSite({ 'zh-tw/index.html': fakePage('/zh-tw/', { main: landingMain('zh-TW', { download: false }) }) }), expect: '/zh-tw/: no download link' },
      { label: 'a landing page without the platform status', files: fakeSite({ 'index.html': fakePage('/', { main: landingMain('en', { platforms: false }) }) }), expect: 'platform status' },
      { label: 'a data and network page missing a keyword', files: fakeSite({ 'zh-tw/docs/net/index.html': fakePage('/zh-tw/docs/net/', { main: '<p>Slack.</p>' }) }), expect: 'login shell' },
    ],
  })
}

main('check-content', {
  selfTest: runSelfTest,
  run: () =>
    checkContent(DIST, {
      plan: JSON.parse(readFileSync(join(SITE_ROOT, 'src/content-plan.json'), 'utf8')),
      strings: readStrings(SITE_ROOT),
      versions: appVersions(),
      structuralOnly: process.argv.includes('--structural-only'),
    }),
})
