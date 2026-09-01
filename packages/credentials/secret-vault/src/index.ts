/** Human-only secret entry point over the PHOENIX credential provider. */

import type { Context } from '@phoenix-ai/cordis'
import { credentialRef, isCredentialRefName } from '@phoenix-ai/dsh-credentials'
import type { CommandResult } from '@phoenix-ai/dsh-commands'

/** Plugin id used by the base bundle and loader inventory. */
export const name = 'secret-vault'
/** The vault command waits for both the command and credential seams. */
export const inject = ['commands', 'credentials']

const USAGE = 'Usage: /secret <set|delete|status> <NAME> [VALUE]'
const INPUT = /^(set|delete|status)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+([\s\S]*))?$/u

/** Return a stable command error without reflecting a secret or provider detail. */
function failure(text: string): CommandResult {
  return { kind: 'error', text }
}

/** Register the human-only `/secret` command. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    name: 'secret',
    description: 'Store or inspect a secret without sending its value to the model',
    input: { hint: '<set|delete|status> <NAME> [VALUE]' },
    // The raw value is intentionally never written to command/run. The command
    // is admitted before model dispatch and its lifecycle is log-only.
    recordInput: false,
    handler: async ({ rawInput }) => {
      const parsed = INPUT.exec(rawInput.trim())
      if (parsed === null) return failure(USAGE)
      const operation = parsed[1]
      const rawName = parsed[2]
      if (operation === undefined || rawName === undefined || !isCredentialRefName(rawName)) {
        return failure(`Secret name must match a POSIX environment name. ${USAGE}`)
      }
      const ref = credentialRef(rawName)
      try {
        if (operation === 'set') {
          const value = parsed[3]
          if (value === undefined || value.length === 0) return failure(`Secret value is required. ${USAGE}`)
          await ctx.credentials.set(ref, value)
          return { kind: 'success', text: `Secret ${rawName} stored securely.` }
        }
        if (operation === 'delete') {
          await ctx.credentials.unset(ref)
          return { kind: 'success', text: `Secret ${rawName} removed.` }
        }
        const info = await ctx.credentials.describe(ref)
        return {
          kind: 'success',
          text: info.configured
            ? `Secret ${rawName} is configured${info.source === undefined ? '' : ` from ${info.source}`}.`
            : `Secret ${rawName} is not configured.`,
        }
      } catch {
        // Provider diagnostics can contain deployment-specific paths or input
        // echoes. The human command exposes a stable safe message instead.
        return failure(`Secret ${rawName} could not be updated. Check the vault configuration.`)
      }
    },
  }), 'secret-vault command')
}
