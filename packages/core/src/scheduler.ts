import { randomUUID } from 'node:crypto';

export interface ScheduledMission {
  id: string;
  handler: string;
  payload: Record<string, unknown>;
  runAt: string;
  intervalMs?: number;
  enabled: boolean;
}

export type MissionHandler = (mission: ScheduledMission) => Promise<void>;

export class LocalScheduler {
  readonly #missions = new Map<string, ScheduledMission>();
  readonly #handlers = new Map<string, MissionHandler>();
  #timer: NodeJS.Timeout | undefined;

  public registerHandler(name: string, handler: MissionHandler): void {
    this.#handlers.set(name, handler);
  }

  public schedule(input: Omit<ScheduledMission, 'id' | 'enabled'> & { id?: string; enabled?: boolean }): ScheduledMission {
    const mission: ScheduledMission = {
      id: input.id ?? randomUUID(),
      handler: input.handler,
      payload: { ...input.payload },
      runAt: input.runAt,
      ...(input.intervalMs !== undefined ? { intervalMs: input.intervalMs } : {}),
      enabled: input.enabled ?? true,
    };
    this.#missions.set(mission.id, mission);
    return mission;
  }

  public missions(): readonly ScheduledMission[] {
    return [...this.#missions.values()].sort((a, b) => a.runAt.localeCompare(b.runAt));
  }

  public cancel(id: string): boolean {
    return this.#missions.delete(id);
  }

  public async tick(now = new Date()): Promise<readonly string[]> {
    const completed: string[] = [];
    const nowMs = now.getTime();
    for (const mission of this.missions()) {
      if (!mission.enabled || new Date(mission.runAt).getTime() > nowMs) continue;
      const handler = this.#handlers.get(mission.handler);
      if (!handler) throw new Error(`No scheduler handler registered: ${mission.handler}`);
      await handler(mission);
      completed.push(mission.id);
      if (mission.intervalMs && mission.intervalMs > 0) {
        const next: ScheduledMission = {
          ...mission,
          runAt: new Date(nowMs + mission.intervalMs).toISOString(),
        };
        this.#missions.set(mission.id, next);
      } else {
        this.#missions.delete(mission.id);
      }
    }
    return completed;
  }

  public start(pollMs = 1000): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      void this.tick().catch(() => {
        // The caller owns telemetry/retry policy; the scheduler keeps running.
      });
    }, pollMs);
    this.#timer.unref();
  }

  public stop(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
