/**
 * Vite plugin: records which modules the site ships to the browser, for the third-party notices
 * (design D11). It only records; `write-notices.mjs` turns the record into the notices file.
 *
 * Astro builds in more than one Vite environment. What reaches the browser is:
 * - everything in the **client** environment (the page scripts);
 * - the **CSS** of the **prerender** environment — Starlight's styles are built there, not in the
 *   client environment (measured with Astro 7.3 / Starlight 0.42).
 * The rest of the prerender environment renders HTML at build time and does not ship.
 *
 * Some shipped files are emitted as assets with no originating module id (expressive-code's
 * `ec.*.js` / `ec.*.css`) or copied by a separate tool (Pagefind's UI); `write-notices.mjs` adds
 * those packages by name.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where the record goes (inside Astro's ignored cache directory); `write-notices.mjs` reads it. */
export const NOTICE_MODULES_FILE = fileURLToPath(new URL('../.astro/notice-modules.json', import.meta.url))

const CSS_ID = /\.css($|\?)|[?&]type=style\b/

export function collectNoticeModules(outFile) {
  const shipped = new Set()
  return {
    name: 'spekterm-site:collect-notice-modules',
    apply: 'build',
    generateBundle(_options, bundle) {
      const env = this.environment?.name
      if (env !== 'client' && env !== 'prerender') return
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        for (const id of Object.keys(chunk.modules)) {
          if (env === 'client' || CSS_ID.test(id)) shipped.add(id)
        }
      }
      for (const id of this.getModuleIds()) {
        if (env === 'prerender' && CSS_ID.test(id)) shipped.add(id)
        if (env === 'client') shipped.add(id)
      }
      mkdirSync(dirname(outFile), { recursive: true })
      writeFileSync(outFile, `${JSON.stringify([...shipped].sort(), null, 2)}\n`)
    },
  }
}
