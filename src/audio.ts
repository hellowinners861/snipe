import type { Settings } from './storage';
import { assetUrl } from './rendering';
import type { Simulation, GameEvent } from './simulation';
import { SOUND_SPEED,windAt } from './physics';
import { length, sub, type V3 } from './math';

type Bus='music'|'weapon'|'environment'|'ui';
const names=['ambient','shot_ranger','shot_sentinel','shot_kestrel','shot_atlas','bolt','reload','impact_metal','impact_paper','impact_dirt','click','success'];
export class Audio {
  context?:AudioContext; master?:GainNode; buses=new Map<Bus,GainNode>(); buffers=new Map<string,AudioBuffer>();
  private music?:AudioBufferSourceNode; private wind?:AudioBufferSourceNode; private windGain?:GainNode;
  private initialized?:Promise<void>; private pending:{time:number;name:string;position:V3;gain:number}[]=[];
  private lastTime=0; private muted=false; warning='';
  constructor(public settings:Settings){}
  async unlock():Promise<void> {
    if(!this.context) {
      this.context=new AudioContext();
      this.master=this.context.createGain();const compressor=this.context.createDynamicsCompressor();
      compressor.threshold.value=-15;compressor.ratio.value=6;this.master.connect(compressor);compressor.connect(this.context.destination);
      for(const name of ['music','weapon','environment','ui'] as Bus[]){const bus=this.context.createGain();bus.connect(this.master);this.buses.set(name,bus);}
      this.updateVolumes();
    }
    await this.context.resume().catch(()=>{this.warning='音声を再開するには音量ボタンを押してください。';});
    this.initialized??=this.load();await this.initialized;
    this.startMusic();
  }
  private async load():Promise<void> {
    const ctx=this.context!;
    const outcomes=await Promise.allSettled(names.map(async name=>{
      const response=await fetch(assetUrl(`audio/${name}.wav`));if(!response.ok)throw new Error(name);
      this.buffers.set(name,await ctx.decodeAudioData(await response.arrayBuffer()));
    }));
    if(outcomes.some(r=>r.status==='rejected'))this.warning='一部の音源を読み込めませんでした。無音でもプレイできます。';
  }
  updateVolumes():void {
    if(!this.context)return;const t=this.context.currentTime;
    this.master?.gain.setTargetAtTime(this.muted?0:this.settings.master,t,0.05);
    for(const [name,bus]of this.buses)bus.gain.setTargetAtTime(this.settings[name],t,0.1);
  }
  toggle():void{this.muted=!this.muted;this.updateVolumes();void this.unlock();}
  get isMuted():boolean{return this.muted;}
  private startMusic():void {
    if(this.music||!this.context||!this.buffers.has('ambient'))return;
    const source=this.context.createBufferSource();source.buffer=this.buffers.get('ambient')!;source.loop=true;source.connect(this.buses.get('music')!);source.start();this.music=source;
    const buffer=this.context.createBuffer(1,this.context.sampleRate*3,this.context.sampleRate),data=buffer.getChannelData(0);
    let last=0;
    for(let i=0;i<data.length;i++){last=(last+0.018*(Math.random()*2-1))/1.018;data[i]=last*1.9;}
    const wind=this.context.createBufferSource();wind.buffer=buffer;wind.loop=true;
    const filter=this.context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=600;
    this.windGain=this.context.createGain();this.windGain.gain.value=0.15;
    wind.connect(filter);filter.connect(this.windGain);this.windGain.connect(this.buses.get('environment')!);wind.start();this.wind=wind;
  }
  play(name:string,bus:Bus='weapon',gain=1,position?:V3,eye?:V3):void {
    const ctx=this.context,buffer=this.buffers.get(name);if(!ctx||!buffer||ctx.state!=='running')return;
    const source=ctx.createBufferSource();source.buffer=buffer;const volume=ctx.createGain();volume.gain.value=gain;source.connect(volume);
    if(position&&eye) {
      const pan=ctx.createStereoPanner(),offset=sub(position,eye),distance=length(offset);
      pan.pan.value=Math.max(-1,Math.min(1,offset.x/Math.max(10,distance*0.35)));
      const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=Math.max(1200,12000-distance*10);
      volume.gain.value*=1/(1+distance/140);volume.connect(filter);filter.connect(pan);pan.connect(this.buses.get(bus)!);
    }else volume.connect(this.buses.get(bus)!);
    source.start();source.onended=()=>{source.disconnect();volume.disconnect();};
  }
  handle(event:GameEvent,sim:Simulation):void {
    if(event.type==='shot')this.play(`shot_${sim.rifle.id}`,'weapon',0.7);
    if(event.type==='cycle')this.play('bolt','weapon',0.22);
    if(event.type==='reload')this.play('reload','weapon',0.6);
    if(event.type==='empty')this.play('click','weapon',0.4);
    if(event.type==='finish')this.play(event.success?'success':'click','ui',0.5);
    if(event.type==='impact'&&event.shot?.impact) {
      const contact=event.shot.impact,name=contact.target?(contact.kind==='paper'?'impact_paper':'impact_metal'):'impact_dirt';
      this.pending.push({time:(event.shot.impactTime??sim.time)+length(sub(contact.point,sim.eye))/(sim.env.soundSpeed??SOUND_SPEED),name,position:contact.point,gain:contact.target?1:0.6});
      if(event.shot.counted&&sim.settings.preset!=='simulation')this.play('click','ui',0.25);
    }
  }
  update(sim?:Simulation,delta=0):void {
    if(!sim)return;
    this.lastTime=sim.phase==='result'?Math.max(this.lastTime,sim.time)+Math.min(delta,0.1):sim.time;
    for(const event of this.pending.filter(e=>e.time<=this.lastTime))this.play(event.name,'environment',event.gain,event.position,sim.eye);
    this.pending=this.pending.filter(e=>e.time>this.lastTime);
    if(this.context&&this.windGain)this.windGain.gain.setTargetAtTime(0.08+Math.min(0.4,length(windAt(sim.eye,sim.time,sim.env))/20),this.context.currentTime,0.2);
  }
  clear():void{this.pending=[];this.lastTime=0;}
  pause():void{void this.context?.suspend();}
  resume():void{void this.context?.resume();}
}
