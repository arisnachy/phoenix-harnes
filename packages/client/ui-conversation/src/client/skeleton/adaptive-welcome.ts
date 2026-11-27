import type { MascotPose } from '../chat/LivingMascot.tsx'
import type { ProactivityAttentionItem } from '../contract/slots.ts'
import type { Celebration } from './celebrations.ts'

export interface WelcomeScene {
  readonly pose: MascotPose
  readonly subtitle: string
}

/** Keep untrusted task titles as short display text, not executable instructions. */
function titleOf(item: ProactivityAttentionItem): string {
  const title = item.title.replace(/\s+/gu, ' ').trim()
  return title.length > 100 ? title.slice(0, 99) + '…' : title
}

/** An event-driven assistant welcome. No random scene selection, no invented work. */
export function adaptiveWelcome(hour: number, attention: readonly ProactivityAttentionItem[], celebration?: Celebration, blocked = false): WelcomeScene {
  if (blocked) return { pose: 'ready', subtitle: 'Hay una condición que revisar antes de que podamos continuar.' }
  const failure = attention.find(item => item.kind === 'failure')
  if (failure !== undefined) return { pose: 'tools', subtitle: 'Necesito avisarte de un problema en «' + titleOf(failure) + '». ¿Lo revisamos?' }
  if (celebration?.tone === 'solemn') return { pose: 'respectful', subtitle: 'Estoy aquí para acompañarte en este día de recuerdo.' }
  const result = attention.find(item => item.kind === 'result')
  if (result !== undefined) return { pose: 'settled', subtitle: 'Tengo novedades de «' + titleOf(result) + '» para compartir contigo.' }
  const upcoming = attention.find(item => item.kind === 'upcoming')
  if (upcoming !== undefined) return { pose: 'plan', subtitle: 'Tenemos pendiente «' + titleOf(upcoming) + '». ¿Lo preparamos juntos?' }
  if (celebration?.tone === 'festive') return { pose: 'celebrate', subtitle: 'Hoy es una ocasión especial. ¡Me alegra acompañarte!' }
  if (celebration) return { pose: 'respectful', subtitle: 'Hoy merece un reconocimiento especial.' }
  if (hour < 6 || hour >= 22) return { pose: 'welcome', subtitle: 'Sigo disponible. ¿Quieres retomar algo o conversar un rato?' }
  if (hour < 12) return { pose: 'coffee', subtitle: 'Estoy aquí para ayudarte a organizar el día. ¿Por dónde empezamos?' }
  if (hour < 19) return { pose: 'welcome', subtitle: 'Me alegra verte. Podemos retomar tus tareas o comenzar algo nuevo.' }
  return { pose: 'welcome', subtitle: 'Estoy aquí contigo. ¿Revisamos lo pendiente o empezamos algo nuevo?' }
}
