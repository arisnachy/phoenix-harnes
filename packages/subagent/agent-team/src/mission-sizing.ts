/** Conservative, explicit teammate ceilings for a Kira mission.
 * The Lead selects a tier from independently executable scopes; no worker is spawned by this helper.
 * These limits complement the universal five-worker service admission cap.
 */
export const MISSION_TEAM_CEILINGS = {
  simple: 1,
  medium: 2,
  difficult: 3,
  exceptional: 5,
} as const

/** Supported mission scope tiers used by the universal team router. */
export type MissionComplexity = keyof typeof MISSION_TEAM_CEILINGS

/**
 * Maximum simultaneous real specialists allowed by the declared mission tier.
 * @param tier - validated mission classification from a real delegation request.
 * @returns maximum worker count for the tier, at most five.
 */
export function teammateBudgetForMission(tier: string): number {
  if (Object.prototype.hasOwnProperty.call(MISSION_TEAM_CEILINGS, tier)) {
    return MISSION_TEAM_CEILINGS[tier as MissionComplexity]
  }
  throw new RangeError(`Invalid mission complexity: ${tier}`)
}
