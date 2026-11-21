import type { CSSProperties } from 'react'
import { useId, useState } from 'react'
import { Studio3DGLBViewer } from './Studio3DGLBViewer.tsx'

const route = /^\/phoenix-studio3d\/assets\/([0-9a-f]{48})\/(render\.png|scene\.glb|scene\.blend|animation\.mp4)$/u
interface AssetLinks {
  readonly renderUrl: string
  readonly modelUrl: string
  readonly projectUrl: string
  readonly animationUrl?: string
}
function validAsset(value: unknown, file: string, token?: string): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = route.exec(value)
  if (match === null || match[2] !== file || (token !== undefined && match[1] !== token)) return undefined
  return value
}
export function parseStudio3DArtifact(value: unknown): AssetLinks | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const data=value as Record<string,unknown>
  const renderUrl=validAsset(data.renderUrl,'render.png')
  if(renderUrl===undefined)return undefined
  const token=route.exec(renderUrl)?.[1]
  const modelUrl=validAsset(data.modelUrl,'scene.glb',token)
  const projectUrl=validAsset(data.projectUrl,'scene.blend',token)
  if(modelUrl===undefined||projectUrl===undefined)return undefined
  const animationUrl=validAsset(data.animationUrl,'animation.mp4',token)
  return { renderUrl,modelUrl,projectUrl,...animationUrl===undefined?{}:{ animationUrl } }
}
const linkStyle:CSSProperties={
  display:'inline-flex',padding:'8px 12px',border:'1px solid #bbb',
  borderRadius:9,color:'inherit',textDecoration:'none',fontSize:13,
  background:'transparent',
}
export function Studio3DPreview({ value,title }:{ readonly value:unknown;readonly title:string }) {
  const viewerId=`studio3d-viewer-${useId().replaceAll(':','')}`
  const [view,setView]=useState<'render'|'model'|'fallback'>('render')
  const viewerOpen=view==='model'
  const assets=parseStudio3DArtifact(value)
  if(assets===undefined)return <p role="alert">Studio 3D: el paquete de activos no es válido.</p>
  return <section data-phoenix-studio3d="blender" style={{ padding:12,display:'grid',gap:12 }}>
    <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap' }}>
      <strong>{title}</strong>
      <span style={{ fontSize:12,opacity:.7 }}>Blender Cycles · salida de producción</span>
    </div>
    <button type="button" style={{ ...linkStyle,justifySelf:'start',cursor:'pointer' }}
      aria-expanded={viewerOpen} aria-controls={viewerId}
      onClick={()=>setView(viewerOpen?'render':'model')}>{viewerOpen?'Cerrar visor 3D':'Ver modelo 3D'}</button>
    <div id={viewerId}>
      {viewerOpen
        ? <Studio3DGLBViewer key={assets.modelUrl} modelUrl={assets.modelUrl} title={title}
          onError={()=>setView('fallback')}/>
        : <>
          {view==='fallback'&&<p role="status">El visor 3D no se pudo cargar. Se muestra el render de Blender.</p>}
          <img alt={'Render real de Blender: '+title} src={assets.renderUrl}
            style={{ display:'block',width:'100%',maxHeight:600,objectFit:'contain',borderRadius:12,background:'#121b20' }}/>
        </>}
    </div>
    {assets.animationUrl!==undefined&&<video controls preload="metadata" src={assets.animationUrl}
      aria-label={'Animación Blender: '+title} style={{ maxWidth:'100%',borderRadius:12 }}/>}
    <div style={{ display:'flex',flexWrap:'wrap',gap:8 }}>
      <a style={linkStyle} href={assets.modelUrl} download="scene.glb">Modelo GLB</a>
      <a style={linkStyle} href={assets.projectUrl} download="scene.blend">Proyecto Blender</a>
      <a style={linkStyle} href={assets.renderUrl} download="render.png">Render PNG</a>
      {assets.animationUrl!==undefined&&<a style={linkStyle} href={assets.animationUrl} download="animation.mp4">Animación MP4</a>}
    </div>
    <small style={{ opacity:.72 }}>
      Activos reales exportados por Blender; el render confirma que se produjo una imagen,
      no una validación automática de la fidelidad ni de la calidad artística. El visor
      geométrico rápido de PHOENIX no sustituye al proyecto Blender.
    </small>
  </section>
}
