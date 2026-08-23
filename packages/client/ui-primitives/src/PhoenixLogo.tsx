/** Props for the PHOENIX product emblem. */
export interface PhoenixLogoProps {
  /** Square rendered size in CSS pixels. */
  size?: number
  /** Optional host styling. */
  className?: string
}

/** Render the official PHOENIX emblem used by Web product surfaces. */
export function PhoenixLogo({ size = 24, className }: PhoenixLogoProps) {
  return (
    <img
      src="/phoenix-emblem.png"
      width={size}
      height={size}
      className={className}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}
