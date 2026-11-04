import { clamp } from './math';
import type { Preset, Quality } from './data';
export interface Settings {
  preset: Preset; quality: Quality; sensitivity: number; inverted: boolean; leftHanded: boolean;
  autoBolt: boolean; autoFocus: boolean; holdBreathToggle: boolean; scopeToggle: boolean;
  reducedMotion: boolean; prediction: boolean; unit: 'mrad'|'MOA';
  master: number; music: number; weapon: number; environment: number; ui: number;
}
export const defaultSettings:Settings={preset:'assist',quality:'high',sensitivity:1,inverted:false,leftHanded:false,autoBolt:true,autoFocus:true,holdBreathToggle:false,scopeToggle:true,reducedMotion:false,prediction:true,unit:'mrad',master:0.65,music:0.32,weapon:0.7,environment:0.4,ui:0.5};
export interface Progress { version:number; completed:number; bests:Record<string,number>; settings:Settings }
export class Storage {
  data:Progress={version:1,completed:0,bests:{},settings:{...defaultSettings}};
  warning='';
  constructor() {
    try {
      const raw=localStorage.getItem('snipe.v1');if(!raw)return;
      const parsed=JSON.parse(raw);
      if(parsed.version!==1)return;
      this.data.completed=Number.isInteger(parsed.completed)?clamp(parsed.completed,0,12):0;
      if(parsed.bests&&typeof parsed.bests==='object')for(const [key,value] of Object.entries(parsed.bests)) if(typeof value==='number'&&Number.isFinite(value))this.data.bests[key]=clamp(value,0,1000);
      const input=parsed.settings??{};
      for(const key of Object.keys(defaultSettings) as (keyof Settings)[]) {
        if(typeof input[key]===typeof defaultSettings[key]) (this.data.settings as unknown as Record<string,unknown>)[key]=input[key];
      }
      if(!['assist','standard','simulation'].includes(this.data.settings.preset))this.data.settings.preset='assist';
      if(!['low','high'].includes(this.data.settings.quality))this.data.settings.quality='high';
      if(!['mrad','MOA'].includes(this.data.settings.unit))this.data.settings.unit='mrad';
      for(const key of ['master','music','weapon','environment','ui'] as const)this.data.settings[key]=Number.isFinite(this.data.settings[key])?clamp(this.data.settings[key],0,1):defaultSettings[key];
      this.data.settings.sensitivity=clamp(Number(this.data.settings.sensitivity)||1,0.2,3);
    } catch { this.warning='保存データを読み込めなかったため、初期設定で開始しました。'; }
  }
  save():void {try{localStorage.setItem('snipe.v1',JSON.stringify(this.data));}catch{this.warning='この環境では保存できません。プレイは続けられます。';}}
  finish(id:number,score:number,key:string):void {
    this.data.completed=Math.max(id,this.data.completed);
    this.data.bests[key]=Math.max(this.data.bests[key]??0,score);this.save();
  }
}
export async function saveReplay(replay:unknown):Promise<void> {
  if(!('indexedDB' in globalThis))return;
  try {
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open('snipe-replays',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('replays',{autoIncrement:true});
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    const tx=db.transaction('replays','readwrite'),store=tx.objectStore('replays');
    store.add(JSON.stringify(replay));
    const keys=store.getAllKeys(),values=store.getAll();
    values.onsuccess=()=>{
      const sizes=values.result.map(value=>new TextEncoder().encode(String(value)).length);
      let bytes=sizes.reduce((a,b)=>a+b,0),count=sizes.length,index=0;
      while(count>20||bytes>20*1024*1024){store.delete(keys.result[index]);bytes-=sizes[index];count--;index++;}
    };
    await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
  } catch { /* Replay persistence is optional; the live result is retained in memory. */ }
}
