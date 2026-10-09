/** Lightweight 2.5D facial layer shared by Kira and her twenty specialists. */
import { useEffect, useRef, type CSSProperties } from 'react'
import type { ModelAvatarKind } from './ModelActivityAvatar.tsx'
import css from './LivingAvatarFace.module.css'

export type AvatarExpression = 'neutral' | 'warm' | 'focused' | 'happy' | 'concerned' | 'confident'
export type AvatarMotion = 'auto' | 'off'

/** Coordinates measured against the original portrait, before the circular crop. */
interface Landmarks {
  readonly leftX: number
  readonly rightX: number
  readonly eyesY: number
  readonly mouthX: number
  readonly mouthY: number
  readonly skin: string
}

const DEFAULT: Landmarks = { leftX: 40, rightX: 66, eyesY: 44, mouthX: 57, mouthY: 70, skin: '#d6a88b' }
/** No external face tracking or camera is required: portrait landmarks are stable. */
const LANDMARKS: Partial<Record<ModelAvatarKind, Landmarks>> = {
  kira: { leftX: 52, rightX: 75, eyesY: 51, mouthX: 67, mouthY: 74, skin: '#d9a58c' },
  aurora: { leftX: 40, rightX: 65, eyesY: 45, mouthX: 55, mouthY: 67, skin: '#efc2af' },
  vega: { leftX: 40, rightX: 65, eyesY: 43, mouthX: 56, mouthY: 68, skin: '#d9a48e' },
  nova: { leftX: 40, rightX: 65, eyesY: 46, mouthX: 55, mouthY: 70, skin: '#e7b7a0' },
  atlas: { leftX: 38, rightX: 64, eyesY: 43, mouthX: 54, mouthY: 70, skin: '#bd8b6a' },
  helix: { leftX: 41, rightX: 64, eyesY: 44, mouthX: 55, mouthY: 70, skin: '#c59775' },
  prisma: { leftX: 42, rightX: 66, eyesY: 46, mouthX: 57, mouthY: 70, skin: '#ebad9e' },
  orion: { leftX: 41, rightX: 67, eyesY: 44, mouthX: 56, mouthY: 69, skin: '#966b54' },
  eclipse: { leftX: 43, rightX: 67, eyesY: 45, mouthX: 57, mouthY: 70, skin: '#c2a9a0' },
  lumen: { leftX: 43, rightX: 67, eyesY: 45, mouthX: 58, mouthY: 71, skin: '#e3b2a0' },
  cobalto: { leftX: 39, rightX: 64, eyesY: 46, mouthX: 54, mouthY: 72, skin: '#976c5a' },
  quasar: { leftX: 43, rightX: 67, eyesY: 44, mouthX: 57, mouthY: 69, skin: '#b68573' },
  solaria: { leftX: 42, rightX: 66, eyesY: 45, mouthX: 56, mouthY: 70, skin: '#d8a58d' },
  argo: { leftX: 39, rightX: 64, eyesY: 45, mouthX: 54, mouthY: 70, skin: '#bd906f' },
  nexo: { leftX: 40, rightX: 64, eyesY: 46, mouthX: 55, mouthY: 70, skin: '#d1a995' },
  astra: { leftX: 42, rightX: 68, eyesY: 45, mouthX: 58, mouthY: 71, skin: '#d8b4a3' },
  lyra: { leftX: 40, rightX: 65, eyesY: 45, mouthX: 55, mouthY: 69, skin: '#e0b4a5' },
  zenith: { leftX: 42, rightX: 66, eyesY: 45, mouthX: 56, mouthY: 70, skin: '#d0a690' },
  senda: { leftX: 41, rightX: 66, eyesY: 46, mouthX: 56, mouthY: 72, skin: '#cfa38f' },
  orbita: { leftX: 40, rightX: 65, eyesY: 44, mouthX: 55, mouthY: 70, skin: '#dfb6a7' },
  vortice: { leftX: 42, rightX: 67, eyesY: 44, mouthX: 57, mouthY: 70, skin: '#d6a18e' },
}

/** One expression is selected from actual work phase unless the caller overrides it. */
export function avatarExpressionOf(
  running: boolean, pending: boolean, phase: string,
  emotion?: AvatarExpression,
): AvatarExpression {
  if (emotion !== undefined) return emotion
  if (pending) return 'concerned'
  if (running && phase === 'verifying') return 'focused'
  if (running && phase === 'running-tools') return 'confident'
  if (running && phase === 'preparing') return 'focused'
  if (!running && phase === 'idle') return 'warm'
  return 'neutral'
}

export interface LivingAvatarFaceProps {
  readonly kind: ModelAvatarKind
  readonly expression: AvatarExpression
  readonly motion?: AvatarMotion
  readonly speaking?: boolean
  readonly listening?: boolean
}

/**
 * Features are independent of the base portrait: eyelids, gaze highlights
 * and mouth shapes form an optional small facial rig. Motion pauses when offscreen.
 * This is a 2.5D approximation, NOT a fully articulated Live2D mesh.
 */
export function LivingAvatarFace({
  kind, expression, speaking = false, listening = false, motion = 'auto',
}: LivingAvatarFaceProps) {
  const node = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const element = node.current
    if (element === null || motion === 'off') return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(records => {
      for (const record of records) {
        if (record.target === element) element.dataset.inView = String(record.isIntersecting)
      }
    }, { threshold: 0.01 })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [motion])
  const marks = LANDMARKS[kind] ?? DEFAULT
  const blinkOffset = -(Array.from(kind).reduce((total, letter) => total + letter.charCodeAt(0), 0) % 17) / 3
  const skin = { '--lid-tone': marks.skin } as CSSProperties
  return (
    <span ref={node} className={css.face} data-living-face data-expression={expression}
      data-speaking={speaking} data-listening={listening} data-motion={motion}
      data-in-view="true" aria-hidden="true" style={skin}>
      <span className={css.eye} data-eye="left"
        style={{ left: `${marks.leftX}%`, top: `${marks.eyesY}%`, animationDelay: `${blinkOffset}s` }} />
      <span className={css.eye} data-eye="right"
        style={{ left: `${marks.rightX}%`, top: `${marks.eyesY - 1}%`, animationDelay: `${blinkOffset}s` }} />
      <span className={css.mouth} style={{ left: `${marks.mouthX}%`, top: `${marks.mouthY}%` }} />
      <span className={css.expressionGlint} />
    </span>
  )
}
