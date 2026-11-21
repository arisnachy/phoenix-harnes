// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SurfaceBoundary } from '../src/client/AppFrame.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function BrokenApp(): never {
  throw new Error('synthetic broken app')
}
describe('Adaptive OS local recovery', () => {
  it('retries one isolated app crash and then requests restoration of General', () => {
    const restore = vi.fn()
    vi.spyOn(console,'error').mockImplementation(() => {})
    render(<SurfaceBoundary name="adaptive" resetKey="app-test" onRestore={restore}>
      <BrokenApp/>
    </SurfaceBoundary>)
    expect(restore).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button',{name:'Volver a PHOENIX General'})).toBeTruthy()
  })
})
