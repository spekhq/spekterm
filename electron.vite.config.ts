import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import { buildIdentity, devIdentity } from './scripts/lib/build-info.mjs'
import type { BuildIdentity, DevIdentity } from './scripts/lib/build-info.mjs'
import { legalCommentsOf, packageRootOf, packageRootsOf } from './scripts/lib/third-party-licenses.mjs'

/** 字典住在 `src/shared`，main 與 renderer 都要解析得到它（見 `src/shared/i18n`）。 */
const alias = { '@shared': fileURLToPath(new URL('src/shared', import.meta.url)) }

/**
 * `languages/definitions/<lang>/<lang>.js` 是 grammar 本體，經動態 import 載入；同一目錄的
 * `register.js` 是註冊，屬於初始載入路徑。（monaco-editor 0.56 之前是 `basic-languages/<lang>/`，
 * 註冊檔叫 `<lang>.contribution.js` —— **路徑一改，這條規則就靜默地不再命中**，81 種 grammar
 * 全部併進 `monaco` chunk；擋下它的是 `measure:bundle` 的「語言資產為多個 chunk」檢查。）
 */
const LAZY_GRAMMAR = /languages\/definitions\/[^/]+\/[^/]+\.js$/

/**
 * 把編輯器核心切成獨立 chunk。
 *
 * 理由不是快取，是**可歸因**：`workspace-app-shell` 要求編輯器對 bundle 的體積貢獻可被
 * 辨識。與 app 混在同一個主 chunk 裡時，那個數字只能用「加一次、減一次、再相減」估算。
 *
 * grammar 必須留在原本的動態 chunk 裡 —— 把它們也塞進 `monaco` 這個靜態 chunk，
 * 所有語言就會全部進入初始載入路徑（約 640 kB），延遲載入的好處會整個消失。
 */
function chunkForModule(id: string): string | undefined {
  if (!id.includes('monaco-editor')) return undefined
  if (LAZY_GRAMMAR.test(id) && !id.endsWith('/register.js')) return undefined
  return 'monaco'
}

/**
 * 建置身分的注入 —— 見 `build-identity`。
 *
 * **分岔依 vite 的 `command`，不是 `app.isPackaged`。** 後者是執行期的值，而身分必須在**建置
 * 當下**就固定（規格：不隨執行環境改變）—— `command` 是唯一在正確時點就已知的判準。
 * （這與 CSP 那條「依 `ELECTRON_RENDERER_URL` 而非 `app.isPackaged`」是同族，但理由不同：
 * 那條怕誤判，這條是根本問不到。）
 *
 * **只注入 renderer。** `src/renderer/src/build-info.ts` 是唯一的消費點，而它**刻意沒有
 * fallback**：注入沒生效就 `ReferenceError`，app 開不起來 —— 一個「注入失敗就顯示空白」的設計，
 * 其失效方式正是這條能力要消滅的那一種。
 *
 * **`declare const` 讓型別檢查對「注入被拿掉」完全無感**，因此 `scripts/packaging-config.test.mjs`
 * 有一道秒級守衛盯著這裡。
 */
function resolveBuildInfo(command: string): BuildIdentity | DevIdentity {
  const root = fileURLToPath(new URL('.', import.meta.url))
  const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('package.json', import.meta.url)), 'utf8'))
  return command === 'serve' ? devIdentity(version) : buildIdentity(root, version, new Date().toISOString())
}

/**
 * 第三方授權彙總的收集端 —— 見 `project-license`「被出貨的產物附帶本身與第三方的授權文字」。
 *
 * 每個 build 目標把**建置工具自己的模組清單**對應成套件根目錄，寫進 `out/licenses/<target>.json`；
 * `scripts/third-party-licenses.mjs` 再合併成產物裡的那份彙總。devDependencies 裡哪些真的被
 * 打進 bundle，只有 bundler 知道 —— 從依賴宣告去推，會漏掉被打包的、或多列沒被打包的。
 *
 * **只在 build 時執行**：dev server 不產出產物，也沒有完整的模組清單。
 */
function collectBundledPackages(target: 'main' | 'preload' | 'renderer'): Plugin {
  return {
    name: 'spekterm:collect-bundled-packages',
    apply: 'build',
    generateBundle() {
      const dir = fileURLToPath(new URL('out/licenses/', import.meta.url))
      mkdirSync(dir, { recursive: true })
      const ids = [...this.getModuleIds()]
      writeFileSync(`${dir}${target}.json`, `${JSON.stringify(packageRootsOf(ids), null, 2)}\n`)
      // 打包會剝掉原始檔裡的授權註解 —— 從磁碟上的原始檔收回來（見 `legalCommentsOf`）。
      const notices = ids.flatMap((id) => {
        const root = packageRootOf(id)
        if (!root) return []
        const file = id.split('?')[0]
        let source: string
        try {
          source = readFileSync(file, 'utf8')
        } catch {
          return []
        }
        const where = `${root.slice(root.lastIndexOf('/node_modules/') + '/node_modules/'.length)}${file.slice(root.length)}`
        return legalCommentsOf(source).map((comment) => ({ source: where, comment }))
      })
      writeFileSync(`${dir}${target}.notices.json`, `${JSON.stringify(notices, null, 2)}\n`)
    },
  }
}

export default defineConfig(({ command }) => ({
  // main / preload 執行於 Node 環境，依賴一律 external 而非 bundle：
  // native 模組（node-pty）無法被 bundler 處理。
  main: {
    plugins: [externalizeDepsPlugin(), collectBundledPackages('main')],
    resolve: { alias },
    build: {
      rollupOptions: {
        // **兩個進入點。** `insights-worker` 由 `utilityProcess.fork` 載入，因此它必須是產物裡
        // 一支真的檔案，而不是被 bundle 進 `index`。
        //
        // 覆寫 `input` 就取代了 electron-vite 的預設值，於是 `index` 必須一起明列 ——
        // 漏了它 app 根本開不起來（那個失效很吵，不會被漏看）。真正安靜的失效是反過來：
        // 忘記加 worker，dev 可能因為路徑巧合而正常，**打包後才 `MODULE_NOT_FOUND`**，
        // 而 `test:e2e` 的九支都不含 `probe:package`。
        input: {
          index: fileURLToPath(new URL('src/main/index.ts', import.meta.url)),
          'insights-worker': fileURLToPath(new URL('src/main/insights-worker.ts', import.meta.url)),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin(), collectBundledPackages('preload')],
    resolve: { alias },
  },
  renderer: {
    plugins: [react(), tailwindcss(), collectBundledPackages('renderer')],
    resolve: { alias },
    build: {
      rollupOptions: {
        output: {
          manualChunks: chunkForModule,
        },
      },
    },
    define: {
      __BUILD_INFO__: JSON.stringify(resolveBuildInfo(command)),
    },
  },
}))
