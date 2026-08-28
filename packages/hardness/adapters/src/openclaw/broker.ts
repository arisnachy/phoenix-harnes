import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  CapabilityDescriptor,
  CapabilityNeed,
  CapabilitySurface,
} from '@deepseek-ai/dsh-hardness'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { toHardnessCapabilityDescriptors } from './hardness.ts'
import type { CompatibilityStatus } from './types.ts'

/** Context forwarded to an isolated OpenClaw execution host. */
export interface OpenClawExecutionContext {
  readonly callId: CallId
  readonly signal: AbortSignal
  readonly agent?: Agent
}

/** Successful or blocked preparation of one pinned OpenClaw extension. */
export type OpenClawPreparationResult =
  | { readonly kind: 'ready'; readonly extensionId: string }
  | {
    readonly kind: 'blocked'
    readonly status: CompatibilityStatus
    readonly reasons: readonly string[]
  }

/** Narrow execution host used by HARDNESS; it does not own ATLAS or policy. */
export interface OpenClawCapabilityHost {
  prepare(extensionId: string, signal: AbortSignal): Promise<OpenClawPreparationResult>
  execute(
    extensionId: string,
    args: unknown,
    context: OpenClawExecutionContext,
  ): Promise<ToolExecutionResult>
  deactivate(extensionId: string): Promise<void>
}

/** Last compatibility diagnostic retained for a candidate rejected during preparation. */
export interface OpenClawBrokerDiagnostic {
  readonly status: CompatibilityStatus
  readonly reasons: readonly string[]
}

function candidateMatches(descriptor: CapabilityDescriptor, need: CapabilityNeed): boolean {
  if (need.kind !== undefined && descriptor.kind !== need.kind) return false
  return true
}

function extensionIdFromCapability(capabilityId: string): string | undefined {
  if (!capabilityId.startsWith('openclaw:')) return undefined
  const extensionId = capabilityId.slice('openclaw:'.length)
  return extensionId.length > 0 ? extensionId : undefined
}

/**
 * Turns the metadata-only OpenClaw catalog into a lazy HARDNESS acquisition
 * source while keeping preparation and execution behind a narrow host seam.
 */
export class OpenClawCapabilityBroker {
  private readonly diagnosticsById = new Map<string, OpenClawBrokerDiagnostic>()
  private readonly candidates: readonly CapabilityDescriptor[]

  constructor(
    private readonly host: OpenClawCapabilityHost,
    candidates: readonly CapabilityDescriptor[] = toHardnessCapabilityDescriptors(),
  ) {
    this.candidates = [...candidates].sort((left, right) => left.id.localeCompare(right.id))
  }

  /** Return whether this broker owns a projected HARDNESS execution surface. */
  supports(surface: CapabilitySurface): boolean {
    return extensionIdFromCapability(surface.capabilityId) !== undefined
  }

  /** Return the last blocked preparation diagnostic for an extension. */
  diagnostics(extensionId: string): OpenClawBrokerDiagnostic | undefined {
    return this.diagnosticsById.get(extensionId)
  }

  /**
   * Prepare the first deterministic OpenClaw candidate that can satisfy the
   * declared need. Preparation is lazy and never marks the capability verified.
   */
  async acquire(need: CapabilityNeed, signal: AbortSignal): Promise<CapabilityDescriptor | undefined> {
    const candidates = this.candidates.filter(descriptor => candidateMatches(descriptor, need))
    for (const descriptor of candidates) {
      const extensionId = extensionIdFromCapability(descriptor.id)
      if (extensionId === undefined) continue
      try {
        const result = await this.host.prepare(extensionId, signal)
        if (result.kind === 'ready') {
          this.diagnosticsById.delete(extensionId)
          return descriptor
        }
        this.diagnosticsById.set(extensionId, {
          status: result.status,
          reasons: [...result.reasons],
        })
      } catch (error) {
        this.diagnosticsById.set(extensionId, {
          status: 'ACTIVATION_FAILED',
          reasons: [error instanceof Error ? error.message : String(error)],
        })
      }
    }
    return undefined
  }

  /** Execute an OpenClaw capability through the prepared isolated host. */
  async execute(
    surface: CapabilitySurface,
    args: unknown,
    context: OpenClawExecutionContext,
  ): Promise<ToolExecutionResult> {
    const extensionId = extensionIdFromCapability(surface.capabilityId)
    if (extensionId === undefined) {
      throw new Error(`not an OpenClaw capability: ${surface.capabilityId}`)
    }
    return this.host.execute(extensionId, args, context)
  }
}
