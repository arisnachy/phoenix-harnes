import { memo, useCallback, useEffect, useMemo } from 'react'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'
import { splitGenerativeUiText } from './GenerativeUi.tsx'
import { assistantText } from './turn-assistant.ts'
import { streamVoiceAssistantResponse } from '../voice.ts'

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, useTurnData, cwd, openFile, renderMessageImages, fileMentions, workspaceFileMentions, inputActions, t,
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
  ).map(segment => segment.kind === 'ui' ? segment.block.props.title
    : segment.text).join('\n').trim(), [responseText, data.status])
  useEffect(() => {
    if (spokenText === '') return
    streamVoiceAssistantResponse(
      `assistant:${data.turn}:${data.step}`,
      spokenText,
      data.time,
      data.status !== 'running',
    )
  }, [data.status, data.step, data.time, data.turn, spokenText])
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
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
