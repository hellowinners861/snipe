import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/simulation';
import { defaultSettings } from '../src/storage';
import { missions, defaultLoadout, getAmmo, getRifle, validateData, type Mission, type TargetSpec, type Loadout } from '../src/data';
import { STEP, integrate, targetAt } from '../src/physics';
import { length, sub, lerp, scale } from '../src/math';

const settings=()=>({...defaultSettings,prediction:false});
function advance(sim:Simulation,seconds:number):void {for(let i=0;i<Math.ceil(seconds/STEP);i++)sim.step();}
function aimForTest(sim:Simulation,target:TargetSpec):void {
  // Test-only solver for fictional game data; never imported into the app.
  sim.breath=true;
  for(let n=0;n<8;n++) {
    let body={p:sim.muzzle,v:scale(sim.shotDirection(),sim.profile.speed)},t=0;
    while(body.p.z<target.position.z&&t<10) {
      const next=integrate(body,sim.time+t,STEP,sim.profile,sim.env);
      if(next.p.z>=target.position.z) {
        const f=(target.position.z-body.p.z)/(next.p.z-body.p.z),point=lerp(body.p,next.p,f),center=targetAt(target,sim.time+t+STEP*f),error=sub(point,center);
        sim.yaw-=error.x/target.position.z;sim.pitch-=error.y/target.position.z;break;
      }
      body=next;t+=STEP;
    }
  }
}
describe('データ・装填・時計',()=>{
  it('すべてのミッションの推奨装備が互換性を持つ',()=>{expect(()=>validateData()).not.toThrow();expect(missions).toHaveLength(12);for(const m of missions)expect(getAmmo(m.ammo).families).toContain(getRifle(m.rifle).family);});
  it('不適合な弾薬を装填できない',()=>{expect(()=>new Simulation(missions[0],{rifle:'ranger',ammo:'reactive',scope:'field'},settings())).toThrow();});
  it('手動ボルトでは次弾が薬室へ送られるまで撃てない',()=>{
    const sim=new Simulation(missions[0],defaultLoadout(missions[0]),{...settings(),preset:'simulation',autoBolt:false});
    const initial=sim.totalRounds;sim.queueFire();sim.step();expect(sim.totalRounds).toBe(initial-1);expect(sim.action).toBe('fired');
    sim.queueFire();sim.step();expect(sim.shots).toHaveLength(1);
    sim.queueReload();advance(sim,1.5);expect(sim.chamber).toBe(true);expect(sim.action).toBe('ready');expect(sim.totalRounds).toBe(initial-1);
  });
  it('マガジン交換と自動送弾で弾が増減しない',()=>{
    const sim=new Simulation(missions[0],defaultLoadout(missions[0]),settings());
    sim.queueFire();advance(sim,1.5);const rounds=sim.totalRounds;sim.queueReload();advance(sim,4);expect(sim.totalRounds).toBe(rounds);expect(sim.chamber).toBe(true);
  });
  it('30/60/120/144fpsでも同一の発射は同じ軌跡になる',()=>{
    const shotAt=(fps:number)=>{const sim=new Simulation(missions[0],defaultLoadout(missions[0]),settings());sim.queueFire();for(let i=0;i<fps*2;i++)sim.advance(1/fps);return sim.shots[0];};
    const first=shotAt(30);for(const fps of [60,120,144]){const shot=shotAt(fps);expect(shot.counted).toBe(first.counted);expect(length(sub(shot.body.p,first.body.p))).toBeLessThan(0.001);}
  });
  it('長い中断は自動停止し時間を飛ばさない',()=>{const sim=new Simulation(missions[0],defaultLoadout(missions[0]),settings());sim.advance(2);expect(sim.phase).toBe('paused');expect(sim.time).toBe(0);sim.resume();sim.advance(1/60);expect(sim.tick).toBe(4);});
  it('停止・再開で押しっぱなしの射撃を引き継がない',()=>{const sim=new Simulation(missions[0],defaultLoadout(missions[0]),settings());sim.queueFire();sim.pause();sim.resume();sim.step();expect(sim.shots).toHaveLength(0);});
  it('倍率は弾道に影響しない',()=>{const a=new Simulation(missions[0],defaultLoadout(missions[0]),settings()),b=new Simulation(missions[0],defaultLoadout(missions[0]),settings());a.zoom=3;b.zoom=9;a.queueFire();b.queueFire();advance(a,1);advance(b,1);expect(a.shots[0].body).toEqual(b.shots[0].body);});
  it('0発の終了でも有限の得点を返す',()=>{const sim=new Simulation(missions[0],defaultLoadout(missions[0]),settings());sim.finish(false,'終了');expect(Number.isFinite(sim.result!.score)).toBe(true);expect(sim.result!.score).toBe(0);});
  it('制限時刻ちょうどの命中を許可し、直後の命中を拒否する',()=>{
    const m:Mission={...missions[0],targets:[{...missions[0].targets[0],position:{x:0,y:2,z:10}}],time:STEP,rounds:1};
    const make=(z:number)=>{const sim=new Simulation(m,defaultLoadout(m),settings());sim.shots.push({id:1,body:{p:{x:0,y:2,z:9},v:{x:0,y:0,z}},initialVelocity:{x:0,y:0,z},fired:0,active:true,points:[],times:[],speed:z,counted:false,aim:{yaw:0,pitch:0,elevation:0,windage:0,cant:0}});sim.env.density=0;sim.env.gravity=0;sim.step();return sim;};
    expect(make(240).result?.success).toBe(true);expect(make(239).result?.success).toBe(false);
  });
});
describe('ミッション到達可能性',()=>{
  for(const preset of ['assist','standard','simulation'] as const)for(const mission of missions) {
    it(`M${mission.id} / ${preset}: 推奨装備で全標的を達成できる`,()=>{
      const sim=new Simulation(mission,defaultLoadout(mission),{...settings(),preset,autoBolt:preset!=='simulation'},861);
      let attempts=0;
      while(sim.phase==='running'&&attempts<mission.rounds) {
        while(sim.action!=='ready'&&sim.phase==='running'){if(sim.action==='empty'||sim.action==='fired')sim.queueReload();sim.step();}
        const target=sim.currentTarget;if(!target||sim.phase!=='running')break;
        aimForTest(sim,target);sim.queueFire();sim.step();attempts++;
        let guard=0;while(sim.shots.at(-1)!.active&&sim.phase==='running'&&guard++<3000)sim.step();
      }
      expect(sim.result?.success,`hits ${sim.targetsHit.size}, shots ${sim.shots.length}, time ${sim.time}`).toBe(true);
      expect(sim.result!.medal).toBe('GOLD');expect(sim.time).toBeLessThan(mission.time||Infinity);
    });
  }
});
