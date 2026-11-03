/** Side-effect-free Godot routing and setup helpers. */
export declare function route(genre: string, delivery: 'chat' | 'desktop' | 'web', quality: 'prototype' | 'production'): {
  genre: string
  delivery: string
  quality: string
  engine: string
  authoringEngine: string
  tools: string[]
  action: string
  renderer: string
  authoringRule: string
  godotWebNote?: string
  gate: string
}
export declare function installation(target: string, platform: string): { command: string; args: string[] }
export declare function windowsGodotCandidates(env?: NodeJS.ProcessEnv): string[]
