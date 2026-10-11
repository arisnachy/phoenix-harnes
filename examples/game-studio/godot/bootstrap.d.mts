/** Godot authoring CLI used by Phoenix Game Studio. */
export declare const GODOT_STARTER_FILES: readonly string[]
export declare function godotInvocation(inspection: { ready?: boolean; command?: string; version?: string }): {
  bin: string
  prefix: string[]
}
export declare function scaffoldGodotProject(project: string, options?: {
  exists?: (path: string) => boolean
  mkdir?: (path: string, options: { recursive: true }) => unknown
  read?: (path: string) => Uint8Array | string
  list?: (path: string) => string[]
  write?: (path: string, data: Uint8Array | string, options: { flag: 'wx' }) => unknown
}): { project: string; created: boolean; reused: boolean; files?: string[] }
export declare function verifyGodotProject(
  project: string,
  inspection: { ready?: boolean; command?: string; version?: string },
  run?: (command: string, args: string[]) => string,
  exists?: (path: string) => boolean,
): { project: string; verified: boolean; checks: string[]; artwork: string }
