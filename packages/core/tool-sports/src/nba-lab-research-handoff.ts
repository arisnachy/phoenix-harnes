/** Archive-only adapter for PHOENIX NBA LAB A–Q research bundles.
 * An imported historical snapshot is NOT a live bet or a calibrated forecast.
 * No network, filesystem or odds refresh is performed by this pure reader.
 */
import type {StepObservation} from './daily-specialist-checklist.ts'

type Obj=Record<string,unknown>
const object=(x:unknown):Obj|null=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Obj:null
const text=(x:unknown):string=>typeof x==='string'?x:''
const array=(x:unknown):unknown[]=>Array.isArray(x)?x:[]
const eventId=(x:unknown):string=>/^\d{7,18}$/u.test(text(x))?text(x):''

export type NbaLabResearchContext={
  eventId:string
  league:'nba'
  sport:'basketball'
  snapshotCreatedUtc:string
  scheduledUtc:string
  snapshotState:string
  checklistObservations:Record<string,StepObservation>
  evidenceModules:Record<string,unknown>
  missingResearch:Array<{event_id:string;module:string;missing_fields:string[];route:string}>
  captureBeforeTipoff:boolean
  quarantinedInjuryRecords:number
  gate:{researchOnly:true;eligibleForTicket:false;quotedOddsLive:false;
    modelCalibrated:false;expectedValue:null;recommendation:'investigate'}
}

/** Rejects missing A–Q, duplicate IDs, uncalibrated probability promotion,
 * current-market claims and any attempt to approve a pick from an archive.
 */
export function readNbaLabHandoff(snapshot:unknown):NbaLabResearchContext[]{
  const root=object(snapshot)
  if(!root||root.schema!=='phoenix.nba.read-model.v1'||root.operational!==false)
    throw new Error('NBA handoff: expected historical read-only snapshot')
  const games=array(root.games)
  if(games.length===0||games.length>123)throw new Error('NBA handoff: invalid game count')
  const seen=new Set<string>(),out:NbaLabResearchContext[]=[]
  for(const raw of games){
    const g=object(raw),gate=object(g?.gate),steps=object(g?.checklistObservations)
    const eid=eventId(g?.eventId)
    if(!g||!gate||!steps||!eid||seen.has(eid))
      throw new Error('NBA handoff: malformed or duplicate event')
    if(g.sport!=='basketball'||g.league!=='nba'||gate.researchOnly!==true||
      gate.eligibleForTicket!==false||gate.quotedOddsLive!==false||
      gate.modelCalibrated!==false||gate.expectedValue!==null||
      gate.recommendation!=='investigate')
      throw new Error('NBA handoff: unsafe elevation of historical evidence')
    seen.add(eid)
    const observations:Record<string,StepObservation>={}
    for(const [key,rawStep] of Object.entries(steps)){
      const step=object(rawStep)
      if(!step||!['verified','partial','missing'].includes(text(step.state)))
        throw new Error('NBA handoff: malformed checklist observation')
      observations[key]={state:step.state as StepObservation['state'],
        detail:text(step.detail).slice(0,500)}
    }
    const modules=object(g.evidenceModules)??{}
    if(!'ABCDEFGHIJKLMNOPQ'.split('').every(k=>k in modules))
      throw new Error('NBA handoff: missing A-Q modules')
    const tasks=array(g.missingResearch).map(x=>{
      const t=object(x)
      return {event_id:text(t?.event_id),module:text(t?.module),
        missing_fields:array(t?.missing_fields).map(text).filter(Boolean),
        route:text(t?.route)}
    }).filter(x=>x.event_id===eid)
    const capture=Date.parse(text(g.snapshotCreatedUtc))
    const tipoff=Date.parse(text(g.scheduledUtc))
    if(!Number.isFinite(capture)||!Number.isFinite(tipoff))
      throw new Error('NBA handoff: invalid as-of or tipoff')
    out.push({eventId:eid,sport:'basketball',league:'nba',
      snapshotCreatedUtc:text(g.snapshotCreatedUtc),
      scheduledUtc:text(g.scheduledUtc),
      snapshotState:text(g.snapshotState),
      checklistObservations:observations,
      evidenceModules:modules,missingResearch:tasks,
      captureBeforeTipoff:capture<tipoff&&g.captureBeforeTipoff===true,
      quarantinedInjuryRecords:Number.isSafeInteger(g.quarantinedInjuryRecords)&&
        Number(g.quarantinedInjuryRecords)>=0?Number(g.quarantinedInjuryRecords):0,
      gate:{researchOnly:true,eligibleForTicket:false,quotedOddsLive:false,
        modelCalibrated:false,expectedValue:null,recommendation:'investigate'}})
  }
  return out
}
