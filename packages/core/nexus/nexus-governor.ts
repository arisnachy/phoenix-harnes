/** PHOENIX Nexus: provider-neutral resource-aware routing core. No paid auto-enrollment. */
export type CostClass = "free" | "free_limited" | "promotional" | "paid" | "unknown";
export type Evidence = "provider" | "observed" | "estimated" | "unknown";
export interface NexusModel {
  id: string; provider: string; enabled: boolean; local?: boolean;
  costClass: CostClass; priceEvidence: Evidence; inputCostPerMillion?: number;
  outputCostPerMillion?: number; contextTokens?: number;
  toolCalling?: boolean; reasoning?: boolean; available?: boolean;
  latencyMs?: number; quality?: number; quotaRemaining?: number;
}
export interface NexusTask {
  requiresTools?: boolean; requiresReasoning?: boolean;
  minimumQuality?: number; estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
}
export interface NexusPolicy {
  allowPaid: boolean; allowLocal: boolean; requireVerifiedFree: boolean;
  reserveFraction: number; remainingWeeklyBudget?: number;
  remainingFiveHourBudget?: number; daysUntilReset?: number;
}
export interface NexusDecision { model?: NexusModel; reason: string; candidates: number; }
export const DEFAULT_NEXUS_POLICY: NexusPolicy = {
  allowPaid: false, allowLocal: false, requireVerifiedFree: true, reserveFraction: 0.15
};
export function classifyCost(m: NexusModel): CostClass {
  if (m.priceEvidence === "unknown" || m.priceEvidence === "estimated") return "unknown";
  if (m.costClass === "free" && m.inputCostPerMillion === 0 && m.outputCostPerMillion === 0) return "free";
  return m.costClass;
}
export function remainingDailyAllowance(p: NexusPolicy): number | undefined {
  if (p.remainingWeeklyBudget === undefined || p.daysUntilReset === undefined) return undefined;
  return Math.max(0, p.remainingWeeklyBudget * (1 - Math.min(1, Math.max(0, p.reserveFraction)))) /
    Math.max(1, p.daysUntilReset);
}
export function chooseNexusModel(models: NexusModel[], task: NexusTask, policy: NexusPolicy = DEFAULT_NEXUS_POLICY): NexusDecision {
  const candidates = models.filter(m => {
    if (!m.enabled || m.available !== true) return false;
    if (m.local && !policy.allowLocal) return false;
    if (task.requiresTools && !m.toolCalling) return false;
    if (task.requiresReasoning && !m.reasoning) return false;
    if ((m.quality ?? 0) < (task.minimumQuality ?? 0)) return false;
    if (m.quotaRemaining !== undefined && m.quotaRemaining <= 0) return false;
    const cost = classifyCost(m);
    if (!policy.allowPaid && cost !== "free" && cost !== "free_limited") return false;
    if (policy.requireVerifiedFree && (m.priceEvidence !== "provider" || (cost !== "free" && cost !== "free_limited"))) return false;
    if (policy.remainingFiveHourBudget !== undefined && !m.local && cost !== "free" && policy.remainingFiveHourBudget <= 0) return false;
    return true;
  });
  const scored = candidates.map(m => {
    const tokensIn = task.estimatedInputTokens ?? 1000, tokensOut = task.estimatedOutputTokens ?? 500;
    const cost = (tokensIn * (m.inputCostPerMillion ?? 0) + tokensOut * (m.outputCostPerMillion ?? 0)) / 1_000_000;
    const latency = (m.latencyMs ?? 10000) / 1000;
    const quality = m.quality ?? 0;
    return {m, score: quality * 100 - latency * 0.2 - cost * 1000};
  }).sort((a,b) => b.score - a.score);
  return {model: scored[0]?.m, reason: scored.length ? "eligible_quality_latency_cost" : "no_verified_eligible_model", candidates: candidates.length};
}
