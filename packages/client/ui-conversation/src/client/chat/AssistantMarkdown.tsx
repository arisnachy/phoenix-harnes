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
import { PlainOutputFormatter, splitPlainOutputText } from './PlainOutputFormatter.tsx'

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
        // Models and streaming transports may split one Markdown fence across
        // adjacent text blocks. The lexer must see their combined contents,
        // or a valid sports_game_card is accidentally displayed as raw JSON.
        const first = i
        let text = block.text
        // A reasoning or tool-call block is invisible in the assistant
        // message, but can interrupt the same model-authored UI fence.
        // Join its surrounding visible text without ever exposing its contents.
        while (i + 1 < blocks.length) {
          const next = blocks[i + 1]
          if (next?.kind === 'reasoning' || next?.kind === 'tool-call') {
            i += 1
            continue
          }
          if (next?.kind !== 'text') break
          text += next.text
          i += 1
        }
        const segments = splitGenerativeUiText(text, { streaming })
        for (let index = 0; index < segments.length; index++) {
          const segment = segments[index]
          if (!segment) continue
          if (segment.kind === 'ui') {
            rendered.push(<GenerativeUi key={first+':ui:'+index} block={segment.block}
              onAction={onUiAction} {...(conversationId === undefined ? {} : { conversationId })} />)
            continue
          }
          // Native schema-validated UI takes priority. Only remaining
          // inert plaintext is reformatted; code and Markdown stay intact.
          const presentation = segment.kind === 'markdown'
            ? splitPlainOutputText(segment.text) : [{kind:'markdown' as const,text:segment.text}]
          for (let j = 0; j < presentation.length; j++) {
            const part = presentation[j]
            if (!part) continue
            rendered.push(part.kind === 'formatted'
              ? <PlainOutputFormatter key={first+':formatted:'+index+':'+j} card={part.card} />
              : <MarkdownText key={first+':markdown:'+index+':'+j}
                  text={part.text} streaming={streaming} codeLabels={codeLabels} fileMentions={mentions} />)
          }
        }
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
  const mentionsFiction = blocks.some(block => block.kind === 'text'
    && /(?:isla bruma|mapa ficticio|mundo imaginario|reino de fantasia|atlas narrativo|escenario ficticio)/i.test(block.text))
  const recoveryPrompt = mentionsFiction
    ? 'Kira, entrega realmente el mapa ficticio con la herramienta phoenix_scene_map; verifica el recibo artifactId. Si falla, informa el error, no digas que fue publicado.'
    : 'Kira, entrega el mapa geográfico solicitado mediante la herramienta phoenix_geo_map, con coordenadas WGS84 y fuente verificadas. No uses scene_map de fantasía para geografía real. Si faltan coordenadas o estadísticas subnacionales comparables, no inventes provincias, rankings, tasas ni lugares: indica el bloqueo. Confirma solo la emisión del artifactId, no una visualización no comprobada.'
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
        }}>Este mensaje afirma que publicó un mapa, pero no incluye aquí un mapa nativo válido. Si hay un artefacto cartográfico independiente en el chat, comprueba ese visor; de lo contrario, la entrega no está verificada.
          {onUiAction && <button type="button" onClick={() => onUiAction(recoveryPrompt, 'draft')}
            style={{ display: 'block', marginTop: 8, cursor: 'pointer' }}>Solicitar visor {mentionsFiction ? 'narrativo' : 'geográfico'}</button>}
        </p>}
        {missingDiagram && <p role="alert" data-phoenix-missing-diagram="" style={{
          border: '1px solid #e7bb76', borderRadius: 10, background: '#fff7e8',
          color: '#694319', padding: '11px 13px', fontSize: 12,
        }}>
          El mensaje menciona un diagrama publicado pero no contiene una vista nativa del diagrama.
          Si existe un artefacto independiente en el chat, comprueba ese visor.
          {onUiAction && <button type="button" onClick={() => {
            onUiAction(
              'Kira, publica el genograma o diagrama real en el chat usando la herramienta phoenix_diagram. Entrega el artifactId sin afirmar que el cliente mostró el SVG si no lo comprobaste.',
              'draft',
            )
          }} style={{ display: 'block', marginTop: 8, cursor: 'pointer' }}>Solicitar diagrama visible</button>}
        </p>}
        {interrupted && <span className={css.stopped}>{t('message.stopped')}</span>}
      </div>
    </div>
  )
})
