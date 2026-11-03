/**
 * TinyTorque v0.2: deterministic 2D single-track (bicycle) vehicle dynamics.
 * World x/z coordinates; heading 0 points toward +z.
 * The vehicle model is deliberately simplified, but momentum is not attached to heading.
 * Front and rear axle forces have a shared friction budget for driving and cornering.
 */
export const DRIVE_MODES = Object.freeze({ fwd:'Traction (AV)', rwd:'Propulsion (AR)', awd:'4 roues motrices' });

export const TUNE_FIELDS = [
  { group:'MOTEUR & TRANSMISSION', key:'power',label:'Puissance moteur',min:55,max:180,step:5,unit:'%',desc:'Plus de couple peut saturer les pneus.' },
  { group:'MOTEUR & TRANSMISSION', key:'topSpeed',label:'Vitesse de pointe',min:16,max:42,step:1,unit:'m/s',desc:'Vitesse théorique avant les pertes aérodynamiques.' },
  { group:'MOTEUR & TRANSMISSION', key:'gearing',label:'Rapport de transmission',min:.7,max:1.4,step:.05,unit:'',desc:'Court = plus de reprise, moins de vitesse finale.' },
  { group:'MOTEUR & TRANSMISSION', key:'diffLock',label:'Blocage différentiel',min:.25,max:1,step:.05,unit:'',desc:'Favorise la motricité, mais pénalise les virages serrés.' },
  { group:'PNEUS & CHÂSSIS', key:'grip',label:'Gomme / adhérence',min:.55,max:1.55,step:.05,unit:'',desc:'Plus de grip, mais davantage de contraintes en virage.' },
  { group:'PNEUS & CHÂSSIS', key:'pressure',label:'Pression des pneus',min:.7,max:1.3,step:.05,unit:'',desc:'Un réglage extrême dégrade le contact avec le sol.' },
  { group:'PNEUS & CHÂSSIS', key:'mass',label:'Masse',min:65,max:155,step:5,unit:'kg',desc:'Affecte la reprise, le freinage et les collisions.' },
  { group:'PNEUS & CHÂSSIS', key:'cg',label:'Hauteur centre de gravité',min:.25,max:.9,step:.05,unit:'',desc:'Haut = plus de transfert de masse et risque de tonneau.' },
  { group:'PNEUS & CHÂSSIS', key:'suspension',label:'Souplesse suspension',min:.55,max:1.5,step:.05,unit:'',desc:'Souple = meilleur sur l’herbe, moins stable sur bitume.' },
  { group:'DIRECTION & PILOTE', key:'steering',label:'Angle de braquage',min:.65,max:1.55,step:.05,unit:'',desc:'Un braquage excessif peut déstabiliser la voiture.' },
  { group:'DIRECTION & PILOTE', key:'brakeBias',label:'Freinage sur l’avant',min:.35,max:.75,step:.05,unit:'',desc:'Trop à l’arrière provoque des têtes-à-queue.' },
  { group:'DIRECTION & PILOTE', key:'aero',label:'Appui aérodynamique',min:.45,max:1.6,step:.05,unit:'',desc:'Plus d’appui en virage, mais plus de traînée.' },
  { group:'DIRECTION & PILOTE', key:'aggression',label:'Agressivité du pilote',min:.7,max:1.3,step:.05,unit:'',desc:'Freine plus tard : gagne du temps ou sort de piste.' }
];

export function createVehicleState(x=0,z=0,heading=0) {
  return {
    x,z,vx:0,vz:0,heading,yawRate:0,speed:0,slip:0,lateralG:0,
    roll:0,rollOver:0,slide:false,frontUtil:0,rearUtil:0,
    lastAx:0,steerAngle:0,overloadTime:0
  };
}
export const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

export function tuneVehicle(state, tune, chassis, controls, offroad, dt) {
  const mass = tune.mass * chassis.massFactor;
  const wb = chassis.wheelbase;
  const baseSpeed = tune.topSpeed * (1.32 - .32*tune.gearing) * chassis.speedFactor;
  const h = tune.cg;
  const speed = Math.hypot(state.vx,state.vz);
  const s = Math.sin(state.heading), c = Math.cos(state.heading);
  const vF = state.vx*s + state.vz*c;
  const vS = state.vx*c - state.vz*s;
  const delta = clamp(controls.steer,-1,1) * clamp(tune.steering*.44/(1+speed/65),.12,.7);
  state.steerAngle = delta;
  const grass = clamp(offroad,0,25);
  const grassRatio = clamp(grass / 3.6,0,1);
  const pressureFactor = clamp(1 - 1.25*(tune.pressure-1)**2,.65,1);
  const tarmacSusp = clamp(1.04 - .08*Math.abs(tune.suspension-.95),.91,1.06);
  const grassSusp = .67 + .35*tune.suspension;
  const aeroLoad = speed*speed*.00032*tune.aero;
  const mu = tune.grip * chassis.nativeGrip * pressureFactor *
    ((1-grassRatio)*tarmacSusp + grassRatio*.32*grassSusp) *
    (1 + aeroLoad);
  // Dynamic transfer between axles: acceleration loads the rear, braking loads the front.
  const frontFraction = clamp(chassis.frontWeight - state.lastAx*h/(9.81*wb),.25,.79);
  const totalN = mass*9.81;
  const fN = totalN*frontFraction, rN = totalN*(1-frontFraction);
  const maxF = Math.max(1,mu*fN), maxR = Math.max(1,mu*rN);

  // Gear ratio boosts pull while reducing terminal speed; aero drag is the other trade-off.
  const engine = Math.max(0,controls.throttle) * tune.power*12*tune.gearing*
    (1 - clamp(Math.max(vF,0) / Math.max(baseSpeed,5),0,1)**2);
  const drivetrain = tune.drivetrain==='fwd'?'fwd':tune.drivetrain==='awd'?'awd':'rwd';
  const driveFShare = drivetrain==='fwd'?1:drivetrain==='awd'?.53:0;
  const driveRShare = 1-driveFShare;
  // Corner drag when the differential is locked too hard.
  const torquePenalty = 1-.17*(tune.diffLock-.25)*Math.min(1,Math.abs(delta)*2);
  const drive = engine * torquePenalty * (drivetrain==='awd'?.91:1);
  const brakeTotal = Math.max(0,controls.brake)*mass*10.9*(.7+mu*.25);
  let fxF = drive*driveFShare - brakeTotal*tune.brakeBias;
  let fxR = drive*driveRShare - brakeTotal*(1-tune.brakeBias);
  // A longitudinal demand must fit in the axle's tire-force circle.
  fxF = clamp(fxF,-maxF,maxF);
  fxR = clamp(fxR,-maxR,maxR);
  const capF = Math.sqrt(Math.max(0,maxF*maxF-fxF*fxF));
  const capR = Math.sqrt(Math.max(0,maxR*maxR-fxR*fxR));

  const a = wb*(1-chassis.frontWeight), b=wb*chassis.frontWeight;
  // Small denominator for numerical stability, while retaining true wheel sideslip.
  const denominator = Math.max(3.3,Math.abs(vF));
  const slipF = Math.atan2(vS+a*state.yawRate,denominator)-delta;
  const slipR = Math.atan2(vS-b*state.yawRate,denominator);
  const stiffF = fN*(5.2 + .5*tune.steering), stiffR=rN*(5.3+.45*tune.suspension);
  const fyF = clamp(-slipF*stiffF,-capF,capF);
  const fyR = clamp(-slipR*stiffR,-capR,capR);

  const aerodynamicDrag = (.33 + .19*tune.aero)*(vF*Math.abs(vF)) + .7*mass;
  const fx = fxF*Math.cos(delta)+fxR-fyF*Math.sin(delta)
    - Math.sign(vF)*aerodynamicDrag;
  const fy = fyF*Math.cos(delta)+fyR+fxF*Math.sin(delta);
  const ax = fx / mass, ay = fy / mass;
  // Front / rear tire forces generate yaw; yaw inertia differs by chassis.
  const iz = mass*wb*wb*.29*chassis.yawInertia;
  const yawAcceleration = (a*(fyF*Math.cos(delta)+fxF*Math.sin(delta)) - b*fyR) / iz;
  state.yawRate = (state.yawRate + yawAcceleration*dt)*Math.exp(-.35*dt);
  state.yawRate=clamp(state.yawRate,-5,5);
  state.heading += state.yawRate*dt;
  state.vx += (ax*s+ay*c)*dt;
  state.vz += (ax*c-ay*s)*dt;
  // Resist pure side sliding on grass, and prevent backwards speed explosion.
  const air = Math.exp(-(grassRatio*.19+.012)*dt);
  state.vx *= air;
  state.vz *= air;
  const capped = Math.hypot(state.vx,state.vz);
  const hardCap = baseSpeed*1.18;
  if (capped>hardCap) {state.vx*=hardCap/capped;state.vz*=hardCap/capped;}
  state.x+=state.vx*dt;
  state.z+=state.vz*dt;
  state.speed=Math.hypot(state.vx,state.vz);
  const velocityHeading = Math.atan2(state.vx,state.vz);
  state.slip = Math.atan2(Math.sin(velocityHeading-state.heading),Math.cos(velocityHeading-state.heading))*180/Math.PI;
  if (state.speed<.5) state.slip=0;
  state.lateralG=Math.abs(ay)/9.81;
  state.lastAx=clamp(ax,-14,14);
  state.frontUtil=Math.min(1,Math.hypot(fxF,fyF)/Math.max(1,maxF));
  state.rearUtil=Math.min(1,Math.hypot(fxR,fyR)/Math.max(1,maxR));
  state.slide = Math.abs(state.slip)>15 && state.speed>7;
  const rollTarget = clamp((ay/9.81)*h*tune.suspension/chassis.trackWidth*1.3,-1.5,1.5);
  state.roll += (rollTarget-state.roll)*Math.min(1,dt*(5/tune.suspension));
  const rolloverLimit = chassis.rollResist * (1.15-h*.44) / (tune.suspension*.75+.25);
  state.overloadTime = Math.max(0,state.overloadTime + (Math.abs(state.roll)>rolloverLimit ? dt : -dt*1.7));
  if (state.overloadTime>.36) {
    state.rollOver++;
    state.overloadTime=0;
    state.roll=0;
    state.vx*=.18;
    state.vz*=.18;
    state.yawRate += (state.rollOver%2 ? 2 : -2);
  }
  return {speedLimit:baseSpeed,frontGrip:state.frontUtil,rearGrip:state.rearUtil};
}
