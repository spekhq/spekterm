import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import type { WaitingState } from './handoff-opener'
import { buildIntakeSnapshot } from './intake-snapshot'
import { IntakeService } from './intake-service'
import { IntakeStore } from './intake-store'

const bases: string[] = []
after(() => {
  for (const base of bases) fs.rmSync(base, { recursive: true, force: true })
})

async function service(): Promise<IntakeService> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-snapshot-'))
  bases.push(base)
  const archive = path.join(base, 'intake')
  fs.mkdirSync(archive, { recursive: true })
  const store = new IntakeStore(path.join(base, 'intake.json'))
  const svc = new IntakeService({ store, archiveRoot: archive })
  const outcome = await svc.deliver(
    JSON.stringify({ id: 'a1', origin: { kind: 'slack', id: 'C1', label: '#dev' }, title: 't', body: 'b', actor: 'someone' }),
    'slack',
  )
  assert.ok(outcome.ok, 'precondition: the item is delivered')
  return svc
}

describe('the inbox snapshot (handoff-waits-for-network, D5)', () => {
  const routing = { rules: [], fallbackFolderId: null }

  it('carries the waiting state while there is one, and no item carries it (control: put it on each item)', async () => {
    const svc = await service()
    for (const state of [{ kind: 'held', since: 1 }, { kind: 'releasing', remaining: 2 }] satisfies WaitingState[]) {
      const snapshot = buildIntakeSnapshot({ service: svc, routing, knownFolderIds: new Set(), waitingForNetwork: () => state })
      assert.deepEqual(snapshot.waitingForNetwork, state)
      assert.ok(snapshot.items.length > 0, 'precondition: an item to inspect')
      for (const item of snapshot.items) assert.equal('waitingForNetwork' in item, false)
    }
  })

  it('absent while nothing waits, and without the dependency', async () => {
    const svc = await service()
    assert.equal('waitingForNetwork' in buildIntakeSnapshot({ service: svc, routing, knownFolderIds: new Set(), waitingForNetwork: () => undefined }), false)
    assert.equal('waitingForNetwork' in buildIntakeSnapshot({ service: svc, routing, knownFolderIds: new Set() }), false)
  })

  it('keeps the fields it had before it moved out of the IPC handler', async () => {
    const svc = await service()
    const snapshot = buildIntakeSnapshot({
      service: svc,
      routing,
      knownFolderIds: new Set(),
      recurrences: { listing: () => ({ available: true, recurrences: [] }) as never },
      agentCancels: () => [],
      outgoing: { list: () => [], waitingCount: () => 3, loadIssue: () => 'damaged' },
      reportable: () => true,
    })
    assert.equal(snapshot.items.length, 1)
    assert.deepEqual(snapshot.outgoing, { items: [], waiting: 3, damaged: true })
    assert.deepEqual(snapshot.declinable, [])
    assert.deepEqual(snapshot.agentCancels, [])
    assert.ok(Array.isArray(snapshot.notices))
  })
})
