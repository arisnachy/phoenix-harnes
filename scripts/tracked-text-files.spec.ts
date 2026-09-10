import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { trackedTextFiles } from './tracked-text-files.ts'

it('scans tracked text while retaining path filters and omitting missing or binary files', () => {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-tracked-text-'))
  try {
    execFileSync('git', ['init', '--quiet', root])
    writeFileSync(join(root, 'kept.txt'), 'tracked content')
    writeFileSync(join(root, 'excluded.txt'), 'excluded content')
    writeFileSync(join(root, 'binary.bin'), Buffer.from([65, 0, 66]))
    writeFileSync(join(root, 'missing.txt'), 'removed after staging')
    execFileSync('git', ['add', '.'], { cwd: root })
    writeFileSync(join(root, 'untracked.txt'), 'untracked content')
    rmSync(join(root, 'missing.txt'))

    expect([...trackedTextFiles(root, file => file !== 'excluded.txt')]).toEqual([
      { file: 'kept.txt', source: 'tracked content' },
    ])
    expect([...trackedTextFiles(root)].map(entry => entry.file)).toEqual(['excluded.txt', 'kept.txt'])
  } finally {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('phoenix-tracked-text-')) {
      throw new Error('Refusing cleanup outside the owned temporary directory')
    }
    rmSync(root, { recursive: true, force: true })
  }
})
