import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { configureAgentStatus, contextPercentSince, readAgentStatus } from './agent-status'

function withPayload(payload: unknown): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-status-'))
  configureAgentStatus(root)
  fs.mkdirSync(path.join(root, 'agent-status'), { recursive: true })
  fs.writeFileSync(path.join(root, 'agent-status', 's1.json'), JSON.stringify(payload))
  return root
}

test('the context window size is read from the payload', () => {
  withPayload({
    model: { display_name: 'Opus' },
    context_window: { used_percentage: 12.5, total_input_tokens: 25_000, context_window_size: 200_000 },
  })
  const status = readAgentStatus('s1')
  assert.equal(status?.contextSize, 200_000)
  assert.equal(status?.contextPercent, 12.5)
  assert.equal(status?.contextTokens, 25_000)
  assert.equal(status?.model, 'Opus')
})

test('a missing or non-numeric window size is absent', () => {
  withPayload({ context_window: { context_window_size: 'big' } })
  assert.equal(readAgentStatus('s1')?.contextSize, undefined)
  withPayload({})
  assert.equal(readAgentStatus('s1')?.contextSize, undefined)
})

test('contextPercentSince reads only a payload written at or after the process start (workspace-sessions D6)', () => {
  const root = withPayload({ context_window: { used_percentage: 82.6 } })
  const file = path.join(root, 'agent-status', 's1.json')
  const written = fs.statSync(file).mtimeMs
  assert.equal(contextPercentSince('s1', written), 82.6, 'a payload of this process is read')
  // A payload left by an earlier process: its mtime is before the current process started.
  const old = new Date(written - 60_000)
  fs.utimesSync(file, old, old)
  assert.equal(contextPercentSince('s1', written), undefined, 'a payload older than the process start is not used')
  assert.equal(contextPercentSince('s2', 0), undefined, 'no payload: absent')
})
