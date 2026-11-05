// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { calculateSmartForm } from '../src/client/chat/SmartFormEngine.ts'
import { recoverHtmlForm } from '../src/client/chat/html-form-recovery.ts'

const legacyBmi = [
  '<!doctype html><html><body>',
  '<h1>Calculadora de IMC</h1>',
  '<form><label for="peso">Peso</label><input type="number" id="peso" value="70"><span>kg</span>',
  '<label for="altura">Estatura</label><input type="number" id="altura" value="168"><span>cm</span>',
  '<button type="button">Calcular IMC</button></form>',
  '</body></html>',
].join('')

describe('HTML smart form recovery', () => {
  it('makes the exact inert two-input BMI layout calculate locally', () => {
    const recovered = recoverHtmlForm(legacyBmi, 'Calculadora de IMC')
    expect(recovered.kind).toBe('native')
    if (recovered.kind !== 'native') return
    expect(recovered.spec.props.fields.map(field => field.default)).toEqual([70,168])
    const result = calculateSmartForm(recovered.spec,{peso:70,talla:168})
    expect(result.ready).toBe(true)
    expect(result.outputs[0]?.value).toBeCloseTo(24.801587,4)
    expect(result.outputs[0]?.text).toBe('24.8')
  })

  it('also supports explicit metre units without silently mixing centimetres', () => {
    const html = legacyBmi.replace('value="168"', 'value="1.68"').replace('<span>cm</span>', '<span>metros</span>')
    const recovered = recoverHtmlForm(html,'Calculadora de IMC')
    expect(recovered.kind).toBe('native')
    if (recovered.kind !== 'native') return
    expect(recovered.spec.props.fields[1]?.default).toBeCloseTo(168,6)
  })

  it('computes arbitrary model-authored declarative expressions, not only BMI', () => {
    const spec = {
      component:'smart_form',version:1,props:{
        id:'area_terreno',title:'Área',kind:'calculator',
        fields:[{id:'ancho',label:'Ancho',type:'number',default:6},
          {id:'largo',label:'Largo',type:'number',default:7}],
        outputs:[{id:'area',label:'Área',expression:{op:'mul',args:[{field:'ancho'},{field:'largo'}]}}],
      },
    }
    const html = '<form><input type="number"></form>'
      + '<script type="application/vnd.phoenix.smart-form+json">'
      + JSON.stringify(spec) + '</script>'
    const recovered = recoverHtmlForm(html,'Área de terreno')
    expect(recovered.kind).toBe('native')
    if (recovered.kind !== 'native') return
    expect(calculateSmartForm(recovered.spec,{ancho:6,largo:7}).outputs[0]?.value).toBe(42)
  })

  it('never guesses unknown formulas or presents static buttons as working', () => {
    const html = '<h1>Calculadora de impuestos</h1><form>'
      + '<label>Base <input type="number" value="100"></label>'
      + '<button type="button">Calcular</button></form>'
    expect(recoverHtmlForm(html,'Impuestos').kind).toBe('inert')
  })

  it('does not reinterpret HTML with genuine inline JavaScript', () => {
    const html = legacyBmi + '<script>document.querySelector("button").addEventListener("click",()=>{})</script>'
    expect(recoverHtmlForm(html,'IMC').kind).toBe('html')
  })

  it('refuses unsafe imperial or ambiguous BMI units', () => {
    const imperial = legacyBmi.replace('<span>kg</span>','<span>lb</span>')
      .replace('<span>cm</span>','<span>inches</span>')
    expect(recoverHtmlForm(imperial, 'IMC').kind).toBe('inert')
    const ambiguous = legacyBmi.replace('<span>kg</span>', '')
      .replace('<span>cm</span>', '')
    expect(recoverHtmlForm(ambiguous, 'IMC').kind).toBe('inert')
  })

  it('recovers blocked-script BMI without overriding the sandbox permission', () => {
    const html = legacyBmi + '<script>function calculate(){}</script>'
    const recovered = recoverHtmlForm(html, 'IMC', false)
    expect(recovered.kind).toBe('native')
    if (recovered.kind !== 'native') return
    expect(calculateSmartForm(recovered.spec, { peso:70, talla:168 }).outputs[0]?.value)
      .toBeCloseTo(24.801587,4)
    const other = '<h1>Calculadora</h1><form><input type="number">'
      + '<button>Calcular</button></form><script>function calculate(){}</script>'
    expect(recoverHtmlForm(other,'Calculadora',false).kind).toBe('inert')
  })

  it('restores BMI calculations from numeric text inputs too', () => {
    const html = legacyBmi.replaceAll('type="number"', 'type="text" inputmode="decimal"')
    const recovered = recoverHtmlForm(html,'IMC')
    expect(recovered.kind).toBe('native')
  })

  it('rejects malformed or malicious formula metadata rather than executing it', () => {
    const html = '<form><input type="number"><button>Calcular</button></form>'
      + '<script type="application/vnd.phoenix.smart-form+json">'
      + '{"component":"smart_form","version":1,"props":{"onClick":"alert(1)"}}'
      + '</script>'
    expect(recoverHtmlForm(html,'Calculadora de cualquier cosa').kind).toBe('inert')
  })

  it('keeps ordinary contact forms and static documents unchanged', () => {
    expect(recoverHtmlForm('<form><input name="email"><button>Enviar</button></form>','Contacto').kind).toBe('html')
    expect(recoverHtmlForm('<h1>Informe de salud</h1>','Informe').kind).toBe('html')
  })

  it('does not infer BMI from additional clinical inputs', () => {
    const html = legacyBmi.replace('</form>', '<input type="number" id="cintura" value="75"></form>')
    expect(recoverHtmlForm(html,'IMC').kind).toBe('inert')
  })
})
