import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'

import { resolveArchiveRoot, resolveConfigDir, resolveProjectsDir } from './insights-source'
import { delegateDirSuffix, isDelegateProjectDir, resolveDelegateCwd } from './insights-source'
import { encodeProjectDir } from './transcript-project'

describe('來源根的解析', () => {
  it('7.3 使用者 shell 的 CLAUDE_CONFIG_DIR 優先於主行程環境', () => {
    const got = resolveConfigDir({
      userEnv: { CLAUDE_CONFIG_DIR: '/from/shell' },
      processEnv: { CLAUDE_CONFIG_DIR: '/from/process' },
      home: '/home/x',
    })
    assert.equal(got, '/from/shell')
  })

  it('7.3 只有主行程環境有的時候採用它（probe 的接縫）', () => {
    const got = resolveConfigDir({ userEnv: {}, processEnv: { CLAUDE_CONFIG_DIR: '/from/process' }, home: '/home/x' })
    assert.equal(got, '/from/process')
  })

  it('7.3 兩邊都沒有時退回 ~/.claude', () => {
    assert.equal(resolveConfigDir({ userEnv: {}, processEnv: {}, home: '/home/x' }), path.join('/home/x', '.claude'))
  })

  it('7.3 空字串不算設定過', () => {
    const got = resolveConfigDir({ userEnv: { CLAUDE_CONFIG_DIR: '  ' }, processEnv: {}, home: '/home/x' })
    assert.equal(got, path.join('/home/x', '.claude'))
  })

  it('來源根是設定目錄底下的 projects/', () => {
    const got = resolveProjectsDir({ userEnv: { CLAUDE_CONFIG_DIR: '/cfg' }, processEnv: {}, home: '/h' })
    assert.equal(got, path.join('/cfg', 'projects'))
  })

  it('存檔根在 userData 之下', () => {
    assert.equal(resolveArchiveRoot('/u/data'), path.join('/u/data', 'conversation-archive'))
  })
})

describe('委派工作目錄與排除規則', () => {
  it('2.2 dev 與打包產物兩種 userData 推導出的目錄名都被排除', () => {
    // **來源根是同一個 `~/.claude/projects`，而 userData 分家。**
    // 排除規則若綁單一絕對路徑，在 dev 按一次讀後感就會弄髒正式產物的儀表板數字，
    // 而以「同一個安裝內」為前提的驗收必定全綠。
    const dev = encodeProjectDir(resolveDelegateCwd('/home/me/.config/spekterm-dev'))
    const prod = encodeProjectDir(resolveDelegateCwd('/home/me/.config/Spekterm'))
    assert.notEqual(dev, prod, '前置：兩者確實是不同的專案目錄名')
    assert.ok(isDelegateProjectDir(dev), 'dev 的委派目錄要被排除')
    assert.ok(isDelegateProjectDir(prod), '產物的委派目錄要被排除')
  })

  it('2.2 一般的專案目錄不被排除', () => {
    assert.ok(!isDelegateProjectDir(encodeProjectDir('/home/me/git/spekterm')))
    assert.ok(!isDelegateProjectDir(encodeProjectDir('/home/me/git/some-report')))
  })

  it('2.2 排除值由決定 cwd 的同一個常數推導 —— 改了 cwd，排除值跟著變', () => {
    // 兩者若各寫一份字串就會漂移，而漂移的徵狀是數字慢慢變得不對，沒有任何東西會紅。
    const cwd = resolveDelegateCwd('/any/user/data')
    assert.ok(encodeProjectDir(cwd).endsWith(delegateDirSuffix()))
  })
})
