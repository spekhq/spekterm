/**
 * scenario → 驗收載體的對照表 **與它的守衛**。
 *
 * ## 為什麼要有它，以及為什麼它自己需要守衛
 *
 * 這個 repo 已經**六次**犯同一個錯：「補一條 scenario」與「覆蓋一條 scenario」是兩個動作。
 * 上一次的處置是手工做一張 82 列的對照表 —— 然後把 39 條既有 scenario **憑印象**填成
 * 「既有」，事後逐條核對發現**其中 4 條是假的**。
 *
 * 因此這份表由兩道機械守衛釘住：
 *
 * 1. **每一條 `#### Scenario:` 在表上恰有一列** —— 新增 scenario 時自動生效。
 * 2. **每一個載體標籤在原始碼中恰有一處命中** —— 填「某某測試」時必須真的有那個名字。
 *
 * ## 兩欄比「哪支探針哪條斷言」值錢
 *
 * - `greenIfAbsent`：**若實作完全沒做這件事，這條會不會照樣綠？** 答案為 `true` 的列，
 *   其鑑別力不在斷言本身 —— 它必須另有交代（換載體／由對照組承擔／老實填無載體）。
 * - `mutation`：**使它變紅的那個刻意的錯誤實作。** 沒有它，「跑一次對照組」就是一次創作，
 *   而創作出來的 mutation 很容易是一個改不到東西的 mutation。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** change 的所在 —— 封存後它會搬到 `archive/` 之下，兩處都找。 */
function specRoots() {
  const changes = join(repoRoot, 'openspec', 'changes')
  const candidates = [
    join(changes, 'agent-intake-inbox', 'specs'),
    ...readdirSync(join(changes, 'archive'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.endsWith('agent-intake-inbox'))
      .map((entry) => join(changes, 'archive', entry.name, 'specs')),
  ]
  return candidates.filter((dir) => {
    try {
      readdirSync(dir)
      return true
    } catch {
      return false
    }
  })
}

export function scenariosOf(root) {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === 'spec.md') {
        for (const line of readFileSync(full, 'utf8').split('\n')) {
          if (line.startsWith('#### Scenario:')) found.push(line.slice('#### Scenario:'.length).trim())
        }
      }
    }
  }
  walk(root)
  return found
}

/**
 * 對照表。
 *
 * `carrier` 為 `null` ＝ **無載體**，理由寫在 `note`。那不是偷懶的出口 ——
 * 一條沒有載體的 requirement 必須被看見，而不是被塞進一個看起來有人管的格子。
 */
export const TABLE = [
  // ── 投遞契約 ──────────────────────────────────────────────────────────────
  ['投遞一則合法的 intake', '落點中先有檔案才啟動時，該 intake 進得來', false, '移除 deliver 的落盤', ''],
  ['同一份內容寫到一半、補完之後仍被採納', '寫到一半的同一份檔案：不被消費，補完之後被採納', false, '解析失敗即刪除或改名', ''],
  ['解析失敗的項目不阻斷其後的項目', '解析失敗不阻斷其後的項目 —— 順序由呼叫建立', false, '第一次解析失敗後停止處理', '順序由呼叫建立，不靠排程'],
  ['超出大小上限的投遞不被解析', '超出大小上限的投遞不被解析，且被消費掉', false, '移除 stat 的前置檢查', ''],
  ['達到則數上限時拒絕並在畫面上說明', null, true, null,
    '**只有「拒絕」那半有載體**（node:test 驗回傳的原因）。「在畫面上說明」需要把上限注入到 probe 的 fixture，本輪未做 —— 老實記為半覆蓋'],
  ['永久性拒絕不在其後的啟動重複呈現', '永久性拒絕被消費，其後的啟動不再重複處理', true, '把永久性拒絕也留在落點',
    '「被消費」驗得到；「其後的啟動不重複呈現」需要跨重啟的 probe 段落，本輪未做'],
  ['暫時性拒絕於上限解除後被重新處理', '暫時性拒絕原封留在落點，並於上限解除後被重新處理', false, '把暫時性拒絕也消費掉', ''],
  ['多份無法採納的項目以彙整呈現', '同一主鍵的重複拒絕合併為一則並累加次數', true, '改成每次都 push 一則新的',
    '合併驗得到；「一個計數與一個入口」的呈現未進 probe'],

  // ── 兩條入口 ──────────────────────────────────────────────────────────────
  ['關閉期間的投遞於啟動後出現', '應用程式未執行時投遞的 intake 於啟動後進入收件匣', false, '移除啟動掃描', 'probe'],
  ['兩條入口對畸形投遞的處置相同', '兩條入口對畸形投遞的處置相同', false, '讓掃描器另走一條只有 JSON.parse 的捷徑', '三種畸形，第三種是去重'],

  // ── 去重 ──────────────────────────────────────────────────────────────────
  ['內容相同的重複被靜默忽略', '內容相同的重複：靜默', false, '一律呈現拒絕', '與下一列互為對照'],
  ['內容不同的重複被拒絕且可見', '內容不同的重複：拒絕、可見、且既有那則不被取代', false, '一律靜默', ''],
  ['已接受的識別碼仍參與去重', '已接受的識別碼仍參與去重', false, '只比對 pending 的項目', ''],
  ['不同 adapter 的相同識別碼互不衝突', '不同 adapter 的相同識別碼互不衝突', false, '主鍵只用 id', ''],

  // ── 欄位分組 ──────────────────────────────────────────────────────────────
  ['原始內容不出現在收件匣以內的型別中', '原始投遞的讀取函式只被保存模組引用', false, '在別的模組 import readDelivery',
    '真載體是原始碼守衛；行為面的「型別上沒有」對任何實作恆真（型別被抹除）'],
  ['原始內容不進入交給 agent 的檔案', '來源專屬的原始內容不進 context 檔', false, '由保存的原始投遞產生 context 檔', ''],
  ['未知的來源種類仍可被處理', '不認得的來源種類仍然放行', false, '把 origin.kind 做成 enum 白名單', ''],

  // ── 生命週期 ──────────────────────────────────────────────────────────────
  ['已忽略的狀態跨重啟保留', '已忽略的狀態跨重啟保留（**非預設值**，這是它有鑑別力的理由）', false, '不落盤狀態', 'dismissed 不是預設值'],
  ['已接受與待處理在同一次重啟後各自保持', '已接受與待處理在同一次重啟後各自保持', false, '重啟後一律回到 pending', ''],
  ['忽略不建立 session', '忽略不建立任何 session（session 總數不變）', true, '讓忽略也走 accept 的路徑',
    '否定斷言；鑑別力來自同段落的正面對照（接受確實建得出 session）'],
  ['內容過期之後去重仍然有效', '內容過期之後去重仍然有效', false, '清內容時連鍵一起刪', ''],

  // ── 不受信任輸入 ──────────────────────────────────────────────────────────
  ['第三方字串的不可列印字元於攝入時即被移除', '正規化在攝入發生，於是解析結果本身已經是乾淨的', false, '把正規化搬到呈現層', ''],
  ['識別碼含相對路徑片段被拒絕', '整串否決：雙點被拒絕 —— 而它通得過字元集白名單', false, '只留字元集白名單', ''],
  ['僅大小寫不同的兩個識別碼不共用檔案', '僅大小寫不同的兩個識別碼得到不同的檔名', false, '改用識別碼原文當檔名', ''],
  ['識別碼的長度上限以編碼後的檔名為尺度', '上限以**編碼後的檔名**為尺度，留在 NAME_MAX 之內', false, '把上限直接訂在識別碼上', ''],
  ['保存處的 symlink 不被寫穿（leaf）', 'leaf 是 symlink 時目標未被寫入，而沒有 symlink 時確實產生保存檔', false,
    '把 openNoFollow 換成普通的 open', '**不可與中間目錄共用 mutation** —— rename 不跟隨最後一段'],
  ['路徑解析拒絕中間一層是 symlink 的相對路徑', '解析器拒絕中間一層是 symlink 的相對路徑', false, '把寫入改成 rename',
    '從投遞路徑到不了（保存處扁平、識別碼無路徑分隔字元），因此在解析器本身上驗'],

  // ── 呈現 ──────────────────────────────────────────────────────────────────
  ['待處理的 intake 呈現本文全文', '本文中的標記語法以字面文字呈現（正面的錨）', false, '不渲染本文', 'probe；正面的錨'],
  ['本文中的標記語法以字面文字呈現', '該列之內不存在圖片與可點的連結', false, '改用既有的 markdown 元件', 'probe；作用域是該列的子樹'],
  ['本文過長的投遞在投遞階段被拒絕', '本文超過長度上限被拒絕', false, '移除長度上限', ''],

  // ── session 的建立 ────────────────────────────────────────────────────────
  ['於解析出的 folder 建立，而不是於選中的或第一個 folder', '接受之前看得到將開在哪個 folder（第二個，不是選中的或第一個）', false,
    '讓規則不生效而落到 fallback', 'probe；鑑別力全部來自三 folder 的 fixture 形狀'],
  ['由 intake 建立的 session 與手動建立者一同被重建', null, true, null, '**無載體** —— 需要跨重啟的 probe 段落，本輪未做'],
  ['session 的名稱未被系統指定', 'session 的名稱未被系統指定（agent 宣告的標題呈現得出來）', false, '接受後呼叫 rename', 'probe；正面形式'],
  ['啟動參數與手動建立者等價', '去除對話識別碼之後逐項相同，且參數個數相同', false, '在 intake 路徑多加一個旗標', '等價而非黑名單'],
  ['注入設定的頂層欄位未因本能力而增加', '注入設定的頂層欄位未因本能力而增加', true, '往注入設定加一個頂層欄位',
    '今日恆真（本能力不碰注入）；價值在回歸線'],

  // ── 預填 ──────────────────────────────────────────────────────────────────
  ['就緒之後填入且未送出', '就緒之後 prompt 填入 agent 的輸入處', false, '不等待就緒即寫入', 'probe；位元組收據'],
  ['就緒之前不寫入', '就緒之前的整段期間未向該 session 寫入任何內容', false, 'pty 建立完成之後、不等待就緒即寫入',
    'probe；**曾經紅不起來，而那是替身壞掉的產物**（讀取迴圈在背景且提早退出）'],
  ['就緒之後只填入一次', '未就緒之前的整段期間都沒有寫入；就緒之後恰寫一次', false, '不退訂，每次就緒都寫', ''],
  ['使用者送出後 agent 才收到', null, true, null, '**無載體** —— 需要在 probe 裡送一次真的 Enter 並讀回 agent 紀錄，本輪未做'],
  ['預填未能發生時說明並回到可重新處理', null, true, null, '**無載體** —— 逾時是 30 秒，需要可注入的上限，本輪未做'],
  ['事件回報已關閉時於接受之前告知', null, true, null,
    '**無載體** —— 前置（偏好關閉 ⇒ 不注入）驗得到，但「於接受之前告知」的路徑未驗'],

  // ── 待送出的標示 ──────────────────────────────────────────────────────────
  ['view 看不到輸入處時仍有標示', null, true, null, '**無載體** —— 需要以對話 view 為全域偏好的 probe 段落，本輪未做'],
  ['送出之後標示消失', null, true, null, '**無載體** —— 同上，且需要送出後的等待狀態轉換'],

  // ── 交付即呈現 ────────────────────────────────────────────────────────────
  ['呈現與交付是同一份文字', '交給 agent 的內容逐字元等於呈現給使用者的本文', false, '在呈現層多做一次轉換（收斂空白）',
    'probe；**唯一跨行程的那一條**（畫面 textContent vs 磁碟上的檔案）'],
  ['本文不出現在命令列上', '本文不出現在啟動 agent 的命令列上', true, '把本文拼進啟動參數',
    '預設狀態成立；同一支測試綁了「context 檔確實產生且含本文」當正面的錨'],
  ['本文不寫進使用者的工作目錄', '目標 folder 的遞迴快照（含隱藏項目）前後逐位元組相同', true, '把 context 檔寫進目標 folder',
    '預設狀態成立；同一支測試綁了正面的錨'],

  // ── nonce ─────────────────────────────────────────────────────────────────
  ['本文完整落在界線之內', '本文自身含界線標記時仍完整落在界線之內', false, '用固定字面值當界線', '斷言索引序'],
  ['nonce 取自密碼學亂數', 'nonce 只能來自密碼學亂數', false, '改用 Date.now()',
    '**不變式是取值來源**；「不構成可預測序列」寫不成斷言'],
  ['nonce 互異且長度達標', '互異且長度達下限', true, '回傳固定字串', '一個零填充的計數器也滿足它 —— 真載體是上一列的守衛'],
  ['prompt 指明只有帶該 nonce 的界線算數', '同一個 nonce 同時出現在界線與 prompt 裡', false, '只把 nonce 放進界線', ''],

  // ── prompt ────────────────────────────────────────────────────────────────
  ['prompt 不含 intake 的欄位原文', '不含 intake 欄位的唯一 token', false, '把 title 放進 prompt', 'fixture 用唯一 token'],
  ['prompt 要求照抄而非判斷', '要求照抄而非判斷，且禁止取得外部資源', true, '改成「摘要並提計畫」',
    '**斷言的是我們自己寫的字串** —— 它是否真的改變模型行為由 dogfood 認定，見 14.5'],

  // ── routing ───────────────────────────────────────────────────────────────
  ['第一個命中的規則勝出', '同時符合第二與第三條時取第二 —— 斷言絕對的 folder', false, '改成 last-match-wins', '三條規則三個 folder'],
  ['把規則往後移改變結果，且結果是絕對的', '把第二條移到第三條之後，結果變成第三條原本指向的那個', false, '忽略順序', ''],
  ['依來源座標識別碼解析', '依來源座標識別碼解析', false, '只比對 title', ''],
  ['兩種判準的標示不同', '第三方撰寫的欄位被標示為可操縱', false, '一律標示或一律不標示', '含反面（可驗證的欄位不被標示）'],
  ['規則存在但都不命中時採用 fallback', '有一條存在但不命中的規則時採用 fallback', false, '規則非空時直接拋錯', 'fixture 必須有一條不命中的規則'],
  ['一條規則都沒有時採用 fallback', '一條規則都沒有時採用 fallback', false, '空清單時回拒絕', ''],
  ['無規則亦無 fallback 時拒絕', '無規則亦無 fallback 時拒絕', false, '退回第一個 folder', ''],
  ['指向的 folder 已被移出 workspace 時拒絕，即使 fallback 可用', '命中的 folder 已移出 workspace 時拒絕 —— **即使 fallback 可用**',
    false, '視為未命中往下走', 'fixture 必須同時設有可用的 fallback'],
  ['解析失敗時嘗試接受不建立任何 session', null, true, null,
    '**無載體** —— 需要一個「解析不出」的 probe fixture（三 folder 之外再加一個無 fallback 的 profile），本輪未做'],
  ['可解析與不可解析的兩則同時呈現', '不是 fallback 指向的那一個', true, null, '**半覆蓋** —— probe 驗了可解析那一則，不可解析那一則的呈現未驗'],
  ['經編輯介面建立的規則跨重啟保留', null, true, null, '**無載體** —— store 層的跨重啟驗得到，但「經編輯介面」那條路徑未驗'],
  ['變更終端偏好不影響規則', '不與使用者偏好共用檔案', true, '把規則放進 preferences.json', '兩個檔案 ⇒ 恆真；價值全在 mutation'],
  ['形狀不合的規則被忽略而非使其餘失效', '形狀不合的單條被忽略，其餘照常生效', false, '整份視為未設定', '斷言用行為而非長度'],

  // ── workspace-layout ──────────────────────────────────────────────────────
  ['尚未實作的活動列入口', '尚未實作的入口（Search）仍為停用', false, '把整排都打開', 'probe'],
  ['已實作的活動列入口', 'Handoffs 入口為可用狀態', false, '維持 enabled: false', 'probe'],
  ['對話計量入口開啟 overlay', 'Sessions 入口仍為可用', true, null, '**由 `probe:insights` 承擔** —— 本表只記本 change 新增的那一條'],
  ['Handoffs 入口開啟收件匣 overlay', '開啟收件匣不改變側欄的身分', false, '把收件匣做成側欄的第三個身分', 'probe'],
]

/**
 * **刻意不覆蓋的項目，與理由。**
 *
 * 這一份與「無載體」那些列不同：那些是**本輪沒做**（下一輪該補），這些是**做不到或不該做**。
 * 分開寫，是為了讓「已知的缺口」與「被追蹤的缺口」不會混成同一堆。
 */
export const NOT_COVERED = [
  {
    what: '真實 agent 的許可提示行為',
    why: '需要真實委派 —— 要網路、會花錢、回覆不可重現。替身自己決定要不要印許可提示，'
      + '斷言它等於斷言我們自己寫的腳本。比照 `probe:insights` 與 `probe:agent-view` 對真實'
      + '委派的處置，由 dogfood 認定。',
  },
  {
    what: '「逐字照抄文中的祈使句」是否真的改變模型行為',
    why: '語意性質。任何測試最後都會寫成「prompt 含某個字」—— **那是斷言我們自己寫的字串**，'
      + '與「argv 裡有 --settings」同一族。而且問法越明確，投遞者預先寫好一份假清單越好打；'
      + '本能力明文不宣稱它必然有效（見 spec）。由 dogfood 認定。',
  },
  {
    what: '界線與 nonce 對語言模型的實際約束力',
    why: '對模型而言檔案內容與指令進入同一個脈絡，界線是**緩解**不是機制。'
      + '可驗的只有「界線不可被投遞者偽造」（已驗）與「nonce 取自密碼學亂數」（已驗）。',
  },
  {
    what: '「本文可以只放一個連結」這條繞過',
    why: '約束 agent 讀完之後的行為不在本能力的控制範圍 —— 那是許可機制的事。'
      + 'prompt 明示第一回合不得取得外部資源只是降低機率，而「它有沒有照做」同上一條。',
  },
]

test('每一條 scenario 在對照表上恰有一列', () => {
  const roots = specRoots()
  assert.ok(roots.length > 0, '找不到本 change 的 specs')
  const scenarios = roots.flatMap(scenariosOf)
  const listed = TABLE.map((row) => row[0])

  const missing = scenarios.filter((name) => !listed.includes(name))
  const extra = listed.filter((name) => !scenarios.includes(name))
  assert.deepEqual(missing, [], '有 scenario 不在對照表上 —— 補一條 scenario 與覆蓋一條是兩個動作')
  assert.deepEqual(extra, [], '對照表上有不存在的 scenario')

  const duplicates = listed.filter((name, index) => listed.indexOf(name) !== index)
  assert.deepEqual(duplicates, [], '對照表有重複的列')
})

test('每一個載體標籤在原始碼中恰有一處命中', () => {
  const sources = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'out' || entry.name === '.git') continue
        walk(full)
      } else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
        // **對照表自己要排除** —— 否則每個標籤至少命中兩處（表上那一份也算）。
        if (entry.name === 'intake-coverage.test.mjs') continue
        sources.push([relative(repoRoot, full), readFileSync(full, 'utf8')])
      }
    }
  }
  walk(join(repoRoot, 'src'))
  walk(join(repoRoot, 'scripts'))

  const problems = []
  for (const [scenario, carrier] of TABLE) {
    if (carrier === null) continue
    const hits = sources.filter(([, text]) => text.includes(carrier))
    // **登記的必須是原始碼裡的字面片段** —— 執行期組出來的字串 grep 不到，
    // 而守衛紅了之後最自然的「修法」就是放寬它。
    //
    // 判準是「**至少**命中一處」而不是「恰好一處」：一個標籤在同一支測試裡同時當測試名與
    // 斷言訊息是常態，而那不構成任何歧義。真正要擋的是**零命中** —— 也就是「填了一個
    // 其實不存在的載體」，那正是上一次 82 列裡那 4 列的樣子。
    if (hits.length === 0) {
      problems.push(`${scenario} → 「${carrier}」在原始碼中找不到`)
    }
  }
  assert.deepEqual(problems, [], '載體標籤必須在原始碼中恰有一處命中')
})

test('(a) 欄為「會照樣綠」的列，必須另有交代', () => {
  // 三種合法處置：換載體（已不是 true）／無載體並寫理由／由對照組承擔（有 mutation）。
  const problems = []
  for (const [scenario, carrier, greenIfAbsent, mutation, note] of TABLE) {
    if (!greenIfAbsent) continue
    const hasMutation = typeof mutation === 'string' && mutation.length > 0
    const hasReason = typeof note === 'string' && note.length > 0
    if (carrier === null && !hasReason) problems.push(`${scenario}：無載體但沒有寫理由`)
    if (carrier !== null && !hasMutation && !hasReason) {
      problems.push(`${scenario}：會照樣綠，但既沒有 mutation 也沒有交代`)
    }
  }
  assert.deepEqual(problems, [], '(a) 欄答案為「會」的列不得以該載體結案')
})
