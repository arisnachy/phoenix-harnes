/** Evidence-backed quality readiness and foresight contract for PHOENIX missions. @module @phoenix-ai/dsh-quality */

import { Context, Service } from '@phoenix-ai/cordis'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type {
  QualityAssessmentRef, QualityAssessmentSnapshot, QualityMutation, StartQualityAssessmentRequest,
} from './types.ts'

export * from './types.ts'
export * from './readiness.ts'

declare module '@phoenix-ai/cordis' {
  interface Context {
    quality: QualityService
  }
}

/** Service Definition for durable, revision-bound mission quality assessments. */
export abstract class QualityService extends Service {
  constructor(ctx: Context) {
    if (new.target === QualityService) {
      throw new Error('@phoenix-ai/dsh-quality is a Service Definition; load a quality provider')
    }
    super(ctx, 'quality')
  }

  /**
   * Read the current quality assessment for one live agent.
   * @param agent - Agent whose durable session owns the assessment.
   * @returns Current assessment or undefined when none exists.
   */
  abstract get(agent: Agent): QualityAssessmentSnapshot | undefined

  /**
   * Start a fresh quality assessment for one live mission.
   * @param agent - Agent whose session owns the assessment.
   * @param request - Objective, task class, and optional initial criteria.
   * @returns Created revision-one assessment.
   */
  abstract start(agent: Agent, request: StartQualityAssessmentRequest): QualityAssessmentSnapshot

  /**
   * Record one compare-and-set mutation against the exact current revision.
   * @param agent - Agent whose session owns the assessment.
   * @param ref - Exact assessment id and revision being changed.
   * @param mutation - Evidence, scenario, forecast, repair, or innovation update.
   * @returns New whole assessment revision after the mutation commits.
   */
  abstract record(agent: Agent, ref: QualityAssessmentRef, mutation: QualityMutation): QualityAssessmentSnapshot
}

export default QualityService
