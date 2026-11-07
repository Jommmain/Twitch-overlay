import http from 'node:http';
import chatIRC from './irc-client.cjs';
import {readFile, stat, realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const config=JSON.parse(await readFile(process.env.SWAMP_CONFIG_PATH||path.join(ROOT,'config.json'),'utf8'));
const port=Number(process.env.PORT)||8766;
const channel=String(process.env.TWITCH_CHANNEL||config.twitch.channel).toLowerCase();
const validChannel=/^[a-z0-9_]{1,25}$/.test(channel)&&!channel.includes('your_channel');
const clientId=process.env[config.twitch.clientIdEnv]||'',token=process.env[config.twitch.accessTokenEnv]||'';
let streamCache=null,cacheAt=0,streamPending=null;
const listeners=new Set(),controlListeners=new Set(),instanceId=randomUUID();
if(process.env.SWAMP_DESKTOP==='1')process.parentPort?.on('message',event=>{if(event.data?.kind==='test-run')for(const r of controlListeners)r.write('data: '+JSON.stringify({kind:'test-run'})+'\n\n');});
const broadcast=data=>{for(const r of listeners)r.write(`data: ${JSON.stringify(data)}\n\n`);};
async function stream(){
  if(!config.twitch.enabled)return {status:503,body:{error:'Twitch выключен в config.json'}};
  if(!clientId||!token||!validChannel)return {status:503,body:{error:'Настройте канал, TWITCH_CLIENT_ID и TWITCH_ACCESS_TOKEN на сервере'}};
  if(streamCache&&Date.now()-cacheAt<60000)return streamCache;
  if(streamPending)return streamPending;
  streamPending=(async()=>{
    try{
      const r=await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(channel)}`,{headers:{'Client-ID':clientId,'Authorization':`Bearer ${token}`},signal:AbortSignal.timeout(12000)});
      if(!r.ok){const error=r.status===401?'Helix 401: обновите access token / Client ID':r.status===429?'Helix 429: ограничение запросов':`Helix HTTP ${r.status}`;return {status:r.status,body:{error}};}
      const json=await r.json(),s=json.data?.[0];
      return {status:200,body:s?{live:true,id:s.id,viewer_count:s.viewer_count,started_at:s.started_at}:{live:false}};
    }catch{return {status:502,body:{error:'Helix временно недоступен'}};}
  })();
  try{streamCache=await streamPending;cacheAt=Date.now();return streamCache;}finally{streamPending=null;}
}
let chat=null;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif','.mp4':'video/mp4'};
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  let url;try{url=new URL(req.url,'http://localhost');}catch{res.writeHead(400);res.end();return;}
  if(url.pathname==='/config.json'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(config));return;}
  if(url.pathname==='/api/control'&&config.desktopControl&&process.env.SWAMP_DESKTOP==='1'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive'});res.write('data: '+JSON.stringify({kind:'hello',instanceId})+'\n\n');controlListeners.add(res);
    const keep=setInterval(()=>res.write(': keepalive\n\n'),20000);req.on('close',()=>{controlListeners.delete(res);clearInterval(keep);});return;
  }
  if(url.pathname==='/api/stream'){const result=await stream();res.writeHead(result.status,{'Content-Type':'application/json'});res.end(JSON.stringify(result.body));return;}
  if(url.pathname==='/api/presence'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive'});res.write(': connected\n\n');listeners.add(res);res.write('data: '+JSON.stringify({kind:'chat-status',...chat?.diagnostics()})+'\n\n');res.write('data: '+JSON.stringify(chat?.snapshot()||{kind:'chat-snapshot',users:[]})+'\n\n');
    const keep=setInterval(()=>res.write(': keepalive\n\n'),20000);req.on('close',()=>{listeners.delete(res);clearInterval(keep);});return;
  }
  if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(url.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,twitchEnabled:config.twitch.enabled,credentialsConfigured:!!(clientId&&token&&validChannel)}));return;}
  let requested;try{requested=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));}catch{res.writeHead(400);res.end('Bad path');return;}
  const topAllowed=['index.html','app.js','engine.js','chat-avatars.js','style.css','config.json'];
  if(!topAllowed.includes(requested)&&!requested.startsWith('assets/')&&!requested.startsWith('preview/')){res.writeHead(404);res.end('Not found');return;}
  try{
    const p=await realpath(path.join(ROOT,requested));if(!p.startsWith(ROOT+path.sep)||!(await stat(p)).isFile())throw new Error();
    // Keep raw generation/reference images out of the running web surface.
    if(p.includes('anatomy-reference')||p.includes('running-source'))throw new Error();
    res.writeHead(200,{'Content-Type':types[path.extname(p)]||'application/octet-stream'});res.end(await readFile(p));
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>{console.log(`Swamp overlay: http://127.0.0.1:${port}/`);console.log(`Demo: http://127.0.0.1:${port}/?demo=1&preview=1`);chat=chatIRC.createChatCollector({channel,enabled:config.twitch.enabled&&config.twitch.ircEnabled,credentials:{clientId,token:process.env[config.twitch.ircTokenEnv]||token,nick:process.env[config.twitch.ircNickEnv]||undefined},ignoredBots:config.nicknames?.ignoredBots,inactivitySeconds:config.nicknames?.inactivitySeconds,maxUsers:(config.nicknames?.maxOnScreen||20)*5,bubblesEnabled:config.nicknames?.bubblesEnabled,bubbleMaxLength:config.nicknames?.bubbleMaxLength,onEvent:broadcast});process.parentPort?.postMessage({kind:'ready',port});});
process.on('SIGTERM',()=>{chat?.close();for(const r of [...listeners,...controlListeners])r.end();server.close(()=>{if(process.env.SWAMP_DESKTOP==='1')process.exit(0);});});
