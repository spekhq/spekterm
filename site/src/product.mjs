/**
 * The two products the site serves (project-website: "The site serves two products") and everything
 * that differs between them. Plain JavaScript holding path strings only, so that the site and
 * `scripts/check-content.mjs` share it — the check runs in plain Node and cannot import images.
 */

/** @typedef {'spekterm' | 'spek'} Product */

export const PRODUCTS = {
  spekterm: {
    name: 'spekterm',
    landing: '/',
    repository: 'https://github.com/spekhq/spekterm',
    license: 'https://github.com/spekhq/spekterm/blob/master/LICENSE',
    favicon: '/favicon.svg',
    homeIcon: '/apple-touch-icon.png',
    share: { en: '/og/en.png', 'zh-TW': '/og/zh-tw.png' },
    shareAltKey: 'social.imageAlt',
    /** The built header logo's file name starts with this (Astro appends a hash). */
    logoPrefix: 'logo.',
  },
  spek: {
    name: 'spek',
    landing: '/spek/',
    repository: 'https://github.com/spekhq/spek',
    license: 'https://github.com/spekhq/spek/blob/master/LICENSE',
    favicon: '/spek-favicon.svg',
    homeIcon: '/spek-apple-touch-icon.png',
    share: { en: '/og/spek-en.png', 'zh-TW': '/og/spek-zh-tw.png' },
    shareAltKey: 'social.spekImageAlt',
    logoPrefix: 'spek-logomark.',
  },
}

const ZH = '/zh-tw'

/** A path without its locale prefix (`/zh-tw/spek/` → `/spek/`). */
function unlocalized(path) {
  return path === ZH || path.startsWith(`${ZH}/`) ? path.slice(ZH.length) || '/' : path
}

/**
 * The product a page belongs to: spek when its path, without the locale prefix, starts with `/spek/`
 * (or is `/spek`); everything else — the not-found page included — is spekterm.
 * @param {string} path
 * @returns {Product}
 */
export function productOf(path) {
  const p = unlocalized(path)
  return p === '/spek' || p.startsWith('/spek/') ? 'spek' : 'spekterm'
}

/** @param {Product} product */
export function otherProduct(product) {
  return product === 'spek' ? 'spekterm' : 'spek'
}

/**
 * A product's landing page in a language.
 * @param {Product} product
 * @param {string | undefined} lang
 */
export function landingOf(product, lang) {
  return `${lang === 'zh-TW' ? ZH : ''}${PRODUCTS[product].landing}`
}
