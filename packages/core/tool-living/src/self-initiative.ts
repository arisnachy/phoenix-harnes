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
  // A shared capability inventory, not a model/provider capability claim.
  const available=(candidates:readonly string[])=>candidates.filter(name=>names.has(name))
  const inspect=available(['system_runtime_inspect','cordis_inspect_self','cordis_inspect_list','cordis_inspect_query'])
  const lifecycle=['cordis_define','cordis_run','cordis_stop','cordis_undefine']
  const extensionTools=available(lifecycle)
  const sourceTools=available(['read','glob','grep','fs_status','edit','str_replace_editor','write','bash','pwsh'])
  const verify=available(['phoenix_evolution_analyze','system_runtime_inspect','cordis_inspect_self'])
  const scope={
    interface:{channel:'adaptive_control',state:'requires-live-browser-receipt',authority:'existing-ui-preflight-and-user-apply'},
    configuration:{channel:'owning-settings-service',state:'inspect-owner-before-proposal',authority:'existing-settings-permissions'},
    environment:{inspect:available(['system_environment_inspect','system_app_search']),authority:'current-host-tool-policy'},
    behavior:{inspect:available(['phoenix_evolution_analyze','system_runtime_inspect']),authority:'verified-candidate-only'},
    tools:{inspect,extensionTools,completeLifecycle:lifecycle.every(name=>names.has(name)),authority:'existing-extension-approval-and-stop-controls'},
    source:{tools:sourceTools,authority:'isolated-reviewed-candidate-only'},
  }
  return {
    schema:'phoenix.self.initiative.v1',scope:'calling-session',goal:selected,
    evidence:{sampledEvents:metrics.sampledEvents,retries:metrics.retries,toolErrors:metrics.toolErrors,failedTurns:metrics.failedTurns},
    observedRepeatedFailure:observedFailure,
    next:observedFailure?'diagnose-before-retry':selected==='adapt'?'inspect-then-propose-reversible-change':selected==='resource'?'measure-resource-before-start':selected==='verify'?'check-real-outcome':'discover-available-capability',
    candidateReadTools:tools, unavailableCandidates:proposed[selected].filter(name=>!names.has(name)),
    retryPolicy:'after repeated failure, stop repeating identical calls; change approach or explain blocker',
    evolution:{scope:'whole-phoenix',providerIndependent:true,coordinator:'Kira',
      triggers:['user-request','observed-system-need'],domains:scope,
      steps:['inspect-live-owner','identify-need-and-baseline','choose-smallest-reversible-change','check-existing-authority','apply-through-owner','verify-readback','restore-on-regression'],
      verificationTools:verify,registrationIsNotPermission:true,coreActivation:'independent-review-required'},
    executionAuthority:'current-tool-policy-only', autoWrites:false, backgroundScheduled:false, verifiedOutcome:false,
  }
}
