import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CODEX_PERMISSION_MODE } from '../src/run.ts'
import {
  CodexAppServerWire,
  type CodexWireEvent,
} from '../src/wire.ts'

type JsonObject = Record<string, unknown>

class Peer {
  private buffer = ''
  private readonly frames: JsonObject[] = []
  private readonly wakeups = new Set<() => void>()

  constructor(
    input: PassThrough,
    private readonly output: PassThrough,
  ) {
    input.on('data', (chunk: Buffer | string) => {
      this.buffer += chunk.toString()
      for (;;) {
        const newline = this.buffer.indexOf('\n')
        if (newline < 0) break
        const line = this.buffer.slice(0, newline)
        this.buffer = this.buffer.slice(newline + 1)
        if (line.trim() !== '') this.frames.push(JSON.parse(line) as JsonObject)
      }
      for (const wake of this.wakeups) wake()
      this.wakeups.clear()
    })
  }

  async next(predicate: (frame: JsonObject) => boolean): Promise<JsonObject> {
    for (;;) {
      const index = this.frames.findIndex(predicate)
      if (index >= 0) return this.frames.splice(index, 1)[0]!
      await new Promise<void>((resolve) => { this.wakeups.add(resolve) })
    }
  }

  nextMethod(method: string): Promise<JsonObject> {
    return this.next(frame => frame.method === method)
  }

  nextResponse(id: unknown): Promise<JsonObject> {
    return this.next(frame => frame.id === id && frame.method === undefined)
  }

  send(...frames: readonly JsonObject[]): void {
    this.output.write(`${frames.map(frame => JSON.stringify(frame)).join('\n')}\n`)
  }

  respond(request: JsonObject, result: unknown): void {
    this.send({ id: request.id, result })
  }
}

function wire(options: ConstructorParameters<typeof CodexAppServerWire>[4] = {}) {
  const input = new PassThrough()
  const output = new PassThrough()
  const peer = new Peer(output, input)
  const instance = new CodexAppServerWire(
    input,
    output,
    DEFAULT_CODEX_PERMISSION_MODE,
    undefined,
    options,
  )
  instance.start()
  return { input, output, peer, instance }
}

async function initialize(instance: CodexAppServerWire, peer: Peer): Promise<void> {
  const initializing = instance.initialize(new AbortController().signal)
  const request = await peer.nextMethod('initialize')
  peer.respond(request, { userAgent: 'codex-cli 0.163.0' })
  await peer.nextMethod('initialized')
  await initializing
}

describe('durable Codex app-server wire', () => {
  it('settles a durable turn waiter when the wire closes with its signal still live', async () => {
    const { peer, instance } = wire()
    const signal = new AbortController().signal
    await initialize(instance, peer)
    const starting = instance.startDurableThread('/workspace', signal)
    peer.respond(await peer.nextMethod('thread/start'), { thread: { id: 'native-thread-close', ephemeral: false } })
    await starting
    const turning = instance.startDurableTurn(['test close'], signal)
    peer.respond(await peer.nextMethod('turn/start'), { turn: { id: 'native-turn-close' } })
    const turn = await turning
    const observed = turn.completion.then(() => 'completed', () => 'closed')
    instance.close()
    expect(await Promise.race([observed, new Promise(resolve => setTimeout(() =>{  resolve('hung') }, 100))])).toBe('closed')
    expect(signal.aborted).toBe(false)
  })

  it('acknowledges a persistent thread and checkpoints before dispatching its first turn', async () => {
    const checkpoints: string[] = []
    const events: CodexWireEvent[] = []
    const { peer, instance } = wire({
      onEvent: (event) => { events.push(event) },
      onCheckpoint: async (checkpoint) => { checkpoints.push(checkpoint.phase) },
    })
    await initialize(instance, peer)

    const starting = instance.startDurableThread('/workspace', new AbortController().signal)
    const threadStart = await peer.nextMethod('thread/start')
    expect(threadStart.params).toMatchObject({ cwd: '/workspace', ephemeral: false, sandbox: 'read-only' })
    peer.respond(threadStart, { thread: { id: 'native-thread-1', ephemeral: false } })
    await expect(starting).resolves.toEqual({ id: 'native-thread-1', ephemeral: false })
    peer.send({ method: 'thread/started', params: { thread: { id: 'native-thread-1' } } })

    const turnStarting = instance.startDurableTurn(['build the task'], new AbortController().signal)
    expect(checkpoints).toEqual(['thread-acknowledged', 'before-turn-start'])
    const turnStart = await peer.nextMethod('turn/start')
    peer.respond(turnStart, { turn: { id: 'native-turn-1' } })
    const turn = await turnStarting
    expect(turn.id).toBe('native-turn-1')
    expect(checkpoints).toEqual(['thread-acknowledged', 'before-turn-start', 'turn-acknowledged'])

    peer.send(
      {
        method: 'item/completed',
        params: {
          threadId: 'native-thread-1',
          turnId: 'native-turn-1',
          item: { id: 'item-1', type: 'agentMessage', text: 'SECRET', phase: 'final_answer' },
        },
      },
      {
        method: 'turn/completed',
        params: {
          threadId: 'native-thread-1',
          turn: { id: 'native-turn-1', status: 'completed' },
        },
      },
    )
    await expect(turn.completion).resolves.toEqual({
      id: 'native-turn-1',
      status: 'completed',
      output: 'SECRET',
    })
    expect(JSON.stringify(events)).not.toContain('SECRET')
    expect(events.some(event => event.kind === 'turn' && event.phase === 'completed')).toBe(true)
    instance.close()
  })

  it('resumes, reads, reconciles, and steers the acknowledged native thread', async () => {
    const checkpoints: string[] = []
    const { peer, instance } = wire({
      onCheckpoint: async (checkpoint) => { checkpoints.push(checkpoint.phase) },
    })
    await initialize(instance, peer)

    const resuming = instance.resumeThread('native-thread-1', new AbortController().signal)
    const resume = await peer.nextMethod('thread/resume')
    expect(resume.params).toEqual({ threadId: 'native-thread-1', approvalPolicy: 'never', sandbox: 'read-only' })
    peer.respond(resume, { thread: { id: 'native-thread-1', ephemeral: false } })
    await expect(resuming).resolves.toEqual({ id: 'native-thread-1', ephemeral: false })

    const reading = instance.readThread('native-thread-1', new AbortController().signal)
    const read = await peer.nextMethod('thread/read')
    peer.respond(read, {
      thread: {
        id: 'native-thread-1',
        turns: [
          { id: 'native-turn-1', status: 'completed' },
          { id: 'native-turn-2', status: 'inProgress' },
        ],
      },
    })
    await expect(reading).resolves.toEqual({
      id: 'native-thread-1',
      status: 'running',
      turns: [
        { id: 'native-turn-1', status: 'completed' },
        { id: 'native-turn-2', status: 'in-progress' },
      ],
    })

    const reconciling = instance.reconcileThread('native-thread-1', new AbortController().signal)
    const reconcile = await peer.nextMethod('thread/read')
    peer.respond(reconcile, { thread: { id: 'native-thread-1', turns: [] } })
    await expect(reconciling).resolves.toMatchObject({ id: 'native-thread-1', status: 'unknown' })

    const turning = instance.startDurableTurn(['initial'], new AbortController().signal)
    const turnStart = await peer.nextMethod('turn/start')
    peer.respond(turnStart, { turn: { id: 'native-turn-3' } })
    const turn = await turning
    const steering = instance.steerTurn(turn.id, ['continue'], new AbortController().signal)
    expect(checkpoints).toEqual([
      'thread-acknowledged',
      'before-turn-start',
      'turn-acknowledged',
      'before-steer',
    ])
    const steer = await peer.nextMethod('turn/steer')
    expect(steer.params).toEqual({
      threadId: 'native-thread-1',
      expectedTurnId: 'native-turn-3',
      input: [{ type: 'text', text: 'continue', text_elements: [] }],
    })
    peer.respond(steer, { turnId: 'native-turn-3' })
    await expect(steering).resolves.toBe('native-turn-3')
    instance.close()
  })

  it('uses an explicit scoped approval callback and declines by default', async () => {
    const approval = vi.fn(async () => 'accept' as const)
    const { peer, instance } = wire({ onApproval: approval })
    await initialize(instance, peer)
    const starting = instance.startDurableThread('/workspace', new AbortController().signal)
    const threadStart = await peer.nextMethod('thread/start')
    peer.respond(threadStart, { thread: { id: 'native-thread-1', ephemeral: false } })
    await starting
    const turning = instance.startDurableTurn(['initial'], new AbortController().signal)
    const turnStart = await peer.nextMethod('turn/start')
    peer.respond(turnStart, { turn: { id: 'native-turn-1' } })
    const turn = await turning

    peer.send({
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'native-thread-1',
        turnId: 'native-turn-1',
        availableDecisions: ['accept', 'decline'],
        command: 'git status --token supersecret',
        cwd: '/workspace/phoenix',
      },
    })
    await expect(peer.nextResponse('approval-1')).resolves.toMatchObject({
      result: { decision: 'accept' },
    })
    expect(approval).toHaveBeenCalledWith(
      {
        kind: 'command',
        threadId: 'native-thread-1',
        turnId: 'native-turn-1',
        availableDecisions: ['accept', 'decline'],
        command: 'git status --token [REDACTED]',
        path: '/workspace/phoenix',
      },
      expect.any(AbortSignal),
    )

    const defaultWire = wire()
    await initialize(defaultWire.instance, defaultWire.peer)
    const defaultStarting = defaultWire.instance.startDurableThread('/workspace', new AbortController().signal)
    const defaultThread = await defaultWire.peer.nextMethod('thread/start')
    defaultWire.peer.respond(defaultThread, { thread: { id: 'native-thread-2', ephemeral: false } })
    await defaultStarting
    const defaultTurning = defaultWire.instance.startDurableTurn(['initial'], new AbortController().signal)
    const defaultTurnStart = await defaultWire.peer.nextMethod('turn/start')
    defaultWire.peer.respond(defaultTurnStart, { turn: { id: 'native-turn-2' } })
    const defaultTurn = await defaultTurning
    defaultWire.peer.send({
      id: 'approval-2',
      method: 'item/fileChange/requestApproval',
      params: {
        threadId: 'native-thread-2',
        turnId: 'native-turn-2',
        availableDecisions: ['accept', 'decline'],
      },
    })
    await expect(defaultWire.peer.nextResponse('approval-2')).resolves.toMatchObject({
      result: { decision: 'decline' },
    })
    void turn
    void defaultTurn
    instance.close()
    defaultWire.instance.close()
  })
})
