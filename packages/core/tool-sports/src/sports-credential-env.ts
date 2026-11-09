/** Resolve credentials for sports tools per request without exposing the secret.
 * This is the Host vault's authoritative key, not the TheOddsAPI (no hyphen) key.
 */
import type { Context } from '@phoenix-ai/cordis'

/** Merge one trusted v4 provider credential into a private per-call environment.
 * @param ctx - Kira's host context (may not expose the optional credentials provider).
 * @param env - Existing nonsecret configuration and ambient environment.
 * @returns Private per-operation environment copy when vault has a key.
 */
export async function sportsEnvWithVaultKey(ctx: Context, env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  let vault: { resolve(ref: string): Promise<{ value: string } | undefined> } | undefined
  try {
    vault = (ctx.get as (name: string) => unknown)('credentials') as typeof vault
  } catch {
    return env
  }
  if (vault === undefined) return env
  const resolved = {...env}
  // Keys are kept in the Host vault and resolved on each tool invocation.
  // No secret is persisted into the sport UI, logs, snapshots or model prompts.
  for (const ref of ['THE_ODDS_API_KEY','THERUNDOWN_API_KEY','SPORTSGAMEODDS_API_KEY',
    'PHOENIX_API_FOOTBALL_KEY','PHOENIX_API_HOCKEY_KEY','PHOENIX_API_NFL_KEY',
    'PHOENIX_BIGBALLS_API_KEY','PHOENIX_NFLMETA_KEY','PHOENIX_SPORTMONKS_KEY']) {
    try {
      const saved = await vault.resolve(ref)
      if (typeof saved?.value === 'string' && saved.value.trim()) {
        resolved[ref] = saved.value
      }
    } catch {
      // A missing single vendor credential never disables the other sources.
    }
  }
  return resolved
}
