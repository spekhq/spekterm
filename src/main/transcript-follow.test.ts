import assert from 'node:assert/strict'
import test from 'node:test'

import {
  attachmentOf,
  consume,
  initialFollowState,
  planRead,
  project,
  projectLine,
  transcriptPathFor,
  type ViewEvent,
} from './transcript-follow'

const ENV = { userEnv: {}, processEnv: { CLAUDE_CONFIG_DIR: '/cfg' }, home: '/home/u' }

test('來源位置由起始工作目錄與對話識別碼算出', () => {
  assert.equal(
    transcriptPathFor('/home/u/git/spekterm', 'abc-123', ENV),
    '/cfg/projects/-home-u-git-spekterm/abc-123.jsonl',
  )
})

test('來源根尊重 CLAUDE_CONFIG_DIR，且使用者 shell 的值優先', () => {
  const p = transcriptPathFor('/a', 'x', { userEnv: { CLAUDE_CONFIG_DIR: '/user' }, processEnv: { CLAUDE_CONFIG_DIR: '/proc' }, home: '/h' })
  assert.ok(p.startsWith('/user/projects/'), p)
})

test('planRead 三種情況各自分開', () => {
  const s = { offset: 10, pending: Buffer.alloc(0) }
  assert.deepEqual(planRead(s, 10), { kind: 'idle' })
  assert.deepEqual(planRead(s, 25), { kind: 'append', from: 10 })
  // 檔案變短 ⇒ 它被改寫或換掉了。沿用舊偏移會從內容的中間開始讀。
  assert.deepEqual(planRead(s, 4), { kind: 'reset' })
})

test('只送出新增的內容', () => {
  let s = initialFollowState()
  const first = consume(s, Buffer.from('{"a":1}\n{"a":2}\n'), false)
  s = first.state
  assert.deepEqual(first.lines, ['{"a":1}', '{"a":2}'])
  const second = consume(s, Buffer.from('{"a":3}\n'), false)
  assert.deepEqual(second.lines, ['{"a":3}'])
  assert.equal(second.state.offset, 24)
})

test('不完整的最後一行不被送出，補完之後只送一次', () => {
  let s = initialFollowState()
  const a = consume(s, Buffer.from('{"a":1}\n{"a":'), false)
  s = a.state
  assert.deepEqual(a.lines, ['{"a":1}'])
  const b = consume(s, Buffer.from('2}\n'), false)
  assert.deepEqual(b.lines, ['{"a":2}'])
  const c = consume(b.state, Buffer.from(''), false)
  assert.deepEqual(c.lines, [])
})

test('多位元組字元被讀取邊界切開時仍能還原', () => {
  const body = Buffer.from('{"t":"繁體中文"}\n', 'utf8')
  const cut = 10 // 落在某個中文字的中間
  const s = initialFollowState()
  const a = consume(s, body.subarray(0, cut), false)
  assert.deepEqual(a.lines, [])
  const b = consume(a.state, body.subarray(cut), false)
  assert.deepEqual(b.lines, ['{"t":"繁體中文"}'])
})

test('reset 時自頭重讀，且不沿用舊的未完成尾段', () => {
  const s = { offset: 100, pending: Buffer.from('{"stale"') }
  const r = consume(s, Buffer.from('{"a":1}\n'), true)
  assert.deepEqual(r.lines, ['{"a":1}'])
  assert.equal(r.state.offset, 8)
})

const userRec = {
  type: 'user',
  uuid: 'u1',
  timestamp: '2026-09-06T00:00:00.000Z',
  cwd: '/home/u/secret-place',
  message: { role: 'user', content: 'hello' },
}

test('未知的記錄類型被忽略且不報錯', () => {
  for (const t of ['attachment', 'file-history-snapshot', 'queue-operation', 'ai-title', 'system']) {
    assert.deepEqual(project({ ...userRec, type: t }), [], t)
  }
})

test('投影不含絕對路徑（對照組：改為原樣轉手即應失敗）', () => {
  const events = project(userRec)
  assert.equal(events.length, 1)
  const serialized = JSON.stringify(events)
  assert.ok(!serialized.includes('/home/u/secret-place'), serialized)
  // 對照組：若實作改成「複製整則再刪幾個欄位」，這一行會抓到殘留的路徑。
  assert.ok(!serialized.includes('/'), serialized)
})

test('工具只帶單一辨識參數，完整參數不外流', () => {
  const rec = {
    type: 'assistant',
    uuid: 'a1',
    timestamp: '2026-09-06T00:00:01.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x/y.ts', offset: 3, secret: '/private/key' } },
      ],
    },
  }
  const [e] = project(rec) as [Extract<ViewEvent, { kind: 'tool' }>]
  assert.equal(e.kind, 'tool')
  assert.equal(e.name, 'Read')
  assert.equal(e.arg, '/x/y.ts')
  assert.ok(!JSON.stringify(e).includes('/private/key'))
})

test('assistant 的三種區塊各自投影，未知區塊被忽略', () => {
  const rec = {
    type: 'assistant',
    uuid: 'a2',
    timestamp: '2026-09-06T00:00:02.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'hmm', signature: 'sig' },
        { type: 'text', text: 'answer' },
        { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'ls' } },
        { type: 'redacted_thinking', data: 'zzz' },
      ],
    },
  }
  assert.deepEqual(
    project(rec).map((e) => e.kind),
    ['thinking', 'text', 'tool'],
  )
})

test('tool_result 自 user 記錄投影，且不被當成使用者訊息', () => {
  const rec = {
    type: 'user',
    uuid: 'u2',
    timestamp: '2026-09-06T00:00:03.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok', is_error: false }] },
  }
  const [e] = project(rec) as [Extract<ViewEvent, { kind: 'result' }>]
  assert.equal(e.kind, 'result')
  assert.equal(e.id, 't2')
  assert.equal(e.error, false)
})

test('isMeta 的使用者訊息保留但標示，不丟棄', () => {
  const [e] = project({ ...userRec, isMeta: true }) as [Extract<ViewEvent, { kind: 'user' }>]
  assert.equal(e.meta, true)
})

test('subagent 的記錄被略過', () => {
  assert.deepEqual(project({ ...userRec, isSidechain: true }), [])
})

test('壞掉的一行被忽略，不使跟進停擺', () => {
  assert.deepEqual(projectLine('{"a":'), [])
  assert.deepEqual(projectLine(''), [])
})

test('初次附掛超過上限時只送最近一段並標示', () => {
  const events: ViewEvent[] = Array.from({ length: 10 }, (_, i) => ({
    kind: 'text',
    uuid: `u${i}`,
    at: i,
    text: `t${i}`,
  }))
  const a = attachmentOf(events, 4)
  assert.equal(a.truncated, true)
  assert.deepEqual(a.events.map((e) => e.uuid), ['u6', 'u7', 'u8', 'u9'])
  const b = attachmentOf(events, 10)
  assert.equal(b.truncated, false)
  assert.equal(b.events.length, 10)
})
