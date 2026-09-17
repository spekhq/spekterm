import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createHoldingBackend,
  notificationOptions,
  type NotificationHandle,
  type NotificationOptions,
} from './intake-notify-backend'

interface Fake extends NotificationHandle {
  options: NotificationOptions
  shown: boolean
  fire(event: 'click' | 'close' | 'failed'): void
}

function fakeOs(): { made: Fake[]; create: (o: NotificationOptions) => NotificationHandle } {
  const made: Fake[] = []
  return {
    made,
    create(options) {
      const handlers = new Map<string, () => void>()
      const fake: Fake = {
        options,
        shown: false,
        show: () => { fake.shown = true },
        on: (event, handler) => { handlers.set(event, handler) },
        fire: (event) => handlers.get(event)?.(),
      }
      made.push(fake)
      return fake
    },
  }
}

describe('已顯示的通知被持有至其結束', () => {
  it('**顯示之後仍被持有** —— 不持有的話它會在使用者伸手去點之前被回收', () => {
    const os = fakeOs()
    const backend = createHoldingBackend({ create: os.create, supported: () => true })
    backend.present({ title: 't', body: 'b' }, [])
    assert.equal(os.made[0].shown, true, '前置：它真的被顯示了')
    assert.equal(backend.liveCount(), 1)
  })

  it('回報結束之後才放開', () => {
    const os = fakeOs()
    const backend = createHoldingBackend({ create: os.create, supported: () => true })
    backend.present({ title: 't', body: 'b' }, [])
    os.made[0].fire('close')
    assert.equal(backend.liveCount(), 0)
  })

  it('回報失敗之後也放開', () => {
    const os = fakeOs()
    const backend = createHoldingBackend({ create: os.create, supported: () => true })
    backend.present({ title: 't', body: 'b' }, [])
    os.made[0].fire('failed')
    assert.equal(backend.liveCount(), 0)
  })

  it('**持有的數量有上界**', () => {
    // 某些通知服務可能不回報結束 —— 一個無界的集合就是一次洩漏。
    const os = fakeOs()
    const backend = createHoldingBackend({ create: os.create, supported: () => true, maxLive: 3 })
    for (let i = 0; i < 10; i += 1) backend.present({ title: `t${i}`, body: 'b' }, [])
    assert.equal(backend.liveCount(), 3)
    assert.equal(os.made.length, 10, '超過上界的仍然被顯示，只是不被持有')
    assert.ok(os.made.every((made) => made.shown))
  })
})

describe('觸發的回呼', () => {
  it('使用者觸發時回呼被呼叫，且該則被放開', () => {
    const os = fakeOs()
    const backend = createHoldingBackend({ create: os.create, supported: () => true })
    let activations = 0
    backend.onActivate(() => { activations += 1 })
    backend.present({ title: 't', body: 'b' }, [])
    os.made[0].fire('click')
    assert.equal(activations, 1)
    assert.equal(backend.liveCount(), 0)
  })
})

describe('交給作業系統的選項是白名單', () => {
  it('**鍵集合恰為 title 與 body**', () => {
    // **白名單而不是「不含 actions」那種黑名單** —— 後者只擋得住列舉得出來的東西，
    // 而這條要擋的正是下一個人會想到、我們現在列舉不出來的那些：通知上的 Accept 按鈕、
    // 發話者的頭像（一則到達等於一個遠端存取）、不會自己消失的緊急程度。
    // 往選項裡加任何一個鍵，這條就會紅。
    const options = notificationOptions({ title: 't', body: 'b' })
    assert.deepEqual(Object.keys(options), ['title', 'body'])
  })
})

describe('不可用時不呈現', () => {
  it('回報不可用 ⇒ usable() 為 false', () => {
    const os = fakeOs()
    const backend = createHoldingBackend({ create: os.create, supported: () => false })
    assert.equal(backend.usable(), false)
  })
})
