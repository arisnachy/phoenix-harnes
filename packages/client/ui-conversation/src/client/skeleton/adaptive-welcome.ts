import type { MascotPose } from '../chat/LivingMascot.tsx'
import type { ProactivityAttentionItem } from '../contract/slots.ts'
import type { Celebration } from './celebrations.ts'

export interface WelcomeScene {
  readonly pose: MascotPose
  readonly subtitle: string
}
const QUIET: readonly WelcomeScene[] = [
  { pose: 'welcome', subtitle: '¿Qué construimos hoy?' },
  { pose: 'idea', subtitle: 'Una buena idea puede empezar aquí. ¿Exploramos?' },
  { pose: 'welcome', subtitle: '¿En qué podemos trabajar hoy?' },
  { pose: 'coffee', subtitle: 'Un buen momento para crear algo nuevo.' },
]
/** Real Host signals only; an upcoming task is not running, and no data is not evidence of health. */
export function adaptiveWelcome(hour: number, variant: number, attention: readonly ProactivityAttentionItem[], celebration?: Celebration, blocked = false): WelcomeScene {
  if (blocked) return { pose: 'ready', subtitle: 'Hay una condición que revisar antes de enviar un mensaje.' }
  if (attention.some(item => item.kind === 'failure')) return { pose: 'tools', subtitle: 'Hay una tarea que necesita tu atención.' }
  if (celebration?.tone === 'solemn') return { pose: 'respectful', subtitle: 'Un momento para recordar.' }
  if (attention.some(item => item.kind === 'result')) return { pose: 'settled', subtitle: 'Tengo un resultado registrado para compartir contigo.' }
  if (attention.some(item => item.kind === 'upcoming')) return { pose: 'plan', subtitle: 'Se acerca una tarea. ¿La preparamos?' }
  if (celebration?.tone === 'festive') return { pose: 'celebrate', subtitle: 'Hoy es una ocasión especial.' }
  if (celebration) return { pose: 'respectful', subtitle: 'Hoy merece un reconocimiento especial.' }
  if (hour < 6 || hour >= 22) return { pose: 'sleep', subtitle: 'Aquí estoy cuando me necesites.' }
  return QUIET[Math.abs(Math.trunc(Number.isFinite(variant) ? variant : 0)) % QUIET.length] ?? { pose: 'welcome', subtitle: '¿Qué construimos hoy?' }
}
