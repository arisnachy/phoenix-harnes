import { describe, expect, it } from 'vitest'
import { clinicalPrintHtml } from '../src/client/HealthiaClinicalPrint.ts'

describe('protected Healthia printable records',()=>{
  it('escapes arbitrary patient text and renders draft status without inventing a signature',()=>{
    const page=clinicalPrintHtml({
      title:'Historia clínica',
      institution:'Centro de pruebas',
      patientName:'Paciente <script>alert(1)</script>',
      patientId:'00000000-0000-4000-8000-000000000001',
      practitioner:'Profesional',
      date:'2026-11-23',status:'draft',
      sections:[{heading:'Motivo',body:'Narración con <img src=x onerror=alert(1)> y detalles'}],
    })
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(page).not.toContain('<script>')
    expect(page).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(page).toContain('BORRADOR / SIN FIRMAR')
    expect(page).not.toContain('Firma digital confirmada')
    expect(page).toContain("default-src 'none'")
  })
  it('never claims a fiscal invoice or a signed note from a draft',()=>{
    const html=clinicalPrintHtml({
      title:'Cuenta administrativa',institution:'Healthia',patientName:'Prueba',patientId:'ID',
      practitioner:'Caja',date:'2026-11-23',status:'pending',
      sections:[{heading:'Cuenta interna',body:'RD$ 100'}],
      disclaimer:'No es un comprobante fiscal.',
    })
    expect(html).toContain('No es un comprobante fiscal.')
    expect(html).toContain('BORRADOR / SIN FIRMAR')
  })
})
