/** Model-facing Google Workspace tools backed by OpenClaw's official gog CLI session. */

import type { Context } from '@phoenix-ai/cordis'
import {
  OPENCLAW_GOOGLE_ACCOUNT_KEY,
  runOpenClawCli,
} from '@phoenix-ai/dsh-authorization/openclaw-cli'
import {
  defineTool,
  ToolArgsError,
  type JsonValue,
} from '@phoenix-ai/dsh-tools'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-google-workspace'
/** The tool registry, Phoenix marker store, and governed subprocess runtime are required. */
export const inject = ['tools', 'credentials', 'subprocess']

const MAX_RESPONSE_CHARS = 200_000
const GMAIL_FORMATS = new Set(['minimal', 'full', 'metadata', 'raw'])

interface WorkspaceToolResult {
  status: number
  ok: boolean
  data: JsonValue
  truncated: boolean
}

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'integer', required: true },
      ok: { type: 'boolean', required: true },
      data: { type: 'json', required: true },
      truncated: { type: 'boolean', required: true },
    },
  } as const,
  render: (_args: unknown, value: WorkspaceToolResult) => [{
    type: 'text' as const,
    text: JSON.stringify(value),
  }],
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

async function connectedAccount(ctx: Context): Promise<string> {
  const stored = await ctx.credentials.readRecord(OPENCLAW_GOOGLE_ACCOUNT_KEY)
  const top = record(stored)
  const payload = record(top?.payload)
  const account = top?.kind === 'grant'
    && payload?.provider === 'openclaw-gog'
    && typeof payload.account === 'string'
    ? payload.account.trim()
    : ''
  if (account.length === 0) {
    throw new Error('Google Workspace is not connected to Phoenix. Authorize it in Settings → Connectors.')
  }
  return account
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved)) throw new ToolArgsError(['numeric value must be finite'])
  return Math.min(max, Math.max(min, Math.trunc(resolved)))
}

function requireNonBlank(label: string, value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new ToolArgsError([`${label} must not be blank`])
  return trimmed
}

function projectJson(text: string): WorkspaceToolResult {
  const truncated = text.length > MAX_RESPONSE_CHARS
  const body = truncated ? text.slice(0, MAX_RESPONSE_CHARS) : text
  let data: JsonValue = body
  if (!truncated && body.trim().length > 0) {
    try {
      data = JSON.parse(body) as JsonValue
    } catch {
      data = body
    }
  } else if (body.trim().length === 0) {
    data = null
  }
  return { status: 200, ok: true, data, truncated }
}

async function gog(
  ctx: Context,
  args: readonly string[],
  signal?: AbortSignal,
  options: { force?: boolean; wrapUntrusted?: boolean } = {},
): Promise<WorkspaceToolResult> {
  const account = await connectedAccount(ctx)
  const result = await runOpenClawCli(ctx, 'gog', [
    ...args,
    '--account', account,
    '--json',
    '--no-input',
    ...(options.force === true ? ['--force'] : []),
    ...(options.wrapUntrusted === false ? [] : ['--wrap-untrusted']),
  ], { signal })
  return projectJson(result.stdout)
}

/** Register practical Gmail, Calendar, and Drive tools through the adopted OpenClaw gog account. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'gmail_search',
    description: 'Search the connected Gmail mailbox using Gmail query syntax through OpenClaw gog.',
    parameters: {
      query: { type: 'string', required: true, description: 'Gmail search query such as is:unread newer_than:7d.' },
      max_results: { type: 'number', description: 'Maximum messages to return, 1-100. Defaults to 20.' },
      page_token: { type: 'string', description: 'Optional Gmail pagination token.' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const command = [
        'gmail', 'messages', 'search', args.query,
        '--max', String(clampInteger(args.max_results, 20, 1, 100)),
        ...(args.page_token === undefined || args.page_token.trim() === '' ? [] : ['--page', args.page_token.trim()]),
      ]
      return gog(ctx, command, exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: 'Search Gmail', kind: 'search', rawInput: args.query }),
  }))

  ctx.tools.register(defineTool({
    name: 'gmail_read',
    description: 'Read one Gmail message by id from the connected OpenClaw gog account.',
    parameters: {
      message_id: { type: 'string', required: true },
      format: { type: 'string', description: 'minimal, full, metadata, or raw. Defaults to full.' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const id = requireNonBlank('message_id', args.message_id)
      const format = (args.format ?? 'full').toLowerCase()
      if (!GMAIL_FORMATS.has(format)) throw new ToolArgsError(['format must be minimal, full, metadata, or raw'])
      return gog(ctx, ['gmail', 'get', id, '--format', format], exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: 'Read Gmail message', kind: 'read', rawInput: args.message_id }),
  }))

  ctx.tools.register(defineTool({
    name: 'gmail_send',
    description: 'Send an email from the connected Gmail account through OpenClaw gog. Call only when the user asked to send or approved the message content.',
    parameters: {
      to: { type: 'string', required: true },
      subject: { type: 'string', required: true },
      body: { type: 'string', required: true },
      cc: { type: 'string' },
      bcc: { type: 'string' },
      html: { type: 'boolean' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const command = [
        'gmail', 'send',
        '--to', requireNonBlank('to', args.to),
        '--subject', requireNonBlank('subject', args.subject),
        ...(args.html === true ? ['--body-html', args.body] : ['--body', args.body]),
        ...(args.cc === undefined || args.cc.trim() === '' ? [] : ['--cc', args.cc.trim()]),
        ...(args.bcc === undefined || args.bcc.trim() === '' ? [] : ['--bcc', args.bcc.trim()]),
      ]
      return gog(ctx, command, exec.signal, { force: true, wrapUntrusted: false })
    },
    presentCall: args => ({ card: 'generic', title: 'Send Gmail message', kind: 'execute', rawInput: { to: args.to, subject: args.subject } }),
  }))

  ctx.tools.register(defineTool({
    name: 'google_calendar_list_events',
    description: 'List events from the connected Google Calendar through OpenClaw gog.',
    parameters: {
      calendar_id: { type: 'string', description: 'Calendar id. Defaults to primary.' },
      time_min: { type: 'string', description: 'Optional RFC3339 lower bound.' },
      time_max: { type: 'string', description: 'Optional RFC3339 upper bound.' },
      max_results: { type: 'number', description: 'Maximum events, 1-250. Defaults to 50.' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const command = [
        'calendar', 'events', args.calendar_id?.trim() || 'primary',
        '--max', String(clampInteger(args.max_results, 50, 1, 250)),
        ...(args.time_min === undefined || args.time_min.trim() === '' ? [] : ['--from', args.time_min.trim()]),
        ...(args.time_max === undefined || args.time_max.trim() === '' ? [] : ['--to', args.time_max.trim()]),
      ]
      return gog(ctx, command, exec.signal)
    },
    presentCall: () => ({ card: 'generic', title: 'List Google Calendar events', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'google_calendar_create_event',
    description: 'Create an event in the connected Google Calendar through OpenClaw gog.',
    parameters: {
      summary: { type: 'string', required: true },
      start: { type: 'string', required: true },
      end: { type: 'string', required: true },
      calendar_id: { type: 'string' },
      time_zone: { type: 'string' },
      description: { type: 'string' },
      attendees: { type: 'array', items: { type: 'string' } },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const command = [
        'calendar', 'create', args.calendar_id?.trim() || 'primary',
        '--summary', requireNonBlank('summary', args.summary),
        '--from', requireNonBlank('start', args.start),
        '--to', requireNonBlank('end', args.end),
        ...(args.time_zone === undefined || args.time_zone.trim() === '' ? [] : ['--timezone', args.time_zone.trim()]),
        ...(args.description === undefined ? [] : ['--description', args.description]),
        ...(args.attendees === undefined || args.attendees.length === 0 ? [] : ['--attendees', args.attendees.join(',')]),
      ]
      return gog(ctx, command, exec.signal, { force: true, wrapUntrusted: false })
    },
    presentCall: args => ({ card: 'generic', title: 'Create Google Calendar event', kind: 'execute', rawInput: args.summary }),
  }))

  ctx.tools.register(defineTool({
    name: 'google_drive_search',
    description: 'Search/list files in the connected Google Drive using Drive v3 q syntax through OpenClaw gog.',
    parameters: {
      query: { type: 'string', description: 'Optional Drive v3 q expression.' },
      page_size: { type: 'number', description: 'Maximum files, 1-100. Defaults to 50.' },
      page_token: { type: 'string' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const command = [
        'drive', 'ls',
        '--max', String(clampInteger(args.page_size, 50, 1, 100)),
        ...(args.query === undefined || args.query.trim() === '' ? [] : ['--query', args.query.trim()]),
        ...(args.page_token === undefined || args.page_token.trim() === '' ? [] : ['--page', args.page_token.trim()]),
      ]
      return gog(ctx, command, exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: 'Search Google Drive', kind: 'search', rawInput: args.query ?? '' }),
  }))
}

/** Cordis plugin descriptor for model-facing Google Workspace tools. */
export default { name, inject, apply }
