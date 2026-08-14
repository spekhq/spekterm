/**
 * `scripts/lib/instrument.mjs` 的單元測試 —— 純邏輯、不起任何 app、毫秒級。
 *
 * **為什麼這些能以單元測試承擔**：等待原語的逾時語意、斷言的輸出格式、累計的段落歸屬，
 * 全部與 Electron、CDP、真實視窗無關。把它們釘在這一層，探針就不必為了驗自己的儀器而多跑
 * 幾輪 —— 而這些機制的失效方式**全部是靜默的**（少一行輸出、多算一次往返、把例外吞掉），
 * 靠跑探針時「覺得哪裡怪怪的」是抓不到的。
 *
 * 每一條「機制生效」的測試都配一條對照組（把機制拿掉就會變紅）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  beginSection,
  check,
  noteCdp,
  pollFor,
  retrySample,
  sectionSummary,
  sectionToken,
} from './lib/instrument.mjs'
import { waitForPageTarget } from './lib/cdp.mjs'
import { runInNewContext } from 'node:vm'
import { awaitMounted, describeFrameStall, describeMounted, mountedExpression } from './lib/mounted.mjs'

/** 收集 `console.log` 的輸出並還原 —— 這些機制的產物就是輸出本身。 */
async function captured(fn) {
  const lines = []
  const log = console.log
  console.log = (...args) => lines.push(args.join(' '))
  try {
    const value = await fn()
    return { value, lines }
  } finally {
    console.log = log
  }
}

const never = () => false
const always = () => true

// ── 等待原語的逾時語意 ──────────────────────────────────────────────────────

test('窗口耗盡時回傳最後一次讀到的值，且不拋出例外', async () => {
  let reads = 0
  const { value } = await captured(() =>
    pollFor({
      read: () => ++reads,
      settled: never,
      timeoutMs: 60,
      interval: 10,
      label: '測試用',
    }),
  )
  assert.equal(value, reads, '逾時要回傳最後一次讀到的值 —— 既有斷言靠它把該值印進 detail')
  assert.ok(reads > 1, '窗口內要反覆求值')
})

test('窗口耗盡時輸出一行，載明等待時間與標的', async () => {
  const { lines } = await captured(() =>
    pollFor({ read: () => null, settled: never, timeoutMs: 30, interval: 10, label: 'waitForFile(cols-C1.txt)' }),
  )
  const line = lines.find((l) => l.includes('等待窗口耗盡'))
  assert.ok(line, '靜默的等待落空正是「一個段落跑了幾百秒」的實際去向')
  assert.match(line, /\d+\.\d+s/, '要載明等了多久')
  assert.ok(line.includes('waitForFile(cols-C1.txt)'), '要載明在等什麼 —— 沒有標籤等於沒有輸出')
})

test('對照組：條件滿足時不產生任何窗口耗盡的輸出', async () => {
  const { value, lines } = await captured(() =>
    pollFor({ read: () => 'ok', settled: always, timeoutMs: 1000, interval: 10, label: '不該印' }),
  )
  assert.equal(value, 'ok')
  assert.equal(
    lines.filter((l) => l.includes('等待窗口耗盡')).length,
    0,
    '正常路徑上出現這一行，它就會變成人人忽略的噪音',
  )
})

test('時限極短時仍然至少求值一次', async () => {
  let reads = 0
  await captured(() =>
    pollFor({ read: () => ++reads, settled: never, timeoutMs: 0, interval: 10, label: '零時限' }),
  )
  assert.equal(reads, 1, '先讀一次再判斷 deadline —— 否則時限為 0 時一次都不量')
})

// ── tolerateErrors：逐字對齊 pollTerminalText 的既有語意 ─────────────────────

test('tolerateErrors：只有最後一次讀取仍失敗才拋出', async () => {
  await assert.rejects(
    () =>
      captured(() =>
        pollFor({
          read: () => {
            throw new Error('讀不到')
          },
          settled: never,
          timeoutMs: 30,
          interval: 10,
          label: '一直失敗',
          tolerateErrors: true,
        }),
      ),
    /讀不到/,
    '逾時之後仍讀不到，就是真的壞了 —— 不可以默默回空值',
  )
})

test('tolerateErrors：窗口內失敗過但最後成功時不拋，回傳最後的值', async () => {
  let reads = 0
  const { value } = await captured(() =>
    pollFor({
      read: () => {
        reads += 1
        if (reads === 1) throw new Error('還沒好')
        return `第 ${reads} 次`
      },
      settled: never,
      timeoutMs: 40,
      interval: 10,
      label: '先失敗後成功',
      tolerateErrors: true,
    }),
  )
  assert.match(
    value,
    /^第 \d+ 次$/,
    '實作成「窗口內出現過例外就拋」的話，今天只是讓斷言變紅的路徑會變成段落中斷',
  )
})

test('對照組：未開 tolerateErrors 時例外直接往外拋，不被吞掉', async () => {
  await assert.rejects(
    () =>
      captured(() =>
        pollFor({
          read: () => {
            throw new Error('管道壞了')
          },
          settled: never,
          timeoutMs: 1000,
          interval: 10,
          label: '不容忍例外',
        }),
      ),
    /管道壞了/,
  )
})

test('呼叫端可把逾時升級為例外，而其他呼叫端不受影響', async () => {
  // **這條驗的是分工**：原語一律回傳最後的值（上面那條），要不要拋由呼叫端決定。
  // `waitForPageTarget` 就是那個「要」的呼叫端 —— 等不到 CDP target 還往下走，只會紅在一個
  // 與根因無關的地方。**沒有這條，spec 那句「呼叫端可將逾時升級為例外」就沒有載體**
  // （而本 change 的載體對照表原本正是這樣宣稱它的 —— issue #12 那個形狀的第五次）。
  await assert.rejects(
    () => captured(() => waitForPageTarget(9299, 150)),
    /等待 CDP target 逾時/,
    '原語不拋，不代表沒有人該拋',
  )
})

// ── retrySample：偶發會失手的取樣 ───────────────────────────────────────────

test('retrySample：前幾次失手之後成功，就回傳那次的值', async () => {
  let attempts = 0
  const { value } = await captured(() =>
    retrySample(
      () => {
        attempts += 1
        if (attempts < 3) throw new Error('拖曳沒有選到任何東西')
        return 'GPUMARK_42'
      },
      { timeoutMs: 3000, interval: 5, label: '假的擷取' },
    ),
  )
  assert.equal(value, 'GPUMARK_42')
  assert.equal(attempts, 3, '前兩次的失手應該只是重試，不是中止')
})

test('retrySample：一次就成功時不重試（沒有失手的路徑上是零影響）', async () => {
  let attempts = 0
  const { value } = await captured(() =>
    retrySample(
      () => {
        attempts += 1
        return 'ok'
      },
      { timeoutMs: 3000, interval: 5, label: '假的擷取' },
    ),
  )
  assert.equal(value, 'ok')
  assert.equal(attempts, 1)
})

test('retrySample：始終失手時，拋出來的是最後那個哨兵本身', async () => {
  // **控制組的判準是「拋出來的是哪一個錯誤」，不是「有沒有東西被拋出來」。**
  // 這個讀取真實的失效方式之一，是在中途拋出一個與現場無關的 `TypeError`
  //（`realClick(null)` 去讀 `null.x`）—— 那時「有東西被拋出來」照樣成立，而浮上來的訊息
  // 完全指不到根因。**失敗的形態變質，比失敗本身更難查。**
  const sentinel = new Error('readTerminalText: 複製沒有發生（disabled=true）—— 不可當成「畫面上沒有東西」')
  let last = null
  await assert.rejects(
    () =>
      captured(() =>
        retrySample(
          () => {
            last = new Error(sentinel.message)
            throw last
          },
          { timeoutMs: 40, interval: 10, label: '一直失手的擷取' },
        ),
      ),
    (error) => {
      assert.equal(error, last, '拋的必須是最後一次那個例外物件本身')
      assert.match(error.message, /不可當成「畫面上沒有東西」/)
      return true
    },
  )
})

test('對照組：retrySample 不會把失手吞成一個可以讓斷言通過的值', async () => {
  // 這道防護的失效方向是**假綠**：回一個空字串，否定式斷言（「畫面上沒有 X」）就會通過，
  // 而探針其實什麼都沒讀到。
  await assert.rejects(
    () =>
      captured(() =>
        retrySample(
          () => {
            throw new Error('讀不到')
          },
          { timeoutMs: 30, interval: 10, label: '一直失手' },
        ),
      ),
    /讀不到/,
  )
})

// ── 斷言的耗時與往返計數 ────────────────────────────────────────────────────

test('每一條斷言都帶耗時與 CDP 往返計數（無門檻）', async () => {
  beginSection()
  const results = []
  const { lines } = await captured(() => {
    check(results, '一條很快就完成的斷言', true)
    check(results, '另一條', false, '細節')
  })
  assert.equal(results.length, 2)
  for (const line of lines) {
    assert.match(line, /\[\+\d+\.\d+s cdp \d+×\d+\.\d+s\]/, '門檻會藏掉基準線 —— 每一條都要有數字')
  }
  assert.ok(lines[0].includes('✓'))
  assert.ok(lines[1].includes('✗') && lines[1].includes('細節'))
})

test('往返計數累進到下一條斷言，且輸出後歸零', async () => {
  beginSection()
  const token = sectionToken()
  const results = []
  const { lines } = await captured(() => {
    noteCdp(100, token)
    noteCdp(200, token)
    check(results, '第一條', true)
    noteCdp(50, token)
    check(results, '第二條', true)
  })
  assert.ok(lines[0].includes('cdp 2×0.3s'), `第一條要含區間內的兩次往返，實際：${lines[0]}`)
  assert.ok(lines[1].includes('cdp 1×0.1s'), `區間計數要歸零重算，實際：${lines[1]}`)
})

// ── 段落歸屬：逾時的段落不會被中止，它的殘留活動不得污染下一段 ──────────────

test('殭屍段落的往返與窗口耗盡不計入下一個段落', async () => {
  beginSection()
  const stale = sectionToken()
  noteCdp(1000, stale)

  beginSection() // 下一個段落開始 —— 上一段的殘留活動仍在背景跑
  noteCdp(1000, stale)
  const summary = sectionSummary()
  assert.equal(summary.cdpCalls, 0, '下一個段落是無辜的 —— 殘留活動不該切碎它的數字')
  assert.equal(summary.cdpMs, 0)
})

test('對照組：本段落自己的往返有被計入', async () => {
  beginSection()
  noteCdp(1000, sectionToken())
  assert.equal(sectionSummary().cdpCalls, 1, '歸屬機制不能連本段的都丟掉')
})

test('段落累計含窗口耗盡的次數與合計時間', async () => {
  beginSection()
  await captured(() =>
    pollFor({ read: () => null, settled: never, timeoutMs: 20, interval: 5, label: 'a' }),
  )
  await captured(() =>
    pollFor({ read: () => null, settled: never, timeoutMs: 20, interval: 5, label: 'b' }),
  )
  const summary = sectionSummary()
  assert.equal(summary.timeouts, 2, '逐次的那一行散在幾百行輸出裡，段落層級要有累計')
  assert.ok(summary.timeoutMs >= 40, `合計時間要反映實際等待，實際：${summary.timeoutMs}`)
})

test('beginSection 重置上一段的累計', async () => {
  beginSection()
  noteCdp(500, sectionToken())
  beginSection()
  assert.deepEqual(sectionSummary(), { timeouts: 0, timeoutMs: 0, cdpCalls: 0, cdpMs: 0 })
})

// ── MOUNTED：判定與 detail 必須同源 ─────────────────────────────────────────

test('describeMounted 指出是哪些子條件不成立', () => {
  const detail = describeMounted({ rail: true, root: true, visible: false, ok: false })
  assert.match(detail, /visible/, '「renderer 不見了」與「視窗被判定為不可見」是兩個不同的病')
  assert.ok(!detail.includes('未成立：rail'), '不該把成立的子條件也列成失敗')
  assert.match(detail, /rail=true root=true visible=false/, '要能看到每一個子條件的值')
})

test('describeMounted 在判定成立時沒什麼好說的', () => {
  assert.equal(describeMounted({ rail: true, root: true, visible: true, ok: true }), '')
})

test('describeMounted 區分「求值沒有回傳值」與「子條件不成立」', () => {
  assert.match(
    describeMounted(undefined),
    /求值本身失敗/,
    'renderer 不在時求值回 undefined —— 那與「某個子條件是 false」是兩件事',
  )
})

test('describeMounted 是純函式，拿不到 client（結構上不可能事後補一次求值）', () => {
  assert.equal(describeMounted.length, 1, '只吃已求值的物件 —— 多一個 client 參數就能事後取樣')
  const before = { rail: true, root: false, visible: true, ok: false }
  const first = describeMounted(before)
  const second = describeMounted(before)
  assert.equal(first, second, '同一個值要給出同一段話 —— 它不該去看外面的世界')
})

test('mountedExpression 可省略與追加子條件', () => {
  assert.ok(!mountedExpression({ omit: ['visible'] }).includes('visibilityState'))
  assert.ok(mountedExpression({ extra: { separators: 'x === 3' } }).includes('separators'))
})

// ── MOUNTED 的診斷欄位（issue #19 的建議 1）─────────────────────────────────

/** 在一個假的 `document` 上真的求值那段 expression —— 它就是會被送進 renderer 的那個字串。 */
function evaluateMounted(expression, document) {
  return runInNewContext(`(${expression})`, { document })
}

test('診斷欄位不參與 ok 的判定', () => {
  // **這是這幾條裡最重要的一條。** 診斷值若進了 `ok`，那七條 dev 紅燈的判定本身就變了 ——
  // 交付之後再也分不出「紅燈變了」是因為採證還是因為判準。
  const value = evaluateMounted(mountedExpression(), {
    querySelector: () => ({}),
    getElementById: () => ({ children: { length: 3 } }),
    visibilityState: 'visible',
    readyState: 'loading', // ← 不是 'complete'
  })
  assert.equal(value.ok, true, 'readyState 不是 complete 時，ok 仍只由三個子條件決定')
  assert.equal(value.diagnostics.readyState, 'loading', '但它要被帶回來')
  assert.equal(value.diagnostics.rootChildren, 3, '子節點的「數量」—— 那正是 Boolean() 掉的東西')
})

test('診斷欄位在 renderer 真的沒掛載時也拿得到值', () => {
  const value = evaluateMounted(mountedExpression(), {
    querySelector: () => null,
    getElementById: () => null,
    visibilityState: 'hidden',
    readyState: 'loading',
  })
  assert.equal(value.ok, false)
  assert.equal(value.diagnostics.rootChildren, 0, '#root 不在時要回 0，不是 undefined')
  assert.match(describeMounted(value), /rootChildren=0/)
})

test('describeMounted 把診斷值附在訊息尾端', () => {
  const text = describeMounted({
    rail: false,
    root: true,
    visible: true,
    ok: false,
    diagnostics: { readyState: 'loading', rootChildren: 0 },
  })
  assert.match(text, /未成立：rail/)
  assert.match(text, /readyState=loading/)
  assert.match(text, /rootChildren=0/)
})

test('describeMounted 不把 diagnostics 當成一個子條件', () => {
  // 它是物件（恆為 truthy）—— 混進子條件會多出一個永遠成立的 `diagnostics=true`，
  // 而且與 ok 的計算對不上。
  const text = describeMounted({
    rail: false,
    ok: false,
    diagnostics: { readyState: 'complete', rootChildren: 1 },
  })
  assert.doesNotMatch(text, /diagnostics=true/)
  assert.match(text, /（rail=false）/)
})

test('對照組：沒有 diagnostics 的舊形狀仍然可讀', () => {
  const text = describeMounted({ rail: false, root: true, visible: true, ok: false })
  assert.match(text, /未成立：rail/)
  assert.doesNotMatch(text, /｜/)
})

// ── 畫面時鐘：rAF 停擺的診斷（issue #21 / #19 / #17 的根因處置）────────────────
//
// **這一族的失效方式是「永遠不說話」**：若畫面時鐘在無 frame 時照樣前進，這個診斷就是一個
// 恆為空字串的欄位 —— 而它的存在理由正是「處置哪天失效時，輸出要說得出話」。
// 那個前提由 spike 實測建立（隱藏視窗 2.5 秒：rAF +0、timeline +0、performance.now() +2503）；
// 這裡驗的是它有沒有被接上去。

test('診斷欄位帶回畫面時鐘', () => {
  const value = evaluateMounted(mountedExpression(), {
    querySelector: () => ({}),
    getElementById: () => ({ children: { length: 1 } }),
    visibilityState: 'visible',
    readyState: 'complete',
    timeline: { currentTime: 1234.7 },
  })
  assert.equal(value.diagnostics.frameClock, 1235, '取整數 —— frame 間隔是 16.7ms，小數沒有意義')
})

test('畫面時鐘不參與 ok 的判定', () => {
  // 與 readyState 同一條理由：進了判定就改變那七條紅**自己的判準**。
  const stalled = evaluateMounted(mountedExpression(), {
    querySelector: () => ({}),
    getElementById: () => ({ children: { length: 1 } }),
    visibilityState: 'visible',
    readyState: 'complete',
    timeline: { currentTime: 0 }, // ← 停在 0
  })
  assert.equal(stalled.ok, true, '時鐘停住不使判定失敗 —— 它只是診斷')
})

test('畫面時鐘讀不到時回 -1，而不是讓整段求值爆掉', () => {
  const value = evaluateMounted(mountedExpression(), {
    querySelector: () => ({}),
    getElementById: () => ({ children: { length: 1 } }),
    visibilityState: 'visible',
    readyState: 'complete',
    // document.timeline 不存在（舊環境／document 尚未 attach）
  })
  assert.equal(value.diagnostics.frameClock, -1)
})

test('describeFrameStall：兩次相同就說出沒有 frame 及其後果', () => {
  const text = describeFrameStall(1556, 1556)
  assert.match(text, /沒有任何 frame/)
  assert.match(text, /等待都會落空/, '只說「沒有 frame」不夠 —— 要說它對驗收意味著什麼')
})

test('對照組：畫面時鐘前進時不產生任何說明', () => {
  assert.equal(describeFrameStall(1556, 1573), '')
})

test('畫面時鐘讀不到（負值）時不誤報停擺', () => {
  // **否定式的診斷寧可少說，不可亂說**：-1 表示讀不到，那與「停住」是兩件事。
  assert.equal(describeFrameStall(-1, -1), '')
})

// ── awaitMounted：接線（純函式測到了、接線沒有，是本 repo 犯過四次的形狀）─────

/**
 * 假 client：判定恆不成立，畫面時鐘由呼叫端決定要不要前進。
 *
 * **兩種求值不能用 `includes('document.timeline')` 區分** —— 判定式自己就含那個字串
 * （畫面時鐘是它的診斷欄位之一）。以「單獨的時鐘讀取是一個 `Math.round(...)` 運算式」判別。
 */
function fakeClient({ clocks, onFrameClock }) {
  let index = 0
  return {
    evaluate: async (expression) => {
      if (expression.trim().startsWith('Math.round(')) {
        if (onFrameClock) onFrameClock()
        return clocks[Math.min(index++, clocks.length - 1)]
      }
      return { rail: false, root: false, visible: false, ok: false, diagnostics: {} }
    },
  }
}

test('awaitMounted 等不到時採樣並輸出「沒有 frame」', async () => {
  const { lines } = await captured(() =>
    awaitMounted(fakeClient({ clocks: [900, 900] }), { timeoutMs: 10 }),
  )
  assert.ok(
    lines.some((line) => /沒有任何 frame/.test(line)),
    `應輸出停擺說明；實得 ${JSON.stringify(lines)}`,
  )
})

test('對照組：畫面時鐘有前進時不輸出停擺說明', async () => {
  const { lines } = await captured(() =>
    awaitMounted(fakeClient({ clocks: [900, 917] }), { timeoutMs: 10 }),
  )
  assert.ok(!lines.some((line) => /沒有任何 frame/.test(line)))
})

test('awaitMounted 回傳最後一次的判定值（語意與 pollUntil 相同）', async () => {
  const { value } = await captured(() =>
    awaitMounted(fakeClient({ clocks: [900, 900] }), { timeoutMs: 10 }),
  )
  assert.equal(value.ok, false)
  assert.equal(value.rail, false, '呼叫端照樣把它餵給 describeMounted')
})

test('診斷取樣自己拋錯時，回傳值不受影響（不得把回傳換成例外）', async () => {
  // **這是最容易漏的一條**：等不到掛載最常見的原因就是 renderer 已經不在了 —— 而此時對它
  // 求值會拋。讓那個例外往外送，十一處呼叫端拿到的東西就從「最後的判定值」變成「例外」，
  // 而 describeMounted 正是為前者準備的。
  const client = fakeClient({
    clocks: [900, 900],
    onFrameClock: () => {
      throw new Error('Target closed')
    },
  })
  const { value, lines } = await captured(() => awaitMounted(client, { timeoutMs: 10 }))
  assert.equal(value.ok, false, '仍然拿得到最後一次的判定值')
  assert.ok(lines.some((line) => /取樣失敗/.test(line)), '而且失敗本身要出聲')
})
