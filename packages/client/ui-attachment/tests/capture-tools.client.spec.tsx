// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ComposerCaptureProps } from '@phoenix-ai/dsh-client-ui-conversation/client'
import { CaptureTools } from '../src/client/CaptureTools.tsx'
import { ComposerAttachments } from '../src/client/ComposerAttachments.tsx'
import type { ComposerAttachmentsProps } from '@phoenix-ai/dsh-client-ui-conversation/client'
import { capturePresenceFrame } from '../src/client/presence-capture.ts'

vi.mock('../src/client/presence-capture.ts', () => ({ capturePresenceFrame: vi.fn() }))
const capture = vi.mocked(capturePresenceFrame)
const originalMedia = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
const t = ((key: string) => key) as ComposerCaptureProps['t']

beforeEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true, value: { getDisplayMedia: vi.fn(), getUserMedia: vi.fn() },
  })
  capture.mockReset()
})
afterEach(() => {
  cleanup()
  if (originalMedia) Object.defineProperty(navigator, 'mediaDevices', originalMedia)
  else Reflect.deleteProperty(navigator, 'mediaDevices')
})
const props = (onAddImages = vi.fn(), canAcceptDrop = true) =>
  ({ onAddImages, canAcceptDrop, t }) as unknown as ComposerCaptureProps

describe('composer capture tools', () => {
  it('captures only on direct click and forwards a single frame through draft intake', async () => {
    const file = new File(['frame'], 'phoenix-screen.jpg', { type: 'image/jpeg' })
    capture.mockResolvedValue(file)
    const add = vi.fn()
    const view = render(<CaptureTools {...props(add)} />)
    expect(capture).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: 'image.captureScreen' }))
    await waitFor(() => expect(add).toHaveBeenCalledExactlyOnceWith([file]))
    expect(capture).toHaveBeenCalledWith(expect.any(AbortSignal), 'screen')
  })

  it('does not expose standalone capture buttons in the attachment rail', () => {
    const view = render(<ComposerAttachments {...({
      ...props(), attachments: [], onRemoveImage: vi.fn(),
    } as unknown as ComposerAttachmentsProps)} />)
    expect(view.queryByRole('button', { name: 'image.captureScreen' })).toBeNull()
    expect(view.queryByRole('button', { name: 'image.captureCamera' })).toBeNull()
  })

  it('disables capture when intake is blocked', () => {
    const view = render(<CaptureTools {...props(vi.fn(), false)} />)
    const button = view.getByRole('button', { name: 'image.captureScreen' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(capture).not.toHaveBeenCalled()
  })

  it('aborts capture on unmount and never forwards a late frame', async () => {
    let finish!: (file: File) => void
    capture.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const add = vi.fn()
    const view = render(<CaptureTools {...props(add)} />)
    fireEvent.click(view.getByRole('button', { name: 'image.captureScreen' }))
    const signal = capture.mock.calls[0]![0]
    view.unmount()
    expect(signal.aborted).toBe(true)
    finish(new File(['late'], 'late.jpg'))
    await Promise.resolve()
    expect(add).not.toHaveBeenCalled()
  })
})
