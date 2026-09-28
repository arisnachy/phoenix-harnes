/** Props for the PHOENIX product emblem. */
export interface PhoenixLogoProps {
  /** Square rendered size in CSS pixels. */
  size?: number
  /** Optional host styling. */
  className?: string
}

/**
 * Render the official image-based PHOENIX emblem used by product surfaces.
 *
 * The public PNG is transparent and preserves the detailed feathered mark
 * used by the approved Phoenix visual direction; CSS controls only sizing and
 * a restrained shadow.
 */
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
