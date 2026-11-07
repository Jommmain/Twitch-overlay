const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../overlay'),dst=path.join(__dirname,'staged-overlay');fs.mkdirSync(dst,{recursive:true});
for(const name of ['index.html','app.js','engine.js','chat-avatars.js','irc-client.cjs','style.css','config.json','server.mjs','assets'])fs.cpSync(path.join(root,name),path.join(dst,name),{recursive:true,filter:src=>!['running-source','anatomy-reference'].some(term=>path.basename(src).includes(term))});
for(const excluded of ['soldiers/running-source.jpg','soldiers/anatomy-reference.png','footman-anatomy-reference.png'])fs.rmSync(path.join(dst,'assets',excluded),{force:true});
console.log('Staged 1.2.1 code + 100 layered murlocs, 8 run frames, fog and dust textures. No previews, reference art or secrets.');
