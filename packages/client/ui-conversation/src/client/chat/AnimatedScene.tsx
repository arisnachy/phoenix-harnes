import { createElement, useState, type CSSProperties, type ReactNode } from 'react'
import css from './AnimatedScene.module.css'
type Shape = 'g'|'circle'|'ellipse'|'rect'|'line'|'path'|'polygon'|'polyline'|'text'
type Part = { shape:Shape; attrs?:Record<string,string|number>; text?:string; children?:Part[]; motion?:{kind:string;duration?:number;delay?:number;amount?:number;origin?:[number,number]} }
export type AnimatedSceneNode = {type:'animated_scene';label:string;width:number;height:number;caption?:string;parts:Part[]}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const only=(v:Record<string,unknown>,ks:string[])=>Object.keys(v).every(k=>ks.includes(k))
const num=(v:unknown,a:number,b:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b
const str=(v:unknown,n:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=n
const geometry:Record<Shape,string[]>={g:[],circle:['cx','cy','r'],ellipse:['cx','cy','rx','ry'],rect:['x','y','width','height','rx','ry'],line:['x1','y1','x2','y2'],path:['d'],polygon:['points'],polyline:['points'],text:['x','y','fontSize','textAnchor']}
const required:Record<Shape,string[]>={g:[],circle:['cx','cy','r'],ellipse:['cx','cy','rx','ry'],rect:['x','y','width','height'],line:['x1','y1','x2','y2'],path:['d'],polygon:['points'],polyline:['points'],text:['x','y']}
const paint=['fill','stroke','strokeWidth','opacity','strokeLinecap','strokeLinejoin']
function validAttr(k:string,v:unknown):boolean{
 if(k==='fill'||k==='stroke')return typeof v==='string'&&/^(?:none|currentColor|#[0-9a-f]{3}|#[0-9a-f]{4}|#[0-9a-f]{6}|#[0-9a-f]{8})$/i.test(v)
 if(k==='d')return str(v,4000)&&/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/.test(v)&&/^[Mm]/.test(v.trim())
 if(k==='points')return str(v,3000)&&/^[0-9eE.,+\-\s]+$/.test(v)
 if(k==='textAnchor')return typeof v==='string'&&['start','middle','end'].includes(v)
 if(k==='strokeLinecap')return typeof v==='string'&&['butt','round','square'].includes(v)
 if(k==='strokeLinejoin')return typeof v==='string'&&['miter','round','bevel'].includes(v)
 if(k==='opacity')return num(v,0,1)
 if(k==='strokeWidth')return num(v,0,32)
 if(k==='fontSize')return num(v,6,100)
 return num(v,['r','rx','ry','width','height'].includes(k)?0:-2048,2048)
}
function validPart(v:unknown,depth:number,count:{n:number;paths:number}):boolean{
 if(!obj(v)||depth>5||++count.n>120||!only(v,['shape','attrs','text','children','motion'])||typeof v.shape!=='string'||!Object.prototype.hasOwnProperty.call(geometry,v.shape))return false
 const shape=v.shape as Shape,attrs=v.attrs===undefined?{}:v.attrs
 if(!obj(attrs)||!only(attrs,[...geometry[shape],...paint])||!required[shape].every(k=>Object.prototype.hasOwnProperty.call(attrs,k))||!Object.entries(attrs).every(([k,x])=>validAttr(k,x)))return false
 for(const k of ['d','points']){const val=attrs[k];if(typeof val==='string')count.paths+=val.length}
 if(count.paths>18000)return false
 if(shape==='g'){if(!Array.isArray(v.children)||!v.children.length||v.text!==undefined||!v.children.every(x=>validPart(x,depth+1,count)))return false}
 else if(v.children!==undefined||(shape==='text'?!str(v.text,160):v.text!==undefined))return false
 if(v.motion!==undefined){
  const m=v.motion
  if(!obj(m)||!only(m,['kind','duration','delay','amount','origin'])||typeof m.kind!=='string'||!['pulse','float','spin','sway','blink','travel'].includes(m.kind))return false
  if(m.duration!==undefined&&!num(m.duration,.5,30))return false
  if(m.delay!==undefined&&!num(m.delay,0,30))return false
  if(m.amount!==undefined&&!num(m.amount,0,100))return false
  if(m.origin!==undefined&&(!Array.isArray(m.origin)||m.origin.length!==2||!m.origin.every(x=>num(x,-2048,2048))))return false
 }
 return true
}
export function validateAnimatedScene(v:unknown):v is AnimatedSceneNode{
 if(!obj(v)||!only(v,['type','label','width','height','caption','parts'])||v.type!=='animated_scene'||!str(v.label,180)||!num(v.width,40,1200)||!num(v.height,40,800)||(v.caption!==undefined&&!str(v.caption,500))||!Array.isArray(v.parts)||!v.parts.length||v.parts.length>120)return false
 const count={n:0,paths:0};return v.parts.every(p=>validPart(p,0,count))
}
function renderPart(p:Part,i:number):ReactNode{
 const graphic=createElement(p.shape,{...p.attrs,key:i},p.shape==='g'?p.children?.map(renderPart):p.shape==='text'?p.text:undefined)
 if(!p.motion)return graphic
 const m=p.motion
 const style={animationDuration:(m.duration??2)+'s',animationDelay:(m.delay??0)+'s',transformBox:m.origin?'view-box':'fill-box',transformOrigin:m.origin?m.origin[0]+'px '+m.origin[1]+'px':'center','--scene-distance':(m.amount??10)+'px','--scene-angle':(m.amount??12)+'deg','--scene-scale':1+Math.min(m.amount??10,40)/100} as CSSProperties
 return <g key={i} className={css.motion} data-motion={m.kind} style={style}>{graphic}</g>
}
export function AnimatedScene({node}:{node:AnimatedSceneNode}):ReactNode{
 const [paused,setPaused]=useState(false)
 return <figure className={css.scene} data-paused={paused}>
 <svg role="img" aria-label={node.label} viewBox={'0 0 '+node.width+' '+node.height} style={{maxWidth:node.width}}>{node.parts.map(renderPart)}</svg>
 <figcaption><span>{node.caption??node.label}</span><button type="button" aria-pressed={paused} onClick={()=>setPaused(p=>!p)}>{paused?'Reanudar':'Pausar'}</button></figcaption>
 </figure>
}
