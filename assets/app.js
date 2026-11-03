import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { DRIVE_MODES, TUNE_FIELDS, createVehicleState, tuneVehicle } from './physics.mjs';
import { createGuardrailTrack, collideWithGuardrails, smoothClosedTrack, WALL_HEIGHT } from './guardrails.mjs';
import { TRACK_CONTROL_POINTS } from './track.mjs';
import {
  RECORDS_KEY, DRIVER_KEY, X_HANDLE_KEY, newRecordBook, restoreRecordBook,
  formatLap, sanitizeDriver, sanitizeXHandle, submitLap, fastestRecord, lapCrossing,
  buildChallengeLink, readChallenge, makeShareText
} from './records.mjs';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'tinytorque-real-garage-v1'; // Independent garage save: separate from classic TinyTorque.
const LAPS = 3;
const RACE_LIMIT = 300;
const ROAD_WIDTH = 12;
const POINT_COUNT = 420;
const STEP = 1 / 60;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (n) => ((n % POINT_COUNT) + POINT_COUNT) % POINT_COUNT;
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const fmt = (value) => String(Math.floor(value)).padStart(2, '0');
const lapTime = (seconds) => fmt(seconds / 60) + ':' + fmt(seconds % 60) + '.' + String(Math.floor(seconds % 1 * 100)).padStart(2, '0');

const TUNERS = TUNE_FIELDS;
const CAR_PRESETS = [
  {
    name:'Kestrel GT', code:'01 / ÉQUILIBRÉ', color:'#ff7458',
    chassis:{massFactor:.96,wheelbase:3.15,frontWeight:.54,speedFactor:1.00,nativeGrip:1.00,yawInertia:1.00,trackWidth:2.65,rollResist:1.05},
    tune:{power:115,topSpeed:31,gearing:1,diffLock:.55,grip:1.05,pressure:1,mass:95,cg:.48,suspension:.95,steering:1.05,brakeBias:.58,aero:.85,aggression:.95,drivetrain:'awd'}
  },{
    name:'Nebula XR', code:'02 / VITESSE', color:'#66e6d6',
    chassis:{massFactor:1.04,wheelbase:3.5,frontWeight:.48,speedFactor:1.1,nativeGrip:.94,yawInertia:1.14,trackWidth:2.50,rollResist:.96},
    tune:{power:110,topSpeed:39,gearing:.9,diffLock:.35,grip:1.35,pressure:1,mass:106,cg:.33,suspension:1.05,steering:1.25,brakeBias:.65,aero:.7,aggression:.76,drivetrain:'rwd'}
  },{
    name:'Bumble R', code:'03 / ADHÉRENCE', color:'#f2d25f',
    chassis:{massFactor:.89,wheelbase:2.85,frontWeight:.61,speedFactor:.94,nativeGrip:1.12,yawInertia:.78,trackWidth:2.95,rollResist:1.14},
    tune:{power:95,topSpeed:28,gearing:1.2,diffLock:.4,grip:1.38,pressure:.95,mass:82,cg:.35,suspension:1.2,steering:1.25,brakeBias:.65,aero:1.2,aggression:.85,drivetrain:'fwd'}
  },{
    name:'Nightshift', code:'04 / SAUVAGE', color:'#a493f4',
    chassis:{massFactor:1.13,wheelbase:3.05,frontWeight:.44,speedFactor:1.04,nativeGrip:1.02,yawInertia:.9,trackWidth:2.7,rollResist:.90},
    tune:{power:125,topSpeed:35,gearing:1.1,diffLock:.9,grip:1,pressure:.9,mass:125,cg:.7,suspension:1.3,steering:1.1,brakeBias:.47,aero:.9,aggression:1.13,drivetrain:'rwd'}
  }
];
let saved = null;
try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) { saved = null; }
function sanitizeTune(source, fallback) {
  const result = {};
  for (const field of TUNERS) {
    const candidate = source && Number(source[field.key]);
    result[field.key] = Number.isFinite(candidate) && candidate >= field.min && candidate <= field.max ? candidate : fallback[field.key];
  }
  result.drivetrain = source && Object.hasOwn(DRIVE_MODES, source.drivetrain) ? source.drivetrain : fallback.drivetrain;
  return result;
}
const cars = CAR_PRESETS.map((preset, index) => ({
  ...preset, id:index, tune:sanitizeTune(saved && saved[index], preset.tune),
  speed:0, index:0, lap:0, finished:false, finishedAt:0, heading:0,
  position:new THREE.Vector3(), visual:null, wheelParts:[], laneOffset:0, offroad:0,
  physics:createVehicleState(),sector:0,rescueCount:0,stuckTime:0,slides:0,lastSlide:false,spinTime:0,penalty:0,dnf:false,dustCooldown:0,wallHits:0,
  lapStartAt:null,lapInvalid:false,lastLap:null,bestLap:null
}));
let recordBook=newRecordBook();
let driverName='Anonyme';
let xHandle='';
try {
  recordBook=restoreRecordBook(JSON.parse(localStorage.getItem(RECORDS_KEY) || 'null'));
  driverName=sanitizeDriver(localStorage.getItem(DRIVER_KEY));
  xHandle=sanitizeXHandle(localStorage.getItem(X_HANDLE_KEY));
} catch (_) {recordBook=newRecordBook();}
function saveRecords() {
  try {localStorage.setItem(RECORDS_KEY,JSON.stringify(recordBook));}
  catch(_){toast('Le navigateur bloque la sauvegarde des records.');}
}
function markChangedTune(car) {
  if(mode==='running'||mode==='paused')car.lapInvalid=true;
}
function saveGarage() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cars.map(car => car.tune))); } catch (_) { /* storage may be disabled */ }
}
let selected = 0;
let mode = 'idle';
let simSpeed = 1;
let elapsed = 0;
let timeAccumulator = 0;
let cameraMode = 'tv';
let cameraOrbit = 0;
let toastHandle;
const toast = (message) => {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastHandle);
  toastHandle = setTimeout(() => node.classList.remove('show'), 2600);
};

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fbfc2');
scene.fog = new THREE.Fog('#9fbfc2', 160, 350);
const viewport = $('scene');
const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 600);
camera.position.set(105, 109, 130);
const cameraTarget = new THREE.Vector3();
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
viewport.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xe2fbff, 0x52634f, 2.15));
const sun = new THREE.DirectionalLight(0xffefd3, 2.1);
sun.position.set(-65, 110, 30);
scene.add(sun);

const path = new THREE.CatmullRomCurve3(
  TRACK_CONTROL_POINTS.map(([x,z]) => new THREE.Vector3(x,0,z)), true, 'catmullrom', 0.34
);
// A handful of original corners are sharper than the rail setback.
// Round the whole closed loop before creating both the asphalt and the rails,
// otherwise a tight inside rail folds across the track and traps the drivers.
const rawTrack = Array.from({ length:POINT_COUNT }, (_,i) => path.getPointAt(i / POINT_COUNT));
const track = smoothClosedTrack(rawTrack, 7).map(p => new THREE.Vector3(p.x,0,p.z));
const tangents = Array.from({ length:POINT_COUNT }, (_,i) => {
  const a = track[wrap(i - 1)], b = track[wrap(i + 1)];
  return b.clone().sub(a).normalize();
});
const lengthOfTrack = track.reduce((length,p,i)=>length+p.distanceTo(track[wrap(i+1)]),0);
const distancePerPoint = lengthOfTrack / POINT_COUNT;
const guardrails = createGuardrailTrack(track, ROAD_WIDTH, 2.5);
function pointWithOffset(index, offset = 0) {
  const i = wrap(index), p = track[i], t = tangents[i];
  return new THREE.Vector3(p.x + t.z * offset, 0, p.z - t.x * offset);
}
function nearestIndex(position, fromIndex, range = 17) {
  let best = fromIndex, bestDistance = Infinity;
  for (let d = -range; d <= range; d++) {
    const index = wrap(fromIndex + d);
    const p = track[index];
    const distance = (position.x - p.x) ** 2 + (position.z - p.z) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = index; }
  }
  return best;
}
function mat(color, roughness = 0.9) { return new THREE.MeshStandardMaterial({color,roughness}); }
function box(w,h,d,color,x,y,z,group = scene) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat(color));
  mesh.position.set(x,y,z);
  group.add(mesh);
  return mesh;
}
function buildWorld() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700,700), mat('#789478'));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.12;
  scene.add(ground);
  const stripPositions = [], indices = [];
  for (let i = 0; i <= POINT_COUNT; i++) {
    const at = i % POINT_COUNT, point = track[at], t = tangents[at];
    for (const side of [1,-1]) {
      stripPositions.push(point.x + t.z * side * ROAD_WIDTH/2, 0.03, point.z - t.x * side * ROAD_WIDTH/2);
    }
    if (i < POINT_COUNT) {
      const j = i*2;
      indices.push(j,j+1,j+2, j+1,j+3,j+2);
    }
  }
  const roadGeometry = new THREE.BufferGeometry();
  roadGeometry.setAttribute('position', new THREE.Float32BufferAttribute(stripPositions,3));
  roadGeometry.setIndex(indices);
  roadGeometry.computeVertexNormals();
  const asphalt = new THREE.Mesh(roadGeometry,new THREE.MeshStandardMaterial({color:'#444c53',roughness:1,side:THREE.DoubleSide}));
  scene.add(asphalt);
  const curbGeo = new THREE.BoxGeometry(1.05,0.14,2.6);
  const curbMaterials = [mat('#efeee1'),mat('#d45c52')];
  for (let i = 0; i < POINT_COUNT; i += 7) {
    const tangent = tangents[i], yaw = Math.atan2(tangent.x,tangent.z);
    for (const side of [-1,1]) {
      const center = pointWithOffset(i,side*(ROAD_WIDTH/2 + 0.17));
      const curb = new THREE.Mesh(curbGeo,curbMaterials[(Math.floor(i/7))%2]);
      curb.position.set(center.x,0.09,center.z);
      curb.rotation.y = yaw;
      scene.add(curb);
    }
  }
  // Twin continuous crash barriers. Their vertices are shared with the collision model.
  const guardMeshMaterial = new THREE.MeshStandardMaterial({
    color:'#a5b3bc',metalness:.52,roughness:.43,side:THREE.DoubleSide
  });
  const stripeMaterial = new THREE.MeshStandardMaterial({
    vertexColors:true,metalness:.18,roughness:.61,side:THREE.DoubleSide
  });
  function railRibbon(points,low,high,material,striped=false) {
    const positions=[],indices=[],colors=[];
    const colorA=new THREE.Color('#f6f0da'),colorB=new THREE.Color('#e35b57');
    for(let i=0;i<POINT_COUNT;i++) {
      const a=points[i],b=points[(i+1)%POINT_COUNT],j=i*4;
      positions.push(a.x,low,a.z,a.x,high,a.z,b.x,low,b.z,b.x,high,b.z);
      indices.push(j,j+2,j+1,j+1,j+2,j+3);
      if(striped) {
        const color=(Math.floor(i/5)%2) ? colorA : colorB;
        for(let k=0;k<4;k++)colors.push(color.r,color.g,color.b);
      }
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setIndex(indices);
    if(striped)geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geometry.computeVertexNormals();
    scene.add(new THREE.Mesh(geometry,material));
  }
  for(const side of guardrails.sides) {
    railRibbon(side.points,.16,WALL_HEIGHT,guardMeshMaterial);
    railRibbon(side.points,1.18,WALL_HEIGHT+.04,stripeMaterial,true);
  }
  // Lightweight instanced support posts keep the barrier readable from a distance.
  const postEvery=10;
  const postCount=Math.ceil(POINT_COUNT/postEvery)*guardrails.sides.length;
  const posts=new THREE.InstancedMesh(
    new THREE.BoxGeometry(.38,WALL_HEIGHT+.55,.38),mat('#536470',.56),postCount
  );
  const postMatrix=new THREE.Matrix4();
  let postIndex=0;
  for(const side of guardrails.sides)for(let i=0;i<POINT_COUNT;i+=postEvery) {
    const p=side.points[i];
    postMatrix.makeTranslation(p.x,(WALL_HEIGHT+.55)/2,p.z);
    posts.setMatrixAt(postIndex++,postMatrix);
  }
  posts.instanceMatrix.needsUpdate=true;
  scene.add(posts);
  const paintMaterial = mat('#d9ddd6');
  for (let i = 15; i < POINT_COUNT; i += 13) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.18,0.035,3.5),paintMaterial);
    const p = track[i], t = tangents[i];
    line.position.set(p.x,0.065,p.z);
    line.rotation.y = Math.atan2(t.x,t.z);
    scene.add(line);
  }
  const first = track[0], firstTangent = tangents[0];
  const startGroup = new THREE.Group();
  startGroup.position.set(first.x,0.08,first.z);
  startGroup.rotation.y = Math.atan2(firstTangent.x,firstTangent.z);
  for (let i = 0; i < 10; i++) {
    const tile = box(ROAD_WIDTH/10,0.035,1.65,i%2 ? '#292d35' : '#f5f2e6',-ROAD_WIDTH/2+(i+.5)*ROAD_WIDTH/10,0,0,startGroup);
    tile.material.roughness = 1;
  }
  scene.add(startGroup);
  // Start gate
  for (const s of [-1,1]) {
    const p = pointWithOffset(0,s*8);
    box(0.6,7,0.6,'#26333c',p.x,3.5,p.z);
  }
  const gate = box(17,1,1.1,'#202e39',first.x,7.15,first.z);
  gate.rotation.y = Math.atan2(firstTangent.x,firstTangent.z);
  // Trees and low buildings provide depth, without blocking the course.
  let seed = 1871;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const foliage = [mat('#456f5e'),mat('#527a62'),mat('#66866b'),mat('#355f53')];
  const treeTrunk = mat('#5c5548');
  const treeTop = new THREE.ConeGeometry(3.1,8,7);
  const trunkGeo = new THREE.CylinderGeometry(0.55,0.8,3,6);
  let trees = 0;
  for (let tries = 0; tries < 330 && trees < 112; tries++) {
    const x = (rand()-.5)*295, z = (rand()-.5)*290;
    let near = Infinity;
    for (let i = 0; i < POINT_COUNT; i += 8) {
      const p = track[i];
      near = Math.min(near,(p.x-x)**2+(p.z-z)**2);
    }
    if (near < 18*18 || (Math.abs(x)<12 && Math.abs(z)<16)) continue;
    const h = 0.75 + rand()*0.7;
    const trunk = new THREE.Mesh(trunkGeo,treeTrunk);
    trunk.position.set(x,1.25*h,z);
    trunk.scale.set(h,h,h);
    scene.add(trunk);
    const top = new THREE.Mesh(treeTop,foliage[Math.floor(rand()*foliage.length)]);
    top.position.set(x,6.2*h,z);
    top.scale.set(h,h,h);
    scene.add(top);
    trees++;
  }
  const buildings = [
    {x:-119,z:-77,w:30,d:19,h:15,c:'#aeb8ad'},
    {x:108,z:-69,w:23,d:26,h:12,c:'#b7b2a0'},
    {x:116,z:72,w:34,d:22,h:11,c:'#b5c0ba'},
    {x:-101,z:85,w:25,d:27,h:13,c:'#9caeac'}
  ];
  buildings.forEach(b => {
    box(b.w,b.h,b.d,b.c,b.x,b.h/2,b.z);
    const roof = box(b.w+2,1,b.d+2,'#6a7575',b.x,b.h+.5,b.z);
    roof.rotation.z = .035;
  });
  // Test-area decorative cones, safely off the asphalt.
  const coneGeo = new THREE.ConeGeometry(.75,2,8);
  const coneMat = mat('#e9a04d');
  for (let i = 0; i < 26; i++) {
    const p = pointWithOffset((i*17)%POINT_COUNT, (i%2?1:-1)*11);
    const cone = new THREE.Mesh(coneGeo,coneMat);
    cone.position.set(p.x,1,p.z);
    scene.add(cone);
  }
}

function buildCar(car) {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({color:car.color,metalness:.32,roughness:.35});
  const dark = new THREE.MeshStandardMaterial({color:'#182330',metalness:.16,roughness:.42});
  const glass = new THREE.MeshStandardMaterial({color:'#83bac7',metalness:.35,roughness:.18});
  const rubber = mat('#1b2329');
  const silver = mat('#c7d8da',.4);
  function part(w,h,d,x,y,z,material) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
    m.position.set(x,y,z);
    root.add(m);
    return m;
  }
  part(3.45,.72,5.4,0,.81,0,bodyMat);
  part(3.05,.26,2.0,0,1.14,1.63,bodyMat);
  part(2.6,.72,2.52,0,1.44,-.48,glass);
  part(2.35,.22,2.15,0,1.86,-.51,bodyMat);
  part(3.68,.18,.45,0,.56,2.72,dark);
  part(3.54,.18,.46,0,.57,-2.69,dark);
  part(3.65,.19,.6,0,1.74,-2.6,dark);
  part(.22,.55,.3,-1.22,1.34,-2.45,dark);
  part(.22,.55,.3,1.22,1.34,-2.45,dark);
  for (const x of [-1.2,1.2]) {
    part(.64,.18,.08,x,.88,2.75,silver);
    part(.58,.17,.09,x,.9,-2.75,mat('#e65859'));
    for (const z of [-1.8,1.8]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.78,.78,.52,16),rubber);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x*1.49,.73,z);
      root.add(wheel);
      car.wheelParts.push(wheel);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(.37,.37,.54,12),silver);
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(wheel.position);
      root.add(hub);
      car.wheelParts.push(hub);
    }
  }
  root.scale.setScalar(.82);
  scene.add(root);
  car.visual = root;
}
buildWorld();
cars.forEach(buildCar);

// Small reusable particle pool for grass dust and tire smoke.
const dustGeo = new THREE.SphereGeometry(.67,6,4);
const dustPool = Array.from({length:56},()=>{
  const mesh=new THREE.Mesh(dustGeo,new THREE.MeshBasicMaterial({
    color:'#c7bda9',transparent:true,opacity:0,depthWrite:false
  }));
  mesh.visible=false;
  scene.add(mesh);
  return {mesh,life:0,duration:.7};
});
let dustIndex=0;
function emitDust(car) {
  const dust=dustPool[dustIndex++%dustPool.length];
  const p=car.physics;
  dust.life=dust.duration=.48+Math.random()*.35;
  dust.mesh.visible=true;
  dust.mesh.material.color.set(car.offroad>.3?'#c7b38b':'#829096');
  dust.mesh.position.set(p.x-p.vx*.085+(Math.random()-.5)*1.6,.4,p.z-p.vz*.085+(Math.random()-.5)*1.6);
  dust.mesh.scale.setScalar(.5);
}
function updateDust(dt) {
  for(const d of dustPool){
    if(d.life<=0)continue;
    d.life=Math.max(0,d.life-dt);
    d.mesh.visible=d.life>0;
    d.mesh.material.opacity=.34*(d.life/d.duration);
    d.mesh.scale.setScalar(.6+(1-d.life/d.duration)*1.7);
    d.mesh.position.y+=dt*.65;
  }
}

function resetRace() {
  elapsed=0;
  timeAccumulator=0;
  mode='idle';
  cars.forEach((car,i) => {
    car.index=18-i*5;
    car.lap=0;
    car.speed=0;
    car.finished=false;
    car.finishedAt=0;
    car.offroad=0;
    car.sector=0;
    car.rescueCount=0;
    car.stuckTime=0;
    car.slides=0;
    car.lastSlide=false;
    car.penalty=0;
    car.dnf=false;
    car.dustCooldown=0;
    car.wallHits=0;
    car.lapStartAt=null;
    car.lapInvalid=false;
    car.lastLap=null;
    car.bestLap=null;
    car.laneOffset=i%2?1.75:-1.75;
    const p=pointWithOffset(car.index,car.laneOffset);
    const t=tangents[car.index];
    car.heading=Math.atan2(t.x,t.z);
    car.physics=createVehicleState(p.x,p.z,car.heading);
    car.position.set(p.x,0,p.z);
    car.visual.position.set(p.x,.09,p.z);
    car.visual.rotation.set(0,car.heading,0);
  });
  syncControls();
  updateDashboard();
  renderRecordBoard();
}
function closestTrackIndex(position,previous,fullSearch=false) {
  if (!fullSearch) return nearestIndex(position,previous,35);
  let nearest=previous,dist=Infinity;
  for(let i=0;i<POINT_COUNT;i++) {
    const p=track[i],d=(p.x-position.x)**2+(p.z-position.z)**2;
    if(d<dist){dist=d;nearest=i;}
  }
  return nearest;
}
function rescueCar(car,index) {
  const p=pointWithOffset(index,car.laneOffset);
  const t=tangents[index];
  const angle=Math.atan2(t.x,t.z);
  car.physics=createVehicleState(p.x,p.z,angle);
  car.physics.vx=t.x*2;
  car.physics.vz=t.z*2;
  car.position.set(p.x,0,p.z);
  car.heading=angle;
  car.speed=2;
  car.offroad=0;
  car.stuckTime=0;
  car.rescueCount++;
  car.lapInvalid=true;
  car.penalty+=6;
  toast(car.name+' remise sur la piste (+6 s de pénalité).');
}
function checkGates(car,previous,index) {
  const phys=car.physics;
  const p=track[index];
  const centerDistance=Math.hypot(phys.x-p.x,phys.z-p.z);
  if(centerDistance>ROAD_WIDTH*.72) return;
  const t=tangents[index];
  const forward=phys.vx*t.x+phys.vz*t.z;
  if(forward<2.8) return;
  const gates=[105,210,315];
  if(car.sector<3) {
    const g=gates[car.sector];
    if(previous<g && index>=g && index-previous<12)car.sector++;
  } else if(previous>POINT_COUNT-12 && index<12) {
    const crossing=lapCrossing(car,elapsed);
    if(crossing.complete) {
      car.lastLap=crossing.seconds;
      if(crossing.valid) {
        car.bestLap=car.bestLap===null?crossing.seconds:Math.min(car.bestLap,crossing.seconds);
        const verdict=submitLap(recordBook,{
          carId:car.id,time:crossing.seconds,driver:driverName,
          at:new Date().toISOString(),tune:car.tune,xHandle
        });
        if(verdict.accepted)saveRecords();
        if(verdict.overallBest)toast('NOUVEAU RECORD ! '+car.name+' · '+formatLap(crossing.seconds));
        else if(verdict.personalBest)toast('Record '+car.name+' : '+formatLap(crossing.seconds));
        renderRecordBoard();
      }
    }
    car.lap++;
    car.sector=0;
    if(car.lap>=LAPS) {
      car.finished=true;
      car.finishedAt=elapsed+car.penalty;
      car.speed=0;
      phys.vx=0;phys.vz=0;
      toast(car.name+' termine en '+lapTime(car.finishedAt)+' !');
      if(cars.every(other=>other.finished)) {
        mode='finished';
        const winner=[...cars].sort((a,b)=>a.finishedAt-b.finishedAt)[0];
        toast('Vainqueur : '+winner.name+' !');
        syncControls();
      }
    }
  }
}
function drive(car,dt) {
  if(car.finished) return;
  const p=car.physics;
  const previous=car.index;
  const index=closestTrackIndex(p,previous,car.offroad>12);
  car.index=index;
  const current=track[index];
  const centerDistance=Math.hypot(p.x-current.x,p.z-current.z);
  car.offroad=Math.max(0,centerDistance-ROAD_WIDTH*.5+.7);

  // The AI aims at the track, but cannot force the car to follow it.
  const speed=p.speed;
  const look=clamp(Math.round((7+speed*.55)/distancePerPoint),7,34);
  const target=pointWithOffset(index+look,car.laneOffset);
  const aim=Math.atan2(target.x-p.x,target.z-p.z);
  const err=angleDiff(aim,p.heading);
  const velocityHeading=speed>3?Math.atan2(p.vx,p.vz):p.heading;
  const drift=angleDiff(velocityHeading,p.heading);
  const steer=clamp(err*(2.1+car.tune.steering*.28)-p.yawRate*.26+drift*.38,-1,1);

  const forward=tangents[wrap(index+look)];
  const rear=tangents[wrap(index-Math.max(5,Math.floor(look/2)))];
  const curve=Math.abs(angleDiff(Math.atan2(forward.x,forward.z),Math.atan2(rear.x,rear.z)))/
    (Math.max(1,(look+Math.max(5,Math.floor(look/2)))*distancePerPoint));
  const pressure=1-1.15*(car.tune.pressure-1)**2;
  const effectiveGrip=Math.max(.35,car.tune.grip*car.chassis.nativeGrip*pressure);
  const limitingSpeed=Math.sqrt(7.3*effectiveGrip/Math.max(.008,curve));
  const possibleSpeed=car.tune.topSpeed*(1.32-.32*car.tune.gearing)*car.chassis.speedFactor;
  const driverRisk=.70+.23*car.tune.aggression;
  let desired=Math.min(possibleSpeed,limitingSpeed*driverRisk);
  if(car.offroad>.5) desired=Math.min(desired,Math.max(5,11-car.offroad*.35));
  if(Math.abs(drift)>.45) desired=Math.min(desired,Math.max(7,speed*.72));
  const speedError=desired-speed;
  const throttle=clamp(.18+speedError*.46,0,1);
  const brake=clamp(-speedError*.52,0,1);
  // Driver-controlled traction management, not an invisible track-keeping force.
  const driveAid=car.tune.drivetrain==='rwd'
    ?clamp(1-Math.abs(steer)*.68-Math.abs(drift)*1.05,.07,1):1;
  const safeThrottle=throttle*driveAid;
  const oldRollOver=p.rollOver;
  tuneVehicle(p,car.tune,car.chassis,{steer,throttle:safeThrottle,brake},car.offroad,dt);
  // Resolve genuine lateral crashes and glancing contact, never snap onto a racing line.
  const collision=collideWithGuardrails(p,guardrails,previous,dt);
  if(collision.impacts) {
    car.wallHits+=collision.impacts;
    car.penalty+=collision.maxImpact>12 ? 1 : 0;
    car.dustCooldown=0;
  }
  car.position.set(p.x,0,p.z);
  car.heading=p.heading;
  car.speed=p.speed;
  if(p.speed>6 && (car.offroad>.35 || p.slide)) {
    car.dustCooldown-=dt;
    if(car.dustCooldown<=0) {
      emitDust(car);
      car.dustCooldown=.16;
    }
  } else car.dustCooldown=0;

  if(p.slide&&!car.lastSlide)car.slides++;
  car.lastSlide=p.slide;
  if(p.rollOver>oldRollOver) {
    car.penalty+=2;
    toast(car.name+' vient de faire un tonneau !');
  }
  if(car.offroad>4 && p.speed<3.0)car.stuckTime+=dt;
  else car.stuckTime=Math.max(0,car.stuckTime-dt*.5);
  if(car.stuckTime>4 || car.offroad>18)rescueCar(car,index);
  else checkGates(car,previous,index);
  car.visual.position.set(car.position.x,.09+Math.sin(elapsed*12+car.id)*.018,car.position.z);
  car.visual.rotation.set(0,car.heading,clamp(p.roll*.09,-.22,.22));
  // Slipping wheels continue rotating after the body's heading diverges from travel direction.
  for(const wheel of car.wheelParts)wheel.rotation.x+=p.speed*dt*.45;
}
function simulate(dt) {
  elapsed+=dt;
  cars.forEach(car=>drive(car,dt));
  updateDust(dt);
  if(elapsed>=RACE_LIMIT && mode==='running') {
    cars.forEach(car=>{
      if(!car.finished) {
        car.finished=true;car.dnf=true;car.finishedAt=Infinity;car.speed=0;
        car.physics.vx=0;car.physics.vz=0;
      }
    });
    mode='finished';
    toast('Temps limite atteint : les voitures restantes abandonnent.');
    syncControls();
  }
  // Simple impulse-based car contacts, without forcing cars back onto the circuit.
  for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++){
    const a=cars[i],b=cars[j];
    if(a.finished||b.finished)continue;
    const dx=a.physics.x-b.physics.x,dz=a.physics.z-b.physics.z;
    const d=Math.hypot(dx,dz);
    if(d<2.9&&d>.01){
      const nx=dx/d,nz=dz/d;
      const overlap=2.9-d;
      const wa=b.tune.mass/(a.tune.mass+b.tune.mass),wb=1-wa;
      a.physics.x+=nx*overlap*wa*.6;a.physics.z+=nz*overlap*wa*.6;
      b.physics.x-=nx*overlap*wb*.6;b.physics.z-=nz*overlap*wb*.6;
      const rv=(a.physics.vx-b.physics.vx)*nx+(a.physics.vz-b.physics.vz)*nz;
      if(rv<0){
        const impulse=-rv*.6;
        a.physics.vx+=nx*impulse*wa;a.physics.vz+=nz*impulse*wa;
        b.physics.vx-=nx*impulse*wb;b.physics.vz-=nz*impulse*wb;
      }
    }
  }
  // A rival can shove a car toward the wall after its own movement step.
  // Apply an additional narrow-phase pass so impacts cannot push either car through.
  for(const car of cars) {
    if(car.finished)continue;
    const hit=collideWithGuardrails(car.physics,guardrails,car.index,dt);
    if(hit.impacts)car.wallHits+=hit.impacts;
    car.position.set(car.physics.x,0,car.physics.z);
    car.speed=car.physics.speed;
    car.visual.position.x=car.physics.x;
    car.visual.position.z=car.physics.z;
  }
}
function rankCars() {
  return [...cars].sort((a,b) => {
    if (a.finished && b.finished) return a.finishedAt===b.finishedAt ? a.id-b.id : a.finishedAt-b.finishedAt;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return (b.lap*POINT_COUNT+b.index) - (a.lap*POINT_COUNT+a.index);
  });
}
function renderCarCards() {
  $('car-list').innerHTML = cars.map(car => '<button type="button" class="car-card ' + (car.id===selected?'active':'') + '" data-car="' + car.id + '" aria-pressed="' + (car.id===selected) + '">' +
    '<span class="car-art"><span class="wheels"></span><span class="car-top" style="background:' + car.color + '"></span></span>' +
    '<span class="car-name">' + car.name + '</span><span class="car-number">' + car.code + '</span></button>').join('');
}
function renderTuners() {
  const car=cars[selected];
  $('selected-name').textContent=car.name;
  $('selected-desc').textContent=car.code;
  $('selected-color').style.backgroundColor=car.color;
  let group='';
  let html='';
  for(const t of TUNERS) {
    if(t.group!==group) {
      group=t.group;
      html+='<div class="tune-group">'+group+'</div>';
      if(group==='MOTEUR & TRANSMISSION') {
        html+='<div class="drive-picker"><label for="drive-select">Roues motrices</label>'+
          '<select id="drive-select" aria-label="Type de transmission">'+
          Object.entries(DRIVE_MODES).map(([key,label])=>'<option value="'+key+'"'+(car.tune.drivetrain===key?' selected':'')+'>'+label+'</option>').join('')+
          '</select><p>Traction : tire de l’avant · Propulsion : pousse de l’arrière · 4×4 : motricité supérieure, rendement réduit.</p></div>';
      }
    }
    const val=car.tune[t.key],fill=(val-t.min)/(t.max-t.min)*100;
    html+='<div class="tune-row"><div class="tune-line"><label for="tune-'+t.key+'">'+t.label+'</label>'+
      '<output id="val-'+t.key+'">'+Number(val.toFixed(2))+(t.unit?' '+t.unit:'')+'</output></div>'+
      '<input type="range" id="tune-'+t.key+'" data-tune="'+t.key+'" min="'+t.min+'" max="'+t.max+
      '" step="'+t.step+'" value="'+val+'" style="--fill:'+fill+'%"><div class="tune-description">'+t.desc+'</div></div>';
  }
  $('tuners').innerHTML=html;
}
function selectCar(id) {
  if (!Number.isInteger(id) || id < 0 || id >= cars.length) return;
  selected = id;
  renderCarCards();
  renderTuners();
  updateDashboard();
}
function syncControls() {
  const label = mode==='running' ? 'METTRE EN PAUSE' : (mode==='paused' ? 'REPRENDRE LA COURSE' : mode==='finished' ? 'REJOUER LA COURSE' : 'LANCER LA COURSE');
  $('start-label').textContent = label;
  $('play-icon').textContent = mode==='running' ? 'Ⅱ' : '▶';
  const labels = {idle:'EN ATTENTE',running:'COURSE EN COURS',paused:'EN PAUSE',finished:'COURSE TERMINÉE'};
  $('session-state').textContent = labels[mode];
  $('session-indicator').parentElement.classList.toggle('running',mode==='running');
}
function updateDashboard() {
  const ordered = rankCars();
  $('leaderboard').innerHTML = ordered.map((car,position) => {
    const detail = car.dnf ? '<span class="leader-finish">ABANDON</span><br><small>HORS CLASSEMENT</small>' : car.finished ? '<span class="leader-finish">' + lapTime(car.finishedAt) + '</span><br><small>TERMINÉ</small>' :
      '<span>' + Math.min(car.lap+1,LAPS) + ' / ' + LAPS + ' TOUR</span><br><small>' + Math.round(car.speed*3.6) + ' km/h</small>';
    return '<div class="leader-row ' + (car.id===selected?'is-selected':'') + '"><span class="leader-place">' + (position+1) + '</span>' +
      '<span class="leader-color" style="background:' + car.color + '"></span><span class="leader-name">' + car.name +
      '</span><span class="leader-details">' + detail + '</span></div>';
  }).join('');
  const car = cars[selected];
  const kph = Math.round(car.speed*3.6);
  const slip = car.physics.slip;
  $('tele-speed').textContent = kph;
  $('speed-meter').style.width = Math.min(100,kph/(42*3.6)*100) + '%';
  $('tele-lap').textContent = Math.min(car.lap,LAPS) + ' / ' + LAPS;
  $('tele-offset').textContent = car.offroad.toFixed(1) + ' m';
  const driveLabel=DRIVE_MODES[car.tune.drivetrain];
  if ($('tele-slip')) $('tele-slip').textContent = Math.round(Math.abs(slip)) + '°';
  if ($('tele-drive')) $('tele-drive').textContent = driveLabel;
  if ($('tele-warnings')) $('tele-warnings').textContent = car.wallHits + ' chocs barrière · ' + car.slides + ' glissades · ' + car.rescueCount + ' secours';
  $('tele-note').textContent = car.wallHits>0 && car.physics.speed<8 ? 'Impact contre les barrières : la voiture ralentit et doit retrouver sa trajectoire.' : car.dnf ? 'Le temps limite est atteint : cette voiture abandonne.' : car.finished ? 'Voiture arrivée. Comparez son chrono aux autres.' :
    car.physics.rollOver>0 && car.physics.speed<5 ? 'Tonneau ! Le centre de gravité et la suspension influencent la stabilité.' :
    Math.abs(slip)>25 && car.speed>7 ? 'Dérapage important ! Les pneus glissent dans une autre direction que la carrosserie.' :
    car.offroad > 3 ? 'Attention : sortie de piste ! Essayez plus d’adhérence ou une direction moins nerveuse.' :
    car.speed > 18 ? 'En pleine course. Observez le comportement dans les prochains virages.' :
    'Les réglages modifient la vitesse, les freinages et les trajectoires.';
  $('timer').textContent = lapTime(elapsed);
}
const incomingChallenge=readChallenge(window.location.search);
function showIncomingChallenge() {
  if(!incomingChallenge)return;
  $('incoming-challenge').hidden=false;
  $('incoming-time').textContent=formatLap(incomingChallenge.time);
  $('incoming-from').textContent=incomingChallenge.driver+
    (incomingChallenge.xHandle?' · @'+incomingChallenge.xHandle:'')+' · '+
    CAR_PRESETS[incomingChallenge.carId].name+' · À battre !';
}
function renderRecordBoard() {
  const best=fastestRecord(recordBook);
  const sessionBest=cars.reduce((acc,car)=>
    car.bestLap!==null && (acc===null||car.bestLap<acc)?car.bestLap:acc,null);
  $('record-time').textContent=best?formatLap(best.time):'--:--.--';
  const displayedHandle=best && (best.driver===driverName ? xHandle : best.xHandle);
  $('record-holder').textContent=best ?
    best.driver+(displayedHandle?' · @'+displayedHandle:'')+' · '+CAR_PRESETS[best.carId].name : 'Aucun tour chronométré';
  $('record-context').textContent=best ?
    'La référence à battre sur ce navigateur. Configurez une voiture et faites mieux !' :
    'Le premier franchissement lance le chrono ; les tours suivants comptent.';
  $('record-session').textContent=sessionBest===null?'--:--.--':formatLap(sessionBest);
  $('record-count').textContent=String(recordBook.lapsRecorded);
  $('share-record').disabled=!best;
  $('record-crown').hidden=!best;
  $('record-cars').innerHTML=CAR_PRESETS.map((preset,i)=>{
    const rec=recordBook.bestByCar[i];
    return '<div class="record-car"><i style="background:'+preset.color+'"></i>'+
      '<span>'+preset.name+'</span><strong>'+(rec?formatLap(rec.time):'--:--.--')+'</strong></div>';
  }).join('');
}
function toggleRace() {
  if (mode==='finished') resetRace();
  mode = mode==='running' ? 'paused' : 'running';
  syncControls();
}
$('car-list').addEventListener('click', e => {
  const button = e.target.closest('[data-car]');
  if (button) selectCar(Number(button.dataset.car));
});
$('tuners').addEventListener('input', e => {
  const key = e.target.dataset.tune;
  if (!key) return;
  const def = TUNERS.find(x => x.key===key);
  if (!def) return;
  const value = clamp(Number(e.target.value),def.min,def.max);
  cars[selected].tune[key] = value;
  markChangedTune(cars[selected]);
  e.target.style.setProperty('--fill', (value-def.min)/(def.max-def.min)*100 + '%');
  $('val-'+key).textContent = Number(value.toFixed(2)) + (def.unit ? ' '+def.unit : '');
  saveGarage();
  updateDashboard();
});
$('tuners').addEventListener('change',e=>{
  if(e.target.id!=='drive-select')return;
  if(!Object.hasOwn(DRIVE_MODES,e.target.value))return;
  cars[selected].tune.drivetrain=e.target.value;
  markChangedTune(cars[selected]);
  saveGarage();
  updateDashboard();
  toast('Transmission : '+DRIVE_MODES[e.target.value]);
});
$('reset-tune').addEventListener('click', () => {
  cars[selected].tune = { ...CAR_PRESETS[selected].tune };
  markChangedTune(cars[selected]);
  saveGarage(); renderTuners(); toast('Réglages d’origine restaurés.');
});
$('randomize').addEventListener('click', () => {
  const current = cars[selected];
  for (const tune of TUNERS) {
    const slots = Math.round((tune.max-tune.min)/tune.step);
    current.tune[tune.key] = Number((tune.min+Math.floor(Math.random()*(slots+1))*tune.step).toFixed(2));
  }
  current.tune.drivetrain=['fwd','rwd','awd'][Math.floor(Math.random()*3)];
  markChangedTune(current);
  saveGarage(); renderTuners(); updateDashboard(); toast('Configuration expérimentale créée !');
});
$('start-button').addEventListener('click',toggleRace);
$('reset-race').addEventListener('click',() => { resetRace(); toast('Circuit réinitialisé. Prêt pour un nouvel essai.'); });
document.querySelectorAll('[data-speed]').forEach(button => button.addEventListener('click',() => {
  simSpeed = Number(button.dataset.speed);
  document.querySelectorAll('[data-speed]').forEach(el=>el.classList.toggle('active',el===button));
}));
document.querySelectorAll('[data-camera]').forEach(button => button.addEventListener('click',() => {
  cameraMode = button.dataset.camera;
  document.querySelectorAll('[data-camera]').forEach(el=>el.classList.toggle('active',el===button));
}));
$('driver-name').value=driverName==='Anonyme'?'':driverName;
$('driver-name').addEventListener('change',e=>{
  driverName=sanitizeDriver(e.target.value);
  e.target.value=driverName==='Anonyme'?'':driverName;
  try {localStorage.setItem(DRIVER_KEY,driverName);} catch (_) {/* private mode */}
  toast('Pseudo enregistré sur cet appareil.');
});
$('x-handle').value=xHandle?'@'+xHandle:'';
$('x-handle').addEventListener('change',e=>{
  const raw=e.target.value.trim();
  const normalized=sanitizeXHandle(raw);
  if(raw&&!normalized){
    e.target.value=xHandle?'@'+xHandle:'';
    toast('Identifiant X invalide : 1 à 15 lettres, chiffres ou underscores.');
    return;
  }
  xHandle=normalized;
  e.target.value=xHandle?'@'+xHandle:'';
  try {localStorage.setItem(X_HANDLE_KEY,xHandle);} catch (_) {/* private mode */}
  renderRecordBoard();
  toast(xHandle?'Compte X enregistré sur cet appareil.':'Mention X désactivée.');
});
$('share-record').addEventListener('click',async()=>{
  const best=fastestRecord(recordBook);
  if(!best)return;
  const drive=best.tune?.drivetrain==='fwd'?'traction AV':
    best.tune?.drivetrain==='awd'?'4×4':'propulsion AR';
  // Never guess that the garage nickname belongs to an identically named X account.
  // Existing records can use the newly provided handle if the local nickname matches.
  const effectiveHandle=best.driver===driverName?xHandle:(best.xHandle||'');
  const shareEntry={...best,xHandle:effectiveHandle};
  const link=buildChallengeLink(shareEntry,window.location.href);
  const shareText=makeShareText({
    entry:shareEntry,carName:CAR_PRESETS[best.carId].name,
    driveName:drive,url:link,xHandle:effectiveHandle
  });
  try {
    if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(shareText);
    toast('Défi copié ! Collez-le sur X pour lancer le challenge.');
  } catch (_) {
    window.prompt('Copiez votre défi pour X :',shareText);
  }
});
showIncomingChallenge();
renderRecordBoard();
$('export').addEventListener('click', () => {
  const payload = {app:'TinyTorque',version:1,cars:cars.map(c => ({name:c.name,tune:c.tune}))};
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href=url; anchor.download='tinytorque-garage.json';
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  URL.revokeObjectURL(url);
  toast('Profil du garage exporté.');
});
$('import').addEventListener('click',() => $('file-input').click());
$('file-input').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 50000) throw new Error('Fichier trop volumineux');
    const payload = JSON.parse(await file.text());
    if (payload.app!=='TinyTorque' || !Array.isArray(payload.cars) || payload.cars.length!==cars.length) throw new Error('Format de garage inconnu');
    payload.cars.forEach((entry,i) => { cars[i].tune = sanitizeTune(entry.tune,CAR_PRESETS[i].tune); markChangedTune(cars[i]); });
    saveGarage(); renderTuners(); toast('Quatre voitures importées avec succès.');
  } catch (err) { toast('Import refusé : ' + err.message); }
  e.target.value='';
});
document.addEventListener('keydown', e => {
  if (e.target.matches('input,textarea,select,button')) return;
  if (e.code==='Space') { e.preventDefault(); toggleRace(); }
  if (e.key==='r' || e.key==='R') resetRace();
  if (['1','2','3','4'].includes(e.key)) selectCar(Number(e.key)-1);
});

function updateCamera(dt) {
  const selectedCar = cars[selected];
  const forward = new THREE.Vector3(Math.sin(selectedCar.heading),0,Math.cos(selectedCar.heading));
  const cameraPosition = new THREE.Vector3();
  const target = new THREE.Vector3();
  cameraOrbit += dt*.06;
  if (cameraMode==='follow') {
    cameraPosition.copy(selectedCar.position).addScaledVector(forward,-20).add(new THREE.Vector3(0,11,0));
    target.copy(selectedCar.position).addScaledVector(forward,12).add(new THREE.Vector3(0,1.4,0));
  } else if (cameraMode==='top') {
    cameraPosition.set(0,185,.001);
    target.set(0,0,0);
  } else {
    cameraPosition.set(Math.sin(.68+cameraOrbit)*136,97,Math.cos(.68+cameraOrbit)*135);
    target.set(0,0,2);
  }
  const blend = 1 - Math.exp(-dt*(cameraMode==='follow'?4:1.9));
  camera.position.lerp(cameraPosition,blend);
  cameraTarget.lerp(target,blend);
  camera.lookAt(cameraTarget);
}
function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (w <= 0 || h <= 0) return;
  renderer.setSize(w,h,false);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
window.addEventListener('resize',resize);
resize();
renderCarCards();
renderTuners();
resetRace();
const clock = new THREE.Clock();
let lastUiUpdate = 0, fpsTime = 0, frames = 0;
function frame() {
  requestAnimationFrame(frame);
  const realDt = Math.min(clock.getDelta(),.055);
  if (mode==='running') {
    timeAccumulator += realDt*simSpeed;
    let steps=0;
    while (timeAccumulator>=STEP && steps<15 && mode==='running') {
      simulate(STEP); timeAccumulator-=STEP; steps++;
    }
    if (steps===15) timeAccumulator=Math.min(timeAccumulator,STEP*2);
  }
  updateCamera(realDt);
  renderer.render(scene,camera);
  fpsTime += realDt; frames++;
  if (fpsTime>=1) {
    $('fps-display').textContent = Math.round(frames/fpsTime) + ' FPS · WEBGL';
    fpsTime=0;frames=0;
  }
  lastUiUpdate+=realDt;
  if (lastUiUpdate>=.16) {updateDashboard();lastUiUpdate=0;}
}
frame();
