import type { UserMessage } from '@phoenix-ai/dsh-session'

/**
 * Human stop requests must never be turned into model/agent instructions.
 * Match short, unambiguous commands in full so "para" inside a new task
 * cannot silently cancel that task.
 */
export function isExplicitUserStop(message: UserMessage): boolean {
  if (message.source.kind !== 'user' || message.content.length === 0
    || message.content.some(block => block.type !== 'text')) return false
  const original = message.content.map(block => block.type === 'text' ? block.text : '').join(' ')
  if (original.length > 180) return false
  let command = original.normalize('NFKC').toLocaleLowerCase('es')
    .replace(/[¡¿]/gu, '').replace(/\s+/gu, ' ').trim()
    .replace(/[.!?;,\s]+$/gu, '')
  command = command
    .replace(/^(?:(?:oye|hey|ya|por favor|please)[,\s]+)+/u, '')
    .replace(/^(?:kira|phoenix)[,:;\s]+/u, '')
    .replace(/^(?:(?:ya|por favor|please)[,\s]+)+/u, '')
    .replace(/(?:[,\s]+(?:por favor|please|ya|ahora))+$/u, '')
    .replace(/[,;:\s]+$/u, '').trim()

  const bare = /^(?:det[eé]n(?:te|lo|la|los|las)?|detener(?:te|lo|la|los|las)?|para(?:lo|la|los|las)?|parar(?:lo|la)?|p[aá]rate|cancela(?:r|lo|la|los|las)?|interrumpe|interrumpir|stop(?: it)?|cancel(?: it)?|basta)$/u
  if (bare.test(command)) return true
  const requested = command.match(/^(?:det[eé]n|detener|para|parar|cancela|cancelar|interrumpe|interrumpir|stop|cancel)\s+/u)
  if (requested !== null) {
    const target = command.slice(requested[0].length)
    return /^(?:(?:la|esta|esa|mi)\s+(?:prueba|tarea|ejecuci[oó]n|revisi[oó]n|automatizaci[oó]n|b[uú]squeda|investigaci[oó]n|actividad|misi[oó]n|sesi[oó]n)|(?:el|este|ese)\s+(?:formulario|proceso|trabajo|harness|agente|equipo|intento)|lo que (?:est[aá]s|estoy)\s+(?:haciendo|ejecutando)|todo|esto|aqu[ií]|everything|(?:the|this|that)\s+(?:test|task|run|process|work|form|execution))$/u.test(target)
  }
  return /^(?:no (?:sigas|contin[uú]es|continues|hagas nada m[aá]s)|deja de (?:trabajar|ejecutar|hacer la prueba|hacer eso)|do not continue|don't continue)$/u.test(command)
}
