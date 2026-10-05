export interface PhoenixDesktopShortcutSpec {
  readonly root: string
  readonly sourceRoot: string
  readonly setupScript: string
  readonly launchScript: string
  readonly iconSource: string
  readonly powershell: string
}

export interface EnsurePhoenixDesktopShortcutOptions {
  readonly platform?: string
  readonly env?: NodeJS.ProcessEnv
  readonly existsSync?: (path: string) => boolean
  readonly spawnSync?: typeof import('node:child_process').spawnSync
  readonly sourceRoot?: string
}

export type EnsurePhoenixDesktopShortcutResult =
  | { readonly status: 'skipped-non-windows' }
  | { readonly status: 'ready'; readonly shortcut?: string }

export function phoenixDesktopShortcutSpec(
  root: string,
  env?: NodeJS.ProcessEnv,
  sourceRoot?: string,
): PhoenixDesktopShortcutSpec

export function ensurePhoenixDesktopShortcut(
  root: string,
  options?: EnsurePhoenixDesktopShortcutOptions,
): EnsurePhoenixDesktopShortcutResult
