// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { ContextRemaining } from '../src/client/ContextRemaining.tsx'
import type { ContextRemainingProps } from '../src/client/ContextRemaining.tsx'

afterEach(cleanup)

const unusedHook = (() => { throw new Error('unused by ContextRemaining') }) as never

function mount(
  pressure: unknown,
  { wide = true, session = true }: { wide?: boolean; session?: boolean } = {},
) {
  const useProjection = ((key: string) => key === 'contextPressure' ? pressure : undefined) as never
  const props: ContextRemainingProps = {
    wide,
    sessionId: session ? ('s1' as SessionId) : undefined,
    useProjection,
    useSession: unusedHook,
    useSessions: unusedHook,
    useWorkspaces: unusedHook,
    useInput: unusedHook,
    inputActions: unusedHook,
  }
  return render(<ContextRemaining {...props} />)
}

describe('ContextRemaining', () => {
  it('shows a placeholder for an active session until pressure and capacity are both known', () => {
    expect(mount(undefined).container.textContent).toBe('—')
    expect(mount({ pressureTokens: 32_000 }).container.textContent).toBe('—')
    expect(mount({ contextWindow: 128_000 }).container.textContent).toBe('—')
  })

  it('shows the remaining percentage from provider pressure', () => {
    const view = mount({ pressureTokens: 32_000, contextWindow: 128_000 })
    expect(view.container.textContent).toBe('75%')
    expect(view.container.querySelector('[style]')?.getAttribute('style')).toContain('width: 75%')
  })

  it('prefers projected pressure so compaction updates the remaining figure immediately', () => {
    const view = mount({ pressureTokens: 32_000, projectedTokens: 3_000, contextWindow: 128_000 })
    expect(view.container.textContent).toBe('98%')
    expect(view.container.querySelector('[style]')?.getAttribute('style')).toContain('width: 98%')
  })

  it('clamps an overfull context to zero remaining and reports an empty context as fully remaining', () => {
    expect(mount({ pressureTokens: 200_000, contextWindow: 128_000 }).container.textContent).toBe('0%')
    expect(mount({ pressureTokens: 0, contextWindow: 128_000 }).container.textContent).toBe('100%')
  })

  it('renders nothing in the rail or when no session is selected', () => {
    expect(mount({ pressureTokens: 32_000, contextWindow: 128_000 }, { wide: false }).container.textContent).toBe('')
    expect(mount({ pressureTokens: 32_000, contextWindow: 128_000 }, { session: false }).container.textContent).toBe('')
  })
})
