/** Regression coverage for source declarations owned by the client test aggregate. */

import { existsSync, readdirSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

function clientCssDeclarations(): string[] {
  const clientGroups = ['client', 'extensions']
  return clientGroups.flatMap((group) => {
    const clientRoot = resolve(root, 'packages', group)
    return readdirSync(clientRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => resolve(clientRoot, entry.name, 'src/css-modules.d.ts'))
  })
    .filter(existsSync)
    .map(file => file.replaceAll(sep, '/'))
    .sort()
}

/** Keep one CSS-independent owner for every client test's TypeScript program. */
function clientPackageTestFiles(): string[] {
  const packages = resolve(root, 'packages/client')
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const path = resolve(directory, entry.name)
      return entry.isDirectory() ? walk(path)
        : /\.tsx?$/.test(entry.name) ? [path.replaceAll(sep, '/')] : []
    })
  return readdirSync(packages, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => {
      const tests = resolve(packages, entry.name, 'tests')
      return existsSync(tests) ? walk(tests) : []
    })
    .sort()
}

function aggregateFiles(name: 'host' | 'client'): Set<string> {
  const file = resolve(root, `tsconfig.${name}.json`)
  const read = ts.readConfigFile(file, ts.sys.readFile)
  if (read.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root)
  return new Set(parsed.fileNames.map(path => path.replaceAll(sep, '/')))
}

describe('client TypeScript aggregate', () => {
  it('keeps every client test in exactly the Host or Client typecheck, not both', () => {
    const host = aggregateFiles('host')
    const client = aggregateFiles('client')
    const misplaced = clientPackageTestFiles().filter(file => {
      const expected = /\.client\.(?:spec\.)?tsx?$/.test(file) ? 'client'
        : /\.host\.(?:spec\.)?tsx?$/.test(file) ? 'host' : undefined
      return expected === undefined
        || (expected === 'host') !== host.has(file)
        || (expected === 'client') !== client.has(file)
    })
    expect(misplaced).toEqual([])
  })

  it('loads package CSS declarations without relying on workspace-link realpaths', () => {
    const configPath = resolve(root, 'tsconfig.client.json')
    const read = ts.readConfigFile(configPath, file => ts.sys.readFile(file))
    if (read.error !== undefined) {
      throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))
    }
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root)
    const loaded = parsed.fileNames
      .map(file => file.replaceAll(sep, '/'))
      .filter(file => file.endsWith('/src/css-modules.d.ts'))
      .sort()
    expect(loaded).toEqual(clientCssDeclarations())
  })
})
