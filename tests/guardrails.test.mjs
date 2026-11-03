import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuardrailTrack,collideWithGuardrails,projectToSegment } from '../assets/guardrails.mjs';

const center=Array.from({length:120},(_,i)=> {
  const a=i*Math.PI*2/120;
  return {x:Math.cos(a)*55,z:Math.sin(a)*55};
});
const rails=createGuardrailTrack(center,12,2.5);

test('two continuous guardrails follow the entire circuit',()=>{
  assert.equal(rails.sides.length,2);
  assert.equal(rails.sides[0].segments.length,center.length);
  assert.equal(rails.sides[1].segments.length,center.length);
  for(const side of rails.sides) {
    const first=side.segments[0];
    const previous=side.segments.at(-1);
    assert.ok(Math.hypot(first.ax-previous.bx,first.az-previous.bz)<1e-8);
  }
});

test('wall responds to a direct impact and keeps the vehicle inside',()=>{
  const seg=rails.sides[0].segments[20];
  const mx=(seg.ax+seg.bx)/2,mz=(seg.az+seg.bz)/2;
  const s={x:mx+seg.outX*.6,z:mz+seg.outZ*.6,vx:seg.outX*13,vz:seg.outZ*13,yawRate:0,speed:13};
  const hit=collideWithGuardrails(s,rails,20,1/60);
  assert.ok(hit.impacts>0,'should hit');
  assert.ok(hit.maxImpact>10,'impact should have real energy');
  const projected=projectToSegment(s.x,s.z,seg);
  assert.ok(projected.signed<-1.27,'vehicle must remain inside rail');
  assert.ok(s.vx*seg.outX+s.vz*seg.outZ<0,'must rebound inward');
});

test('grazing along a barrier loses some speed, not all momentum',()=>{
  const seg=rails.sides[1].segments[45];
  const mx=(seg.ax+seg.bx)/2,mz=(seg.az+seg.bz)/2;
  const tangent={x:seg.dx/Math.sqrt(seg.len2),z:seg.dz/Math.sqrt(seg.len2)};
  const s={x:mx-seg.outX*.5,z:mz-seg.outZ*.5,
    vx:tangent.x*18+seg.outX*3,vz:tangent.z*18+seg.outZ*3,yawRate:0};
  collideWithGuardrails(s,rails,45,1/60);
  const along=s.vx*tangent.x+s.vz*tangent.z;
  assert.ok(along>9 && along<18,'barrier should bleed but retain tangential velocity');
});

test('high-speed trajectories cannot pass through a rail at one integration step',()=>{
  const seg=rails.sides[0].segments[70];
  const mx=(seg.ax+seg.bx)/2,mz=(seg.az+seg.bz)/2;
  const startX=mx-seg.outX*2,startZ=mz-seg.outZ*2;
  const s={x:startX+seg.outX*4,z:startZ+seg.outZ*4,
    vx:seg.outX*80,vz:seg.outZ*80,yawRate:0};
  collideWithGuardrails(s,rails,70,1/60,{oldX:startX,oldZ:startZ});
  assert.ok(projectToSegment(s.x,s.z,seg).signed<=-1.28,'cannot tunnel through');
});

test('repeated pressure against the wall has no numerical explosion',()=>{
  const seg=rails.sides[1].segments[6];
  const mx=(seg.ax+seg.bx)/2,mz=(seg.az+seg.bz)/2;
  const s={x:mx-seg.outX*1.45,z:mz-seg.outZ*1.45,vx:0,vz:0,yawRate:0};
  for(let i=0;i<600;i++){
    s.vx+=seg.outX*.25;s.vz+=seg.outZ*.25;
    s.x+=s.vx/60;s.z+=s.vz/60;
    collideWithGuardrails(s,rails,6,1/60);
    for(const key of ['x','z','vx','vz','yawRate','speed'])assert.ok(Number.isFinite(s[key]),key);
    assert.ok(projectToSegment(s.x,s.z,seg).signed<-.9,'inside rail');
  }
});
