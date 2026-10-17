/**
 * Research Studio's permission-gated, idempotent external artifact deliveries.
 * Never infer recipient credentials or fabricate provider message receipts.
 */
import { createHash } from 'node:crypto'
import { open, readFile, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@phoenix-ai/cordis'
import { credentialRef } from '@phoenix-ai/dsh-credentials'
import type { ApprovalService } from '@phoenix-ai/dsh-user-approval'
import { defineTool, ToolArgsError, type ToolDefinition } from '@phoenix-ai/dsh-tools'
import type { AssistantMailControl } from './assistant-mail-runtime.ts'
import { agentMailRequest } from './assistant-mail-agentmail.ts'

type Channel = 'email' | 'telegram'
type Format = 'pdf' | 'docx'
type Receipt = { channel: Channel; format: Format; state: 'sent' | 'blocked' | 'ambiguous'; providerMessageId?: string; message?: string }

/**
 * Construct a file path only from an authenticated Research Studio digest, never
 * from an arbitrary model-supplied filesystem path.
 */
export function researchDeliveryFile(reportId: string, format: Format): string {
  if (!/^[0-9a-f]{16}$/u.test(reportId) || !['pdf', 'docx'].includes(format)) {
    throw new ToolArgsError(['report_id debe contener 16 caracteres hexadecimales y formato pdf o docx.'])
  }
  return join(homedir(), '.dsh', 'research-reports', reportId, 'informe.' + format)
}

/** Admission: a file is eligible only when its original publisher manifest points to that file. */
export async function verifyPublishedDocument(reportId: string, format: Format): Promise<{ path: string; bytes: Uint8Array }> {
  const path = researchDeliveryFile(reportId, format)
  const manifestPath = join(homedir(), '.dsh', 'research-reports', reportId, 'manifest.json')
  const record = JSON.parse(await readFile(manifestPath, 'utf8')) as { state?: string; files?: Record<string, string> }
  if (record.state !== 'REPORT_READY' || record.files?.[format] !== path || !existsSync(path)) {
    throw new Error('El documento no consta como verificado por Research Studio.')
  }
  const length = statSync(path).size
  if (length < 128 || length > 20 * 1024 * 1024) throw new Error('El documento supera el tamaño permitido o está vacío.')
  const bytes = new Uint8Array(await readFile(path))
  const header = format === 'pdf' ? '%PDF-' : 'PK'
  if (new TextDecoder().decode(bytes.slice(0, header.length)) !== header) {
    throw new Error('El documento no tiene una cabecera válida.')
  }
  return { path, bytes }
}

function receiptPath(reportId: string, channel: Channel, format: Format): string {
  return join(homedir(), '.dsh', 'research-reports', reportId, 'delivery-' + channel + '-' + format + '.json')
}

async function sendExactlyOnce(
  reportId: string,
  channel: Channel,
  format: Format,
  action: () => Promise<string>,
): Promise<Receipt> {
  const path = receiptPath(reportId, channel, format)
  try {
    const handle = await open(path, 'wx')
    try { await handle.writeFile(JSON.stringify({ state: 'pending', channel, format, createdAt: new Date().toISOString() })) }
    finally { await handle.close() }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const prior = JSON.parse(await readFile(path, 'utf8')) as Receipt
    if (prior.state === 'sent' && prior.providerMessageId) return prior
    return { channel, format, state: 'ambiguous', message: 'El envío anterior carece de confirmación; revise el proveedor antes de reintentar.' }
  }
  try {
    const providerMessageId = await action()
    const receipt: Receipt = { channel, format, state: 'sent', providerMessageId }
    await writeFile(path, JSON.stringify(receipt))
    return receipt
  } catch {
    const receipt: Receipt = { channel, format, state: 'ambiguous', message: 'No hay confirmación del proveedor; envío no reintentado para evitar duplicados.' }
    await writeFile(path, JSON.stringify(receipt))
    return receipt
  }
}

/** Explicit host-authorized and owner-bound sending dependencies. */
export interface ResearchDeliveryDeps {
  readonly ctx: Context
  readonly approval: ApprovalService
  readonly mailbox: () => AssistantMailControl | undefined
  readonly mailCredentialRef: string
}

async function sendByEmail(
  deps: ResearchDeliveryDeps,
  reportId: string,
  format: Format,
  signal: AbortSignal,
): Promise<Receipt> {
  const mailbox = deps.mailbox()
  if (mailbox === undefined) throw new Error('Buzón de Kira no disponible.')
  const identity = await mailbox.status()
  if (identity.state !== 'ready' || !identity.inboxId || !identity.ownerEmail) {
    throw new Error('La cuenta de correo de Kira debe estar verificada y tener un propietario.')
  }
  const key = await deps.ctx.get('credentials')?.resolve(credentialRef(deps.mailCredentialRef))
  if (!key?.value) throw new Error('No hay una credencial de correo autorizada.')
  const file = await verifyPublishedDocument(reportId, format)
  if (file.bytes.length > 4 * 1024 * 1024) {
    throw new Error('El archivo supera el límite seguro de adjunto inline (4 MB); debe usarse un enlace autorizado.')
  }
  const idempotencyKey = createHash('sha256').update(reportId + ':email:' + format + ':' + identity.ownerEmail).digest('hex')
  return await sendExactlyOnce(reportId, 'email', format, async () => {
    const response = await agentMailRequest(
      '/inboxes/' + encodeURIComponent(identity.inboxId!) + '/messages/send',
      key.value, 30000, fetch,
      {
        to: [identity.ownerEmail], subject: 'Phoenix Research Studio · Informe ' + reportId,
        text: 'Adjunto el informe científico generado en Phoenix. Verifica sus fuentes y limitaciones antes de entregarlo.',
        attachments: [{
          filename: 'informe.' + format,
          content_type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          content: Buffer.from(file.bytes).toString('base64'),
        }],
        headers: { 'Auto-Submitted': 'auto-generated' },
      },
      'phoenix-research-' + idempotencyKey, signal,
    ) as { message_id?: unknown }
    if (typeof response.message_id !== 'string' || !response.message_id) {
      throw new Error('AgentMail no devolvió un identificador de mensaje.')
    }
    return response.message_id
  })
}

async function sendByTelegram(
  deps: ResearchDeliveryDeps, reportId: string, format: Format, signal: AbortSignal,
): Promise<Receipt> {
  const credentials = deps.ctx.get('credentials')
  const token = await credentials?.resolve(credentialRef('PHOENIX_TELEGRAM_BOT_TOKEN'))
  const chat = await credentials?.resolve(credentialRef('PHOENIX_TELEGRAM_OWNER_CHAT_ID'))
  if (!token?.value || !/^[0-9]{6,16}:[A-Za-z0-9_-]{25,}$/u.test(token.value) || !chat?.value
    || !/^-?[0-9]{5,25}$/u.test(chat.value)) {
    throw new Error('Telegram no está vinculado a un chat autorizado del propietario.')
  }
  const file = await verifyPublishedDocument(reportId, format)
  return await sendExactlyOnce(reportId, 'telegram', format, async () => {
    const form = new FormData()
    form.append('chat_id', chat.value)
    form.append('caption', 'Phoenix Research Studio · Informe ' + reportId)
    form.append('document', new Blob([file.bytes], {
      type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }), 'informe.' + format)
    let response: Response
    try {
      response = await fetch('https://api.telegram.org/bot' + token.value + '/sendDocument', {
        method: 'POST', body: form, signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
      })
    } catch {
      throw new Error('Telegram no confirmó el envío.')
    }
    const result = await response.json() as { ok?: boolean; result?: { message_id?: unknown } }
    if (!response.ok || result.ok !== true || typeof result.result?.message_id !== 'number') {
      throw new Error('Telegram rechazó el documento o no confirmó su mensaje.')
    }
    return String(result.result.message_id)
  })
}

/**
 * Send a previously verified report only after native user approval; each
 * recipient/format gets an isolated durable receipt and no blind retry.
 */
export function createResearchDeliverTool(deps: ResearchDeliveryDeps): ToolDefinition {
  return defineTool({
    name: 'phoenix_research_deliver',
    description: 'ENVÍA UN DOCUMENTO REAL de Phoenix Research Studio a los canales autorizados del PROPIETARIO y devuelve comprobantes independientes. Requiere report_id de 16 caracteres hexadecimales devuelto por phoenix_research_publish, channel:"email"|"telegram"|"both" y format:"pdf"|"docx"|"both". Solo utiliza el correo verificado de Kira al propietario o el chat Telegram previamente vinculado; no admite destinatarios arbitrarios. Solicita aprobación nativa antes de cualquier envío, jamás simula envíos ni repite automáticamente una transmisión ambigua. Si falta alguna conexión o el proveedor rechaza el archivo, reporta un estado separado por canal. Primero publica con phoenix_research_publish.',
    timeoutMs: 240000,
    parameters: {
      report_id: { type: 'string', required: true, description: 'Identificador de 16 caracteres del informe generado.' },
      channel: { type: 'string', required: true, enum: ['email', 'telegram', 'both'] },
      format: { type: 'string', required: true, enum: ['pdf', 'docx', 'both'] },
    },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const id = args.report_id
      if (!/^[0-9a-f]{16}$/u.test(id)) throw new ToolArgsError(['report_id inválido.'])
      const channels: Channel[] = args.channel === 'both' ? ['email', 'telegram'] : [args.channel as Channel]
      const formats: Format[] = args.format === 'both' ? ['pdf', 'docx'] : [args.format as Format]
      // Verify all files before soliciting an irreversible external action.
      await Promise.all(formats.map(format => verifyPublishedDocument(id, format)))
      if (exec.agent === undefined) throw new Error('La entrega requiere una sesión de agente autenticada.')
      const permission = await deps.approval.request({
        agent: exec.agent, toolName: 'phoenix_research_deliver', callId: exec.callId,
        reason: 'Enviar documentos del informe ' + id + ' por ' + channels.join(' y ')
          + ' a las cuentas del propietario previamente vinculadas.',
        risk: 'high', reversible: false, signal: exec.signal,
      })
      if (permission !== 'allowed-once') {
        return { state: 'blocked', approved: false, receipts: [] }
      }
      const receipts: Receipt[] = []
      for (const channel of channels) {
        for (const format of formats) {
          if (exec.signal.aborted) throw new Error('Distribución cancelada.')
          try {
            receipts.push(channel === 'email'
              ? await sendByEmail(deps, id, format, exec.signal)
              : await sendByTelegram(deps, id, format, exec.signal))
          } catch (error) {
            receipts.push({
              channel, format, state: 'blocked',
              message: error instanceof Error ? error.message.slice(0, 240) : 'Entrega bloqueada.',
            })
          }
        }
      }
      return {
        state: receipts.every(x => x.state === 'sent') ? 'DELIVERED' : 'PARTIAL',
        approved: true, receipts,
      }
    },
    presentCall(args) {
      return { card: 'generic', title: 'Entregar investigación por ' + args.channel, kind: 'execute' }
    },
  })
}
