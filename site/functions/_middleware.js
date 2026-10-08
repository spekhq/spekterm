/**
 * Host redirects (project-website: "spekterm.com is the canonical host").
 *
 * `www.spekterm.com`, `spekterm.app`, and `www.spekterm.app` are custom domains of the same Pages project;
 * this middleware answers them with a permanent redirect to `https://spekterm.com`, keeping the path and
 * query. Doing it here rather than with zone redirect rules needs no permission beyond the Pages
 * project's own (design D7). The project's `*.pages.dev` host is deliberately left alone — every page
 * names its canonical URL, and that host is where a deployment can be checked before it is live.
 */
export const CANONICAL_HOST = 'spekterm.com'
export const REDIRECTED_HOSTS = new Set(['www.spekterm.com', 'spekterm.app', 'www.spekterm.app'])

/** The redirect for a request URL, or `null` to serve it. */
export function redirectFor(requestUrl) {
  const url = new URL(requestUrl)
  if (!REDIRECTED_HOSTS.has(url.hostname)) return null
  return `https://${CANONICAL_HOST}${url.pathname}${url.search}`
}

export async function onRequest(context) {
  const target = redirectFor(context.request.url)
  if (target) return Response.redirect(target, 301)
  return context.next()
}
