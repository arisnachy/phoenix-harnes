import { useId, useMemo, useRef, useState } from 'react'
import type { GeoLayer, GeoFeature } from './GeoMap.tsx'
import css from './Geo3DView.module.css'

type Point = readonly [number, number]
interface Props {
  readonly layers: readonly GeoLayer[]
  readonly onSelect?: (layer: GeoLayer, feature: GeoFeature) => void
}
/**
 * Actual perspective projection of WGS84 features into editable 3D prisms.
 * Height encodes supplied metrics; this is not a terrain elevation DEM.
 */
export function Geo3DView({ layers, onSelect }: Props) {
  const [yaw, setYaw] = useState(40)
  const [pitch, setPitch] = useState(52)
  const [scale, setScale] = useState(1)
  const gradientId = useId().replaceAll(':', '-')
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)
  const geometry = useMemo(() => {
    const features = layers.flatMap(layer => layer.features.map(feature => ({ layer, feature })))
    const coordinates = features.flatMap(({ feature }) => feature.coordinates)
    if (!coordinates.length) return null
    const xs = coordinates.map(p => p[0]), ys = coordinates.map(p => p[1])
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const midLat = (minY + maxY) / 2
    const normLng = Math.max((maxX - minX) * Math.cos(midLat * Math.PI / 180), 0.0001)
    const normLat = Math.max(maxY - minY, 0.0001)
    const maxValue = Math.max(1, ...features.map(x => Math.max(0, x.feature.value ?? 0)))
    return { features, minX, maxX, minY, maxY, normLng, normLat, midLat, maxValue }
  }, [layers])
  if (geometry === null) return <div className={css.root}><p className={css.empty}>Activa una capa con ubicaciones para visualizarla en 3D.</p></div>
  const angle = yaw * Math.PI / 180, tilt = pitch * Math.PI / 180
  const co = Math.cos(angle), si = Math.sin(angle), ct = Math.cos(tilt), st = Math.sin(tilt)
  const flat = ([lon, lat]: Point): Point => [
    ((lon - (geometry.minX + geometry.maxX) / 2) * Math.cos(geometry.midLat * Math.PI / 180))
      / geometry.normLng * 2,
    (lat - (geometry.minY + geometry.maxY) / 2) / geometry.normLat * 2,
  ]
  const render3D = (point: Point, z = 0): Point => {
    const [x,y] = flat(point)
    const xx = x * co - y * si
    const depth = x * si + y * co
    const distance = Math.max(3.3, 5.5 - depth * ct - z * st)
    const perspective = 995 * scale / distance
    return [500 + perspective * xx, 270 + perspective * (depth * st - z * ct)]
  }
  const ground: readonly Point[] = [[geometry.minX,geometry.minY], [geometry.maxX,geometry.minY],
    [geometry.maxX,geometry.maxY], [geometry.minX,geometry.maxY]]
  const points = ground.map(p=>render3D(p).join(',')).join(' ')
  return (
    <div className={css.root} data-phoenix-geo-3d="true">
      <div className={css.instruction}>Mapa 3D temático · Arrastrar para girar · La altura indica valor, no relieve</div>
      <svg className={css.scene} viewBox="0 0 1000 500" role="img"
        aria-label="Mapa 3D geográfico de geometrías verificadas y extrusión temática"
        onPointerDown={event => {
          if (event.button !== 0) return
          drag.current = { x: event.clientX, y: event.clientY, yaw, pitch }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={event => {
          if (!drag.current) return
          setYaw(drag.current.yaw + (event.clientX - drag.current.x) * 0.4)
          setPitch(Math.max(15,Math.min(78,drag.current.pitch + (event.clientY - drag.current.y) * 0.3)))
        }}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}>
        <defs><linearGradient id={gradientId} x2="0" y2="1">
          <stop offset="0" stopColor="#faf8f5"/><stop offset="1" stopColor="#e6e6e2"/>
        </linearGradient></defs>
        <rect width="1000" height="500" fill="#f2f5f5"/>
        <polygon points={points} fill={'url(#' + gradientId + ')'} stroke="#b9c5c2" strokeWidth="3"/>
        {[.25,.5,.75].flatMap(q => {
          const y = geometry.minY+(geometry.maxY-geometry.minY)*q
          const x = geometry.minX+(geometry.maxX-geometry.minX)*q
          return [
            <line key={'lat'+q} x1={render3D([geometry.minX,y])[0]} y1={render3D([geometry.minX,y])[1]}
              x2={render3D([geometry.maxX,y])[0]} y2={render3D([geometry.maxX,y])[1]}
              stroke="#bdcac7" strokeDasharray="4 6"/>,
            <line key={'lng'+q} x1={render3D([x,geometry.minY])[0]} y1={render3D([x,geometry.minY])[1]}
              x2={render3D([x,geometry.maxY])[0]} y2={render3D([x,geometry.maxY])[1]}
              stroke="#bdcac7" strokeDasharray="4 6"/>,
          ]
        })}
        {geometry.features.slice().sort((a,b) => {
          const depth = (item: typeof a): number => {
            const point = item.feature.coordinates[0]
            if (!point) return 0
            const xy = flat(point)
            return xy[0] * si + xy[1] * co
          }
          return depth(b) - depth(a)
        }).map(({layer,feature}) => {
          const first = feature.coordinates[0]
          if (!first) return null
          const value = Math.max(0,feature.value ?? 0)
          const height = feature.value === undefined ? .05 : .15+.95*Math.sqrt(value/geometry.maxValue)
          const base = feature.coordinates.map(p=>render3D(p,0))
          const top = feature.coordinates.map(p=>render3D(p,height))
          const c=feature.color??'#ce692c'
          const key=layer.id+':'+feature.id
          if (layer.kind === 'polygon') return (
            <g key={key} className={css.shape} role="button" tabIndex={0} aria-label={'Seleccionar ' + feature.label}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect?.(layer,feature) } }}
              onClick={() => onSelect?.(layer,feature)}>
              {base.map((p,i) => {
                const next=base[(i+1)%base.length],t=top[i],u=top[(i+1)%top.length]
                if(!next||!t||!u)return null
                return <polygon key={i} points={[p,next,u,t].map(pt=>pt.join(',')).join(' ')}
                  fill={c} opacity=".55" stroke="#ffffff" strokeWidth=".9"/>
              })}
              <polygon points={top.map(p=>p.join(',')).join(' ')} fill={c} opacity=".9" stroke="#fff" strokeWidth="2"/>
              <title>{feature.label}: {feature.value ?? 'sin métrica'}</title>
            </g>
          )
          if(layer.kind === 'line'){
            return <polyline key={key} points={top.map(p=>p.join(',')).join(' ')}
              stroke={c} strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          }
          const lower=render3D(first,0),upper=render3D(first,height)
          return <g key={key} className={css.shape} role="button" tabIndex={0} aria-label={'Seleccionar '+feature.label}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect?.(layer,feature) } }}
            onClick={() => onSelect?.(layer,feature)}>
            <line x1={lower[0]} y1={lower[1]} x2={upper[0]} y2={upper[1]} stroke={c} strokeWidth="9" opacity=".75"/>
            <circle cx={upper[0]} cy={upper[1]} r="9" stroke="white" strokeWidth="2" fill={c}/>
            <title>{feature.label}: {feature.value ?? 'sin métrica'}</title>
          </g>
        })}
      </svg>
      <div className={css.controls}>
        <button type="button" onClick={() => setScale(s => Math.min(2.2,s*1.18))}>Acercar</button>
        <button type="button" onClick={() => setScale(s => Math.max(.45,s/1.18))}>Alejar</button>
        <button type="button" onClick={() => { setYaw(40);setPitch(52);setScale(1) }}>Restablecer cámara</button>
      </div>
    </div>
  )
}
