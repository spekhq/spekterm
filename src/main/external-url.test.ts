import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isAllowedExternalUrl } from './external-url'

describe('isAllowedExternalUrl', () => {
  it('放行 http 與 https', () => {
    assert.equal(isAllowedExternalUrl('http://example.com/a'), true)
    assert.equal(isAllowedExternalUrl('https://example.com/a?b=1#c'), true)
  })

  it('拒絕 javascript:', () => {
    assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false)
  })

  it('拒絕 file: —— 否則等於把讀取任意檔案的能力交給系統處理常式', () => {
    assert.equal(isAllowedExternalUrl('file:///etc/passwd'), false)
  })

  it('拒絕 data:', () => {
    assert.equal(isAllowedExternalUrl('data:text/html,<script>alert(1)</script>'), false)
  })

  it('拒絕無法解析為 URL 的字串', () => {
    assert.equal(isAllowedExternalUrl('not a url'), false)
    assert.equal(isAllowedExternalUrl(''), false)
    assert.equal(isAllowedExternalUrl('/relative/path'), false)
  })

  it('協定比對不區分大小寫（URL 會正規化）', () => {
    assert.equal(isAllowedExternalUrl('HTTPS://example.com'), true)
    assert.equal(isAllowedExternalUrl('JavaScript:alert(1)'), false)
  })
})
