import type { IconProps } from './icons/props.ts'
import { PhoenixLogo } from './PhoenixLogo.tsx'

/**
 * Compatibility alias for consumers of the former upstream mark export.
 * @returns the PHOENIX emblem; the former fish artwork is no longer shipped.
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return <PhoenixLogo size={size} {...(className === undefined ? {} : { className })} />
}
