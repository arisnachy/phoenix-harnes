/** Human-only secret entry point over the PHOENIX credential provider. */

import type { Context } from '@phoenix-ai/cordis'
import {
  credentialRef,
  isCredentialRefName,
  normalizeCredentialOrigin,
  originCredentialRef,
} from '@phoenix-ai/dsh-credentials'
import type { CommandResult } from '@phoenix-ai/dsh-commands'

/** Plugin id used by the base bundle and loader inventory. */
export const name = 'secret-vault'
/** The vault command waits for both the command and credential seams. */
export const inject = ['commands', 'credentials']

const USAGE = 'Usage: /secret <set|delete|status> <NAME> [VALUE] | /secret <login-set|login-delete|login-status> <ORIGIN> [ACCOUNT] [SECRET]'
const INPUT = /^(set|delete|status)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+([\s\S]*))?$/u
const LOGIN_INPUT = /^(login-set|login-delete|login-status)\s+(\S+)(?:\s+(\S+)(?:\s+([\s\S]+))?)?$/u

/** Return a stable command error without reflecting a secret or provider detail. */
function failure(text: string): CommandResult {
  return { kind: 'error', text }
}

function loginRefs(origin: string) {
  return {
    account: originCredentialRef(origin, 'account'),
    secret: originCredentialRef(origin, 'secret'),
    autonomous: originCredentialRef(origin, 'autonomous'),
  }
}

async function handleLogin(ctx: Context, parsed: RegExpExecArray): Promise<CommandResult> {
  const operation = parsed[1]
  const rawOrigin = parsed[2]
  if (operation === undefined || rawOrigin === undefined) return failure(USAGE)

  let origin: string
  try {
    origin = normalizeCredentialOrigin(rawOrigin)
  } catch {
    return failure('Login origin must be HTTPS (loopback HTTP is allowed).')
  }
  const refs = loginRefs(origin)

  try {
    if (operation === 'login-set') {
      const account = parsed[3]
      const secret = parsed[4]
      if (account === undefined || account.length === 0 || secret === undefined || secret.length === 0) {
        return failure(`Account and login secret are required. ${USAGE}`)
      }

      const infos = await Promise.all([
        ctx.credentials.describe(refs.account),
        ctx.credentials.describe(refs.secret),
        ctx.credentials.describe(refs.autonomous),
      ])
      if (infos.some(info => !info.writable)) {
        return failure(`Login for ${origin} cannot be stored because one of its vault slots is read-only.`)
      }

      await ctx.credentials.set(refs.account, account)
      await ctx.credentials.set(refs.secret, secret)
      // This origin-bound marker is the user's one-time authorization for
      // unattended login and form work on this exact origin.
      await ctx.credentials.set(refs.autonomous, '1')
      return { kind: 'success', text: `Login for ${origin} stored for unattended Phoenix browser use.` }
    }

    if (operation === 'login-delete') {
      await ctx.credentials.unset(refs.account)
      await ctx.credentials.unset(refs.secret)
      await ctx.credentials.unset(refs.autonomous)
      return { kind: 'success', text: `Login for ${origin} removed.` }
    }

    const [account, secret, autonomous] = await Promise.all([
      ctx.credentials.describe(refs.account),
      ctx.credentials.describe(refs.secret),
      ctx.credentials.describe(refs.autonomous),
    ])
    return {
      kind: 'success',
      text: account.configured && secret.configured && autonomous.configured
        ? `Login for ${origin} is configured for unattended Phoenix browser use.`
        : `Login for ${origin} is not fully configured.`,
    }
  } catch {
    return failure(`Login for ${origin} could not be updated. Check the vault configuration.`)
  }
}

/** Register the human-only `/secret` command. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    name: 'secret',
    description: 'Store or inspect a secret without sending its value to the model',
    input: { hint: '<set|delete|status|login-set|login-delete|login-status> …' },
    // The raw value is intentionally never written to command/run. The command
    // is admitted before model dispatch and its lifecycle is log-only.
    recordInput: false,
    handler: async ({ rawInput }) => {
      const trimmed = rawInput.trim()
      const login = LOGIN_INPUT.exec(trimmed)
      if (login !== null) return await handleLogin(ctx, login)

      const parsed = INPUT.exec(trimmed)
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
        return failure(`Secret ${rawName} could not be updated. Check the vault configuration.`)
      }
    },
  }), 'secret-vault command')
}
