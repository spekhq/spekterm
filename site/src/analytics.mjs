/**
 * project-website: the one resource the site loads from another origin — the Google Analytics tag,
 * which tells where readers come from. Shared by the config that puts it on every page and by
 * check-origins, which allows exactly this URL and nothing else from another origin.
 */
export const GA_MEASUREMENT_ID = 'G-5N01XLX2PL'

export const GA_SCRIPT_URL = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`

/**
 * Starlight `head` entries: the tag and its configuration, on every page (the not-found page included).
 * @type {{ tag: 'script', attrs?: Record<string, string | boolean>, content?: string }[]}
 */
export const GA_HEAD = [
  { tag: 'script', attrs: { async: true, src: GA_SCRIPT_URL } },
  {
    tag: 'script',
    content: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${GA_MEASUREMENT_ID}')`,
  },
]
