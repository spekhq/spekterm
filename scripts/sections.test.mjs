/**
 * `scripts/lib/sections.mjs` 的單元測試 —— 純邏輯、不起任何 app、秒級。
 *
 * **為什麼這些能以單元測試承擔**：段落篩選、依賴解析、skip 標記與結束碼都是純粹的排程決策，
 * 與 Electron、CDP、真實視窗無關。把它們釘在這一層，探針就不必為了驗自己的排程而多跑幾輪
 * ——那正是本 change 想省下來的東西。
 *
 * 每一條「機制生效」的測試都配一條對照組（把機制拿掉就會變紅），見檔尾。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { noteConsole, pollFor, sectionToken } from './lib/instrument.mjs'
import { runSections } from './lib/sections.mjs'

/** 攔掉段落執行器的輸出，否則測試報告會被段落狀態淹掉。 */
function quiet(fn) {
  const log = console.log
  const error = console.error
  console.log = () => {}
  console.error = () => {}
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.log = log
      console.error = error
    })
}

/** 記錄執行順序的段落工廠。 */
function makeSections(trace, spec) {
  return spec.map(({ name, deps, throws, produces }) => ({
    name,
    deps,
    run: async (mode) => {
      trace.push(`${mode}:${name}`)
      if (throws) throw new Error(`boom-${name}`)
      return produces
    },
  }))
}

/** 每個測試各自設定 PROBE_ONLY 並還原 —— 它是行程層的狀態。 */
async function withOnly(value, fn) {
  const before = process.env.PROBE_ONLY
  if (value === null) delete process.env.PROBE_ONLY
  else process.env.PROBE_ONLY = value
  try {
    return await fn()
  } finally {
    if (before === undefined) delete process.env.PROBE_ONLY
    else process.env.PROBE_ONLY = before
  }
}

const BUILD = { port: 1 }
const noDevServer = { port: 2, start: async () => ({ url: 'http://dev', child: null }) }

test('段落拋出例外後，其餘不依賴它的段落仍然執行', async () => {
  const trace = []
  const sections = makeSections(trace, [
    { name: 'a' },
    { name: 'b', throws: true },
    { name: 'c' },
  ])
  const results = [true, true]

  const outcome = await withOnly(null, () =>
    quiet(() => runSections({ sections, build: BUILD, dev: null, results })),
  )

  assert.deepEqual(trace, ['build:a', 'build:b', 'build:c'], 'c 必須在 b 爆炸之後仍然執行')
  assert.equal(outcome.failed.length, 1)
  assert.equal(outcome.failed[0].name, 'b')
  assert.equal(outcome.ok, false, '有段落失敗時結束碼必須非零')
})

test('前置失敗時，依賴它的段落標記為未執行且不計入失敗斷言', async () => {
  const trace = []
  const sections = makeSections(trace, [
    { name: 'a', throws: true },
    { name: 'b', deps: ['a'] },
    { name: 'c' },
  ])
  const results = [true, true, true]

  const outcome = await withOnly(null, () =>
    quiet(() => runSections({ sections, build: BUILD, dev: null, results })),
  )

  assert.ok(!trace.includes('build:b'), 'b 的前置失敗，它不該被執行')
  assert.ok(trace.includes('build:c'), 'c 不依賴 a，必須照跑')
  assert.equal(outcome.skipped.length, 1)
  assert.equal(outcome.skipped[0].name, 'b')
  assert.equal(outcome.skipped[0].reason, 'a')
  assert.equal(outcome.passed, 3, '未執行的段落不得讓既有的斷言結果變動')
  assert.equal(outcome.ok, false)
})

test('依賴會遞移傳播 —— 前置的前置失敗，整條鏈都標記未執行', async () => {
  const trace = []
  const sections = makeSections(trace, [
    { name: 'a', throws: true },
    { name: 'b', deps: ['a'] },
    { name: 'c', deps: ['b'] },
  ])

  const outcome = await withOnly(null, () =>
    quiet(() => runSections({ sections, build: BUILD, dev: null, results: [true] })),
  )

  assert.deepEqual(trace, ['build:a'])
  assert.deepEqual(
    outcome.skipped.map((s) => s.name),
    ['b', 'c'],
  )
})

test('PROBE_ONLY 只跑指定的段落', async () => {
  const trace = []
  const sections = makeSections(trace, [{ name: 'a' }, { name: 'b' }, { name: 'c' }])

  await withOnly('b', () =>
    quiet(() => runSections({ sections, build: BUILD, dev: null, results: [true] })),
  )

  assert.deepEqual(trace, ['build:b'])
})

test('PROBE_ONLY 支援 <段落>:<模式>', async () => {
  const trace = []
  const sections = makeSections(trace, [{ name: 'a' }, { name: 'b' }])

  await withOnly('a:dev', () =>
    quiet(() => runSections({ sections, build: BUILD, dev: noDevServer, results: [true] })),
  )

  assert.deepEqual(trace, ['dev:a'], '指定 :dev 時 build 模式不得執行')
})

test('PROBE_ONLY 單獨指定一個具有依賴的段落時，自動帶上前置', async () => {
  const trace = []
  const sections = makeSections(trace, [
    { name: 'a' },
    { name: 'b', deps: ['a'] },
    { name: 'c' },
  ])

  await withOnly('b', () =>
    quiet(() => runSections({ sections, build: BUILD, dev: null, results: [true] })),
  )

  assert.deepEqual(trace, ['build:a', 'build:b'], 'a 是 b 宣告的前置，必須一併帶上')
  assert.ok(!trace.includes('build:c'))
})

test('被帶進來的前置不受模式篩選限制', async () => {
  const trace = []
  const sections = makeSections(trace, [{ name: 'a' }, { name: 'b', deps: ['a'] }])

  await withOnly('b:dev', () =>
    quiet(() => runSections({ sections, build: BUILD, dev: noDevServer, results: [true] })),
  )

  assert.deepEqual(trace, ['dev:a', 'dev:b'], '前置若不跑，帶它進來就沒有意義')
})

test('沒有任何 dev 段要跑時，不啟動 dev server', async () => {
  const trace = []
  const sections = makeSections(trace, [{ name: 'a' }])
  let started = 0

  await withOnly('a:build', () =>
    quiet(() =>
      runSections({
        sections,
        build: BUILD,
        dev: {
          port: 2,
          start: async () => {
            started += 1
            return { url: 'http://dev', child: null }
          },
        },
        results: [true],
      }),
    ),
  )

  assert.equal(started, 0, 'dev server 起得很慢，沒有 dev 段要跑時不得啟動它')
})

test('context 由前段傳給後段，且 build 與 dev 各持一份', async () => {
  const seen = []
  const sections = [
    { name: 'a', run: async (mode) => ({ [`from-${mode}`]: true }) },
    {
      name: 'b',
      deps: ['a'],
      run: async (mode, _config, ctx) => {
        seen.push({ mode, keys: Object.keys(ctx).sort() })
      },
    },
  ]

  await withOnly(null, () =>
    quiet(() => runSections({ sections, build: BUILD, dev: noDevServer, results: [true] })),
  )

  assert.deepEqual(seen, [
    { mode: 'build', keys: ['from-build'] },
    { mode: 'dev', keys: ['from-dev'] },
  ], 'dev 的 context 不得看見 build 那一輪留下的東西')
})

test('段落逾時後記為失敗，其餘段落仍然執行', async () => {
  const trace = []
  const sections = [
    { name: 'a', run: async () => { trace.push('a') } },
    // 永遠不 resolve —— `try`/`catch` 對它毫無作用，這正是要驗的失效模式
    { name: 'hang', run: () => new Promise(() => {}), timeoutMs: 60 },
    { name: 'c', run: async () => { trace.push('c') } },
  ]

  const outcome = await withOnly(null, () =>
    quiet(() => runSections({ sections, build: BUILD, dev: null, results: [true] })),
  )

  assert.deepEqual(trace, ['a', 'c'], 'hang 的段落不得阻塞其後的段落')
  assert.equal(outcome.failed.length, 1)
  assert.equal(outcome.failed[0].name, 'hang')
  assert.match(outcome.failed[0].reason, /逾時/, '原因必須與例外區分')
  assert.equal(outcome.ok, false)
})

test('逾時的段落會被要求收拾它留下的行程', async () => {
  let cleaned = 0
  const sections = [
    { name: 'hang', run: () => new Promise(() => {}), timeoutMs: 60, onTimeout: () => { cleaned += 1 } },
  ]

  await withOnly(null, () =>
    quiet(() => runSections({ sections, build: BUILD, dev: null, results: [true] })),
  )

  assert.equal(cleaned, 1, '逾時的段落不會走到自己的 finally —— 沒有其他人會收它建立的行程')
})

test('時限可逐段設定', async () => {
  const started = []
  const sections = [
    { name: 'slow', run: () => new Promise((r) => setTimeout(r, 120)), timeoutMs: 400 },
    { name: 'strict', run: () => new Promise((r) => setTimeout(r, 120)), timeoutMs: 40 },
  ]

  const outcome = await withOnly(null, () =>
    quiet(() => runSections({ sections, build: BUILD, dev: null, results: [true] })),
  )

  assert.equal(outcome.failed.length, 1, '同樣的耗時，寬的時限放行、緊的時限攔下')
  assert.equal(outcome.failed[0].name, 'strict')
  assert.equal(started.length, 0)
})

test('afterMode 在每個模式結束後執行，且中途 throw 也不會漏掉', async () => {
  const closed = []
  const sections = [
    { name: 'a', run: async () => ({ app: 'opened' }) },
    { name: 'b', run: async () => { throw new Error('boom') } },
  ]

  await withOnly(null, () =>
    quiet(() =>
      runSections({
        sections,
        build: BUILD,
        dev: noDevServer,
        results: [true],
        afterMode: (mode, ctx) => {
          closed.push(`${mode}:${ctx.app ?? 'none'}`)
        },
      }),
    ),
  )

  assert.deepEqual(closed, ['build:opened', 'dev:opened'],
    '關閉共用 app 的責任不能落在最後一個段落 —— 中途 throw 時那一段不會執行')
})

test('全部通過時 ok 為真', async () => {
  const sections = makeSections([], [{ name: 'a' }, { name: 'b' }])
  const outcome = await withOnly(null, () =>
    quiet(() => runSections({ sections, build: BUILD, dev: null, results: [true, true] })),
  )
  assert.equal(outcome.ok, true)
})

test('段落全過但有斷言紅燈時，ok 仍為假', async () => {
  const sections = makeSections([], [{ name: 'a' }])
  const outcome = await withOnly(null, () =>
    quiet(() => runSections({ sections, build: BUILD, dev: null, results: [true, false] })),
  )
  assert.equal(outcome.ok, false)
})

test('PROBE_ONLY 指定不存在的段落時明確失敗', async () => {
  const sections = makeSections([], [{ name: 'a' }])
  await withOnly('nope', async () => {
    await assert.rejects(
      () => quiet(() => runSections({ sections, build: BUILD, dev: null, results: [true] })),
      /不存在的段落：nope/,
    )
  })
})

// ── 段落的耗時與累計 ────────────────────────────────────────────────────────
//
// **為什麼這些要在段落這一層驗**：逐次的窗口耗盡那一行散在幾百行輸出裡，而「哪一段吃掉了
// 那一輪」是段落總結唯一能回答的問題。這兩條的失效方式都是「少印一段字」——靜默。

/** 收集段落執行器的輸出（`quiet` 是丟掉，這裡是留下來看）。 */
async function capture(fn) {
  const lines = []
  const log = console.log
  const error = console.error
  console.log = (...args) => lines.push(args.join(' '))
  console.error = (...args) => lines.push(args.join(' '))
  try {
    await fn()
    return lines
  } finally {
    console.log = log
    console.error = error
  }
}

test('段落狀態的總結附上每個段落的耗時', async () => {
  const sections = [{ name: 'slow', run: async () => sleep(30) }]
  const lines = await withOnly(null, () =>
    capture(() => runSections({ sections, build: BUILD, dev: null, results: [true] })),
  )
  const row = lines.find((l) => l.includes('build：slow'))
  assert.ok(row, '總結要有這一段')
  assert.match(row, /（\d+\.\d+s/, `每個已執行的段落都要附耗時，實際：${row}`)
})

test('段落的窗口耗盡累計進總結', async () => {
  const sections = [
    {
      name: 'burns',
      run: () => pollFor({ read: () => null, settled: () => false, timeoutMs: 20, interval: 5, label: 'x' }),
    },
  ]
  const lines = await withOnly(null, () =>
    capture(() => runSections({ sections, build: BUILD, dev: null, results: [true] })),
  )
  const row = lines.find((l) => l.includes('build：burns'))
  assert.match(row, /窗口耗盡 1 次／\d+\.\d+s/, `一段跑很久時，「它慢」與「它有幾個等待落空」是兩件事，實際：${row}`)
})

test('對照組：沒有窗口耗盡時，總結不出現那一段文字', async () => {
  const sections = [{ name: 'clean', run: async () => {} }]
  const lines = await withOnly(null, () =>
    capture(() => runSections({ sections, build: BUILD, dev: null, results: [true] })),
  )
  const row = lines.find((l) => l.includes('build：clean'))
  assert.ok(!row.includes('窗口耗盡'), `正常的段落不該帶著一個恆為零的欄位，實際：${row}`)
})

test('未執行的段落不附耗時', async () => {
  const sections = [
    { name: 'a', run: async () => { throw new Error('boom') } },
    { name: 'b', deps: ['a'], run: async () => {} },
  ]
  const lines = await withOnly(null, () =>
    capture(() => runSections({ sections, build: BUILD, dev: null, results: [true] })),
  )
  const row = lines.find((l) => l.includes('build：b') && l.includes('未執行'))
  assert.ok(row && !/（\d+\.\d+s/.test(row), `沒跑過的段落給一個耗時數字，等於憑空捏造，實際：${row}`)
})

// ── renderer 的 console 訊息：只在該段落確實失敗時出現 ──────────────────────

/** 直接推進緩衝 —— 這一層不需要真的 CDP，`cdp.mjs` 推入的就是同一個入口。 */
function emitConsole(text, level = 'error') {
  noteConsole({ level, source: 'console', text }, sectionToken())
}

test('段落有紅燈斷言時，輸出該段收到的 console 訊息', async () => {
  const results = []
  const sections = [
    {
      name: 'red',
      run: async () => {
        emitConsole('Uncaught TypeError: 這是現場')
        results.push(false) // 一條紅燈斷言 —— 不是例外，#19 那七條就是這一種
      },
    },
  ]
  const lines = await withOnly(null, () =>
    capture(() => runSections({ sections, build: BUILD, dev: null, results })),
  )
  assert.ok(
    lines.some((l) => l.includes('這是現場')),
    '斷言紅但段落沒 throw —— 只接例外的實作在這裡就會什麼都採不到',
  )
})

test('段落拋出例外時，同樣輸出該段的 console 訊息', async () => {
  const results = []
  const sections = [
    {
      name: 'boom',
      run: async () => {
        emitConsole('Failed to fetch dynamically imported module')
        throw new Error('段落炸了')
      },
    },
  ]
  const lines = await withOnly(null, () =>
    capture(() => runSections({ sections, build: BUILD, dev: null, results })),
  )
  assert.ok(lines.some((l) => l.includes('dynamically imported module')))
})

test('對照組：段落全過時不輸出 console 欄位，即使期間有訊息', async () => {
  const results = []
  const sections = [
    {
      name: 'green',
      run: async () => {
        emitConsole('一則沒有人需要看的警告', 'warning')
        results.push(true)
      },
    },
  ]
  const lines = await withOnly(null, () =>
    capture(() => runSections({ sections, build: BUILD, dev: null, results })),
  )
  assert.ok(
    !lines.some((l) => l.includes('沒有人需要看')),
    '一個恆常出現的欄位掛在每個正常段落上，只會讓人學會不看它',
  )
})

test('訊息歸屬於發生當下的段落 —— 前一段的殘留不計入下一段', async () => {
  const results = []
  let leakedToken = null
  const sections = [
    {
      name: 'first',
      run: async () => {
        leakedToken = sectionToken() // 逾時的段落會帶著舊 token 繼續在背景跑
        results.push(true)
      },
    },
    {
      name: 'second',
      run: async () => {
        noteConsole({ level: 'error', source: 'console', text: '上一段的殘留' }, leakedToken)
        emitConsole('本段自己的訊息')
        results.push(false)
      },
    },
  ]
  const lines = await withOnly(null, () =>
    capture(() => runSections({ sections, build: BUILD, dev: null, results })),
  )
  assert.ok(lines.some((l) => l.includes('本段自己的訊息')), '本段的訊息要在')
  assert.ok(
    !lines.some((l) => l.includes('上一段的殘留')),
    '逾時的段落不會被中止，它在背景產生的訊息不該記到無辜的下一段頭上',
  )
})

test('緩衝是環形的 —— 只留最近的，不會把一段的輸出淹掉', async () => {
  const results = []
  const sections = [
    {
      name: 'noisy',
      run: async () => {
        for (let i = 0; i < 50; i++) emitConsole(`訊息-${i}`)
        results.push(false)
      },
    },
  ]
  const lines = await withOnly(null, () =>
    capture(() => runSections({ sections, build: BUILD, dev: null, results })),
  )
  assert.ok(lines.some((l) => l.includes('訊息-49')), '最近的要留著')
  assert.ok(!lines.some((l) => l.includes('訊息-0')), '最舊的要被擠掉')
})
