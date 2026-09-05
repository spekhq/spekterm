import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'

import { resolveArchiveRoot, resolveConfigDir, resolveProjectsDir } from './insights-source'

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
