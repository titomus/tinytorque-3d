/**
 * TinyTorque personal lap records. No server and no account.
 * Each visitor owns a browser-local book for this exact track layout.
 * Pure functions are shared by browser gameplay and Node regression tests.
 */
export const RECORDS_KEY = 'tinytorque-real-lap-records-v1';
export const DRIVER_KEY = 'tinytorque-real-driver-v1';
export const X_HANDLE_KEY = 'tinytorque-real-x-handle-v1';
export const TRACK_ID = 'backyard-real-v1';
export const MAX_VALID_LAP = 240;
export const MIN_VALID_LAP = 8;

export const newRecordBook = () => ({
  version:1,
  trackId:TRACK_ID,
  bestByCar:[null,null,null,null],
  lapsRecorded:0
});
export function formatLap(seconds) {
  if(!Number.isFinite(seconds) || seconds<0) return '--:--.--';
  const hundredths=Math.floor(seconds*100+1e-7);
  const minutes=Math.floor(hundredths/6000);
  const secs=Math.floor((hundredths%6000)/100);
  return String(minutes).padStart(2,'0')+':'+String(secs).padStart(2,'0')+'.'+
    String(hundredths%100).padStart(2,'0');
}
export function sanitizeDriver(value) {
  if(typeof value!=='string')return 'Anonyme';
  const name=value.replace(/[\r\n\t<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,24);
  return name || 'Anonyme';
}
/** Never invent an X account from a nickname. Mentions are explicit opt-in. */
export function sanitizeXHandle(value) {
  if(typeof value!=='string')return '';
  const handle=value.trim().replace(/^@/,'');
  return /^[a-zA-Z0-9_]{1,15}$/.test(handle) ? handle : '';
}
export function validLapSeconds(seconds) {
  return typeof seconds==='number' && Number.isFinite(seconds) && seconds>=MIN_VALID_LAP && seconds<=MAX_VALID_LAP;
}
export function restoreRecordBook(raw) {
  const book=newRecordBook();
  if(!raw || typeof raw!=='object' || raw.version!==1 || raw.trackId!==TRACK_ID ||
    !Array.isArray(raw.bestByCar))return book;
  for(let i=0;i<4;i++) {
    const entry=raw.bestByCar[i];
    if(!entry || !validLapSeconds(entry.time) || entry.carId!==i)continue;
    book.bestByCar[i]={
      carId:i,
      time:entry.time,
      driver:sanitizeDriver(entry.driver),
      xHandle:sanitizeXHandle(entry.xHandle),
      at:typeof entry.at==='string'?entry.at.slice(0,32):'',
      tune:entry.tune && typeof entry.tune==='object' ? JSON.parse(JSON.stringify(entry.tune)) : {}
    };
  }
  book.lapsRecorded=Number.isInteger(raw.lapsRecorded) ?
    Math.max(0,Math.min(10000000,raw.lapsRecorded)) : book.bestByCar.filter(Boolean).length;
  return book;
}
export function fastestRecord(book) {
  return book.bestByCar.filter(Boolean).sort((a,b)=>a.time-b.time)[0] ?? null;
}
export function submitLap(book, {carId,time,driver,at,tune,xHandle}) {
  if(!Number.isInteger(carId) || carId<0 || carId>3 || !validLapSeconds(time)) {
    return {accepted:false,personalBest:false,overallBest:false};
  }
  const oldOverall=fastestRecord(book);
  const oldCar=book.bestByCar[carId];
  const personalBest=!oldCar || time<oldCar.time-0.00001;
  const overallBest=!oldOverall || time<oldOverall.time-0.00001;
  book.lapsRecorded++;
  if(personalBest) {
    book.bestByCar[carId]={
      carId,time,driver:sanitizeDriver(driver),
      xHandle:sanitizeXHandle(xHandle),
      at:typeof at==='string'?at.slice(0,32):'',
      tune:JSON.parse(JSON.stringify(tune || {}))
    };
  }
  return {accepted:true,personalBest,overallBest};
}
export function buildChallengeLink(entry, currentUrl) {
  if(!entry || !validLapSeconds(entry.time) || !Number.isInteger(entry.carId))return currentUrl;
  const url=new URL(currentUrl);
  url.search='';
  url.hash='';
  url.searchParams.set('tt_time',entry.time.toFixed(3));
  url.searchParams.set('tt_car',String(entry.carId));
  url.searchParams.set('tt_by',sanitizeDriver(entry.driver));
  const xHandle=sanitizeXHandle(entry.xHandle);
  if(xHandle)url.searchParams.set('tt_x',xHandle);
  return url.toString();
}
export function readChallenge(search) {
  const params=new URLSearchParams(search);
  if(!params.has('tt_time')||!params.has('tt_car'))return null;
  const time=Number(params.get('tt_time'));
  const carId=Number(params.get('tt_car'));
  if(!validLapSeconds(time)||!Number.isInteger(carId)||carId<0||carId>3)return null;
  return {time,carId,driver:sanitizeDriver(params.get('tt_by')),
    xHandle:sanitizeXHandle(params.get('tt_x'))};
}

export function makeShareText({entry,carName,driveName,url,xHandle}) {
  if(!entry || !validLapSeconds(entry.time))return '';
  const mention=sanitizeXHandle(xHandle ?? entry.xHandle);
  const author=mention?'@'+mention:sanitizeDriver(entry.driver);
  return '🏁 RECORD À BATTRE : '+formatLap(entry.time)+'\n'+
    '👤 '+author+' · '+carName+' ('+driveName+')\n'+
    'Qui fera mieux ?\n'+url+'\n#TinyTorque #RCCars';
}
export function lapCrossing(car, elapsed) {
  // First pass of the finish line establishes the starting reference.
  // Starting grid cars sit past the line, so their opening partial lap
  // is deliberately excluded from the record leaderboard.
  const result={complete:false,valid:false,seconds:null};
  if(car.lapStartAt!==null) {
    result.complete=true;
    result.seconds=elapsed-car.lapStartAt;
    result.valid=!car.lapInvalid && validLapSeconds(result.seconds);
  }
  car.lapStartAt=elapsed;
  car.lapInvalid=false;
  return result;
}
