import i18next from 'i18next'
import en from './en.json'

/**
 * **字典是單一份事實，同時供應主行程與 renderer。**
 *
 * 兩者是不同的 JS realm，沒有可以共用的模組實例 —— 因此各自持有一份 i18next，
 * 但 `resources` 指向同一個 `en.json`。
 *
 * 這個模組**不得 import `react-i18next`**：主行程也載入它，而 react-i18next 只存在於
 * renderer 的 bundle 裡（它是 devDependency）。renderer 以 `<I18nextProvider>` 把這個
 * 實例交給 `useTranslation()`。
 */
export const resources = { en: { translation: en } } as const

/**
 * **於模組載入時初始化，而不是導出一個「請記得呼叫」的 init。**
 *
 * 未初始化的 `t()` **不會拋錯，它回傳 `undefined`**（實測）—— 於是任何在 init 之前產生的
 * 文案都會靜靜地變成 `undefined`：不是錯誤訊息，畫面上就只是什麼都沒有。而「誰先載入」在
 * 三個環境裡並不一致：主行程於 `whenReady` 才啟動、renderer 於進入點，而**單元測試根本沒有
 * 進入點** —— 它直接 import 受測模組（`fs-service` 的錯誤訊息現在也走字典）。
 *
 * 把 init 綁在 import 上，這一整類「忘了 init／init 得太晚」的 bug 就不存在了。
 */
void i18next.init({
  lng: 'en',
  fallbackLng: 'en',
  resources,
  // 我們插進文案的是 folder 名稱、檔名這類值，而 React 本來就會跳脫它輸出的每一個字串。
  // i18next 再跳脫一次，只會把 `&` 變成 `&amp;` 印在畫面上。
  interpolation: { escapeValue: false },
})

/**
 * 非元件情境的 `t`（純函式、事件處理器、主行程）。元件用 `useTranslation()` ——
 * 那是選用 react-i18next 的用途：日後真的加了語言，切換時元件會自己重繪。
 */
export const t = i18next.t

/** 供 `<I18nextProvider>` 與當前語言的取用者（如相對時間的 `Intl` locale）使用。 */
export const i18n = i18next
