import { randomUUID } from 'node:crypto';
import { ModelCapabilityRanking, type EvolutionModelRole } from '@phoenix/model-rank';
import type {
  CellAssignment,
  CellPolicy,
  EvolutionCell,
  EvolutionNodeProfile,
  EvolutionProblem,
  EvolutionRole,
  JudgeAssignment,
} from './index.js';

export interface RankedNodeProfile extends EvolutionNodeProfile {
  model: {
    providerId: string;
    modelId: string;
  };
}

export interface RankedEvolutionCell extends EvolutionCell {
  orchestrator: {
    nodeId: string;
    providerId: string;
    modelId: string;
    composite: number;
    confidence: number;
  };
}

function collectiveRole(role: EvolutionRole): EvolutionModelRole {
  if (role === 'builder') return 'builder';
  if (role === 'analyst') return 'analyst';
  if (role === 'critic') return 'critic';
  if (role === 'reproducer') return 'reproducer';
  if (role === 'benchmark') return 'benchmark';
  return 'observer';
}

function modelKey(node: RankedNodeProfile): string {
  return `${node.model.providerId}::${node.model.modelId}`;
}

export interface RankedCellPolicy extends CellPolicy {
  requireQualifiedModels?: boolean;
}

export class RankedEvolutionCellCoordinator {
  public constructor(private readonly ranking: ModelCapabilityRanking) {}

  public formCell(
    problem: EvolutionProblem,
    nodes: readonly RankedNodeProfile[],
    policy: RankedCellPolicy = {},
  ): RankedEvolutionCell {
    const contributorCount = Math.max(2, Math.floor(policy.contributorCount ?? 6));
    const judgeCount = Math.max(3, Math.floor(policy.judgeCount ?? 5));
    const maxTokens = Math.max(0, Math.floor(policy.maxTokensPerContributor ?? 200));
    const maxCpuMs = Math.max(0, Math.floor(policy.maxCpuMsPerContributor ?? 10_000));
    const ttlMs = Math.max(60_000, Math.floor(policy.ttlMs ?? 30 * 60_000));
    const requireQualified = policy.requireQualifiedModels ?? true;

    const eligible = nodes.filter((node) => {
      if (!node.optIn || (node.budget.maxAiTokens <= 0 && node.budget.maxCpuMs <= 0)) return false;
      const profile = this.ranking.profile(node.model.providerId, node.model.modelId);
      if (!profile) return !requireQualified;
      return requireQualified ? profile.status !== 'provisional' && profile.status !== 'restricted' : true;
    });

    const orchestratorCandidates = eligible
      .map((node) => ({ node, ranked: this.ranking.evaluateRole(node.model.providerId, node.model.modelId, 'orchestrator') }))
      .filter((item) => item.ranked?.eligible)
      .sort((a, b) => (b.ranked?.composite ?? 0) - (a.ranked?.composite ?? 0) || (b.ranked?.confidence ?? 0) - (a.ranked?.confidence ?? 0));
    const orchestratorCandidate = orchestratorCandidates[0];
    if (!orchestratorCandidate?.ranked) {
      throw new Error('No PHOENIX model clears the command authority gate; refusing to assign a weak orchestrator');
    }
    const orchestratorNode = orchestratorCandidate.node;

    const rolePlan: EvolutionRole[] = ['reproducer', 'analyst', 'builder', 'critic', 'benchmark', 'observer'];
    const available = new Map(
      eligible
        .filter((node) => node.nodeId !== orchestratorNode.nodeId)
        .map((node) => [node.nodeId, node]),
    );
    const contributors: CellAssignment[] = [];

    for (let index = 0; index < contributorCount; index += 1) {
      const role = rolePlan[index % rolePlan.length] ?? 'observer';
      const rankedRole = collectiveRole(role);
      const candidates = [...available.values()]
        .map((node) => ({ node, ranked: this.ranking.evaluateRole(node.model.providerId, node.model.modelId, rankedRole) }))
        .filter((item) => item.ranked?.eligible)
        .sort((a, b) => (b.ranked?.composite ?? 0) - (a.ranked?.composite ?? 0) || b.node.contributionReliability - a.node.contributionReliability);
      const selected = candidates[0]?.node;
      if (!selected) continue;
      contributors.push({
        nodeId: selected.nodeId,
        role,
        aiTokenBudget: Math.min(maxTokens, selected.budget.maxAiTokens),
        cpuMsBudget: Math.min(maxCpuMs, selected.budget.maxCpuMs),
      });
      available.delete(selected.nodeId);
    }

    if (contributors.length < Math.min(2, contributorCount)) {
      throw new Error('PHOENIX ranking could not find enough qualified contributor models');
    }

    const contributorIds = new Set(contributors.map((item) => item.nodeId));
    const contributorModels = new Set(nodes.filter((node) => contributorIds.has(node.nodeId)).map(modelKey));
    const orchestratorModel = modelKey(orchestratorNode);
    const judgeCandidates = eligible
      .filter((node) => node.nodeId !== orchestratorNode.nodeId && !contributorIds.has(node.nodeId))
      .map((node) => ({ node, ranked: this.ranking.evaluateRole(node.model.providerId, node.model.modelId, 'judge') }))
      .filter((item) => item.ranked?.eligible)
      .sort((a, b) => (b.ranked?.composite ?? 0) - (a.ranked?.composite ?? 0) || b.node.judgeReliability - a.node.judgeReliability);

    const judges: JudgeAssignment[] = [];
    const usedModels = new Set<string>();
    for (const candidate of judgeCandidates) {
      if (judges.length >= judgeCount) break;
      const candidateModel = modelKey(candidate.node);
      if (usedModels.has(candidateModel)) continue;
      if (contributorModels.has(candidateModel) || candidateModel === orchestratorModel) continue;
      usedModels.add(candidateModel);
      judges.push({
        nodeId: candidate.node.nodeId,
        weight: Math.min(1, Math.max(0.5, 0.5 + (candidate.ranked?.confidence ?? 0) / 2)),
      });
    }

    if (judges.length < judgeCount) {
      throw new Error('No sufficient independent judge models clear the PHOENIX authority ranking gates');
    }

    const createdAt = new Date();
    return {
      id: randomUUID(),
      problem,
      orchestrator: {
        nodeId: orchestratorNode.nodeId,
        providerId: orchestratorNode.model.providerId,
        modelId: orchestratorNode.model.modelId,
        composite: orchestratorCandidate.ranked.composite,
        confidence: orchestratorCandidate.ranked.confidence,
      },
      contributors,
      judges,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
    };
  }
}
