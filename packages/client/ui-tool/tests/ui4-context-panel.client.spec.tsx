// @vitest-environment jsdom
/** UI-4: tool rows can open the existing right-side contextual workspace. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { HostDescription } from '@phoenix-ai/dsh-client-connection/client'
import type { ConversationSnapshot, ToolResultNode } from '@phoenix-ai/dsh-client-runtime/client'
import { makeTranslate } from '@phoenix-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@phoenix-ai/dsh-client-locale/src/locales/zh.ts'
import type { ToolTreeProps } from '../src/client/contract/slots.ts'
import { ToolCallTree } from '../src/client/tool/ToolCallTree.tsx'
import { zh } from '@phoenix-ai/dsh-client-ui-conversation/src/client/locales.ts'

afterEach(cleanup)

const t: ToolTreeProps['t'] = makeTranslate(zh, commonZh)

const root = (callId: string, call: ToolResultNode['call']): ToolResultNode => ({
  kind: 'tool-result', seq: 3, time: 3_000, callId, call, callTime: 2_000,
  content: [], isError: false, callView: null, resultView: null, subCalls: [],
})

function props(block: ToolResultNode, openDetails: ReturnType<typeof vi.fn>): ToolTreeProps {
  const snapshot = {} as ConversationSnapshot
  const useSession = ((selector: (value: ConversationSnapshot) => unknown) => selector(snapshot)) as ToolTreeProps['useSession']
  const renderSlot = ((_key: string, _owner: object, options?: { fallback?: React.ReactNode }) =>
    options?.fallback ?? null) as unknown as ToolTreeProps['renderSlot']
  const description: HostDescription | undefined = undefined
  return {
    useSession,
    renderSlot,
    node: {
      key: `tool:${block.callId}`,
      kind: 'tool-call',
      id: block.callId,
      target: 'chat',
      anchorSeq: block.seq,
      location: { kind: 'session' },
      visibility: 'visible',
      data: { root: block },
    },
    selectedCallId: undefined,
    openFile: vi.fn(),
    inspectCall: vi.fn(),
    openDetails,
    forkAt: vi.fn(),
    fileMentions: vi.fn(),
    useHostDescription: (selector => selector(description)) as ToolTreeProps['useHostDescription'],
    t,
  } as unknown as ToolTreeProps
}

describe('PHOENIX UI-4 contextual panel', () => {
  it('opens a tool call in the side panel without changing the row expansion gesture', () => {
    const openDetails = vi.fn()
    const block = root('w1', { name: 'read', argsRaw: '{"path":"a.ts"}' })
    const view = render(<ToolCallTree {...props(block, openDetails)} />)

    fireEvent.click(view.getByRole('button', { name: 'Open in side panel' }))

    expect(openDetails).toHaveBeenCalledTimes(1)
    expect(openDetails).toHaveBeenCalledWith({ turnSeq: 3, callId: 'w1', toolName: 'read' })
  })
})
