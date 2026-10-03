export declare function normalizeCodexUpdateMode(value: string): 'auto' | 'notify' | 'off'
export declare function parseStableVersion(value: string): {
  text: string
  parts: [number, number, number]
}
export declare function compareStableVersions(left: string, right: string): -1 | 0 | 1
export declare function readActiveCodexRuntime(home: string): {
  version: string
  bin: string
} | undefined
export declare function pruneManagedCodexVersions(home: string, activeVersion: string): { removed: number }
