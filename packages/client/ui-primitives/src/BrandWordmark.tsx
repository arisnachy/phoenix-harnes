import type { IconProps } from './icons/props.ts'
import { PhoenixLogo } from './PhoenixLogo.tsx'

/** Display options for the PHOENIX wordmark export. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading PHOENIX emblem; defaults to true. */
  includeMark?: boolean | undefined
}

/** Render the production PHOENIX geometric wordmark. */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  return (
    <span
      className={className}
      role="img"
      aria-label="PHOENIX"
      style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.3, height: size }}
    >
      {includeMark ? <PhoenixLogo size={size} /> : null}
      <svg
        data-phoenix-wordmark="true"
        aria-hidden="true"
        viewBox="0 0 290 42"
        width={size * 6.42}
        height={size}
        style={{ display: 'block', flex: 'none', overflow: 'visible' }}
      >
        <g
          data-phoenix-wordmark-ink="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="5.5"
          strokeLinecap="square"
          strokeLinejoin="round"
        >
          <path d="M4 36V6h14c8 0 12 4 12 10s-4 10-12 10H4" />
          <path d="M48 6v30M72 6v30M48 21h24" />
          <ellipse cx="104" cy="21" rx="15" ry="15" />
          <path d="M132 7h25M132 21h19M132 35h25" />
          <path d="M178 36V6l25 30V6" />
          <path d="M226 6v30" />
          <path d="M250 6l32 30M282 6l-16 15" />
        </g>
        <path
          data-phoenix-wordmark-accent="true"
          d="M266 21l16 15"
          fill="none"
          stroke="#e46a2a"
          strokeWidth="5.5"
          strokeLinecap="square"
        />
      </svg>
    </span>
  )
}
