/** Executable path and arguments used by the Phoenix web npm script. */
export interface PhoenixWebLaunch {
  readonly cwd: string
  readonly args: string[]
}

/** Choose the native supervisor on Windows and keep the CLI on other platforms. */
export declare function phoenixWebLaunch(platform?: string, forwarded?: string[]): PhoenixWebLaunch
