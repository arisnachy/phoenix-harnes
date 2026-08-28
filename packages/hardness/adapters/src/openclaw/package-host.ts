import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type {
  OpenClawCapabilityHost,
  OpenClawExecutionContext,
  OpenClawPreparationResult,
} from './broker.ts'
import { toPhoenixCapabilities } from './capabilities.ts'
import {
  OPENCLAW_DONOR_COMMIT,
  listOpenClawExtensions,
} from './catalog.ts'
import type { CompatibilityStatus } from './types.ts'

/** Exact OpenClaw core package version accepted by this donor snapshot. */
export const OPENCLAW_CORE_PACKAGE_SPEC = 'openclaw@2026.8.1' as const

/** Registration families admitted across the OpenClaw compatibility boundary. */
export type OpenClawRegistrationFamily =
  | 'agent-protocol'
  | 'memory'
  | 'device'
  | 'computer-use'
  | 'secrets'
  | 'work'
  | 'integration'
  | 'web-search'
  | 'document'
  | 'voice'
  | 'media'
  | 'observability'
  | 'coding'
  | 'channel'
  | 'provider'
  | 'extension'

/** Immutable package selector handed to the isolated installer. */
export interface OpenClawInstallCandidate {
  readonly extensionId: string
  readonly coreSpec: typeof OPENCLAW_CORE_PACKAGE_SPEC
  readonly pluginSelector: string
  readonly donorCommit: typeof OPENCLAW_DONOR_COMMIT
  readonly source: 'official-catalog'
  readonly registrationFamily: OpenClawRegistrationFamily
}

/** Runtime package returned only after an isolated installer validated it. */
export interface OpenClawPreparedPackage {
  readonly registrations: readonly OpenClawRegistrationFamily[]
  execute(args: unknown, context: OpenClawExecutionContext): Promise<ToolExecutionResult>
  deactivate(): Promise<void>
}

/** Installer-owned preparation result. */
export type OpenClawPackagePrepareResult =
  | { readonly kind: 'ready'; readonly package: OpenClawPreparedPackage }
  | {
    readonly kind: 'blocked'
    readonly status: CompatibilityStatus
    readonly reasons: readonly string[]
  }

/** Narrow effectful seam implemented by a sandbox/worker package installer. */
export interface OpenClawPackageInstaller {
  prepare(
    candidate: OpenClawInstallCandidate,
    signal: AbortSignal,
  ): Promise<OpenClawPackagePrepareResult>
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : String(error)
}

/** Translate the catalog capability kind into the package-host registration vocabulary. */
export function registrationFamilyForOpenClawExtension(extensionId: string): OpenClawRegistrationFamily {
  const capability = toPhoenixCapabilities({ id: extensionId })[0]
  if (capability === undefined) return 'extension'
  switch (capability.kind) {
    case 'model-provider':
    case 'local-inference':
      return 'provider'
    case 'agent-protocol':
    case 'memory':
    case 'device':
    case 'computer-use':
    case 'secrets':
    case 'work':
    case 'integration':
    case 'web-search':
    case 'document':
    case 'voice':
    case 'media':
    case 'observability':
    case 'coding':
    case 'channel':
    case 'extension':
      return capability.kind
  }
}

/** Resolve one donor id to an immutable, official package preparation request. */
export function resolveOpenClawInstallCandidate(extensionId: string): OpenClawInstallCandidate {
  if (!listOpenClawExtensions().some(entry => entry.id === extensionId)) {
    throw new Error(`unknown OpenClaw extension ${extensionId}`)
  }
  return {
    extensionId,
    coreSpec: OPENCLAW_CORE_PACKAGE_SPEC,
    pluginSelector: extensionId,
    donorCommit: OPENCLAW_DONOR_COMMIT,
    source: 'official-catalog',
    registrationFamily: registrationFamilyForOpenClawExtension(extensionId),
  }
}

/**
 * Phoenix-owned lifecycle for prepared OpenClaw packages.
 * The installer is deliberately injected: this class never reaches a mutable
 * remote source and never grants package code direct access to HARDNESS/ATLAS.
 */
export class OpenClawPackageHost implements OpenClawCapabilityHost {
  private readonly prepared = new Map<string, OpenClawPreparedPackage>()

  constructor(private readonly installer: OpenClawPackageInstaller) {}

  async prepare(extensionId: string, signal: AbortSignal): Promise<OpenClawPreparationResult> {
    if (this.prepared.has(extensionId)) return { kind: 'ready', extensionId }

    let candidate: OpenClawInstallCandidate
    try {
      candidate = resolveOpenClawInstallCandidate(extensionId)
    } catch (error) {
      return {
        kind: 'blocked',
        status: 'INCOMPATIBLE_CONTRACT',
        reasons: [errorText(error)],
      }
    }

    try {
      const result = await this.installer.prepare(candidate, signal)
      if (result.kind === 'blocked') {
        return {
          kind: 'blocked',
          status: result.status,
          reasons: [...result.reasons],
        }
      }

      if (!result.package.registrations.includes(candidate.registrationFamily)) {
        try {
          await result.package.deactivate()
        } catch {
          // The contract mismatch is authoritative; cleanup failure must not
          // accidentally make the incompatible package executable.
        }
        return {
          kind: 'blocked',
          status: 'INCOMPATIBLE_CONTRACT',
          reasons: [`extension ${extensionId} did not register required family ${candidate.registrationFamily}`],
        }
      }

      this.prepared.set(extensionId, result.package)
      return { kind: 'ready', extensionId }
    } catch (error) {
      return {
        kind: 'blocked',
        status: 'ACTIVATION_FAILED',
        reasons: [errorText(error)],
      }
    }
  }

  async execute(
    extensionId: string,
    args: unknown,
    context: OpenClawExecutionContext,
  ): Promise<ToolExecutionResult> {
    const runtime = this.prepared.get(extensionId)
    if (runtime === undefined) throw new Error(`OpenClaw extension ${extensionId} is not prepared`)
    return runtime.execute(args, context)
  }

  async deactivate(extensionId: string): Promise<void> {
    const runtime = this.prepared.get(extensionId)
    if (runtime === undefined) return
    this.prepared.delete(extensionId)
    await runtime.deactivate()
  }
}
