import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { NO_MATCH, rankPaths, scorePath } from './score'

describe('scorePath 的命中判定', () => {
  it('以不連續的片段命中', () => {
    // 'qos' 的三個字元依序（但不連續）出現於路徑中。
    assert.ok(scorePath('src/quick-open/score.ts', 'qos') >= 0)
  })

  it('不分大小寫', () => {
    assert.ok(scorePath('src/MainStage.tsx', 'mainstage') >= 0)
    assert.ok(scorePath('src/mainstage.tsx', 'MainStage') >= 0)
  })

  it('順序不符即不命中', () => {
    // 'ba' 的字元在 'abc' 中存在，但順序相反。
    assert.equal(scorePath('abc.ts', 'ba'), NO_MATCH)
  })

  it('缺少任一字元即不命中', () => {
    assert.equal(scorePath('src/score.ts', 'zzz'), NO_MATCH)
  })

  it('空查詢視為命中', () => {
    assert.equal(scorePath('anything.ts', ''), 0)
  })
})

describe('scorePath 的排序偏好', () => {
  it('檔名命中優於路徑中段命中', () => {
    // 這是本能力的主要情境：使用者知道檔名。
    const inBasename = scorePath('src/auth.ts', 'auth')
    const inDirectory = scorePath('openspec/specs/auth/spec.md', 'auth')

    assert.ok(inBasename > inDirectory, `basename=${inBasename} directory=${inDirectory}`)
  })

  it('連續命中優於散落命中', () => {
    const contiguous = scorePath('src/score.ts', 'score')
    const scattered = scorePath('s-c-o-r-e.ts', 'score')

    assert.ok(contiguous > scattered, `contiguous=${contiguous} scattered=${scattered}`)
  })

  it('詞邊界的命中有額外權重', () => {
    const atBoundary = scorePath('src/quick-open.ts', 'open')
    const midWord = scorePath('src/reopened.ts', 'open')

    assert.ok(atBoundary > midWord, `boundary=${atBoundary} midWord=${midWord}`)
  })

  it('同樣命中時較短的路徑優先', () => {
    const short = scorePath('a/score.ts', 'score')
    const long = scorePath('a/b/c/d/e/score.ts', 'score')

    assert.ok(short > long, `short=${short} long=${long}`)
  })
})

describe('rankPaths', () => {
  const candidates = [
    'openspec/specs/auth/spec.md',
    'src/auth.ts',
    'src/renderer/index.tsx',
    'docs/PRD.md',
  ]

  it('只回傳命中的項目', () => {
    assert.deepEqual(rankPaths(candidates, 'auth', 10), ['src/auth.ts', 'openspec/specs/auth/spec.md'])
  })

  it('檔名命中排在路徑中段命中之前', () => {
    assert.equal(rankPaths(candidates, 'auth', 10)[0], 'src/auth.ts')
  })

  it('空查詢回傳全部，且依路徑排序', () => {
    assert.deepEqual(rankPaths(candidates, '', 10), [...candidates].sort((a, b) => a.localeCompare(b)))
  })

  it('截斷至 limit', () => {
    assert.equal(rankPaths(candidates, '', 2).length, 2)
  })

  it('無相符時回傳空陣列', () => {
    assert.deepEqual(rankPaths(candidates, 'zzzz', 10), [])
  })

  it('同分時順序可預期（依路徑升序）', () => {
    // 順序若隨執行而異，探針會時綠時紅。
    const same = ['b/x.ts', 'a/x.ts']
    assert.deepEqual(rankPaths(same, '', 10), ['a/x.ts', 'b/x.ts'])
  })
})
