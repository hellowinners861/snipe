import { describe, it, expect } from 'vitest';
import { integrate, collide, environmentFor, profileFor, windAt, segmentBox, STEP, zeroAngle, type Body, type Environment } from '../src/physics';
import { missions, rifles, ammos } from '../src/data';
import { v3, length, sub, lerp } from '../src/math';
const still:Environment={wind:v3(),gusts:false,seed:0,density:0,gravity:9.80665};
const profile=profileFor(rifles[1],ammos[0]);
describe('外部弾道',()=>{
  it('無抵抗では解析解と一致する',()=>{
    let body:Body={p:v3(2,20,3),v:v3(4,8,100)};
    for(let i=0;i<1200;i++)body=integrate(body,i*STEP,STEP,profile,still);
    expect(length(sub(body.p,v3(22,20+8*5-9.80665*25/2,503)))).toBeLessThan(0.001);
  });
  it('無風の抵抗は力学的エネルギーを散逸する',()=>{
    const env={...still,density:1.225};let body:Body={p:v3(0,50,0),v:v3(5,40,790)};
    let energy=profile.mass*length(body.v)**2/2+profile.mass*env.gravity*body.p.y;
    for(let i=0;i<800;i++){
      body=integrate(body,i*STEP,STEP,profile,env);
      const current=profile.mass*length(body.v)**2/2+profile.mass*env.gravity*body.p.y;
      expect(current).toBeLessThanOrEqual(energy+1e-7);energy=current;
    }
  });
  it('左右が対称な風は横変位の符号を反転する',()=>{
    const end=(x:number)=>{let b:Body={p:v3(0,20,0),v:v3(0,5,790)};for(let i=0;i<400;i++)b=integrate(b,i*STEP,STEP,profile,{...still,density:1.225,wind:v3(x,0,0)});return b.p;};
    const a=end(5),b=end(-5);expect(a.x).toBeGreaterThan(0);expect(a.x).toBeCloseTo(-b.x,10);expect(a.y).toBeCloseTo(b.y,10);
  });
  it('刻みを半分にしても900mでの着弾差は10mm以内',()=>{
    const end=(dt:number)=>{let b:Body={p:v3(0,65,0),v:v3(3,12,800)},t=0;const env=environmentFor(missions[11],861);while(b.p.z<900&&t<5){const next=integrate(b,t,dt,profile,env);if(next.p.z>=900)return lerp(b.p,next.p,(900-b.p.z)/(next.p.z-b.p.z));b=next;t+=dt;}throw new Error('range');};
    expect(length(sub(end(STEP),end(STEP/2)))).toBeLessThan(0.01);
  });
  it('基準角で仮想100mの光軸へ到達する',()=>{
    for(const rifle of rifles) {
      const p=profileFor(rifle,ammos[0]),a=zeroAngle(p);let b:Body={p:v3(0,-p.sightHeight,p.muzzleForward),v:v3(0,Math.sin(a)*p.speed,Math.cos(a)*p.speed)},t=0;
      while(b.p.z<100){const n=integrate(b,t,STEP,p,{...still,density:1.225});if(n.p.z>=100){expect(Math.abs(lerp(b.p,n.p,(100-b.p.z)/(n.p.z-b.p.z)).y)).toBeLessThan(0.001);break;}b=n;t+=STEP;}
    }
  });
  it('風場が位置・時刻・種に対して再現可能',()=>{
    const env=environmentFor(missions[8],861);expect(windAt(v3(10,2,400),3,env)).toEqual(windAt(v3(10,2,400),3,env));
    expect(windAt(v3(10,2,400),3,env)).not.toEqual(windAt(v3(10,2,600),3,env));
  });
});
describe('連続衝突',()=>{
  const target={id:'thin',position:v3(0,2,50),radius:0.5,kind:'paper' as const};
  it('一刻みで薄い的を通過しても検出する',()=>{
    const hit=collide(v3(0,2,48),v3(0,2,53),0,STEP,[target]);expect(hit?.target?.id).toBe('thin');expect(hit?.fraction).toBeCloseTo(0.4);
  });
  it('移動標的の接触時点の位置を使う',()=>{
    const moving={...target,motion:{amplitude:3,period:8,phase:0}};
    const dt=0.2,f=0.5,x=3*Math.sin((1+dt*f)*Math.PI*2/8);
    expect(collide(v3(x,2,48),v3(x,2,52),1,dt,[moving])?.target?.id).toBe('thin');
  });
  it('手前の遮蔽物だけで弾を止める',()=>{
    const box={min:v3(-1,1,49),max:v3(1,3,49.2)};
    const hit=collide(v3(0,2,48),v3(0,2,53),0,STEP,[target],[box]);expect(hit?.kind).toBe('stone');expect(hit?.target).toBeUndefined();
  });
  it('平行・内部・不交差の区間を正しく扱う',()=>{
    const box={min:v3(-1,-1,-1),max:v3(1,1,1)};
    expect(segmentBox(v3(0,0,-2),v3(0,0,2),box)).toBe(0.25);
    expect(segmentBox(v3(2,0,-2),v3(2,0,2),box)).toBeNull();
    expect(segmentBox(v3(),v3(0,0,2),box)).toBe(0);
  });
});
