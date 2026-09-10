/** Counts of immutable PHOENIX automation entries verified against a candidate tree. */
export interface VerifiedAutomationCounts {
  /** Number of protected root package scripts. */
  packageScripts: number
  /** Number of protected executable files below `scripts/`. */
  automationFiles: number
}

/** Verify that a candidate preserves the base commit's acceptance automation. */
export function verifyBaselineAutomation(candidateRoot: string, baseSha: string): VerifiedAutomationCounts

/** Run the candidate's static acceptance gate after its automation is verified. */
export function runStaticGate(candidateRoot: string): void
