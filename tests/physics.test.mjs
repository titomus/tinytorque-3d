import test from 'node:test';
import assert from 'node:assert/strict';
import { createVehicleState, tuneVehicle, TUNE_FIELDS, DRIVE_MODES } from '../assets/physics.mjs';

const chassis = {
  massFactor: 1, wheelbase:3.1, frontWeight:.53, speedFactor:1,
  nativeGrip:1, yawInertia:1, trackWidth:2.7, rollResist:1
};
const baseline = {
  power:115, topSpeed:32, gearing:1, diffLock:.6, grip:1.05, pressure:1,
  mass:95, cg:.5, suspension:1, steering:1, brakeBias:.6, aero:.9,
  aggression:1, drivetrain:'rwd'
};

function sample(tuneOverrides={}, opts={}) {
  const s=createVehicleState();
  const tune={...baseline,...tuneOverrides};
  const time=opts.time ?? 3;
  for(let i=0;i<Math.round(time*60);i++) {
    tuneVehicle(s,tune,chassis,{
      throttle:opts.throttle??1,brake:opts.brake??0,steer:opts.steer??0
    },opts.offroad??0,1/60);
  }
  return s;
}

test('13 tuners and 3 drivetrains exist',()=>{
  assert.equal(TUNE_FIELDS.length,13);
  assert.deepEqual(Object.keys(DRIVE_MODES),['fwd','rwd','awd']);
});

test('4WD, front drive and rear drive have different launch acceleration',()=>{
  const fwd=sample({drivetrain:'fwd'});
  const rwd=sample({drivetrain:'rwd'});
  const awd=sample({drivetrain:'awd'});
  assert.ok(awd.speed > rwd.speed,'AWD should launch harder than RWD');
  assert.ok(rwd.speed > fwd.speed,'Rear axle has slightly more available traction in this chassis');
});

test('lighter car accelerates faster',()=>{
  // In a power-limited configuration, a lighter chassis accelerates faster.
  const light=sample({drivetrain:'awd',power:55,grip:1.5,mass:75});
  const heavy=sample({drivetrain:'awd',power:55,grip:1.5,mass:145});
  assert.ok(light.speed > heavy.speed+3);
});

test('loss of road traction changes behavior',()=>{
  const road=sample({}, {time:2.5});
  const grass=sample({}, {time:2.5,offroad:9});
  assert.ok(road.speed > grass.speed+2, 'Offroad speed should drop due to reduced grip and drag');
});

test('gearing trades acceleration for maximum speed',()=>{
  const short=sample({drivetrain:'awd',power:55,grip:1.5,gearing:1.4},{time:2});
  const tall=sample({drivetrain:'awd',power:55,grip:1.5,gearing:.7},{time:2});
  assert.ok(short.speed > tall.speed,'Short gears should accelerate faster from rest');
});

test('steering produces yaw and sideslip, without snapping travel direction to heading',()=>{
  const s=sample({drivetrain:'rwd',power:170,grip:.7},{time:2.8,steer:.7});
  assert.ok(Math.abs(s.heading)>.25);
  assert.ok(Math.abs(s.slip)>3);
  assert.ok(Math.abs(s.x)>.4);
});

test('dynamic integration stays finite through abusive driver inputs',()=>{
  const s=createVehicleState();
  const t={...baseline,grip:.55,cg:.9,suspension:1.5,power:180,steering:1.55};
  for(let i=0;i<12000;i++){
    const control={
      throttle:i%600<390?1:0,
      brake:i%600>=390?.8:0,
      steer:Math.sin(i/47)
    };
    tuneVehicle(s,t,chassis,control,i%1500<500?8:0,1/60);
    for(const key of ['x','z','vx','vz','heading','yawRate','speed','slip','roll']) {
      assert.ok(Number.isFinite(s[key]),key+' diverged at step '+i);
    }
  }
});

test('maxing every slider does not erase chassis differences',()=>{
  const chassisSet=[
    {massFactor:.96,wheelbase:3.15,frontWeight:.54,speedFactor:1,nativeGrip:1,yawInertia:1,trackWidth:2.65,rollResist:1.05},
    {massFactor:1.04,wheelbase:3.5,frontWeight:.48,speedFactor:1.1,nativeGrip:.94,yawInertia:1.14,trackWidth:2.50,rollResist:.96},
    {massFactor:.89,wheelbase:2.85,frontWeight:.61,speedFactor:.94,nativeGrip:1.12,yawInertia:.78,trackWidth:2.95,rollResist:1.14},
    {massFactor:1.13,wheelbase:3.05,frontWeight:.44,speedFactor:1.04,nativeGrip:1.02,yawInertia:.90,trackWidth:2.70,rollResist:.90}
  ];
  const allMax={drivetrain:'awd'};
  for (const tuner of TUNE_FIELDS) allMax[tuner.key]=tuner.max;
  const distances=chassisSet.map(chassis=>{
    const state=createVehicleState();
    for(let i=0;i<360;i++)tuneVehicle(state,allMax,chassis,{steer:0,throttle:1,brake:0},0,1/60);
    return Number(state.z.toFixed(2));
  });
  assert.ok(new Set(distances).size===4,'Four distinct chassis must remain physically distinct');
});
