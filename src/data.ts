import { type V3, v3 } from './math';

export type RifleId = 'ranger' | 'sentinel' | 'kestrel' | 'atlas';
export type AmmoProperty = 'standard' | 'match' | 'low_drag' | 'low_velocity' | 'reactive';
export type Preset = 'assist' | 'standard' | 'simulation';
export type Quality = 'low' | 'high';
export interface Rifle {
  id: RifleId; name: string; category: string; subtitle: string; family: 'L' | 'M' | 'H';
  action: 'bolt' | 'semi'; capacity: number; speed: number; mass: number; area: number;
  cycle: number; reload: number; recoil: number; sway: number; unlock: number;
  stats: number[]; description: string; color: string;
}
export const rifles: Rifle[] = [
  { id: 'ranger', name: 'RANGER', category: 'LIGHT BOLT ACTION', subtitle: '軽やかに、最初の一発。', family: 'L', action: 'bolt', capacity: 5, speed: 490, mass: 0.005, area: 0.000031, cycle: 1.15, reload: 2.4, recoil: 0.45, sway: 1, unlock: 0, stats: [4, 2, 5], description: '軽量ストックと穏やかな反動。着弾を見届けやすく、精密射撃の基本を学ぶ一丁。', color: '#9c7550' },
  { id: 'sentinel', name: 'SENTINEL', category: 'PRECISION BOLT ACTION', subtitle: '静止の先に、精度がある。', family: 'M', action: 'bolt', capacity: 5, speed: 790, mass: 0.010, area: 0.000044, cycle: 1.45, reload: 2.9, recoil: 0.8, sway: 0.72, unlock: 2, stats: [5, 4, 3], description: '安定したシャーシと精密な作動。距離と風に向き合うための、標準となるライフル。', color: '#83917a' },
  { id: 'kestrel', name: 'KESTREL', category: 'SEMI AUTOMATIC', subtitle: '動く瞬間を、逃さない。', family: 'M', action: 'semi', capacity: 8, speed: 755, mass: 0.010, area: 0.000044, cycle: 0.32, reload: 2.6, recoil: 0.95, sway: 0.95, unlock: 6, stats: [4, 4, 4], description: '一回の操作で一発を放つセミオート。速い再照準ができる一方、反動からの回復が重要になる。', color: '#a69473' },
  { id: 'atlas', name: 'ATLAS', category: 'HEAVY BOLT ACTION', subtitle: '遠い一点へ、確かな存在感。', family: 'H', action: 'bolt', capacity: 3, speed: 860, mass: 0.016, area: 0.000057, cycle: 1.9, reload: 3.5, recoil: 1.35, sway: 0.56, unlock: 8, stats: [5, 5, 2], description: '重量級のロングレンジライフル。反応を必要とする標的や遠距離に強く、構え直しには時間がかかる。', color: '#626d73' },
];
export interface Ammo {
  property: AmmoProperty; name: string; tag: string; description: string; speed: number; drag: number; spread: number; reaction: number; families: string[]; unlock: number;
}
export const ammos: Ammo[] = [
  { property: 'standard', name: '標準弾', tag: 'STANDARD', description: '十分な精度と扱いやすさの基準となる弾薬。', speed: 1, drag: 1, spread: 0.00011, reaction: 1, families: ['L','M','H'], unlock: 0 },
  { property: 'match', name: '精密弾', tag: 'MATCH', description: '速度と発射方向のばらつきを小さく。重力や風の影響は変わらない。', speed: 1, drag: 1, spread: 0.000035, reaction: 1, families: ['L','M','H'], unlock: 1 },
  { property: 'low_drag', name: '低抵抗弾', tag: 'LOW DRAG', description: '速度を保ちやすい形状。遠い標的へ向けた選択。', speed: 1, drag: 0.72, spread: 0.000065, reaction: 1, families: ['M','H'], unlock: 6 },
  { property: 'low_velocity', name: '低速弾', tag: 'LOW VELOCITY', description: '飛翔と音の遅れが際立つ。専用の照準基準で扱う。', speed: 0.49, drag: 0.92, spread: 0.00009, reaction: 0.55, families: ['L','M'], unlock: 10 },
  { property: 'reactive', name: 'リアクティブ用', tag: 'REACTIVE', description: 'ゲーム内の機械標的を作動させる反応プロファイル。', speed: 0.96, drag: 1.05, spread: 0.00009, reaction: 2.2, families: ['M','H'], unlock: 9 },
];
export interface Scope { id: string; name: string; min: number; max: number; plane: 'FFP'|'SFP'; reference: number; unlock: number }
export const scopes: Scope[] = [
  { id: 'field', name: 'FIELD 3–9×', min: 3, max: 9, plane: 'SFP', reference: 9, unlock: 0 },
  { id: 'precision', name: 'PRECISION 4–16×', min: 4, max: 16, plane: 'FFP', reference: 16, unlock: 2 },
  { id: 'survey', name: 'SURVEY 6–24×', min: 6, max: 24, plane: 'FFP', reference: 24, unlock: 6 },
];
export interface TargetSpec {
  id: string; position: V3; radius: number; kind: 'paper'|'gong'|'plate'|'reactive';
  motion?: { amplitude: number; period: number; phase: number; vertical?: boolean };
  threshold?: number; requiredQuality?: number;
}
export interface Mission {
  id: number; name: string; english: string; lesson: string; text: string; hint: string;
  map: 'range'|'quarry'|'valley'|'alpine'; distances: number[]; height: number;
  time: number; rounds: number; wind: V3; gusts: boolean; radius: number;
  rifle: RifleId; ammo: AmmoProperty; scope: string; targets: TargetSpec[];
}
const missionSpecs: Omit<Mission, 'targets'>[] = [
  { id:1, name:'最初の一発', english:'FIRST LIGHT', lesson:'スコープと発射', text:'風のない訓練場。スコープを覗き、白い紙標的3枚に一発ずつ当ててください。', hint:'右クリックまたはスコープボタンで覗く。白い円を十字の中心へ。', map:'range', distances:[50,65,80], height:1.7, time:0, rounds:10, wind:v3(), gusts:false, radius:0.65, rifle:'ranger', ammo:'standard', scope:'field' },
  { id:2, name:'倍率と精度', english:'A STEADY HAND', lesson:'倍率・呼吸・採点円', text:'倍率を上げ、息を整える。3枚の標的の内側に命中させましょう。', hint:'ホイール／＋−で倍率。Shift／息止めで短時間安定します。', map:'range', distances:[100,120,150], height:1.7, time:0, rounds:5, wind:v3(), gusts:false, radius:0.8, rifle:'ranger', ammo:'match', scope:'field' },
  { id:3, name:'距離の違い', english:'BETWEEN DISTANCES', lesson:'上下ダイヤル', text:'3つの距離。遠くの標的ほど弾の落下が目立ちます。上下ダイヤルを使って合わせてください。', hint:'調整パネルの「上下」を増やすと、狙い直した際の着弾が上がります。', map:'range', distances:[150,225,300], height:1.7, time:0, rounds:8, wind:v3(), gusts:false, radius:1, rifle:'sentinel', ammo:'match', scope:'precision' },
  { id:4, name:'動くレール', english:'PASSING MOMENTS', lesson:'飛翔時間と移動', text:'的は、弾が飛んでいる間にも動きます。レールを走る3枚へ命中させましょう。', hint:'的の現在位置ではなく、弾が届く時点の位置を考えます。', map:'range', distances:[150,200,250], height:1.7, time:120, rounds:8, wind:v3(), gusts:false, radius:1.1, rifle:'sentinel', ammo:'match', scope:'precision' },
  { id:5, name:'風のある日', english:'READ THE WIND', lesson:'風・左右ダイヤル', text:'射場を渡る一定の風。旗の向きと観測値を手がかりに、3つのゴングを鳴らしてください。', hint:'矢印は風が吹いていく向き。射座での観測値です。', map:'range', distances:[200,275,350], height:1.7, time:150, rounds:8, wind:v3(4,0,0), gusts:false, radius:1.2, rifle:'sentinel', ammo:'match', scope:'precision' },
  { id:6, name:'見下ろす射座', english:'ABOVE THE RANGE', lesson:'高低差', text:'高台から上下に並ぶ標的を狙います。距離と高さを別に確かめてください。', hint:'高低差があっても重力の向きは世界の下方向です。', map:'range', distances:[150,220,285,350], height:30, time:180, rounds:10, wind:v3(1.5,0,0), gusts:false, radius:1.3, rifle:'sentinel', ammo:'match', scope:'precision' },
  { id:7, name:'谷の向こう', english:'ACROSS THE VALLEY', lesson:'遠距離・狭い視野', text:'400mを超える静止標的。低抵抗弾と高倍率スコープを使い、飛翔の長さを感じてください。', hint:'倍率を下げて探し、上げて仕上げると狙いやすくなります。', map:'quarry', distances:[400,500,600], height:18, time:180, rounds:6, wind:v3(2,0,-1), gusts:false, radius:1.65, rifle:'sentinel', ammo:'low_drag', scope:'survey' },
  { id:8, name:'通過する瞬間', english:'A NARROW WINDOW', lesson:'セミオート・複数移動', text:'次々と横切る5枚のプレート。KESTRELの作動と反動の回復を利用しましょう。', hint:'セミオートも一回の押下につき一発。急ぐほど照準を見失いやすくなります。', map:'quarry', distances:[200,250,300,350,400], height:4, time:120, rounds:12, wind:v3(-2,0,0), gusts:false, radius:1.3, rifle:'kestrel', ammo:'match', scope:'precision' },
  { id:9, name:'風の層', english:'LAYERS OF AIR', lesson:'変化する風', text:'谷の風は一様ではありません。手前と奥の旗を見比べ、変化する条件で3枚へ命中させてください。', hint:'風速計は射座の値です。奥の旗が別の向きを示す場合もあります。', map:'valley', distances:[400,550,700], height:38, time:180, rounds:8, wind:v3(3,0,1), gusts:true, radius:1.8, rifle:'atlas', ammo:'low_drag', scope:'survey' },
  { id:10, name:'標的に合う弾', english:'THE RIGHT RESPONSE', lesson:'弾の性質・標的反応', text:'機械式標的3基を作動させます。装備画面でリアクティブ用の弾薬が選ばれているか確認しましょう。', hint:'命中と作動は別。作動不足の場合も着弾自体は記録されます。', map:'quarry', distances:[150,275,400], height:3, time:180, rounds:8, wind:v3(1,0,0), gusts:false, radius:1.2, rifle:'sentinel', ammo:'reactive', scope:'precision' },
  { id:11, name:'静かな飛翔', english:'THE QUIET FLIGHT', lesson:'低速弾・音の遅れ', text:'夕方の射場。いつもより遅い弾と、さらに遅れて届く標的の音を確かめてください。', hint:'低速弾は専用の基準設定です。飛翔中の標的移動にも注意します。', map:'range', distances:[100,175,250], height:1.7, time:180, rounds:10, wind:v3(1,0,0), gusts:false, radius:1.25, rifle:'sentinel', ammo:'low_velocity', scope:'precision' },
  { id:12, name:'山頂チャレンジ', english:'THE LAST HORIZON', lesson:'すべてを、一発に', text:'遠距離、高低差、風、動く標的。4枚を撃ち抜き、この山頂の課題を達成してください。', hint:'観察する時間も射撃の一部。最初に標的と風を確かめましょう。', map:'alpine', distances:[500,625,750,900], height:65, time:240, rounds:10, wind:v3(3.5,0,-1), gusts:true, radius:2.1, rifle:'atlas', ammo:'low_drag', scope:'survey' },
];
export const missions: Mission[] = missionSpecs.map(m => ({ ...m, targets: m.distances.map((z, i) => ({
  id: `${m.id}-${i}`, position:v3((i - (m.distances.length - 1)/2) * (m.id > 6 ? 10 : 5),
    m.id===6 ? [12,35,8,23][i] : m.id===12 ? [25,55,15,38][i] : m.id===9 ? 16 + i*5 : 1.8, z),
  radius:m.radius,
  kind:m.id===10?'reactive':m.id===5||m.id===7||m.id===9||m.id===12?'gong':m.id===4||m.id===8?'plate':'paper',
  requiredQuality:m.id===2?0.7:0,
  motion: (m.id===4 || m.id===8 || (m.id===11&&i===2) || (m.id===12&&i>1)) ? { amplitude:m.id===8?7:4, period:m.id===8?9:13, phase:i*1.1 } : undefined,
  threshold:m.id===10?3.0:undefined,
})) }));
export const getRifle = (id: RifleId): Rifle => rifles.find(r => r.id===id)!;
export const getAmmo = (id: AmmoProperty): Ammo => ammos.find(a => a.property===id)!;
export const getScope = (id: string): Scope => scopes.find(s => s.id===id) ?? scopes[0];
export interface Loadout { rifle: RifleId; ammo: AmmoProperty; scope: string }
export const defaultLoadout = (m: Mission): Loadout => ({ rifle:m.rifle, ammo:m.ammo, scope:m.scope });
export function availableAmmo(rifle: RifleId, completed: number, practice: boolean): Ammo[] {
  return ammos.filter(a => a.families.includes(getRifle(rifle).family) && (practice || a.unlock<=completed));
}
export function validateData(): void {
  for(const m of missions) {
    if(!m.targets.length || !m.rounds || !getAmmo(m.ammo).families.includes(getRifle(m.rifle).family)) throw new Error(`Invalid mission ${m.id}`);
    for(const t of m.targets) if(t.radius<=0 || !Number.isFinite(t.position.z)) throw new Error(`Invalid target ${t.id}`);
  }
}
