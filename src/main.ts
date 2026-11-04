import './style.css';
import { World } from './rendering';
import { Audio } from './audio';
import { Simulation, type Shot } from './simulation';
import { Storage, saveReplay, type Settings } from './storage';
import { rifles, ammos, scopes, missions, defaultLoadout, getRifle, getAmmo, getScope, availableAmmo, validateData, type Mission, type Loadout, type RifleId, type AmmoProperty } from './data';
import { targetAt, windAt } from './physics';
import { length, sub, clamp, rad } from './math';

validateData();
const app=document.querySelector<HTMLDivElement>('#app')!;
const canvas=document.querySelector<HTMLCanvasElement>('#world')!;
const store=new Storage(),settings=store.data.settings,audio=new Audio(settings);
const touch=matchMedia('(pointer: coarse)').matches;
type Screen='home'|'missions'|'briefing'|'playing'|'paused'|'result'|'replay'|'settings';
let world:World;
let screen:Screen='home',settingsReturn:Screen='home',selected=missions[0],loadout:Loadout=defaultLoadout(selected);
let sim:Simulation|undefined,practice=false,loading=true,seed=861,shotIndex=-1,replayView:'side'|'top'|'shooter'='side',replayComparison:'wind'|'gravity'|undefined;
let renderToken=0,lastFrame=performance.now(),hudFrame=0,predictionFrame=0,loadToken=0,errorText='';
const practiceConfig={distance:1,size:1,wind:0,speed:1};
const escape=(value:string):string=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const icon=(name:string):string=>{
  const paths:Record<string,string>={arrow:'M4 12h16M13 5l7 7-7 7',scope:'M12 2v6m0 8v6M2 12h6m8 0h6M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14',volume:'M4 9h4l5-4v14l-5-4H4V9zm12-1c3 2 3 6 0 8m3-11c5 4 5 10 0 14',settings:'M5 7h14M5 17h14M9 4v6m6 4v6',back:'M15 5l-7 7 7 7',pause:'M8 5v14m8-14v14',wind:'M3 8h13c5 0 5-6 1-6M3 12h17M3 16h11c5 0 5 6 1 6',play:'M8 4l13 8-13 8V4',check:'M5 12l4 4L19 6',close:'M5 5l14 14M5 19L19 5',reload:'M20 7V3l-4 4a8 8 0 1 0 4 8M20 3h-5',breath:'M3 12h4l3-7 4 14 3-7h4'};
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]??paths.scope}"/></svg>`;
};
function number(value:number):string{return String(value).padStart(2,'0');}
function clock(value:number):string{return Number.isFinite(value)?`${number(Math.floor(value/60))}:${number(Math.floor(value%60))}`:'— : —';}
function action(label:string,name:string,cls=''):string{const names:Record<string,string>={sound:'音声を切り替える',settings:'設定を開く',pause:'一時停止',scope:'スコープ',reload:'装填・ボルト',breath:'息止め',trigger:'発射'};return `<button class="${cls}" data-action="${name}" ${names[name]?`aria-label="${names[name]}"`:''}>${label}</button>`;}
function header(back?:string):string {
  return `<header class="topbar"><button class="wordmark" data-action="home" aria-label="SNIPE ホーム">${icon('scope')}<span>SNIPE<span class="logo-period">.</span></span></button><div class="topbar-center">PRECISION IS A STATE OF MIND</div><nav>${back?action(icon('back')+'<span>戻る</span>',back,'icon-label'):''}${action(icon('volume'), 'sound', 'icon-button '+(audio.isMuted?'muted':''))}${action(icon('settings'),'settings','icon-button')}</nav></header>`;
}
function footer():string{return `<footer class="footer"><span><i class="status-dot"></i> SINGLE PLAYER · PHYSICS BASED</span><span>HEADPHONES RECOMMENDED ${icon('volume')}</span><span>01 / FIELD NOTES</span></footer>`;}
function loadingLayer():string{return loading?'<div class="loading" role="status"><span class="spinner"></span>射場と装備を準備しています</div>':'';}
function home():string {
  return `${header()}<main class="home-screen"><section class="hero"><div class="eyebrow"><span class="small-line"></span>THE ART OF A SINGLE SHOT</div><h1>一発に、<br><em>静けさを。</em></h1><p>距離を測る。風を読む。呼吸を整える。<br>スコープの向こうにある、一点へ。</p><div class="hero-actions">${action('ミッションを始める '+icon('arrow'),'missions','primary')}${action('自由練習 '+icon('scope'),'practice','secondary')}</div><div class="hero-detail"><span>3D TARGET SHOOTING</span><b>観察から、着弾まで。</b></div></section><aside class="weapon-caption"><span class="eyebrow">01 / YOUR FIRST RIFLE</span><h2>RANGER</h2><p>LIGHT BOLT ACTION <span>·</span> FIELD 3–9×</p><div class="caption-line"></div></aside><div class="home-bottom"><span>12 MISSIONS</span><span>4 RIFLES</span><span>REAL-TIME BALLISTICS</span></div></main>${footer()}`;
}
function missionCards():string {
  return missions.map(m=>{const unlocked=practice||m.id<=store.data.completed+1;const completed=m.id<=store.data.completed;
    return `<button class="mission-card ${m.id===selected.id?'selected':''} ${!unlocked?'locked':''}" data-mission="${m.id}" ${unlocked?'':'disabled'}><span class="mission-number">${number(m.id)}</span><span class="mission-card-text"><b>${m.name}</b><small>${m.english}</small></span><span class="mission-card-meta">${completed?icon('check'):unlocked?icon('arrow'):'LOCKED'}</span></button>`;
  }).join('');
}
function missionScreen():string {
  return `${header('home')}<main class="selection"><section class="mission-panel"><div class="eyebrow">${practice?'OPEN RANGE':'FIELD PROGRAM'}</div><h1>${practice?'自由練習':'ミッション'}</h1><p class="subtle">${practice?'すべての装備と環境で、納得の一発を。':'近い一枚から、遥か向こうの一点まで。'}</p><div class="mission-list">${missionCards()}</div></section><section class="mission-summary"><div class="eyebrow">${number(selected.id)} / ${selected.english}</div><h2>${selected.name}</h2><p>${selected.text}</p><div class="summary-stats"><div><small>DISTANCE</small><b>${Math.min(...selected.distances)}—${Math.max(...selected.distances)}<em>m</em></b></div><div><small>TIME</small><b>${selected.time?clock(selected.time):'FREE'}</b></div><div><small>TARGETS</small><b>${number(selected.targets.length)}</b></div></div><div class="lesson"><span>今回のテーマ</span><strong>${selected.lesson}</strong></div>${action('装備を確認する '+icon('arrow'),'briefing','primary')}</section></main>${footer()}`;
}
function equipment():string {
  const r=getRifle(loadout.rifle),s=getScope(loadout.scope);
  return `${header('missions')}<main class="equipment"><section class="equipment-panel"><div class="eyebrow">${practice?'FREE PRACTICE':`MISSION ${number(selected.id)}`} / LOADOUT</div><h1>${selected.name}</h1><p class="subtle">${selected.lesson} · ${practice?99:selected.rounds}発 ${selected.time&&!practice?'· '+clock(selected.time):''}</p><label class="field-label">01 / ライフル</label><div class="rifle-grid">${rifles.map(rifle=>{const locked=!practice&&rifle.unlock>store.data.completed;return `<button class="rifle-card ${r.id===rifle.id?'selected':''}" data-rifle="${rifle.id}" ${locked?'disabled':''}><span>${rifle.name}</span><small>${locked?'M'+number(rifle.unlock)+' 達成後':rifle.action==='bolt'?'BOLT ACTION':'SEMI AUTO'}</small></button>`;}).join('')}</div><div class="rifle-description"><h3>${r.subtitle}</h3><p>${r.description}</p><div class="stat-bars">${['精密さ','距離への適性','扱いやすさ'].map((label,i)=>`<div><span>${label}</span><i style="--fill:${r.stats[i]*20}%"></i></div>`).join('')}</div></div><div class="loadout-selects"><label><span class="field-label">02 / 弾薬</span><select id="ammo-select">${availableAmmo(r.id,store.data.completed,practice).map(a=>`<option value="${a.property}" ${loadout.ammo===a.property?'selected':''}>${a.name} · ${a.tag}</option>`).join('')}</select></label><p class="select-note">${getAmmo(loadout.ammo).description}</p><label><span class="field-label">03 / スコープ</span><select id="scope-select">${scopes.filter(s=>practice||s.unlock<=store.data.completed).map(s=>`<option value="${s.id}" ${loadout.scope===s.id?'selected':''}>${s.name} · ${s.plane}</option>`).join('')}</select></label><label><span class="field-label">04 / 操作</span><select id="preset-select"><option value="assist" ${settings.preset==='assist'?'selected':''}>アシスト · 操作を覚える</option><option value="standard" ${settings.preset==='standard'?'selected':''}>スタンダード · 自分で調整</option><option value="simulation" ${settings.preset==='simulation'?'selected':''}>シミュレーション · 手動操作</option></select></label></div>${practice?practiceControls():''}<div class="brief-hint">${icon('scope')}<span>${selected.hint}</span></div>${selected.id===10&&loadout.ammo!=='reactive'?'<div class="notice">この課題にはリアクティブ用の弾薬が必要です。</div>':''}${action((practice?'練習を開始する':'射座へ進む')+' '+icon('arrow'),'start','primary start-button')}</section><aside class="equipment-caption"><div class="eyebrow">${r.category}</div><h2>${r.name}</h2><p>${s.name} / ${getAmmo(loadout.ammo).tag}</p><span>ORIGINAL 3D MODEL · ${r.family} SERIES</span></aside></main>${footer()}`;
}
function practiceControls():string {
  return `<details class="practice-options"><summary>練習条件を変更</summary><label>距離倍率 <input id="practice-distance" type="range" min="0.5" max="2" step="0.1" value="${practiceConfig.distance}"/><output>${practiceConfig.distance.toFixed(1)}×</output></label><label>標的サイズ <input id="practice-size" type="range" min="0.5" max="2" step="0.1" value="${practiceConfig.size}"/><output>${practiceConfig.size.toFixed(1)}×</output></label><label>射座の風 <input id="practice-wind" type="range" min="-8" max="8" step="0.5" value="${practiceConfig.wind}"/><output>${practiceConfig.wind} m/s</output></label><label>移動速度 <input id="practice-speed" type="range" min="0" max="2" step="0.25" value="${practiceConfig.speed}"/><output>${practiceConfig.speed.toFixed(1)}×</output></label></details>`;
}
function reticle():string {
  return `<div id="scope-mask" class="scope-mask"><div class="scope-ring"><svg id="reticle" viewBox="0 0 1000 1000" aria-label="照準目盛り"><g id="reticle-marks"></g><circle cx="500" cy="500" r="2.3" fill="#131c14"/></svg><div class="scope-scrim"></div></div><div class="scope-top"><span id="scope-name"></span><b id="scope-plane"></b></div><div class="scope-bottom"><span id="scope-magnification"></span><span id="scope-readout"></span></div></div>`;
}
function playing():string {
  return `<main class="play-screen ${settings.leftHanded?'left-handed':''}"><header class="play-header"><div class="play-brand">${icon('scope')}<span>SNIPE.</span><i></i><div><small>${practice?'FREE PRACTICE':'MISSION '+number(selected.id)}</small><strong>${selected.name}</strong></div></div><div class="play-progress"><small>TARGETS</small><b id="hit-count">0 / ${selected.targets.length}</b></div><div class="play-clock"><small>${selected.time?'TIME REMAINING':'NO TIME LIMIT'}</small><b id="clock"></b></div>${action(icon('pause'),'pause','icon-button')}</header><div id="target-labels"></div><div id="aim-dot"></div><div id="prediction" class="prediction-dot"></div>${reticle()}<div id="play-toast" class="play-toast"></div><div id="pointer-prompt" class="pointer-prompt">クリックで視点を操作 <span>Esc で一時停止</span></div><div class="observation"><span class="eyebrow">FIELD OBSERVATION</span><div class="wind-indicator">${icon('wind')}<b id="wind-readout"></b><span id="wind-arrow">→</span></div><small>射座の風 · 吹いていく向き</small><div id="range-readout" class="range-readout"></div><div id="level" class="level"><i></i><span>LEVEL</span></div></div><section class="adjustments"><div class="adjustments-title"><span>SCOPE CONTROL</span>${action('基準へ戻す','reset-dials','tiny-button')}</div><div class="dial-row"><span>上下 <small>ELEVATION</small></span>${action('−','elevation-down','step-button')}<b id="elevation-readout">0.0</b>${action('＋','elevation-up','step-button')}</div><div class="dial-row"><span>左右 <small>WINDAGE</small></span>${action('−','windage-down','step-button')}<b id="windage-readout">0.0</b>${action('＋','windage-up','step-button')}</div><div class="zoom-row"><span>倍率</span>${action('−','zoom-out','step-button')}<b id="zoom-readout"></b>${action('＋','zoom-in','step-button')}</div><details class="advanced-optics"><summary>ピント・傾き</summary><label>ピント <input id="focus" type="range" min="25" max="1000" step="5" value="100"/></label><div class="optics-buttons">${action('左へ傾く','cant-left')}${action('水平','level')}${action('右へ傾く','cant-right')}</div>${settings.preset==='simulation'?'<label>眼の位置 <input id="eye-offset" type="range" min="-1" max="1" step="0.05" value="0"/></label>':''}</details></section><div class="bottom-hud"><div class="ammo-hud"><span id="weapon-name"></span><div><b id="chamber-rounds"></b><span>/</span><span id="reserve-rounds"></span></div><small id="weapon-state"></small></div><div class="desktop-help"><span><kbd>右クリック</kbd> スコープ</span><span><kbd>Shift</kbd> 息止め</span><span><kbd>R</kbd> 装填</span><span><kbd>↑↓←→</kbd> ダイヤル</span><span><kbd>F</kbd> 測距</span></div><div class="breath-meter"><span>BREATH</span><div><i id="breath-fill"></i></div></div></div><div class="touch-controls">${action(icon('scope'),'scope','control scope-control')}${action(icon('reload'),'reload','control reload-control')}${action(icon('breath'),'breath','control breath-control')}${action('FIRE','trigger','fire-control')}${action('測距','measure','control measure-control')}</div>${practice?action('練習を終了','finish-practice','practice-finish'):''}</main>`;
}
function pauseScreen():string {
  return `${header()}<div class="modal-backdrop"><section class="pause-card"><span class="eyebrow">TAKE A BREATH</span><h1>一時停止</h1><p>呼吸を整えて、次の一発へ。</p>${action('射撃を再開する '+icon('play'),'resume','primary')}${action('同じ条件でやり直す','retry','secondary')}${action('操作・音・画質を設定','settings','text-button')}${practice?action('別の風の変化で練習する','new-conditions','text-button'):''}${action('ミッション選択に戻る','missions','text-button')}</section></div>`;
}
function hitMap():string {
  const shots=sim?.shots??[];
  return `<svg class="hit-map" viewBox="0 0 220 220" aria-label="各標的の中心を重ねた着弾図"><circle cx="110" cy="110" r="96" fill="#d6d6bd"/><circle cx="110" cy="110" r="53" fill="#858f76"/><circle cx="110" cy="110" r="21" fill="#d5bd7e"/><path d="M110 8v204M8 110h204" stroke="#354b35" stroke-width="0.5"/>${shots.filter(s=>s.impact?.local&&s.impact.target).map(s=>{const r=s.impact!.target!.radius,l=s.impact!.local!;return `<circle cx="${110+l.x/r*96}" cy="${110-l.y/r*96}" r="3.5" fill="${s.counted?'#1e4628':'#a65f3d'}"/>`;}).join('')}</svg>`;
}
function resultScreen():string {
  const result=sim!.result!;
  return `${header()}<main class="results"><section class="result-main"><span class="eyebrow">${practice?'PRACTICE REPORT':'MISSION '+number(selected.id)+' / FIELD REPORT'}</span><div class="result-heading"><div><h1>${result.success?'一発が、届いた。':'次の一発へ。'}</h1><p>${result.reason}</p></div><span class="medal ${result.medal.toLowerCase()}">${result.medal}</span></div><div class="result-score"><b>${result.score.toString().padStart(3,'0')}</b><span>/ 1000 <small>PRECISION SCORE</small></span></div><div class="result-stats"><div><small>命中 / 標的</small><b>${result.hits} / ${sim!.mission.targets.length}</b></div><div><small>使用弾数</small><b>${result.shots}<em>発</em></b></div><div><small>経過時間</small><b>${clock(sim!.time)}</b></div></div><div class="result-breakdown"><span>精度 <b>${Math.round(result.precision*100)}%</b></span><span>弾の効率 <b>${Math.round(result.efficiency*100)}%</b></span><span>${settings.preset==='assist'?'アシスト':settings.preset==='standard'?'スタンダード':'シミュレーション'} / ${touch?'TOUCH':'MOUSE'}</span></div><div class="result-actions">${result.success&&!practice&&selected.id<12?action('次のミッション '+icon('arrow'),'next','primary'):action('同じ条件で再挑戦 '+icon('reload'),'retry','primary')}${action('弾道を見る','replay','secondary')}${action('ミッションへ戻る','missions','text-button')}</div></section><aside class="result-target">${hitMap()}<div class="eyebrow">SHOT PLACEMENT</div><p>各標的の中心を重ねた着弾図</p><small>無風・重力なしとの比較は、弾道リプレイで確認できます。</small></aside></main>${footer()}`;
}
function replayScreen():string {
  const shot=shotIndex>=0?sim!.shots[shotIndex]:undefined;
  return `${header('result')}<main class="replay-ui"><aside class="replay-panel"><div class="eyebrow">AFTER THE SHOT</div><h1>弾道リプレイ</h1><p>緑は達成した射撃、橙はその他の軌跡。</p><div class="shot-list">${action('すべての射撃','shot-all',shotIndex<0?'selected':'')}${sim!.shots.map((s,i)=>`<button data-shot="${i}" class="${shotIndex===i?'selected':''}"><span>${number(s.id)}</span><b>${s.counted?'命中・達成':s.impact?.target?'命中':'ミス'}</b><small>${s.impactTime!==undefined?(s.impactTime-s.fired).toFixed(2)+' s':'飛翔中／領域外'}</small></button>`).join('')}</div>${shot?`<div class="shot-details"><span>到達時間 <b>${shot.impactTime!==undefined?(shot.impactTime-shot.fired).toFixed(3)+' s':'—'}</b></span><span>着弾時の速度 <b>${shot.impact?shot.speed.toFixed(0)+' m/s':'—'}</b></span><span>ゲーム内運動エネルギー <b>${shot.impact?(sim!.profile.mass*shot.speed*shot.speed/2).toFixed(0)+' J':'—'}</b></span></div>`:''}<p class="comparison-note">比較線は同じ発射条件の再計算です。要因同士の相互作用を含みます。</p></aside><div class="replay-toolbar"><div>${action('横から','view-side',replayView==='side'?'selected':'')}${action('上から','view-top',replayView==='top'?'selected':'')}${action('射手から','view-shooter',replayView==='shooter'?'selected':'')}</div><div><label>比較 <select id="comparison"><option value="">実際の軌跡のみ</option><option value="wind" ${replayComparison==='wind'?'selected':''}>無風（青線）</option><option value="gravity" ${replayComparison==='gravity'?'selected':''}>重力なし（青線）</option></select></label></div></div></main>`;
}
function checkbox(key:keyof Settings,label:string):string{return `<label class="toggle-row"><span>${label}</span><input type="checkbox" data-setting="${key}" ${settings[key]?'checked':''}/><i></i></label>`;}
function settingsScreen():string {
  return `${header('settings-back')}<main class="settings-page"><section class="settings-card"><div class="eyebrow">MAKE IT YOUR RANGE</div><h1>設定</h1><div class="settings-columns"><div><h3>操作と見やすさ</h3><label class="setting-row"><span>画質</span><select data-setting="quality"><option value="high" ${settings.quality==='high'?'selected':''}>標準</option><option value="low" ${settings.quality==='low'?'selected':''}>軽量</option></select></label><label class="setting-row"><span>照準感度</span><input type="range" min="0.2" max="3" step="0.1" value="${settings.sensitivity}" data-setting="sensitivity"/></label><label class="setting-row"><span>ダイヤル表示</span><select data-setting="unit"><option value="mrad" ${settings.unit==='mrad'?'selected':''}>mrad</option><option value="MOA" ${settings.unit==='MOA'?'selected':''}>MOA</option></select></label>${checkbox('inverted','上下の照準操作を反転')}${checkbox('leftHanded','タッチ操作を左右反転')}${checkbox('autoBolt','ボルト操作を自動にする')}${checkbox('autoFocus','ピントを自動で合わせる')}${checkbox('holdBreathToggle','息止めを押すたびに切り替える')}${checkbox('scopeToggle','スコープを押すたびに切り替える')}${checkbox('reducedMotion','反動の画面演出を抑える')}${checkbox('prediction','入門・練習で着弾予測を表示')}</div><div><h3>音量</h3>${(['master','music','weapon','environment','ui'] as const).map((key,i)=>`<label class="volume-row"><span>${['全体','BGM','発射・機関','環境・着弾','通知・UI'][i]}</span><input type="range" min="0" max="1" step="0.05" value="${settings[key]}" data-setting="${key}"/></label>`).join('')}<div class="controls-guide"><h3>PC操作</h3><p>左クリック：発射 / 右クリック：スコープ<br>ホイール：倍率 / Shift：息止め<br>R：ボルト・装填 / F：測距<br>矢印キー：上下・左右ダイヤル<br>Q・E：銃の傾き / C：水平に戻す<br>Esc：一時停止</p><small>アシストでも弾道は同じです。予測表示は未来の風や標的の動きを読みません。</small></div><p class="subtle">${escape(store.warning||audio.warning||'設定と進行はこのブラウザに保存されます。')}</p></div></div>${action('設定を保存して戻る '+icon('arrow'),'settings-back','primary')}</section></main>`;
}
function render():void {
  renderToken++;
  app.innerHTML=({home,missions:missionScreen,briefing:equipment,playing,paused:pauseScreen,result:resultScreen,replay:replayScreen,settings:settingsScreen}[screen])()+loadingLayer()+(errorText?`<div class="error-panel" role="alert"><h2>読み込みを完了できませんでした</h2><p>${escape(errorText)}</p>${action('再読み込み','reload-page','primary')}</div>`:'');
  document.body.dataset.screen=screen;
  if(screen==='playing')updateHUD();
}
async function preview():Promise<void> {
  const token=++loadToken;loading=true;render();
  try {await world.load(selected,loadout,settings);if(token!==loadToken)return;loading=false;world.mode='menu';render();}
  catch(error){if(token===loadToken){loading=false;errorText=String(error);render();}}
}
function setPreset(preset:Settings['preset']):void {
  settings.preset=preset;settings.autoBolt=preset!=='simulation';settings.autoFocus=preset!=='simulation';settings.prediction=preset==='assist';store.save();
}
function practiceMission():Mission {
  if(!practice)return selected;
  const {distance,size,wind,speed}=practiceConfig;
  return {...selected,time:0,wind:{...selected.wind,x:wind},targets:selected.targets.map(t=>({...t,position:{...t.position,z:t.position.z*distance},radius:t.radius*size,motion:t.motion&&speed>0?{...t.motion,period:t.motion.period/speed}:undefined}))};
}
async function start(sameSeed=true):Promise<void> {
  if(loading)return;
  if(!practice&&selected.id===10&&loadout.ammo!=='reactive')return;
  const mission=screen==='briefing'?practiceMission():sim?.mission??selected;
  if(!sameSeed)seed=Math.floor(Math.random()*1000000);
  void audio.unlock();audio.clear();loading=true;render();
  try {
    await world.load(mission,loadout,settings);
    sim=new Simulation(mission,{...loadout},{...settings},seed,practice);sim.boxes=world.obstacles;
    world.mode='play';loading=false;screen='playing';shotIndex=-1;lastFrame=performance.now();render();
  }catch(error){loading=false;errorText=String(error);render();}
}
function pause():void {
  if(screen!=='playing'||sim?.phase==='result')return;
  sim?.pause();screen='paused';document.exitPointerLock?.();audio.pause();render();
}
function showReplay():void {
  if(!sim?.shots.length)return;screen='replay';world.showReplay(shotIndex<0?sim.shots:[sim.shots[shotIndex]],replayView,replayComparison,sim);render();
}
async function perform(name:string):Promise<void> {
  if(!audio.context)void audio.unlock();
  if(name!=='trigger')audio.play('click','ui',0.25);
  if(name==='sound'){audio.toggle();if(screen!=='playing')render();return;}
  if(name==='reload-page'){location.reload();return;}
  if(name==='settings'){settingsReturn=screen==='playing'?'paused':screen;if(screen==='playing')pause();screen='settings';audio.resume();render();return;}
  if(name==='settings-back'){store.save();audio.updateVolumes();world.applyQuality(settings);if(sim)Object.assign(sim.settings,settings);screen=settingsReturn;render();return;}
  if(name==='pause'){pause();return;}
  if(name==='resume'){sim?.resume();screen='playing';audio.resume();lastFrame=performance.now();render();return;}
  if(name==='home'){sim=undefined;screen='home';practice=false;selected=missions[0];loadout=defaultLoadout(selected);audio.resume();await preview();return;}
  if(name==='practice'){practice=true;screen='missions';audio.resume();render();return;}
  if(name==='missions'){sim=undefined;world.mode='menu';screen='missions';audio.resume();render();return;}
  if(name==='briefing'){screen='briefing';loadout=defaultLoadout(selected);await preview();return;}
  if(name==='start'){await start();return;}
  if(name==='retry'){await start();return;}
  if(name==='new-conditions'){await start(false);return;}
  if(name==='next'){selected=missions[Math.min(11,selected.id)];loadout=defaultLoadout(selected);screen='briefing';await preview();return;}
  if(name==='result'){screen='result';world.mode='play';render();return;}
  if(name==='replay'){showReplay();return;}
  if(name==='shot-all'){shotIndex=-1;showReplay();return;}
  if(name.startsWith('view-')){replayView=name.slice(5) as typeof replayView;showReplay();return;}
  if(screen!=='playing'||!sim)return;
  if(name==='trigger')sim.queueFire();
  if(name==='scope')sim.toggleScope();
  if(name==='reload')sim.queueReload();
  if(name==='measure')sim.measure();
  if(name==='breath')sim.breath=!sim.breath;
  if(name==='elevation-up')sim.adjust('elevation',1);
  if(name==='elevation-down')sim.adjust('elevation',-1);
  if(name==='windage-up')sim.adjust('windage',1);
  if(name==='windage-down')sim.adjust('windage',-1);
  if(name==='reset-dials'){sim.elevation=0;sim.windage=0;}
  if(name==='zoom-in')sim.zoom=clamp(sim.zoom+1,sim.scope.min,sim.scope.max);
  if(name==='zoom-out')sim.zoom=clamp(sim.zoom-1,sim.scope.min,sim.scope.max);
  if(name==='cant-left')sim.cant=clamp(sim.cant-rad(1),-0.25,0.25);
  if(name==='cant-right')sim.cant=clamp(sim.cant+rad(1),-0.25,0.25);
  if(name==='level')sim.cant=0;
  if(name==='finish-practice')sim.finish(true,'自由練習の記録です。');
}
app.addEventListener('click',event=>{
  const element=(event.target as HTMLElement).closest<HTMLElement>('button');if(!element||element.hasAttribute('disabled'))return;
  if(element.dataset.action&&element.dataset.action!=='trigger'&&!(element.dataset.action==='breath'&&!settings.holdBreathToggle)&&!(element.dataset.action==='scope'&&!settings.scopeToggle))void perform(element.dataset.action);
  if(element.dataset.mission){selected=missions[Number(element.dataset.mission)-1];loadout=defaultLoadout(selected);practiceConfig.wind=selected.wind.x;void preview();}
  if(element.dataset.rifle){loadout.rifle=element.dataset.rifle as RifleId;const compatible=availableAmmo(loadout.rifle,store.data.completed,practice);if(!compatible.some(a=>a.property===loadout.ammo))loadout.ammo=compatible[0].property;void preview();}
  if(element.dataset.shot){shotIndex=Number(element.dataset.shot);showReplay();}
});
app.addEventListener('pointerdown',event=>{
  const element=(event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if(element?.dataset.action==='trigger'){event.preventDefault();sim?.queueFire();}
  if(element?.dataset.action==='breath'&&!settings.holdBreathToggle){event.preventDefault();if(sim)sim.breath=true;element.setPointerCapture(event.pointerId);}
  if(element?.dataset.action==='scope'&&!settings.scopeToggle){event.preventDefault();if(sim)sim.scoped=true;element.setPointerCapture(event.pointerId);}
});
app.addEventListener('pointerup',event=>{const element=(event.target as HTMLElement).closest<HTMLElement>('[data-action]');if(element?.dataset.action==='breath'&&!settings.holdBreathToggle&&sim)sim.breath=false;if(element?.dataset.action==='scope'&&!settings.scopeToggle&&sim)sim.scoped=false;});
app.addEventListener('pointercancel',()=>{if(sim)sim.breath=false;});
app.addEventListener('change',event=>{
  const el=event.target as HTMLInputElement|HTMLSelectElement;
  if(el.id==='ammo-select'){loadout.ammo=el.value as AmmoProperty;render();}
  if(el.id==='scope-select'){loadout.scope=el.value;void preview();}
  if(el.id==='preset-select'){setPreset(el.value as Settings['preset']);render();}
  if(el.id==='comparison'){replayComparison=(el.value||undefined) as typeof replayComparison;showReplay();}
  if(el.dataset.setting){const key=el.dataset.setting as keyof Settings;const value=el instanceof HTMLInputElement&&el.type==='checkbox'?el.checked:typeof settings[key]==='number'?Number(el.value):el.value;(settings as unknown as Record<string,unknown>)[key]=value;store.save();audio.updateVolumes();}
});
app.addEventListener('input',event=>{
  const el=event.target as HTMLInputElement;
  if(el.id.startsWith('practice-')){const key=el.id.slice(9) as keyof typeof practiceConfig;if(key in practiceConfig)practiceConfig[key]=Number(el.value);const output=el.parentElement?.querySelector('output');if(output)output.textContent=el.value+(el.id==='practice-wind'?' m/s':'×');}
  if(el.id==='focus'&&sim){sim.focus=Number(el.value);sim.settings.autoFocus=false;}
  if(el.id==='eye-offset'&&sim)sim.eyeOffset=Number(el.value);
  if(el.dataset.setting&&el.type==='range'){(settings as unknown as Record<string,unknown>)[el.dataset.setting]=Number(el.value);audio.updateVolumes();}
});
let dragPointer:number|undefined,lastX=0,lastY=0;
function aim(dx:number,dy:number):void{if(!sim||screen!=='playing')return;const handling={ranger:1.1,sentinel:1,kestrel:1.05,atlas:0.8}[sim.rifle.id];const sensitivity=0.0017*settings.sensitivity*handling/(sim.scoped?sim.zoom*0.7:1);sim.queueAim(dx*sensitivity,dy*sensitivity*(settings.inverted?1:-1));}
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{
  if(screen!=='playing'||!sim)return;
  if(e.pointerType==='mouse') {
    if(e.button===2){sim.toggleScope();return;}
    if(document.pointerLockElement!==canvas){void Promise.resolve(canvas.requestPointerLock?.()).catch(()=>sim?.tell('視点の固定を許可できませんでした。タッチ操作または対応ブラウザでお試しください。'));return;}
    if(e.button===0)sim.queueFire();
  }else{dragPointer=e.pointerId;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId);}
});
canvas.addEventListener('pointermove',e=>{if(e.pointerId===dragPointer){aim(e.clientX-lastX,e.clientY-lastY);lastX=e.clientX;lastY=e.clientY;}});
canvas.addEventListener('pointerup',e=>{if(e.pointerId===dragPointer)dragPointer=undefined;if(e.button===2&&!settings.scopeToggle&&sim)sim.scoped=false;});
canvas.addEventListener('pointercancel',()=>{dragPointer=undefined;sim?.clearInput();});
document.addEventListener('mousemove',e=>{if(document.pointerLockElement===canvas)aim(e.movementX,e.movementY);});
document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement&&screen==='playing')pause();});
canvas.addEventListener('wheel',e=>{if(screen==='playing'&&sim){e.preventDefault();sim.zoom=clamp(sim.zoom-Math.sign(e.deltaY),sim.scope.min,sim.scope.max);}},{passive:false});
window.addEventListener('keydown',e=>{
  if(e.target instanceof HTMLElement&&e.target.matches('input,select,textarea'))return;
  if(e.code==='Escape'){if(screen==='playing')pause();else if(screen==='paused')void perform('resume');return;}
  if(screen!=='playing'||!sim)return;
  const actions:Record<string,string>={KeyR:'reload',KeyF:'measure',KeyV:'scope',ArrowUp:'elevation-up',ArrowDown:'elevation-down',ArrowRight:'windage-up',ArrowLeft:'windage-down',KeyQ:'cant-left',KeyE:'cant-right',KeyC:'level',Equal:'zoom-in',Minus:'zoom-out'};
  if(actions[e.code]){e.preventDefault();if(!e.repeat||e.code.startsWith('Arrow'))void perform(actions[e.code]);}
  if(e.code==='Space'&&!e.repeat){e.preventDefault();sim.queueFire();}
  if(e.code==='ShiftLeft'||e.code==='ShiftRight'){e.preventDefault();if(settings.holdBreathToggle){if(!e.repeat)sim.breath=!sim.breath;}else sim.breath=true;}
});
window.addEventListener('keyup',e=>{if((e.code==='ShiftLeft'||e.code==='ShiftRight')&&!settings.holdBreathToggle&&sim)sim.breath=false;});
window.addEventListener('blur',()=>{if(screen==='playing')pause();});
window.addEventListener('resize',()=>{if(touch&&innerHeight>innerWidth&&screen==='playing')pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(screen==='playing')pause();audio.pause();}else if(screen!=='paused')audio.resume();});
function text(id:string,value:string):void{const el=document.getElementById(id);if(el&&el.textContent!==value)el.textContent=value;}
function updateHUD():void {
  if(!sim||screen!=='playing')return;
  text('hit-count',`${sim.targetsHit.size} / ${sim.mission.targets.length}`);text('clock',clock(sim.remaining));
  text('weapon-name',`${sim.rifle.name} / ${sim.ammo.tag}`);text('chamber-rounds',String(Number(sim.chamber)+sim.magazine).padStart(2,'0'));text('reserve-rounds',String(sim.reserve).padStart(2,'0'));
  text('weapon-state',({ready:'READY',fired:'ボルト操作待ち',cycling:'次弾を装填中',reloading:'マガジン交換中',empty:'装填してください'}[sim.action]));
  const unit=settings.unit==='mrad'?0.1:0.0001/(Math.PI/10800),suffix=settings.unit;
  text('elevation-readout',(sim.elevation*unit).toFixed(1));text('windage-readout',(sim.windage*unit).toFixed(1));text('zoom-readout',sim.zoom.toFixed(0)+'×');
  text('scope-name',sim.scope.name);text('scope-plane',sim.scope.plane);text('scope-magnification',`${sim.zoom.toFixed(0)}×`);text('scope-readout',`E ${(sim.elevation*unit).toFixed(1)} / W ${(sim.windage*unit).toFixed(1)} ${suffix}`);
  const wind=windAt(sim.eye,sim.time,sim.env),windMagnitude=length(wind);
  text('wind-readout',settings.preset==='simulation'?'旗を観察':windMagnitude.toFixed(1)+' m/s');
  const arrow=document.getElementById('wind-arrow');if(arrow){arrow.style.transform=`rotate(${Math.atan2(wind.z,wind.x)*180/Math.PI}deg)`;arrow.style.display=settings.preset==='simulation'?'none':'inline-block';}
  const current=sim.currentTarget??sim.mission.targets[0],targetPosition=targetAt(current,sim.time),distance=length(sub(targetPosition,sim.eye));
  const measured=settings.preset==='assist'?distance:sim.measuredDistance;
  text('range-readout',measured?`${measured.toFixed(0)} m · 高さ差 ${(targetPosition.y-sim.eye.y)>0?'+':''}${(targetPosition.y-sim.eye.y).toFixed(1)} m`:'F / 測距で距離を確認');
  if(sim.settings.autoFocus)sim.focus=distance;
  const mask=document.getElementById('scope-mask');if(mask)mask.classList.toggle('active',sim.scoped);
  document.getElementById('aim-dot')?.classList.toggle('hidden',sim.scoped);
  const prompt=document.getElementById('pointer-prompt');if(prompt)prompt.style.display=!touch&&!document.pointerLockElement?'block':'none';
  const toast=document.getElementById('play-toast');if(toast){toast.textContent=sim.message;toast.classList.toggle('visible',sim.messageUntil>sim.time);}
  const breath=document.getElementById('breath-fill');if(breath){breath.style.width=sim.breathLeft/4*100+'%';breath.classList.toggle('holding',sim.stable);}
  const level=document.getElementById('level');if(level){level.style.setProperty('--cant',`${sim.cant*180/Math.PI}deg`);level.classList.toggle('tilted',Math.abs(sim.cant)>0.025);}
  const labels=document.getElementById('target-labels');
  if(labels)labels.innerHTML=sim.scoped||settings.preset==='simulation'?'':sim.mission.targets.map((target,i)=>{const p=world.project(targetAt(target,sim!.time)),hit=sim!.targetsHit.has(target.id);return p.visible&&p.x>2&&p.x<98&&p.y>10&&p.y<85?`<span class="target-label ${hit?'hit':''}" style="left:${p.x}%;top:${p.y}%">${hit?'✓':number(i+1)}<small>${settings.preset==='assist'?target.position.z+' m':''}</small></span>`:'';}).join('');
  if(predictionFrame++%5===0)sim.predictionPoint=sim.predict();
  const prediction=document.getElementById('prediction');if(prediction){const p=sim.predictionPoint?world.project(sim.predictionPoint):undefined;prediction.style.display=p?.visible?'block':'none';if(p){prediction.style.left=p.x+'%';prediction.style.top=p.y+'%';}}
  updateReticle();
}
let lastReticle='';
function updateReticle():void {
  if(!sim?.scoped)return;
  const circle=document.querySelector<HTMLElement>('.scope-ring');if(!circle)return;
  const screenHeight=window.innerHeight,circleSize=circle.clientHeight;
  const f=screenHeight/(2*Math.tan(world.camera.fov/2));
  const unit=sim.scope.plane==='FFP'?sim.zoom:sim.scope.reference;
  const referenceF=screenHeight/(2*Math.tan(0.85/2))*unit;
  const gap=(sim.scope.plane==='FFP'?f:referenceF)*0.001/circleSize*1000;
  const key=`${gap.toFixed(2)}-${screenHeight}-${circleSize}`;if(key===lastReticle)return;lastReticle=key;
  const marks=document.getElementById('reticle-marks');if(!marks)return;
  let svg='<path d="M0 500h485m30 0h485M500 0v485m0 30v485" stroke="#142019" stroke-width="1.1"/>';
  for(let i=-20;i<=20;i++){if(!i)continue;const a=500+i*gap;if(a<20||a>980)continue;const len=i%5===0?13:7;svg+=`<path d="M${a} ${500-len}v${len*2}M${500-len} ${a}h${len*2}" stroke="#142019" stroke-width="1.2"/>`;if(i%5===0)svg+=`<text x="${a}" y="534" text-anchor="middle" fill="#142019" font-size="13">${Math.abs(i)}</text>`;}
  marks.innerHTML=svg;
}
function frame():void {
  const now=performance.now(),delta=(now-lastFrame)/1000;lastFrame=now;
  if(sim&&screen==='playing'&&!loading) {
    sim.advance(delta);
    if(sim.phase==='paused'){pause();}
    for(const event of sim.events.splice(0)){
      audio.handle(event,sim);
      if(event.type==='shot')world.onShot();
      if(event.type==='impact'&&event.shot)world.impact(event.shot,sim.profile.mass);
      if(event.type==='finish') {
        if(event.success&&!practice)store.finish(selected.id,sim.result!.score,`${selected.id}-${settings.preset}-${touch?'touch':'mouse'}-${settings.prediction?'predicted':'plain'}`);
        void saveReplay(sim.replayData());screen='result';document.exitPointerLock?.();render();
      }
    }
  }
  if(sim)audio.update(sim,delta);
  world.update(sim,delta);
  if(screen==='playing'&&++hudFrame%2===0)updateHUD();
}
try {
  world=new World(canvas);render();world.engine.runRenderLoop(frame);void preview();
}catch(error){loading=false;errorText='このブラウザで3D描画を開始できませんでした。WebGL対応のブラウザでお試しください。 '+String(error);render();}
