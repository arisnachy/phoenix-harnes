import type { CapabilityExecutor } from '../execution-bridge.ts'
import { OpenClawCapabilityBroker } from './broker.ts'
import {
  OpenClawPackageHost,
  type OpenClawPackageInstaller,
  type OpenClawPackagePrepareResult,
} from './package-host.ts'

/** Production OpenClaw bridge owned by PHOENIX HARDNESS. */
export interface OpenClawProductionBridge {
  readonly broker: OpenClawCapabilityBroker
  readonly executor: CapabilityExecutor
}

const MISSING_INSTALLER_REASON = 'PHOENIX requires an isolated OpenClaw package installer before cataloged donor extensions can execute'

const missingInstaller: OpenClawPackageInstaller = {
  prepare: async (): Promise<OpenClawPackagePrepareResult> => ({
    kind: 'blocked',
    status: 'MISSING_DEPENDENCY',
    reasons: [MISSING_INSTALLER_REASON],
  }),
}

/**
 * Create the explicit production bridge from HARDNESS acquisition to the
 * OpenClaw package host and external executor. When no isolated installer is
 * supplied the bridge remains present but fails closed with a concrete
 * diagnostic, so catalog metadata can never masquerade as executable runtime.
 * @param installer - optional PHOENIX-owned isolated package installer.
 * @returns broker used for acquisition and the same governed executor surface.
 */
export function createOpenClawProductionBridge(
  installer: OpenClawPackageInstaller = missingInstaller,
): OpenClawProductionBridge {
  const host = new OpenClawPackageHost(installer)
  const broker = new OpenClawCapabilityBroker(host)
  return Object.freeze({ broker, executor: broker })
}
