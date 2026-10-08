/**
 * The listener behind `probe:shell`'s no-connection-at-startup check. Its SNI reading is what tells the
 * positive control's connection from any other, so it is checked against a real TLS client.
 */
import assert from 'node:assert/strict'
import { connect } from 'node:tls'
import test from 'node:test'
import { resolverRulesArg, sniOf, startSniListener } from './lib/sni-listener.mjs'

test('records a TLS connection with the host name the client asked for', async () => {
  const listener = await startSniListener()
  try {
    const socket = connect({ host: '127.0.0.1', port: listener.port, servername: 'control.invalid' })
    socket.on('error', () => {})
    await new Promise((resolve) => setTimeout(resolve, 300))
    socket.destroy()
    assert.equal(listener.connections.length, 1)
    assert.equal(listener.connections[0].sni, 'control.invalid')
  } finally {
    await listener.close()
  }
})

test('bytes that are not a ClientHello have no SNI', () => {
  assert.equal(sniOf(Buffer.from('GET / HTTP/1.1\r\n\r\n')), null)
  assert.equal(sniOf(Buffer.alloc(0)), null)
})

test('the resolver rule is one unquoted argument', () => {
  const arg = resolverRulesArg(1234)
  assert.equal(arg, '--host-resolver-rules=MAP * 127.0.0.1:1234, EXCLUDE localhost')
  assert.doesNotMatch(arg, /["';]/)
})
