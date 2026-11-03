import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACK_CONTROL_POINTS } from '../assets/track.mjs';
import { smoothClosedTrack,createGuardrailTrack,projectToSegment } from '../assets/guardrails.mjs';

// Mirror Three.js's centripetal-free Catmull-Rom "catmullrom" tension 0.34
// to test the same sharp control-point turns without any WebGL dependency.
function sampleCurve(t) {
  const n=TRACK_CONTROL_POINTS.length, k=Math.floor(t*n),u=t*n-k;
  const point=i=>TRACK_CONTROL_POINTS[(i+n)%n];
  const p0=point(k-1),p1=point(k),p2=point(k+1),p3=point(k+2);
  const a=u*u,b=a*u;
  return [0,1].map(j=>(2*b-3*a+1)*p1[j]+
    (b-2*a+u)*.34*(p2[j]-p0[j])+
    (-2*b+3*a)*p2[j]+(b-a)*.34*(p3[j]-p1[j]));
}
function circuit(count=420) {
  const dense=Array.from({length:6001},(_,i)=>sampleCurve(i/6000));
  const cumulative=[0];
  for(let i=1;i<dense.length;i++)
    cumulative[i]=cumulative[i-1]+Math.hypot(dense[i][0]-dense[i-1][0],dense[i][1]-dense[i-1][1]);
  const length=cumulative.at(-1);
  return Array.from({length:count},(_,i)=>{
    const target=length*i/count;
    let lo=0,hi=cumulative.length-1;
    while(lo<hi){
      const mid=(lo+hi)>>1;
      if(cumulative[mid]<target)lo=mid+1;
      else hi=mid;
    }
    const a=Math.max(1,lo),ratio=(target-cumulative[a-1])/(cumulative[a]-cumulative[a-1]);
    return {x:dense[a-1][0]+(dense[a][0]-dense[a-1][0])*ratio,
      z:dense[a-1][1]+(dense[a][1]-dense[a-1][1])*ratio};
  });
}

test('rounded circuit eliminates inverted rails inside tight hairpins',()=>{
  const track=smoothClosedTrack(circuit(),7);
  const rails=createGuardrailTrack(track,12,2.5);
  for(let i=0;i<track.length;i++){
    const prev=track[(i+track.length-1)%track.length];
    const next=track[(i+1)%track.length];
    const dx=next.x-prev.x,dz=next.z-prev.z;
    const mag=Math.hypot(dx,dz);
    for(const side of rails.sides) {
      const seg=side.segments[i],segMag=Math.hypot(seg.dx,seg.dz);
      const alignment=(dx*seg.dx+dz*seg.dz)/(mag*segMag);
      assert.ok(alignment>.70, 'rail folds back at '+i+' side '+side.side+': '+alignment);
    }
  }
});

test('rails retain enough room for cars around the rounded circuit',()=>{
  const track=smoothClosedTrack(circuit(),7);
  const rails=createGuardrailTrack(track,12,2.5);
  for(let i=0;i<track.length;i++){
    const p=track[i];
    for(const side of rails.sides){
      let closest=Infinity;
      for(let j=-15;j<=15;j++){
        const index=(i+j+track.length)%track.length;
        const proj=projectToSegment(p.x,p.z,side.segments[index]);
        closest=Math.min(closest,Math.sqrt(proj.dist2));
      }
      assert.ok(closest>7.5,'rail encroaches on centerline at '+i+': '+closest);
    }
  }
});

test('closed-loop smoothing keeps point count and finite coordinates',()=>{
  const original=circuit();
  const rounded=smoothClosedTrack(original,7);
  assert.equal(original.length,rounded.length);
  assert.ok(rounded.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.z)));
  assert.ok(original.some((p,i)=>Math.hypot(p.x-rounded[i].x,p.z-rounded[i].z)>.2));
});
