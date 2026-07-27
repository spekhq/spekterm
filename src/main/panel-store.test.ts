import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { PANEL_VERSION, PanelStore, parsePanel, writePanelFileAtomic } from './panel-store'

let base: string
let configPath: string

function readConfig(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'))
}

function rawFile(): string {
  return fs.readFileSync(configPath, 'utf8')
}

function corruptFiles(): string[] {
  return fs.readdirSync(base).filter((name) => name.includes('panel.json.corrupt-'))
}

function seed(content: string): PanelStore {
  fs.writeFileSync(configPath, content)
  const store = new PanelStore(configPath)
  store.load()
  return store
}

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'spek-panel-')))
  configPath = path.join(base, 'panel.json')
})

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true })
})

describe('parsePanel：整份損毀 → 丟棄；單一維度損毀 → 只丟該維度', () => {
  it('合法內容原樣解析', () => {
    const raw = JSON.stringify({
      version: 1,
      coordinates: { 'f-a': { sourceFolderId: 'f-b', worktreeKey: 'deadbeef', anchoredChange: 'x' } },
    })
    assert.deepEqual(parsePanel(raw), {
      version: 1,
      coordinates: { 'f-a': { sourceFolderId: 'f-b', worktreeKey: 'deadbeef', anchoredChange: 'x' } },
    })
  })

  it('不是 JSON、版本不符、coordinates 非物件 → null', () => {
    assert.equal(parsePanel('{ not json'), null)
    assert.equal(parsePanel(JSON.stringify({ version: 99, coordinates: {} })), null)
    assert.equal(parsePanel(JSON.stringify({ version: 1, coordinates: [] })), null)
    assert.equal(parsePanel(JSON.stringify({ version: 1 })), null)
  })

  /**
   * **這一條是「兩層容忍」的守衛。** 對照組：把 `sanitizeCoordinate` 改成「任一維度不合法就整筆
   * 回 null」，這條必須變紅 —— 一個壞掉的工作目錄識別碼不該讓使用者連「側欄看哪個 repo」都忘記。
   */
  it('單一維度不合法時，同一筆的其他維度仍還原', () => {
    const raw = JSON.stringify({
      version: 1,
      coordinates: {
        'f-a': { sourceFolderId: 'f-b', worktreeKey: '../../etc', anchoredChange: 'x' },
      },
    })
    assert.deepEqual(parsePanel(raw)?.coordinates, {
      'f-a': { sourceFolderId: 'f-b', anchoredChange: 'x' },
    })
  })

  it('一筆損毀不影響其他 folder 的座標', () => {
    const raw = JSON.stringify({
      version: 1,
      coordinates: { 'f-a': 'not-an-object', 'f-b': { sourceFolderId: 'f-c' } },
    })
    assert.deepEqual(parsePanel(raw)?.coordinates, { 'f-b': { sourceFolderId: 'f-c' } })
  })

  it('三個維度皆不合法的筆數不佔位', () => {
    const raw = JSON.stringify({
      version: 1,
      coordinates: { 'f-a': { sourceFolderId: '', worktreeKey: 'ZZZ', anchoredChange: 42 } },
    })
    assert.deepEqual(parsePanel(raw)?.coordinates, {})
  })
})

describe('PanelStore.load：損毀不得阻止啟動', () => {
  it('內容無法解析時以預設座標啟動，原檔改名保留', () => {
    const store = seed('{ this is not json')
    assert.deepEqual(store.list(), {})
    assert.equal(corruptFiles().length, 1)
  })

  it('檔案不存在時以預設座標啟動，且不建立檔案', () => {
    const store = new PanelStore(configPath)
    store.load()
    assert.deepEqual(store.list(), {})
    assert.equal(fs.existsSync(configPath), false)
  })
})

describe('PanelStore.replace：驗證發生在寫入的入口', () => {
  it('合法座標寫入後可讀回，且帶版本欄位', () => {
    const store = new PanelStore(configPath)
    store.load()
    store.replace({ 'f-a': { sourceFolderId: 'f-b', anchoredChange: 'my-change' } })

    assert.deepEqual(store.list(), { 'f-a': { sourceFolderId: 'f-b', anchoredChange: 'my-change' } })
    assert.equal(readConfig().version, PANEL_VERSION)
  })

  /**
   * **「落盤的座標不含任何路徑」寫成負向斷言。**
   *
   * 正向寫法（寫一份合法座標、再斷言檔案裡沒有 `/`）不論實作對錯都會通過 —— 那是教科書級的假綠。
   * 有鑑別力的問法是：**送一個路徑形狀的值進來，它有沒有真的沒被寫進磁碟。**
   *
   * 對照組：把 `sanitizeCoordinate` 自 `replace()` 拿掉（改為 `...entry` 原樣展開，也就是
   * `session-store.replace()` 現行的姿態），這一條必須變紅。
   */
  it('路徑形狀的工作目錄識別碼不進入磁碟，同筆其他維度照常保存', () => {
    const store = new PanelStore(configPath)
    store.load()
    store.replace({
      'f-a': { sourceFolderId: 'f-b', worktreeKey: '../../../etc/passwd', anchoredChange: 'x' },
    })

    assert.equal(rawFile().includes('etc/passwd'), false, '路徑不得出現在磁碟上')
    assert.equal(rawFile().includes('..'), false)
    assert.deepEqual(store.list(), { 'f-a': { sourceFolderId: 'f-b', anchoredChange: 'x' } })
  })

  it('空座標與空字串鍵不佔位', () => {
    const store = new PanelStore(configPath)
    store.load()
    store.replace({ 'f-a': {}, '': { sourceFolderId: 'f-b' }, 'f-c': { sourceFolderId: 'f-d' } })

    assert.deepEqual(store.list(), { 'f-c': { sourceFolderId: 'f-d' } })
  })

  it('非物件的 payload 靜默忽略，不清空既有座標', () => {
    const store = new PanelStore(configPath)
    store.load()
    store.replace({ 'f-a': { sourceFolderId: 'f-b' } })
    store.replace(null)
    store.replace('nonsense')

    assert.deepEqual(store.list(), { 'f-a': { sourceFolderId: 'f-b' } })
  })
})

describe('PanelStore.remove：以「屬於該 folder 的全部鍵」表達', () => {
  it('folder 被移除後其座標消失，其他 folder 不受影響', () => {
    const store = new PanelStore(configPath)
    store.load()
    store.replace({ 'f-a': { sourceFolderId: 'f-b' }, 'f-b': { anchoredChange: 'x' } })
    store.remove('f-a')

    assert.deepEqual(store.list(), { 'f-b': { anchoredChange: 'x' } })
  })

  /**
   * 鍵在設計上是一個**不透明字串**（rail 的項目集合日後可能納入 linked worktree，屆時鍵形如
   * `<folderId>:<worktreeKey>`）。對照組：把 `#belongsTo` 改成 `key === folderId` 的精確比對，
   * 這一條必須變紅。
   */
  it('隸屬於該 folder 的擴充鍵一併移除，而前綴相似的別筆不受波及', () => {
    const store = new PanelStore(configPath)
    store.load()
    store.replace({
      'f-a': { anchoredChange: 'x' },
      'f-a:deadbeef': { anchoredChange: 'y' },
      'f-ab': { anchoredChange: 'z' },
    })
    store.remove('f-a')

    assert.deepEqual(store.list(), { 'f-ab': { anchoredChange: 'z' } })
  })

  it('未知的 folder 靜默返回，且不改寫檔案', () => {
    const store = new PanelStore(configPath)
    store.load()
    store.replace({ 'f-a': { sourceFolderId: 'f-b' } })
    const before = rawFile()
    store.remove('f-nope')

    assert.equal(rawFile(), before)
  })
})

describe('PanelStore：載入時不主動修剪孤兒條目', () => {
  /**
   * 若某次 `workspace.json` 讀取失敗而以空 workspace 啟動，一次主動修剪就會把**所有**座標刪光
   * —— 一個可復原的失敗（把設定檔救回來）會因此變成不可復原的。
   */
  it('鍵指向一個不存在的 folder 時仍照常載入', () => {
    const store = seed(
      JSON.stringify({ version: 1, coordinates: { 'f-gone': { anchoredChange: 'x' } } }),
    )
    assert.deepEqual(store.list(), { 'f-gone': { anchoredChange: 'x' } })
  })
})

describe('writePanelFileAtomic：原子寫', () => {
  it('先寫暫存檔再更名，不留下半截 JSON', () => {
    writePanelFileAtomic(configPath, { version: PANEL_VERSION, coordinates: { 'f-a': {} } })

    assert.equal(fs.existsSync(`${configPath}.tmp`), false)
    assert.equal(readConfig().version, PANEL_VERSION)
  })

  it('目錄不存在時自行建立', () => {
    const nested = path.join(base, 'deep', 'panel.json')
    writePanelFileAtomic(nested, { version: PANEL_VERSION, coordinates: {} })

    assert.equal(fs.existsSync(nested), true)
  })
})
