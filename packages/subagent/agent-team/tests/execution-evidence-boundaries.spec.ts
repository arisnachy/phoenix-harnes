import { describe, expect, it } from 'vitest'
import { CallId, createToolResultMessage, createUserMessage } from '@phoenix-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@phoenix-ai/dsh-session'
import { TeamId, TeamMessageId } from '../src/types.ts'
import { directedTeamUserText, isConversationalTeamUserRequest, teamExecutionProof, teamExecutionRequirement } from '../src/execution-evidence.ts'

function user(seq: number, text: string): SessionEvent {
  return { seq, time: seq, type: 'user/message', surfaceOp: 'append', data: createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text }],
  }) }
}

function receipt(seq: number, name: string, argumentsText = '{}'): SessionEvent[] {
  const callId = CallId(`receipt-${seq}`)
  return [
    { seq, time: seq, type: 'tool/call', data: { turn: 1, step: 1, callId, name, arguments: argumentsText } },
    { seq: seq + 1, time: seq + 1, type: 'tool/result', surfaceOp: 'append', data: {
      turn: 1, step: 1, message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'ok' }], isError: false }),
    } },
  ]
}

function directed(text: string): string {
  return `[Team user message question_1]\nUser request: ${JSON.stringify(text)}\nReply context:\nSend a Gmail email.`
}

describe('Team execution evidence boundaries', () => {
  it.each([
    ['How do I send an email?', true],
    ['Explain how to send the email and send it now', false],
    ['How do I send an email and can you send it now?', false],
    ['Explain how to create a file, and create it now', false],
    ['How do I create a file and write code?', true],
    ['@Zenith ¿Cómo puedo enviar un correo?', true],
    ['Explain how to create a file', true],
    ['What does the test do?', true],
    ['Can you send an email?', false],
    ['Explain how to send the email, then send it now', false],
    ['Explain how to send the email, can you send the email now?', false],
    ['Explain how to create the file, why does that work?', true],
    ['Explain how to create a file, how do I send an email?', true],
    ['¿Puedes crear el archivo ahora?', false],
  ])('separates explanation from authorization: %s', (text, conversational) => {
    expect(isConversationalTeamUserRequest(text)).toBe(conversational)
  })

  it.each(['How do I send an email?', 'What does the test do?', 'Explain how to create a file'])(
    'keeps the original assignment and receipt scope through a directed question: %s', (text) => {
      const events = [user(0, 'Send the Gmail email.'), user(1, directed(text)), ...receipt(2, 'mcp__Gmail__send_email')]
      expect(teamExecutionProof(events)).toEqual({ requirement: 'effect', assignmentSeq: 0, tools: ['send_email'], satisfied: true })
      expect(teamExecutionProof(events, { upToSeq: 1 })).toEqual({ requirement: 'effect', assignmentSeq: 0, tools: [], satisfied: false })
    },
  )

  it('starts a new evidence scope for a directed operational correction', () => {
    const events = [user(0, 'Send the Gmail email.'), ...receipt(1, 'mcp__Gmail__send_email'),
      user(3, directed('Can you update the database now?'))]
    expect(teamExecutionProof(events)).toEqual({ requirement: 'effect', assignmentSeq: 3, tools: [], satisfied: false })
    expect(teamExecutionProof([...events, ...receipt(4, 'mcp__Database__update_record')]))
      .toEqual({ requirement: 'effect', assignmentSeq: 3, tools: ['update_record'], satisfied: true })
  })

  it.each([
    ['Schedule the calendar event.', 'mcp__Calendar__create_event', 'mcp__Database__update_record', 'create_event'],
    ['Update the database record.', 'mcp__Database__update_record', 'mcp__Calendar__create_event', 'update_record'],
    ['Create a document in Drive.', 'mcp__Drive__create_document', 'mcp__Calendar__create_event', 'create_document'],
    ['Fill the form on the website.', 'mcp__Browser__fill', 'mcp__Drive__create_document', 'fill'],
  ])('requires a domain-matching effect receipt: %s', (assignment, matching, unrelated, operation) => {
    const events = [user(0, assignment), ...receipt(1, unrelated)]
    expect(teamExecutionProof(events)).toMatchObject({ satisfied: false, tools: [] })
    expect(teamExecutionProof([...events, ...receipt(3, matching)]))
      .toMatchObject({ satisfied: true, tools: [operation] })
  })

  it('uses command arguments as evidence of the requested domain without counting read-only receipts as effects', () => {
    const events = [user(0, 'Update the database record.'), ...receipt(1, 'read', '{"path":"database.sql"}')]
    expect(teamExecutionProof(events)).toMatchObject({ satisfied: false, tools: [] })
    expect(teamExecutionProof([...events, ...receipt(3, 'bash', '{"command":"sqlite3 database.db UPDATE"}')]))
      .toMatchObject({ satisfied: true, tools: ['bash'] })
  })

  it('does not admit an orphaned tool result as execution evidence', () => {
    const [, orphan] = receipt(1, 'mcp__Calendar__create_event')
    if (orphan === undefined) throw new Error('missing receipt fixture')
    expect(teamExecutionProof([user(0, 'Create the calendar event.'), orphan]))
      .toEqual({ requirement: 'effect', assignmentSeq: 0, tools: [], satisfied: false })
  })

  it('requires receipts inside an explicitly supplied evidence interval even without a logged assignment', () => {
    const events = receipt(0, 'mcp__Calendar__create_event')
    expect(teamExecutionProof(events, { requirement: 'effect', assignmentText: 'Create the calendar event.' }))
      .toEqual({ requirement: 'effect', tools: ['create_event'], satisfied: true })
    expect(teamExecutionProof(events, { requirement: 'effect', assignmentText: 'Create the calendar event.', afterSeq: 0 }))
      .toEqual({ requirement: 'effect', tools: [], satisfied: false })
  })

  it('does not treat a namespace-only tool id as an effectful operation', () => {
    expect(teamExecutionProof([user(0, 'Create a file.'), ...receipt(1, 'mcp__file__')]))
      .toEqual({ requirement: 'effect', assignmentSeq: 0, tools: [], satisfied: false })
  })

  it.each([
    '[Team user message question_1]\nNo encoded request',
    '[Team user message question_1]\nUser request: {broken}',
    '[Team user message question_1]\nUser request: {"text":"How do I send an email?"}',
    '[Team user message question_1]\nUser request: null',
  ])('does not recognize malformed directed protocol as a conversational exemption: %s', (delivered) => {
    expect(directedTeamUserText(delivered)).toBeUndefined()
  })

  it('ignores non-text content when reconstructing the actual assignment', () => {
    const event = user(0, 'Create the calendar event.')
    if (event.type !== 'user/message') throw new Error('wrong fixture type')
    const withImage: SessionEvent = { ...event, data: createUserMessage({ source: { kind: 'user' }, content: [
      { type: 'image', attachment: { attachmentId: 'illustration' as never, mediaType: 'image/png', bytes: 1, width: 1, height: 1 } },
      ...event.data.content,
    ] }) }
    expect(teamExecutionProof([withImage, ...receipt(1, 'mcp__Calendar__create_event')]))
      .toEqual({ requirement: 'effect', assignmentSeq: 0, tools: ['create_event'], satisfied: true })
  })
})

it('does not invent action intent from a noun or empty request', () => {
  expect(teamExecutionRequirement('')).toBe('none')
  expect(teamExecutionRequirement('The file.')).toBe('none')
  expect(teamExecutionProof([])).toEqual({ requirement: 'none', tools: [], satisfied: true })
})

it('keeps Team status chatter and plugin notices from replacing an unfinished assignment', () => {
  const notice: SessionEvent = { seq: 1, time: 1, type: 'user/message', surfaceOp: 'append', data: createUserMessage({
    source: { kind: 'plugin', plugin: 'fixture', form: 'notice', summary: 'status' },
    content: [{ type: 'text', text: 'The calendar event is ready.' }],
  }) }
  const status: SessionEvent = { seq: 2, time: 2, type: 'user/message', surfaceOp: 'append', data: createUserMessage({
    source: { kind: 'team-message', teamId: TeamId('root'), messageId: TeamMessageId('status'), senderId: SessionId('peer'),
      senderName: 'Peer', purpose: 'update' }, content: [{ type: 'text', text: 'All good.' }],
  }) }
  const assignment: SessionEvent = { seq: 3, time: 3, type: 'user/message', surfaceOp: 'append', data: createUserMessage({
    source: { kind: 'team-message', teamId: TeamId('root'), messageId: TeamMessageId('assign'), senderId: SessionId('root'),
      senderName: 'Kira', purpose: 'assignment' }, content: [{ type: 'text', text: 'Update the database record.' }],
  }) }
  const events = [user(0, 'Send the Gmail email.'), notice, status, assignment]
  expect(teamExecutionProof(events, { upToSeq: 2 })).toEqual({ requirement: 'effect', assignmentSeq: 0, tools: [], satisfied: false })
  expect(teamExecutionProof(events)).toEqual({ requirement: 'effect', assignmentSeq: 3, tools: [], satisfied: false })
})

it('does not invent an assignment from an incomplete event prefix', () => {
  const prefix = new Array<SessionEvent>(2)
  const [call] = receipt(1, 'read')
  if (call === undefined) throw new Error('missing call fixture')
  prefix[1] = call
  expect(teamExecutionProof(prefix)).toEqual({ requirement: 'none', tools: [], satisfied: true })
})

it('requires repository-changing receipts to match the Git domain', () => {
  const events = [user(0, 'Update the repository branch.'), ...receipt(1, 'mcp__Database__update_record')]
  expect(teamExecutionProof(events)).toMatchObject({ satisfied: false, tools: [] })
  expect(teamExecutionProof([...events, ...receipt(3, 'bash', '{"command":"git update-ref refs/heads/main abc"}')]))
    .toMatchObject({ satisfied: true, tools: ['bash'] })
})
