// @vitest-environment happy-dom
import { it, expect, vi } from 'vitest';

const harness=vi.hoisted(()=>({frame:undefined as undefined|(()=>void),time:1000,replay:vi.fn()}));
vi.mock('../src/rendering',()=>({
  assetUrl:(p:string)=>'/snipe/assets/'+p,
  World:class {
    ready=true; mode='menu'; failed='';
    engine={runRenderLoop:(f:()=>void)=>{harness.frame=f;},resize:()=>undefined};
    camera={fov:0.85};obstacles=[];
    async load(){return;}
    update(){} onShot(){} impact(){} applyQuality(){}
    project(){return{x:50,y:50,visible:true};}
    showReplay(...args:unknown[]){harness.replay(...args);}
  },
}));
vi.mock('../src/audio',()=>({Audio:class {
  context?:object;warning='';isMuted=false;
  async unlock(){this.context={};}play(){} updateVolumes(){}pause(){}resume(){}clear(){}handle(){}update(){}toggle(){this.isMuted=!this.isMuted;}
}}));

it('DOM導線: 自由練習→装備→手動射撃・装填→設定→結果→リプレイ',async()=>{
  document.body.innerHTML='<canvas id="world"></canvas><div id="app"></div>';
  localStorage.clear();
  vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener(){},removeEventListener(){}}));
  vi.spyOn(performance,'now').mockImplementation(()=>harness.time);
  await import('../src/main');
  const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,0));};
  await flush();
  const click=async(selector:string)=>{const button=document.querySelector<HTMLButtonElement>(selector);expect(button,selector).not.toBeNull();button!.click();await flush();};
  const choose=async(selector:string,value:string)=>{const select=document.querySelector<HTMLSelectElement>(selector)!;select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));await flush();};
  const frames=(count:number)=>{for(let i=0;i<count;i++){harness.time+=1000/60;harness.frame!();}};
  const key=(code:string)=>window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true}));
  expect(document.body.textContent).toContain('一発に、');
  await click('[data-action="practice"]');
  expect(document.querySelectorAll('[data-mission]')).toHaveLength(12);
  expect(document.querySelector('[data-mission="12"]')!.hasAttribute('disabled')).toBe(false);
  await click('[data-mission="10"]');await click('[data-action="briefing"]');
  expect(document.body.textContent).toContain('標的に合う弾');
  await click('[data-rifle="ranger"]');
  expect(document.querySelector('#ammo-select')!.textContent).not.toContain('リアクティブ');
  await click('[data-rifle="sentinel"]');await choose('#ammo-select','reactive');await choose('#scope-select','precision');await choose('#preset-select','simulation');
  await click('[data-action="start"]');
  expect(document.body.dataset.screen).toBe('playing');
  key('Space');frames(120);
  expect(document.querySelector('#weapon-state')!.textContent).toBe('ボルト操作待ち');
  expect(document.querySelector('#hit-count')!.textContent).toBe('1 / 3');
  const rounds=document.querySelector('#chamber-rounds')!.textContent;
  key('KeyR');frames(120);expect(document.querySelector('#weapon-state')!.textContent).toBe('READY');expect(document.querySelector('#chamber-rounds')!.textContent).toBe(rounds);
  await click('[data-action="pause"]');expect(document.body.dataset.screen).toBe('paused');
  await click('[data-action="settings"]');
  expect(document.querySelector<HTMLInputElement>('[data-setting="autoBolt"]')!.checked).toBe(false);
  const checkbox=document.querySelector<HTMLInputElement>('[data-setting="reducedMotion"]')!;checkbox.checked=true;checkbox.dispatchEvent(new Event('change',{bubbles:true}));
  await click('[data-action="settings-back"]');expect(document.body.dataset.screen).toBe('paused');
  await click('[data-action="resume"]');expect(document.body.dataset.screen).toBe('playing');
  await click('[data-action="finish-practice"]');frames(1);
  expect(document.body.dataset.screen).toBe('result');
  expect(document.body.textContent).toContain('自由練習の記録');
  await click('[data-action="replay"]');expect(document.body.dataset.screen).toBe('replay');
  await click('[data-shot="0"]');await click('[data-action="view-top"]');
  await choose('#comparison','wind');
  expect(harness.replay).toHaveBeenLastCalledWith(expect.any(Array),'top','wind',expect.any(Object));
  await click('[data-action="result"]');await click('[data-action="missions"]');
  expect(document.body.dataset.screen).toBe('missions');
  expect(JSON.parse(localStorage.getItem('snipe.v1')!).completed).toBe(0);
  expect(JSON.parse(localStorage.getItem('snipe.v1')!).settings.reducedMotion).toBe(true);
});
