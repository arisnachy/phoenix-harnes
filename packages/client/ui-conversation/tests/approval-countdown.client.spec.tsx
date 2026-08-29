// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApprovalCountdown } from '../src/client/skeleton/ApprovalCountdown.tsx'

const deadline = {
  requestedAt: 1_000,
  expiresAt: 6_000,
  risk: 'low' as const,
  recommendation: 'allowed-once' as const,
  policyRevision: 0,
}

describe('ApprovalCountdown', () => {
  afterEach(() => { cleanup() })

  it('shows the recommendation and decreases once per second', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    try {
      render(<ApprovalCountdown deadline={deadline} onExpire={vi.fn()} onChoose={vi.fn()} />)
      expect(screen.getByRole('button', { name: 'Allow once' })).toBeTruthy()
      expect(screen.getByLabelText(/5 seconds remaining/i)).toBeTruthy()
      act(() => { vi.advanceTimersByTime(1_000) })
      expect(screen.getByLabelText(/4 seconds remaining/i)).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('expires once with the stored recommendation and cancels the timer after an explicit choice', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    try {
      const onExpire = vi.fn()
      const onChoose = vi.fn()
      render(<ApprovalCountdown deadline={deadline} onExpire={onExpire} onChoose={onChoose} />)
      fireEvent.click(screen.getByRole('button', { name: /allow once/i }))
      expect(onChoose).toHaveBeenCalledWith('allowed-once')
      act(() => { vi.advanceTimersByTime(10_000) })
      expect(onExpire).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('calls expiry once when the deadline passes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    try {
      const onExpire = vi.fn()
      render(<ApprovalCountdown deadline={deadline} onExpire={onExpire} onChoose={vi.fn()} />)
      act(() => { vi.advanceTimersByTime(5_000) })
      expect(onExpire).toHaveBeenCalledTimes(1)
      act(() => { vi.advanceTimersByTime(5_000) })
      expect(onExpire).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
