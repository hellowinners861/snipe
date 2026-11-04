import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import '@babylonjs/loaders/glTF';
import { targetAt, windAt, integrate, type Box } from './physics';
import { type Mission, type Loadout, type TargetSpec } from './data';
import { v3, random, type V3, clamp } from './math';
import type { Simulation, Shot } from './simulation';
import type { Settings } from './storage';

export const assetUrl=(path:string):string=>`${import.meta.env.BASE_URL}assets/${path}`;
const vec=(p:V3):Vector3=>new Vector3(p.x,p.y,p.z);
const palettes={
  range:{sky:'#9aa9a1',fog:'#a5b4aa',ground:'#555f43',rock:'#6b7360',sun:'#f1dfb1'},
  quarry:{sky:'#b1b4a4',fog:'#c0bcaa',ground:'#777365',rock:'#8c8875',sun:'#ffe5b0'},
  valley:{sky:'#879b9a',fog:'#9bada9',ground:'#45594a',rock:'#637267',sun:'#d4dbbd'},
  alpine:{sky:'#9baeb9',fog:'#b6c1c2',ground:'#6e7c72',rock:'#909d97',sun:'#eef3dd'},
};
interface TargetVisual { spec:TargetSpec; root:TransformNode; face:Mesh; reaction?:TransformNode; hitAt?:number; strength?:number; texture:DynamicTexture }
export class World {
  engine:Engine; scene!:Scene; camera!:FreeCamera; rifleRoot?:TransformNode; rifleMeshes:AbstractMesh[]=[];
  targetVisuals:TargetVisual[]=[]; flags:{root:TransformNode;cloth:Mesh;z:number}[]=[];
  ready=false; mode:'menu'|'play'|'replay'='menu'; failed=''; private loadId=0;
  private time=0; private flash?:Mesh; private flashUntil=0; private effects:{mesh:Mesh;until:number}[]=[];
  private bolt?:TransformNode; private magazine?:TransformNode; private boltBase?:Vector3; private magazineBase?:Vector3;
  private replayAt=0;
  private traces:Mesh[]=[]; private replayShots:Shot[]=[]; private replayStart=0;
  private mission?:Mission; private settings?:Settings;
  constructor(public canvas:HTMLCanvasElement) {
    this.engine=new Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true,powerPreference:'high-performance'},true);
    window.addEventListener('resize',()=>{if(this.settings)this.applyQuality(this.settings);this.engine.resize();});
    canvas.addEventListener('webglcontextlost',()=>{this.failed='3D表示が中断されました。ページを再読み込みしてください。';});
  }
  applyQuality(settings:Settings):void {
    this.settings=settings;
    const budget=settings.quality==='low'?700000:2100000;
    const density=Math.min(window.devicePixelRatio,settings.quality==='low'?1:1.5,Math.sqrt(budget/(innerWidth*innerHeight)));
    this.engine.setHardwareScalingLevel(1/Math.max(0.5,density));
  }
  async load(mission:Mission,loadout:Loadout,settings:Settings):Promise<void> {
    const loadId=++this.loadId;this.ready=false;this.mission=mission;this.settings=settings;
    this.scene?.dispose();this.targetVisuals=[];this.flags=[];this.effects=[];this.traces=[];this.rifleMeshes=[];
    this.scene=new Scene(this.engine);const scene=this.scene;
    const palette=palettes[mission.map];
    scene.clearColor=Color4.FromHexString(palette.sky+'ff');scene.fogMode=Scene.FOGMODE_EXP2;
    scene.fogDensity=mission.map==='alpine'?0.0008:0.00105;scene.fogColor=Color3.FromHexString(palette.fog);
    scene.imageProcessingConfiguration.contrast=1.12;scene.imageProcessingConfiguration.exposure=1.12;
    this.camera=new FreeCamera('eye',new Vector3(0,mission.height,0),scene);
    this.camera.minZ=0.025;this.camera.maxZ=2400;this.camera.fov=0.85;this.camera.inputs.clear();
    const hemi=new HemisphericLight('sky',new Vector3(0,1,0),scene);hemi.intensity=0.95;hemi.groundColor=Color3.FromHexString('#253324');
    const sun=new DirectionalLight('sun',new Vector3(-0.6,-1,0.65),scene);sun.intensity=1.6;sun.diffuse=Color3.FromHexString(palette.sun);
    const fill=new PointLight('weapon-fill',new Vector3(-0.5,0.6,-0.3),scene);fill.parent=this.camera;fill.intensity=0.55;fill.range=4;fill.diffuse=new Color3(0.9,0.93,0.8);
    this.createLandscape(mission);
    const targetLoads=mission.targets.map(t=>this.makeTarget(t,scene));
    try {
      await Promise.all([this.loadRifle(loadout.rifle,loadout.scope,scene),...targetLoads]);
      if(loadId!==this.loadId||scene.isDisposed)return;
      this.ready=true;this.failed='';this.applyQuality(settings);
    } catch(error) {
      if(loadId===this.loadId){this.failed=`3Dモデルを読み込めませんでした。再読込してください。${String(error)}`;throw error;}
    }
  }
  private mat(name:string,color:string,scene=this.scene):StandardMaterial {
    const m=new StandardMaterial(name,scene);m.diffuseColor=Color3.FromHexString(color);m.specularColor=new Color3(0.05,0.05,0.05);return m;
  }
  private createLandscape(m:Mission):void {
    const scene=this.scene,palette=palettes[m.map],rng=random(580+m.id);
    const ground=MeshBuilder.CreateGround('ground',{width:2200,height:2300,subdivisions:2},scene);ground.position.z=700;
    const material=this.mat('ground-mat',palette.ground);const texture=new DynamicTexture('terrain-texture',{width:256,height:256},scene,false);
    const ctx=texture.getContext();ctx.fillStyle=palette.ground;ctx.fillRect(0,0,256,256);
    for(let i=0;i<2500;i++){const c=rng()>0.5?'rgba(220,225,185,0.12)':'rgba(10,25,17,0.18)';ctx.fillStyle=c;ctx.fillRect(rng()*256,rng()*256,rng()*3+1,rng()*3+1);}
    texture.update();texture.uScale=80;texture.vScale=80;material.diffuseTexture=texture;ground.material=material;
    const gravel=this.mat('gravel','#888675');const lane=MeshBuilder.CreateGround('lane',{width:18,height:1100},scene);lane.position.set(0,0.015,540);lane.material=gravel;
    const wood=this.mat('wood','#4a4233'),metal=this.mat('range-metal','#303b35'),sand=this.mat('sandbag','#91876b');
    const platform=MeshBuilder.CreateBox('shooting-platform',{width:5.8,height:0.35,depth:5.5},scene);platform.position.set(0,m.height-1.45,-1.2);platform.material=wood;
    if(m.height>5){const base=MeshBuilder.CreateCylinder('platform-cliff',{height:m.height-1.5,diameterTop:12,diameterBottom:35,tessellation:9},scene);base.position.set(0,(m.height-1.5)/2,-8);base.material=this.mat('cliff',palette.rock);}
    for(const x of [-1.45,1.45]){const table=MeshBuilder.CreateBox('sandbag',{width:0.7,height:0.28,depth:0.48},scene);table.position.set(x,m.height-0.6,0.6);table.material=sand;}
    const rockMat=this.mat('stone',palette.rock),pine=this.mat('pine','#263d31'),pineLight=this.mat('pine-light','#3b5040');
    const rockMeshes:Mesh[]=[],treeMeshes:Mesh[]=[];
    for(let i=0;i<105;i++) {
      const side=rng()>0.5?1:-1,z=rng()*1100+40,x=side*(30+rng()*240),size=5+rng()*22;
      const rock=MeshBuilder.CreateIcoSphere(`rock-${i}`,{radius:size,subdivisions:1,flat:true},scene);rock.position.set(x,-size*0.25,z);rock.scaling.set(1+rng(),0.4+rng()*0.6,0.7+rng());rock.material=rockMat;rockMeshes.push(rock);
      if(m.map!=='quarry'&&i<65) {
        const height=9+rng()*15;
        const tree=MeshBuilder.CreateCylinder(`pine-${i}`,{diameterTop:0,diameterBottom:height*0.42,height,tessellation:5},scene);tree.position.set(x+12,height/2,z-9);tree.material=i%2?pine:pineLight;treeMeshes.push(tree);
      }
    }
    Mesh.MergeMeshes(rockMeshes,true,true,undefined,false,true);Mesh.MergeMeshes(treeMeshes,true,true,undefined,false,true);
    for(let i=0;i<16;i++) {
      const h=70+rng()*190;const mountain=MeshBuilder.CreateCylinder('ridgeline',{diameterTop:0,diameterBottom:h*2.1,height:h,tessellation:7},scene);
      mountain.position.set((i-7.5)*110,h/2-12,1050+rng()*550);mountain.scaling.z=0.65;mountain.material=this.mat(`ridge-${i}`,i%2?palette.rock:palette.ground);
    }
    for(const z of [50,100,200,300,450,650,850]) {
      const post=MeshBuilder.CreateBox(`distance-${z}`,{width:2,height:0.8,depth:0.15},scene);post.position.set(-12,1,z);post.material=this.sign(`${z} m`);
    }
    for(const target of m.targets) {
      const height=this.pedestalHeight(target);
      if(height>0){const base=MeshBuilder.CreateBox(`target-pedestal-${target.id}`,{width:target.radius*6,height,depth:target.radius*4},scene);base.position.set(target.position.x,height/2,target.position.z);base.material=rockMat;}
    }
    for(const [i,z] of [35,180,380,620].entries()) {
      const root=new TransformNode(`flag-${i}`,scene);root.position.set(i%2?15:-15,0,z);
      const pole=MeshBuilder.CreateCylinder('flag-pole',{height:7,diameter:0.1,tessellation:6},scene);pole.parent=root;pole.position.y=3.5;pole.material=metal;
      const cloth=MeshBuilder.CreatePlane('flag-cloth',{width:2.4,height:0.65,sideOrientation:Mesh.DOUBLESIDE},scene);cloth.parent=root;cloth.position.set(1.2,6.3,0);cloth.material=this.mat('flag-orange','#caa15a');
      this.flags.push({root,cloth,z});
    }
    const obstacle=MeshBuilder.CreateBox('near-range-wall',{width:1.3,height:1.2,depth:2},scene);obstacle.position.set(-3.5,0.6,12);obstacle.material=rockMat;
    const sky=MeshBuilder.CreateSphere('sky-dome',{diameter:4200,segments:12,sideOrientation:Mesh.BACKSIDE},scene);
    const skyMat=this.mat('sky-color',palette.sky);skyMat.disableLighting=true;skyMat.emissiveColor=Color3.FromHexString(palette.sky);sky.material=skyMat;sky.infiniteDistance=true;sky.isPickable=false;
  }
  private pedestalHeight(t:TargetSpec):number{return Math.max(0,t.position.y-1.73*t.radius/({paper:0.4,gong:0.5,plate:0.42,reactive:0.38}[t.kind]));}
  get obstacles():Box[]{return [{min:v3(-4.15,0,11),max:v3(-2.85,1.2,13)},...(this.mission?.targets??[]).filter(t=>this.pedestalHeight(t)>0).map(t=>({min:v3(t.position.x-t.radius*3,0,t.position.z-t.radius*2),max:v3(t.position.x+t.radius*3,this.pedestalHeight(t),t.position.z+t.radius*2)}))];}
  private sign(text:string):StandardMaterial {
    const texture=new DynamicTexture(`sign-${text}`,{width:256,height:128},this.scene,false);
    texture.drawText(text,null,82,'bold 49px sans-serif','#ede9d9','#3b453a',true);
    const mat=this.mat(`sign-mat-${text}`,'#ffffff');mat.diffuseTexture=texture;return mat;
  }
  private async loadRifle(id:string,scopeId:string,scene:Scene):Promise<void> {
    const container=await LoadAssetContainerAsync(assetUrl(`models/${id}.glb`),scene);
    if(scene.isDisposed){container.dispose();return;}container.addAllToScene();
    const parent=new TransformNode('view-weapon',scene);parent.parent=this.camera;
    for(const root of container.rootNodes)root.parent=parent;
    this.rifleRoot=parent;this.rifleMeshes=container.meshes;
    this.bolt=container.transformNodes.find(n=>n.name==='bolt')??container.meshes.find(n=>n.name==='bolt');
    this.magazine=container.transformNodes.find(n=>n.name==='magazine')??container.meshes.find(n=>n.name==='magazine');
    this.boltBase=this.bolt?.position.clone();this.magazineBase=this.magazine?.position.clone();
    container.transformNodes.find(n=>n.name==='optic_root')?.setEnabled(false);
    const optic=await LoadAssetContainerAsync(assetUrl(`models/scope_${scopeId}.glb`),scene);
    if(scene.isDisposed){optic.dispose();return;}optic.addAllToScene();
    const opticParent=new TransformNode('chosen-scope',scene);opticParent.parent=parent;opticParent.position.y=0.153;
    for(const root of optic.rootNodes)root.parent=opticParent;
    this.rifleMeshes.push(...optic.meshes);
    this.flash=MeshBuilder.CreateSphere('muzzle-flash',{diameter:0.08,segments:6},scene);this.flash.parent=parent;
    const fm=this.mat('flash','#ffd78a');fm.emissiveColor=new Color3(1,0.7,0.25);fm.disableLighting=true;this.flash.material=fm;this.flash.setEnabled(false);
  }
  private async makeTarget(spec:TargetSpec,scene:Scene):Promise<void> {
    const container=await LoadAssetContainerAsync(assetUrl(`models/target_${spec.kind}.glb`),scene);
    if(scene.isDisposed){container.dispose();return;}container.addAllToScene();
    const root=new TransformNode(`target-${spec.id}`,scene);root.position=vec(spec.position);
    for(const node of container.rootNodes)node.parent=root;
    // Model target surfaces have a 0.5 m reference radius and origin at the hit surface.
    const reference={paper:0.4,gong:0.5,plate:0.42,reactive:0.38}[spec.kind];
    for(const node of container.rootNodes)if(node instanceof TransformNode)node.scaling.scaleInPlace(spec.radius/reference);
    const texture=new DynamicTexture(`target-face-${spec.id}`,{width:512,height:512},scene,false);
    const ctx=texture.getContext();ctx.clearRect(0,0,512,512);
    const rings=spec.kind==='paper'?[[256,'#e7e3cc'],[230,'#d6d3bc'],[141,'#353b31'],[56,'#c09250']]:[[256,'#d3c9ae'],[234,'#d4c5a1'],[141,'#aaa98a'],[56,'#d0ab68']];
    for(const [r,color] of rings){ctx.beginPath();ctx.arc(256,256,Number(r),0,Math.PI*2);ctx.fillStyle=String(color);ctx.fill();}
    ctx.strokeStyle='#676a55';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(256,15);ctx.lineTo(256,497);ctx.moveTo(15,256);ctx.lineTo(497,256);ctx.stroke();texture.update();
    texture.hasAlpha=true;
    const material=this.mat(`target-face-${spec.id}`,'#ffffff',scene);material.diffuseTexture=texture;material.useAlphaFromDiffuseTexture=true;material.backFaceCulling=false;
    const face=MeshBuilder.CreatePlane(`hit-surface-${spec.id}`,{size:spec.radius*2,sideOrientation:Mesh.DOUBLESIDE},scene);face.parent=root;face.position.z=-0.08;face.material=material;
    this.targetVisuals.push({spec,root,face,texture,reaction:container.transformNodes.find(n=>n.name==='reaction_pivot')});
  }
  update(sim:Simulation|undefined,delta:number):void {
    this.time+=Math.min(delta,0.05);
    if(!this.ready)return;
    const time=this.mode==='replay'?this.replayAt:sim?.time??this.time;
    for(const target of this.targetVisuals) {
      target.root.position.copyFrom(vec(targetAt(target.spec,time)));
      if(target.hitAt!==undefined){const angle=Math.sin((this.time-target.hitAt)*10)*0.12*(target.strength??1)*Math.exp(-(this.time-target.hitAt)*1.5);target.face.rotation.x=angle;if(target.reaction)target.reaction.rotation.x=angle;}
    }
    for(const flag of this.flags) {
      const wind=sim?windAt(v3(flag.root.position.x,6,flag.z),time,sim.env):this.mission?.wind??v3(2,0,0);
      flag.cloth.rotation.y=Math.atan2(wind.z,wind.x)+Math.sin(time*6+flag.z)*0.1;
      flag.cloth.scaling.x=clamp(Math.hypot(wind.x,wind.z)/5,0.2,1);
      flag.cloth.rotation.z=Math.sin(time*7+flag.z)*0.04;
    }
    if(this.mode==='play'&&sim) {
      this.camera.position.copyFrom(vec(sim.eye));
      const angles=sim.opticalAngles;
      const parallax=sim.settings.preset==='simulation'?sim.eyeOffset*(1/Math.max(10,sim.focus)-1/Math.max(10,sim.measuredDistance??100))*0.06:0;
      this.camera.rotation.set(-angles.pitch-(sim.settings.reducedMotion?0:sim.recoil*0.006),angles.yaw+parallax,sim.cant);
      const fov=sim.scoped?2*Math.atan(Math.tan(0.85/2)/sim.zoom):0.85;
      this.camera.fov+=(fov-this.camera.fov)*Math.min(1,delta*15);
      const focusTarget=sim.currentTarget??sim.mission.targets[0];
      const focusDistance=Math.hypot(focusTarget.position.x,focusTarget.position.y-sim.eye.y,focusTarget.position.z);
      const blur=sim.scoped&&!sim.settings.autoFocus?Math.min(2,Math.abs(1/sim.focus-1/focusDistance)*160):0;
      this.canvas.style.filter=blur>0.1?`blur(${blur.toFixed(2)}px)`:'none';
      if(this.rifleRoot){this.rifleRoot.setEnabled(!sim.scoped);this.rifleRoot.position.set(0.22,-0.24-sim.recoil*0.025,0.36-sim.recoil*0.05);this.rifleRoot.rotation.set(-0.025-sim.recoil*0.06,0.035,0);}
      if(this.bolt&&this.boltBase)this.bolt.position.z=this.boltBase.z+(sim.action==='cycling'?Math.sin(clamp((sim.actionEnd-sim.time)/sim.rifle.cycle,0,1)*Math.PI)*-0.08:0);
      if(this.magazine&&this.magazineBase)this.magazine.position.y=this.magazineBase.y+(sim.action==='reloading'?-0.12*Math.sin(clamp((sim.actionEnd-sim.time)/sim.rifle.reload,0,1)*Math.PI):0);
    } else if(this.mode==='menu') {
      this.canvas.style.filter='none';
      this.camera.position.set(0,this.mission?.height??1.7,0);this.camera.rotation.set(-0.01,0.015,0);this.camera.fov=0.85;
      if(this.rifleRoot){this.rifleRoot.setEnabled(true);this.rifleRoot.position.set(0.48,-0.15,1.26);this.rifleRoot.rotation.set(0.12,-1.06+Math.sin(this.time*0.2)*0.06,-0.10);}
    }
    if(this.flash)this.flash.setEnabled(this.mode==='play'&&this.time<this.flashUntil&&!sim?.scoped);
    for(const effect of this.effects) {
      if(this.time>effect.until)effect.mesh.dispose();
      else {effect.mesh.scaling.scaleInPlace(1+delta*0.7);effect.mesh.visibility=Math.max(0,(effect.until-this.time)/0.8);}
    }
    this.effects=this.effects.filter(e=>!e.mesh.isDisposed());
    this.scene.render();
  }
  project(p:V3):{x:number;y:number;visible:boolean} {
    const projected=Vector3.Project(vec(p),Matrix.Identity(),this.scene.getTransformMatrix(),this.camera.viewport.toGlobal(this.engine.getRenderWidth(),this.engine.getRenderHeight()));
    return {x:projected.x/this.engine.getRenderWidth()*100,y:projected.y/this.engine.getRenderHeight()*100,visible:projected.z>0&&projected.z<1};
  }
  onShot():void {
    this.flashUntil=this.time+0.055;
    if(this.flash)this.flash.position.set(0,0.031,0.58);
  }
  impact(shot:Shot,mass=0.01):void {
    const contact=shot.impact;if(!contact)return;
    const visual=this.targetVisuals.find(t=>t.spec.id===contact.target?.id);
    if(visual&&contact.local) {
      visual.hitAt=this.time;
      visual.strength=clamp(shot.speed*mass/5,0.2,2);
      const ctx=visual.texture.getContext(),r=visual.spec.radius;
      ctx.fillStyle=shot.counted?'#b8e08b':'#562f1f';ctx.beginPath();ctx.arc(256+contact.local.x/r*250,256-contact.local.y/r*250,7,0,Math.PI*2);ctx.fill();visual.texture.update();
    }
    const puff=MeshBuilder.CreateSphere('impact-dust',{diameter:contact.target?0.18:0.7,segments:5},this.scene);puff.position.copyFrom(vec(contact.point));
    const mat=this.mat(`puff-${shot.id}`,shot.counted?'#ccd8a9':'#ad9e7e');mat.alpha=0.6;puff.material=mat;this.effects.push({mesh:puff,until:this.time+0.8});
  }
  showReplay(shots:Shot[],view:'side'|'top'|'shooter'='side',comparison?:'wind'|'gravity',sim?:Simulation):void {
    this.mode='replay';this.replayShots=shots;this.replayStart=this.time;this.rifleRoot?.setEnabled(false);
    this.canvas.style.filter='none';this.replayAt=shots[0]?.impactTime??sim?.time??0;
    for(const trace of this.traces)trace.dispose();this.traces=[];
    const allPoints=shots.flatMap(s=>s.points);if(!allPoints.length)return;
    const maxZ=Math.max(...allPoints.map(p=>p.z)),maxY=Math.max(this.mission?.height??1,...allPoints.map(p=>p.y));
    const center=new Vector3(0,maxY*0.45,maxZ*0.48);
    if(view==='side')this.camera.position.set(maxZ*0.65,maxY+maxZ*0.15,maxZ*0.45);
    else if(view==='top')this.camera.position.set(0,maxY+maxZ*0.8,maxZ*0.5);
    else this.camera.position.set(-4,(this.mission?.height??1.7)+1,-8);
    this.camera.setTarget(center);this.camera.fov=0.95;
    for(const shot of shots) {
      const line=MeshBuilder.CreateLines(`trajectory-${shot.id}`,{points:shot.points.map(vec)},this.scene);line.color=shot.counted?new Color3(0.75,0.9,0.48):new Color3(0.95,0.63,0.35);this.traces.push(line);
      if(comparison&&sim) {
        let body:BodyForReplay={p:{...shot.points[0]},v:directionForReplay(shot,sim)};
        const env={...sim.env,wind:comparison==='wind'?v3():sim.env.wind,gusts:comparison==='wind'?false:sim.env.gusts,gravity:comparison==='gravity'?0:sim.env.gravity};
        const points:Vector3[]=[vec(body.p)];let t=0;
        while(t<Math.min(10,(shot.impactTime??shot.fired+4)-shot.fired)&&body.p.y>0){body=integrate(body,shot.fired+t,1/120,sim.profile,env);t+=1/120;if(points.length<1600)points.push(vec(body.p));}
        const line=MeshBuilder.CreateLines('comparison',{points},this.scene);line.color=new Color3(0.55,0.78,0.92);this.traces.push(line);
      }
    }
  }
  dispose():void{this.scene?.dispose();this.engine.dispose();}
}
type BodyForReplay={p:V3;v:V3};
function directionForReplay(shot:Shot,sim:Simulation):V3 {
  if(shot.initialVelocity)return {...shot.initialVelocity};
  // Use the recorded first interval rather than the current aim or current wind.
  if(shot.points.length>1){const dt=shot.times[1]||1/60;return {x:(shot.points[1].x-shot.points[0].x)/dt,y:(shot.points[1].y-shot.points[0].y)/dt,z:(shot.points[1].z-shot.points[0].z)/dt};}
  return {x:0,y:0,z:sim.profile.speed};
}
