/* Phoenix Articulation 3D — original, independent quaternion-based animation math.
 * Hierarchical rigid-bone FK, quaternion interpolation/blending, CCD end-effector IK,
 * optional hinge limits, retarget mapping, sockets and engine adapter.
 * This is NOT mesh skinning, physics or a renderer; use licensed/original skinned GLB
 * with Three.js, Babylon.js, Godot, Unity or another actual 3D engine for production.
 */
const PhoenixArticulation3D = (() => {
  'use strict';
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const clamp = (v,a,b) => Math.min(b,Math.max(a,v));
  const check = (ok,msg) => {if(!ok)throw Error('PhoenixArticulation3D: '+msg)};
  const vec = (x=0,y=0,z=0) => [x,y,z];
  const quat = () => [0,0,0,1];
  const copy = v => [...v];
  const valid = (v,n) => Array.isArray(v)&&v.length===n&&v.every(finite);
  const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  const scale=(a,s)=>a.map(x=>x*s);
  const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const length=a=>Math.hypot(...a);
  const norm=(a,eps=1e-9)=>{const d=length(a);return d<eps?vec():scale(a,1/d)};
  function qNorm(q){check(valid(q,4),'invalid quaternion');let d=Math.hypot(...q);check(d>1e-9,'zero quaternion');return q.map(x=>x/d)}
  const qInverse=q=>[-q[0],-q[1],-q[2],q[3]];
  function qMul(a,b){
    return [
      a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
      a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
      a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
      a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]
    ];
  }
  function qAxis(axis,angle){
    check(valid(axis,3)&&finite(angle),'invalid axis angle');
    const n=norm(axis);check(length(n)>0,'zero axis');
    return [...scale(n,Math.sin(angle/2)),Math.cos(angle/2)];
  }
  function rotate(v,q) {
    const u=[q[0],q[1],q[2]];
    const t=scale(cross(u,v),2);
    return add(v,add(scale(t,q[3]),cross(u,t)));
  }
  function slerp(a,b,t){
    const x=qNorm(a), y=qNorm(b);t=clamp(t,0,1);
    const signed=dot(x,y), target=signed<0?y.map(v=>-v):y;
    const c=clamp(Math.abs(signed),-1,1);
    if(c>.9995)return qNorm(x.map((v,i)=>v+(target[i]-v)*t));
    const angle=Math.acos(c),d=Math.sin(angle);
    return qNorm(x.map((v,i)=>v*Math.sin((1-t)*angle)/d+target[i]*Math.sin(t*angle)/d));
  }
  function fromTo(a,b){
    const u=norm(a),v=norm(b);
    if(length(u)<1e-8||length(v)<1e-8)return quat();
    const d=clamp(dot(u,v),-1,1);
    if(d>.999999)return quat();
    if(d<-.999999){
      const ortho=Math.abs(u[0])<.8?[1,0,0]:[0,1,0];
      return qAxis(norm(cross(u,ortho)),Math.PI);
    }
    const c=cross(u,v);
    return qNorm([c[0],c[1],c[2],1+d]);
  }
  function hingeLimit(q,hinge) {
    if(!hinge)return qNorm(q);
    const axis=norm(hinge.axis);
    const projected=dot(q.slice(0,3),axis);
    const twistLength=Math.hypot(projected,q[3]);
    if(twistLength<1e-9)return quat(); // 180° swing, zero twist
    const signed=Math.atan2(projected/twistLength,q[3]/twistLength)*2;
    const angle=Math.atan2(Math.sin(signed),Math.cos(signed));
    return qAxis(axis,clamp(angle,hinge.min,hinge.max));
  }
  function createRig(input){
    check(input&&Array.isArray(input.bones)&&input.bones.length>0&&input.bones.length<=256,'invalid rig');
    const lookup=new Map();
    for(const b of input.bones){
      check(b&&typeof b.id==='string'&&b.id.length>0&&!lookup.has(b.id),'invalid duplicate bone');
      check(finite(b.length)&&b.length>0,'invalid bone length '+b.id);
      const axis=b.axis??[0,1,0], offset=b.offset??[0,0,0], rotation=b.rotation??quat();
      check(valid(axis,3)&&length(axis)>0&&valid(offset,3),'invalid bone vectors '+b.id);
      if(b.hinge){
        check(valid(b.hinge.axis,3)&&length(b.hinge.axis)>0&&finite(b.hinge.min)
          &&finite(b.hinge.max)&&b.hinge.min<=b.hinge.max,'invalid hinge '+b.id);
      }
      lookup.set(b.id,{id:b.id,parent:b.parent??null,length:b.length,
        axis:norm(axis),offset:copy(offset),rotation:qNorm(rotation),
        hinge:b.hinge?{axis:norm(b.hinge.axis),min:b.hinge.min,max:b.hinge.max}:null});
    }
    const ordered=[],done=new Set(),visiting=new Set();
    function visit(id){
      check(lookup.has(id),'unknown parent '+id);
      check(!visiting.has(id),'cyclic hierarchy');
      if(done.has(id))return;
      visiting.add(id);const b=lookup.get(id);
      if(b.parent!==null)visit(b.parent);
      visiting.delete(id);done.add(id);ordered.push(b);
    }
    for(const id of lookup.keys())visit(id);
    const sockets=Object.create(null);
    for(const s of input.sockets??[]){
      check(s&&typeof s.id==='string'&&s.id.length>0&&!sockets[s.id]
        &&lookup.has(s.bone),'invalid socket');
      const pos=s.position??[0,0,0],rot=s.rotation??quat();
      check(valid(pos,3),'invalid socket position');
      sockets[s.id]={bone:s.bone,position:copy(pos),rotation:qNorm(rot)};
    }
    return {bones:ordered,index:Object.fromEntries(ordered.map(b=>[b.id,b])),sockets};
  }
  function restPose(rig){
    return {root:{position:vec(),rotation:quat()},
      rotations:Object.fromEntries(rig.bones.map(b=>[b.id,copy(b.rotation)]))};
  }
  function fk(rig,pose) {
    check(valid(pose.root.position,3)&&valid(pose.root.rotation,4),'invalid root pose');
    const world=Object.create(null),rootQ=qNorm(pose.root.rotation);
    for(const b of rig.bones){
      const parent=b.parent===null?null:world[b.parent];
      const parentQ=parent?parent.rotation:rootQ;
      const origin=parent?parent.tip:pose.root.position;
      const position=add(origin,rotate(b.offset,parentQ));
      const local=hingeLimit(pose.rotations[b.id]??b.rotation,b.hinge);
      const rotation=qNorm(qMul(parentQ,local));
      const tip=add(position,rotate(scale(b.axis,b.length),rotation));
      world[b.id]={position,tip,rotation,parentRotation:parentQ};
    }
    return world;
  }
  function socket(rig,world,id){
    const s=rig.sockets[id];check(s,'unknown socket '+id);
    const bone=world[s.bone];check(bone,'socket bone missing');
    return {position:add(bone.position,rotate(s.position,bone.rotation)),
      rotation:qNorm(qMul(bone.rotation,s.rotation))};
  }
  function ik(rig,pose,effector,target,options={}){
    check(rig.index[effector],'unknown IK effector');
    check(valid(target,3),'invalid IK target');
    const maxBones=clamp(Math.floor(options.maxBones??5),1,rig.bones.length);
    const maxIterations=clamp(Math.floor(options.iterations??20),1,80);
    const tolerance=Math.max(.0001,options.tolerance??.02);
    const weight=clamp(options.weight??1,0,1);
    const chain=[];
    for(let id=effector;id!==null&&chain.length<maxBones;id=rig.index[id].parent)chain.push(id);
    let world=fk(rig,pose),distance=Infinity,iterations=0;
    for(let pass=0;pass<maxIterations;pass++){
      distance=length(sub(world[effector].tip,target));
      if(distance<=tolerance)break;
      for(const id of chain){
        const j=world[id],tip=world[effector].tip;
        const deltaWorld=slerp(quat(),fromTo(sub(tip,j.position),sub(target,j.position)),weight);
        const parent=j.parentRotation;
        const localDelta=qMul(qMul(qInverse(parent),deltaWorld),parent);
        pose.rotations[id]=hingeLimit(qNorm(qMul(localDelta,pose.rotations[id]??rig.index[id].rotation)),
          rig.index[id].hinge);
        world=fk(rig,pose);
      }
      iterations++;
    }
    distance=length(sub(world[effector].tip,target));
    return {world,reached:distance<=tolerance,distance,iterations};
  }
  function clip(input){
    check(input&&typeof input.id==='string'&&finite(input.duration)&&input.duration>0,'invalid clip');
    const tracks=Object.create(null);
    for(const [name,frames] of Object.entries(input.tracks??{})){
      check(Array.isArray(frames)&&frames.length>0,'invalid clip track');
      tracks[name]=frames.map(f=>{
        check(f&&finite(f.time)&&f.time>=0&&f.time<=input.duration&&valid(f.rotation,4),
          'invalid quaternion keyframe');
        return {time:f.time,rotation:qNorm(f.rotation)};
      }).sort((a,b)=>a.time-b.time);
      check(tracks[name].every((f,i)=>!i||f.time>tracks[name][i-1].time),'duplicate keyframe time');
    }
    const root=Object.create(null);
    for(const key of ['position','rotation']){
      if(!Array.isArray(input.root?.[key]))continue;
      root[key]=input.root[key].map(f=>{
        check(f&&finite(f.time)&&f.time>=0&&f.time<=input.duration
          &&valid(f.value,key==='position'?3:4),'invalid root keyframe');
        return {time:f.time,value:key==='rotation'?qNorm(f.value):copy(f.value)};
      }).sort((a,b)=>a.time-b.time);
    }
    return {id:input.id,duration:input.duration,loop:input.loop!==false,tracks,root,
      events:[...(input.events??[])].sort((a,b)=>a.time-b.time)};
  }
  function sampleKeys(frames,time,fallback,angular=true){
    if(!frames||!frames.length)return copy(fallback);
    if(time<=frames[0].time)return copy(frames[0].rotation??frames[0].value);
    if(time>=frames[frames.length-1].time)
      return copy(frames[frames.length-1].rotation??frames[frames.length-1].value);
    let n=1;while(n<frames.length&&frames[n].time<time)n++;
    const a=frames[n-1],b=frames[n],t=(time-a.time)/(b.time-a.time);
    const x=a.rotation??a.value,y=b.rotation??b.value;
    return angular?slerp(x,y,t):x.map((v,i)=>v+(y[i]-v)*t);
  }
  function sample(rig,c,seconds){
    check(finite(seconds),'invalid sample time');
    const t=c.loop?((seconds%c.duration)+c.duration)%c.duration:clamp(seconds,0,c.duration);
    const pose=restPose(rig);
    for(const [name,frames] of Object.entries(c.tracks)){
      check(rig.index[name],'unknown animated bone '+name);
      pose.rotations[name]=hingeLimit(sampleKeys(frames,t,pose.rotations[name]),rig.index[name].hinge);
    }
    pose.root.position=sampleKeys(c.root.position,t,pose.root.position,false);
    pose.root.rotation=sampleKeys(c.root.rotation,t,pose.root.rotation,true);
    return pose;
  }
  function blend(rig,a,b,weight,mask=null){
    const t=clamp(weight,0,1),out=restPose(rig);
    out.root.position=a.root.position.map((v,i)=>v+(b.root.position[i]-v)*t);
    out.root.rotation=slerp(a.root.rotation,b.root.rotation,t);
    for(const bone of rig.bones)out.rotations[bone.id]=mask&& !mask.has(bone.id)
      ? copy(a.rotations[bone.id]) : hingeLimit(slerp(a.rotations[bone.id],b.rotations[bone.id],t),bone.hinge);
    return out;
  }
  function createAnimator(rig,definitions,initial,onEvent=()=>{}){
    const clips=Object.create(null);
    for(const def of definitions){const c=clip(def);check(!clips[c.id],'duplicate clip');clips[c.id]=c}
    check(clips[initial],'unknown initial clip');
    let state=initial,time=0,fade=null;
    const layers=new Map();
    function pose(){
      let value=sample(rig,clips[state],time);
      if(fade)value=blend(rig,fade.from,value,fade.duration===0?1:fade.elapsed/fade.duration);
      for(const layer of layers.values()){
        const p=sample(rig,clips[layer.clip],layer.time);
        value=blend(rig,value,p,layer.weight,layer.mask);
      }
      return value;
    }
    function emit(c,from,to){
      if(to<=from)return [];
      const out=[],first=c.loop?Math.floor(from/c.duration):0,last=c.loop
        ?Math.min(Math.floor(to/c.duration),first+8):0;
      for(let cycle=first;cycle<=last;cycle++)for(const e of c.events){
        const when=e.time+cycle*c.duration;
        if(when>from&&when<=to)out.push({...e,clip:c.id,cycle});
      }
      return out;
    }
    return {
      play(id,opts={}){
        check(clips[id],'unknown clip '+id);
        if(id===state&&!opts.reset)return;
        const previous=pose();state=id;time=0;
        const duration=opts.fade??.18;check(finite(duration)&&duration>=0,'invalid fade');
        fade=duration?{from:previous,duration,elapsed:0}:null;
      },
      layer(name,id,opts={}){
        check(clips[id],'unknown layer');
        const mask=opts.mask?new Set(opts.mask):null;
        if(mask)for(const bone of mask)check(rig.index[bone],'unknown layer bone');
        layers.set(name,{clip:id,time:0,mask,weight:clamp(opts.weight??1,0,1)});
      },
      removeLayer(name){layers.delete(name)},
      update(dt){
        check(finite(dt)&&dt>=0&&dt<=1,'invalid delta');
        const last=time;time+=dt;const events=emit(clips[state],last,time);
        for(const l of layers.values()){
          const prev=l.time;l.time+=dt;events.push(...emit(clips[l.clip],prev,l.time));
        }
        if(fade){fade.elapsed+=dt;if(fade.elapsed>=fade.duration)fade=null}
        events.forEach(onEvent);return events;
      },
      pose,state:()=>state,world:()=>fk(rig,pose()),
    };
  }
  function retarget(sourceRig,targetRig,sourcePose,mapping={},rootScale=1){
    check(finite(rootScale)&&rootScale>0,'invalid retarget scale');
    const result=restPose(targetRig);
    result.root.position=scale(sourcePose.root.position,rootScale);
    result.root.rotation=copy(sourcePose.root.rotation);
    for(const b of targetRig.bones){
      const from=mapping[b.id]??b.id;
      if(sourceRig.index[from]&&sourcePose.rotations[from])
        result.rotations[b.id]=hingeLimit(copy(sourcePose.rotations[from]),b.hinge);
    }
    return result;
  }
  function applyToThree(rig,pose,lookup,rootObject){
    check(lookup&&typeof lookup==='object','Three bone lookup required');
    for(const bone of rig.bones){
      const node=lookup[bone.id],q=pose.rotations[bone.id];
      if(!node)continue;
      check(node.quaternion&&typeof node.quaternion.set==='function','invalid bone adapter '+bone.id);
      node.quaternion.set(q[0],q[1],q[2],q[3]);
    }
    if(rootObject){
      const p=pose.root.position,q=pose.root.rotation;
      check(rootObject.position?.set&&rootObject.quaternion?.set,'invalid root adapter');
      rootObject.position.set(...p);rootObject.quaternion.set(...q);
    }
  }
  return Object.freeze({createRig,restPose,fk,ik,socket,clip,sample,blend,createAnimator,
    retarget,applyToThree,quaternion:{identity:quat,multiply:qMul,normalize:qNorm,
    slerp,axisAngle:qAxis,rotate,fromTo},vector:{add,sub,scale,length,norm,cross,dot}});
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PhoenixArticulation3D;
