import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { contentSecurityPolicy } from './content-security-policy'

/** 把政策字串解析回 directive → values，讓斷言針對語意而非字串排列。 */
function parse(policy: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const part of policy.split(';')) {
    const [directive, ...values] = part.trim().split(/\s+/)
    if (directive) map.set(directive, values)
  }
  return map
}

describe('contentSecurityPolicy', () => {
  describe('build（production）政策 —— 非 dev server（file://）', () => {
    const policy = contentSecurityPolicy(false)
    const directives = parse(policy)

    it('預設一律 self', () => {
      assert.deepEqual(directives.get('default-src'), ["'self'"])
    })

    it('img-src 放行遠端 https 圖片（markdown 的正常內容），但不放行 http', () => {
      const img = directives.get('img-src') ?? []
      assert.deepEqual(img, ["'self'", 'data:', 'https:'])
      assert.ok(img.includes('https:'), 'img-src 應放行 https 遠端圖片')
      assert.ok(!img.includes('http:'), 'img-src 不放行 http —— 擋 http://localhost 的 image-GET 探測')
    })

    it('script-src 只有 self —— 不含 unsafe-inline，inline script 一律不執行', () => {
      assert.deepEqual(directives.get('script-src'), ["'self'"])
    })

    it('不含 unsafe-eval —— 建置產物無 eval，不需要它', () => {
      assert.ok(!policy.includes("'unsafe-eval'"))
    })

    it('style-src 保留 unsafe-inline —— Monaco／xterm／Tailwind 注入 inline style', () => {
      assert.ok((directives.get('style-src') ?? []).includes("'unsafe-inline'"))
    })

    it('worker-src 涵蓋 self 與 blob —— Monaco 的 module worker 與 blob fallback', () => {
      assert.deepEqual(directives.get('worker-src'), ["'self'", 'blob:'])
    })

    it('關掉 object／base-uri／frame', () => {
      assert.deepEqual(directives.get('object-src'), ["'none'"])
      assert.deepEqual(directives.get('base-uri'), ["'none'"])
      assert.deepEqual(directives.get('frame-src'), ["'none'"])
    })

    it('production connect-src 不放行 websocket', () => {
      assert.deepEqual(directives.get('connect-src'), ["'self'"])
    })
  })

  describe('dev 政策 —— 載入 Vite dev server', () => {
    const directives = parse(contentSecurityPolicy(true))

    it('script-src 放行 inline —— React Fast Refresh 的 inline preamble', () => {
      assert.ok((directives.get('script-src') ?? []).includes("'unsafe-inline'"))
    })

    it('connect-src 放行 websocket —— Vite HMR', () => {
      assert.ok((directives.get('connect-src') ?? []).includes('ws:'))
    })

    it('img-src 放行遠端 https 圖片 —— dev 與 production 一致', () => {
      assert.deepEqual(directives.get('img-src'), ["'self'", 'data:', 'https:'])
    })
  })
})
