/**
 * A probe starts `electron-vite dev` only through `scripts/lib/renderer-dev-server.mjs`.
 *
 * `electron-vite dev --rendererOnly` still starts an Electron of its own, with no `--user-data-dir`:
 * on the developer's machine it ran on the real profile and resumed every running session with the
 * real `claude` (a second live process per conversation) for as long as a probe's dev mode lasted.
 * The helper replaces that Electron with a holder script and refuses to hand out a dev server
 * until the holder has started. A probe that spawns `electron-vite dev` itself gets none of that,
 * and nothing in the probe turns red — so this guard.
 *
 * It walks the syntax tree, so comments (which name the command freely) are exempt. It flags an
 * array literal holding both `'electron-vite'` and `'dev'` (a spawn's argv) and any string that
 * contains `electron-vite dev` (a shell command line).
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

import { rendererDevServerEnv } from './lib/renderer-dev-server.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const scriptsRoot = join(repoRoot, 'scripts')
const HELPER = join('scripts', 'lib', 'renderer-dev-server.mjs')

const isStringish = (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)

export function findDevServerSpawns(source, fileName = 'sample.mjs') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found = []
  const at = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1

  const visit = (node) => {
    if (ts.isArrayLiteralExpression(node)) {
      const texts = node.elements.filter(isStringish).map((element) => element.text)
      if (texts.includes('electron-vite') && texts.includes('dev')) found.push({ line: at(node), kind: 'argv' })
    } else if (isStringish(node) && /electron-vite\s+dev\b/.test(node.text)) {
      found.push({ line: at(node), kind: 'command-line' })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function scriptFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : scriptFiles(path)
    return /\.m?js$/.test(entry.name) && !entry.name.endsWith('.test.mjs') ? [path] : []
  })
}

test('the guard sees a spawn argv and a command line, and not a comment or a build', () => {
  assert.equal(findDevServerSpawns(`spawn('npx', ['electron-vite', 'dev', '--rendererOnly'])`).length, 1)
  assert.equal(findDevServerSpawns('execSync(`npx electron-vite dev --rendererOnly`)').length, 1)
  assert.equal(findDevServerSpawns(`// spawn('npx', ['electron-vite', 'dev'])\nconst a = 1`).length, 0)
  assert.equal(findDevServerSpawns(`spawn('npx', ['electron-vite', 'build'])`).length, 0)
})

test('no script starts electron-vite dev except the renderer dev server helper', () => {
  const offenders = scriptFiles(scriptsRoot)
    .map((path) => relative(repoRoot, path))
    .filter((path) => path !== HELPER)
    .flatMap((path) =>
      findDevServerSpawns(readFileSync(join(repoRoot, path), 'utf8'), path).map(({ line, kind }) => `${path}:${line} (${kind})`),
    )
  assert.deepEqual(offenders, [], 'start the dev server with startRendererDevServer() from scripts/lib/renderer-dev-server.mjs')
  // Control: the helper itself is seen by the guard, so an empty list above is not a blind walk.
  assert.ok(findDevServerSpawns(readFileSync(join(repoRoot, HELPER), 'utf8')).some(({ kind }) => kind === 'argv'))
})

test("the dev server's environment replaces electron-vite's Electron with the holder", () => {
  const env = rendererDevServerEnv({ PATH: '/usr/bin', ELECTRON_EXEC_PATH: '/somewhere/electron' })
  assert.equal(env.ELECTRON_EXEC_PATH, process.execPath)
  assert.ok(existsSync(env.ELECTRON_ENTRY), `holder missing: ${env.ELECTRON_ENTRY}`)
  assert.equal(env.PATH, '/usr/bin')
})
