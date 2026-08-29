/**
 * Borrowed eyes: transcribe incoming chat images for text-only model routes.
 *
 * When the session's active route declares text-only input, a prompt with
 * attachments is otherwise refused outright (`MODEL_DOES_NOT_SUPPORT_IMAGES`).
 * With a fallback vision route configured — explicitly through deployment
 * config, or discovered among the registered catalogs — each durable image is
 * described by one side call to that route and the description rides the user
 * message as text instead of the image block.
 *
 * The transcription is fail-closed per prompt: if any image cannot be
 * described, the whole prompt is refused rather than silently dropping an
 * attachment the user explicitly sent.
 * @module @phoenix-ai/dsh-host-apiproxy/src/vision-fallback
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@phoenix-ai/dsh-attachment'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import type { ContentBlock } from '@phoenix-ai/dsh-llm'
import type { ModelSelection } from './api/index.ts'

/** Deployment configuration for borrowed-eyes transcription. */
export interface VisionFallbackConfig {
  /** Engage transcription instead of refusing prompts with images on text-only routes. */
  enabled?: boolean
  /**
   * Explicit vision route override; both halves must be set to pin one.
   * Absent, the first registered catalog entry whose `inputModalities`
   * include `image` wins (the current provider is preferred).
   */
  provider?: string
  model?: string
}

/** One concrete route able to accept image input. */
export interface VisionRoute {
  provider: string
  model: string
}

/** One transcription attempt failed; the prompt is refused with this reason. */
export class VisionFallbackError extends Error {}

/** Strict instructions for the side call that describes one attached image. */
const DESCRIPTION_SYSTEM_PROMPT = [
  'You are the vision fallback for a text-only assistant: the user attached an image the main model cannot see.',
  'Transcribe the image faithfully and completely so the main model can act as if it saw it:',
  '- First line: what kind of image it is (photo, screenshot, diagram, chart, document, meme, ...).',
  '- Transcribe every visible text verbatim, in its original language, preserving line and layout structure.',
  '- Describe layout, objects, people (count and appearance only; never try to identify anyone), colors, and notable details.',
  '- Render tables as markdown tables; describe charts by axes, series, and readable values.',
  '- Never speculate beyond what is visible; mark uncertainty explicitly.',
  'Output only the transcription.',
].join('\n')

/**
 * Resolve the route that will lend its eyes, honoring explicit configuration
 * first and then catalog discovery. A text-only current route never
 * transcribes itself: an explicit override equal to it falls back to
 * discovery so a misconfiguration degrades to refusal instead of a doomed
 * side call.
 * @param ctx - host context carrying the `llm` service.
 * @param current - the session's active (text-only) selection.
 * @param config - the deployment's fallback configuration.
 * @returns the resolved route, or undefined when fallback is disabled or no
 *   image-capable catalog entry is reachable.
 */
export async function resolveVisionFallbackRoute(
  ctx: Context,
  current: ModelSelection,
  config: VisionFallbackConfig,
): Promise<VisionRoute | undefined> {
  if (config.enabled !== true) return undefined
  const sameAsCurrent = (provider: string, model: string): boolean =>
    provider === current.provider && model === current.model
  const explicit = config.provider !== undefined && config.model !== undefined
    && !sameAsCurrent(config.provider, config.model)
    ? { provider: config.provider, model: config.model }
    : undefined
  const providers = ctx.llm.listProviders().map(info => info.id)
  // An explicit pin is honored verbatim: deployments name routes catalogs may
  // not advertise (adapters accept unlisted ids), and re-validating here would
  // silently downgrade every pin to discovery.
  if (explicit !== undefined) return explicit
  // Discovery order: the current provider first (same-vendor eyes), then the rest.
  const ordered = [
    ...providers.filter(provider => provider === current.provider),
    ...providers.filter(provider => provider !== current.provider),
  ]
  for (const candidate of ordered) {
    let models: readonly { id: string; inputModalities?: readonly string[] }[]
    try {
      models = await ctx.llm.listModels(candidate)
    } catch {
      continue // Catalog failures are advisory; keep searching.
    }
    const match = models.find(model =>
      model.inputModalities?.includes('image') === true
      && !sameAsCurrent(candidate, model.id))
    if (match !== undefined) return { provider: candidate, model: match.id }
  }
  return undefined
}

/**
 * Describe one durable image with the fallback route.
 * @param ctx - host context carrying the `llm` service; adapters resolve the
 *   attachment bytes themselves at request time.
 * @param route - the resolved vision-capable side route.
 * @param ref - the durable attachment reference to describe.
 * @param contextText - the user's accompanying prompt text, passed as a
 *   language hint so the transcription follows the conversation's language.
 * @returns the trimmed description text.
 */
async function describeImage(
  ctx: Context,
  route: VisionRoute,
  ref: ImageAttachmentRef,
  contextText: string,
): Promise<string> {
  const hint = contextText.trim()
  const stream = ctx.llm.stream({
    provider: route.provider,
    model: route.model,
    system: DESCRIPTION_SYSTEM_PROMPT,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [
        ...(hint.length > 0
          ? [{ type: 'text' as const, text: `The user's accompanying message (match its natural language): ${hint}` }]
          : []),
        { type: 'text', text: 'Transcribe the attached image now.' },
        { type: 'image', attachment: ref },
      ],
    })],
    maxTokens: 4096,
  })
  let description = ''
  let failure: string | undefined
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') description += chunk.text
    if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
      failure = chunk.reason.failure.message
    }
  }
  const trimmed = description.trim()
  if (failure !== undefined) throw new Error(failure)
  if (trimmed.length === 0) throw new Error('the vision fallback returned an empty transcription')
  return trimmed
}

/**
 * Replace every top-level image block in admitted durable content with a
 * faithful text transcription produced by the fallback route. Text blocks
 * pass through untouched; images are described sequentially. Any failure
 * refuses the whole prompt (fail-closed), because silently dropping an
 * attachment the user sent would be worse than refusing it.
 * @param ctx - host context carrying the `llm` service.
 * @param route - the resolved vision-capable side route.
 * @param blocks - the admitted durable content blocks.
 * @returns content blocks safe for a text-only model request.
 */
export async function describePromptImagesWithFallback(
  ctx: Context,
  route: VisionRoute,
  blocks: readonly ContentBlock[],
): Promise<ContentBlock[]> {
  const contextText = blocks.flatMap(block =>
    block.type === 'text' ? [block.text] : []).join('\n')
  const out: ContentBlock[] = []
  for (const block of blocks) {
    if (block.type !== 'image') {
      out.push(block)
      continue
    }
    const ref = block.attachment
    let description: string
    try {
      description = await describeImage(ctx, route, ref, contextText)
    } catch (error: unknown) {
      throw new VisionFallbackError(
        `vision fallback "${route.provider}/${route.model}" could not transcribe`
        + ` "${ref.name ?? ref.attachmentId}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    out.push({
      type: 'text',
      text: `[Attached image ${JSON.stringify(ref.name ?? ref.mediaType)} (${ref.width}x${ref.height} px),`
        + ` transcribed by fallback vision model ${route.model}:\n${description}\nEnd of image transcription]`,
    })
  }
  return out
}
