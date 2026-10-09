/**
 * project-website: Google Analytics loads only after consent where consent is required — the consent
 * script every page of the site carries in its head (`site/src/analytics.mjs`), run against a stand-in
 * document. The build half (no static Google tag) is check-origins' self-test.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { CONSENT_KEY, CONSENT_SCRIPT, GA_SCRIPT_URL, consentAction } from '../site/src/analytics.mjs'

/** Runs the page's consent script once, as a page opening would, and returns handles on what it did. */
function open({ timeZone, stored, cookies = [] }) {
  const loaded = []
  const cookieWrites = []
  const listeners = {}
  const storage = new Map(stored ? [[CONSENT_KEY, stored]] : [])
  const banner = { hidden: true }
  class Element {}
  const document = {
    head: { appendChild: (script) => loaded.push(script.src) },
    createElement: () => ({}),
    addEventListener: (type, listener) => (listeners[type] ??= []).push(listener),
    getElementById: (id) => (id === 'analytics-consent' ? banner : null),
    get cookie() {
      return cookies.join('; ')
    },
    set cookie(value) {
      cookieWrites.push(value)
    },
  }
  const context = {
    document,
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }) },
    location: { hostname: 'spekterm.com' },
    Element,
    Date,
  }
  context.window = context
  vm.runInNewContext(CONSENT_SCRIPT, context)
  for (const listener of listeners.DOMContentLoaded ?? []) listener()
  const click = (attributes) => {
    const target = Object.assign(new Element(), {
      closest: (selector) =>
        (selector === '[data-consent-open]' && attributes.open) || (selector === '[data-consent]' && attributes.consent)
          ? target
          : null,
      getAttribute: () => attributes.consent,
    })
    for (const listener of listeners.click ?? []) listener({ target })
  }
  return { loaded, banner, storage, cookieWrites, click }
}

test('a reader in a European time zone is asked, and nothing loads before an answer', () => {
  for (const timeZone of ['Europe/Berlin', 'Europe/London', 'Europe/Zurich', 'Asia/Nicosia', 'Atlantic/Canary', 'Indian/Reunion']) {
    const page = open({ timeZone })
    assert.deepEqual(page.loaded, [], timeZone)
    assert.equal(page.banner.hidden, false, timeZone)
  }
})

test('a reader whose time zone cannot be read is asked', () => {
  assert.equal(consentAction(undefined, null), 'ask')
  assert.deepEqual(open({ timeZone: undefined }).loaded, [])
})

test('a reader elsewhere is not asked and Google Analytics loads', () => {
  for (const timeZone of ['Asia/Taipei', 'America/New_York', 'Australia/Sydney']) {
    const page = open({ timeZone })
    assert.deepEqual(page.loaded, [GA_SCRIPT_URL], timeZone)
    assert.equal(page.banner.hidden, true, timeZone)
  }
})

test('a stored choice wins, in Europe and elsewhere', () => {
  assert.deepEqual(open({ timeZone: 'Europe/Paris', stored: 'granted' }).loaded, [GA_SCRIPT_URL])
  const declined = open({ timeZone: 'Asia/Taipei', stored: 'denied' })
  assert.deepEqual(declined.loaded, [])
  assert.equal(declined.banner.hidden, true)
})

test('allowing loads Google Analytics and keeps the choice', () => {
  const page = open({ timeZone: 'Europe/Berlin' })
  page.click({ consent: 'granted' })
  assert.deepEqual(page.loaded, [GA_SCRIPT_URL])
  assert.equal(page.storage.get(CONSENT_KEY), 'granted')
  assert.equal(page.banner.hidden, true)
})

test('declining loads nothing, keeps the choice, and removes Google Analytics cookies', () => {
  const page = open({ timeZone: 'Europe/Berlin', cookies: ['_ga=GA1.1.1', '_ga_5N01XLX2PL=GS1.1', 'other=1'] })
  page.click({ consent: 'denied' })
  assert.deepEqual(page.loaded, [])
  assert.equal(page.storage.get(CONSENT_KEY), 'denied')
  assert.equal(page.banner.hidden, true)
  const expired = page.cookieWrites.map((write) => write.split('=')[0])
  assert.ok(expired.includes('_ga') && expired.includes('_ga_5N01XLX2PL'), expired.join(', '))
  assert.ok(!expired.includes('other'))
  assert.ok(page.cookieWrites.every((write) => write.includes('expires=Thu, 01 Jan 1970')))
})

test('the footer button shows the banner again', () => {
  const page = open({ timeZone: 'Asia/Taipei' })
  assert.equal(page.banner.hidden, true)
  page.click({ open: true })
  assert.equal(page.banner.hidden, false)
})
