/**
 * The site's brand images, all derived from the app's own icon (`build/icon.svg`):
 *
 *   src/assets/logo.svg            the header logo and the landing page's hero image
 *   public/favicon.svg             the tab icon Starlight declares on every page
 *   public/apple-touch-icon.png    the home-screen icon (180×180)
 *   public/og/<lang>.png           the share preview per language (1200×630)
 *
 * The outputs are committed; run this after the app icon or a landing page title changes. The share
 * preview's title is read from the landing page's `hero.title`, so the two cannot drift apart. Text is
 * rendered through fontconfig, so the result depends on the installed fonts (Noto Sans CJK TC is the
 * one asked for) — review the images before committing them.
 *
 * Usage: node scripts/make-brand-images.mjs
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { SITE_ROOT, repoRoot } from './lib.mjs'

const ICON = join(repoRoot(), 'build', 'icon.svg')

/** Per language: where its landing page is, its share image, and the line under the title. */
const LANGUAGES = [
  { lang: 'en', page: 'src/content/docs/index.mdx', out: 'public/og/en.png', line: 'Claude Code sessions for every repository, next to their OpenSpec changes.' },
  { lang: 'zh-TW', page: 'src/content/docs/zh-tw/index.mdx', out: 'public/og/zh-tw.png', line: '每個 repository 的 Claude Code session，旁邊就是它的 OpenSpec change。' },
]

const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function heroTitle(page) {
  const source = readFileSync(join(SITE_ROOT, page), 'utf8')
  const match = /^hero:\s*\n\s+title:\s*(.+)$/m.exec(source)
  if (!match) throw new Error(`${page}: no hero.title`)
  return match[1].trim()
}

/** The icon's inner markup, placed as a nested <svg> so its gradients keep their own coordinates. */
function iconElement(x, y, size) {
  const svg = readFileSync(ICON, 'utf8')
  return svg.replace('<svg ', `<svg x="${x}" y="${y}" width="${size}" height="${size}" `)
}

function card({ title, line }) {
  const font = "'Noto Sans CJK TC', 'Noto Sans', sans-serif"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1a1d23"/><stop offset="1" stop-color="#0b0d10"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="1200" height="6" fill="#f59e0b"/>
  ${iconElement(96, 96, 112)}
  <text x="236" y="172" font-family="${font}" font-size="52" font-weight="700" fill="#f59e0b">spekterm</text>
  <text x="96" y="340" font-family="${font}" font-size="76" font-weight="700" fill="#ffffff">${escapeXml(title)}</text>
  ${wrap(line, 60).map((text, i) => `<text x="96" y="${415 + i * 46}" font-family="${font}" font-size="34" fill="#c0c6d0">${escapeXml(text)}</text>`).join('\n  ')}
  <text x="96" y="560" font-family="${font}" font-size="28" fill="#8a93a0">spekterm.com</text>
</svg>`
}

/** Break a line at spaces (or anywhere, for text without spaces) into chunks of at most `width` columns (a CJK character is two). */
function wrap(text, width) {
  const columns = (s) => [...s].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)
  const words = text.includes(' ') ? text.split(' ') : [...text]
  const joiner = text.includes(' ') ? ' ' : ''
  const lines = ['']
  for (const word of words) {
    const current = lines[lines.length - 1]
    const next = current ? current + joiner + word : word
    if (columns(next) > width && current) lines.push(word)
    else lines[lines.length - 1] = next
  }
  return lines
}

function out(file) {
  const path = join(SITE_ROOT, file)
  mkdirSync(dirname(path), { recursive: true })
  return path
}

copyFileSync(ICON, out('src/assets/logo.svg'))
copyFileSync(ICON, out('public/favicon.svg'))
await sharp(ICON, { density: 300 }).resize(180, 180).png().toFile(out('public/apple-touch-icon.png'))
for (const { page, out: file, line } of LANGUAGES) {
  await sharp(Buffer.from(card({ title: heroTitle(page), line }))).png().toFile(out(file))
}
console.log('brand images written')
