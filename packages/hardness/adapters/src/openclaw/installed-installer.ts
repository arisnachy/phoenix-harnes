import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { OpenClawExecutionContext } from './broker.ts'
import {
  type OpenClawInstallCandidate,
  type OpenClawPackageInstaller,
  type OpenClawPackagePrepareResult,
  type OpenClawRegistrationFamily,
} from './package-host.ts'

const OPENCLAW_VERSION = '2026.8.1' as const
const requireFromWorkspace = createRequire(resolve(process.cwd(), 'package.json'))

/** Exact already-installed package resolved without evaluating donor code. */
export interface InstalledOpenClawPackageLocation {
  readonly packageRoot: string
  readonly entryPath: string
  readonly version: string
}

/** Pure locator seam; implementations must not install or import donor code. */
export type InstalledOpenClawPackageLocator = (
  candidate: OpenClawInstallCandidate,
  signal: AbortSignal,
) => Promise<InstalledOpenClawPackageLocation | undefined>

/** Request executed only after the normal PHOENIX approval bridge authorizes it. */
export interface OpenClawIsolatedExecutionRequest {
  readonly extensionId: string
  readonly registrationFamily: OpenClawRegistrationFamily
  readonly packageRoot: string
  readonly entryPath: string
  readonly args: unknown
  readonly callId: string
}

/** Isolated donor-code runner owned by PHOENIX. */
export interface OpenClawIsolatedRunner {
  execute(request: OpenClawIsolatedExecutionRequest, signal: AbortSignal): Promise<ToolExecutionResult>
}

type PackageJson = {
  readonly version?: unknown
  readonly openclaw?: {
    readonly extensions?: unknown
  }
}

function packageSpecifiers(extensionId: string): readonly string[] {
  return [
    `@openclaw/${extensionId}`,
    `@openclaw/${extensionId}-plugin`,
    'openclaw',
  ]
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function resolvePackageJson(specifier: string): string | undefined {
  try {
    return requireFromWorkspace.resolve(`${specifier}/package.json`)
  } catch {
    try {
      const entry = requireFromWorkspace.resolve(specifier)
      let root = dirname(entry)
      for (let depth = 0; depth < 8; depth += 1) {
        const packageJson = resolve(root, 'package.json')
        try {
          requireFromWorkspace(packageJson)
          return packageJson
        } catch {
          const parent = dirname(root)
          if (parent === root) break
          root = parent
        }
      }
      return undefined
    } catch {
      return undefined
    }
  }
}

function declaredEntries(value: PackageJson): readonly string[] {
  const entries = value.openclaw?.extensions
  return Array.isArray(entries) ? entries.filter((entry): entry is string => typeof entry === 'string') : []
}

function entryCandidates(packageRoot: string, extensionId: string, manifest: PackageJson): readonly string[] {
  const declared = declaredEntries(manifest).flatMap(entry => {
    const normalized = entry.replace(/^\.\//u, '')
    const withoutTs = normalized.replace(/\.ts$/u, '.js')
    return [resolve(packageRoot, normalized), resolve(packageRoot, withoutTs)]
  })
  return [
    ...declared,
    resolve(packageRoot, 'dist', 'extensions', extensionId, 'index.js'),
    resolve(packageRoot, 'dist', 'extensions', extensionId, 'index.mjs'),
    resolve(packageRoot, 'extensions', extensionId, 'index.js'),
    resolve(packageRoot, 'dist', 'index.js'),
    resolve(packageRoot, 'index.js'),
  ]
}

/**
 * Locate a donor package that is already installed in the PHOENIX execution world.
 * This function performs metadata/filesystem inspection only; it never imports the package,
 * reaches the network, or mutates node_modules.
 */
export const locateInstalledOpenClawPackage: InstalledOpenClawPackageLocator = async (candidate, signal) => {
  if (signal.aborted) return undefined
  for (const specifier of packageSpecifiers(candidate.extensionId)) {
    const packageJsonPath = resolvePackageJson(specifier)
    if (packageJsonPath === undefined) continue
    let parsed: PackageJson
    try {
      parsed = JSON.parse(await readFile(packageJsonPath, 'utf8')) as PackageJson
    } catch {
      continue
    }
    if (typeof parsed.version !== 'string') continue
    const packageRoot = dirname(packageJsonPath)
    for (const entryPath of entryCandidates(packageRoot, candidate.extensionId, parsed)) {
      if (signal.aborted) return undefined
      if (await exists(entryPath)) {
        return Object.freeze({ packageRoot, entryPath, version: parsed.version })
      }
    }
  }
  return undefined
}

/**
 * Concrete production installer that admits only an exact, already-installed donor.
 * Preparation cannot download packages or execute donor code. Actual donor execution
 * is deferred to the isolated runner, which is reached only after normal capability approval.
 */
export class InstalledOpenClawPackageInstaller implements OpenClawPackageInstaller {
  constructor(
    private readonly locator: InstalledOpenClawPackageLocator = locateInstalledOpenClawPackage,
    private readonly runner?: OpenClawIsolatedRunner,
  ) {}

  async prepare(
    candidate: OpenClawInstallCandidate,
    signal: AbortSignal,
  ): Promise<OpenClawPackagePrepareResult> {
    if (signal.aborted) {
      return { kind: 'blocked', status: 'POLICY_BLOCKED', reasons: ['OpenClaw preparation cancelled'] }
    }

    const location = await this.locator(candidate, signal)
    if (location === undefined) {
      return {
        kind: 'blocked',
        status: 'MISSING_DEPENDENCY',
        reasons: [`extension ${candidate.extensionId} requires an already-installed OpenClaw ${OPENCLAW_VERSION} package; PHOENIX will not download donor code during a mission`],
      }
    }
    if (location.version !== OPENCLAW_VERSION) {
      return {
        kind: 'blocked',
        status: 'INCOMPATIBLE_CONTRACT',
        reasons: [`extension ${candidate.extensionId} resolved OpenClaw package version ${location.version}; exact ${OPENCLAW_VERSION} is required`],
      }
    }
    if (this.runner === undefined) {
      return {
        kind: 'blocked',
        status: 'MISSING_DEPENDENCY',
        reasons: ['PHOENIX isolated OpenClaw runner is unavailable; refusing in-process donor execution'],
      }
    }

    const runner = this.runner
    return {
      kind: 'ready',
      package: Object.freeze({
        registrations: Object.freeze([candidate.registrationFamily]),
        execute: async (args: unknown, context: OpenClawExecutionContext): Promise<ToolExecutionResult> => runner.execute({
          extensionId: candidate.extensionId,
          registrationFamily: candidate.registrationFamily,
          packageRoot: location.packageRoot,
          entryPath: location.entryPath,
          args,
          callId: String(context.callId),
        }, context.signal),
        deactivate: async () => {},
      }),
    }
  }
}
