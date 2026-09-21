import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { IntakeService } from './intake-service'
import { IntakeStore } from './intake-store'

const bases: string[] = []
after(() => {
  for (const base of bases) fs.rmSync(base, { recursive: true, force: true })
})

function service(): IntakeService {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-service-'))
  bases.push(base)
  const store = new IntakeStore(path.join(base, 'intake.json'))
  return new IntakeService({ store, archiveRoot: path.join(base, 'intake') })
}

/**
 * 痕跡的上界 —— **額度以來源分配**。
 *
 * 痕跡由所有 producer 共用。第三方來源的格式錯誤可以是高頻的（一個 Slack 工作區、
 * 一個外部工具持續投遞壞掉的 JSON），而交接的失敗被擠進溢位桶之後，
 * 「交接的失敗對使用者可見」在真實使用中就失效了 —— **那會是一個沒有任何東西會變紅的失效**。
 */
describe('痕跡的上界以來源分配額度', () => {
  it('高頻來源塞滿之後，其他來源的失敗仍然進得來', () => {
    const s = service()

    // 一個高頻來源先塞 30 則（遠超過它的額度）。
    for (let i = 0; i < 30; i += 1) {
      s.reject('FIELD_TYPE', `noisy-${i}`, undefined, { adapter: 'file' })
    }
    // 然後交接來一則。
    s.reject('TARGET_NOT_FOUND', 'the-handoff', undefined, { adapter: 'handoff', target: 'nowhere' })

    const handoffNotices = s.notices().filter((n) => n.adapter === 'handoff')
    assert.equal(handoffNotices.length, 1, '交接的失敗不得被高頻來源擠出')
    assert.equal(handoffNotices[0].key, 'the-handoff')
  })

  it('單一來源的則數有上界 —— 它不會把整個清單佔滿', () => {
    const s = service()
    for (let i = 0; i < 30; i += 1) {
      s.reject('FIELD_TYPE', `noisy-${i}`, undefined, { adapter: 'file' })
    }

    const fromFile = s.notices().filter((n) => n.adapter === 'file')
    assert.ok(fromFile.length < 20, `單一來源佔了 ${fromFile.length} 則，應少於總上界`)
    assert.ok(
      s.notices().some((n) => n.adapter === undefined),
      '超出額度的併進「其餘」那一桶，而不是各自累積',
    )
  })

  it('同一則重複時合併並保留最近一次的時刻', () => {
    const s = service()
    s.reject('TARGET_NOT_FOUND', 'same', undefined, { adapter: 'handoff' })
    const first = s.notices()[0].at
    s.reject('TARGET_NOT_FOUND', 'same', undefined, { adapter: 'handoff' })

    const notices = s.notices()
    assert.equal(notices.length, 1, '同一主鍵合併為一則')
    assert.equal(notices[0].count, 2)
    assert.ok(notices[0].at >= first, '保留最近一次 —— 使用者要知道的是「還在發生嗎」')
  })

  it('第三方可控的欄位在進入痕跡時被正規化', () => {
    const s = service()
    // 雙向覆寫字元與控制字元：它們從此會被渲染、被落盤。
    s.reject('TARGET_NOT_FOUND', 'k', undefined, { adapter: 'handoff', target: 'a‮b\u0007c' })

    const { target } = s.notices()[0]
    assert.equal(target?.includes('‮'), false)
    assert.equal(target?.includes('\u0007'), false)
  })
})
