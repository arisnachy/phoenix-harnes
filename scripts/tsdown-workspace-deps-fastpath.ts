import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UserConfig } from 'tsdown'

interface PackageManifest {
  readonly dependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
}

interface TsdownConfigPlugin {
  readonly name: string
  readonly tsdownConfig: (config: UserConfig) => UserConfig | undefined
}

function escapeSpecifier(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Predeclare one package's production dependencies as Rolldown externals.
 *
 * tsdown 0.22.2 otherwise resolves every non-relative import first and only
 * then notices that dependencies/peers/optional deps must remain external.
 * Feeding the same decision through deps.neverBundle lets Rolldown short-circuit
 * those imports before the expensive tsdown:deps resolveId hook.
 *
 * Configs with an explicit dependency policy stay authoritative.
 */
export function workspaceDepsFastPathPlugin(): TsdownConfigPlugin {
  return {
    name: 'dsh-workspace-deps-fastpath',
    tsdownConfig(config) {
      if (config.platform !== 'node') return
      if (config.deps?.neverBundle !== undefined) return
      if (config.deps?.alwaysBundle !== undefined) return
      if (config.deps?.skipNodeModulesBundle === true) return
      if (config.external !== undefined || config.noExternal !== undefined) return
      if (config.dts !== undefined && config.dts !== false) return

      const cwd = config.cwd
      if (cwd === undefined) return
      const manifestPath = join(cwd, 'package.json')
      if (!existsSync(manifestPath)) return

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
      const names = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
      ])
      if (names.size === 0) return

      const neverBundle = [...names]
        .sort()
        .map(name => new RegExp(`^${escapeSpecifier(name)}(?:/|$)`))

      return { deps: { neverBundle } }
    },
  }
}
