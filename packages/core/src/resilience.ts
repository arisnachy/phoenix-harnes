import type { PhoenixRequest, PhoenixResponse } from '@phoenix/contracts';

export type FailureClass = 'rate_limit' | 'temporary' | 'quota' | 'terminal' | 'cancelled' | 'unknown';

export interface RecoveryDirective {
  failureClass: FailureClass;
  action: 'retry' | 'checkpoint_and_retry' | 'failover' | 'stop';
  delayMs: number;
  reason: string;
}

export interface NeverStopPolicy {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  checkpointAfterAttempt?: number;
}

export interface GenerationRuntimeLike {
  generate(request: PhoenixRequest, signal?: AbortSignal): Promise<PhoenixResponse>;
}

export interface ResilienceHooks {
  checkpoint?(input: { attempt: number; directive: RecoveryDirective; error: unknown }): Promise<void> | void;
  onAttempt?(input: { attempt: number; directive?: RecoveryDirective }): Promise<void> | void;
  sleep?(ms: number, signal?: AbortSignal): Promise<void>;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('Aborted'));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export function classifyFailure(error: unknown): FailureClass {
  if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
  const value = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const text = value.toLowerCase();
  if (/429|rate.?limit|too many requests/.test(text)) return 'rate_limit';
  if (/quota|usage limit|credit exhausted|insufficient credits/.test(text)) return 'quota';
  if (/timeout|temporar|econnreset|econnrefused|503|502|504|network/.test(text)) return 'temporary';
  if (/400|401|403|404|invalid request|authentication|permission denied|unsupported/.test(text)) return 'terminal';
  if (/abort|cancel/.test(text)) return 'cancelled';
  return 'unknown';
}

export class NeverStopPlanner {
  readonly #policy: Required<NeverStopPolicy>;

  public constructor(policy: NeverStopPolicy = {}) {
    this.#policy = {
      maxAttempts: Math.max(1, policy.maxAttempts ?? 4),
      baseDelayMs: Math.max(0, policy.baseDelayMs ?? 500),
      maxDelayMs: Math.max(0, policy.maxDelayMs ?? 30_000),
      checkpointAfterAttempt: Math.max(1, policy.checkpointAfterAttempt ?? 2),
    };
  }

  public maxAttempts(): number { return this.#policy.maxAttempts; }

  public directive(error: unknown, attempt: number): RecoveryDirective {
    const failureClass = classifyFailure(error);
    if (failureClass === 'cancelled' || failureClass === 'terminal') {
      return { failureClass, action: 'stop', delayMs: 0, reason: `non_retryable:${failureClass}` };
    }
    if (attempt >= this.#policy.maxAttempts) {
      return { failureClass, action: 'stop', delayMs: 0, reason: 'retry_budget_exhausted' };
    }
    const delayMs = Math.min(this.#policy.maxDelayMs, this.#policy.baseDelayMs * 2 ** Math.max(0, attempt - 1));
    if (failureClass === 'quota' || failureClass === 'rate_limit') {
      return {
        failureClass,
        action: attempt >= this.#policy.checkpointAfterAttempt ? 'checkpoint_and_retry' : 'failover',
        delayMs,
        reason: failureClass === 'rate_limit' ? 'rate_limit_backoff' : 'quota_requires_continuation',
      };
    }
    return {
      failureClass,
      action: attempt >= this.#policy.checkpointAfterAttempt ? 'checkpoint_and_retry' : 'retry',
      delayMs,
      reason: failureClass === 'temporary' ? 'transient_transport_failure' : 'unknown_retryable_failure',
    };
  }
}

export class ResilientGenerationRuntime implements GenerationRuntimeLike {
  readonly #planner: NeverStopPlanner;
  readonly #hooks: ResilienceHooks;

  public constructor(
    private readonly inner: GenerationRuntimeLike,
    policy: NeverStopPolicy = {},
    hooks: ResilienceHooks = {},
  ) {
    this.#planner = new NeverStopPlanner(policy);
    this.#hooks = hooks;
  }

  public async generate(request: PhoenixRequest, signal?: AbortSignal): Promise<PhoenixResponse> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.#planner.maxAttempts(); attempt += 1) {
      await this.#hooks.onAttempt?.({ attempt });
      try {
        return await this.inner.generate(request, signal);
      } catch (error) {
        lastError = error;
        const directive = this.#planner.directive(error, attempt);
        await this.#hooks.onAttempt?.({ attempt, directive });
        if (directive.action === 'stop') throw error;
        if (directive.action === 'checkpoint_and_retry') {
          await this.#hooks.checkpoint?.({ attempt, directive, error });
        }
        const sleep = this.#hooks.sleep ?? defaultSleep;
        await sleep(directive.delayMs, signal);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('PHOENIX resilience attempts exhausted');
  }
}
