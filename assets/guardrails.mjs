/**
 * Twin roadside barriers for TinyTorque.
 *
 * Pure geometry and 2-D swept-circle collision. No Three.js dependency.
 * Rails sit outside the tarmac, leaving a narrow grass runoff.
 * All visual geometry and collisions use the exact same segments.
 */
export const DEFAULT_RUNOFF = 2.5;
export const DEFAULT_CAR_RADIUS = 1.30;
export const WALL_HEIGHT = 1.55;

/**
 * Smooth a closed racing line so a continuous offset guardrail never folds
 * back into the tarmac at extremely sharp bends. This is a periodic Gaussian
 * filter, preserving the original point count and cyclic indices.
 */
export function smoothClosedTrack(points, sigma = 7) {
  if (!Number.isFinite(sigma) || sigma <= 0) return points.map(p=>({x:p.x,z:p.z}));
  if (!Array.isArray(points) || points.length < 3) throw new Error('Closed track needs three points');
  const radius=Math.min(Math.floor((points.length-1)/2),Math.ceil(sigma*3));
  const weights=Array.from({length:radius*2+1},(_,i)=>
    Math.exp(-.5*((i-radius)/sigma)**2));
  const sum=weights.reduce((a,b)=>a+b,0);
  return points.map((point,i)=>{
    let x=0,z=0;
    for(let k=-radius;k<=radius;k++){
      const p=points[(i+k+points.length)%points.length],w=weights[k+radius];
      x+=p.x*w;z+=p.z*w;
    }
    return {x:x/sum,z:z/sum};
  });
}

export function createGuardrailTrack(center, roadWidth, runoff = DEFAULT_RUNOFF) {
  if (!Array.isArray(center) || center.length < 3) {
    throw new Error('At least three centerline points are required');
  }
  const count=center.length;
  const distance=roadWidth/2+runoff;
  const sides=[-1,1].map(side=>{
    const points=center.map((point,i)=>{
      const previous=center[(i+count-1)%count];
      const next=center[(i+1)%count];
      const dx=next.x-previous.x,dz=next.z-previous.z;
      const mag=Math.hypot(dx,dz)||1;
      return {x:point.x+side*dz/mag*distance,z:point.z-side*dx/mag*distance};
    });
    return {
      side,points,
      segments:points.map((a,i)=>{
        const b=points[(i+1)%count];
        const dx=b.x-a.x,dz=b.z-a.z,mag=Math.hypot(dx,dz)||1;
        return {i,ax:a.x,az:a.z,bx:b.x,bz:b.z,
          outX:side*dz/mag,outZ:-side*dx/mag,
          dx,dz,len2:dx*dx+dz*dz};
      })
    };
  });
  return {sides,count,roadWidth,runoff,distance};
}
export function projectToSegment(x,z,segment) {
  const t=Math.max(0,Math.min(1,((x-segment.ax)*segment.dx+(z-segment.az)*segment.dz)/Math.max(segment.len2,1e-9)));
  const px=segment.ax+t*segment.dx;
  const pz=segment.az+t*segment.dz;
  return {px,pz,t,dist2:(x-px)**2+(z-pz)**2,
    signed:(x-px)*segment.outX+(z-pz)*segment.outZ};
}
/**
 * Continuously detect crossing of a line segment with a moving circle.
 * Returns earliest contact against a rail side on the expected route section.
 * Local indexed searches avoid accidental impacts with nearby hairpin branches.
 */
export function collideWithGuardrails(state, rails, progressIndex, dt, options = {}) {
  const radius=options.radius??DEFAULT_CAR_RADIUS;
  const restitution=options.restitution??0.17;
  const friction=options.friction??0.12;
  const window=Math.min(Math.floor(rails.count/3), options.window??15);
  const count=rails.count;
  let impacts=0,maxImpact=0;
  // Project to the closest local rail segment, not a different branch of a hairpin.
  // A single physical impulse is applied each frame; additional passes correct
  // the position along neighboring segments without repeatedly killing speed.
  let impulseUsed=false;
  for(let attempt=0;attempt<5;attempt++) {
    let contact=null,dist2=Infinity;
    for(const side of rails.sides) {
      let nearest=null,nearDistance=Infinity;
      for(let d=-window;d<=window;d++) {
        const seg=side.segments[(progressIndex+d+count)%count];
        const proj=projectToSegment(state.x,state.z,seg);
        if(proj.dist2<nearDistance) {
          nearDistance=proj.dist2;
          nearest={seg,proj};
        }
      }
      if(nearest && nearest.proj.signed > -radius && nearDistance < dist2) {
        contact=nearest;
        dist2=nearDistance;
      }
    }
    if(!contact)break;
    const {seg,proj}=contact;
    const correction=Math.min(50,proj.signed+radius+.025);
    if(correction<=0)break;
    state.x-=seg.outX*correction;
    state.z-=seg.outZ*correction;
    const outward=state.vx*seg.outX+state.vz*seg.outZ;
    if(outward>0 && !impulseUsed) {
      const tx=-seg.outZ,tz=seg.outX;
      const tangential=state.vx*tx+state.vz*tz;
      maxImpact=outward;
      state.vx=tx*tangential*(1-friction)-seg.outX*outward*restitution;
      state.vz=tz*tangential*(1-friction)-seg.outZ*outward*restitution;
      state.yawRate=(state.yawRate||0)*.80+Math.max(-.7,Math.min(.7,tangential*.007))*seg.outX;
      impacts=1;
      impulseUsed=true;
    }
  }
  state.speed=Math.hypot(state.vx,state.vz);
  return {impacts,maxImpact};
}
