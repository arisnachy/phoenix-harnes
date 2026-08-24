/** Remove the disposable VitePress output before a documentation build. */

import { rmSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const target = resolve(root, 'website', '.dist')
const rel = relative(root, target)
const normalizedRel = rel.replaceAll('\\', '/')

if (rel.startsWith('..') || isAbsolute(rel) || normalizedRel !== 'website/.dist') {
  throw new Error(`clean-doc-build: refusing unexpected target ${target}`)
}

rmSync(target, { recursive: true, force: true })
console.log(`clean-doc-build: removed disposable ${normalizedRel}`)
