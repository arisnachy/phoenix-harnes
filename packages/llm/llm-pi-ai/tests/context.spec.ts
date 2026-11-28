import { describe, expect, it, vi } from 'vitest'
import { AttachmentId, ImageVariantId } from '@phoenix-ai/dsh-attachment'
import type {
  AttachmentStore,
  FileAttachmentRef,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
  StoredFileAttachment,
} from '@phoenix-ai/dsh-attachment'
import { CallId, createMessage, createUserMessage, OFFLOADED_IMAGE_TEXT } from '@phoenix-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@phoenix-ai/dsh-llm'
import { estimateGenerateOptionsTokens, fitGenerateOptionsToContext, fitPhoenixLocalTextTurn, nextLocalContextCalibration, toPiContext } from '../src/context.ts'
import { toPiAssistant } from '../src/replay.ts'

const ref: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png',
  bytes: 1,
  width: 1,
  height: 1,
}

function requestImage(value: ImageAttachmentRef, data: Uint8Array): RequestImageAttachment {
  return {
    variantId: ImageVariantId(`sha256:${'b'.repeat(64)}`),
    attachment: value,
    data,
    mediaType: value.mediaType,
    bytes: data.byteLength,
    width: value.width,
    height: value.height,
    depth: 'uchar',
    space: 'srgb',
    hasAlpha: value.mediaType === 'image/png',
  }
}

function projectionStore(
  readImageRequest: (
    value: ImageAttachmentRef,
    policy: ImageRequestPolicy,
    signal?: AbortSignal,
  ) => Promise<RequestImageAttachment> = vi.fn((value: ImageAttachmentRef) => (
    Promise.resolve(requestImage(value, Uint8Array.of(1)))
  )),
): AttachmentStore {
  return { readImageRequest } as unknown as AttachmentStore
}

function fileRef(overrides: Partial<FileAttachmentRef> = {}): FileAttachmentRef {
  return {
    attachmentId: AttachmentId(`sha256:${'f'.repeat(64)}`),
    mediaType: 'text/plain',
    bytes: 11,
    name: 'notes.txt',
    ...overrides,
  }
}

function fileStore(
  readFile: (value: FileAttachmentRef, signal?: AbortSignal) => Promise<StoredFileAttachment>,
): AttachmentStore {
  return { readFile } as unknown as AttachmentStore
}

const attachments = projectionStore()

function request(messages: GenerateOptions['messages']): GenerateOptions {
  return {
    provider: 'openai',
    model: 'gpt-4.1',
    system: 'system prompt',
    tools: [{ name: 'lookup', description: 'look up', parameters: { type: 'object' } }],
    messages,
  }
}

function user(content: ContentBlock[]): Message {
  return createUserMessage({ content, source: { kind: 'plugin', plugin: 'test' } })
}

function history(role: 'system' | 'assistant', content: ContentBlock[]): Message {
  return createMessage({ role, content, source: { kind: 'plugin', plugin: 'test' } })
}

describe('Phoenix Local text-only small-model fallback', () => {
  const big = 'a'.repeat(400_000)
  it('prevents the pi-ai fixed 4096-token reserve from shrinking a 768-token local reply to 1', () => {
    const latest = user([{ type: 'text', text: 'hola' }])
    const options: GenerateOptions = {
      ...request([latest]),
      provider: 'phoenix-local',
      model: 'phoenix-local',
      system: 'Kira persona with lots of tools and instructions. '.repeat(850),
      tools: [],
    }
    // The old scaled reserve (2048 at 16K) admitted this nearly-full
    // prompt, but pi-ai subsequently kept another fixed 4096 and clamped
    // max_tokens independently, sometimes down to 1.
    const oldFit = fitGenerateOptionsToContext(options, 16_384, 768)
    expect(oldFit.compacted).toBe(false)
    const fitted = fitPhoenixLocalTextTurn(options, 16_384, 768)
    expect(fitted.compacted).toBe(true)
    expect(fitted.options.messages).toEqual([latest])
    expect(fitted.options.tools).toEqual([])
    expect(fitted.estimatedTokens).toBeLessThan(fitted.inputBudgetTokens)
    expect(fitted.inputBudgetTokens).toBe(11_008)
    expect(options.system?.length).toBeGreaterThan(30_000)
  })

  it('does not discard tools or persona when local input has ample reply room', () => {
    const options: GenerateOptions = {
      ...request([user([{ type: 'text', text: 'hola' }])]),
      provider: 'phoenix-local',
      model: 'phoenix-local',
      system: 'Kira responde en español.',
    }
    const fitted = fitPhoenixLocalTextTurn(options, 16_384, 768)
    expect(fitted.options).toBe(options)
    expect(fitted.compacted).toBe(false)
    expect(fitted.inputBudgetTokens).toBe(11_008)
  })

  it('provides answer room for a short turn in a 4096-token local window', () => {
    const options: GenerateOptions = {
      ...request([user([{ type: 'text', text: 'hola' }])]),
      provider: 'phoenix-local',
      model: 'phoenix-local',
    }
    const fitted = fitPhoenixLocalTextTurn(options, 4096, 768)
    expect(fitted.estimatedTokens).toBeLessThanOrEqual(fitted.inputBudgetTokens)
    expect(fitted.inputBudgetTokens).toBe(1_792)
    expect(fitted.compacted).toBe(false)
  })

  it('keeps a latest text request above the optional-history cap when the local envelope still fits it', () => {
    const latest = user([{ type: 'text', text: 'z'.repeat(6_000) }])
    const options: GenerateOptions = {
      ...request([latest]),
      provider: 'phoenix-local',
      model: 'phoenix-local',
      system: 'Phoenix agent instructions and tool catalog. '.repeat(2_000),
      tools: [],
    }

    const fitted = fitPhoenixLocalTextTurn(options, 16_384, 768)

    expect(fitted.compacted).toBe(true)
    expect(fitted.options.messages).toEqual([latest])
    expect(fitted.estimatedTokens).toBeGreaterThan(1_024)
    expect(fitted.estimatedTokens).toBeLessThanOrEqual(fitted.inputBudgetTokens)
  })

  it('lets Qwen answer hola despite 100k tokens of global instructions', () => {
    const latest = user([{ type: 'text', text: 'hola' }])
    const options: GenerateOptions = {
      ...request([latest]),
      provider: 'phoenix-local',
      model: 'phoenix-local',
      system: big,
    }
    const normal = fitGenerateOptionsToContext(options, 4096, 256)
    expect(normal.estimatedTokens).toBeGreaterThan(100_000)
    const fitted = fitPhoenixLocalTextTurn(options, 16_384, 256)
    expect(fitted.estimatedTokens).toBeLessThan(fitted.inputBudgetTokens)
    expect(fitted.options.messages).toEqual([latest])
    expect(fitted.options.tools).toEqual([])
    expect(fitted.options.system?.length).toBeLessThan(700)
    expect(fitted.compacted).toBe(true)
    expect(options.system).toBe(big)
    expect(options.tools?.length).toBe(1)
  })

  it('leaves headroom by dropping long prior text from a small local turn', () => {
    const older = user([{ type: 'text', text: 'z'.repeat(15_000) }])
    const latest = user([{ type: 'text', text: 'hola' }])
    const options: GenerateOptions = {
      ...request([older, latest]),
      system: 'global'.repeat(50_000),
      provider: 'phoenix-local',
      model: 'phoenix-local',
    }
    const fitted = fitPhoenixLocalTextTurn(options, 16_384, 256)
    expect(fitted.estimatedTokens).toBeLessThanOrEqual(1_024)
    expect(fitted.options.messages).toEqual([latest])
    expect(fitted.options.tools).toEqual([])
  })

  it('retains the original latest user message and only bounded prior chat', () => {
    const previous = user([{ type: 'text', text: 'Qué tal' }])
    const assistant = history('assistant', [{ type: 'text', text: 'Bien' }])
    const last = user([{ type: 'text', text: 'hola' }])
    const options: GenerateOptions = {
      ...request([previous, assistant, last]),
      provider: 'phoenix-local',
      model: 'phoenix-local',
      system: big,
    }
    const fitted = fitPhoenixLocalTextTurn(options, 16_384, 256)
    expect(fitted.options.messages).toEqual([previous, assistant, last])
    expect(fitted.options.messages.at(-1)).toBe(last)
  })

  it('does not discard in-flight tool cycles to hide a context failure', () => {
    const latest = user([{ type: 'text', text: 'ejecuta la herramienta' }])
    const toolActivity = history('assistant', [{ type: 'text', text: 'Call underway' }])
    const options: GenerateOptions = {
      ...request([latest, toolActivity]),
      provider: 'phoenix-local',
      model: 'phoenix-local',
      system: big,
    }
    const fitted = fitPhoenixLocalTextTurn(options, 16_384, 256)
    expect(fitted.estimatedTokens).toBeGreaterThan(fitted.inputBudgetTokens)
    expect(fitted.options.system).toBe(big)
  })

  it('does not answer an older greeting when the latest message contains an image', () => {
    const oldGreeting = user([{ type: 'text', text: 'hola' }])
    const imageRequest = user([{ type: 'image', attachment: ref }])
    const options: GenerateOptions = {
      ...request([oldGreeting, imageRequest]),
      provider: 'phoenix-local',
      model: 'phoenix-local',
      system: big,
    }
    const fitted = fitPhoenixLocalTextTurn(options, 16_384, 256)
    expect(fitted.estimatedTokens).toBeGreaterThan(fitted.inputBudgetTokens)
    expect(fitted.options.messages.at(-1)).toBe(imageRequest)
  })

  it('does not silently truncate an oversized latest human message', () => {
    const latest = user([{ type: 'text', text: 'x'.repeat(80_000) }])
    const options: GenerateOptions = {
      ...request([latest]),
      provider: 'phoenix-local',
      model: 'phoenix-local',
      system: big,
    }
    const fitted = fitPhoenixLocalTextTurn(options, 16_384, 256)
    expect(fitted.estimatedTokens).toBeGreaterThan(fitted.inputBudgetTokens)
    expect(fitted.options.messages.at(-1)).toBe(latest)
  })

  it('leaves a fitting local request untouched with tools available', () => {
    const options: GenerateOptions = {
      ...request([user([{ type: 'text', text: 'sumar 17 y 25' }])]),
      provider: 'phoenix-local',
      model: 'phoenix-local',
    }
    const fitted = fitPhoenixLocalTextTurn(options, 16_384, 256)
    expect(fitted.options).toBe(options)
    expect(fitted.compacted).toBe(false)
  })
})

describe('pi-ai request context conversion', () => {
  it('reserves usable prompt space for a 4096-token local Qwen model', () => {
    const options = request([user([{ type: 'text', text: 'hola' }])])
    const fitted = fitGenerateOptionsToContext(options, 4096, 256)
    expect(fitted.inputBudgetTokens).toBe(3328)
    expect(fitted.estimatedTokens).toBeLessThan(fitted.inputBudgetTokens)
    expect(fitted.options).toBe(options)
    expect(fitted.compacted).toBe(false)
  })

  it('limits response reserve on a compact context rather than leaving only one input token', () => {
    const options = request([user([{ type: 'text', text: 'Saluda en una oración' }])])
    const fitted = fitGenerateOptionsToContext(options, 4096, 4096)
    expect(fitted.inputBudgetTokens).toBe(2560)
    expect(fitted.estimatedTokens).toBeLessThan(fitted.inputBudgetTokens)
  })

  it('compacts auxiliary catalog and tool schema prose before output room collapses', () => {
    const huge = 'x'.repeat(100_000)
    const catalog = createUserMessage({
      content: [{ type: 'text', text: huge }],
      source: {
        kind: 'skill-catalog',
        form: 'catalog',
        entries: Array.from({ length: 300 }, (_, index) => ({
          name: `skill-${index}`,
          description: huge.slice(0, 200),
        })),
      } as never,
    })
    const userMessage = createUserMessage({
      content: [{ type: 'text', text: 'hello from the user' }],
      source: { kind: 'user' },
    })
    const options: GenerateOptions = {
      provider: 'openrouter',
      model: 'openrouter/free',
      system: 'system',
      maxTokens: 4096,
      messages: [catalog, userMessage],
      tools: [{
        name: 'lookup',
        description: huge,
        parameters: {
          type: 'object',
          description: huge,
          properties: {
            query: { type: 'string', description: huge },
          },
          required: ['query'],
        },
      }],
    }

    const before = estimateGenerateOptionsTokens(options)
    const fitted = fitGenerateOptionsToContext(options, 20_000, 4096)

    expect(fitted.compacted).toBe(true)
    expect(fitted.estimatedTokens).toBeLessThan(before)
    expect(fitted.options.messages[1]).toEqual(userMessage)
    expect(fitted.options.messages[0]?.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Available skills (compact index') as string,
    })
    expect(fitted.options.tools?.[0]?.description.length).toBeLessThanOrEqual(160)
    expect(fitted.options.tools?.[0]?.parameters).toEqual({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    })
  })


  it('budgets an oversized tool catalog and keeps tools relevant to the latest user request', () => {
    const userMessage = createUserMessage({
      content: [{ type: 'text', text: 'search the customer records for ana' }],
      source: { kind: 'user' },
    })
    const tools = Array.from({ length: 160 }, (_, index) => ({
      name: index === 159 ? 'search_customer_records' : `utility_${index}`,
      description: index === 159 ? 'Search customer records.' : 'Generic utility.',
      parameters: {
        type: 'object',
        properties: Object.fromEntries(Array.from({ length: 18 }, (_, property) => [
          `field_${property}`,
          { type: 'string', enum: ['a', 'b', 'c'] },
        ])),
      },
    }))
    const options: GenerateOptions = {
      provider: 'openrouter',
      model: 'openrouter/free',
      messages: [userMessage],
      tools,
      maxTokens: 4096,
    }

    const fitted = fitGenerateOptionsToContext(options, 12_000, 4096)

    expect(fitted.compacted).toBe(true)
    expect(fitted.estimatedTokens).toBeLessThanOrEqual(fitted.inputBudgetTokens)
    expect(fitted.options.tools?.length).toBeLessThan(tools.length)
    expect(fitted.options.tools?.some(tool => tool.name === 'search_customer_records')).toBe(true)
    expect(fitted.options.messages).toEqual([userMessage])
  })

  it('preserves the exact user content and refuses oversized requests rather than silently truncating', () => {
    const message = user([{ type: 'text', text: 'd'.repeat(800_000) }])
    const source = request([message])
    const narrow = fitGenerateOptionsToContext(source, 131_072, 4096)
    expect(narrow.estimatedTokens).toBeGreaterThan(narrow.inputBudgetTokens)
    expect(narrow.options.messages.at(-1)).toEqual(message)
    const expanded = fitGenerateOptionsToContext(source, 262_144, 4096)
    expect(expanded.estimatedTokens).toBeLessThan(expanded.inputBudgetTokens)
    expect(expanded.options.messages.at(-1)).toEqual(message)
  })

  it('leaves requests untouched when they already preserve reply room', () => {
    const options = request([user([{ type: 'text', text: 'small request' }])])
    const fitted = fitGenerateOptionsToContext(options, 200_000, 4096)

    expect(fitted.compacted).toBe(false)
    expect(fitted.options).toBe(options)
  })

  it('does not repeatedly stringify an unchanged tool schema on later estimates', () => {
    let serializations = 0
    const tool = {
      name: 'large_lookup',
      description: 'lookup',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
      toJSON: () => {
        serializations += 1
        return {
          name: 'large_lookup',
          description: 'lookup',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        }
      },
    } as unknown as NonNullable<GenerateOptions['tools']>[number]
    const options: GenerateOptions = {
      provider: 'openrouter',
      model: 'free',
      messages: [user([{ type: 'text', text: 'hello' }])],
      tools: [tool],
    }

    const first = estimateGenerateOptionsTokens(options)
    const second = estimateGenerateOptionsTokens(options)

    expect(first).toBe(second)
    expect(serializations).toBe(1)
  })

  it('omits absent and empty request-level optional fields', () => {
    const base = { provider: 'openai', model: 'gpt-4.1', messages: [] }
    expect(toPiContext(base)).toEqual({ messages: [] })
    expect(toPiContext({ ...base, tools: [] })).toEqual({ messages: [] })
  })

  it('converts complete text-only history and rejects nested images without storage', () => {
    const callId = CallId('call-1')
    expect(toPiContext(request([
      history('system', [{ type: 'text', text: 'history system' }]),
      history('assistant', [{ type: 'tool-call', id: callId, name: 'lookup', arguments: '{}' }]),
      user([
        { type: 'text', text: 'after tool' },
        {
          type: 'tool-result',
          toolCallId: callId,
          content: [{ type: 'text', text: '' }],
        },
      ]),
    ]))).toMatchObject({
      systemPrompt: 'system prompt',
      tools: [{ name: 'lookup' }],
      messages: [
        { role: 'user', content: 'history system' },
        { role: 'assistant' },
        { role: 'user', content: 'after tool' },
        {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'lookup',
          content: [{ type: 'text', text: '(no output)' }],
          isError: false,
        },
      ],
    })

    expect(() => toPiContext(request([user([{
      type: 'tool-result',
      toolCallId: callId,
      content: [{ type: 'image', attachment: ref }],
    }])]))).toThrow(/durable attachment service/)
  })

  it('resolves user and tool-result images while preserving explicit fallbacks', async () => {
    const callId = CallId('missing-call')
    const knownCallId = CallId('known-call')
    const context = await toPiContext(request([
      user([{ type: 'text', text: '' }]),
      history('assistant', [
        { type: 'text', text: 'calling' },
        { type: 'tool-call', id: knownCallId, name: 'lookup', arguments: '{}' },
      ]),
      user([
        { type: 'image', attachment: ref },
        { type: 'text', text: 'caption' },
        { type: 'reasoning', text: 'ignored' },
      ]),
      user([{
        type: 'tool-result',
        toolCallId: knownCallId,
        content: [{ type: 'text', text: '' }],
      }]),
      user([{
        type: 'tool-result',
        toolCallId: callId,
        isError: true,
        content: [
          { type: 'tool-result', toolCallId: callId, content: [] },
          { type: 'image', attachment: ref },
        ],
      }]),
    ]), attachments)

    expect(context.messages).toEqual([
      { role: 'user', content: '', timestamp: 0 },
      expect.objectContaining({ role: 'assistant' }),
      {
        role: 'user',
        content: [
          { type: 'text', text: expect.stringContaining(`Image ${ref.attachmentId}`) as string },
          { type: 'image', data: 'AQ==', mimeType: 'image/png' },
          { type: 'text', text: 'caption' },
        ],
        timestamp: 0,
      },
      {
        role: 'toolResult',
        toolCallId: 'known-call',
        toolName: 'lookup',
        content: [{ type: 'text', text: '(no output)' }],
        isError: false,
        timestamp: 0,
      },
      {
        role: 'toolResult',
        toolCallId: 'missing-call',
        toolName: 'unknown',
        content: [
          { type: 'text', text: expect.stringContaining(`Image ${ref.attachmentId}`) as string },
          { type: 'image', data: 'AQ==', mimeType: 'image/png' },
        ],
        isError: true,
        timestamp: 0,
      },
    ])
  })

  it('projects durable file attachments into the pi-ai user message', async () => {
    const ref = fileRef()
    const context = await toPiContext(request([user([
      { type: 'file', attachment: ref },
      { type: 'text', text: 'Summarize the attachment.' },
    ])]), fileStore(async value => ({
      ref: value,
      data: new TextEncoder().encode('hello world'),
    })))

    expect(context.messages).toEqual([{
      role: 'user',
      content: expect.stringContaining('Attached file "notes.txt" (text/plain, 11 bytes):\nhello world\nSummarize the attachment.') as string,
      timestamp: 0,
    }])
  })

  it('keeps binary attachments visible without trying to decode their bytes', async () => {
    const ref = fileRef({ mediaType: 'application/pdf', name: 'report.pdf', bytes: 3 })
    const context = await toPiContext(request([user([
      { type: 'file', attachment: ref },
    ])]), fileStore(async value => ({
      ref: value,
      data: Uint8Array.of(0, 255, 1),
    })))

    expect(context.messages).toEqual([{
      role: 'user',
      content: 'Attached binary file "report.pdf" (application/pdf, 3 bytes).\n',
      timestamp: 0,
    }])
  })

  it('recursively converts nested tool-result text and images', async () => {
    const callId = CallId('nested-call')
    const context = await toPiContext(request([user([{
      type: 'tool-result',
      toolCallId: callId,
      content: [
        {
          type: 'tool-result',
          toolCallId: callId,
          content: [{ type: 'text', text: 'nested text' }],
        },
        {
          type: 'tool-result',
          toolCallId: callId,
          content: [{ type: 'image', attachment: ref }],
        },
      ],
    }])]), attachments)

    expect(context.messages).toEqual([{
      role: 'toolResult',
      toolCallId: 'nested-call',
      toolName: 'unknown',
      content: [
        { type: 'text', text: 'nested text' },
        { type: 'text', text: expect.stringContaining(`Image ${ref.attachmentId}`) as string },
        { type: 'image', data: 'AQ==', mimeType: 'image/png' },
      ],
      isError: false,
      timestamp: 0,
    }])
  })

  it('flattens nested text-only tool results and ignores other block types without storage', () => {
    const callId = CallId('nested-text')
    expect(toPiContext(request([user([{
      type: 'tool-result',
      toolCallId: callId,
      content: [
        { type: 'chart', data: 'ignored' } as unknown as ContentBlock,
        {
          type: 'tool-result',
          toolCallId: callId,
          content: [{ type: 'text', text: 'nested' }],
        },
      ],
    }])]))).toMatchObject({
      messages: [{
        role: 'toolResult',
        content: [{ type: 'text', text: 'nested' }],
      }],
    })
  })

  it('replaces the oldest images with placeholders once the request payload bound is exceeded', async () => {
    const readImageRequest = vi.fn((value: ImageAttachmentRef) => (
      Promise.resolve(requestImage(value, Uint8Array.of(1, 2, 3)))
    ))
    const store = projectionStore(readImageRequest)
    const sized: ImageAttachmentRef = { ...ref, bytes: 3 }
    const callId = CallId('shot-call')
    // Three 3-byte images cost 4 base64 characters each (12 total); a bound of
    // 8 forces exactly the oldest one out, including one nested in a tool result.
    const context = await toPiContext(request([
      user([{
        type: 'tool-result',
        toolCallId: callId,
        content: [{ type: 'image', attachment: sized }],
      }]),
      user([{ type: 'image', attachment: sized }, { type: 'text', text: 'newer' }]),
      user([{ type: 'image', attachment: sized }]),
    ]), store, undefined, 8)

    expect(context.messages).toEqual([
      {
        role: 'toolResult',
        toolCallId: 'shot-call',
        toolName: 'unknown',
        content: [{ type: 'text', text: OFFLOADED_IMAGE_TEXT }],
        isError: false,
        timestamp: 0,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: expect.stringContaining(`Image ${sized.attachmentId}`) as string },
          { type: 'image', data: 'AQID', mimeType: 'image/png' },
          { type: 'text', text: 'newer' },
        ],
        timestamp: 0,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: expect.stringContaining(`Image ${sized.attachmentId}`) as string },
          { type: 'image', data: 'AQID', mimeType: 'image/png' },
        ],
        timestamp: 0,
      },
    ])
    expect(readImageRequest).toHaveBeenCalledTimes(1)
  })

  it('does not prepare an old image removed by the conservative request projection', async () => {
    const old = { ...ref, attachmentId: AttachmentId(`sha256:${'c'.repeat(64)}`), bytes: 3 }
    const recent = { ...ref, attachmentId: AttachmentId(`sha256:${'d'.repeat(64)}`), bytes: 3 }
    const readImageRequest = vi.fn((value: ImageAttachmentRef) => {
      if (value.attachmentId === old.attachmentId) throw new Error('old image must not be read')
      return Promise.resolve(requestImage(value, Uint8Array.of(1, 2, 3)))
    })

    const context = await toPiContext(request([user([
      { type: 'image', attachment: old },
      { type: 'image', attachment: recent },
    ])]), projectionStore(readImageRequest), undefined, 4)

    expect(context.messages[0]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: OFFLOADED_IMAGE_TEXT },
        { type: 'text', text: expect.stringContaining(String(recent.attachmentId)) as string },
        { type: 'image' },
      ],
    })
    expect(readImageRequest).toHaveBeenCalledTimes(1)
    expect(readImageRequest.mock.calls[0]?.[0]).toEqual(recent)
  })

  it('keeps every image at exactly the payload bound and drops all of them when even the newest cannot fit', async () => {
    const sized: ImageAttachmentRef = { ...ref, bytes: 3 }
    const exact = await toPiContext(request([
      user([{ type: 'image', attachment: sized }]),
      user([{ type: 'image', attachment: sized }]),
    ]), attachments, undefined, 8)
    expect(exact.messages).toEqual([
      {
        role: 'user',
        content: [expect.objectContaining({ type: 'text' }), expect.objectContaining({ type: 'image' })],
        timestamp: 0,
      },
      {
        role: 'user',
        content: [expect.objectContaining({ type: 'text' }), expect.objectContaining({ type: 'image' })],
        timestamp: 0,
      },
    ])

    const readImageRequest = vi.fn((value: ImageAttachmentRef) => (
      Promise.resolve(requestImage(value, new Uint8Array(300)))
    ))
    const store = projectionStore(readImageRequest)
    const oversized = await toPiContext(request([
      user([{ type: 'image', attachment: { ...ref, bytes: 300 } }]),
    ]), store, undefined, 8)
    // All-text content collapses to the string form; the placeholder still reaches the model.
    expect(oversized.messages).toEqual([
      { role: 'user', content: OFFLOADED_IMAGE_TEXT, timestamp: 0 },
    ])
    expect(readImageRequest).not.toHaveBeenCalled()
  })

  it('offloads repeated image-block occurrences by position rather than shared object identity', async () => {
    const sized: ImageAttachmentRef = { ...ref, bytes: 3 }
    const shared: ContentBlock = { type: 'image', attachment: sized }
    const readImageRequest = vi.fn((value: ImageAttachmentRef) => (
      Promise.resolve(requestImage(value, Uint8Array.of(1, 2, 3)))
    ))
    const store = projectionStore(readImageRequest)
    const aliased = await toPiContext(request([user([shared, shared])]), store, undefined, 4)
    const replayed = await toPiContext(request([user([
      { type: 'image', attachment: { ...sized } },
      { type: 'image', attachment: { ...sized } },
    ])]), store, undefined, 4)

    const expected = [{
      role: 'user',
      content: [
        { type: 'text', text: OFFLOADED_IMAGE_TEXT },
        { type: 'text', text: expect.stringContaining(`Image ${sized.attachmentId}`) as string },
        { type: 'image', data: 'AQID', mimeType: 'image/png' },
      ],
      timestamp: 0,
    }]
    expect(aliased.messages).toEqual(expected)
    expect(replayed.messages).toEqual(expected)
    expect(readImageRequest).toHaveBeenCalledTimes(2)
  })

  it('keeps empty text-only users while separating result-only messages', () => {
    const callId = CallId('unknown-call')
    expect(toPiContext(request([
      user([]),
      history('assistant', [
        { type: 'text', text: 'answer' },
        { type: 'tool-call', id: CallId('other-call'), name: 'lookup', arguments: '{}' },
      ]),
      user([{
        type: 'tool-result',
        toolCallId: callId,
        content: [{ type: 'text', text: 'result' }],
      }]),
    ]))).toMatchObject({
      messages: [
        { role: 'user', content: '' },
        { role: 'assistant' },
        { role: 'toolResult', toolName: 'unknown' },
      ],
    })
  })

  it('handles in-history system and assistant messages explicitly on the image path', async () => {
    for (const role of ['system', 'assistant'] as const) {
      const readImageRequest = vi.fn()
      const store = projectionStore(readImageRequest)
      await expect(toPiContext(request([
        history(role, [{ type: 'image', attachment: ref }]),
      ]), store, undefined, 1)).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
      expect(readImageRequest).not.toHaveBeenCalled()
    }

    await expect(toPiContext(request([
      history('system', [{ type: 'text', text: 'history system' }]),
      history('assistant', [{ type: 'text', text: 'answer' }]),
      user([{ type: 'text', text: 'plain' }]),
    ]), attachments)).resolves.toMatchObject({
      messages: [
        { role: 'user', content: 'history system' },
        { role: 'assistant' },
        { role: 'user', content: 'plain' },
      ],
    })

    expect(() => toPiAssistant(
      history('assistant', [{ type: 'image', attachment: ref }]),
    )).toThrow(/assistant image output/)
  })

  it('does not silently remove a newly submitted human image when the route is undersized', async () => {
    const current = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'image', attachment: { ...ref, bytes: 300 } }],
    })
    const readImageRequest = vi.fn()
    await expect(toPiContext(request([current]), projectionStore(readImageRequest), undefined, 8))
      .rejects.toMatchObject({
        code: 'UNSUPPORTED_CONTENT',
        message: expect.stringContaining('No image analysis was performed'),
      })
    expect(readImageRequest).not.toHaveBeenCalled()
  })

  it('retains the current human image while older visual history is compacted', async () => {
    const old = { ...ref, attachmentId: AttachmentId(`sha256:${'c'.repeat(64)}`), bytes: 3 }
    const recent = { ...ref, attachmentId: AttachmentId(`sha256:${'d'.repeat(64)}`), bytes: 3 }
    const current = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'image', attachment: recent }],
    })
    const context = await toPiContext(request([
      user([{ type: 'image', attachment: old }]), current,
    ]), projectionStore(async value => requestImage(value, Uint8Array.of(1, 2, 3))), undefined, 4)
    expect(context.messages[0]?.content).toBe(OFFLOADED_IMAGE_TEXT)
    expect(context.messages[1]?.content).toEqual([
      expect.objectContaining({ type: 'text' }), expect.objectContaining({ type: 'image' }),
    ])
  })

  it('also detects current-image loss after exact request encoding', async () => {
    const current = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'image', attachment: ref }],
    })
    const store = projectionStore(async value => requestImage(value, Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9)))
    await expect(toPiContext(request([current]), store, undefined, 8))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
  })

})


describe('Phoenix Local agent discovery context', () => {
  it('keeps the current user task, gateway and complete tool pair while projecting old chat', () => {
    const old = createUserMessage({ content: [{ type: 'text', text: 'old '.repeat(20_000) }], source: { kind: 'user' } })
    const task = createUserMessage({ content: [{ type: 'text', text: 'Edit two spreadsheet cells' }], source: { kind: 'user' } })
    const callId = CallId('discover')
    const call = history('assistant', [{ type: 'tool-call', id: callId, name: 'tool_search', arguments: '{"query":"spreadsheet"}' }])
    const result = user([{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: 'Found spreadsheet_edit' }] }])
    const options: GenerateOptions = {
      ...request([old, task, call, result]), provider: 'phoenix-local', model: 'phoenix-local',
      tools: [{ name: 'tool_search', description: 'Discover tools', parameters: { type: 'object' } }, { name: 'spreadsheet_edit', description: 'Edit cells', parameters: { type: 'object' } }],
    }
    const fitted = fitPhoenixLocalTextTurn(options, 4096, 512)
    expect(fitted.estimatedTokens).toBeLessThanOrEqual(fitted.inputBudgetTokens)
    expect(fitted.options.messages).toEqual([task, call, result])
    expect(fitted.options.tools?.map(tool => tool.name)).toContain('tool_search')
    expect(fitted.options.tools?.map(tool => tool.name)).toContain('spreadsheet_edit')
    expect(options.messages).toHaveLength(4)
  })
})

describe('Phoenix Local reality context deferral', () => {
  it('fits approximately 71k local input into 8k while retaining the current task, tool cycle and policy', () => {
    const huge = 'telemetry '.repeat(24_850)
    const policy = 'Approval and sandbox policy: read-only.'
    const snapshot = createUserMessage({
      content: [{ type: 'text', text: huge + '\n\n' + policy }],
      source: { kind: 'plugin', plugin: '@phoenix-ai/dsh-system-prompt', form: 'snapshot',
        sections: [{ name: 'hardness:reality-context', text: huge }, { name: 'approval:policy', text: policy }] },
    })
    const task = createUserMessage({ content: [{ type: 'text', text: 'Consulta mi red' }], source: { kind: 'user' } })
    const callId = CallId('reality-discover')
    const call = history('assistant', [{ type: 'tool-call', id: callId, name: 'tool_search', arguments: '{"query":"phoenix_reality_now"}' }])
    const result = user([{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: 'Found phoenix_reality_now' }] }])
    const options: GenerateOptions = {
      ...request([snapshot, task, call, result]), provider: 'phoenix-local', model: 'phoenix-local',
      tools: [{ name: 'tool_search', description: 'Discover tools', parameters: { type: 'object' } },
        { name: 'phoenix_reality_now', description: 'Read reality', parameters: { type: 'object' } }],
    }
    expect(estimateGenerateOptionsTokens(options)).toBeGreaterThan(60_000)
    const fitted = fitPhoenixLocalTextTurn(options, 8192, 1024)
    expect(fitted.estimatedTokens).toBeLessThanOrEqual(fitted.inputBudgetTokens)
    expect(fitted.options.tools?.map(tool => tool.name)).toEqual(['tool_search', 'phoenix_reality_now'])
    expect(fitted.options.messages.slice(1)).toEqual([task, call, result])
    expect(fitted.options.messages[0]?.content).toEqual([{ type: 'text', text: expect.stringContaining(policy) }])
    expect(fitted.options.messages[0]?.content).toEqual([{ type: 'text', text: expect.stringContaining('field=time') }])
    expect(snapshot.content).toEqual([{ type: 'text', text: huge + '\n\n' + policy }])
    expect(fitGenerateOptionsToContext({ ...options, provider: 'openai' }, 400_000, 1024).options.messages[0]).toBe(snapshot)
  })

  it('fails closed instead of rewriting an unknown or mandatory policy snapshot', () => {
    const huge = 'mandatory '.repeat(25_000)
    const policy = createUserMessage({
      content: [{ type: 'text', text: huge }],
      source: { kind: 'plugin', plugin: '@phoenix-ai/dsh-system-prompt', form: 'snapshot',
        sections: [{ name: 'approval:policy', text: huge }] },
    })
    const task = createUserMessage({ content: [{ type: 'text', text: 'Work' }], source: { kind: 'user' } })
    const options: GenerateOptions = { ...request([policy, task]), provider: 'phoenix-local',
      tools: [{ name: 'tool_search', description: 'Discover', parameters: { type: 'object' } }] }
    const fitted = fitPhoenixLocalTextTurn(options, 8192, 1024)
    expect(fitted.estimatedTokens).toBeGreaterThan(fitted.inputBudgetTokens)
    expect(fitted.options.messages).toContain(policy)
    expect(fitted.options.messages).toContain(task)
  })
})

describe('Context pressure continuity and intent', () => {
  it('defers recoverable reality data before dropping earlier conversation or tool signatures', () => {
    const previous = createUserMessage({ content: [{ type: 'text', text: 'Keep the original project requirements.' }], source: { kind: 'user' } })
    const answer = history('assistant', [{ type: 'text', text: 'I will preserve the requirements.' }])
    const task = createUserMessage({ content: [{ type: 'text', text: 'Continue the project.' }], source: { kind: 'user' } })
    const huge = 'telemetry '.repeat(25_000)
    const snapshot = createUserMessage({
      content: [{ type: 'text', text: huge }],
      source: { kind: 'plugin', plugin: '@phoenix-ai/dsh-system-prompt', form: 'snapshot',
        sections: [{ name: 'hardness:reality-context', text: huge }] },
    })
    const tools = [{ name: 'tool_search', description: 'Discover tools', parameters: { type: 'object' } },
      { name: 'project_edit', description: 'Edit project', parameters: { type: 'object' } }]
    const options: GenerateOptions = { ...request([previous, answer, task, snapshot]), provider: 'phoenix-local', model: 'phoenix-local', tools }
    const fitted = fitPhoenixLocalTextTurn(options, 8192, 1024)
    expect(fitted.estimatedTokens).toBeLessThanOrEqual(fitted.inputBudgetTokens)
    expect(fitted.options.messages.slice(0, 3)).toEqual([previous, answer, task])
    expect(fitted.options.tools).toEqual(tools)
    expect(options.messages[3]).toBe(snapshot)
  })

  it('ranks tools by the human request instead of a later runtime snapshot across providers', () => {
    const task = createUserMessage({ content: [{ type: 'text', text: 'Use customer_records to find Ana.' }], source: { kind: 'user' } })
    const telemetry = createUserMessage({ content: [{ type: 'text', text: 'device_metrics '.repeat(5) }], source: { kind: 'plugin', plugin: '@phoenix-ai/dsh-system-prompt' } })
    const properties = Object.fromEntries(Array.from({ length: 40 }, (_, i) => ['argument_' + i, { type: 'string', enum: ['one', 'two', 'three'] }]))
    const tools = Array.from({ length: 60 }, (_, i) => ({
      name: i === 59 ? 'customer_records' : 'device_metrics_' + i,
      description: i === 59 ? 'Customer records' : 'Device metrics',
      parameters: { type: 'object', properties },
    }))
    const fitted = fitGenerateOptionsToContext({ ...request([task, telemetry]), tools }, 4096, 512)
    expect(fitted.estimatedTokens).toBeLessThanOrEqual(fitted.inputBudgetTokens)
    expect(fitted.options.tools?.map(tool => tool.name)).toContain('customer_records')
    expect(fitted.options.messages).toEqual([task, telemetry])
  })
})

describe('cross-provider recoverable reality pressure', () => {
  it('pages oversized reality only when the actual read capability is exposed and pressure requires it', () => {
    const huge = 'telemetry '.repeat(25_000)
    const policy = 'Keep approval requirements.'
    const snapshot = createUserMessage({
      content: [{ type: 'text', text: huge + '\n\n' + policy }],
      source: { kind: 'plugin', plugin: '@phoenix-ai/dsh-system-prompt', form: 'snapshot',
        sections: [{ name: 'hardness:reality-context', text: huge }, { name: 'approval:policy', text: policy }] },
    })
    const task = createUserMessage({ content: [{ type: 'text', text: 'Check my device' }], source: { kind: 'user' } })
    const tools = [{ name: 'phoenix_reality_now', description: 'Read current environment', parameters: { type: 'object' } }]
    const options = { ...request([snapshot, task]), tools }
    const narrow = fitGenerateOptionsToContext(options, 8192, 1024)
    expect(narrow.estimatedTokens).toBeLessThanOrEqual(narrow.inputBudgetTokens)
    expect(narrow.options.tools).toEqual(tools)
    expect(narrow.options.messages[0]?.content[0]).toMatchObject({ text: expect.stringContaining(policy) })
    expect(narrow.options.messages[1]).toBe(task)
    expect(fitGenerateOptionsToContext(options, 400_000, 1024).options).toBe(options)
    const unavailable = fitGenerateOptionsToContext({ ...options, tools: [] }, 8192, 1024)
    expect(unavailable.estimatedTokens).toBeGreaterThan(unavailable.inputBudgetTokens)
    expect(unavailable.options.messages[0]).toBe(snapshot)
  })
})

describe('safe pressure schema projection', () => {
  it('never deletes real argument names, defaults, enum values or nested const data', () => {
    const huge = 'documentation '.repeat(20_000)
    const value = { title: 'real title', description: 'real description', default: 3 }
    const properties = {
      title: { type: 'string', description: huge },
      description: { type: 'string', default: 'keep this default' },
      default: { type: 'integer', enum: [1, 2], default: 2 },
      payload: { type: 'object', const: value },
    }
    const parameters = { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
    const task = createUserMessage({ content: [{ type: 'text', text: 'Use exact arguments' }], source: { kind: 'user' } })
    const options = { ...request([task]), tools: [{ name: 'lookup', description: 'Lookup', parameters }] }
    const fitted = fitGenerateOptionsToContext(options, 8192, 1024)
    expect(fitted.estimatedTokens).toBeLessThanOrEqual(fitted.inputBudgetTokens)
    expect(fitted.options.tools?.[0]?.parameters).toEqual({
      type: 'object', additionalProperties: false, required: Object.keys(properties),
      properties: { ...properties, title: { type: 'string' } },
    })
    expect(options.tools[0]?.parameters.properties.title.description).toBe(huge)
  })
})

describe('local agent protected memory projection', () => {
  it('retains prior compaction checkpoints, active instructions and the current task while dropping bulk chat', () => {
    const checkpoint = createUserMessage({ content: [{ type: 'text', text: 'Prior verified decision: keep the original implementation.' }],
      source: { kind: 'plugin', plugin: 'compact' } })
    const rules = createUserMessage({ content: [{ type: 'text', text: 'Workspace instructions: do not modify the production configuration.' }],
      source: { kind: 'plugin', plugin: 'workspace-rules', form: 'instructions' } })
    const old = createUserMessage({ content: [{ type: 'text', text: 'bulk '.repeat(50_000) }], source: { kind: 'user' } })
    const task = createUserMessage({ content: [{ type: 'text', text: 'Continue the previous implementation.' }], source: { kind: 'user' } })
    const tools = [{ name: 'tool_search', description: 'Discover', parameters: { type: 'object' } }]
    const options: GenerateOptions = { ...request([checkpoint, rules, old, task]), provider: 'phoenix-local', model: 'phoenix-local', tools }
    const fitted = fitPhoenixLocalTextTurn(options, 8192, 1024)
    expect(fitted.estimatedTokens).toBeLessThanOrEqual(fitted.inputBudgetTokens)
    expect(fitted.options.messages).toEqual([checkpoint, rules, task])
    expect(fitted.options.tools?.map(tool => tool.name)).toContain('tool_search')
    expect(options.messages).toEqual([checkpoint, rules, old, task])
  })

  it('fails explicitly rather than discarding protected prior instructions that exceed the window', () => {
    const rules = createUserMessage({ content: [{ type: 'text', text: 'Mandatory rule '.repeat(50_000) }],
      source: { kind: 'plugin', plugin: 'workspace-rules', form: 'instructions' } })
    const task = createUserMessage({ content: [{ type: 'text', text: 'Continue.' }], source: { kind: 'user' } })
    const options = { ...request([rules, task]), provider: 'phoenix-local',
      tools: [{ name: 'tool_search', description: 'Discover', parameters: { type: 'object' } }] }
    const fitted = fitPhoenixLocalTextTurn(options, 8192, 1024)
    expect(fitted.estimatedTokens).toBeGreaterThan(fitted.inputBudgetTokens)
    expect(fitted.options.messages).toContain(rules)
    expect(fitted.options.messages).toContain(task)
  })
})

describe('conservative local context self-calibration', () => {
  it('learns underestimation without trusting small, invalid or unusually low usage samples', () => {
    expect(nextLocalContextCalibration(1, 100, 400)).toBe(1)
    expect(nextLocalContextCalibration(1, 1000, Number.NaN)).toBe(1)
    const learned = nextLocalContextCalibration(1, 1000, 1500)
    expect(learned).toBeGreaterThan(1.5)
    expect(nextLocalContextCalibration(learned, 1000, 500)).toBe(learned)
    expect(nextLocalContextCalibration(learned, 1000, 999999)).toBe(3)
  })

  it('uses the calibrated pressure estimate without modifying the user task or model', () => {
    const task = createUserMessage({ content: [{ type: 'text', text: 'Keep the exact request.' }], source: { kind: 'user' } })
    const options = { ...request([task]), provider: 'phoenix-local', model: 'phoenix-local' }
    const baseline = fitPhoenixLocalTextTurn(options, 8192, 1024)
    const calibrated = fitPhoenixLocalTextTurn(options, 8192, 1024, 1.5)
    expect(calibrated.estimatedTokens).toBeGreaterThan(baseline.estimatedTokens)
    expect(calibrated.inputBudgetTokens).toBe(baseline.inputBudgetTokens)
    expect(calibrated.options).toBe(options)
  })
})
