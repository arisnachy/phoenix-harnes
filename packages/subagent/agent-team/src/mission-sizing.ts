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

export type MissionComplexity = keyof typeof MISSION_TEAM_CEILINGS

/** Maximum simultaneous real specialists allowed by the declared mission tier. */
export function teammateBudgetForMission(tier: MissionComplexity): number {
  return MISSION_TEAM_CEILINGS[tier]
}
