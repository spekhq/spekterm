/**
 * project-website: "spekterm.com is the canonical host" — the redirect logic the site's Pages middleware
 * applies (`site/functions/_middleware.js`). The live check (`site/scripts/check-live.mjs`) verifies the
 * deployed behavior; this pins the logic so a change to it is caught before a deploy.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequest, redirectFor } from '../site/functions/_middleware.js'

test('each redirecting host goes to spekterm.com with the path and query kept', () => {
  for (const host of ['www.spekterm.com', 'spekterm.app', 'www.spekterm.app']) {
    assert.equal(redirectFor(`https://${host}/docs/install/?x=1`), 'https://spekterm.com/docs/install/?x=1')
    assert.equal(redirectFor(`http://${host}/`), 'https://spekterm.com/')
  }
})

test('the canonical host and the pages.dev host are served, not redirected', () => {
  assert.equal(redirectFor('https://spekterm.com/docs/'), null)
  assert.equal(redirectFor('https://spekterm.pages.dev/docs/'), null)
  assert.equal(redirectFor('https://abc123.spekterm.pages.dev/'), null)
})

test('the middleware answers 301 for a redirecting host and passes everything else on', async () => {
  const redirected = await onRequest({ request: new Request('https://spekterm.app/a?b=1'), next: () => 'served' })
  assert.equal(redirected.status, 301)
  assert.equal(redirected.headers.get('location'), 'https://spekterm.com/a?b=1')
  assert.equal(await onRequest({ request: new Request('https://spekterm.com/a'), next: () => 'served' }), 'served')
})
