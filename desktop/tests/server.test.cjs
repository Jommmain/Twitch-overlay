const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),net=require('node:net'),{fork}=require('node:child_process');
const {runtimeConfig,DEFAULTS}=require('../settings.cjs');
test('desktop server uses external config; IPC test event reaches SSE; public config has no token',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'swamp-server-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const base=JSON.parse(await fs.readFile(path.join(__dirname,'../../overlay/config.json'),'utf8')),c=runtimeConfig(base,{...DEFAULTS,direction:'rtl',viewerStep:7});const cfg=path.join(dir,'runtime.json');await fs.writeFile(cfg,JSON.stringify(c));
 const port=await new Promise(resolve=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const child=fork(path.join(__dirname,'../../overlay/server.mjs'),[],{execArgv:['--require',path.join(__dirname,'parent-bridge.cjs')],env:{...process.env,SWAMP_DESKTOP:'1',SWAMP_CONFIG_PATH:cfg,PORT:String(port),TWITCH_ACCESS_TOKEN:'dummyNoRealToken'},stdio:['ignore','pipe','pipe','ipc']});t.after(()=>{child.kill();if(child.connected)child.disconnect();});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),5000);child.once('message',m=>{clearTimeout(timer);assert.equal(m.kind,'ready');resolve();});child.once('exit',()=>{clearTimeout(timer);reject(Error('early exit'));});});
 const url=`http://127.0.0.1:${port}`;const json=await(await fetch(url+'/config.json')).json();assert.equal(json.event.direction,'rtl');assert.equal(json.triggers.viewerStep,7);assert(!JSON.stringify(json).includes('dummyNoRealToken'));
 const r=await fetch(url+'/api/control'),reader=r.body.getReader();assert.equal(r.headers.get('content-type'),'text/event-stream');const hello=new TextDecoder().decode((await reader.read()).value);assert(hello.includes('instanceId'));child.send({kind:'test-run'});
 const msg=await reader.read();assert(new TextDecoder().decode(msg.value).includes('test-run'));await reader.cancel();
 assert.equal((await fetch(url+'/settings.json')).status,404);assert.equal((await fetch(url+'/api/control',{method:'POST'})).status,405);
 assert.equal((await fetch(url+'/%E0%A4%A')).status,400);
});
