import { describe, expect, it } from 'vitest';
import { EvolutionEngine } from './index.js';

describe('EvolutionEngine', () => {
  it('proposes evidence-backed changes but requires approval', () => {
    const engine = new EvolutionEngine();
    for (let index = 0; index < 5; index += 1) {
      engine.observe({
        requestId: String(index),
        providerId: 'unstable',
        modelId: 'm',
        outcome: index < 3 ? 'retryable_failure' : 'success',
        latencyMs: 10,
      });
    }
    const recommendation = engine.recommendations()[0];
    expect(recommendation?.kind).toBe('deprioritize_provider');
    expect(recommendation?.requiresApproval).toBe(true);
    expect(recommendation?.evidence.samples).toBe(5);
  });
});
