/** Model-facing Google Workspace tools backed by the host-owned OAuth broker. */

import { Buffer } from 'node:buffer'
import type { Context } from '@phoenix-ai/cordis'
import type {
  GoogleApiRequest,
  GoogleApiResponse,
  GoogleWorkspaceService,
} from '@phoenix-ai/dsh-authorization/google'
import {
  defineTool,
  ToolArgsError,
  type JsonValue,
} from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-authorization/google'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-google-workspace'
/** Google OAuth and the tool registry must both be present before tools register. */
export const inject = ['tools', 'googleApi']

const MAX_RESPONSE_CHARS = 200_000
const SERVICES = new Set<GoogleWorkspaceService>([
  'gmail', 'calendar', 'drive', 'docs', 'sheets', 'slides', 'contacts',
])
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const GMAIL_FORMATS = new Set(['minimal', 'full', 'metadata', 'raw'])

interface WorkspaceToolResult {
  status: number
  ok: boolean
  data: JsonValue
  truncated: boolean
}

function projectResponse(response: GoogleApiResponse): WorkspaceToolResult {
  const truncated = response.body.length > MAX_RESPONSE_CHARS
  const text = truncated ? response.body.slice(0, MAX_RESPONSE_CHARS) : response.body
  let data: JsonValue = text
  if (!truncated && text.trim() !== '') {
    try {
      data = JSON.parse(text) as JsonValue
    } catch {
      data = text
    }
  } else if (text.trim() === '') {
    data = null
  }
  return { status: response.status, ok: response.ok, data, truncated }
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

function requireHeaderValue(label: string, value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new ToolArgsError([`${label} must not be blank`])
  if (/\r|\n/u.test(trimmed)) throw new ToolArgsError([`${label} must not contain line breaks`])
  return trimmed
}

function encodedSubject(value: string): string {
  const subject = requireHeaderValue('subject', value)
  return /^[\x20-\x7E]*$/u.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '')
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved)) throw new ToolArgsError(['numeric value must be finite'])
  return Math.min(max, Math.max(min, Math.trunc(resolved)))
}

async function call(ctx: Context, request: GoogleApiRequest): Promise<WorkspaceToolResult> {
  return projectResponse(await ctx.googleApi.request(request))
}

/** Register practical Gmail/Calendar/Drive tools plus one bounded advanced Workspace request tool. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'gmail_search',
    description: 'Search the connected Gmail mailbox using Gmail query syntax. Use this for account mail, not public web search.',
    parameters: {
      query: { type: 'string', required: true, description: 'Gmail search query such as is:unread newer_than:7d.' },
      max_results: { type: 'number', description: 'Maximum messages to return, 1-100. Defaults to 20.' },
      page_token: { type: 'string', description: 'Optional Gmail pagination token.' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const params = new URLSearchParams()
      params.set('q', args.query)
      params.set('maxResults', String(clampInteger(args.max_results, 20, 1, 100)))
      if (args.page_token !== undefined && args.page_token.trim() !== '') params.set('pageToken', args.page_token)
      return call(ctx, {
        service: 'gmail',
        path: `users/me/messages?${params.toString()}`,
        signal: exec.signal,
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Search Gmail', kind: 'search', rawInput: args.query }),
  }))

  ctx.tools.register(defineTool({
    name: 'gmail_read',
    description: 'Read one Gmail message by id from the connected mailbox. Full format includes headers and MIME body parts.',
    parameters: {
      message_id: { type: 'string', required: true },
      format: { type: 'string', description: 'minimal, full, metadata, or raw. Defaults to full.' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const id = encodeURIComponent(args.message_id.trim())
      if (id === '') throw new ToolArgsError(['message_id must not be blank'])
      const format = (args.format ?? 'full').toLowerCase()
      if (!GMAIL_FORMATS.has(format)) throw new ToolArgsError(['format must be minimal, full, metadata, or raw'])
      return call(ctx, {
        service: 'gmail',
        path: `users/me/messages/${id}?format=${encodeURIComponent(format)}`,
        signal: exec.signal,
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Read Gmail message', kind: 'read', rawInput: args.message_id }),
  }))

  ctx.tools.register(defineTool({
    name: 'gmail_send',
    description: 'Send an email from the connected Gmail account. Call only when the user asked to send or approved the message content.',
    parameters: {
      to: { type: 'string', required: true, description: 'Recipient address or comma-separated recipient addresses.' },
      subject: { type: 'string', required: true },
      body: { type: 'string', required: true },
      cc: { type: 'string', description: 'Optional comma-separated CC addresses.' },
      bcc: { type: 'string', description: 'Optional comma-separated BCC addresses.' },
      html: { type: 'boolean', description: 'Send body as text/html instead of text/plain.' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const headers = [
        `To: ${requireHeaderValue('to', args.to)}`,
        ...(args.cc === undefined || args.cc.trim() === '' ? [] : [`Cc: ${requireHeaderValue('cc', args.cc)}`]),
        ...(args.bcc === undefined || args.bcc.trim() === '' ? [] : [`Bcc: ${requireHeaderValue('bcc', args.bcc)}`]),
        `Subject: ${encodedSubject(args.subject)}`,
        'MIME-Version: 1.0',
        `Content-Type: ${args.html === true ? 'text/html' : 'text/plain'}; charset=UTF-8`,
        'Content-Transfer-Encoding: 8bit',
      ]
      const raw = base64url(`${headers.join('\r\n')}\r\n\r\n${args.body}`)
      return call(ctx, {
        service: 'gmail',
        path: 'users/me/messages/send',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raw }),
        signal: exec.signal,
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Send Gmail message', kind: 'execute', rawInput: { to: args.to, subject: args.subject } }),
  }))

  ctx.tools.register(defineTool({
    name: 'google_calendar_list_events',
    description: 'List events from the connected Google Calendar, optionally bounded by RFC3339 start/end times.',
    parameters: {
      calendar_id: { type: 'string', description: 'Calendar id. Defaults to primary.' },
      time_min: { type: 'string', description: 'Optional RFC3339 lower bound.' },
      time_max: { type: 'string', description: 'Optional RFC3339 upper bound.' },
      max_results: { type: 'number', description: 'Maximum events, 1-250. Defaults to 50.' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const calendarId = encodeURIComponent(args.calendar_id?.trim() || 'primary')
      const params = new URLSearchParams({
        maxResults: String(clampInteger(args.max_results, 50, 1, 250)),
        singleEvents: 'true',
        orderBy: 'startTime',
      })
      if (args.time_min !== undefined && args.time_min.trim() !== '') params.set('timeMin', args.time_min.trim())
      if (args.time_max !== undefined && args.time_max.trim() !== '') params.set('timeMax', args.time_max.trim())
      return call(ctx, {
        service: 'calendar',
        path: `calendars/${calendarId}/events?${params.toString()}`,
        signal: exec.signal,
      })
    },
    presentCall: () => ({ card: 'generic', title: 'List Google Calendar events', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'google_calendar_create_event',
    description: 'Create an event in the connected Google Calendar. Use only when the user asked to schedule/create it.',
    parameters: {
      summary: { type: 'string', required: true },
      start: { type: 'string', required: true, description: 'RFC3339 start date-time.' },
      end: { type: 'string', required: true, description: 'RFC3339 end date-time.' },
      calendar_id: { type: 'string', description: 'Calendar id. Defaults to primary.' },
      time_zone: { type: 'string', description: 'Optional IANA time zone, such as America/Santo_Domingo.' },
      description: { type: 'string' },
      attendees: { type: 'array', items: { type: 'string' }, description: 'Optional attendee email addresses.' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const calendarId = encodeURIComponent(args.calendar_id?.trim() || 'primary')
      const body = {
        summary: args.summary,
        ...(args.description === undefined ? {} : { description: args.description }),
        start: {
          dateTime: args.start,
          ...(args.time_zone === undefined ? {} : { timeZone: args.time_zone }),
        },
        end: {
          dateTime: args.end,
          ...(args.time_zone === undefined ? {} : { timeZone: args.time_zone }),
        },
        ...(args.attendees === undefined ? {} : {
          attendees: args.attendees.map(email => ({ email: requireHeaderValue('attendee email', email) })),
        }),
      }
      return call(ctx, {
        service: 'calendar',
        path: `calendars/${calendarId}/events`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: exec.signal,
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Create Google Calendar event', kind: 'execute', rawInput: args.summary }),
  }))

  ctx.tools.register(defineTool({
    name: 'google_drive_search',
    description: 'Search/list files in the connected Google Drive using Drive v3 q syntax.',
    parameters: {
      query: { type: 'string', description: 'Optional Drive v3 q expression.' },
      page_size: { type: 'number', description: 'Maximum files, 1-100. Defaults to 50.' },
      page_token: { type: 'string' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const params = new URLSearchParams({
        pageSize: String(clampInteger(args.page_size, 50, 1, 100)),
        fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,parents,size)',
      })
      if (args.query !== undefined && args.query.trim() !== '') params.set('q', args.query.trim())
      if (args.page_token !== undefined && args.page_token.trim() !== '') params.set('pageToken', args.page_token.trim())
      return call(ctx, {
        service: 'drive',
        path: `files?${params.toString()}`,
        signal: exec.signal,
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Search Google Drive', kind: 'search', rawInput: args.query ?? '' }),
  }))

  ctx.tools.register(defineTool({
    name: 'google_workspace_request',
    description: 'Advanced bounded Google Workspace REST call through PHOENIX OAuth. Use only when a dedicated Gmail/Calendar/Drive tool does not cover the task. '
      + 'service is restricted to gmail, calendar, drive, docs, sheets, slides, contacts; path must be relative and caller authentication headers are forbidden.',
    parameters: {
      service: { type: 'string', required: true },
      path: { type: 'string', required: true },
      method: { type: 'string', description: 'GET, POST, PUT, PATCH, DELETE. Defaults to GET.' },
      body: { type: 'string', description: 'Optional request body, normally JSON text.' },
      content_type: { type: 'string', description: 'Defaults to application/json when body is present.' },
      upload: { type: 'boolean', description: 'Use the fixed upload API for Gmail/Drive.' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const service = args.service as GoogleWorkspaceService
      if (!SERVICES.has(service)) throw new ToolArgsError(['service must be gmail, calendar, drive, docs, sheets, slides, or contacts'])
      const method = (args.method ?? 'GET').trim().toUpperCase()
      if (!METHODS.has(method)) throw new ToolArgsError(['method must be GET, POST, PUT, PATCH, or DELETE'])
      return call(ctx, {
        service,
        path: args.path,
        method,
        ...(args.body === undefined ? {} : {
          body: args.body,
          headers: { 'content-type': args.content_type ?? 'application/json' },
        }),
        ...(args.upload === true ? { upload: true } : {}),
        signal: exec.signal,
      })
    },
    presentCall: args => ({ card: 'generic', title: `Google Workspace: ${args.service}`, kind: 'execute', rawInput: { path: args.path, method: args.method ?? 'GET' } }),
  }))
}

export default { name, inject, apply }
