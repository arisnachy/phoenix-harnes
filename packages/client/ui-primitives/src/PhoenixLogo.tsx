/** Props for the PHOENIX product emblem. */
export interface PhoenixLogoProps {
  /** Square rendered size in CSS pixels. */
  size?: number
  /** Optional host styling. */
  className?: string
}

/** Render the vector-native PHOENIX emblem used by product surfaces. */
export function PhoenixLogo({ size = 24, className }: PhoenixLogoProps) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} fill="none" aria-hidden="true" focusable="false">
      <circle cx="32" cy="31" r="24.5" stroke="var(--dsw-specific-phoenix-accent, #e25f25)" strokeOpacity="0.2" strokeWidth="1.1" />
      <path d="M30.8 29.5C26.4 18.4 18.7 11.9 8.8 9.4c2.4 11 7.7 19.5 16.4 25.2-6.6-1.7-12.2-1.2-16.7 1.7 6.1 5.8 12.6 8.2 19.4 7.4-2.4 3.3-3.4 6.4-3 9.4 4.6-2.9 7.1-6.8 7.4-11.8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M33.2 29.5C37.6 18.4 45.3 11.9 55.2 9.4c-2.4 11-7.7 19.5-16.4 25.2 6.6-1.7 12.2-1.2 16.7 1.7-6.1 5.8-12.6 8.2-19.4 7.4 2.4 3.3 3.4 6.4 3 9.4-4.6-2.9-7.1-6.8-7.4-11.8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M28.2 24.2c-4.6-4.1-9.4-6.9-14.4-8.4M27.1 29.8c-5.6-1.9-10.6-2.4-15.2-1.5M27.4 35c-5.2.5-9.6 2-13.3 4.5" stroke="currentColor" strokeOpacity="0.52" strokeWidth="1.35" strokeLinecap="round" />
      <path d="M35.8 24.2c4.6-4.1 9.4-6.9 14.4-8.4M36.9 29.8c5.6-1.9 10.6-2.4 15.2-1.5M36.6 35c5.2.5 9.6 2 13.3 4.5" stroke="currentColor" strokeOpacity="0.52" strokeWidth="1.35" strokeLinecap="round" />
      <path d="M32 13.2c-1.2 5.1-4.2 7.2-4.2 11 0 2.5 1.6 4.3 4.2 5.6 2.6-1.3 4.2-3.1 4.2-5.6 0-3.8-3-5.9-4.2-11Z" fill="currentColor" />
      <path d="M32 29.8c-3.8 4.2-4.4 8.5-1.7 12.8L32 51.8l1.7-9.2c2.7-4.3 2.1-8.6-1.7-12.8Z" fill="currentColor" />
      <path d="M32 48.5v7.2" stroke="var(--dsw-specific-phoenix-accent, #e25f25)" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M32 7.2v2.5M23.5 10.1l1.1 2.2M40.5 10.1l-1.1 2.2" stroke="var(--dsw-specific-phoenix-accent, #e25f25)" strokeOpacity="0.66" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}
