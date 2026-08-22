import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type MissionStatus = 'created' | 'running' | 'paused' | 'completed' | 'failed';

export interface ProviderSessionSnapshot {
  providerId: string;
  sessionId: string;
  modelId?: string;
}

export interface MissionTokenSnapshot {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  avoidedInputTokens?: number;
}

export interface MissionCheckpoint {
  id: string;
  createdAt: string;
  label?: string;
  nextAction?: string;
  workspace?: {
    path?: string;
    gitHead?: string;
    branch?: string;
    dirty?: boolean;
  };
  providerSessions: readonly ProviderSessionSnapshot[];
  contextFingerprints: readonly string[];
  tokenSnapshot?: MissionTokenSnapshot;
  state?: Record<string, unknown>;
}

export interface DurableMission {
  id: string;
  title: string;
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
  parentMissionId?: string;
  objective?: string;
  checkpoints: readonly MissionCheckpoint[];
  metadata?: Record<string, string>;
}

export interface CheckpointInput {
  label?: string;
  nextAction?: string;
  workspace?: MissionCheckpoint['workspace'];
  providerSessions?: readonly ProviderSessionSnapshot[];
  contextFingerprints?: readonly string[];
  tokenSnapshot?: MissionTokenSnapshot;
  state?: Record<string, unknown>;
}

function now(): string {
  return new Date().toISOString();
}

function safeMissionId(id: string): string {
  if (!/^[a-zA-Z0-9._:-]+$/.test(id)) throw new Error(`Invalid mission id: ${id}`);
  return id;
}

export class RebirthStore {
  public constructor(public readonly root = '.phoenix/missions') {}

  private pathFor(id: string): string {
    return join(this.root, `${safeMissionId(id)}.json`);
  }

  private async persist(mission: DurableMission): Promise<void> {
    const path = this.pathFor(mission.id);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(mission, null, 2)}\n`, 'utf8');
  }

  public async create(input: { id?: string; title: string; objective?: string; metadata?: Record<string, string> }): Promise<DurableMission> {
    const timestamp = now();
    const mission: DurableMission = {
      id: input.id ?? randomUUID(),
      title: input.title,
      status: 'created',
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(input.objective ? { objective: input.objective } : {}),
      checkpoints: [],
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    await this.persist(mission);
    return mission;
  }

  public async load(id: string): Promise<DurableMission> {
    const raw = await readFile(this.pathFor(id), 'utf8');
    return JSON.parse(raw) as DurableMission;
  }

  public async checkpoint(id: string, input: CheckpointInput = {}): Promise<MissionCheckpoint> {
    const mission = await this.load(id);
    const checkpoint: MissionCheckpoint = {
      id: randomUUID(),
      createdAt: now(),
      ...(input.label ? { label: input.label } : {}),
      ...(input.nextAction ? { nextAction: input.nextAction } : {}),
      ...(input.workspace ? { workspace: input.workspace } : {}),
      providerSessions: [...(input.providerSessions ?? [])],
      contextFingerprints: [...(input.contextFingerprints ?? [])],
      ...(input.tokenSnapshot ? { tokenSnapshot: input.tokenSnapshot } : {}),
      ...(input.state ? { state: input.state } : {}),
    };
    const updated: DurableMission = {
      ...mission,
      status: mission.status === 'created' ? 'running' : mission.status,
      updatedAt: now(),
      checkpoints: [...mission.checkpoints, checkpoint],
    };
    await this.persist(updated);
    return checkpoint;
  }

  public async latestCheckpoint(id: string): Promise<MissionCheckpoint | undefined> {
    const mission = await this.load(id);
    return mission.checkpoints.at(-1);
  }

  public async setStatus(id: string, status: MissionStatus): Promise<DurableMission> {
    const mission = await this.load(id);
    const updated = { ...mission, status, updatedAt: now() };
    await this.persist(updated);
    return updated;
  }

  public async fork(id: string, input: { id?: string; title?: string; metadata?: Record<string, string> } = {}): Promise<DurableMission> {
    const parent = await this.load(id);
    const timestamp = now();
    const child: DurableMission = {
      id: input.id ?? randomUUID(),
      title: input.title ?? `${parent.title} (fork)`,
      status: 'paused',
      createdAt: timestamp,
      updatedAt: timestamp,
      parentMissionId: parent.id,
      ...(parent.objective ? { objective: parent.objective } : {}),
      checkpoints: parent.checkpoints.map((checkpoint) => ({
        ...checkpoint,
        providerSessions: checkpoint.providerSessions.map((item) => ({ ...item })),
        contextFingerprints: [...checkpoint.contextFingerprints],
      })),
      metadata: { ...(parent.metadata ?? {}), ...(input.metadata ?? {}) },
    };
    await this.persist(child);
    return child;
  }

  public async rebirth(id: string): Promise<{
    mission: DurableMission;
    checkpoint?: MissionCheckpoint;
    providerSessions: ReadonlyMap<string, ProviderSessionSnapshot>;
    knownContextFingerprints: ReadonlySet<string>;
  }> {
    const mission = await this.load(id);
    const checkpoint = mission.checkpoints.at(-1);
    const sessions = new Map<string, ProviderSessionSnapshot>();
    for (const item of checkpoint?.providerSessions ?? []) sessions.set(item.providerId, { ...item });
    return {
      mission,
      ...(checkpoint ? { checkpoint } : {}),
      providerSessions: sessions,
      knownContextFingerprints: new Set(checkpoint?.contextFingerprints ?? []),
    };
  }
}
