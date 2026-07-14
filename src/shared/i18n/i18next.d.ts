import type en from './en.json'

/**
 * **key 的型別安全。**
 *
 * 少了這段，`t('rail.emty')` 不會編譯失敗 —— 它會在執行期把 `rail.emty` 這串字**印在畫面上**。
 * 那正是 JSON 字典唯一真正的弱點，而它是可以關掉的：`resolveJsonModule` 已開啟，於是
 * `typeof en` 就是那份字典的形狀，餵回 i18next 即可讓打錯的 key 在 `npm run typecheck` 失敗。
 *
 * **不需要任何型別產生器。**
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof en }
  }
}
