/**
 * project-website: The site does not track its readers — the build half (design D8.1).
 *
 * Every resource a built page or style sheet makes the browser load must be same-origin or a
 * `data:` URL. Hyperlinks (`<a href>`) load nothing and are allowed.
 *
 * Parsed, not grepped: Starlight's CSS contains `data:image/svg+xml…` with an
 * `http://www.w3.org/2000/svg` namespace inside it, which a regex over the file reports as a load.
 * Astro inlines small component styles into the page (measured), so `<style>` elements and `style`
 * attributes are read as well as the CSS files.
 *
 * What a script requests at run time is not visible here; the site's scripts make no such request
 * (project-website).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'node-html-parser'
import { CANONICAL_ORIGIN, DIST, main, selfTest, walk, HTML_OPTIONS } from './lib.mjs'

/** Attributes that make the browser load something, per element. */
const LOADS = {
  script: ['src'],
  link: ['href'],
  img: ['src', 'srcset'],
  source: ['src', 'srcset'],
  iframe: ['src'],
  video: ['src', 'poster'],
  audio: ['src'],
  track: ['src'],
  embed: ['src'],
  object: ['data'],
  input: ['src'],
}

/** `<link>` relations that name a URL without loading it. */
const NON_LOADING_LINKS = new Set(['canonical', 'alternate', 'sitemap', 'author', 'license', 'me', 'help', 'search'])

function isForeign(url) {
  const value = url.trim()
  if (value === '' || value.startsWith('data:') || value.startsWith('#')) return false
  try {
    return new URL(value, `${CANONICAL_ORIGIN}/`).origin !== CANONICAL_ORIGIN
  } catch {
    return true
  }
}

function srcsetUrls(value) {
  return value
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean)
}

/** URLs in `url(...)` and `@import` of a piece of CSS, read token by token. */
export function cssUrls(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const urls = []
  let i = 0
  while (i < source.length) {
    const at = source.indexOf('url(', i)
    if (at === -1) break
    let j = at + 4
    while (/\s/.test(source[j] ?? '')) j++
    const quote = source[j] === '"' || source[j] === "'" ? source[j] : null
    let value = ''
    if (quote) {
      j++
      while (j < source.length && source[j] !== quote) {
        if (source[j] === '\\') j++
        value += source[j++]
      }
      j++
    } else {
      while (j < source.length && source[j] !== ')') value += source[j++]
    }
    urls.push(value.trim())
    i = j
  }
  for (const m of source.matchAll(/@import\s+(["'])(.*?)\1/g)) urls.push(m[2])
  return urls
}

export function checkOrigins(dist) {
  const problems = []
  for (const file of walk(dist)) {
    if (file.endsWith('.css')) {
      for (const url of cssUrls(readFileSync(join(dist, file), 'utf8'))) {
        if (isForeign(url)) problems.push(`${file}: style sheet loads ${url}`)
      }
    }
    if (!file.endsWith('.html')) continue
    const root = parse(readFileSync(join(dist, file), 'utf8'), HTML_OPTIONS)
    for (const [tag, attributes] of Object.entries(LOADS)) {
      for (const el of root.querySelectorAll(tag)) {
        if (tag === 'link') {
          const rel = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/)
          if (rel.every((r) => NON_LOADING_LINKS.has(r))) continue
        }
        for (const attribute of attributes) {
          const value = el.getAttribute(attribute)
          if (value == null) continue
          const urls = attribute === 'srcset' ? srcsetUrls(value) : [value]
          for (const url of urls) if (isForeign(url)) problems.push(`${file}: <${tag} ${attribute}> loads ${url}`)
        }
      }
    }
    for (const el of root.querySelectorAll('style')) {
      for (const url of cssUrls(el.textContent)) if (isForeign(url)) problems.push(`${file}: <style> loads ${url}`)
    }
    for (const el of root.querySelectorAll('[style]')) {
      for (const url of cssUrls(el.getAttribute('style') ?? '')) {
        if (isForeign(url)) problems.push(`${file}: style attribute loads ${url}`)
      }
    }
  }
  return problems
}

const page = (head, body = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`
const PASS = {
  'index.html': page(
    '<link rel="stylesheet" href="/_astro/common.css"><link rel="canonical" href="https://spekterm.com/"><link rel="alternate" hreflang="zh-TW" href="https://spekterm.com/zh-tw/"><script type="module" src="/_astro/page.js"></script><style>.a{background:url(/_astro/a.png)}</style>',
    '<a href="https://github.com/spekhq/spekterm">repo</a><img src="/_astro/hero.webp" srcset="/_astro/hero.webp 1x, /_astro/hero@2.webp 2x"><div style="background:url(\'data:image/png;base64,AAAA\')"></div>',
  ),
  // Starlight's CSS embeds an SVG whose namespace is an http: URL inside a data: URL.
  '_astro/common.css':
    '.x{background-image:url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\'></svg>")}.y{background:url(/_astro/y.svg)}',
}
const withPage = (head, body) => ({ ...PASS, 'other/index.html': page(head, body) })

main('check-origins', {
  selfTest: () =>
    selfTest('check-origins', {
      pass: PASS,
      check: checkOrigins,
      cases: [
        { label: 'a cross-origin script', files: withPage('<script src="https://cdn.example.com/a.js"></script>'), expect: 'cdn.example.com' },
        { label: 'a cross-origin style sheet', files: withPage('<link rel="stylesheet" href="https://fonts.example.com/f.css">'), expect: 'fonts.example.com' },
        { label: 'an inline-style background', files: withPage('<style>.x{background:url(https://example.com/bg.png)}</style>'), expect: 'example.com/bg.png' },
        { label: 'a style attribute', files: withPage('', '<div style="background:url(//track.example.net/p.gif)"></div>'), expect: 'track.example.net' },
        { label: 'a srcset candidate', files: withPage('', '<img src="/a.png" srcset="/a.png 1x, https://img.example.org/a.png 2x">'), expect: 'img.example.org' },
        { label: 'a frame', files: withPage('', '<iframe src="https://embed.example.com/x"></iframe>'), expect: 'embed.example.com' },
        { label: 'a font in a CSS file', files: { ...PASS, '_astro/f.css': '@font-face{src:url("https://fonts.example.com/x.woff2")}' }, expect: 'x.woff2' },
        { label: 'a CSS @import', files: { ...PASS, '_astro/g.css': '@import "https://cdn.example.com/g.css";' }, expect: 'cdn.example.com/g.css' },
      ],
    }),
  run: () => checkOrigins(DIST),
})
