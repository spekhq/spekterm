/**
 * remote-protocol: "The protocol is documented, and the document matches the server".
 *
 * `docs/remote-protocol.md` is the contract the Android repository builds against. Every operation the
 * server accepts — the dispatcher's allow-list (`OPERATIONS` in `src/main/remote-protocol.ts`) plus the two the
 * listener handles before authentication (`AUTH_OPERATIONS`) — must have a `### \`name\`` heading there, and
 * the document must name no operation the server does not accept.
 *
 * Read from the source with the TypeScript parser, not by importing it: this test must not depend on a
 * loader, and the allow-list is a literal table.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROTOCOL = join(repoRoot, 'src', 'main', 'remote-protocol.ts')
const DOC = join(repoRoot, 'docs', 'remote-protocol.md')

export function serverOperations(source) {
  const file = ts.createSourceFile('remote-protocol.ts', source, ts.ScriptTarget.Latest, true)
  const names = []
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      let init = node.initializer
      while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression?.(init))) init = init.expression
      if (node.name.text === 'OPERATIONS' && init && ts.isObjectLiteralExpression(init)) {
        for (const property of init.properties) {
          if (property.name && (ts.isStringLiteral(property.name) || ts.isIdentifier(property.name))) names.push(property.name.text)
        }
      }
      if (node.name.text === 'AUTH_OPERATIONS' && init && ts.isArrayLiteralExpression(init)) {
        for (const element of init.elements) if (ts.isStringLiteral(element)) names.push(element.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return names.sort()
}

export function documentedOperations(markdown) {
  return [...markdown.matchAll(/^### `([a-z][a-zA-Z.]*)`\s*$/gm)].map((match) => match[1]).sort()
}

function difference(server, doc) {
  return {
    undocumented: server.filter((name) => !doc.includes(name)),
    unknown: doc.filter((name) => !server.includes(name)),
  }
}

test('the protocol document lists exactly the operations the server accepts', () => {
  const server = serverOperations(readFileSync(PROTOCOL, 'utf8'))
  const doc = documentedOperations(readFileSync(DOC, 'utf8'))
  assert.ok(server.length > 15, `the source scan found only ${server.length} operations`)
  assert.ok(server.includes('hello') && server.includes('conversation.send'))
  assert.deepEqual(difference(server, doc), { undocumented: [], unknown: [] })
})

test('control: a document missing an operation fails and names it', () => {
  const server = serverOperations(readFileSync(PROTOCOL, 'utf8'))
  const doc = documentedOperations(readFileSync(DOC, 'utf8').replace(/^### `terminal\.input`\s*$/m, ''))
  assert.deepEqual(difference(server, doc).undocumented, ['terminal.input'])
})

test('control: an operation documented but not accepted fails and names it', () => {
  const server = serverOperations(readFileSync(PROTOCOL, 'utf8'))
  const doc = documentedOperations(`${readFileSync(DOC, 'utf8')}\n### \`fs.writeFile\`\n`)
  assert.deepEqual(difference(server, doc).unknown, ['fs.writeFile'])
})

/** The relay's part of the contract (`phone-relay`): what the Android app builds its relay path on. */
export function relayStatements(doc) {
  return {
    field: /`relay`: this phone's relay grant/.test(doc) && /"url": string, "fp"\?: string, "grant": string, "secret": string/.test(doc),
    absent: /\*\*Absent means this phone has no grant: discard a stored one\.\*\*/.test(doc),
    event: /- `relay\.changed`: `\{ "relay": Relay \| null \}`/.test(doc) && /`null` means no grant/.test(doc),
    noPair: /accepts `hello` only\. `pair` is answered `PAIRING_FAILED`/.test(doc),
    throttle: /throttled per grant instead of per address/.test(doc),
  }
}

test('the protocol document states the relay field and event', () => {
  const statements = relayStatements(readFileSync(DOC, 'utf8'))
  assert.deepEqual(Object.entries(statements).filter(([, ok]) => !ok).map(([name]) => name), [])
})

test('control: a document without the relay statements fails each check', () => {
  assert.deepEqual(Object.values(relayStatements('# nothing about the relay')), [false, false, false, false, false])
})

/**
 * The prompt's reason and the answer despite typing (`remote-answer-despite-typed`): the Android app reads
 * `blockedBy` as support for `despiteTyped`, so the document must say they come together.
 */
export function despiteTypedStatements(doc) {
  const values = ['open', 'size', 'answered', 'stirred', 'decisive', 'typed']
  return {
    field: /`blockedBy` is present only when `answerable` is `false`/.test(doc),
    values: values.every((value) => new RegExp(`^\\| \`${value}\` \\|`, 'm').test(doc)),
    param: /"despiteTyped"\?/.test(doc) && /\*\*`despiteTyped`\*\* \(`true` or `false`; anything else is `BAD_PARAMS`\)/.test(doc),
    together: /\*\*`blockedBy` and `despiteTyped` come together\*\*/.test(doc),
    obligation: /\*\*Warn the user before `conversation\.answer` with `despiteTyped`\*\*/.test(doc),
  }
}

test('the protocol document states the prompt reason, the despiteTyped flag, and that they come together', () => {
  const statements = despiteTypedStatements(readFileSync(DOC, 'utf8'))
  assert.deepEqual(Object.entries(statements).filter(([, ok]) => !ok).map(([name]) => name), [])
})

test('control: a document without those statements fails each check', () => {
  assert.deepEqual(Object.values(despiteTypedStatements('# nothing about them')), [false, false, false, false, false])
  const doc = readFileSync(DOC, 'utf8')
  assert.equal(despiteTypedStatements(doc.replace('| `decisive` |', '| `deciding` |')).values, false, 'a value renamed')
  assert.equal(despiteTypedStatements(doc.replace('**`blockedBy` and `despiteTyped` come together**', 'they come together')).together, false)
})
