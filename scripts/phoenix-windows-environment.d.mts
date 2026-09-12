export declare const PHOENIX_USER_ENV_KEYS: readonly ['GOOGLE_OAUTH_ACCESS_TOKEN']

export declare function readWindowsUserEnvironment(
  name: string,
  options?: {
    platform?: string
    run?: (command: string, args: string[]) => { status: number | null, stdout?: string | Buffer }
  },
): string | undefined

export declare function hydratePhoenixEnvironment(
  parentEnvironment: NodeJS.ProcessEnv,
  options?: {
    platform?: string
    readUserValue?: (name: string) => string | undefined
  },
): NodeJS.ProcessEnv
