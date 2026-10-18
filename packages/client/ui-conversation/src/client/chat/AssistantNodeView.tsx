import { memo, useCallback, useEffect, useMemo } from 'react'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'
import { splitGenerativeUiText } from './GenerativeUi.tsx'
import { assistantText } from './turn-assistant.ts'
import { cancelVoiceAssistantSentenceStream, streamVoiceAssistantResponse } from '../voice.ts'

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, useTurnData, cwd, openFile, renderMessageImages, fileMentions, workspaceFileMentions, inputActions, sessionId, t,
}: ChatNodeViewProps<'assistant-step'>) {
  const data = node.data
  const onUiAction = useCallback((prompt: string, mode: 'draft' | 'submit') => {
    // Never let a model-authored UI bypass the existing composer, admission,
    // queue and permissions. Only a human click can reach this callback.
    inputActions.setDraft(prompt)
    if (mode === 'submit') inputActions.submit()
  }, [inputActions])
  const responseText = useMemo(() => assistantText(data.blocks), [data.blocks])
  // Voice must never read declarative machine payloads aloud.
  const spokenText = useMemo(() => splitGenerativeUiText(
    responseText, { streaming: data.status === 'running' },
  ).map(segment => segment.kind === 'ui'
    ? ('title' in segment.block.props ? segment.block.props.title
      : 'label' in segment.block.props ? segment.block.props.label : 'Interfaz interactiva')
    : segment.text).join('\n').trim(), [responseText, data.status])
  // Contextual/tool-bearing assistant steps wait for the owning harness turn
  // to close. A durable conversational tail may stream through native Codex.
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile, sessionId }
  }, [data.finalNode, openFile, sessionId, tail, turn])
  // Voice follows the same final assistant output shown in this chat.
  // In-progress conversational tails are not authoritative: an early "sigo
  // en ello" becomes stale when tools finish during the same harness turn.
  // Only the final node of a CLOSED owning turn may speak via Codex Live.
  const messageKey = `${String(sessionId)}:assistant:${data.turn}:${data.step}`
  // Retry/rewrite folds may remove the AssistantNode before a replacement is
  // projected. Unmount cleanup is the last client-owned cancellation boundary.
  useEffect(() => () => {
    cancelVoiceAssistantSentenceStream(messageKey, true)
  }, [messageKey])
  useEffect(() => {
    if (data.status === 'interrupted' || (owner !== undefined && spokenText === '')) {
      cancelVoiceAssistantSentenceStream(messageKey)
      return
    }
    // Neither partial prose nor an earlier settled step can represent the
    // outcome of a running tool. Wait until the actual final chat reply exists.
    if (owner === undefined || data.status === 'running' || spokenText === '') return
    streamVoiceAssistantResponse(messageKey, spokenText, data.time, true, true, false, String(sessionId))
  }, [data.status, data.time, messageKey, owner, sessionId, spokenText])
  const mentions = useMemo(
    () => owner === undefined
      ? workspaceFileMentions?.({ cwd, openFile })
      : fileMentions(owner) ?? workspaceFileMentions?.({ cwd, openFile }),
    [cwd, fileMentions, openFile, owner, workspaceFileMentions],
  )
  return (
    <AssistantMarkdown
      blocks={data.blocks}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      renderMessageImages={renderMessageImages}
      mentions={mentions}
      onUiAction={onUiAction}
      t={t}
    />
  )
})
