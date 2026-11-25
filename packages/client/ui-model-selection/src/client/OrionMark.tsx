/** PHOENIX ORIÓN: compact three-star constellation, legible at 13–32px. */
import css from './ModelSelect.module.css'

/**
 * Brand symbol of the adaptive orchestration route, distinct from the
 * PHOENIX provider emblem and the concrete provider currently serving.
 */
export function OrionMark({ size = 20, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      className={active ? css.orionSelected : css.orionMark}
      data-orion-mark="belt" aria-hidden="true">
      <path d="M4.5 18.5 11.8 12.1 19.5 5.6" stroke="#64B7FF"
        strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m4.5 14.8.9 2.8 2.8.9-2.8.9-.9 2.8-.9-2.8-2.8-.9 2.8-.9Z"
        fill="#8FD4FF" transform="translate(0 -0.2)" />
      <path d="m11.8 8.1 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z"
        fill="#EABF6A" />
      <path d="m19.5 2.5.8 2.3 2.3.8-2.3.8-.8 2.3-.8-2.3-2.3-.8 2.3-.8Z"
        fill="#8FD4FF" />
    </svg>
  )
}
