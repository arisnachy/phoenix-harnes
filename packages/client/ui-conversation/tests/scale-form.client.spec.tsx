// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { parseScaleForm, ScaleForm, scaleProtocolWarnings, scoreScale } from '../src/client/chat/ScaleForm.tsx'

afterEach(cleanup)

const miniCog = {
  component:'scale_form',version:1,
  props:{
    title:'Mini-Cog · registro de puntuación',
    description:'Registro asistido, no reemplaza la administración estandarizada.',
    source:'Mini-Cog official scoring guide, mini-cog.com',
    version:'Referencia al protocolo de 2016; verificar adaptación autorizada',
    population:'Adultos, sujeto a indicación clínica',
    administration:[
      {id:'registro',phase:'prepare',title:'Registro de tres palabras',
        instruction:'Administrar una lista autorizada y comprobar el registro sin puntuar todavía.'},
      {id:'reloj',phase:'administer',title:'Dibujo del reloj',
        instruction:'Administrar la tarea del reloj en papel según el protocolo; evaluar su normalidad.'},
      {id:'evocacion',phase:'score',title:'Evocación diferida',
        instruction:'Registrar las palabras recordadas espontáneamente sin pistas y asignar puntos.'},
    ],
    scoring:{min:0,max:5,direction:'higher-better',
      note:'El resultado es cribado; no confirma ni descarta un diagnóstico.'},
    items:[
      {id:'recuerdo',question:'Palabras recordadas sin ayuda',
        options:[
          {label:'Ninguna (0)',score:0},{label:'Una (1)',score:1},
          {label:'Dos (2)',score:2},{label:'Tres (3)',score:3},
        ]},
      {id:'reloj_papel',question:'Dibujo del reloj según el protocolo',
        options:[{label:'Anormal (0)',score:0},{label:'Normal (2)',score:2}]},
    ],
    bands:[{max:2,label:'Se recomienda evaluación adicional',tone:'warning'},
      {max:5,label:'No excluye deterioro cognitivo',tone:'neutral'}],
  },
} as const

describe('universal assessment engine: instrument protocol and scoring', () => {
  it('renders a complete three-stage Mini-Cog score record with meaningful results', () => {
    const spec=parseScaleForm(miniCog)
    expect(spec).not.toBeNull()
    if (!spec) return
    expect(scaleProtocolWarnings(spec)).toEqual([])
    expect(scoreScale(spec,{recuerdo:3,reloj_papel:2})).toMatchObject({
      answered:2,total:5,band:{label:'No excluye deterioro cognitivo'},
    })
    expect(scoreScale(spec,{recuerdo:0,reloj_papel:0})).toMatchObject({
      answered:2,total:0,band:{label:'Se recomienda evaluación adicional'},
    })
    expect(scoreScale(spec,{recuerdo:2})).toMatchObject({answered:1,total:null})
    render(<ScaleForm spec={spec}/>)
    expect(screen.getByText('Procedimiento de administración')).toBeTruthy()
    expect(screen.getByText('Registro de tres palabras')).toBeTruthy()
    expect(screen.getByText('Dibujo del reloj')).toBeTruthy()
    expect(screen.getByText('Evocación diferida')).toBeTruthy()
    const selects=screen.getAllByRole('combobox')
    fireEvent.change(selects[0]!,{target:{value:'3'}})
    expect(screen.getByText('—')).toBeTruthy()
    fireEvent.change(selects[1]!,{target:{value:'1'}})
    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getByText('Rango: 0–5')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:/Reiniciar/}))
    expect(screen.getByText('0 de 2 respuestas')).toBeTruthy()
  })

  it('warns when a named clinical tool has only two scored questions but no procedure', () => {
    const spec=parseScaleForm({...miniCog,props:{
      ...miniCog.props,administration:undefined,version:undefined,
    }})
    expect(spec).not.toBeNull()
    if (!spec) return
    const warnings=scaleProtocolWarnings(spec)
    expect(warnings.some(w=>w.includes('procedimiento'))).toBe(true)
    expect(warnings.some(w=>w.includes('versión'))).toBe(true)
    const onAction=vi.fn()
    render(<ScaleForm spec={spec} onAction={onAction}/>)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByText('Procedimiento de administración')).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'Mejorar instrumento con Kira'}))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction.mock.calls[0]?.[1]).toBe('draft')
    expect(onAction.mock.calls[0]?.[0]).toContain('falta el procedimiento')
  })

  it('rejects impossible declared score ranges instead of interpreting them', () => {
    const spec=parseScaleForm({...miniCog,props:{
      ...miniCog.props,scoring:{min:0,max:10},
    }})
    expect(spec).not.toBeNull()
    if (!spec) return
    expect(scaleProtocolWarnings(spec).some(w=>w.includes('rango declarado'))).toBe(true)
  })

  it('accepts duplicate-scored business choices and keeps their selected labels', () => {
    const spec=parseScaleForm({component:'scale_form',version:1,props:{
      title:'Encuesta de satisfacción',source:'Instrumento interno no validado',
      items:[{id:'trato',question:'¿Cómo fue el trato?',options:[
        {label:'No aplica',score:0},{label:'Muy malo',score:0},{label:'Bueno',score:2},
      ]}],
    }})
    expect(spec).not.toBeNull()
    if (!spec) return
    render(<ScaleForm spec={spec}/>)
    fireEvent.change(screen.getByRole('combobox'),{target:{value:'choice:1'}})
    expect(screen.getByRole('combobox')).toHaveProperty('value','choice:1')
    expect(scoreScale(spec,{trato:0}).total).toBe(0)
  })

  it('scores multiple subscales independently without adding model calls', () => {
    const spec=parseScaleForm({component:'scale_form',version:1,props:{
      title:'Evaluación interna de operaciones',
      items:[
        {id:'servicio',question:'Atención al cliente',options:[
          {label:'Mala',score:0},{label:'Excelente',score:3}]},
        {id:'costos',question:'Control presupuestario',options:[
          {label:'Malo',score:0},{label:'Bueno',score:2}]},
        {id:'personas',question:'Clima laboral',options:[
          {label:'Bajo',score:0},{label:'Alto',score:4}]},
      ],
      domains:[
        {id:'experiencia',label:'Experiencia de cliente',items:['servicio']},
        {id:'gestion',label:'Gestión interna',items:['costos','personas']},
      ],
    }})
    expect(spec).not.toBeNull()
    if (!spec) return
    const partial=scoreScale(spec,{servicio:3})
    expect(partial.total).toBeNull()
    expect(partial.domains).toMatchObject([
      {id:'experiencia',value:3,min:0,max:3},
      {id:'gestion',value:null,min:0,max:6},
    ])
    expect(scoreScale(spec,{servicio:3,costos:2,personas:4}).domains[1]?.value).toBe(6)
    render(<ScaleForm spec={spec}/>)
    expect(screen.getByText('Resultados por dimensión')).toBeTruthy()
    expect(screen.getByText('Gestión interna')).toBeTruthy()
  })

  it('rejects untrusted executable props in steps, duplicate IDs and score format violations', () => {
    expect(parseScaleForm({...miniCog,props:{...miniCog.props,
      administration:[{...miniCog.props.administration[0],onclick:'alert(1)'}],
    }})).toBeNull()
    expect(parseScaleForm({...miniCog,props:{...miniCog.props,items:[
      miniCog.props.items[0],miniCog.props.items[0],
    ]}})).toBeNull()
    expect(parseScaleForm({...miniCog,props:{...miniCog.props,
      scoring:{min:5,max:2},
    }})).toBeNull()
  })
})
