/**
 * project-website: Google Analytics, loaded only after consent where consent is required.
 *
 * Nothing in the built pages loads the Google tag (check-origins fails the build if one does); the
 * consent script below adds it at run time when the reader's choice, or the absence of a need to ask,
 * allows it. A static tag would load before anyone was asked.
 *
 * Whether to ask is decided in the browser from the time zone: the hosting serves every reader the
 * same bytes (the live check), so it cannot vary the page by country. A time zone is an approximation —
 * a VPN or a changed system zone defeats it.
 */
export const GA_MEASUREMENT_ID = 'G-5N01XLX2PL'

export const GA_SCRIPT_URL = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`

/** Where the reader's choice is kept: `granted` or `denied`. */
export const CONSENT_KEY = 'spekterm.analytics-consent'

/**
 * What a page does when it opens: `load` Google Analytics, `ask` (show the banner), or `none`.
 * A stored choice wins everywhere; without one, readers in a time zone of the EEA, the UK, or
 * Switzerland are asked (every `Europe/*` zone, plus the ones listed), and so is a reader whose time
 * zone cannot be read. Self-contained — its source is
 * inlined into every page, so it may not refer to anything outside itself.
 */
export function consentAction(timeZone, stored) {
  if (stored === 'granted') return 'load'
  if (stored === 'denied') return 'none'
  const zones = [
    'Africa/Ceuta', 'America/Cayenne', 'America/Guadeloupe', 'America/Marigot', 'America/Martinique',
    'Arctic/Longyearbyen', 'Asia/Famagusta', 'Asia/Nicosia', 'Atlantic/Azores', 'Atlantic/Canary',
    'Atlantic/Faroe', 'Atlantic/Madeira', 'Atlantic/Reykjavik', 'Indian/Mayotte', 'Indian/Reunion',
    'CET', 'EET', 'MET', 'WET',
  ]
  if (typeof timeZone !== 'string') return 'ask'
  return timeZone.startsWith('Europe/') || zones.includes(timeZone) ? 'ask' : 'load'
}

/**
 * The page side: decides on open, loads the tag, and wires the banner (`#analytics-consent`, buttons
 * with `data-consent="granted|denied"`) and the footer's settings button (`data-consent-open`).
 * Declining after having allowed removes Google Analytics' cookies; the tag already running on that
 * page is told consent is withdrawn.
 */
export const CONSENT_SCRIPT = `(() => {
  const consentAction = ${consentAction.toString()}
  const key = ${JSON.stringify(CONSENT_KEY)}
  let stored = null
  try { stored = localStorage.getItem(key) } catch {}
  let timeZone
  try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } catch {}
  const load = () => {
    if (window.gtag) return
    window.dataLayer = window.dataLayer || []
    window.gtag = function () { dataLayer.push(arguments) }
    gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' })
    gtag('js', new Date())
    gtag('config', ${JSON.stringify(GA_MEASUREMENT_ID)})
    const script = document.createElement('script')
    script.async = true
    script.src = ${JSON.stringify(GA_SCRIPT_URL)}
    document.head.appendChild(script)
  }
  const banner = () => document.getElementById('analytics-consent')
  const action = consentAction(timeZone, stored)
  if (action === 'load') load()
  if (action === 'ask') document.addEventListener('DOMContentLoaded', () => { const b = banner(); if (b) b.hidden = false })
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null
    if (target && target.closest('[data-consent-open]')) { const b = banner(); if (b) b.hidden = false; return }
    const choice = target && target.closest('[data-consent]')
    if (!choice) return
    const value = choice.getAttribute('data-consent') === 'granted' ? 'granted' : 'denied'
    try { localStorage.setItem(key, value) } catch {}
    const b = banner()
    if (b) b.hidden = true
    if (value === 'granted') { load(); return }
    if (window.gtag) gtag('consent', 'update', { analytics_storage: 'denied' })
    for (const cookie of document.cookie.split(';')) {
      const name = cookie.split('=')[0].trim()
      if (!name.startsWith('_ga')) continue
      for (const domain of ['', '; domain=' + location.hostname, '; domain=.' + location.hostname.replace(/^www\\./, '')]) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + domain
      }
    }
  })
})()`

/** Starlight `head` entries: the consent script, on every page (the not-found page included). */
export const ANALYTICS_HEAD = [{ tag: /** @type {const} */ ('script'), content: CONSENT_SCRIPT }]
