// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AssistantMessageNode, ConversationNode, ConversationSnapshot, RunningToolCall, SessionId, SessionListState,
  ToolResultNode, WorkspaceListState,
} from '@phoenix-ai/dsh-client-runtime/client'
import { AttachmentId } from '@phoenix-ai/dsh-attachment'
import { bindSnapshotSelector } from '@phoenix-ai/dsh-client-test-runtime'
import { createSnapshotStore, EMPTY_CONVERSATION_VIEWS } from '@phoenix-ai/dsh-client-runtime/client'
import type { ChatNodeOwnerProps, ChatViewSlotProps, RenderMessageImages } from '../src/client/contract/slots.ts'
import { createChatStore } from '../src/client/stores.ts'
import { ChatView } from '../src/client/chat/ChatView.tsx'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'

const SID = 'tool-activity' as SessionId

function snapshot(
  nodes: readonly ConversationNode[],
  runningCalls: readonly RunningToolCall[] = [],
): ConversationSnapshot {
  const base: ConversationSnapshot = {
    sessionId: SID,
    views: EMPTY_CONVERSATION_VIEWS,
    chat: chatSnapshotFixture(),
    nodes: [...nodes],
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: [...runningCalls],
    pending: [],
    queue: [],
    running: runningCalls.length > 0,
    composerPhase: 'active',
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: false,
    subagent: null,
    lastAgentError: null,
  }
  return { ...base, chat: chatSnapshotFixture(base) }
}

function context(seq: number, label: string): ConversationNode {
  return {
    kind: 'context',
    seq,
    time: seq * 1_000,
    content: [{ type: 'text', text: label }],
    source: null,
    provenance: { role: 'inject', label },
    form: null,
  } as ConversationNode
}

function user(seq: number, text: string): ConversationNode {
  return {
    kind: 'user',
    seq,
    time: seq * 1_000,
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  } as ConversationNode
}

function assistantWithReasoning(seq: number, visible = true): ConversationNode {
  return {
    kind: 'assistant',
    seq,
    time: seq * 1_000,
    turn: 1,
    step: 1,
    blocks: [
      { kind: 'reasoning', text: 'inspect the runtime first' },
      ...(visible ? [{ kind: 'text' as const, text: 'Visible answer' }] : []),
    ],
  } as AssistantMessageNode
}

function runningTool(callId = 'search-1'): RunningToolCall {
  return {
    callId,
    name: 'web_search',
    argsRaw: '{"query":"cognitiveRuntime"}',
    turn: 1,
    step: 1,
    time: 1_000,
    callView: null,
    subCalls: [],
  }
}

function settledTool(callId = 'search-1'): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 2,
    time: 2_000,
    callId,
    call: { name: 'web_search', argsRaw: '{"query":"cognitiveRuntime"}' },
    callTime: 1_000,
    content: [],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
  }
}

const generatedAttachment = {
  attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`),
  mediaType: 'image/png' as const,
  bytes: 4,
  width: 640,
  height: 360,
  name: 'generated.png',
}

function generatedImageTool(): ToolResultNode {
  return {
    ...settledTool('image-1'),
    call: { name: 'image_generation', argsRaw: '{"prompt":"a photorealistic moon"}' },
    content: [{ type: 'image', attachment: generatedAttachment }],
  }
}
function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  }))
}

function renderChat(
  nodes: readonly ConversationNode[],
  runningCalls: readonly RunningToolCall[] = [],
  renderMessageImages: RenderMessageImages = () => null,
) {
  const source = createSnapshotStore(snapshot(nodes, runningCalls))
  const chat = createChatStore().create()
  const t = ((key: string) => key === 'context.tools' ? 'Tools' : key) as ChatViewSlotProps['t']
  const renderSlot = ((key: string, owner: object, opts?: { fallback?: React.ReactNode }) => {
    if (key === 'conversation.message.images') return renderMessageImages(owner as never)
    if (key !== 'conversation.chat.node') return opts?.fallback ?? null
    const node = (owner as ChatNodeOwnerProps & { node: { kind: string } }).node
    return <div data-testid={`node-${node.kind}`}>{node.kind}</div>
  }) as unknown as ChatViewSlotProps['renderSlot']
  const props = {
    sessionId: SID,
    useSession: bindSnapshotSelector(source),
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useProjection: (() => undefined),
    useInput: (() => { throw new Error('unused') }),
    inputActions: { setDraft: () => {}, addImages: () => true, removeImage: () => {}, pruneImages: () => {}, submit: () => {} },
    useStore: bindSnapshotSelector(chat),
    actions: chat.actions,
    renderSlot,
    SessionProvider: (({ children }: { children: (id: SessionId) => React.ReactNode }) => <>{children(SID)}</>),
    openDetails: () => {},
    openFile: async () => {},
    loadOlder: () => {},
    loadImage: async () => { throw new Error('unused') },
    inspectCall: () => {},
    chatScroll: { save: () => {}, read: () => null },
    forkAt: () => {},
    fileMentions: () => undefined,
    t,
  } as unknown as ChatViewSlotProps
  return render(<ChatView {...props} />)
}

function expectBefore(first: HTMLElement, second: HTMLElement): void {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
}

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

describe('chat tool activity grouping', () => {
  it('collapses consecutive context activity behind one Tools disclosure', () => {
    renderChat([context(1, 'system'), context(2, 'skill-catalog')])

    const disclosure = screen.getByRole('button', { name: 'Tools' })
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('node-context')).toBeNull()

    fireEvent.click(disclosure)
    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByTestId('node-context')).toHaveLength(2)

    fireEvent.click(disclosure)
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('node-context')).toBeNull()
  })

  it('moves assistant reasoning into Tools while leaving visible assistant prose outside', () => {
    renderChat([assistantWithReasoning(1)])

    const disclosure = screen.getByRole('button', { name: 'Tools' })
    const assistant = screen.getByTestId('node-assistant-step')
    expect(assistant).toBeTruthy()
    expectBefore(assistant, disclosure)
    expect(screen.queryByText('reasoning.title')).toBeNull()

    fireEvent.click(disclosure)
    expect(screen.getByText('reasoning.title')).toBeTruthy()
  })

  it('keeps a reasoning-only assistant inside the Tools disclosure', () => {
    renderChat([assistantWithReasoning(1, false)])

    const disclosure = screen.getByRole('button', { name: 'Tools' })
    expect(screen.queryByTestId('node-assistant-step')).toBeNull()
    fireEvent.click(disclosure)
    expect(screen.getByText('reasoning.title')).toBeTruthy()
  })

  it('starts a new Tools disclosure after an ordinary user message', () => {
    renderChat([context(1, 'before'), user(2, 'hello'), context(3, 'after')])

    expect(screen.getAllByRole('button', { name: 'Tools' })).toHaveLength(2)
    expect(screen.getByTestId('node-user')).toBeTruthy()
  })

  it('shows the running status before a live tool and keeps the tool above collapsed history', () => {
    renderChat([context(1, 'system')], [runningTool()])

    const status = screen.getByRole('status')
    expect(status.dataset.phase).toBe('running-tools')
    expect(status.dataset.activity).toBe('browsing')
    expect(status.textContent).toContain('web_search')
    const live = screen.getByTestId('live-tool-activity')
    expectBefore(status, live)
    expect(live.querySelector('[data-testid="node-tool-call"]')).toBeTruthy()
    const disclosure = screen.getByRole('button', { name: 'Tools' })
    expectBefore(live, disclosure)
    expect(disclosure.querySelector('svg[data-tool-activity-chevron]')).toBeTruthy()

    fireEvent.click(disclosure)
    expect(screen.getAllByTestId('node-tool-call')).toHaveLength(1)
    expect(screen.getByTestId('node-context')).toBeTruthy()
  })

  it('moves a finished tool out of the live row and into Tools history', () => {
    renderChat([context(1, 'system'), settledTool()])

    expect(screen.queryByTestId('live-tool-activity')).toBeNull()
    expect(screen.queryByTestId('node-tool-call')).toBeNull()

    const disclosure = screen.getByRole('button', { name: 'Tools' })
    fireEvent.click(disclosure)
    expect(screen.getByTestId('node-tool-call')).toBeTruthy()
  })

  it('renders a generated image result inline without opening Tools', () => {
    const renderMessageImages = vi.fn(() => <div data-testid="generated-image" />)

    renderChat([generatedImageTool()], [], renderMessageImages)

    expect(screen.getByTestId('generated-image')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Tools' })).toBeNull()
    expect(renderMessageImages).toHaveBeenCalledWith(expect.objectContaining({
      images: [{ attachment: generatedAttachment }],
      align: 'start',
    }))
  })
})
