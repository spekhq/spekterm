import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { parseIntake } from './intake-schema'
import { intakeIdFromStem } from './intake-id'
import { SLACK_CURSORS_VERSION, SlackCursorStore, parseSlackCursors } from './slack-cursor-store'
import { writeDelivery } from './slack-deliver'
import { buildDelivery } from './slack-mention'

let base: string
let cursorsPath: string

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'spek-slack-cursors-')))
  cursorsPath = path.join(base, 'slack-cursors.json')
})

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true })
})

describe('SlackCursorStore', () => {
  it('水位跨一次 load() 還原', () => {
    const first = new SlackCursorStore(cursorsPath)
    first.load()
    first.advance('C345GHIJKL', '1699999999.000100')

    const second = new SlackCursorStore(cursorsPath)
    second.load()
    assert.equal(second.get('C345GHIJKL'), '1699999999.000100')
  })

  it('**只前進，不後退**', () => {
    // 一次亂序的回報不該讓已經處理過的範圍重新打開（那會讓收件匣收到一批已看過的東西，
    // 而去重會把它們吞掉 —— 白做一輪，且掩蓋了時序上的問題）。
    const store = new SlackCursorStore(cursorsPath)
    store.load()
    store.advance('C345GHIJKL', '200.0')
    store.advance('C345GHIJKL', '100.0')
    assert.equal(store.get('C345GHIJKL'), '200.0')
  })

  it('形狀不合的 channel 或時間戳不被寫入', () => {
    const store = new SlackCursorStore(cursorsPath)
    store.load()
    store.advance('not a channel', '100.0')
    store.advance('C345GHIJKL', 'not a ts')
    assert.deepEqual(store.all(), {})
  })

  it('損毀就當作沒有水位 —— 代價只是多掃一遍，因此不做隔離保留', () => {
    fs.writeFileSync(cursorsPath, '{ not json')
    const store = new SlackCursorStore(cursorsPath)
    store.load()
    assert.deepEqual(store.all(), {})
    assert.equal(
      fs.readdirSync(base).some((name) => name.includes('corrupt')),
      false,
      '這份檔案不值得隔離保留 —— 它是最佳化，不是正確性的來源',
    )
  })

  it('單一壞掉的水位只影響那個頻道', () => {
    // 一次小損壞不該放大成一輪滿載的回補。
    const parsed = parseSlackCursors(
      JSON.stringify({
        version: SLACK_CURSORS_VERSION,
        cursors: { C0000000001: '100.0', 'bad name': '200.0', C0000000002: 42 },
      }),
    )
    assert.deepEqual(parsed?.cursors, { C0000000001: '100.0' })
  })

  it('版本不符 → null（整檔不可信）', () => {
    assert.equal(parseSlackCursors(JSON.stringify({ version: 999, cursors: {} })), null)
  })
})

describe('writeDelivery：寫進既有的投遞落點', () => {
  const delivery = buildDelivery({
    teamId: 'T012ABCDEF',
    channelId: 'C345GHIJKL',
    channelName: 'team-dev',
    message: { ts: '1699999999.000100', user: 'U0OTHER000', text: 'hey <@U0SELF0000>' },
    thread: [{ ts: '1699999999.000100', user: 'U0OTHER000', text: 'hey <@U0SELF0000>' }],
    names: { U0SELF0000: 'kewang', U0OTHER000: 'alice' },
  })

  it('落點多一份 .json，且其內容被收件匣的解析器接受', async () => {
    const inbox = path.join(base, 'intake-inbox')
    await writeDelivery(inbox, delivery)

    const files = fs.readdirSync(inbox)
    assert.equal(files.length, 1, `落點內容：${files.join(', ')}`)
    assert.match(files[0], /\.json$/)

    const parsed = parseIntake(JSON.parse(fs.readFileSync(path.join(inbox, files[0]), 'utf8')), 'file')
    assert.equal(parsed.ok, true, parsed.ok ? '' : `被拒絕：${parsed.code}`)
  })

  it('檔名是可逆的 hex，解得回識別碼 —— 診斷時看得懂', async () => {
    const inbox = path.join(base, 'intake-inbox')
    await writeDelivery(inbox, delivery)
    const stem = fs.readdirSync(inbox)[0].replace(/\.json$/, '')
    assert.equal(intakeIdFromStem(stem), delivery.id)
  })

  it('暫存檔不留在落點 —— 落點只該有最終檔', async () => {
    const inbox = path.join(base, 'intake-inbox')
    await writeDelivery(inbox, delivery)
    assert.equal(
      fs.readdirSync(inbox).some((name) => name.endsWith('.partial')),
      false,
    )
  })

  it('暫存檔的副檔名不是 .json —— 否則落點會採納一份寫到一半的內容', async () => {
    // 落點只採納 `.json`，而那是**縮小窗口而非防護**。我們是 producer，該做到的要做到。
    const inbox = path.join(base, 'intake-inbox')
    const renames: string[] = []
    const realRename = fs.promises.rename
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(fs.promises as any).rename = async (from: string, to: string) => {
      renames.push(String(from))
      return realRename(from, to)
    }
    try {
      await writeDelivery(inbox, delivery)
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(fs.promises as any).rename = realRename
    }
    assert.equal(renames.length, 1)
    assert.equal(renames[0].endsWith('.json'), false, `暫存檔名為 ${renames[0]}`)
  })
})
