import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, it } from 'node:test'

import { ptyCwdReadable, readPtyCwd } from './pty-cwd'

describe('pty working directory', () => {
  it('is readable on Linux only', () => {
    assert.equal(ptyCwdReadable('linux'), true)
    assert.equal(ptyCwdReadable('darwin'), false)
    assert.equal(ptyCwdReadable('win32'), false)
  })

  it('is not read on a platform where it is not readable', () => {
    assert.equal(readPtyCwd(process.pid, 'darwin'), undefined)
  })

  it('reads a live process\'s directory on Linux', { skip: process.platform !== 'linux' }, () => {
    assert.equal(readPtyCwd(process.pid, 'linux'), fs.realpathSync(process.cwd()))
  })
})
