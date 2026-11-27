import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { agentOrigin, ANTHROPIC_API_ORIGIN, checkReachable, type ReachabilityAttempt } from './agent-reachability'

describe('agentOrigin (handoff-waits-for-network, D2)', () => {
  it('no setting: the Anthropic API', () => {
    assert.equal(agentOrigin({}, true), ANTHROPIC_API_ORIGIN)
  })

  it('the check turned off: no check', () => {
    assert.equal(agentOrigin({}, false), null)
  })

  it('another provider selected: no check', () => {
    for (const name of ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) {
      assert.equal(agentOrigin({ [name]: '1' }, true), null, name)
      assert.equal(agentOrigin({ [name]: 'true' }, true), null, name)
    }
  })

  it('a provider switch left off keeps the check', () => {
    for (const value of ['', '0', 'false', 'NO', 'off', ' False ']) {
      assert.equal(agentOrigin({ CLAUDE_CODE_USE_BEDROCK: value }, true), ANTHROPIC_API_ORIGIN, JSON.stringify(value))
    }
  })

  it('ANTHROPIC_BASE_URL: its origin, the path dropped', () => {
    assert.equal(agentOrigin({ ANTHROPIC_BASE_URL: 'https://gateway.example.com/anthropic/v1' }, true), 'https://gateway.example.com')
    assert.equal(agentOrigin({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:8123' }, true), 'http://127.0.0.1:8123')
  })

  it('an empty ANTHROPIC_BASE_URL is as unset', () => {
    assert.equal(agentOrigin({ ANTHROPIC_BASE_URL: '' }, true), ANTHROPIC_API_ORIGIN)
    assert.equal(agentOrigin({ ANTHROPIC_BASE_URL: '  ' }, true), ANTHROPIC_API_ORIGIN)
  })

  it('an ANTHROPIC_BASE_URL that is not an http(s) URL: no check', () => {
    assert.equal(agentOrigin({ ANTHROPIC_BASE_URL: 'not a url' }, true), null)
    assert.equal(agentOrigin({ ANTHROPIC_BASE_URL: 'ftp://example.com' }, true), null)
  })

  it('a provider switch wins over ANTHROPIC_BASE_URL', () => {
    assert.equal(agentOrigin({ CLAUDE_CODE_USE_VERTEX: '1', ANTHROPIC_BASE_URL: 'https://g.example.com' }, true), null)
  })
})

describe('checkReachable (D1)', () => {
  const attempt = (done: Promise<boolean>, onAbort: () => void = () => {}): ReachabilityAttempt => ({ done, abort: onAbort })

  it('passes the origin and returns the answer', async () => {
    const seen: string[] = []
    const yes = await checkReachable('https://a.example', (origin) => (seen.push(origin), attempt(Promise.resolve(true))), 1000)
    const no = await checkReachable('https://b.example', () => attempt(Promise.resolve(false)), 1000)
    assert.equal(yes, true)
    assert.equal(no, false)
    assert.deepEqual(seen, ['https://a.example'])
  })

  it('a send that throws, or a done that rejects, is unreachable', async () => {
    const thrown = await checkReachable(
      'https://a.example',
      () => {
        throw new Error('boom')
      },
      1000,
    )
    const rejected = await checkReachable('https://a.example', () => attempt(Promise.reject(new Error('x'))), 1000)
    assert.equal(thrown, false)
    assert.equal(rejected, false)
  })

  it('a request that never settles is unreachable at the timeout, and abandoned', async () => {
    // Control: without the function's own timer this test never ends (node:test reports it as cancelled).
    let aborted = 0
    const started = Date.now()
    const result = await checkReachable('https://a.example', () => attempt(new Promise(() => {}), () => (aborted += 1)), 50)
    assert.equal(result, false)
    assert.equal(aborted, 1)
    assert.ok(Date.now() - started < 1000)
  })

  it('a reachable answer does not abort the request', async () => {
    let aborted = 0
    await checkReachable('https://a.example', () => attempt(Promise.resolve(true), () => (aborted += 1)), 1000)
    assert.equal(aborted, 0)
  })
})
