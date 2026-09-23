/** Shipped tool-goal entrypoint: canonical goal tools plus Quality/Foresight controls. */

import type { Context } from '@phoenix-ai/cordis'
import { apply as applyGoal } from './index.ts'
import type { Config } from './index.ts'
import { registerQualityTools } from './quality-tools.ts'

export * from './index.ts'

/** Mount the existing goal tool surface, then the durable quality controls. */
export function apply(ctx: Context, config: Config): void {
  applyGoal(ctx, config)
  registerQualityTools(ctx)
}
