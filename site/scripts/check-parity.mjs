/**
 * project-website: Both languages carry the same pages (design D3).
 *
 * Fails when a page, a component string, or a screenshot exists in one language only.
 *
 * Pages are judged on the **source content tree**, not the sitemap: Starlight generates a fallback
 * page for a missing translation and lists it in the sitemap (measured), so a sitemap comparison
 * would always be equal.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { main, SITE_ROOT, selfTest, walk } from './lib.mjs'

const CONTENT = 'src/content/docs'
const ZH = 'zh-tw/'
const PAGE = /\.(md|mdx|mdoc)$/
const SHOTS = 'src/assets/screenshots'

export function checkParity(siteDir) {
  const problems = []

  const content = walk(join(siteDir, CONTENT)).filter((file) => PAGE.test(file))
  const slug = (file) => file.replace(PAGE, '')
  const en = new Set(content.filter((file) => !file.startsWith(ZH)).map(slug))
  const zh = new Set(content.filter((file) => file.startsWith(ZH)).map((file) => slug(file.slice(ZH.length))))
  for (const page of en) if (!zh.has(page)) problems.push(`page "${page}" has no Traditional Chinese counterpart`)
  for (const page of zh) if (!en.has(page)) problems.push(`page "zh-tw/${page}" has no English counterpart`)

  const strings = (lang) => {
    const file = join(siteDir, 'src/i18n', `${lang}.json`)
    return existsSync(file) ? Object.keys(JSON.parse(readFileSync(file, 'utf8'))) : []
  }
  const enKeys = new Set(strings('en'))
  const zhKeys = new Set(strings('zh-TW'))
  for (const key of enKeys) if (!zhKeys.has(key)) problems.push(`string "${key}" is missing from zh-TW.json`)
  for (const key of zhKeys) if (!enKeys.has(key)) problems.push(`string "${key}" is missing from en.json`)

  const shots = (lang) => new Set(walk(join(siteDir, SHOTS, lang)))
  const enShots = shots('en')
  const zhShots = shots('zh-TW')
  for (const shot of enShots) if (!zhShots.has(shot)) problems.push(`screenshot "${shot}" exists for en only`)
  for (const shot of zhShots) if (!enShots.has(shot)) problems.push(`screenshot "${shot}" exists for zh-TW only`)

  return problems
}

const PASS = {
  'src/content/docs/index.mdx': '',
  'src/content/docs/docs/install.md': '',
  'src/content/docs/zh-tw/index.mdx': '',
  'src/content/docs/zh-tw/docs/install.md': '',
  'src/i18n/en.json': '{"a":"A","b":"B"}',
  'src/i18n/zh-TW.json': '{"a":"甲","b":"乙"}',
  'src/assets/screenshots/en/hero.png': 'x',
  'src/assets/screenshots/zh-TW/hero.png': 'y',
}
const without = (key) => Object.fromEntries(Object.entries(PASS).filter(([k]) => k !== key))

main('check-parity', {
  selfTest: () =>
    selfTest('check-parity', {
      pass: PASS,
      check: checkParity,
      cases: [
        { label: 'an English-only page', files: without('src/content/docs/zh-tw/docs/install.md'), expect: '"docs/install"' },
        { label: 'a Chinese-only page', files: { ...PASS, 'src/content/docs/zh-tw/docs/extra.mdx': '' }, expect: 'zh-tw/docs/extra' },
        { label: 'a one-language string', files: { ...PASS, 'src/i18n/en.json': '{"a":"A","b":"B","c":"C"}' }, expect: '"c"' },
        { label: 'a one-language screenshot', files: without('src/assets/screenshots/zh-TW/hero.png'), expect: '"hero.png"' },
      ],
    }),
  run: () => checkParity(SITE_ROOT),
})
