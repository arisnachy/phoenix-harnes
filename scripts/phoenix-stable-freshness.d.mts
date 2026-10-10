/** A tiny injectable Git process contract for unit testing release freshness. */
export interface StableGitProcessResult {
  status: number | null
  stdout?: string | Buffer
  stderr?: string | Buffer
  error?: Error
}
export type StableGitCommand = (
  command: string,
  args: readonly string[],
  options: Record<string, unknown>,
) => StableGitProcessResult

/** Fail closed if a staged runtime is not the release currently promoted by GitHub. */
export function assertPromotedStableTarget(
  root: string,
  target: string,
  branch?: string,
  execute?: StableGitCommand,
): string
