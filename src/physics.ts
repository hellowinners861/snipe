import { add, sub, scale, length, lerp, v3, type V3, clamp } from './math';
import type { Ammo, Rifle, Mission, TargetSpec } from './data';
import assetManifest from '../public/assets/manifest.json';

export const STEP = 1/240;
export const GRAVITY = 9.80665;
export const AIR_DENSITY = 1.225;
export const SOUND_SPEED = 343;
export interface BallisticProfile { mass: number; area: number; drag: number; speed: number; sightHeight:number; muzzleForward:number }
export interface Body { p: V3; v: V3 }
export interface Environment { wind: V3; gusts: boolean; seed: number; density: number; gravity: number; soundSpeed?:number; temperatureK?:number }
export const environmentFor = (m: Mission, seed: number): Environment => {
  const [temperatureK,pressurePa]=({range:[288.15,101325],quarry:[296.15,100700],valley:[280.15,92500],alpine:[270.15,82000]} as const)[m.map];
  return { wind:{...m.wind}, gusts:m.gusts, seed, density:pressurePa/(287.05*temperatureK), gravity:GRAVITY,temperatureK,soundSpeed:Math.sqrt(1.4*287.05*temperatureK) };
};
export const profileFor = (r: Rifle, a: Ammo): BallisticProfile => {
  const anchors=assetManifest.rifleAnchors[r.id];
  return { mass:r.mass, area:r.area, drag:a.drag, speed:r.speed*a.speed,sightHeight:anchors.eye_point[1]-anchors.muzzle[1],muzzleForward:anchors.muzzle[2]-anchors.eye_point[2] };
};
// Original fictional Cd curve, not an empirical model of any real cartridge.
export function dragCoefficient(mach: number): number {
  const curve = [[0,0.20],[0.8,0.21],[1,0.38],[1.25,0.34],[2,0.27],[3,0.24],[4,0.24]];
  for(let i=1;i<curve.length;i++) if(mach<=curve[i][0]) {
    const [x0,y0]=curve[i-1], [x1,y1]=curve[i]; return y0+(y1-y0)*clamp((mach-x0)/(x1-x0),0,1);
  }
  return curve.at(-1)![1];
}
export function windAt(p: V3, time: number, env: Environment): V3 {
  if(!env.gusts) return {...env.wind};
  const phase=env.seed*0.013;
  return add(env.wind, v3(
    2.8*Math.sin(p.z*0.009+time*0.43+phase)+0.8*Math.sin(time*0.93+p.x*0.04),
    0.25*Math.sin(time*0.3+p.z*0.006+phase),
    1.1*Math.sin(p.z*0.007-time*0.36+phase),
  ));
}
function acceleration(p: V3, v: V3, time: number, profile: BallisticProfile, env: Environment): V3 {
  const relative=sub(v,windAt(p,time,env)), speed=length(relative);
  const k=env.density*dragCoefficient(speed/(env.soundSpeed??SOUND_SPEED))*profile.drag*profile.area/(2*profile.mass);
  return add(v3(0,-env.gravity,0),scale(relative,-k*speed));
}
export function integrate(body: Body, time: number, dt: number, profile: BallisticProfile, env: Environment): Body {
  const p=body.p, v=body.v;
  const a1=acceleration(p,v,time,profile,env);
  const p2=add(p,scale(v,dt/2)), v2=add(v,scale(a1,dt/2));
  const a2=acceleration(p2,v2,time+dt/2,profile,env);
  const p3=add(p,scale(v2,dt/2)), v3a=add(v,scale(a2,dt/2));
  const a3=acceleration(p3,v3a,time+dt/2,profile,env);
  const p4=add(p,scale(v3a,dt)), v4=add(v,scale(a3,dt));
  const a4=acceleration(p4,v4,time+dt,profile,env);
  return {
    p:add(p,scale(add(add(v,scale(v2,2)),add(scale(v3a,2),v4)),dt/6)),
    v:add(v,scale(add(add(a1,scale(a2,2)),add(scale(a3,2),a4)),dt/6)),
  };
}
export function targetAt(target: TargetSpec, time: number): V3 {
  const p={...target.position}, m=target.motion;
  if(m) p[m.vertical?'y':'x']+=m.amplitude*Math.sin(time*Math.PI*2/m.period+m.phase);
  return p;
}
export interface Box { min: V3; max: V3 }
export interface Contact { fraction: number; point: V3; target?: TargetSpec; local?: V3; quality: number; kind: string }
export function segmentBox(a: V3,b: V3,box: Box): number | null {
  let near=0, far=1;
  for(const key of ['x','y','z'] as const) {
    const d=b[key]-a[key];
    if(Math.abs(d)<1e-10) { if(a[key]<box.min[key]||a[key]>box.max[key])return null; continue; }
    let t0=(box.min[key]-a[key])/d,t1=(box.max[key]-a[key])/d;
    if(t0>t1)[t0,t1]=[t1,t0]; near=Math.max(near,t0);far=Math.min(far,t1);
    if(near>far)return null;
  }
  return near;
}
export function collide(a: V3,b: V3,time: number,dt: number,targets: TargetSpec[],boxes: Box[]=[]): Contact|null {
  let first:Contact|null=null;
  const accept=(contact:Contact) => { if(!first||contact.fraction<first.fraction)first=contact; };
  for(const target of targets) {
    const dz=b.z-a.z;
    if(Math.abs(dz)<1e-12)continue;
    const f=(target.position.z-a.z)/dz;
    if(f<0||f>1)continue;
    const p=lerp(a,b,f), center=targetAt(target,time+dt*f), local=sub(p,center);
    const ratio=Math.hypot(local.x,local.y)/target.radius;
    if(ratio<=1)accept({fraction:f,point:p,target,local,quality:ratio<=0.22?1:ratio<=0.55?0.8:0.5,kind:target.kind});
  }
  if(a.y>0 && b.y<=0) {
    const f=a.y/(a.y-b.y);accept({fraction:f,point:lerp(a,b,f),quality:0,kind:'ground'});
  }
  for(const box of boxes) {
    const f=segmentBox(a,b,box);if(f!==null)accept({fraction:f,point:lerp(a,b,f),quality:0,kind:'stone'});
  }
  return first;
}
const zeroCache=new Map<string,number>();
export function zeroAngle(profile:BallisticProfile, distance=100):number {
  const key=JSON.stringify([profile,distance]);const cached=zeroCache.get(key);if(cached!==undefined)return cached;
  const env:Environment={wind:v3(),gusts:false,seed:0,density:AIR_DENSITY,gravity:GRAVITY};
  let lo=0,hi=0.12;
  for(let n=0;n<25;n++) {
    const angle=(lo+hi)/2;
    let b:Body={p:v3(0,-profile.sightHeight,profile.muzzleForward),v:v3(0,Math.sin(angle)*profile.speed,Math.cos(angle)*profile.speed)}, t=0;
    while(b.p.z<distance && t<4) {
      const next=integrate(b,t,1/120,profile,env);
      if(next.p.z>=distance){b={p:lerp(b.p,next.p,(distance-b.p.z)/(next.p.z-b.p.z)),v:next.v};break;}
      b=next;t+=1/120;
    }
    if(b.p.y>0)hi=angle;else lo=angle;
  }
  const result=(lo+hi)/2;zeroCache.set(key,result);return result;
}
