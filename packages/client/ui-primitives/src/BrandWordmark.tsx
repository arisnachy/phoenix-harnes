import type { IconProps } from './icons/props.ts'
import { PhoenixLogo } from './PhoenixLogo.tsx'

/** Display options for the compatibility wordmark export. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading PHOENIX emblem; defaults to true. */
  includeMark?: boolean | undefined
}

/** Render the PHOENIX wordmark through the retained compatibility export. */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  return (
    <span
      className={className}
      role="img"
      aria-label="PHOENIX"
      style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.3, height: size }}
    >
      {includeMark ? <PhoenixLogo size={size} /> : null}
      <span
        style={{
          color: 'var(--dsw-static-amber-600, #dd8629)',
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontSize: size * 0.83,
          fontWeight: 700,
          letterSpacing: size * 0.14,
          lineHeight: 1,
        }}
      >
        PHOENIX
      </span>
    </span>
  )
}
