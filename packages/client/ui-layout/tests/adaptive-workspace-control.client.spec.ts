import { describe, expect, it } from 'vitest'
import { addAdaptiveField, createAdaptiveAppBlueprint, type AdaptiveFormDraft } from '../src/client/AdaptiveAppCatalog.ts'
import { appendAdaptiveSection, installAdaptiveApp, readAdaptiveApps } from '../src/client/AdaptiveAppRegistry.ts'
import { readAdaptiveForm, saveAdaptiveForm } from '../src/client/AdaptiveFormMetadataStore.ts'
import {
  ADAPTIVE_PALETTES, applyAdaptiveFieldEdit, findAdaptiveMetadata, parseAdaptiveControl,
  preflightAdaptiveControl, readAdaptivePalette, saveAdaptivePalette,
} from '../src/client/AdaptiveWorkspaceControl.ts'

function store() {
  const saved = new Map<string,string>()
  return {
    saved,
    getItem:(key:string) => saved.get(key) ?? null,
    setItem:(key:string,value:string) => {saved.set(key,value)},
  }
}
function seeded() {
  const memory = store()
  const blueprint = createAdaptiveAppBlueprint('Inventario farmacia',['Productos','Reportes'])
  installAdaptiveApp(blueprint,memory)
  const base: AdaptiveFormDraft = {
    version:1,appId:blueprint.id,templateId:'productos',revision:0,state:'local-draft',fields:[],
  }
  saveAdaptiveForm(base,memory)
  const next = addAdaptiveField(base,{label:'Lote',kind:'text',destination:'local',output:'table'})
  saveAdaptiveForm(next,memory)
  return {memory,blueprint,next}
}

describe('Adaptive workspace safe chat actions', () => {
  it('reconfigures input type and required validation with immutable revisions', () => {
    const {memory,blueprint} = seeded()
    const typeChange = applyAdaptiveFieldEdit({
      appId:blueprint.id,operation:'set-field-kind',sectionId:'productos',
      fieldId:'field-1',kind:'number',expectedRevision:1,
    },memory)
    expect(typeChange.fields[0]?.kind).toBe('number')
    const validationChange = applyAdaptiveFieldEdit({
      appId:blueprint.id,operation:'set-required',sectionId:'productos',
      fieldId:'field-1',required:true,expectedRevision:2,
    },memory)
    expect(validationChange.fields[0]?.required).toBe(true)
    expect(validationChange.revision).toBe(3)
    expect(readAdaptiveForm(blueprint.id,'productos',memory)?.revision).toBe(3)
    expect(parseAdaptiveControl({
      appId:blueprint.id,operation:'set-field-kind',sectionId:'productos',
      fieldId:'field-1',kind:'script',expectedRevision:3,
    })).toBeNull()
  })


  it('denies code/URL fields and actions against protected General or Healthia', () => {
    expect(parseAdaptiveControl({appId:'general',operation:'open'})).toBeTruthy()
    expect(parseAdaptiveControl({appId:'healthia',operation:'palette',palette:'iris'})).toBeNull()
    expect(parseAdaptiveControl({appId:'app-stock',operation:'palette',palette:'javascript:alert(1)'})).toBeNull()
    expect(parseAdaptiveControl({appId:'app-stock',operation:'open',script:'execute()'})).toBeNull()
    expect(preflightAdaptiveControl({appId:'general',operation:'find',query:'Productos'})).toEqual({valid:true,reason:'METADATA_ONLY'})
    expect(preflightAdaptiveControl({appId:'healthia',operation:'add-section',label:'Datos'})).toEqual({valid:false,reason:'INVALID_SCHEMA'})
  })

  it('checks field revisions before edits and preserves untouched fields', () => {
    const {memory,blueprint,next} = seeded()
    const command = {
      appId:blueprint.id,operation:'rename-field' as const,sectionId:'productos',
      fieldId:'field-1',label:'Lote farmacéutico',expectedRevision:1,
    }
    const read = (a:string,b:string) => readAdaptiveForm(a,b,memory)
    expect(preflightAdaptiveControl(command,readAdaptiveApps(memory),read).valid).toBe(true)
    const after = applyAdaptiveFieldEdit(command,memory)
    expect(after.fields[0]?.label).toBe('Lote farmacéutico')
    expect(after.revision).toBe(2)
    expect(next.fields[0]?.label).toBe('Lote')
    expect(() => applyAdaptiveFieldEdit(command,memory)).toThrow(/STALE_REVISION/)
    expect(readAdaptiveForm(blueprint.id,'productos',memory)?.revision).toBe(2)
  })

  it('rejects stale configuration and uninstalled app modifications', () => {
    const {memory,blueprint} = seeded()
    const read = (a:string,b:string) => readAdaptiveForm(a,b,memory)
    const items = readAdaptiveApps(memory)
    expect(preflightAdaptiveControl({
      appId:blueprint.id,operation:'remove-field',sectionId:'productos',fieldId:'field-1',expectedRevision:0,
    },items,read).reason).toBe('STALE_REVISION')
    expect(preflightAdaptiveControl({
      appId:'app-nonexistent',operation:'open',
    },items,read).reason).toBe('UNKNOWN_APP')
    expect(preflightAdaptiveControl({
      appId:blueprint.id,operation:'add-section',label:'Productos',
    },items,read).reason).toBe('DUPLICATE_SECTION')
    const updated = appendAdaptiveSection(blueprint.id,'Compras',memory)
    expect(updated.sections.map(s => s.id)).toEqual(['productos','reportes','compras'])
  })

  it('searches only app, menu and field metadata and keeps results bounded', () => {
    const {memory,blueprint} = seeded()
    const found = findAdaptiveMetadata('Lote',readAdaptiveApps(memory),(a,b) => readAdaptiveForm(a,b,memory))
    expect(found).toEqual([{kind:'field',appId:blueprint.id,sectionId:'productos',fieldId:'field-1',label:'Lote'}])
    expect(JSON.stringify(found)).not.toContain('patientValue')
  })

  it('stores only an allowlisted, harmonized color palette and restores Pearl default', () => {
    const {memory,blueprint} = seeded()
    expect(readAdaptivePalette(blueprint.id,memory)).toBe('pearl')
    expect(saveAdaptivePalette(blueprint.id,'ocean',memory)).toBe('ocean')
    expect(readAdaptivePalette(blueprint.id,memory)).toBe('ocean')
    expect(Object.keys(ADAPTIVE_PALETTES)).toEqual(['pearl','ocean','sage','iris','amber'])
    expect(() => saveAdaptivePalette(blueprint.id,'url(evil)' as never,memory)).toThrow('ADAPTIVE_THEME_DENIED')
    expect(() => saveAdaptivePalette('healthia','iris',memory)).toThrow('ADAPTIVE_THEME_DENIED')
  })
})
