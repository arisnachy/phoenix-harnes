/** Session-scoped, evidence-based choice of the next self-management step.
 * No credentials, raw messages, execution grants, background jobs or model switching. */
import { summarizeEvolutionEvents } from './evolution.ts'
export const SELF_GOALS=['auto','diagnose','adapt','capability','resource','verify'] as const
export type SelfGoal=typeof SELF_GOALS[number]
export function assessSelfInitiative(goal:SelfGoal,events:readonly {type:string;data:unknown}[],registered:readonly string[]){
  const metrics=summarizeEvolutionEvents(events)
  const observedFailure=metrics.retries>=2||metrics.toolErrors>=2||metrics.failedTurns>=2
  const selected=goal==='auto'?(observedFailure?'diagnose':'capability'):goal
  const names=new Set(registered)
  const proposed:Record<Exclude<SelfGoal,'auto'>,string[]>={
    diagnose:['system_runtime_inspect','phoenix_evolution_analyze','system_environment_inspect'],
    adapt:['system_runtime_inspect','phoenix_evolution_analyze'],
    capability:['system_runtime_inspect','system_app_search'],
    resource:['system_environment_inspect','phoenix_evolution_analyze'],
    verify:['phoenix_evolution_analyze','system_runtime_inspect'],
  }
  const tools=proposed[selected].filter(name=>names.has(name))
  return {
    schema:'phoenix.self.initiative.v1',scope:'calling-session',goal:selected,
    evidence:{sampledEvents:metrics.sampledEvents,retries:metrics.retries,toolErrors:metrics.toolErrors,failedTurns:metrics.failedTurns},
    observedRepeatedFailure:observedFailure,
    next:observedFailure?'diagnose-before-retry':selected==='adapt'?'inspect-then-propose-reversible-change':selected==='resource'?'measure-resource-before-start':selected==='verify'?'check-real-outcome':'discover-available-capability',
    candidateReadTools:tools, unavailableCandidates:proposed[selected].filter(name=>!names.has(name)),
    retryPolicy:'after repeated failure, stop repeating identical calls; change approach or explain blocker',
    executionAuthority:'current-tool-policy-only', autoWrites:false, backgroundScheduled:false, verifiedOutcome:false,
  }
}
