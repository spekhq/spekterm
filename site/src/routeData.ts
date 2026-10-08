import { defineRouteMiddleware } from '@astrojs/starlight/route-data'
import { useStrings } from './i18n'

/**
 * The share preview: every page names the image in its own language (`scripts/make-brand-images.mjs`
 * writes them). Starlight already declares `twitter:card` as `summary_large_image`; without an image
 * the card has nothing to show.
 */
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute
  const lang = route.lang === 'zh-TW' ? 'zh-tw' : 'en'
  const image = new URL(`/og/${lang}.png`, context.site).href
  const alt = useStrings(route.lang)('social.imageAlt')
  route.head.push(
    { tag: 'meta', attrs: { property: 'og:image', content: image }, content: '' },
    { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' }, content: '' },
    { tag: 'meta', attrs: { property: 'og:image:height', content: '630' }, content: '' },
    { tag: 'meta', attrs: { property: 'og:image:alt', content: alt }, content: '' },
    { tag: 'meta', attrs: { name: 'twitter:image', content: image }, content: '' },
  )
})
