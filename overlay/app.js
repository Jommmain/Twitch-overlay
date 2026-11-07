import {ChatterRoster,avatarFor} from './chat-avatars.js';
import {TriggerEngine, EventQueue, resolveRunDirection, runPosition, dustTrail, scatterTarget} from './engine.js';
const $=id=>document.getElementById(id), params=new URLSearchParams(location.search);
const demo=params.get('demo')==='1', testing=demo&&params.get('test')==='1',gallery=testing&&params.get('gallery')==='1';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let seed=(Number(params.get('seed'))||3719)>>>0;
const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
const rand=(a,b)=>a+(b-a)*random();
const numeric=(key,fallback,min=0,max=1e7)=>clamp(Number.isFinite(Number(params.get(key)))&&params.has(key)?Number(params.get(key)):fallback,min,max);
const canvas=$('stage'),ctx=canvas.getContext('2d',{alpha:true});
let roster,chatStatus='Чат не подключён',lastLabels=[],lastBubbles=[],fakeIndex=0,fakeMessageIndex=0;
let config,engine,queue,characters=[],soldierImages=[],background,fogBack,fogFront,dustTexture,soldierMeta,actors=[],troops=[],particles=[],currentEvent=null;
let sim=0,lastFrame=0,paused=false,showBackground=true,lastRunDirection=null,runIndex=0;
let clockBase=Date.now()/1000,logicalNow=clockBase,streamOrigin=clockBase,clockOffset=0,timeScale=1;
let lastTick=-1,lastSave=0,sourceStatus='Локальный режим: данные Twitch ещё не настроены',eventLog='',ready=false;
let frameMs=0,twitchTimer=null,presenceStream=null,controlStream=null,controlClientId=null,controlConnected=false,telemetryTimer=null,restoreId=null;
const reduced=()=>config.animation.reducedMotion||matchMedia('(prefers-reduced-motion: reduce)').matches;

async function loadJSON(path){const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw new Error(`Не удалось загрузить ${path}: ${r.status}`);return r.json();}
function image(path){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error(`Нет изображения: ${path}`));im.src=path;});}
async function smallSprite(path){const im=await image(path), c=document.createElement('canvas');c.width=c.height=256;c.getContext('2d').drawImage(im,0,0,256,256);return c;}
function currentClock(){return demo?logicalNow:Date.now()/1000;}
function save(){if(demo||!config.state.persistMilestones)return;try{localStorage.setItem(config.state.storageKey,JSON.stringify(engine.snapshot()));}catch{}}
function restore(){if(demo||restoreId===engine.streamId||!config.state.persistMilestones)return;restoreId=engine.streamId;try{engine.restore(JSON.parse(localStorage.getItem(config.state.storageKey)||'null'));}catch{}}
function emit(e){queue.push(e,sim);save();}
function setStream(info){
  const previous=engine.streamId;
  // Restore a same-stream watermark BEFORE processing its first sample.
  if(info.id&&info.id!==previous){engine.reset(info.id);restoreId=null;restore();queue.clear();}
  engine.setStream(info,currentClock());restore();adjustPopulation();
  if(!info.live){queue.clear();sourceStatus='Канал офлайн — таймеры и присутствие остановлены';}
}
function newActor(index,user=null){
  const identity=user?avatarFor(user.key,characters.length,10):null,type=characters[identity?identity.typeIndex:index%characters.length], variant=type.loaded[identity?identity.colorIndex:(index*7+Math.floor(index/characters.length))%10];
  return {type,variant,index,x:70+(index+.5)*1780/Math.max(10,config.scene.minMurlocs),y:rand(1005,1057),size:config.scene.murlocSize*(type.displayScale||1)*rand(.87,1.05),
    nextAction:rand(2,9),actionStart:-100,actionDuration:2.4,target:rand(80,1840),home:rand(80,1840),phase:rand(0,6.28),face:1,moving:false,blink:0,nextBlink:rand(2,7),speech:0,nextSpeech:rand(3,15),hop:0,hopDuration:.6,panicUntil:0,lastSplash:0};
}
function adjustPopulation(){
  if(roster?.entries.size)return;
  actors=actors.filter(a=>!a.userKey);
  const desired=clamp(Math.ceil(engine.viewers/config.scene.viewersPerMurloc),Math.min(config.scene.minMurlocs,roster?.max||50),Math.min(config.scene.maxMurlocs,roster?.max||50));
  while(actors.length<desired){const a=newActor(actors.length);a.x=rand(90,1830);actors.push(a);}
  if(actors.length>desired)actors.splice(desired);
  if(gallery)actors.forEach((a,i)=>{a.x=192+(i%5)*384;a.y=490+Math.floor(i/5)*510;a.size=360*(a.type.displayScale||1);a.target=a.home=a.x;});
  if(!gallery&&actors.length===10 && sim===0) actors.forEach((a,i)=>{a.x=100+i*190;a.target=a.x;});
}
function syncChatterActors(){
 const users=roster.snapshot(currentClock());
 if(!users.length){if(actors.some(a=>a.userKey))actors=[];if(!actors.length)adjustPopulation();return;}
 const previous=new Map(actors.filter(a=>a.userKey).map(a=>[a.userKey,a]));
 actors=users.map(u=>{let a=previous.get(u.key);if(!a){a=newActor(u.order,u);const columns=Math.ceil(roster.max/2),col=Math.floor(u.slot/2),x=columns===1?960:95+col*1730/(columns-1);a.x=a.home=a.target=x;a.y=u.slot%2?1057:979;a.size=config.scene.murlocSize*(a.type.displayScale||1)*.96;}
  Object.assign(a,{userKey:u.key,userId:u.userId,nickname:u.nickname,login:u.login,alpha:u.alpha,bubbleText:u.bubbleText,bubbleQueueLength:u.bubbleQueueLength,leaving:u.leavingAt!==null});return a;});
}
function receivePresence(p){
 if(p.kind==='chat-status'){chatStatus=p.message||p.phase;return;}
 if(p.kind==='chat-snapshot'){for(const u of (p.users||[]).slice(-roster.max))roster.message(u,currentClock());syncChatterActors();return;}
 if(p.kind==='disconnect'){engine.disconnect(currentClock());return;}
 if(p.kind!=='presence')return;engine.presence(p.login,p.action,currentClock());
 if(p.action==='message'&&config.nicknames.enabled){roster.message(p,currentClock());syncChatterActors();}
}
const fakeNames=['SwampFisher','Jommmain','MrrglMaster','ЛеснойШаман','LunaFox','KappaKnight','ЧайныйМурлок','TinyOracle','NetRunner','MushroomMage','БардБолота','FrostFin','MoonPearl','ChefMrrgl','QuietScout','GoldenCrown','РечнойОхотник','SapphireWave','MossKeeper','Firefly'];
function fakeChatter(i,text){return {kind:'presence',action:'message',login:'demo_chatter_'+i,userId:String(900000001+i),displayName:fakeNames[i%fakeNames.length]+(i>=fakeNames.length?i:''),...(text?{speechText:text}:{})};}
function spawnFakeChatters(count=5){for(let n=0;n<count;n++)receivePresence(fakeChatter(fakeIndex++));chatStatus='Демо: вымышленные участники, не данные Twitch';}
function demoMessage(){if(!roster.entries.size)spawnFakeChatters();const entries=[...roster.entries.values()].filter(e=>e.leavingAt===null);if(!entries.length)return;const u=entries[fakeMessageIndex%entries.length],texts=['Мргл! Рад видеть вас на болоте!','Kappa PogChamp · отличный улов сегодня','Здесь уютно, даже когда пробегают солдаты.','За Альянс? А может, за рыбку?','Длинное сообщение: '+('ещё одна история про болото и светлячков ').repeat(6),'!uptime','Загляните на https://example.com — ссылка скрывается'];receivePresence({kind:'presence',action:'message',login:u.login,userId:u.userId,displayName:u.nickname,speechText:texts[fakeMessageIndex++%texts.length]});}
function actorHead(a){const jump=reduced()?0:(a.hop?Math.sin(a.hop/a.hopDuration*Math.PI)*(a.panicUntil>sim?43:config.animation.hopHeight):0);return {x:a.x,y:a.y-a.size*.94-jump+(reduced()?0:Math.sin(a.phase)*2)};}
const overlaps=(a,b)=>a.x<b.x+b.w+5&&a.x+a.w+5>b.x&&a.y<b.y+b.h+4&&a.y+a.h+4>b.y;
function truncateMeasured(text,width){let chars=Array.from(text);while(chars.length&&ctx.measureText(chars.join('')+'…').width>width)chars.pop();return chars.join('')+'…';}
function layoutLabels(){lastLabels=[];ctx.save();ctx.font='700 14px "Trebuchet MS",Arial,sans-serif';
 for(const a of actors.filter(a=>a.nickname&&a.alpha>0&&a.x>15&&a.x<1905).sort((a,b)=>actorHead(a).y-actorHead(b).y)){
  const h=actorHead(a),text=ctx.measureText(a.nickname).width>134?truncateMeasured(a.nickname,134):a.nickname,w=Math.ceil(ctx.measureText(text).width)+16;let box={x:clamp(h.x-w/2,4,1916-w),y:clamp(h.y-20,773,1048),w,h:23};
  for(let i=0;i<8&&lastLabels.some(b=>overlaps(box,b));i++)box.y=Math.max(773,box.y-26);
  lastLabels.push({...box,text,nickname:a.nickname,userKey:a.userKey,alpha:a.alpha,anchor:h});a.labelBox=box;
 }ctx.restore();
}
function wrapSpeech(text,width){const words=text.split(' '),lines=[];let line='';for(const word of words){const candidate=line?line+' '+word:word;if(ctx.measureText(candidate).width>width&&line){lines.push(line);line=word;}else line=candidate;if(ctx.measureText(line).width>width)line=truncateMeasured(line,width);if(lines.length===2)break;}if(lines.length<3&&line)lines.push(line);const joined=lines.join(' ');if(joined.length<text.length&&lines.length)lines[lines.length-1]=truncateMeasured(lines[lines.length-1]+'…',width);return lines.slice(0,3);}
function drawChatBubbles(){lastBubbles=[];ctx.save();ctx.font='500 14px "Trebuchet MS",Arial,sans-serif';ctx.textAlign='left';ctx.textBaseline='top';
 for(const a of actors.filter(a=>a.nickname&&a.bubbleText&&a.alpha>0&&a.x>15&&a.x<1905)){
  const label=lastLabels.find(l=>l.userKey===a.userKey);if(!label)continue;const lines=wrapSpeech(a.bubbleText,202),w=Math.max(74,Math.min(224,Math.ceil(Math.max(...lines.map(t=>ctx.measureText(t).width)))+22)),h=lines.length*18+18;let box={x:clamp(a.x-w/2,5,1915-w),y:Math.max(773,label.y-h-12),w,h};
  for(let i=0;i<5&&lastBubbles.some(b=>overlaps(box,b));i++){const direction=i%2?-1:1;box.x=clamp(box.x+direction*w*.8,5,1915-w);if(i>2)box.y=Math.max(773,box.y-h-8);}
  ctx.globalAlpha=a.alpha;ctx.shadowColor='rgba(0,0,0,.4)';ctx.shadowBlur=6;ctx.fillStyle='#f1e2c1';ctx.strokeStyle='#614a2b';ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(box.x,box.y,w,h,6);ctx.fill();ctx.stroke();ctx.shadowBlur=0;
  const tip=clamp(a.x,box.x+12,box.x+w-12);ctx.beginPath();ctx.moveTo(tip-5,box.y+h-1);ctx.lineTo(tip,Math.min(label.y-3,box.y+h+8));ctx.lineTo(tip+6,box.y+h-1);ctx.fill();ctx.stroke();ctx.fillStyle='#292b20';lines.forEach((line,i)=>ctx.fillText(line,box.x+11,box.y+9+i*18));lastBubbles.push({...box,text:a.bubbleText,userKey:a.userKey});
 }ctx.restore();
}
function drawNicknames(){ctx.save();ctx.font='700 14px "Trebuchet MS",Arial,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
 for(const b of lastLabels){ctx.globalAlpha=b.alpha;ctx.fillStyle='rgba(17,25,24,.77)';ctx.strokeStyle='rgba(191,156,87,.58)';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(b.x,b.y,b.w,b.h,3);ctx.fill();ctx.stroke();ctx.strokeStyle='#111914';ctx.lineWidth=3;ctx.strokeText(b.text,b.x+b.w/2,b.y+12);ctx.fillStyle='#ffe1a1';ctx.fillText(b.text,b.x+b.w/2,b.y+12);}ctx.restore();
}
function addParticle(p){if(particles.length<700)particles.push(p);}
function splash(x,y,n=12){if(!config.animation.splash)return;for(let i=0;i<n;i++)addParticle({kind:'splash',x,y,vx:rand(-100,100),vy:rand(-150,-40),life:rand(.3,.7),max:.7,size:rand(2,5)});}
function dust(x,y,direction){if(!config.event.dust)return;const trail=dustTrail(direction,rand(15,55));addParticle({kind:'dust',x:x+trail.offsetX,y,vx:trail.vx,vy:rand(-22,-6),life:rand(.35,.85),max:.85,size:rand(8,19),direction});}
function speak(a,panic=false){a.speech=sim+(panic?1.5:2.0);a.words=panic?'МРГЛ?!':['mrglgl','мргл-гл!','MRGL!'][Math.floor(random()*3)];}
function startRun(event){
  runIndex++;currentEvent=event;
  const direction=resolveRunDirection(config.event.direction,lastRunDirection,random(),event.direction);
  lastRunDirection=direction;
  const count=config.event.crowdSize;
  for(let i=0;i<count;i++){
    const lane=i%4,delay=i*config.event.staggerSeconds;
    troops.push({delay,start:sim+delay,duration:config.event.runSeconds,size:config.event.soldierSize*rand(.88,1.08),lane,
      y0:976+lane*22,y1:1044-lane*17,phase:rand(0,6.28),direction,frameOffset:Math.floor(rand(0,8)),tone:(i%3-1)*.06,lastDust:0,x:direction>0?-180:2100,y:1000});
  }
  actors.forEach((a,i)=>{a.panicUntil=sim+config.event.runSeconds+1.4+random();a.target=scatterTarget(direction);a.hop=.001;a.hopDuration=.65;speak(a,true);splash(a.x,a.y,8);});
  const reasons={manual:'ручной запуск',viewers:`${event.value} зрителей`,uptime:`${Math.round(event.value/60)} мин эфира`,watch:`${event.login||'зритель'}: ${Math.round(event.value/60)} мин в чате (оценка)`};
  eventLog=`Пробег #${runIndex} ${direction>0?'→':'←'}: ${reasons[event.kind]||event.kind}${event.merged?` · ещё ${event.merged} причин`:''}`;
}
function update(dt){
  sim+=dt;logicalNow=demo?clockBase+sim*timeScale+clockOffset:Date.now()/1000;
  if(Math.floor(sim)!==lastTick){lastTick=Math.floor(sim);engine.tick(currentClock());if(sim-lastSave>5){save();lastSave=sim;}}
  syncChatterActors();
  const e=queue.take(sim);if(e)startRun(e);
  for(const a of actors){
    const panic=a.panicUntil>sim;
    if(!panic&&(a.target<0||a.target>1920)){a.x=clamp(a.x,25,1895);a.target=a.home;a.hop=.001;}
    if(!gallery&&!panic&&Math.abs(a.x-a.target)<8){if(random()<dt*.3)a.target=a.userKey?clamp(a.home+rand(-24,24),70,1850):rand(80,1840);}
    const dx=a.target-a.x,speed=panic?config.animation.panicSpeed:config.animation.wanderSpeed;
    a.moving=Math.abs(dx)>5;a.face=dx>=0?1:-1;
    if(a.moving)a.x+=Math.sign(dx)*Math.min(Math.abs(dx),speed*dt);
    a.phase+=dt*(a.moving?(panic?19:9):2.8);
    if(a.hop>0){a.hop+=dt;if(a.hop>=a.hopDuration){a.hop=0;splash(a.x,a.y,panic?10:6);}}
    else if(!gallery&&!reduced()&&random()<dt*(panic?1.6:.12)){a.hop=.001;a.hopDuration=rand(.45,.7);}
    if(sim>=a.nextBlink){a.blink=sim+.13;a.nextBlink=sim+config.animation.blinkIntervalSec+rand(-1,2);}
    if(!panic&&sim>=a.nextAction){a.actionStart=sim;a.actionDuration=rand(1.8,2.8);a.nextAction=sim+rand(7,15);}
    if(sim>=a.nextSpeech){if(!panic&&!gallery)speak(a);a.nextSpeech=sim+config.animation.speechIntervalSec+rand(-3,6);}
    if(a.moving&&sim-a.lastSplash>(panic?.25:1.2)){splash(a.x,a.y,panic?5:3);a.lastSplash=sim;}
  }
  for(const s of troops){
    const t=clamp((sim-s.start)/s.duration,0,1);
    s.x=runPosition(t,s.direction);s.y=s.y0+(s.y1-s.y0)*t;
    if(sim>=s.start&&t<1&&sim-s.lastDust>.065){dust(s.x,s.y,s.direction);s.lastDust=sim;}
  }
  troops=troops.filter(s=>sim<s.start+s.duration+.1);
  if(!troops.length)currentEvent=null;
  for(const p of particles){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;if(p.kind==='splash')p.vy+=340*dt;else p.size+=11*dt;}
  particles=particles.filter(p=>p.life>0);
}
function shadow(x,y,w,opacity=.2){ctx.fillStyle=`rgba(0,0,0,${opacity})`;ctx.beginPath();ctx.ellipse(x,y,w,4,0,0,Math.PI*2);ctx.fill();}
// Layer-space is 512x512. Only the chest breathes; feet and face do not stretch as a sticker.
function paintedBody(im,a){
  const breath=reduced()?0:Math.sin(sim*2.1+a.phase*.21);
  for(let y=0;y<512;y+=32){const h=Math.min(32,512-y),wgt=Math.exp(-Math.pow((y+16-292)/103,2)),w=512*(1+breath*.014*wgt);
    ctx.drawImage(im,0,y/2,256,(h+.5)/2,(512-w)/2,y-breath*1.3*wgt,w,h+1);
  }
}
function paintedAction(a){
  const t=sim-a.actionStart,active=t>=0&&t<=a.actionDuration&&!reduced(),u=active?t/a.actionDuration:0,e=active?Math.sin(Math.PI*u):0;
  const rig=a.type.rig;let angle=0,dx=0,dy=0;
  switch(rig.action){
    case 'net-lift':angle=rig.angle*e;dy=-2*e;break;
    case 'totem-sway':angle=rig.angle*Math.sin(t*4)*e;break;
    case 'shield-pump':angle=rig.angle*Math.sin(t*5)*e;dy=-4*Math.abs(Math.sin(t*5))*e;break;
    case 'conch-call':angle=rig.angle*e;dy=-6*e;break;
    case 'pearl-reveal':angle=rig.angle*e;dy=-8*e;break;
    case 'toy-wave':angle=rig.angle*Math.sin(t*9)*e;break;
    case 'spoon-stir':angle=rig.angle*Math.sin(t*8)*e;dx=2*Math.cos(t*8)*e;dy=2*Math.sin(t*8)*e;break;
    case 'lute-strum':angle=rig.angle*Math.sin(t*24)*e;dy=1.8*Math.sin(t*24)*e;break;
    case 'look-around':angle=rig.angle*Math.sin(t*3)*e;dx=1.5*Math.sin(t*3)*e;break;
    case 'scepter-salute':angle=rig.angle*e;break;
  }
  const [px,py]=rig.pivot;ctx.save();ctx.translate(px+dx,py+dy);ctx.rotate(angle);ctx.drawImage(a.variant.layers.action,-px,-py,512,512);ctx.restore();
}
function paintedActor(a){
  ctx.save();const opacity=ctx.globalAlpha;ctx.translate(-256,-492);paintedBody(a.variant.layers.body,a);
  const [fx,fy]=a.type.rig.finPivot;ctx.save();ctx.translate(fx,fy);ctx.rotate(reduced()?0:Math.sin(sim*3.4+a.phase)*.016);ctx.drawImage(a.variant.layers.fin,-fx,-fy,512,512);ctx.restore();
  paintedAction(a);
  if(a.blink>sim){const p=clamp((sim-(a.blink-.13))/.13,0,1);ctx.globalAlpha=opacity*Math.min(1,Math.sin(p*Math.PI)*2);ctx.drawImage(a.variant.layers.lids,0,0,512,512);ctx.globalAlpha=opacity;}
  ctx.restore();
}
function drawFog(im,speed,alpha,yOffset=0){
  if(gallery||!showBackground||!config.animation.fog)return;
  const offset=reduced()?0:((sim*speed)%1920);ctx.save();ctx.globalAlpha=alpha*(.91+(reduced()?0:Math.sin(sim*.18)*.09));
  ctx.drawImage(im,offset-1920,780+yOffset,1920,300);ctx.drawImage(im,offset,780+yOffset,1920,300);ctx.restore();
}
function drawFireflies(){if(gallery||!showBackground)return;ctx.save();
  for(let i=0;i<13;i++){const x=(i*151+79)+(reduced()?0:Math.sin(sim*.43+i)*15),y=871+(i%4)*27+(reduced()?0:Math.cos(sim*.55+i)*10),a=.22+(Math.sin(sim*.7+i)+1)*.15;
    const glow=ctx.createRadialGradient(x,y,0,x,y,8);glow.addColorStop(0,`rgba(216,233,136,${a})`);glow.addColorStop(1,'rgba(216,233,136,0)');ctx.fillStyle=glow;ctx.fillRect(x-8,y-8,16,16);ctx.fillStyle=`rgba(228,243,160,${a+.2})`;ctx.fillRect(x-.65,y-.65,1.3,1.3);
  }ctx.restore();}
function drawActor(a){
  if(a.x< -120||a.x>2040)return;
  const panic=a.panicUntil>sim,moving=a.moving;
  const jump=reduced()?0:(a.hop?Math.sin(a.hop/a.hopDuration*Math.PI)*(panic?43:config.animation.hopHeight):0);
  const bob=reduced()?0:Math.sin(a.phase)*(moving?3.3:config.animation.idleBob);
  const stretch=reduced()?0:(a.hop?Math.sin(a.hop/a.hopDuration*Math.PI)*.09:0);
  ctx.save();ctx.globalAlpha=a.alpha??1;
  shadow(a.x,a.y,a.size*.24,panic?.12:.18);
  ctx.save();ctx.translate(a.x,a.y-jump+bob);ctx.rotate(reduced()?0:Math.sin(a.phase)*(panic?.09:(moving?.025:.008)));
  ctx.scale(a.face*a.size/512*(1-stretch),a.size/512*(1+stretch));
  paintedActor(a);
  ctx.restore();
  if(!a.nickname&&a.speech>sim&&a.x>20&&a.x<1900){
    const text=a.words||'mrglgl',x=clamp(a.x,65,1855),y=a.y-a.size*.93-jump-15;
    ctx.save();ctx.font=`bold ${panic?16:14}px system-ui`;const w=ctx.measureText(text).width+24;
    ctx.fillStyle=panic?'#fff1cf':'#e6faf1';ctx.strokeStyle='#304e4b';ctx.lineWidth=2;
    ctx.beginPath();ctx.roundRect(x-w/2,y-23,w,30,10);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(x-3,y+6);ctx.lineTo(x+2,y+13);ctx.lineTo(x+8,y+6);ctx.fill();
    ctx.fillStyle='#224849';ctx.textAlign='center';ctx.fillText(text,x,y-3);ctx.restore();
  }
  ctx.restore();
}
function drawTroop(s){if(sim<s.start)return;
  const phase=(sim-s.start)*soldierMeta.fps+s.frameOffset,frame=Math.floor(phase)%soldierImages.length;
  const bob=reduced()?0:Math.sin(phase*Math.PI/4)*.8;
  shadow(s.x,s.y,s.size*.22,.20);ctx.save();ctx.translate(s.x,s.y-bob);
  ctx.scale(s.direction*s.size/512,s.size/512);
  ctx.drawImage(soldierImages[reduced()?0:frame],-soldierMeta.anchor[0],-soldierMeta.anchor[1],512,512);ctx.restore();
}
function draw(){
  ctx.clearRect(0,0,1920,1080);
  if(showBackground&&!gallery){ctx.globalAlpha=clamp(config.scene.stripOpacity,0,1);ctx.drawImage(background,0,1080-config.scene.stripHeight,1920,config.scene.stripHeight);ctx.globalAlpha=1;}
  // Constrain every effect to the compact lower arena, never dirty the upper game/camera area.
  ctx.save();ctx.beginPath();ctx.rect(0,gallery?0:770,1920,gallery?1080:310);ctx.clip();
  drawFog(fogBack,3.5,.8,-5);drawFireflies();
  for(const p of particles.filter(p=>p.kind==='dust')){ctx.globalAlpha=clamp(p.life/p.max*.48,0,.48);ctx.drawImage(dustTexture,p.x-p.size*2,p.y-p.size,p.size*4,p.size*2);}ctx.globalAlpha=1;
  const depth=[...actors.map(a=>({y:a.y,draw:()=>drawActor(a)})),...troops.map(s=>({y:s.y,draw:()=>drawTroop(s)}))].sort((a,b)=>a.y-b.y);
  depth.forEach(x=>x.draw());drawFog(fogFront,-5,.72,4);layoutLabels();drawChatBubbles();drawNicknames();
  for(const p of particles.filter(p=>p.kind==='splash')){ctx.globalAlpha=clamp(p.life/p.max*.8,0,.8);ctx.fillStyle='#8cdbd5';ctx.beginPath();ctx.ellipse(p.x,p.y,p.size*.6,p.size,0,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;ctx.restore();
  if(gallery){ctx.save();ctx.fillStyle='#b2c9bc';ctx.font='26px system-ui';ctx.fillText('SWAMP MURLOCS 1.2.1 · ДЫХАНИЕ / МОРГАНИЕ / ДЕЙСТВИЯ',50,54);ctx.restore();}
  if(config.desktopDebug&&config.desktopDebugHud){const period=config.triggers.uptimeMinutes*60,remaining=Math.ceil(period-Math.max(0,currentClock()-streamOrigin)%period);ctx.save();ctx.fillStyle='rgba(8,20,27,.86)';ctx.fillRect(12,12,460,86);ctx.fillStyle='#9ce0d7';ctx.font='14px monospace';ctx.fillText('DEBUG · HTTP '+(controlConnected?'connected':'disconnected')+' · '+(engine.live?'online':'offline'),24,34);ctx.fillText('viewers '+engine.viewers+' · next '+((engine.maxStep+1)*config.triggers.viewerStep)+' · timer '+remaining+'s',24,57);ctx.fillText('runs '+runIndex+' · queue '+queue.pending.length+' · ники '+roster.entries.size+' · SSE '+(controlConnected?'OK':'retry'),24,80);ctx.restore();}
  if(demo&&!params.has('hideHud')){ $('status').textContent=sourceStatus;$('viewers').textContent=`Зрителей: ${engine.viewers}`;$('uptime').textContent=`Эфир: ${Math.floor((logicalNow-streamOrigin)/60)} мин`;$('crowd').textContent=`Мурлоков: ${actors.length} · очередь: ${queue.pending.length}`;$('event-log').textContent=eventLog;}
}
function frame(t){const dt=lastFrame?Math.min(.05,(t-lastFrame)/1000):0;frameMs=lastFrame?t-lastFrame:0;lastFrame=t;if(!paused)update(dt);draw();requestAnimationFrame(frame);}
function action(name){if(!demo)return;
  if(['run','ltr','rtl'].includes(name))queue.push({kind:'manual',value:sim,streamId:engine.streamId,...(name==='run'?{}:{direction:name})},sim);
  if(name==='viewers')setStream({id:engine.streamId,live:true,viewers:engine.viewers+config.triggers.viewerStep,startedAt:streamOrigin});
  if(name==='uptime'){clockOffset+=config.triggers.uptimeMinutes*60;logicalNow=clockBase+sim*timeScale+clockOffset;engine.tick(logicalNow);}
  if(name==='watch'){
    const login='demo_viewer';engine.presence(login,'join',logicalNow);
    const u=engine.users.get(login);u.seconds=Math.max(u.seconds,(u.milestone+1)*config.triggers.watchMinutes*60);engine.tick(logicalNow);
  }
  if(name==='chatters')spawnFakeChatters();
  if(name==='chat-message')demoMessage();
  if(name==='clear-chatters')roster.clear(currentClock());
  if(name==='hop')actors.forEach(a=>{a.hop=.001;});
  if(name==='speech')actors.forEach(a=>speak(a));
  if(name==='splash')actors.forEach(a=>splash(a.x,a.y,18));
  if(name==='background')showBackground=!showBackground;
  if(name==='pause')paused=!paused;
}
async function pollTwitch(){
  try{
    const r=await fetch('/api/stream',{cache:'no-store'});const info=await r.json();
    if(!r.ok)throw new Error(info.error||`Helix ${r.status}`);
    pollTwitch.lastSuccess=currentClock();sourceStatus=info.live?'Twitch Helix · online · обновление раз в минуту':'Twitch · канал офлайн';
    if(info.live){streamOrigin=Date.parse(info.started_at)/1000;setStream({id:info.id,live:true,viewers:info.viewer_count,startedAt:streamOrigin});}
    else setStream({id:engine.streamId,live:false});
  }catch(err){if(!engine.live||currentClock()-(pollTwitch.lastSuccess||0)>config.twitch.staleAfterSeconds)setStream({id:engine.streamId,live:false});sourceStatus=`Twitch: ${err.message}. Данные не подменяются локальным эфиром.`;}
  clearTimeout(twitchTimer);twitchTimer=setTimeout(pollTwitch,Math.max(60,config.twitch.pollSeconds)*1000);
}
function connectPresence(){
  presenceStream=new EventSource('/api/presence');
  presenceStream.onmessage=e=>{try{receivePresence(JSON.parse(e.data));}catch{}};
  presenceStream.onerror=()=>engine.disconnect(currentClock());
}
function pushTelemetry(){
  if(!config.desktopDebug||!controlClientId)return;const uptime=Math.max(0,currentClock()-streamOrigin),period=config.triggers.uptimeMinutes*60,snap=engine.snapshot();
  fetch('/api/telemetry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:controlClientId,viewers:engine.viewers,runIndex,queued:queue.pending.length,murlocs:actors.length,chatters:roster.entries.size,chatPending:roster.pending.size,maxStep:snap.maxStep,uptimeStep:snap.uptimeStep,uptimeSeconds:uptime,nextUptimeSeconds:period-uptime%period,nextViewerThreshold:(snap.maxStep+1)*config.triggers.viewerStep,frameMs,connection:engine.live?'online':'offline'})}).catch(()=>{});
}
function connectControl(){
  let instance=null;controlStream=new EventSource('/api/control');controlStream.onopen=()=>{controlConnected=true;};controlStream.onerror=()=>{controlConnected=false;};
  if(config.desktopDebug)telemetryTimer=setInterval(pushTelemetry,2000);
  controlStream.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.kind==='hello'){if(instance&&instance!==m.instanceId)location.reload();instance=m.instanceId;controlClientId=m.clientId||null;}if(m.kind==='test-run')queue.push({kind:'manual',value:sim,streamId:engine.streamId},sim);}catch{}};
}
async function main(){
  config=await loadJSON('config.json');config.nicknames={enabled:true,...config.nicknames};roster=new ChatterRoster(config.nicknames);
  if(demo&&['ltr','rtl','alternate','random'].includes(params.get('direction')))config.event.direction=params.get('direction');
  config.scene.stripHeight=clamp(config.scene.stripHeight,60,270);
  config.scene.maxMurlocs=clamp(config.scene.maxMurlocs,1,100);config.scene.minMurlocs=clamp(config.scene.minMurlocs,0,config.scene.maxMurlocs);
  config.scene.viewersPerMurloc=Math.max(.1,config.scene.viewersPerMurloc);config.event.crowdSize=clamp(config.event.crowdSize,1,80);
  config.event.runSeconds=clamp(config.event.runSeconds,2,30);config.triggers.viewerStep=Math.max(1,config.triggers.viewerStep);
  config.triggers.uptimeMinutes=Math.max(1,config.triggers.uptimeMinutes);config.triggers.watchMinutes=Math.max(1,config.triggers.watchMinutes);
  queue=new EventQueue(config.event);engine=new TriggerEngine(config.triggers,emit);
  const meta=await loadJSON('assets/characters.json');
  characters=await Promise.all(meta.map(async type=>({...type,loaded:await Promise.all(type.variants.map(async v=>({color:v.color,layers:Object.fromEntries(await Promise.all(Object.entries(v.layers).map(async([key,path])=>[key,await smallSprite(path)])))})))})));
  [background,fogBack,fogFront,dustTexture]=await Promise.all(['swamp-strip','fog-back','fog-front','dust-puff'].map(n=>image(`assets/${n}.png`)));
  soldierMeta=await loadJSON('assets/soldiers/run.json');soldierImages=await Promise.all(soldierMeta.frames.map(smallSprite));
  if(params.get('preview')==='1')document.body.classList.add('preview');
  if(demo){
    $('hud').hidden=params.has('hideHud');timeScale=numeric('speed',config.demo.timeScale,.1,120);
    const uptime=numeric('uptime',config.demo.uptimeSeconds);streamOrigin=clockBase-uptime;
    setStream({id:`demo-${seed}`,live:true,viewers:numeric('viewers',config.demo.viewers,0,10000),startedAt:streamOrigin});
    engine.presence('demo_viewer','join',logicalNow);sourceStatus='Демо: E по конфигу · L слева направо · R справа налево · V +5 · T/W +30 мин · N ники · Q сообщение · C убрать';
  } else if(config.twitch.enabled){engine.live=false;await pollTwitch();if(config.twitch.ircEnabled)connectPresence();}
  else {setStream({id:`standalone-${Math.floor(clockBase)}`,live:true,viewers:0,startedAt:clockBase});}
  if(demo&&params.get('chatters')==='1')spawnFakeChatters(numeric('names',12,1,50));
  document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));
  addEventListener('keydown',e=>{if(!demo||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.repeat)return;const keys={e:'run',l:'ltr',r:'rtl',v:'viewers',t:'uptime',w:'watch',h:'hop',m:'speech',s:'splash',b:'background',p:'pause',n:'chatters',q:'chat-message',c:'clear-chatters'};const a=keys[e.key.toLowerCase()];if(a){e.preventDefault();action(a);}});
  window.SwampOverlay={ready:true,action,stats:()=>({ready,artVersion:"1.2.1",chatters:roster.entries.size,chatPending:roster.pending.size,chatStatus,labels:lastLabels.map(({nickname,x,y,w,h})=>({nickname,x,y,w,h})),bubbleCount:lastBubbles.length,riggedTypes:characters.length,runFrames:soldierImages.length,fog:config.animation.fog,sim,viewers:engine.viewers,murlocs:actors.length,troops:troops.length,particles:particles.length,runIndex,lastDirection:lastRunDirection,eventLog,queued:queue.pending.length,events:queue.history,stream:engine.snapshot(),frameMs,live:engine.live,sourceStatus}),captureStream:(fps=30)=>canvas.captureStream(fps)};
  if(testing)Object.assign(window.SwampOverlay,{testChatMessage:p=>receivePresence({kind:'presence',action:'message',...p}),testChatters:()=>roster.snapshot(currentClock()).map(({key,userId,nickname,alpha,slot,lastSeen,leavingAt,bubbleText,bubbleQueueLength})=>({key,userId,nickname,alpha,slot,lastSeen,leavingAt,bubbleText,bubbleQueueLength})),testChatClear:()=>roster.clear(currentClock()),testActionAll:()=>actors.forEach(a=>{a.actionStart=sim;a.actionDuration=2.5;a.nextAction=sim+1000;}),testBlinkAll:()=>actors.forEach(a=>{a.blink=sim+.13;}),testActors:()=>actors.map(a=>({id:a.type.id,action:a.type.rig.action,actionStart:a.actionStart,blink:a.blink})),testSetStream:info=>setStream(info),testPresence:(login,act,now=logicalNow)=>engine.presence(login,act,now),testAdvance:s=>{clockOffset+=s;logicalNow+=s;engine.tick(logicalNow);},testTick:dt=>{update(dt);draw();},testPause:()=>{paused=true;},testScene:()=>({troops:troops.map(({x,y,direction})=>({x,y,direction,mirrorX:direction<0})),actors:actors.map(({x,target,panicUntil})=>({x,target,panicking:panicUntil>sim})),dust:particles.filter(p=>p.kind==='dust').map(({x,vx,direction})=>({x,vx,direction}))}),engine,queue});
  if(config.desktopControl)connectControl();
  ready=true;draw();requestAnimationFrame(frame);
  if(demo&&params.get('force')==='1')setTimeout(()=>action('run'),450);
}
main().catch(err=>{$('error').hidden=false;$('error').textContent=err.message+' — запускайте через node server.mjs, не file://';console.error(err);});
addEventListener('beforeunload',()=>{save();clearTimeout(twitchTimer);presenceStream?.close();controlStream?.close();clearInterval(telemetryTimer);});
