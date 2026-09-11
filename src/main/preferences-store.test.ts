import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import {
  PREFERENCES_VERSION,
  PreferencesStore,
  parsePreferences,
  writePreferencesFileAtomic,
} from './preferences-store'

let base: string
let configPath: string

function readConfig(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'))
}

function corruptFiles(): string[] {
  return fs.readdirSync(base).filter((name) => name.includes('preferences.json.corrupt-'))
}

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'spek-prefs-')))
  configPath = path.join(base, 'preferences.json')
})

afterEach(() => {
  mock.restoreAll()
  fs.rmSync(base, { recursive: true, force: true })
})

describe('parsePreferences：結構嚴格', () => {
  it('合法內容原樣解析', () => {
    const raw = JSON.stringify({ version: 1, terminal: { fontFamily: 'Fira Code', fontSize: 15 } })
    assert.deepEqual(parsePreferences(raw), {
      version: 1,
      terminal: { fontFamily: 'Fira Code', fontSize: 15 },
    })
  })

  it('不是有效 JSON → null', () => {
    assert.equal(parsePreferences('{ not json'), null)
  })

  it('版本不符 → null（整檔不可信）', () => {
    assert.equal(parsePreferences(JSON.stringify({ version: 999, terminal: {} })), null)
  })

  it('terminal 不是物件 → null', () => {
    assert.equal(parsePreferences(JSON.stringify({ version: 1, terminal: 42 })), null)
    assert.equal(parsePreferences(JSON.stringify({ version: 1 })), null)
  })

  it('空 terminal 是合法的（＝全用預設）', () => {
    assert.deepEqual(parsePreferences(JSON.stringify({ version: 1, terminal: {} })), {
      version: 1,
      terminal: {},
    })
  })
})

describe('parsePreferences：值寬容（清理／夾制而非棄檔）', () => {
  it('fontSize 超出範圍被夾制，而非使整檔無效', () => {
    assert.equal(
      parsePreferences(JSON.stringify({ version: 1, terminal: { fontSize: 100 } }))?.terminal
        .fontSize,
      32,
    )
    assert.equal(
      parsePreferences(JSON.stringify({ version: 1, terminal: { fontSize: 2 } }))?.terminal
        .fontSize,
      8,
    )
  })

  it('fontSize 非有限數 → 省略（用預設），不棄檔', () => {
    const parsed = parsePreferences(
      JSON.stringify({ version: 1, terminal: { fontSize: 'big', fontFamily: 'Mono' } }),
    )
    assert.equal(parsed?.terminal.fontSize, undefined)
    assert.equal(parsed?.terminal.fontFamily, 'Mono')
  })

  it('fontFamily 保留含空白的字型名', () => {
    assert.equal(
      parsePreferences(JSON.stringify({ version: 1, terminal: { fontFamily: 'MesloLGS NF' } }))
        ?.terminal.fontFamily,
      'MesloLGS NF',
    )
  })

  it('fontFamily 剝除雙引號（會破壞 CSS font-family 字串）', () => {
    assert.equal(
      parsePreferences(
        JSON.stringify({ version: 1, terminal: { fontFamily: 'Evil", serif; x:' } }),
      )?.terminal.fontFamily,
      'Evil, serif; x:',
    )
  })

  it('fontFamily 非字串 → 省略', () => {
    assert.equal(
      parsePreferences(JSON.stringify({ version: 1, terminal: { fontFamily: 123 } }))?.terminal
        .fontFamily,
      undefined,
    )
  })

  it('lineHeight 超出範圍被夾制', () => {
    assert.equal(
      parsePreferences(JSON.stringify({ version: 1, terminal: { lineHeight: 5 } }))?.terminal
        .lineHeight,
      2,
    )
    assert.equal(
      parsePreferences(JSON.stringify({ version: 1, terminal: { lineHeight: 0.2 } }))?.terminal
        .lineHeight,
      1,
    )
  })

  it('lineHeight 是分數，不取整（1.2 不得變成 1）', () => {
    assert.equal(
      parsePreferences(JSON.stringify({ version: 1, terminal: { lineHeight: 1.2 } }))?.terminal
        .lineHeight,
      1.2,
    )
  })

  it('lineHeight 非有限數 → 省略（用預設）', () => {
    assert.equal(
      parsePreferences(JSON.stringify({ version: 1, terminal: { lineHeight: 'tall' } }))?.terminal
        .lineHeight,
      undefined,
    )
  })
})

describe('PreferencesStore：讀寫與持久化', () => {
  it('無設定檔時 get() 為空（全用預設）且不留 corrupt 檔', () => {
    const store = new PreferencesStore(configPath)
    store.load()
    assert.deepEqual(store.get(), {})
    assert.equal(corruptFiles().length, 0, '首次啟動不是損毀')
  })

  it('設定字型後 get() 反映，且帶版本欄位', () => {
    const store = new PreferencesStore(configPath)
    store.load()
    const applied = store.setTerminalFont('JetBrains Mono', 16, null)

    assert.deepEqual(applied, { fontFamily: 'JetBrains Mono', fontSize: 16 })
    assert.deepEqual(store.get(), { fontFamily: 'JetBrains Mono', fontSize: 16 })
    assert.equal(readConfig().version, PREFERENCES_VERSION)
  })

  it('GPU 加速：未設定即為啟用（省略而非寫入 true）', () => {
    const store = new PreferencesStore(configPath)
    store.load()

    assert.equal(store.get().gpuAcceleration, undefined, '未設定＝預設啟用，不占空間')
    store.setGpuAcceleration(false)
    assert.equal(store.get().gpuAcceleration, false)
    store.setGpuAcceleration(null)
    assert.equal(store.get().gpuAcceleration, undefined, 'null ＝清回預設')
  })

  it('設定字型不得抹掉 GPU 偏好', () => {
    // **這條守的是一個會靜默毀掉使用者設定的陷阱**：`setTerminalFont` 從一個空物件重建
    // `terminal` —— 少了保留邏輯，使用者關掉 GPU（因為驅動有問題、畫面是壞的）之後，
    // 只要再調一次字級，GPU 就自己開回來了，而那正是他關掉它的原因。
    const store = new PreferencesStore(configPath)
    store.load()
    store.setGpuAcceleration(false)

    store.setTerminalFont('Fira Code', 14, null)
    assert.equal(store.get().gpuAcceleration, false, '改字型不該動到 GPU 偏好')

    // 反向：改 GPU 不該抹掉字型。
    store.setGpuAcceleration(true)
    assert.deepEqual(store.get(), { fontFamily: 'Fira Code', fontSize: 14, gpuAcceleration: true })
  })

  it('agentView 跨一次 load() 還原 —— 只驗 setter 的回傳值不算', () => {
    // **必須跨 `load()`。** `parsePreferences` 的解構清單是第二處白名單，型別檢查對它零感知：
    // 漏在那裡的欄位寫得進磁碟卻讀不回來，而只驗 setter 回傳值的測試照樣全綠
    // （`agentStatus` / `agentEvents` 目前就是這個狀態）。
    const first = new PreferencesStore(configPath)
    first.load()
    assert.equal(first.get().agentView, undefined, '前置：一開始是未設定')
    first.setAgentView('conversation')

    const second = new PreferencesStore(configPath)
    second.load()
    assert.equal(second.get().agentView, 'conversation')
  })

  it('agentView 只認那兩個字面值，其餘視為未設定', () => {
    for (const bad of ['Conversation', 'chat', '', 42, null, true, {}]) {
      fs.writeFileSync(
        configPath,
        JSON.stringify({ version: PREFERENCES_VERSION, terminal: { agentView: bad } }),
      )
      const store = new PreferencesStore(configPath)
      store.load()
      assert.equal(store.get().agentView, undefined, `不合法的值：${JSON.stringify(bad)}`)
    }
  })

  it('改字型不該動到 agentView', () => {
    const store = new PreferencesStore(configPath)
    store.load()
    store.setAgentView('conversation')

    store.setTerminalFont('Fira Code', 14, null)
    assert.equal(store.get().agentView, 'conversation', '改字型不該把 view 彈回終端')
  })

  it('舊檔（無 agentView）照常解析，其他欄位不受影響', () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ version: PREFERENCES_VERSION, terminal: { fontFamily: 'Fira Code', gpuAcceleration: false } }),
    )
    const store = new PreferencesStore(configPath)
    store.load()
    assert.deepEqual(store.get(), { fontFamily: 'Fira Code', gpuAcceleration: false })
  })

  it('GPU 偏好跨重啟還原，且只認真正的布林', () => {
    const first = new PreferencesStore(configPath)
    first.load()
    first.setGpuAcceleration(false)

    const second = new PreferencesStore(configPath)
    second.load()
    assert.equal(second.get().gpuAcceleration, false)

    // 檔案裡的 `"false"`（字串）不是布林 —— 當成未設定（＝預設啟用），
    // 而不是硬轉成 false 把 GPU 關掉。
    fs.writeFileSync(
      configPath,
      JSON.stringify({ version: PREFERENCES_VERSION, terminal: { gpuAcceleration: 'false' } }),
    )
    const third = new PreferencesStore(configPath)
    third.load()
    assert.equal(third.get().gpuAcceleration, undefined, '非布林一律視為未設定')
  })

  it('重啟後還原', () => {
    const first = new PreferencesStore(configPath)
    first.load()
    first.setTerminalFont('Fira Code', 14, null)

    const second = new PreferencesStore(configPath)
    second.load()
    assert.deepEqual(second.get(), { fontFamily: 'Fira Code', fontSize: 14 })
  })

  it('傳 null 清為預設（欄位不占空間）', () => {
    const store = new PreferencesStore(configPath)
    store.load()
    store.setTerminalFont('Fira Code', 14, null)
    store.setTerminalFont(null, null, null)

    assert.deepEqual(store.get(), {})
    assert.deepEqual((readConfig().terminal as Record<string, unknown>), {})
  })

  it('寫入時夾制 size、清理 family', () => {
    const store = new PreferencesStore(configPath)
    store.load()
    const applied = store.setTerminalFont('Bad"Name', 999, null)

    assert.equal(applied.fontSize, 32)
    assert.equal(applied.fontFamily, 'BadName')
  })

  it('不合法的 size 清為未設定，而非寫入原值', () => {
    const store = new PreferencesStore(configPath)
    store.load()
    // 型別上是 number | null，但被入侵的 renderer 可送任意型別 —— 不得原樣持久化
    const applied = store.setTerminalFont('Mono', Number.NaN as unknown as number, null)
    assert.equal(applied.fontSize, undefined)
    assert.equal(applied.fontFamily, 'Mono')
  })

  it('lineHeight 一併設定、夾制並跨重啟還原', () => {
    const first = new PreferencesStore(configPath)
    first.load()
    const applied = first.setTerminalFont('Fira Code', 14, 1.2)
    assert.deepEqual(applied, { fontFamily: 'Fira Code', fontSize: 14, lineHeight: 1.2 })

    // 超出範圍夾制（不是拒絕整筆）
    assert.equal(first.setTerminalFont(null, null, 9).lineHeight, 2)

    first.setTerminalFont('Fira Code', 14, 1.2)
    const second = new PreferencesStore(configPath)
    second.load()
    assert.deepEqual(second.get(), { fontFamily: 'Fira Code', fontSize: 14, lineHeight: 1.2 })
  })

  it('lineHeight 傳 null 清為預設', () => {
    const store = new PreferencesStore(configPath)
    store.load()
    store.setTerminalFont(null, null, 1.5)
    assert.equal(store.get().lineHeight, 1.5)

    store.setTerminalFont(null, null, null)
    assert.equal(store.get().lineHeight, undefined)
  })
})

describe('PreferencesStore：損毀韌性', () => {
  it('內容不是有效 JSON：以預設啟動並保留原檔', () => {
    fs.writeFileSync(configPath, '{ this is not json')

    const store = new PreferencesStore(configPath)
    store.load()

    assert.deepEqual(store.get(), {})
    assert.equal(corruptFiles().length, 1, '原檔須改名保留而非刪除')
    assert.equal(fs.existsSync(configPath), false)
  })

  it('版本無法辨識：以預設啟動並保留原檔', () => {
    fs.writeFileSync(configPath, JSON.stringify({ version: 999, terminal: {} }))

    const store = new PreferencesStore(configPath)
    store.load()

    assert.deepEqual(store.get(), {})
    assert.equal(corruptFiles().length, 1)
  })

  it('寫入過程不留下不完整的設定檔', () => {
    fs.writeFileSync(configPath, JSON.stringify({ version: 1, terminal: {} }))
    const before = fs.readFileSync(configPath, 'utf8')

    mock.method(fs, 'renameSync', () => {
      throw new Error('rename failed')
    })

    const store = new PreferencesStore(configPath)
    store.load()
    assert.throws(() => store.setTerminalFont('Mono', 14, null))

    assert.equal(fs.readFileSync(configPath, 'utf8'), before, '目標檔不得被部分寫入')
    assert.equal(fs.existsSync(`${configPath}.tmp`), true, '新內容應落在暫存檔')
  })

  it('writePreferencesFileAtomic 會建立缺少的目錄', () => {
    const nested = path.join(base, 'deep', 'preferences.json')
    writePreferencesFileAtomic(nested, { version: PREFERENCES_VERSION, terminal: {} })
    assert.equal(fs.existsSync(nested), true)
  })
})

describe('agentEvents 讀得回來，且不被字型變更抹掉', () => {
  it('寫得進磁碟也讀得回來', () => {
    const parsed = parsePreferences(
      JSON.stringify({ version: PREFERENCES_VERSION, terminal: { agentEvents: false } }),
    )
    assert.equal(parsed?.terminal.agentEvents, false)
  })

  it('非布林一律視為未設定（＝預設啟用）', () => {
    const parsed = parsePreferences(
      JSON.stringify({ version: PREFERENCES_VERSION, terminal: { agentEvents: 'false' } }),
    )
    assert.equal(parsed?.terminal.agentEvents, undefined)
  })
})

describe('變更字型不抹掉 agentEvents', () => {
  it('setTerminalFont 之後 agentEvents 仍在', () => {
    const file = path.join(tmpdir(), `prefs-agentevents-${process.pid}-${Date.now()}.json`)
    try {
      fs.writeFileSync(
        file,
        JSON.stringify({ version: PREFERENCES_VERSION, terminal: { agentEvents: false } }),
      )
      const store = new PreferencesStore(file)
      store.load()
      assert.equal(store.get().agentEvents, false)

      // **這個方法從空物件重建 `terminal`** —— 每個欄位都倚賴呼叫端記得保留它。
      // 少了那一行，症狀是「關掉事件回報之後調一次字級，它自己開回來了」。
      store.setTerminalFont('Fira Code', 14, null)
      assert.equal(store.get().agentEvents, false)
    } finally {
      fs.rmSync(file, { force: true })
    }
  })
})
