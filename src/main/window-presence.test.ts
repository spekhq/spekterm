import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createWindowPresence } from './window-presence'

function world(initial: number | null) {
  let live = initial
  let next = 100
  const log: string[] = []
  const presence = createWindowPresence({
    existing: () => live,
    create: () => {
      live = next++
      log.push(`create ${live}`)
      return live
    },
    bringToFront: () => log.push('front'),
    readyTimeoutMs: 50,
  })
  return { presence, log, close: () => (live = null) }
}

const settled = async (promise: Promise<void>) => {
  let done = false
  void promise.then(() => (done = true))
  await new Promise((resolve) => setImmediate(resolve))
  return done
}

describe('window presence', () => {
  it('with no window, creates one and waits until its renderer is ready', async () => {
    const { presence, log } = world(null)
    const ensured = presence.ensure()
    assert.deepEqual(log, ['create 100', 'front'])
    assert.equal(await settled(ensured), false, 'acted before the renderer was ready')
    presence.rendererReady(100)
    assert.equal(await settled(ensured), true)
  })

  it('with a ready window, brings it to front and acts at once', async () => {
    const { presence, log } = world(7)
    presence.rendererReady(7)
    assert.equal(await settled(presence.ensure()), true)
    assert.deepEqual(log, ['front'])
  })

  it('a renderer that went away must say it is ready again', async () => {
    const { presence } = world(7)
    presence.rendererReady(7)
    presence.rendererGone(7)
    const ensured = presence.ensure()
    assert.equal(await settled(ensured), false)
    presence.rendererReady(7)
    assert.equal(await settled(ensured), true)
  })

  it('a renderer that never says it is ready does not hold the action for ever', async () => {
    const { presence } = world(null)
    const started = Date.now()
    await presence.ensure()
    assert.ok(Date.now() - started >= 40)
  })
})
