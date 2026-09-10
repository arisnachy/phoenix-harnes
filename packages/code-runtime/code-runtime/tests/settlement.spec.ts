import { expect, it, vi } from 'vitest'
import { settleCodeRuns } from '../src/index.ts'

it('settles the run snapshot before waiting for every resource to finish', async () => {
  const first = Promise.withResolvers<undefined>()
  const second = Promise.withResolvers<undefined>()
  const live = new Set([
    { finished: first.promise, settle: vi.fn() },
    { finished: second.promise, settle: vi.fn() },
  ])
  const runs = [...live]
  runs[0]!.settle.mockImplementation(() => { live.clear() })
  const completed = vi.fn()
  const failure = { kind: 'abort' as const, message: 'runtime disposed' }
  const draining = settleCodeRuns(live, failure).then(completed)
  for (const run of runs) expect(run.settle).toHaveBeenCalledWith(failure)
  first.resolve(undefined)
  await Promise.resolve()
  expect(completed).not.toHaveBeenCalled()
  second.resolve(undefined)
  await draining
  expect(completed).toHaveBeenCalledOnce()
})
