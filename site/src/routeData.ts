import { defineRouteMiddleware } from '@astrojs/starlight/route-data'
import type { StarlightRouteData } from '@astrojs/starlight/route-data'
import { useStrings } from './i18n'
import { PRODUCTS, productOf } from './product.mjs'

type SidebarEntry = StarlightRouteData['sidebar'][number]
type SidebarLink = Extract<SidebarEntry, { type: 'link' }>

function linksOf(entries: SidebarEntry[]): SidebarLink[] {
  return entries.flatMap((entry) => (entry.type === 'link' ? [entry] : linksOf(entry.entries)))
}

/**
 * Everything that differs per product (project-website: "The site serves two products", "Product-specific
 * parts follow the page's product", "Every page carries the brand and a share preview"), applied to the
 * route data Starlight hands every page — the not-found page included — before it renders.
 */
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute
  const productId = productOf(context.url.pathname)
  const product = PRODUCTS[productId]
  const lang = route.lang === 'zh-TW' ? 'zh-TW' : 'en'
  const t = useStrings(route.lang)

  // Brand: one tab icon (Starlight's, re-pointed — a second link would leave the choice to the browser),
  // the home-screen icon, and the share image in the page's language.
  for (const entry of route.head) {
    if (entry.tag === 'link' && String(entry.attrs?.rel ?? '').split(/\s+/).includes('icon')) {
      entry.attrs = { ...entry.attrs, href: product.favicon }
    }
  }
  const image = new URL(product.share[lang], context.site).href
  route.head.push(
    { tag: 'link', attrs: { rel: 'apple-touch-icon', href: product.homeIcon }, content: '' },
    { tag: 'meta', attrs: { property: 'og:image', content: image }, content: '' },
    { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' }, content: '' },
    { tag: 'meta', attrs: { property: 'og:image:height', content: '630' }, content: '' },
    { tag: 'meta', attrs: { property: 'og:image:alt', content: t(product.shareAltKey as 'social.imageAlt') }, content: '' },
    { tag: 'meta', attrs: { name: 'twitter:image', content: image }, content: '' },
  )

  // The site name Starlight derived from the config title (spekterm) — the title suffix and
  // og:site_name — is the page's product's.
  if (productId !== 'spekterm') {
    const suffix = ` | ${PRODUCTS.spekterm.name}`
    for (const entry of route.head) {
      if (entry.tag === 'title' && typeof entry.content === 'string' && entry.content.endsWith(suffix)) {
        entry.content = `${entry.content.slice(0, -suffix.length)} | ${product.name}`
      }
      if (entry.tag === 'meta' && entry.attrs?.property === 'og:site_name') {
        entry.attrs = { ...entry.attrs, content: product.name }
      }
    }
  }

  // Sidebar and previous / next stay within the product. Starlight builds both from the whole sidebar;
  // its pagination function is not exported, so it is recomputed here from the filtered list
  // (frontmatter prev / next are not honored — check-content fails if a page uses them).
  route.sidebar = route.sidebar.filter((entry) => {
    const own = linksOf([entry])
    return own.length > 0 && own.every((link) => productOf(link.href) === productId)
  })
  const links = linksOf(route.sidebar)
  const current = links.findIndex((link) => link.isCurrent)
  route.pagination = {
    prev: current > 0 ? links[current - 1] : undefined,
    next: current >= 0 && current < links.length - 1 ? links[current + 1] : undefined,
  }
})
