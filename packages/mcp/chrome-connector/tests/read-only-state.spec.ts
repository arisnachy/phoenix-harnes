import { describe, expect, it } from 'vitest'
import { readInspectPageSources, readPageSources } from '../src/read-only-state.ts'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('parallel read-only browser state', () => {
  it('starts DOM and Vault reads together', async () => {
    const dom = deferred<string>()
    const vault = deferred<string>()
    const started: string[] = []
    const result = readPageSources(
      async () => { started.push('dom'); return await dom.promise },
      async () => { started.push('vault'); return await vault.promise },
    )
    await Promise.resolve()
    expect(started).toEqual(['dom', 'vault'])
    dom.resolve('page')
    vault.resolve('known')
    await expect(result).resolves.toEqual({ dom: 'page', vault: 'known' })
  })

  it('starts layout lookup with DOM and Vault reads', async () => {
    const dom = deferred<string>()
    const vault = deferred<string>()
    const layout = deferred<string>()
    const started: string[] = []
    const result = readInspectPageSources(
      async () => { started.push('dom'); return await dom.promise },
      async () => { started.push('vault'); return await vault.promise },
      async () => { started.push('layout'); return await layout.promise },
    )
    await Promise.resolve()
    expect(started).toEqual(['dom', 'vault', 'layout'])
    dom.resolve('page')
    vault.resolve('known')
    layout.resolve('hint')
    await expect(result).resolves.toEqual({ dom: 'page', vault: 'known', layout: 'hint' })
  })
})
