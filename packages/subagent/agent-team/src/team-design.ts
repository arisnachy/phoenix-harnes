/** Durable customization store for Phoenix Team Studio. */

import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import { settingsNamespace, type SettingsScope } from '@phoenix-ai/dsh-settings'
import {
  DEFAULT_TEAM_DESIGN_JSON,
  TEAM_DESIGN_SETTINGS_NAMESPACE,
  activeTeamDesign,
  normalizeTeamDesignDocument,
  parseTeamDesignDocument,
  type TeamDesign,
  type TeamDesignDocument,
  type TeamDesignSettingsEnvelope,
} from './design-types.ts'

const NAMESPACE = settingsNamespace(TEAM_DESIGN_SETTINGS_NAMESPACE)

export const TeamDesignSettingsSchema: z<TeamDesignSettingsEnvelope> = z.object({
  document: z.string().default(DEFAULT_TEAM_DESIGN_JSON),
})

/**
 * Settings-backed Team Studio state.
 *
 * One JSON scalar makes a complete team switch atomic on the wire: the user
 * never observes half of one generated roster mixed with half of another.
 */
export class TeamDesignRuntime {
  private memory: TeamDesignSettingsEnvelope = { document: DEFAULT_TEAM_DESIGN_JSON }
  private scope: SettingsScope<TeamDesignSettingsEnvelope> | undefined

  constructor(ctx: Context) {
    ctx.inject(['settings'], (sctx) => {
      const scope = sctx.settings.register(NAMESPACE, TeamDesignSettingsSchema, {
        base: { document: DEFAULT_TEAM_DESIGN_JSON },
      })
      this.scope = scope
      this.memory = scope.get()
      const stop = scope.watch((next) => { this.memory = next })
      sctx.effect(() => () => {
        stop()
        this.memory = scope.get()
        if (this.scope === scope) this.scope = undefined
      }, 'agent-team: Team Studio settings')
    })
  }

  /** Current normalized multi-team document. */
  get(): TeamDesignDocument {
    return parseTeamDesignDocument(this.memory.document)
  }

  /** Current team selected by the user. */
  active(): TeamDesign {
    return activeTeamDesign(this.get())
  }

  /** Persist a complete normalized document, or keep it process-local without a settings provider. */
  async replace(document: TeamDesignDocument): Promise<TeamDesignDocument> {
    const normalized = normalizeTeamDesignDocument(document)
    const envelope = { document: JSON.stringify(normalized) }
    this.memory = envelope
    if (this.scope !== undefined) await this.scope.replace(envelope)
    return normalized
  }
}
