import i18next from 'i18next'
import en from './en.json'
import zhTW from './zh-TW.json'
import { DEFAULT_LANGUAGE, type Language, isSupportedLanguage } from './languages'

/**
 * **每一種語言的字典是單一份事實，同時供應主行程與 renderer。**
 *
 * 兩者是不同的 JS realm，沒有可以共用的模組實例 —— 因此各自持有一份 i18next，
 * 但 `resources` 指向同一批 JSON。
 *
 * 這個模組**不得 import `react-i18next`**：主行程也載入它，而 react-i18next 只存在於
 * renderer 的 bundle 裡（它是 devDependency）。renderer 以 `<I18nextProvider>` 把這個
 * 實例交給 `useTranslation()`。
 *
 * **`en` 是型別的來源，其餘語言不是。** `i18next.d.ts` 的 `CustomTypeOptions` 只看 `en` ——
 * 其餘語言的字典允許在結構上與它不同（zh 的複數類別只有 `other`，於是它少了 12 個 `_one`），
 * 而「該少的少了、不該少的沒少」由 `scripts/dictionary-completeness.test.mjs` 保證，不由型別保證。
 */
export const resources = {
  en: { translation: en },
  'zh-TW': { translation: zhTW },
}

/**
 * **於模組載入時初始化，而不是導出一個「請記得呼叫」的 init。**
 *
 * 未初始化的 `t()` **不會拋錯，它回傳 `undefined`**（實測）—— 於是任何在 init 之前產生的
 * 文案都會靜靜地變成 `undefined`：不是錯誤訊息，畫面上就只是什麼都沒有。而「誰先載入」在
 * 三個環境裡並不一致：主行程於 `whenReady` 才啟動、renderer 於進入點，而**單元測試根本沒有
 * 進入點** —— 它直接 import 受測模組（`fs-service` 的錯誤訊息現在也走字典）。
 *
 * 把 init 綁在 import 上，這一整類「忘了 init／init 得太晚」的 bug 就不存在了。
 *
 * **初始語言恆為基準語言**，其後由各自的 realm 套用偏好（主行程於 `whenReady`、renderer 於
 * 偏好抵達時）。renderer 因此會有一瞬的英文 —— 與「先以預設字型起、偏好到達再套用」同一條
 * 先例，見 design D2。
 */
void i18next.init({
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  resources,
  // 我們插進文案的是 folder 名稱、檔名這類值，而 React 本來就會跳脫它輸出的每一個字串。
  // i18next 再跳脫一次，只會把 `&` 變成 `&amp;` 印在畫面上。
  interpolation: { escapeValue: false },
})

/**
 * 非元件情境的 `t`（純函式、事件處理器、主行程）。元件用 `useTranslation()` ——
 * 那是選用 react-i18next 的用途：切換語言時元件會自己重繪。
 *
 * **它於呼叫時解析當前語言**，因此 `setLanguage()` 之後的呼叫拿到的是新語言。
 * 唯一的例外是「把 `t()` 的結果存起來」的地方 —— 那些值不會自己更新（見 design D11）。
 */
export const t = i18next.t

/** 供 `<I18nextProvider>` 與當前語言的取用者（如 `locale.ts`）使用。 */
export const i18n = i18next

/**
 * 套用一種語言。**不受支援的值一律無操作** —— 「值壞了」與「使用者選了英文」不是同一件事，
 * 前者的正確處置是維持現狀，讓上游那道白名單去決定。
 */
export async function setLanguage(language: string): Promise<void> {
  if (!isSupportedLanguage(language)) return
  if (i18next.language === language) return
  await i18next.changeLanguage(language)
}

/** 當前語言。**恆為受支援的語言之一** —— init 與 `setLanguage` 兩道入口都擋著。 */
export function currentLanguage(): Language {
  return isSupportedLanguage(i18next.language) ? i18next.language : DEFAULT_LANGUAGE
}

/**
 * 一種語言的**自稱**，供語言選單使用。
 *
 * **自它自己那份字典取得，不是自當前語言的字典**（`getFixedT`）—— 每份字典只認得自己的名字，
 * 於是「把選項標籤翻譯掉」在結構上表達不出來。寫成 `t('languageName')` 的話，中文介面下
 * 兩個選項會一起變成「繁體中文」。
 */
export function languageLabel(language: Language): string {
  return i18next.getFixedT(language)('languageName')
}

export { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, isSupportedLanguage, resolveInitialLanguage } from './languages'
export type { Language } from './languages'
