/**
 * TinyTorque REAL: procedural scenery and detailed RC cars.
 * All visuals are original and built locally with Three.js. No paid assets.
 * Physics, timing and guardrail collision remain in the original deterministic modules.
 */
const PI=Math.PI;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function randomGenerator(seed=67021){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function noiseMap(THREE,base,variation=35,size=256) {
  const rand=randomGenerator(base*341+89);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d');const image=ctx.createImageData(size,size);
  for(let i=0;i<size*size;i++){
    const noise=(rand()-.5)*variation*2;
    for(let channel=0;channel<3;channel++)image.data[i*4+channel]=clamp(base+noise*(channel===1?1.12:1),0,255);
    image.data[i*4+3]=255;
  }
  ctx.putImageData(image,0,0);
  // Coarse flecks and mineral grains break up broad uniform surfaces.
  for(let n=0;n<2800;n++){
    ctx.fillStyle=rand()>.5?'rgba(220,214,196,.12)':'rgba(12,18,12,.12)';
    ctx.fillRect(rand()*size,rand()*size,.4+rand()*2,.4+rand()*2);
  }
  const texture=new THREE.CanvasTexture(canvas);
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=8;
  return texture;
}
function mesh(THREE,geometry,material,x=0,y=0,z=0,cast=false){
  const o=new THREE.Mesh(geometry,material);o.position.set(x,y,z);o.castShadow=cast;o.receiveShadow=true;return o;
}
function signTexture(THREE,text) {
  const c=document.createElement('canvas');c.width=1024;c.height=192;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#0c1822';ctx.fillRect(0,0,1024,192);
  ctx.strokeStyle='#c5b98b';ctx.lineWidth=8;ctx.strokeRect(10,10,1004,172);
  ctx.font='bold 87px Arial, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#f5f1dc';ctx.fillText(text,512,98);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
export function createRealEnvironment(THREE,scene,renderer,track,tangents,guardrails,roadWidth,pointCount) {
  const rnd=randomGenerator(1837);
  const skyDay=new THREE.Color('#a8cbda'),skyNight=new THREE.Color('#0c1725');
  scene.background=skyDay.clone();
  scene.fog=new THREE.FogExp2(skyDay.clone(),.0027);
  const hemisphere=new THREE.HemisphereLight(0xd8ebff,0x59603c,2.05);
  scene.add(hemisphere);
  const sun=new THREE.DirectionalLight(0xffe5be,3.25);
  sun.position.set(-86,124,48);
  sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);
  sun.shadow.camera.left=-200;sun.shadow.camera.right=200;
  sun.shadow.camera.top=200;sun.shadow.camera.bottom=-200;
  sun.shadow.camera.near=1;sun.shadow.camera.far=400;
  sun.shadow.bias=-.00005;sun.shadow.normalBias=.03;
  scene.add(sun);
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  const warm=new THREE.DirectionalLight(0xffb778,.48);warm.position.set(120,38,-80);scene.add(warm);

  const grassTexture=noiseMap(THREE,79,33,256);grassTexture.repeat.set(55,55);
  const ground=mesh(THREE,new THREE.PlaneGeometry(800,800),new THREE.MeshStandardMaterial({
    color:'#9eb78a',map:grassTexture,roughness:1,metalness:0
  }),0,-.135,0);
  ground.rotation.x=-PI/2;ground.receiveShadow=true;scene.add(ground);
  const asphaltTexture=noiseMap(THREE,111,36,512);
  const asphaltMaterial=new THREE.MeshPhysicalMaterial({
    color:'#878f96',map:asphaltTexture,metalness:.04,roughness:.89,clearcoat:.06,clearcoatRoughness:.7,
    side:THREE.DoubleSide
  });
  function ribbon(halfWidth,height,material){
    const positions=[],uv=[],indices=[];
    for(let i=0;i<=pointCount;i++){
      const k=i%pointCount,p=track[k],t=tangents[k];
      for(const s of [1,-1]){
        const x=p.x+t.z*s*halfWidth,z=p.z-t.x*s*halfWidth;
        positions.push(x,height,z);uv.push(x*.085,z*.085);
      }
      if(i<pointCount){const v=i*2;indices.push(v,v+1,v+2,v+1,v+3,v+2);}
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    geometry.setIndex(indices);geometry.computeVertexNormals();
    const surface=mesh(THREE,geometry,material);
    scene.add(surface);return surface;
  }
  ribbon(roadWidth/2+2.35,-.025,new THREE.MeshStandardMaterial({
    color:'#746f61',map:asphaltTexture,roughness:1,side:THREE.DoubleSide
  }));
  ribbon(roadWidth/2,.028,asphaltMaterial);
  const stripeMat=new THREE.MeshStandardMaterial({color:'#e0ded1',roughness:.88});
  const curbMat=[new THREE.MeshStandardMaterial({color:'#eee9d7',roughness:.84}),new THREE.MeshStandardMaterial({color:'#b64436',roughness:.9})];
  const curbGeometry=new THREE.BoxGeometry(.85,.12,2.6);
  const roadLineGeometry=new THREE.BoxGeometry(.11,.015,3.05);
  for(let i=0;i<pointCount;i+=6) {
    const p=track[i],t=tangents[i],yaw=Math.atan2(t.x,t.z);
    for(const side of [-1,1]){
      const curb=mesh(THREE,curbGeometry,curbMat[Math.floor(i/6)%2],
        p.x+t.z*side*(roadWidth/2-.13),.09,p.z-t.x*side*(roadWidth/2-.13));
      curb.rotation.y=yaw;scene.add(curb);
    }
    if(i%18===0) {
      const line=mesh(THREE,roadLineGeometry,stripeMat,p.x,.055,p.z);
      line.rotation.y=yaw;scene.add(line);
    }
  }
  // Guardrail geometry uses the same centerlines as physical collision.
  const railMat=new THREE.MeshStandardMaterial({color:'#a9b5bd',metalness:.73,roughness:.34,side:THREE.DoubleSide});
  const bandMat=new THREE.MeshStandardMaterial({vertexColors:true,metalness:.28,roughness:.54,side:THREE.DoubleSide});
  function railSurface(points,low,high,material,striped=false){
    const positions=[],indices=[],colors=[];
    const ca=new THREE.Color('#fff5df'),cb=new THREE.Color('#d94538');
    for(let i=0;i<pointCount;i++){
      const a=points[i],b=points[(i+1)%pointCount],j=i*4;
      positions.push(a.x,low,a.z,a.x,high,a.z,b.x,low,b.z,b.x,high,b.z);
      indices.push(j,j+2,j+1,j+1,j+2,j+3);
      if(striped)for(let k=0;k<4;k++){
        const c=Math.floor(i/6)%2?ca:cb;colors.push(c.r,c.g,c.b);
      }
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    g.setIndex(indices);
    if(striped)g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    g.computeVertexNormals();
    const surface=mesh(THREE,g,material);
    scene.add(surface);
  }
  for(const side of guardrails.sides){
    railSurface(side.points,.18,1.55,railMat);
    railSurface(side.points,1.13,1.58,bandMat,true);
    const postGeo=new THREE.BoxGeometry(.23,2.1,.23);
    const postMat=new THREE.MeshStandardMaterial({color:'#53616a',metalness:.82,roughness:.36});
    const count=Math.ceil(pointCount/10),posts=new THREE.InstancedMesh(postGeo,postMat,count);
    const matrix=new THREE.Matrix4();
    for(let j=0;j<count;j++){
      const p=side.points[(j*10)%pointCount];
      matrix.makeTranslation(p.x,1.05,p.z);posts.setMatrixAt(j,matrix);
    }
    posts.instanceMatrix.needsUpdate=true;posts.receiveShadow=true;scene.add(posts);
  }
  const start=track[0],t=tangents[0];
  const startLine=new THREE.Group();
  startLine.position.set(start.x,.064,start.z);startLine.rotation.y=Math.atan2(t.x,t.z);
  const finishWhite=new THREE.MeshStandardMaterial({color:'#f6f3e7',roughness:.9});
  const finishBlack=new THREE.MeshStandardMaterial({color:'#171c22',roughness:.9});
  for(let i=0;i<12;i++)for(let j=0;j<2;j++){
    const tile=mesh(THREE,new THREE.BoxGeometry(roadWidth/12,.012,1),((i+j)%2===0)?finishWhite:finishBlack,
       -roadWidth/2+(i+.5)*roadWidth/12,0,(j-.5));
    startLine.add(tile);
  }
  const steel=new THREE.MeshStandardMaterial({color:'#273442',metalness:.69,roughness:.38});
  for(const x of [-8,8])startLine.add(mesh(THREE,new THREE.BoxGeometry(.58,6,.58),steel,x,3,0,true));
  startLine.add(mesh(THREE,new THREE.BoxGeometry(17,2,.65),steel,0,6.1,0,true));
  const panel=mesh(THREE,new THREE.PlaneGeometry(15.8,2),new THREE.MeshBasicMaterial({
    map:signTexture(THREE,'TINYTORQUE  REAL'),side:THREE.DoubleSide
  }),0,6.1,.36);
  startLine.add(panel);scene.add(startLine);

  function distanceFromRoad(x,z) {
    let best=Infinity;
    for(let i=0;i<pointCount;i+=11){
      const p=track[i],v=(x-p.x)**2+(z-p.z)**2;
      if(v<best)best=v;
    }
    return Math.sqrt(best);
  }
  // Instancing retains detail without thousands of draw calls.
  const bladeGeo=new THREE.PlaneGeometry(.15,1.8);
  const bladeMat=new THREE.MeshStandardMaterial({color:'#d9d5a5',side:THREE.DoubleSide,roughness:1});
  const bladeMax=6800,blades=new THREE.InstancedMesh(bladeGeo,bladeMat,bladeMax);
  blades.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  let grassCount=0;const dummy=new THREE.Object3D(),grassColor=new THREE.Color();
  for(let n=0;n<bladeMax*2 && grassCount<bladeMax;n++){
    const x=(rnd()-.5)*350,z=(rnd()-.5)*350;
    if(distanceFromRoad(x,z)<9.7)continue;
    const h=.45+rnd()*1.35;
    dummy.position.set(x,h*.76-.115,z);
    dummy.rotation.set(0,rnd()*PI*2,(rnd()-.5)*.22);
    dummy.scale.set(.5+rnd(),h,.5+rnd());
    dummy.updateMatrix();blades.setMatrixAt(grassCount,dummy.matrix);
    grassColor.setHSL(.24+rnd()*.055,.23+rnd()*.22,.32+rnd()*.17);
    blades.setColorAt(grassCount,grassColor);grassCount++;
  }
  blades.count=grassCount;blades.instanceMatrix.needsUpdate=true;
  if(blades.instanceColor)blades.instanceColor.needsUpdate=true;
  blades.frustumCulled=false;scene.add(blades);

  const pineTrunk=new THREE.InstancedMesh(new THREE.CylinderGeometry(.29,.44,4,7),
    new THREE.MeshStandardMaterial({color:'#6e5843',roughness:1}),200);
  const leafMat=new THREE.MeshStandardMaterial({color:'#c8d0b0',roughness:1,flatShading:false});
  const crowns=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,2),leafMat,600);
  const rocks=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),
    new THREE.MeshStandardMaterial({color:'#8e8e80',roughness:1}),230);
  let treeCount=0,crownCount=0,rockCount=0;
  for(let n=0;n<720;n++){
    const x=(rnd()-.5)*400,z=(rnd()-.5)*400;
    if(distanceFromRoad(x,z)<19)continue;
    if(treeCount<160&&rnd()>.66) {
      const h=.7+rnd()*1.0;
      dummy.position.set(x,1.9*h,z);dummy.rotation.set(0,rnd()*PI*2,0);
      dummy.scale.set(h,h,h);dummy.updateMatrix();
      pineTrunk.setMatrixAt(treeCount++,dummy.matrix);
      for(let j=0;j<3;j++){
        dummy.position.set(x+(rnd()-.5)*1.7*h,(5.3+j*2.0)*h,z+(rnd()-.5)*1.7*h);
        dummy.scale.set((3.1-j*.32)*h,(2.8-j*.2)*h,(3.3-j*.23)*h);
        dummy.updateMatrix();crowns.setMatrixAt(crownCount,dummy.matrix);
        grassColor.setHSL(.29+rnd()*.075,.20+rnd()*.12,.23+rnd()*.11);
        crowns.setColorAt(crownCount,grassColor);crownCount++;
      }
    } else if(rockCount<220) {
      dummy.position.set(x,.05,z);dummy.rotation.set(rnd(),rnd()*PI*2,rnd());
      dummy.scale.set(.6+rnd()*1.5,.2+rnd()*.6,.6+rnd()*1.5);dummy.updateMatrix();
      rocks.setMatrixAt(rockCount++,dummy.matrix);
    }
  }
  pineTrunk.count=treeCount;crowns.count=crownCount;rocks.count=rockCount;
  for(const inst of [pineTrunk,crowns,rocks]){
    inst.instanceMatrix.needsUpdate=true;inst.frustumCulled=false;inst.receiveShadow=true;scene.add(inst);
  }
  if(crowns.instanceColor)crowns.instanceColor.needsUpdate=true;

  // Pit lane and paddock: scale cues are essential for a convincing macro RC scene.
  const concrete=new THREE.MeshStandardMaterial({color:'#747b7b',roughness:.94});
  const siding=new THREE.MeshStandardMaterial({color:'#9caaad',metalness:.23,roughness:.7});
  const roofMat=new THREE.MeshStandardMaterial({color:'#2e4147',metalness:.64,roughness:.4});
  const pane=new THREE.MeshPhysicalMaterial({color:'#86afb9',metalness:.18,roughness:.16,clearcoat:.8});
  const buildings=[[-137,-71,23,16,9],[125,-90,21,19,11],[-125,113,25,18,10],[121,117,20,22,11]];
  for(const [x,z,w,d,h] of buildings){
    scene.add(mesh(THREE,new THREE.BoxGeometry(w,h,d),siding,x,h/2,z,true));
    scene.add(mesh(THREE,new THREE.BoxGeometry(w+2,.8,d+2),roofMat,x,h+.4,z,true));
    for(let j=-1;j<=1;j++){
      scene.add(mesh(THREE,new THREE.BoxGeometry(w/5,h*.46,.11),pane,x+j*w/3,h*.6,z+d/2+.07));
    }
    const apron=mesh(THREE,new THREE.PlaneGeometry(w+15,d+14),concrete,x,.012,z);
    apron.rotation.x=-PI/2;scene.add(apron);
  }
  const tireRubber=new THREE.MeshStandardMaterial({color:'#151a1c',metalness:.05,roughness:.94});
  const tireGeo=new THREE.TorusGeometry(.82,.27,7,14);
  for(let i=0;i<28;i++){
    const k=(i*13+33)%pointCount,p=track[k],t=tangents[k],side=i%2?1:-1;
    const x=p.x+t.z*side*(roadWidth/2+5),z=p.z-t.x*side*(roadWidth/2+5);
    for(let j=0;j<2;j++){
      const tire=mesh(THREE,tireGeo,tireRubber,x,j*.57+.37,z,true);
      tire.rotation.x=PI/2;scene.add(tire);
    }
  }
  const coneMat=new THREE.MeshStandardMaterial({color:'#ee712d',roughness:.71});
  const coneGeo=new THREE.ConeGeometry(.5,1.45,12);
  for(let i=0;i<24;i++){
    const k=(i*17+7)%pointCount,p=track[k],t=tangents[k],side=i%2?1:-1;
    scene.add(mesh(THREE,coneGeo,coneMat,
      p.x+t.z*side*(roadWidth/2+3.4),.68,p.z-t.x*side*(roadWidth/2+3.4)));
  }

  const waterMat=new THREE.MeshPhysicalMaterial({
    color:'#5f8694',transparent:true,opacity:.62,roughness:.075,metalness:.32,
    clearcoat:1,clearcoatRoughness:.025,depthWrite:false
  });
  const puddles=new THREE.Group();
  const puddleGeo=new THREE.CircleGeometry(1,24);
  for(let i=0;i<80;i++){
    const idx=Math.floor(rnd()*pointCount),p=track[idx],t=tangents[idx],side=(rnd()-.5)*roadWidth*.70;
    const pool=mesh(THREE,puddleGeo,waterMat,p.x+t.z*side,.055,p.z-t.x*side);
    pool.rotation.x=-PI/2;pool.scale.set(.5+rnd()*1.8,.2+rnd()*1.2,1);
    puddles.add(pool);
  }
  puddles.visible=false;scene.add(puddles);
  // Rain streaks: one batched dynamic line geometry, no individual objects.
  const drops=2400,positions=new Float32Array(drops*6),dropSeeds=new Float32Array(drops*3);
  for(let i=0;i<drops;i++){dropSeeds[i*3]=rnd()*200-100;dropSeeds[i*3+1]=rnd()*45;dropSeeds[i*3+2]=rnd()*200-100;}
  const rainGeo=new THREE.BufferGeometry();
  rainGeo.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const rain=new THREE.LineSegments(rainGeo,new THREE.LineBasicMaterial({
    color:'#c7ddec',transparent:true,opacity:.32,depthWrite:false,blending:THREE.AdditiveBlending
  }));
  rain.frustumCulled=false;rain.visible=false;scene.add(rain);
  const lamps=[];
  const lampHousing=new THREE.MeshStandardMaterial({color:'#d2d0bb',emissive:'#ffc983',emissiveIntensity:1.6,roughness:.25});
  for(let i=0;i<9;i++){
    const k=Math.floor(i*pointCount/9),p=track[k],t=tangents[k];
    const x=p.x+t.z*13,z=p.z-t.x*13;
    scene.add(mesh(THREE,new THREE.CylinderGeometry(.1,.2,15,8),roofMat,x,7.5,z,true));
    scene.add(mesh(THREE,new THREE.BoxGeometry(2.5,.45,1.2),lampHousing,x,15.1,z));
    const light=new THREE.PointLight('#ffdfaa',0,75,2);
    light.position.set(x,14.5,z);scene.add(light);lamps.push(light);
  }
  let rainy=false,night=false,phase=0,quality='high';
  function setWeather(value){
    rainy=value==='rain';rain.visible=rainy;puddles.visible=rainy;
    asphaltMaterial.roughness=rainy?.23:.89;
    asphaltMaterial.clearcoat=rainy?1:.06;
    asphaltMaterial.clearcoatRoughness=rainy?.06:.7;
    asphaltMaterial.color.set(rainy?'#656f79':'#878f96');
    asphaltMaterial.needsUpdate=true;
  }
  function setNight(value){
    night=Boolean(value);scene.background=(night?skyNight:rainy?new THREE.Color('#6d8697'):skyDay).clone();
    scene.fog.color.copy(scene.background);
    hemisphere.intensity=night?.43:rainy?1.27:2.05;
    sun.intensity=night?.25:rainy?1.3:3.25;
    warm.intensity=night?.10:.48;
    lamps.forEach(light=>light.intensity=night?85:0);
    renderer.toneMappingExposure=night?1.46:1.24;
  }
  function setQuality(value){
    quality=value;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,value==='ultra'?2:value==='high'?1.5:1));
    renderer.shadowMap.enabled=value!=='low';
    blades.visible=value!=='low';
    crowns.visible=true;
    sun.castShadow=value!=='low';
  }
  function update(dt,camera){
    if(!rainy)return;
    phase+=dt*24;
    const px=camera.position.x,pz=camera.position.z;
    for(let i=0;i<drops;i++){
      const b=i*3,offset=i*6;
      const x=px+dropSeeds[b]+phase*.45,y=((dropSeeds[b+1]-phase)%45+45)%45+.5;
      const z=pz+dropSeeds[b+2];
      positions[offset]=x;positions[offset+1]=y;positions[offset+2]=z;
      positions[offset+3]=x-.22;positions[offset+4]=y-1.25;positions[offset+5]=z-.12;
    }
    rainGeo.attributes.position.needsUpdate=true;
  }
  setWeather('sun');setNight(false);setQuality('high');
  return {setWeather,setNight,setQuality,update};
}

function badgeTexture(THREE,num){
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#f8f8ec';ctx.beginPath();ctx.arc(128,128,112,0,PI*2);ctx.fill();
  ctx.fillStyle='#172330';ctx.font='900 148px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(num,128,142);
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;return t;
}
export function createRealCar(THREE,scene,car){
  const root=new THREE.Group();
  const paint=new THREE.MeshPhysicalMaterial({
    color:car.color,metalness:.53,roughness:.24,clearcoat:1,clearcoatRoughness:.11
  });
  const carbon=new THREE.MeshStandardMaterial({color:'#171d24',metalness:.45,roughness:.38});
  const glass=new THREE.MeshPhysicalMaterial({color:'#1c353f',metalness:.28,roughness:.08,
    clearcoat:1,transparent:true,opacity:.96});
  const chrome=new THREE.MeshStandardMaterial({color:'#becacc',metalness:.88,roughness:.18});
  const red=new THREE.MeshStandardMaterial({color:'#e9222b',emissive:'#b9040d',emissiveIntensity:1.2});
  const white=new THREE.MeshStandardMaterial({color:'#f4f4dc',emissive:'#ffe3a5',emissiveIntensity:.9});
  const tireMat=new THREE.MeshStandardMaterial({color:'#171a1b',roughness:.96});
  // Extruded, softly beveled shell rather than a boxy toy placeholder.
  const silhouette=new THREE.Shape();
  silhouette.moveTo(-1.17,-2.72);
  silhouette.lineTo(1.17,-2.72);
  silhouette.quadraticCurveTo(1.52,-2.55,1.55,-2.25);
  silhouette.lineTo(1.57,2.14);
  silhouette.quadraticCurveTo(1.54,2.6,1.18,2.68);
  silhouette.lineTo(-1.18,2.68);
  silhouette.quadraticCurveTo(-1.54,2.60,-1.57,2.14);
  silhouette.lineTo(-1.55,-2.25);
  silhouette.quadraticCurveTo(-1.52,-2.55,-1.17,-2.72);
  const bodyGeometry=new THREE.ExtrudeGeometry(silhouette,{
    depth:.57,steps:1,bevelEnabled:true,bevelThickness:.16,bevelSize:.13,bevelSegments:3,curveSegments:8
  });
  bodyGeometry.rotateX(-PI/2);
  const shell=mesh(THREE,bodyGeometry,paint,0,.55,0,true);root.add(shell);
  const chassis=mesh(THREE,new THREE.BoxGeometry(2.6,.28,4.7),carbon,0,.55,0,true);root.add(chassis);
  // Canopy and hood: pronounced curved highlights in grazing light.
  const canopy=mesh(THREE,new THREE.SphereGeometry(1,32,16),glass,0,1.48,-.45,true);
  canopy.scale.set(1.12,.62,1.47);root.add(canopy);
  const roof=mesh(THREE,new THREE.BoxGeometry(1.55,.095,1.5),paint,0,1.98,-.58,true);root.add(roof);
  const hood=mesh(THREE,new THREE.BoxGeometry(2.32,.075,1.42),paint,0,1.30,1.55,true);
  hood.rotation.x=-.055;root.add(hood);
  // Racing stripe, wing, splitter and diffuser.
  const highlight=new THREE.MeshStandardMaterial({color:car.id===2?'#242426':'#e9e2d5',roughness:.34});
  root.add(mesh(THREE,new THREE.BoxGeometry(.24,.018,2),highlight,0,1.354,1.55));
  root.add(mesh(THREE,new THREE.BoxGeometry(3.25,.12,.55),carbon,0,.62,2.62,true));
  root.add(mesh(THREE,new THREE.BoxGeometry(3.25,.15,.72),carbon,0,1.75,-2.38,true));
  for(const x of [-1.18,1.18])root.add(mesh(THREE,new THREE.BoxGeometry(.13,.59,.20),carbon,x,1.38,-2.3,true));
  for(const x of [-1.08,1.08]) {
    root.add(mesh(THREE,new THREE.BoxGeometry(.62,.19,.13),white,x,1.08,2.67));
    root.add(mesh(THREE,new THREE.BoxGeometry(.64,.18,.14),red,x,1.07,-2.7));
    root.add(mesh(THREE,new THREE.BoxGeometry(.09,.16,1.45),chrome,x*1.30,.92,0));
  }
  const grille=mesh(THREE,new THREE.BoxGeometry(1.65,.23,.10),carbon,0,.91,2.71);root.add(grille);
  // Independent wheel groups support future steering animation.
  const tireGeo=new THREE.CylinderGeometry(.78,.78,.54,28);
  const rimGeo=new THREE.CylinderGeometry(.42,.42,.575,16);
  const spokes=new THREE.TorusGeometry(.36,.045,7,12);
  car.wheelParts=[];car.steerWheels=[];
  for(const z of [-1.76,1.78])for(const x of [-1.50,1.50]){
    const mount=new THREE.Group();mount.position.set(x,.70,z);
    const tire=mesh(THREE,tireGeo,tireMat,0,0,0,true);tire.rotation.z=PI/2;
    mount.add(tire);car.wheelParts.push(tire);
    const hub=mesh(THREE,rimGeo,chrome,0,0,0);hub.rotation.z=PI/2;mount.add(hub);car.wheelParts.push(hub);
    const rim=mesh(THREE,spokes,carbon,x>0?.31:-.31,0,0);rim.rotation.y=PI/2;mount.add(rim);
    root.add(mount);if(z>0)car.steerWheels.push(mount);
  }
  // Racing numbers are readable even at moderate zoom.
  const decal=mesh(THREE,new THREE.PlaneGeometry(.91,.91),
    new THREE.MeshBasicMaterial({map:badgeTexture(THREE,String(car.id+1)),transparent:true,depthWrite:false}),
    0,2.044,-.56);
  decal.rotation.x=-PI/2;root.add(decal);
  const antenna=mesh(THREE,new THREE.CylinderGeometry(.018,.03,1.7,6),carbon,1.01,2.28,-1.63);
  antenna.rotation.z=.10;root.add(antenna);
  const lampGlass=new THREE.MeshBasicMaterial({color:'#fff2d9',transparent:true,opacity:.7});
  for(const x of [-1.08,1.08])root.add(mesh(THREE,new THREE.SphereGeometry(.18,12,8),lampGlass,x,1.08,2.75));
  const underglow=mesh(THREE,new THREE.CircleGeometry(2.42,28),
    new THREE.MeshBasicMaterial({color:'#091017',transparent:true,opacity:.24,depthWrite:false}),0,.06,0);
  underglow.rotation.x=-PI/2;underglow.scale.set(1,.88,1);root.add(underglow);
  root.scale.setScalar(.84);scene.add(root);car.visual=root;
  return root;
}