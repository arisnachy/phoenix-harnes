import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

type PhoenixBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

const PHOENIX_MARK_VIEWBOX = '0 0 64 64'
const PHOENIX_WORDMARK_VIEWBOX = '0 0 176 28'

/**
 * Render the PHOENIX phoenix emblem at the size requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the responsive PHOENIX emblem.
 */
export function PhoenixBrandMark({ size, className }: PhoenixBrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox={PHOENIX_MARK_VIEWBOX}
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="phoenix-gold" x1="12" y1="8" x2="48" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--dsw-static-amber-100)" />
          <stop offset="0.32" stopColor="var(--dsw-static-amber-400)" />
          <stop offset="0.68" stopColor="var(--dsw-static-amber-500)" />
          <stop offset="1" stopColor="var(--dsw-static-amber-600)" />
        </linearGradient>
        <linearGradient id="phoenix-ember" x1="32" y1="19" x2="32" y2="57" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--dsw-static-amber-100)" />
          <stop offset="0.5" stopColor="var(--dsw-static-amber-500)" />
          <stop offset="1" stopColor="var(--dsw-static-red-500)" />
        </linearGradient>
      </defs>

      <circle cx="32" cy="31" r="24.5" stroke="var(--dsw-static-amber-500)" strokeWidth="1.25" opacity="0.46" />
      <path d="M32 3.75L33.1 6.9L36.25 8L33.1 9.1L32 12.25L30.9 9.1L27.75 8L30.9 6.9L32 3.75Z" fill="url(#phoenix-gold)" />
      <path d="M9.3 18.4C17.5 19.2 24.3 23.8 29.4 31.2C24.2 29.4 19.5 26.6 14.8 22.7C17.4 29.6 22.5 35 29.7 39.5C21.5 37.7 14.9 33.6 9.1 27.5C11.7 37 18.2 43.4 29.3 47.1C19.6 46.5 11.1 41.2 5.5 32.6C5.7 26.8 6.9 22.2 9.3 18.4Z" fill="url(#phoenix-gold)" />
      <path d="M54.7 18.4C46.5 19.2 39.7 23.8 34.6 31.2C39.8 29.4 44.5 26.6 49.2 22.7C46.6 29.6 41.5 35 34.3 39.5C42.5 37.7 49.1 33.6 54.9 27.5C52.3 37 45.8 43.4 34.7 47.1C44.4 46.5 52.9 41.2 58.5 32.6C58.3 26.8 57.1 22.2 54.7 18.4Z" fill="url(#phoenix-gold)" />
      <path d="M32.1 15.2C36.2 16.5 39.1 19.2 40.2 22.8L45.1 23.2L40.5 26.2C38.5 25.5 36.6 25.7 35.1 27.1C32.2 29.9 32.6 34.4 36.2 38.1C38.7 40.7 38.5 44.5 36.5 47.7L31.9 56.7L29.7 48.9L24.8 53.2C27 47.4 27.5 43 26.2 39.9C24.9 36.9 24.9 33.7 26.6 30.7C28.1 27.9 30.8 25.8 34.2 24.8C32.1 23.2 29.7 22.3 27.1 22.3C28.2 18.8 29.9 16.4 32.1 15.2Z" fill="url(#phoenix-ember)" />
      <path d="M33.3 17.8C35.7 18.9 37.5 20.5 38.3 22.4C36 21.5 33.9 21.6 32 22.6C32.2 20.5 32.6 18.9 33.3 17.8Z" fill="var(--dsw-static-amber-100)" />
      <circle cx="36.45" cy="22.5" r="0.95" fill="var(--dsw-static-red-500)" />
      <path d="M23.8 45.4C27.1 47 29.4 49.8 31.9 56.7C34.6 51.7 36.7 48.7 39.8 46.6C37.5 52.5 35.1 57.1 31.8 60.2C28.5 56.8 25.8 51.9 23.8 45.4Z" fill="url(#phoenix-ember)" opacity="0.86" />
    </svg>
  )
}

/**
 * Render the PHOENIX wordmark independently from the emblem.
 * @returns the responsive PHOENIX wordmark.
 */
export function PhoenixBrandName() {
  return (
    <svg
      viewBox={PHOENIX_WORDMARK_VIEWBOX}
      width="176"
      height="28"
      role="img"
      aria-label="PHOENIX"
    >
      <defs>
        <linearGradient id="phoenix-wordmark-gold" x1="0" y1="0" x2="0" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--dsw-static-amber-100)" />
          <stop offset="0.34" stopColor="var(--dsw-static-amber-400)" />
          <stop offset="0.72" stopColor="var(--dsw-static-amber-500)" />
          <stop offset="1" stopColor="var(--dsw-static-amber-600)" />
        </linearGradient>
      </defs>
      <text
        x="88"
        y="21"
        textAnchor="middle"
        fill="url(#phoenix-wordmark-gold)"
        stroke="var(--dsw-static-amber-900)"
        strokeWidth="0.35"
        paintOrder="stroke"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="20"
        fontWeight="700"
        letterSpacing="3.5"
      >
        PHOENIX
      </text>
      <path d="M28 25H80L88 22L96 25H148" stroke="var(--dsw-static-amber-500)" strokeWidth="0.8" />
      <path d="M88 22L91 25L88 28L85 25L88 22Z" fill="var(--dsw-static-amber-400)" />
    </svg>
  )
}
