import en from './en.json'
import zhTW from './zh-TW.json'

/**
 * Strings of the site's own components (Starlight's interface strings come with Starlight).
 * Both files carry the same keys — `scripts/check-parity.mjs` fails the build otherwise — so a
 * lookup never falls back silently.
 */
const dictionaries: Record<string, Record<string, string>> = { en, 'zh-TW': zhTW }

export type Key = keyof typeof en

export function useStrings(lang: string | undefined) {
  const dictionary = dictionaries[lang ?? 'en'] ?? en
  return (key: Key): string => dictionary[key] ?? en[key]
}
