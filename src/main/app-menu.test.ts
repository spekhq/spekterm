import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { setLanguage } from '@shared/i18n'
import { type MenuItemSpec, applicationMenuTemplate } from './app-menu'

const flatten = (items: MenuItemSpec[]): MenuItemSpec[] =>
  items.flatMap((item) => [item, ...flatten(item.submenu ?? [])])

describe('applicationMenuTemplate', () => {
  after(() => setLanguage('en'))

  it('Linux and Windows have no menu at all', () => {
    for (const platform of ['linux', 'win32'] as const) {
      assert.equal(applicationMenuTemplate({ platform, appName: 'Spekterm', onQuit: () => {} }), null)
    }
  })

  it('macOS has the application menu and the Edit menu, and nothing else', () => {
    const menu = applicationMenuTemplate({ platform: 'darwin', appName: 'Spekterm', onQuit: () => {} })
    assert.ok(menu)
    assert.equal(menu.length, 2)
    const roles = flatten(menu).map((item) => item.role).filter(Boolean)
    assert.deepEqual(roles, ['about', 'hide', 'hideOthers', 'unhide', 'undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])
  })

  it('Quit is a custom item on Cmd+Q that calls back, not the Quit role', () => {
    let quits = 0
    const menu = applicationMenuTemplate({ platform: 'darwin', appName: 'Spekterm', onQuit: () => (quits += 1) })
    const quit = flatten(menu ?? []).find((item) => item.accelerator === 'Command+Q')
    assert.ok(quit?.click, 'no item on Cmd+Q')
    assert.equal(quit.role, undefined)
    quit.click()
    assert.equal(quits, 1)
  })

  it('no item closes the window with one key', () => {
    const menu = applicationMenuTemplate({ platform: 'darwin', appName: 'Spekterm', onQuit: () => {} })
    for (const item of flatten(menu ?? [])) {
      assert.doesNotMatch(item.accelerator ?? '', /\+W$/i, JSON.stringify(item))
      assert.notEqual(item.role as string, 'close')
      assert.notEqual(item.role as string, 'windowMenu')
    }
  })

  it('every item that is not a separator is labelled from the dictionary, in the current language', async () => {
    await setLanguage('zh-TW')
    const menu = applicationMenuTemplate({ platform: 'darwin', appName: 'Spekterm', onQuit: () => {} })
    const labels = flatten(menu ?? []).filter((item) => item.type !== 'separator').map((item) => item.label)
    assert.ok(labels.every((label) => typeof label === 'string' && label.length > 0), JSON.stringify(labels))
    assert.ok(labels.includes('結束 Spekterm'), JSON.stringify(labels))
    assert.ok(labels.includes('貼上'), JSON.stringify(labels))
  })
})
