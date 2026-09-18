/**
 * 驗收腳本的文案來源 —— **與產品同一份字典**。
 *
 * `aria-label` 在這個 repo 裡同時是**選擇器**：探針不得為驗收在產品 UI 上掛 `data-*`
 * （既有紀律），於是它只能靠 `role` 與 `aria-label` 定位元素。而文案與選擇器一旦分離為
 * 兩份字面值，它們就會在某一次改文案時失去同步 —— **失去同步的徵狀是「選不到元素」，
 * 不是「斷言失敗」**：探針拿到 `null`，然後以一種看起來像產品壞掉的方式紅掉。
 *
 * 共用字典消滅的正是那個失敗模式。
 *
 * > **「測試與被測物同源，字典寫錯時探針不會發現」—— 不成立。** 探針驗的是**行為**，不是
 * > 文案內容：沒有哪條 spec 說那顆按鈕必須叫做 `New session`，spec 說的是「觸發它會建立一個
 * > session」。`aria-label` 在這裡的角色是**定位手段**，與 `role` 或 CSS class 沒有差別。
 * > 文案內容的正確性由人擔保 —— 它就印在畫面上。
 *
 * Node 22 的 import attributes 直接讀得到 JSON（這也正是字典是 `.json` 而不是 `.ts` 的原因：
 * `scripts/*.mjs` import 不了 TypeScript）。
 */
import en from '../../src/shared/i18n/en.json' with { type: 'json' }
import zhTW from '../../src/shared/i18n/zh-TW.json' with { type: 'json' }

export { en }

/**
 * 其餘語言的字典。
 *
 * **只有一段驗收會用到它** —— 驗證「首次啟動的語言取自作業系統」的那一段，因為它必須斷言
 * 介面真的變成了另一種語言。其餘每一段都在基準語言下執行（見 `scripts/lib/probe-language.mjs`），
 * **那是它們的前提而不是巧合**：`copy()` 與 `label()` 兩個既有入口因此維持只讀 `en`。
 */
const DICTIONARIES = { en, 'zh-TW': zhTW }

/**
 * 以字典中的文案組出 `aria-label` 選擇器。
 *
 * `label('sessions.new')` → `[aria-label="New session"]`
 */
export function label(keyPath, vars) {
  return `[aria-label="${copy(keyPath, vars)}"]`
}

/**
 * 取出一則文案，並套用 i18next 的 `{{var}}` 插值。
 *
 * 這裡刻意不引入 i18next 本身 —— 探針只需要「把值填進去」，而 `{{var}}` 是純字串取代。
 * 多一個 runtime 依賴，只為了做一次 `String.replace`，不划算。
 */
export function copy(keyPath, vars = {}) {
  return raw(keyPath).replace(/\{\{(\w+)\}\}/g, (match, name) => {
    if (!(name in vars)) throw new Error(`文案 ${keyPath} 需要變數 ${name}`)
    return String(vars[name])
  })
}

function raw(keyPath, language = 'en') {
  const dictionary = DICTIONARIES[language]
  if (!dictionary) throw new Error(`沒有這種語言的字典：${language}`)

  const value = keyPath.split('.').reduce((node, key) => node?.[key], dictionary)

  if (typeof value !== 'string') {
    throw new Error(`${language} 的字典中沒有這個 key（或它不是字串）：${keyPath}`)
  }

  return value
}

/**
 * 指定語言的取文案入口。
 *
 * `copyIn('zh-TW', 'rail.heading')` → 該語言字典中的那一則。變數的插值與 `copy()` 相同。
 */
export function copyIn(language, keyPath, vars = {}) {
  return raw(keyPath, language).replace(/\{\{(\w+)\}\}/g, (match, name) => {
    if (!(name in vars)) throw new Error(`文案 ${keyPath} 需要變數 ${name}`)
    return String(vars[name])
  })
}

/** 指定語言的 `aria-label` 選擇器。 */
export function labelIn(language, keyPath, vars) {
  return `[aria-label="${copyIn(language, keyPath, vars)}"]`
}

/**
 * 帶變數的文案，其**固定前綴**（`{{var}}` 之前的部分）—— 供 `[aria-label^="…"]` 使用。
 *
 * **英文的語序與中文不同，這不是機械替換得來的。** `自 workspace 移除 {{name}}` 的固定部分
 * 在**前面**，而它的英文 `Remove {{name}} from workspace` 把變數放到了**中間** —— 前綴只剩
 * 一個 `Remove `。逐字翻譯的探針會選到錯的東西，或什麼都選不到。
 *
 * 前綴為空即拋錯：`[aria-label^=""]` 會匹配**每一個**元素，那比選不到更糟 —— 它會靜默地
 * 通過。這種情況要改用 `suffixOf`。
 */
export function prefixOf(keyPath) {
  const value = raw(keyPath)
  const index = value.indexOf('{{')
  const prefix = index === -1 ? value : value.slice(0, index)

  if (prefix === '') {
    throw new Error(`文案 ${keyPath} 以變數開頭，沒有固定前綴可用 —— 改用 suffixOf`)
  }

  return prefix
}

/** 帶變數的文案，其**固定後綴**（最後一個 `}}` 之後的部分）—— 供 `[aria-label$="…"]` 使用。 */
export function suffixOf(keyPath) {
  const value = raw(keyPath)
  const index = value.lastIndexOf('}}')
  const suffix = index === -1 ? value : value.slice(index + 2)

  if (suffix === '') {
    throw new Error(`文案 ${keyPath} 以變數結尾，沒有固定後綴可用 —— 改用 prefixOf`)
  }

  return suffix
}

/**
 * 把一則帶變數的文案轉成 regex 來源，變數位置成為擷取群組 —— 用來**自文案反推變數的值**
 * （例如自 `Remove spekterm from workspace` 取回 `spekterm`）。
 */
export function patternOf(keyPath) {
  const escaped = raw(keyPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 上一行把 `{{name}}` escape 成了 `\{\{name\}\}` —— 這裡再把它換成擷取群組。
  return escaped.replace(/\\\{\\\{\w+\\\}\\\}/g, '(.+)')
}
