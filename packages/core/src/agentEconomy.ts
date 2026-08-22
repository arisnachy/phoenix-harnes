export type AgentExecutionMode = 'deterministic' | 'inline' | 'local-agent' | 'specialist-agent' | 'parallel-agents';

export interface AgentWorkProposal {
  taskId: string;
  estimatedTokens: number;
  complexity: number;
  parallelizable?: boolean;
  specializationGain?: number;
  contextIsolationGain?: number;
  expectedQualityGain?: number;
  expectedLatencyGain?: number;
  deterministicAlternative?: boolean;
  localModelCapable?: boolean;
  requestedAgents?: number;
}

export interface AgentRoiDecision {
  taskId: string;
  mode: AgentExecutionMode;
  allowedAgents: number;
  roiScore: number;
  reasons: readonly string[];
}

export interface AgentRoiGateOptions {
  maxAgents?: number;
  minimumSpecialistRoi?: number;
  minimumParallelRoi?: number;
  expensiveTokenThreshold?: number;
}

function clamp01(value: number | undefined): number {
  return Math.max(0, Math.min(1, value ?? 0));
}

export class AgentRoiGate {
  readonly #options: Required<AgentRoiGateOptions>;

  public constructor(options: AgentRoiGateOptions = {}) {
    this.#options = {
      maxAgents: Math.max(1, options.maxAgents ?? 6),
      minimumSpecialistRoi: options.minimumSpecialistRoi ?? 0.42,
      minimumParallelRoi: options.minimumParallelRoi ?? 0.62,
      expensiveTokenThreshold: Math.max(512, options.expensiveTokenThreshold ?? 8_000),
    };
  }

  public decide(proposal: AgentWorkProposal): AgentRoiDecision {
    const complexity = clamp01(proposal.complexity);
    const specialization = clamp01(proposal.specializationGain);
    const isolation = clamp01(proposal.contextIsolationGain);
    const quality = clamp01(proposal.expectedQualityGain);
    const latency = clamp01(proposal.expectedLatencyGain);
    const requested = Math.max(1, Math.floor(proposal.requestedAgents ?? 1));
    const tokenPenalty = Math.min(1, Math.max(0, proposal.estimatedTokens) / this.#options.expensiveTokenThreshold);
    const baseRoi = complexity * 0.22
      + specialization * 0.28
      + isolation * 0.18
      + quality * 0.22
      + latency * 0.10
      - tokenPenalty * 0.18;
    const roiScore = Math.max(0, Math.min(1, baseRoi));
    const reasons: string[] = [`roi:${roiScore.toFixed(3)}`, `complexity:${complexity.toFixed(2)}`];

    if (proposal.deterministicAlternative && complexity < 0.65 && specialization < 0.55) {
      return { taskId: proposal.taskId, mode: 'deterministic', allowedAgents: 0, roiScore, reasons: [...reasons, 'deterministic_alternative_wins'] };
    }

    if (proposal.localModelCapable && complexity < 0.58 && roiScore < this.#options.minimumSpecialistRoi) {
      return { taskId: proposal.taskId, mode: 'local-agent', allowedAgents: 1, roiScore, reasons: [...reasons, 'local_model_sufficient'] };
    }

    if (proposal.parallelizable && requested > 1 && roiScore >= this.#options.minimumParallelRoi) {
      return {
        taskId: proposal.taskId,
        mode: 'parallel-agents',
        allowedAgents: Math.min(requested, this.#options.maxAgents),
        roiScore,
        reasons: [...reasons, 'parallelism_justified'],
      };
    }

    if (roiScore >= this.#options.minimumSpecialistRoi) {
      return { taskId: proposal.taskId, mode: 'specialist-agent', allowedAgents: 1, roiScore, reasons: [...reasons, 'specialist_justified'] };
    }

    return { taskId: proposal.taskId, mode: 'inline', allowedAgents: 0, roiScore, reasons: [...reasons, 'subagent_not_worth_cost'] };
  }
}
