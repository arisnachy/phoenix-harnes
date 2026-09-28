/** Props for the PHOENIX product emblem. */
export interface PhoenixLogoProps {
  /** Square rendered size in CSS pixels. */
  size?: number
  /** Optional host styling. */
  className?: string
  /** Brand mark by default; activity uses the warm animated-chat avatar artwork. */
  variant?: 'brand' | 'activity'
}

/**
 * Render the official image-based PHOENIX emblem used by product surfaces.
 *
 * The public PNG is transparent and preserves the detailed feathered mark
 * used by the approved Phoenix visual direction; CSS controls only sizing and
 * a restrained shadow.
 */
export function PhoenixLogo({ size = 24, className, variant = 'brand' }: PhoenixLogoProps) {
  return (
    <img
      src={variant === 'activity' ? '/phoenix-activity-avatar.svg' : '/phoenix-emblem.png'}
      width={size}
      height={size}
      className={className}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}
