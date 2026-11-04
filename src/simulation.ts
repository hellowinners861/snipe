import { getRifle, getAmmo, getScope, type Mission, type Loadout, type TargetSpec } from './data';
import { type V3, v3, add, sub, scale, length, direction, gaussian, random, clamp, lerp } from './math';
import { STEP, environmentFor, integrate, collide, profileFor, zeroAngle, windAt, targetAt, type Body, type Contact, type Environment, type Box } from './physics';
import type { Settings } from './storage';

export interface Shot {
  id:number; body:Body; fired:number; active:boolean; points:V3[]; times:number[];
  impact?:Contact; impactTime?:number; speed:number; counted:boolean;
  aim:{yaw:number;pitch:number;elevation:number;windage:number;cant:number};
  initialVelocity:V3;
}
export type GameEvent = { type:'shot'|'impact'|'cycle'|'reload'|'empty'|'finish'; shot?:Shot; contact?:Contact; success?:boolean; message?:string };
export interface Result { success:boolean; score:number; precision:number; efficiency:number; time:number; medal:string; shots:number; hits:number; reason:string }
export class Simulation {
  readonly rifle; readonly ammo; readonly scope; readonly profile;
  env:Environment;
  tick=0; accumulator=0; phase:'running'|'paused'|'result'='running';
  yaw=0; pitch=0; elevation=0; windage=0; cant=0; zoom:number; focus=100; eyeOffset=0;
  scoped=false; breath=false; breathLeft=4; breathRecover=0; recoil=0;
  chamber=true; magazine=0; reserve=0; action:'ready'|'fired'|'cycling'|'reloading'|'empty'='ready'; actionEnd=0;
  targetsHit=new Set<string>(); shots:Shot[]=[]; events:GameEvent[]=[]; result?:Result;
  boxes:Box[]=[]; predictionPoint?:V3; measuredDistance?:number; message=''; messageUntil=0;
  private aimX=0; private aimY=0; private fireQueued=false; private reloadQueued=false; private rng:()=>number;
  private precisionTotal=0;
  constructor(public mission:Mission,public loadout:Loadout,public settings:Settings,public seed=861,public practice=false) {
    this.rifle=getRifle(loadout.rifle);this.ammo=getAmmo(loadout.ammo);this.scope=getScope(loadout.scope);
    if(!this.ammo.families.includes(this.rifle.family))throw new Error('このライフルでは使えない弾薬です。');
    this.profile=profileFor(this.rifle,this.ammo);this.env=environmentFor(mission,seed);this.rng=random(seed+103);
    const rounds=practice?99:mission.rounds;
    this.magazine=Math.min(this.rifle.capacity-1,rounds-1);this.reserve=rounds-1-this.magazine;
    this.zoom=this.scope.min;
    const first=targetAt(mission.targets[0],0);
    this.yaw=Math.atan2(first.x,first.z);this.pitch=Math.atan2(first.y-mission.height,Math.hypot(first.x,first.z));
    this.focus=length(sub(first,this.eye));zeroAngle(this.profile);
    this.tell(mission.hint,10);
  }
  get time():number{return this.tick*STEP;}
  get eye():V3{return v3(0,this.mission.height,0);}
  get totalRounds():number{return Number(this.chamber)+this.magazine+this.reserve;}
  get remaining():number{return this.mission.time?Math.max(0,this.mission.time-this.time):Infinity;}
  get autoBolt():boolean{return this.settings.preset==='assist'||this.settings.autoBolt;}
  get stable():boolean{return this.breath&&this.breathLeft>0&&this.breathRecover<=0;}
  get currentTarget():TargetSpec|undefined{return this.mission.targets.find(t=>!this.targetsHit.has(t.id));}
  get opticalAngles():{yaw:number;pitch:number} {
    const amp=this.rifle.sway*(this.stable?0.000025:0.00021)*(this.settings.preset==='assist'?0.6:1);
    const swayX=Math.sin(this.time*1.4)*amp+Math.sin(this.time*4.3+0.4)*amp*0.2;
    const swayY=Math.sin(this.time*1.15)*amp*0.75;
    return {yaw:this.yaw+swayX,pitch:this.pitch+swayY};
  }
  get muzzle():V3 {
    const sight=this.opticalAngles,d=direction(sight.yaw,sight.pitch),height=this.profile.sightHeight;
    return add(this.eye,add(scale(d,this.profile.muzzleForward),v3(Math.sin(this.cant)*height,-Math.cos(this.cant)*height,0)));
  }
  shotDirection(scatter=false):V3 {
    const sight=this.opticalAngles, c=Math.cos(this.cant),s=Math.sin(this.cant);
    const up=zeroAngle(this.profile)+this.elevation*0.0001, right=this.windage*0.0001;
    const x=scatter?gaussian(this.rng)*this.ammo.spread:0, y=scatter?gaussian(this.rng)*this.ammo.spread:0;
    return direction(sight.yaw+right*c+up*s+x,sight.pitch+up*c-right*s+y);
  }
  queueAim(dx:number,dy:number):void{this.aimX+=dx;this.aimY+=dy;}
  queueFire():void{if(this.phase==='running')this.fireQueued=true;}
  queueReload():void{if(this.phase==='running')this.reloadQueued=true;}
  tell(message:string,seconds=3):void{this.message=message;this.messageUntil=this.time+seconds;}
  toggleScope():void{this.scoped=!this.scoped;}
  pause():void{if(this.phase==='running'){this.phase='paused';this.clearInput();}}
  resume():void{if(this.phase==='paused'){this.phase='running';this.accumulator=0;this.clearInput();}}
  clearInput():void{this.fireQueued=false;this.reloadQueued=false;this.aimX=0;this.aimY=0;this.breath=false;}
  adjust(axis:'elevation'|'windage',delta:number):void{if(this.phase!=='result')this[axis]=clamp(this[axis]+delta,-250,250);}
  measure():void {
    const sight=direction(this.opticalAngles.yaw,this.opticalAngles.pitch);
    let best=Infinity,distance:number|undefined;
    for(const t of this.mission.targets) {
      const p=targetAt(t,this.time),delta=sub(p,this.eye),d=length(delta);
      const error=length(sub(scale(sight,d),delta));
      if(error<best&&error/d<0.03){best=error;distance=d;}
    }
    this.measuredDistance=distance;
    this.tell(distance?`測距 ${distance.toFixed(0)} m（視線距離）`:'測距できませんでした。');
  }
  advance(delta:number):void {
    if(this.phase!=='running')return;
    if(!Number.isFinite(delta)||delta>0.25){this.pause();this.tell('処理の中断を検出して一時停止しました。');return;}
    this.accumulator+=Math.max(0,delta);
    let steps=0;
    while(this.accumulator+1e-12>=STEP&&steps<12&&this.phase==='running') {
      this.step();this.accumulator-=STEP;steps++;
    }
    if(this.accumulator>0.25)this.pause();
  }
  step():void {
    if(this.phase!=='running')return;
    this.yaw+=this.aimX;this.pitch=clamp(this.pitch+this.aimY,-0.6,0.6);this.aimX=0;this.aimY=0;
    if(this.reloadQueued){this.reloadQueued=false;this.reload();}
    if(this.fireQueued){this.fireQueued=false;this.fire();}
    if(this.stable){this.breathLeft=Math.max(0,this.breathLeft-STEP);if(this.breathLeft===0){this.breathRecover=1.8;this.breath=false;}}
    else {this.breathRecover=Math.max(0,this.breathRecover-STEP);this.breathLeft=Math.min(4,this.breathLeft+STEP*0.65);}
    this.recoil*=Math.exp(-STEP*7);
    if((this.action==='cycling'||this.action==='reloading')&&this.time+1e-9>=this.actionEnd)this.completeAction();
    const start=this.time;
    for(const shot of this.shots) {
      if(!shot.active)continue;
      const previous=shot.body,next=integrate(previous,start,STEP,this.profile,this.env);
      const contact=collide(previous.p,next.p,start,STEP,this.mission.targets,this.boxes);
      if(contact){
        const impactTime=start+STEP*contact.fraction;
        shot.body={p:contact.point,v:lerp(previous.v,next.v,contact.fraction)};shot.active=false;
        shot.impact=contact;shot.impactTime=impactTime;shot.speed=length(shot.body.v);
        shot.points.push({...contact.point});shot.times.push(impactTime-shot.fired);
        const onTime=!this.mission.time||impactTime<=this.mission.time+1e-9;
        if(contact.target&&onTime&&!this.targetsHit.has(contact.target.id)) {
          const reaction=this.ammo.reaction*this.profile.mass*shot.speed*shot.speed/2000;
          const reacted=contact.target.threshold===undefined||reaction>=contact.target.threshold;
          const accurate=contact.quality>=(contact.target.requiredQuality??0);
          if(reacted&&accurate){this.targetsHit.add(contact.target.id);shot.counted=true;this.precisionTotal+=contact.quality;this.tell(`命中 ${this.targetsHit.size} / ${this.mission.targets.length}`,3);}
          else this.tell(reacted?'命中。内側の採点域を狙いましょう。':'命中・作動不足。弾薬の性質を確認してください。',4);
        }
        this.events.push({type:'impact',shot,contact});
      }else{
        shot.body=next;
        if(this.tick%4===0){shot.points.push({...next.p});shot.times.push(start+STEP-shot.fired);}
        if(start-shot.fired>12||next.p.z>1800||Math.abs(next.p.x)>1000){shot.active=false;this.tell('着弾を確認できませんでした。',2);}
      }
    }
    this.tick++;
    if(this.targetsHit.size===this.mission.targets.length&&!this.practice)this.finish(true,'すべての標的を達成しました。');
    else if(this.mission.time&&this.time>=this.mission.time&&!this.practice)this.finish(false,'制限時間になりました。');
    else if(this.totalRounds===0&&!this.shots.some(s=>s.active)&&!this.practice)this.finish(false,'用意された弾を使い切りました。');
  }
  private fire():void {
    if(this.action!=='ready'){if(this.action==='fired')this.tell('R／ボルトで次弾を装填してください。');return;}
    if(!this.chamber){this.events.push({type:'empty'});this.tell('弾がありません。R／装填で補充します。');return;}
    const muzzle=this.muzzle,dir=this.shotDirection(true),speed=this.profile.speed*(1+gaussian(this.rng)*(this.ammo.property==='match'?0.0004:0.0015));
    const shot:Shot={id:this.shots.length+1,body:{p:{...muzzle},v:scale(dir,speed)},initialVelocity:scale(dir,speed),fired:this.time,active:true,points:[{...muzzle}],times:[0],speed,counted:false,aim:{yaw:this.yaw,pitch:this.pitch,elevation:this.elevation,windage:this.windage,cant:this.cant}};
    this.shots.push(shot);this.chamber=false;this.action='fired';this.recoil=this.rifle.recoil;
    this.events.push({type:'shot',shot});
    if(this.rifle.action==='semi'||this.autoBolt)this.cycle();
  }
  private cycle():void {
    this.action='cycling';this.actionEnd=this.time+this.rifle.cycle;this.events.push({type:'cycle'});
  }
  private reload():void {
    if(this.action==='cycling'||this.action==='reloading')return;
    if(!this.chamber&&this.magazine>0){this.cycle();return;}
    if(this.reserve<=0){this.tell('予備弾がありません。');return;}
    if(this.magazine>=this.rifle.capacity){this.tell('マガジンは満装填です。');return;}
    this.action='reloading';this.actionEnd=this.time+this.rifle.reload;this.events.push({type:'reload'});
  }
  private completeAction():void {
    if(this.action==='reloading') {
      const count=Math.min(this.rifle.capacity-this.magazine,this.reserve);this.magazine+=count;this.reserve-=count;
      if(!this.chamber){if(this.autoBolt||this.rifle.action==='semi')this.cycle();else{this.action='empty';this.tell('R／ボルトで薬室へ送弾します。');}}
      else this.action='ready';
    } else {
      if(this.magazine>0){this.magazine--;this.chamber=true;this.action='ready';}
      else{this.action='empty';if(this.reserve>0&&this.autoBolt)this.reload();else this.tell('R／装填で予備弾を補充します。');}
    }
  }
  finish(success:boolean,reason:string):void {
    if(this.result)return;
    const count=this.mission.targets.length,shots=this.shots.length,hits=this.targetsHit.size;
    const precision=this.precisionTotal/count,efficiency=shots?hits/shots:0;
    const time=this.mission.time?this.remaining/this.mission.time:0;
    const score=Math.round(1000*(this.mission.time?(0.7*precision+0.2*efficiency+0.1*time):(0.7*precision+0.2*efficiency)/0.9));
    this.result={success,score,precision,efficiency,time,shots,hits,medal:success?(score>=900?'GOLD':score>=700?'SILVER':'BRONZE'):'RETRY',reason};
    this.phase='result';this.clearInput();this.events.push({type:'finish',success});
  }
  predict():V3|undefined {
    if(this.settings.preset!=='assist'||!this.settings.prediction||(!this.practice&&this.mission.id>3))return undefined;
    const target=this.currentTarget??this.mission.targets[0];if(!target)return undefined;
    const env={...this.env,wind:windAt(this.muzzle,this.time,this.env),gusts:false};
    let body:Body={p:this.muzzle,v:scale(this.shotDirection(),this.profile.speed)},t=0;
    while(t<8&&body.p.z<target.position.z){
      const next=integrate(body,this.time+t,1/120,this.profile,env);
      if(next.p.z>=target.position.z)return lerp(body.p,next.p,(target.position.z-body.p.z)/(next.p.z-body.p.z));
      body=next;t+=1/120;
    }
    return undefined;
  }
  replayData():unknown {return {version:1,simulationVersion:'1.0.0',seed:this.seed,mission:this.mission.id,loadout:this.loadout,settings:{preset:this.settings.preset},result:this.result,shots:this.shots};}
}
