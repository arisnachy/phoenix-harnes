export interface WindowsFreeCapabilityReport {
  schemaVersion: number
  platform: string
  probe: 'completed' | 'unavailable'
  reason: string | null
  windows: { caption: string | null; build: number | null; windows11: boolean }
  hardware: { memoryGiB: number | null; graphicsAdapters: string[]; acceleration: string }
  executables: Record<'winget' | 'wsl' | 'ollama' | 'foundry' | 'pwsh', boolean>
  features: { packageInventory: string; windowsSubsystemForLinux: string; localInference: string; nativeNotifications: string; windowsAI: string; mxc: string }
}
export function probeWindowsFreeCapabilities(options?: {
  platform?: string
  nodeVersion?: string
  spawn?: (command: string, args: string[], options?: unknown) => { status: number | null; stdout?: string | Buffer; stderr?: string; error?: Error }
}): WindowsFreeCapabilityReport
