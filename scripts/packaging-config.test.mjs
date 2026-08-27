/**
 * desktop-packaging：打包設定不得靜默退化。
 *
 * **這支測試的效力有明確上界，而那個上界必須被讀到**：它擋的是「日後某次整理 `package.json`
 * 時把設定靜默拿掉」。它**不證明打包會成功**，更不證明產物能執行 —— 它連一次 electron-builder
 * 都沒有跑過。產物是否真的能用，只有 `npm run probe:package` 回答得了（它會真的打包、真的啟動
 * AppImage、真的 spawn 一個 pty）。
 *
 * 這個上界寫在 spec 裡（`desktop-packaging`「打包設定不得靜默退化」），不是註解的客套話 ——
 * 一支秒級的綠燈太容易被讀成「打包沒問題」。
 *
 * 兩個實作上的講究：
 *
 * 1. **glob 用 `path.matchesGlob` 真的匹配，不用字串包含。** 「`asarUnpack` 的某個 pattern 含有
 *    `node-pty` 這幾個字」是一個看起來相關、但不是規格在乎的量 —— 規格在乎的是「node-pty 的
 *    `.node` 會不會被解出 asar」。兩者在 pattern 寫錯一個層級時（`node_modules/node-pty/*`
 *    漏掉子目錄）就會分家，而那正是最可能發生的錯。
 *
 * 2. **`asarUnpack` 有一條反向斷言。** 只驗「node-pty 被匹配到」的話，`**` 這種把整個 asar 都
 *    解開的 pattern 也會通過 —— 那會讓 asar 形同不存在。因此同時要求一個不相干的套件**不被**
 *    匹配到。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, matchesGlob } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))

/** node-pty 的兩類檔案都必須落在 asar 之外：`.node` 要被 `dlopen`，而 `lib` 以相對路徑找到它。 */
const MUST_UNPACK = [
  'node_modules/node-pty/lib/index.js',
  'node_modules/node-pty/prebuilds/linux-x64/pty.node',
]

/** 反向對照：一個純 JS 的相依不該被解出來 —— 它若被匹配到，代表 pattern 寬到 asar 失去意義。 */
const MUST_STAY_PACKED = 'node_modules/chokidar/lib/index.js'

/** electron-builder 會讀取的獨立設定檔。存在任何一個，`package.json` 的 `build` 就可能被架空。 */
const STANDALONE_CONFIG_FILES = [
  'electron-builder.yml',
  'electron-builder.yaml',
  'electron-builder.json',
  'electron-builder.json5',
  'electron-builder.toml',
  'electron-builder.js',
  'electron-builder.cjs',
  'electron-builder.mjs',
  'electron-builder.ts',
  'electron-builder.config.js',
  'electron-builder.config.cjs',
  'electron-builder.config.mjs',
  'electron-builder.config.ts',
]

/** PNG 的 IHDR 固定在檔頭：signature(8) + length(4) + 'IHDR'(4) + width(4) + height(4)。 */
function pngSize(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.ok(buffer.subarray(0, 8).equals(signature), '圖示不是 PNG')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

test('Linux 目標產出 AppImage', () => {
  const targets = pkg.build?.linux?.target ?? []
  const names = targets.map((entry) => (typeof entry === 'string' ? entry : entry.target))
  assert.ok(names.includes('AppImage'), `Linux target 應含 AppImage，實際為 ${JSON.stringify(names)}`)
})

test('產物落在 release/', () => {
  assert.equal(pkg.build?.directories?.output, 'release')
})

/**
 * **這條守的是「明示」，不是「機制」** —— 而那個差別是實測出來的，不是推論。
 *
 * 移除 `asarUnpack` 重新打包後，產物結構**完全相同**（`app.asar.unpacked` 之下同樣是 29 個
 * 檔案）：electron-builder 偵測到套件內含 `.node` 就會整包解出 asar。因此**少了這行設定，
 * 產物不會壞**。
 *
 * 保留它、也保留這條斷言的理由只有一個：不把「native 模組會落在 asar 之外」繫在第三方工具的
 * 隱含行為上 —— 那個行為不出現在我們的設定裡，也就不會在它改變時發出任何聲音。
 *
 * 「node-pty 真的能載入」由 `probe:package` 的行為斷言擔保（pty 建得起來 ⇒ `dlopen` 成功）。
 */
test('asarUnpack 明示 node-pty 須落在 asar 之外', () => {
  const patterns = pkg.build?.asarUnpack ?? []
  assert.ok(patterns.length > 0, 'asarUnpack 未設定 —— 對「native 模組須解出 asar」的明示消失了')

  for (const target of MUST_UNPACK) {
    assert.ok(
      patterns.some((pattern) => matchesGlob(target, pattern)),
      `${target} 未被任何 asarUnpack pattern 匹配`,
    )
  }
})

test('asarUnpack 沒有寬到讓 asar 失去意義', () => {
  const patterns = pkg.build?.asarUnpack ?? []
  assert.ok(
    !patterns.some((pattern) => matchesGlob(MUST_STAY_PACKED, pattern)),
    `${MUST_STAY_PACKED} 被 asarUnpack 匹配到 —— pattern 過寬`,
  )
})

/**
 * electron-builder 的 `npmRebuild` **預設為 true**，會對 native 相依執行重建。
 *
 * 而 `native-module-toolchain` 整條規格建立在相反的前提上：node-pty 是 Node-API 模組，
 * prebuilt 的 `.node` 可同時被 Node 與 Electron 載入，**無需為 Electron 的 ABI 重建**。
 * 開著它有兩個代價 —— 打包從此需要 C++ toolchain，且重建出來的 binary 反而綁死了 ABI。
 */
test('打包不觸發 native 模組重建', () => {
  assert.equal(pkg.build?.npmRebuild, false)
})

test('應用程式圖示存在且尺寸足夠', () => {
  const iconPath = pkg.build?.linux?.icon
  assert.ok(iconPath, 'build.linux.icon 未設定')

  const resolved = join(repoRoot, iconPath)
  assert.ok(existsSync(resolved), `圖示不存在：${iconPath}`)

  // electron-builder 對 Linux 圖示的下限是 256×256。
  const { width, height } = pngSize(readFileSync(resolved))
  assert.ok(width >= 256 && height >= 256, `圖示尺寸不足：${width}×${height}`)
})

/**
 * 設定外移不會讓任何斷言變紅 —— `build.appId` 仍在 `package.json`，`app-identity` 的 scenario
 * 照樣通過，只是 electron-builder 不再讀它。**驗收與生效中的設定就此悄悄分家**，而那正是假綠的
 * 形狀。這條測試是唯一擋得住它的東西。
 */
test('打包設定未外移為獨立設定檔', () => {
  for (const name of STANDALONE_CONFIG_FILES) {
    assert.ok(!existsSync(join(repoRoot, name)), `發現獨立的 electron-builder 設定檔：${name}`)
  }
})

/**
 * 開發模式與打包產物的 userData 必須分家，而**分家要由啟動指令本身保證** ——
 * 需要 `npm run dev` 的場合（追一個探針抓不到的行為）正是最不會記得手動加環境變數的場合，
 * 而遺漏的後果是靜默的：兩份執行各自落盤 session 清單，後寫的贏。
 */
test('dev script 以環境變數隔離 userData', () => {
  const dev = pkg.scripts?.dev ?? ''
  const match = dev.match(/XDG_CONFIG_HOME=(\S+)/)
  assert.ok(match, `dev script 未設定 XDG_CONFIG_HOME：${dev}`)

  // 指回預設位置等於沒有隔離。
  assert.notEqual(match[1], '$HOME/.config')
  assert.notEqual(match[1], '~/.config')
})

/**
 * build-identity：換版與清理必須真的掛在打包指令上。
 *
 * **這是那條「遞增不倚賴任何額外的人工步驟」唯一有鑑別力的守衛。** `probe:package` 那條斷言
 * （最後一個 commit 為 `chore(release): <v>`）在 `release-bump` 被從 `dist:linux` 拿掉之後
 * **仍會讀到上一輪的殘留而照樣綠**；走 `PROBE_PACKAGE_APPIMAGE` 時它更是完全沒跑到。
 * 秒級的靜態守衛在這裡比十幾分鐘的探針強 —— 與上面那條 `dev` script 的 `XDG_CONFIG_HOME`
 * 是同一個模式。
 */
test('dist:linux 掛上換版與產物清理', () => {
  const dist = pkg.scripts?.['dist:linux'] ?? ''
  assert.match(dist, /release-bump/, `dist:linux 未掛上換版：${dist}`)
  assert.match(dist, /prune-release/, `dist:linux 未掛上產物清理：${dist}`)

  // 順序是承重的：換版要在建置**之前**（產物內含的身分才與產物同源），清理要在
  // electron-builder **之後**（不然沒有東西可清）。
  assert.ok(dist.indexOf('release-bump') < dist.indexOf('electron-builder'), '換版必須在建置之前')
  assert.ok(dist.indexOf('prune-release') > dist.indexOf('electron-builder'), '清理必須在打包之後')
})

/**
 * 產物檔名帶版本 —— 這是「這個檔案是哪一版」的答案。
 *
 * electron-builder 的預設 `artifactName` 已含 `${version}`，所以現在**不設定**它就已滿足。
 * 這條守的是「日後有人設定了它、卻漏掉版本」。
 */
test('artifactName 若被設定則含版本', () => {
  const names = [pkg.build?.artifactName, pkg.build?.linux?.artifactName].filter(Boolean)
  for (const name of names) {
    assert.match(name, /\$\{version\}/, `artifactName 未含版本：${name}`)
  }
})

/**
 * 建置身分的注入 —— **`declare const` 讓型別檢查對「注入被拿掉」完全無感**
 * （`src/renderer/src/build-info.ts`）。少了這條守衛，唯一的偵測時機是使用者啟動 app 然後看到
 * 一個白畫面。
 */
test('renderer 的 define 注入建置身分', () => {
  const config = readFileSync(join(repoRoot, 'electron.vite.config.ts'), 'utf8')
  assert.match(config, /__BUILD_INFO__/, 'electron.vite.config.ts 未注入 __BUILD_INFO__')
  assert.match(config, /define:/, 'electron.vite.config.ts 未宣告 define')
})

/**
 * desktop-packaging：安裝與移除見於文件。
 *
 * 一個只有作者知道的指令等於不存在 —— 而這兩支腳本正是那兩條「SHALL 以自桌面環境啟動驗收」的
 * requirement 的前提。
 */
test('README 記載桌面整合的安裝與移除', () => {
  const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8')
  assert.match(readme, /install:desktop/, 'README 未記載安裝指令')
  assert.match(readme, /uninstall:desktop/, 'README 未記載移除方式')
})
