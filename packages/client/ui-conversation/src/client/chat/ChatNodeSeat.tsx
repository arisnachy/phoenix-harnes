import { memo, useMemo } from 'react'
import { JsonBlock } from '@phoenix-ai/dsh-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import css from './ChatView.module.css'

interface ChatNodeSeatProps extends ChatNodeOwnerProps {
  readonly nodeKey: string
  readonly useSession: ChatViewSlotProps['useSession']
  readonly renderSlot: ChatViewSlotProps['renderSlot']
  readonly t: ChatViewSlotProps['t']
}

type RoutedChatNodeOwner = {
  [Kind in ChatNode['kind']]: ChatNodeOwnerProps & { readonly node: ChatNode<Kind> }
}[ChatNode['kind']]

/** Subscribe and dispatch one stable Context key without observing sibling Nodes. */
export const ChatNodeSeat = memo(function ChatNodeSeat({
  nodeKey, selectedCallId, cwd, openFile, inspectCall, forkAt,
  renderMessageImages, loadImage, fileMentions, workspaceFileMentions, runArtifact, useSession, renderSlot, t,
}: ChatNodeSeatProps) {
  const node = useSession(snapshot => snapshot.chat.nodes.get(nodeKey))
  const routedNode = node as ChatNode | undefined
  // Ordinary assistant controls are rendered by the completed Turn footer,
  // where copy / feedback / speech / branch already live. Generic transcript
  // actions are only for user and Team rows and are passed INTO those renderers
  // so plugins cannot accidentally create a second detached controls row.
  const messageId = routedNode === undefined ? undefined
    : (routedNode.kind === 'user' || routedNode.kind === 'steering')
      ? routedNode.data.messageId
      : routedNode.kind === 'kira-team-message' ? routedNode.data.messageId : undefined
  const authorKind = routedNode === undefined ? undefined
    : (routedNode.kind === 'user' || routedNode.kind === 'steering') ? 'user'
      : routedNode.kind === 'kira-team-message' ? routedNode.data.senderKind ?? 'agent' : undefined
  const authorId = routedNode?.kind === 'kira-team-message' ? routedNode.data.senderId : authorKind
  const messageActions = messageId === undefined || authorKind === undefined || authorId === undefined
    ? null
    : renderSlot('conversation.chat.message-actions', {
      messageId,
      authorId,
      authorKind,
      ...(routedNode?.kind === 'kira-team-message'
        ? {
          ...(routedNode.data.missionId === undefined ? {} : { originMissionId: routedNode.data.missionId }),
          authorName: routedNode.data.senderName,
          replyPreview: routedNode.data.content.flatMap(block =>
            typeof block === 'object' && block !== null && 'type' in block && block.type === 'text'
              && 'text' in block && typeof block.text === 'string' ? [block.text] : []).join('\n'),
        }
        : {}),
    })
  const owner = useMemo<ChatNodeOwnerProps | null>(() => node === undefined
    ? null
    : {
      selectedCallId,
      cwd,
      openFile,
      inspectCall,
      forkAt,
      ...runArtifact === undefined ? {} : { runArtifact },
      renderMessageImages,
      ...loadImage === undefined ? {} : { loadImage },
      fileMentions,
      workspaceFileMentions,
      ...(messageActions === null || messageActions === undefined ? {} : { messageActions }),
    }, [
    node, selectedCallId, cwd, openFile, inspectCall, forkAt, renderMessageImages, loadImage, fileMentions, runArtifact,
    workspaceFileMentions, messageActions,
  ])
  if (routedNode === undefined || owner === null) return null
  // Runtime dispatch owns the correlation: every Node's discriminant is the
  // keyed-slot entry passed alongside that same Node. TypeScript does not
  // distribute an object containing a union into a union of objects itself.
  const routedOwner = { ...owner, node: routedNode } as RoutedChatNodeOwner
  return (
    <div
      className={css.flowItem}
      data-chat-anchor-key={routedNode.key}
      data-chat-flow-key={routedNode.key}
      data-chat-flow-kind={routedNode.kind}
    >
      {routedNode.kind === 'assistant-step' && renderSlot('conversation.chat.message-author', {})}
      {renderSlot('conversation.chat.node', routedOwner, {
        entryKey: routedNode.kind,
        hookContext: nodeKey,
        fallback: (
          <JsonBlock
            label={t('message.unknownSurface', { type: routedNode.kind })}
            payload={routedNode.data}
            truncatedLabel={total => t('json.truncated', { total })}
          />
        ),
      })}
    </div>
  )
})
