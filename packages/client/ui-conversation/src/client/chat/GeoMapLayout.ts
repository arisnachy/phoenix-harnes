import type { GeoFeature, GeoLayer } from './GeoMap.tsx'

/** Geographic viewport fitting in projected Web Mercator space with 14% breathing room.
 * @param layers - Geographic layers to inspect or render.
 * @param size - Available viewport dimensions.
 * @returns The result produced by this operation.
 */
export function fitGeoView(layers: readonly GeoLayer[], size: { readonly w:number; readonly h:number }):
{ lng:number; lat:number; zoom:number } {
  const points = layers.flatMap(layer => layer.features.flatMap(feature => feature.coordinates))
  if (points.length === 0) return { lng:0,lat:0,zoom:2 }
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1])
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys)
  const latToY=(lat:number):number => {
    const rad=Math.max(-85,Math.min(85,lat))*Math.PI/180
    return (1-Math.log(Math.tan(Math.PI/4+rad/2))/Math.PI)/2
  }
  const mercatorYMin=latToY(maxY),mercatorYMax=latToY(minY)
  const padding=.72
  const xSpan=Math.max((maxX-minX)/360,1/(256*Math.pow(2,15)))
  const ySpan=Math.max(mercatorYMax-mercatorYMin,1/(256*Math.pow(2,15)))
  const xZoom=Math.log2(Math.max(180,size.w*padding)/(256*xSpan))
  const yZoom=Math.log2(Math.max(190,size.h*padding)/(256*ySpan))
  const zoom=Math.max(2,Math.min(16,Math.floor(Math.min(xZoom,yZoom))))
  const mercatorY=(mercatorYMin+mercatorYMax)/2
  const lat=Math.atan(Math.sinh(Math.PI*(1-2*mercatorY)))*180/Math.PI
  return { lng:(minX+maxX)/2,lat,zoom }
}

/** One labeled legend entry for a rendered geographic layer. */
export interface GeoLegendEntry { readonly key:string; readonly label:string; readonly color:string }
/** Distinct swatches must match actual feature colors, not invented threshold labels.
 * @param layers - Geographic layers to inspect or render.
 * @returns The matching projected records.
 */
export function buildGeoLegend(layers: readonly GeoLayer[]): readonly GeoLegendEntry[] {
  const list: GeoLegendEntry[]=[]
  for (const layer of layers) {
    const distinct = new Map<string,GeoFeature[]>()
    for (const feature of layer.features) {
      const c=feature.color??(layer.kind==='heat'?'#dc6531':layer.kind==='line'?'#ea6927':'#d96a28')
      if (!distinct.has(c)) distinct.set(c,[])
      requiredValue(distinct.get(c)).push(feature)
    }
    if (distinct.size <= 1) {
      const color=[...distinct.keys()][0]
      if (color) list.push({ key:layer.id+':'+color,label:layer.name,color })
    } else {
      for (const [color,items] of distinct) {
        // No assumed clinical/commercial semantics: label actual sample name and count.
        list.push({ key:layer.id+':'+color,label:layer.name+' · '+items.length+' ('+requiredValue(items[0]).label+')',color })
      }
    }
  }
  return list.slice(0,8)
}

/** Reject absent entries before reading validated structured data. */
function requiredValue<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('Required structured value is missing.')
  return value
}
