/** TypeScript declaration for the ESM build guard used by Host compilation. */
export declare const CORDIS_TSDOWN_ENTRY_NAMES: readonly ['index', 'invariant', 'startup']

export declare function missingCordisTsdownEntries(
  root: string,
  exists?: (file: string) => boolean,
): string[]

/** Return missing Include plugin JavaScript/declaration entries on a cold runtime. */
export declare function missingIncludeTsdownEntries(
  root: string,
  exists?: (file: string) => boolean,
): string[]

export declare function ensureCordisTsdownEntries(
  root: string,
  options?: {
    exists?: (file: string) => boolean
    spawn?: (
      command: string,
      args: readonly string[],
      options: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'inherit'; windowsHide: boolean },
    ) => { readonly status: number | null; readonly signal?: string | null; readonly error?: Error }
    node?: string
    environment?: NodeJS.ProcessEnv
    log?: (message: string) => void
  },
): { readonly repaired: boolean; readonly missing: string[] }

/** Repair missing Include plugin entries before Host tsdown bundles them. */
export declare function ensureIncludeTsdownEntries(
  root: string,
  options?: {
    exists?: (file: string) => boolean
    spawn?: (
      command: string,
      args: readonly string[],
      options: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'inherit'; windowsHide: boolean },
    ) => { readonly status: number | null; readonly signal?: string | null; readonly error?: Error }
    node?: string
    environment?: NodeJS.ProcessEnv
    log?: (message: string) => void
  },
): { readonly repaired: boolean; readonly missing: string[] }
