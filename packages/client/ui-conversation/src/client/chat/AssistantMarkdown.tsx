// AssistantMarkdown: renders user-facing assistant blocks in order — markdown
// text, images, and unknown-block fallbacks. Reasoning and tool-call heads are
// intentionally NOT rendered here: ChatView's technical-activity grouping owns
// their compact Tools disclosure, so model-internal activity does not spill
// into the main transcript. Shared by finalized nodes and streaming partials;
// the turn-level loading signal lives in ChatView's tail.

import { Fragment, memo, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { AssistantBlock } from '@phoenix-ai/dsh-client-runtime/client'
import { JsonBlock, MarkdownText } from '@phoenix-ai/dsh-client-ui-primitives'
import type { MarkdownFileMentions } from '@phoenix-ai/dsh-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import css from './AssistantMarkdown.module.css'
import { GenerativeUi, splitGenerativeUiText } from './GenerativeUi.tsx'
import type { CanvasAction } from './GenerativeCanvas.tsx'

export interface AssistantMarkdownProps {
  blocks: readonly AssistantBlock[]
  streaming: boolean
  /** Frozen partial of an aborted turn: rendered with a stopped marker. */
  interrupted?: boolean | undefined
  /** Render consecutive image blocks through the attachment slot. */
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  /** Resolved prose file mentions for this Assistant's closing turn. */
  mentions?: MarkdownFileMentions | undefined
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
  /** User-clicked generative controls route through the session composer. */
  onUiAction?: CanvasAction | undefined
  conversationId?: string | undefined
}

/** User-facing assistant prose/media; technical reasoning is owned by ToolActivityFlow. */
export const AssistantMarkdown = memo(function AssistantMarkdown({
  blocks, streaming, interrupted, renderMessageImages, mentions, t, onUiAction, conversationId,
}: AssistantMarkdownProps) {
  // Stable per locale revision (t identity changes on switch): a fresh object
  // per render would rebuild MarkdownText's component table every chunk.
  const codeLabels = useMemo(() => ({ copyLabel: t('copy'), copiedLabel: t('copied') }), [t])
  const hasVisible = interrupted === true || blocks.some((block) => {
    if (block.kind === 'tool-call' || block.kind === 'reasoning') return false
    if (block.kind === 'text') return block.text.trim() !== ''
    return true
  })
  if (!hasVisible) return null
  const rendered: ReactNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block === undefined) continue
    switch (block.kind) {
      case 'text': {
        // Render declarative UI inline, preserving the surrounding prose and
        // transcript order. Incomplete streaming fences remain hidden.
        const segments = splitGenerativeUiText(block.text, { streaming })
        rendered.push(...segments.map((segment, index) => segment.kind === 'ui'
          ? <GenerativeUi key={`${i}:ui:${index}`} block={segment.block} onAction={onUiAction} {...(conversationId === undefined ? {} : { conversationId })} />
          : <MarkdownText
              key={`${i}:markdown:${index}`}
              text={segment.text}
              streaming={streaming}
              codeLabels={codeLabels}
              fileMentions={mentions}
            />))
        break
      }
      // Reasoning is represented once inside the compact Tools disclosure.
      case 'reasoning':
        break
      case 'image': {
        // Consecutive image blocks share one gallery so several images tile
        // into rows instead of each opening a one-image group of its own.
        // Keyed by the group's FIRST block index: a streaming append that
        // extends the group then only grows `images` instead of remounting
        // the gallery under a shifted key.
        const start = i
        const group = [block]
        while (i + 1 < blocks.length) {
          const next = blocks[i + 1]
          if (next === undefined || next.kind !== 'image') break
          group.push(next)
          i += 1
        }
        rendered.push(
          <Fragment key={start}>
            {renderMessageImages({
              images: group.map(({ attachment }) => ({ attachment })),
              align: 'start',
            })}
          </Fragment>,
        )
        break
      }
      // Grouped into tool rows by ChatView; hasVisible above skips an empty shell.
      case 'tool-call':
        break
      default:
        rendered.push(
          <JsonBlock
            key={i}
            label={t('message.unknownBlock')}
            payload={block.block}
            truncatedLabel={total => t('json.truncated', { total })}
          />,
        )
    }
  }
  // A prose success claim does NOT prove native map delivery. Warn visibly when
  // the response contains no renderable map contract (no auto-fabricated map).
  const claimsPublishedMap = !streaming && blocks.some(block => block.kind === 'text'
    && /(?:cre[eé]|publiqu[eé]|publicad[oa]|qued[oó] publicad[oa]|mapa interactivo).{0,140}(?:mapa|atlas|artefacto|interactiv[oa]|publicad[oa])|(?:mapa|atlas).{0,90}(?:qued[oó] publicad[oa]|fue publicad[oa]|est[aá] publicad[oa])/i.test(block.text))
  const containsNativeMap = blocks.some(block => block.kind === 'text'
    && splitGenerativeUiText(block.text, { streaming: false }).some(segment => segment.kind === 'ui'
      && (segment.block.component === 'scene_map' || segment.block.component === 'geo_map')))
  const missingMap = claimsPublishedMap && !containsNativeMap
  // A tool receipt or prose claim is not proof that a diagram was actually mounted.
  const claimsPublishedDiagram = !streaming && blocks.some(block => block.kind === 'text'
    && /(?:publiqu[eé]|publicad[oa]|cre[eé]|gener[eé]|ya est[aá]|qued[oó]).{0,120}(?:genograma|diagrama)|(?:genograma|diagrama).{0,100}(?:publicad[oa]|listo|ya est[aá]|interactiv[oa])/i.test(block.text))
  const containsNativeDiagram = blocks.some(block => block.kind === 'text'
    && splitGenerativeUiText(block.text, { streaming: false }).some(segment =>
      segment.kind === 'ui' && segment.block.component === 'diagram'))
  const missingDiagram = claimsPublishedDiagram && !containsNativeDiagram
  return (
    <div className={css.root} data-assistant-body="" data-streaming={streaming || undefined}>
      <div className={css.body}>
        {rendered}
        {missingMap && <p role="alert" data-phoenix-missing-map="" style={{
          border: '1px solid #e7bb76', borderRadius: 10, background: '#fff7e8',
          color: '#694319', padding: '11px 13px', fontSize: 12,
        }}>El texto afirma que se publicó un mapa, pero esta respuesta no contiene un componente cartográfico nativo visible. No se ha comprobado su publicación.
          {onUiAction && <button type="button" onClick={() => onUiAction(
            'Kira, genera AHORA el mapa solicitado dentro de este mismo chat con un bloque ```generative-ui que contenga un scene_map versión 1 válido, con lugares y descripciones. No afirmes publicación sin incluir el componente real.',
            'draft',
          )} style={{ display: 'block', marginTop: 8, cursor: 'pointer' }}>Solicitar mapa nativo</button>}
        </p>}
        {missingDiagram && <p role="alert" data-phoenix-missing-diagram="" style={{
          border: '1px solid #e7bb76', borderRadius: 10, background: '#fff7e8',
          color: '#694319', padding: '11px 13px', fontSize: 12,
        }}>Este mensaje afirma que creó un diagrama o genograma, pero no incluye una visualización nativa verificable.
          {onUiAction && <button type="button" onClick={() => onUiAction(
            'Kira, representa AHORA el genograma o diagrama solicitado directamente en este chat como un bloque \`\`\`generative-ui con component "diagram", version 1 y props {id,title,kind,nodes,edges}. Cada nodo debe incluir id,label,x,y y shape (square,circle,rectangle,diamond,point); las conexiones usan from,to y opcionalmente fromPort,toPort,via. No anuncies una publicación si no incluyes el componente válido.',
            'draft',
          )} style={{ display: 'block', marginTop: 8, cursor: 'pointer' }}>Solicitar diagrama visible</button>}
        </p>}
        {interrupted && <span className={css.stopped}>{t('message.stopped')}</span>}
      </div>
    </div>
  )
})
