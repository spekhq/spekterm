/**
 * The stub agent's `transcriptFixture` option (website screenshots): the fixture lands, byte for byte, at
 * the path the conversation view reads — derived from the cwd and the session id the product passes — in
 * place of the stub's own greeting, on a fresh start and on `--resume`.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import pty from 'node-pty'
import { pollFor } from './lib/instrument.mjs'
import { makeStubAgent } from './lib/stub-agent.mjs'

const temps = []
const mkTemp = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}
test.after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

for (const flag of ['--session-id', '--resume']) {
  test(`a transcript fixture replaces the greeting (${flag})`, async () => {
    const configDir = mkTemp('stub-config-')
    const cwd = mkTemp('stub-cwd-')
    const fixture = join(mkTemp('stub-fixture-'), 'transcript.jsonl')
    writeFileSync(fixture, '{"type":"user","uuid":"u1","message":{"role":"user","content":"hello"}}\n')
    const stub = makeStubAgent(mkTemp, configDir, { transcriptFixture: fixture })

    const child = pty.spawn(join(stub.bin, 'claude'), [flag, 'X'], { cwd, cols: 80, rows: 24, env: process.env })
    try {
      const transcript = join(configDir, 'projects', cwd.replace(/[^0-9A-Za-z]/g, '-'), 'X.jsonl')
      await pollFor({
        read: () => (existsSync(transcript) ? readFileSync(transcript, 'utf8') : ''),
        settled: (text) => text.length > 0,
        timeoutMs: 5_000,
        label: 'the stub writes its transcript',
      })
      assert.equal(readFileSync(transcript, 'utf8'), readFileSync(fixture, 'utf8'))
    } finally {
      child.kill()
    }
  })
}
